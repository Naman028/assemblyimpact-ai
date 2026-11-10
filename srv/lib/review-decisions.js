// M04 Slice 2a: review decision rules. Pure data + checks; persistence is in decide().
// Status changes happen only here, together with an insert-only DecisionEvents row,
// in the caller's transaction (cds.context.tx).
import cds from '@sap/cds';

export const COMMENT_MAX = 1000;

/**
 * Allowed transitions per bound action. `independent`: the decider must not be the submitter.
 * `evidence` (Slice 2a.1): 'required' = the request must name the case's latest impact run;
 * 'optional' = a named run is validated and recorded, but may be omitted; 'none' = not applicable.
 * `runStatusPolicy` (M05): the evaluated run's status must be acceptable for the decision (see EVIDENCE_POLICY).
 */
export const TRANSITIONS = Object.freeze({
  submitForReview: Object.freeze({ event: 'SUBMIT', from: Object.freeze(['OPEN']), to: 'IN_REVIEW', verb: 'submit', independent: false, commentRequired: false, evidence: 'none' }),
  approve: Object.freeze({ event: 'APPROVE', from: Object.freeze(['IN_REVIEW']), to: 'APPROVED', verb: 'approve', independent: true, commentRequired: false, evidence: 'required', runStatusPolicy: true }),
  reject: Object.freeze({ event: 'REJECT', from: Object.freeze(['IN_REVIEW']), to: 'REJECTED', verb: 'reject', independent: true, commentRequired: true, evidence: 'optional' }),
});

/**
 * M05 approval evidence policy, by impact-run status (ruleset 1.1.0 statuses):
 * COMPLETE: eligible. COMPLETE_WITH_WARNINGS (only STOCK_STALE): eligible only with an explicit
 * acknowledgeWarnings=true, which is recorded on the decision event. INCOMPLETE: never approvable.
 * Unknown statuses are refused (fail closed).
 */
export const EVIDENCE_POLICY = Object.freeze({ COMPLETE: 'eligible', COMPLETE_WITH_WARNINGS: 'acknowledge', INCOMPLETE: 'refuse' });

export class DecisionError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

/** Normalises the optional comment; enforces the rejection-comment rule and the length limit. */
export function normaliseComment(transition, raw) {
  if (raw !== undefined && raw !== null && typeof raw !== 'string') throw new DecisionError(400, 'INVALID_COMMENT', 'Comment must be text.');
  const comment = (raw ?? '').trim();
  if (comment.length > COMMENT_MAX) throw new DecisionError(400, 'COMMENT_TOO_LONG', `Comment must not exceed ${COMMENT_MAX} characters.`);
  if (transition.commentRequired && !comment) throw new DecisionError(400, 'REJECTION_COMMENT_REQUIRED', 'A comment is required to reject a review case.');
  return comment || null;
}

/** The user who put the case into review: latest SUBMIT event, otherwise the case creator. */
async function submitterOf(reviewCase) {
  return (await submittersOf([reviewCase]))[0];
}

/**
 * Batch form of the submitter rule for cases [{ ID, createdBy }]: latest event into IN_REVIEW, else the
 * case creator. Shared by the decision check and the UI availability flags so both always agree.
 */
export async function submittersOf(cases) {
  if (!cases.length) return [];
  const { DecisionEvents } = cds.entities('assemblyimpact');
  const events = await SELECT.from(DecisionEvents).columns('reviewCase_ID', 'actor', 'at')
    .where({ reviewCase_ID: { in: cases.map(c => c.ID) }, toStatus: 'IN_REVIEW' }).orderBy('at');
  const latest = new Map();
  for (const e of events) latest.set(e.reviewCase_ID, e.actor); // ascending: the latest wins
  return cases.map(c => latest.get(c.ID) ?? c.createdBy ?? null);
}

/** M05: which review actions the user may start on a case (advisory for UIs; every action re-checks). */
export function availabilityFor({ status, submittedBy, latestRun_ID }, user, impactAllowedStatuses) {
  const analyst = user.is('ChangeAnalyst'), approver = user.is('ChangeApprover');
  const canRunImpact = (analyst || user.is('ImpactRunner')) && impactAllowedStatuses.includes(status);
  const canSubmit = analyst && status === 'OPEN';
  const canDecide = approver && status === 'IN_REVIEW' && submittedBy !== user.id;
  // Reasons, in the order a user can act on them: role first, then case state, then evidence and duties.
  const runImpactHint = canRunImpact ? null
    : !(analyst || user.is('ImpactRunner')) ? 'Requires the Change Analyst role.'
      : `Not available in status ${status}; the evidence of a decided case is preserved.`;
  const submitHint = canSubmit ? (latestRun_ID ? null : 'You can submit now, but the approver will need an impact run: run the calculation first.')
    : !analyst ? 'Requires the Change Analyst role.'
      : `Only open cases can be submitted (status ${status}).`;
  const decideHint = !approver ? 'Requires the Change Approver role (an independent reviewer).'
    : status === 'OPEN' ? 'The analyst must submit the case for review first.'
      : status !== 'IN_REVIEW' ? `Already decided (status ${status}).`
        : submittedBy === user.id ? 'You submitted this case; another approver must decide it (separation of duties).'
          : !latestRun_ID ? 'No impact run exists: approval needs a calculation (rejection is still possible).'
            : null;
  return { canRunImpact, canSubmit, canDecide, runImpactHint, submitHint, decideHint };
}

/**
 * Applies one transition. Returns null when the case is missing or outside the user's plants
 * (callers answer 404 for both). Throws DecisionError for rule violations.
 */
export async function decide({ caseID, transition, userID, plants, rawComment, basedOnRun: rawRun, acknowledgeWarnings, now = new Date().toISOString() }) {
  const comment = normaliseComment(transition, rawComment);
  const { ReviewCases } = cds.entities('assemblyimpact');
  const reviewCase = await SELECT.one.from(ReviewCases).columns('ID', 'status', 'plant', 'version', 'createdBy', 'latestRun_ID')
    .where({ ID: caseID, plant: { in: plants } });
  if (!reviewCase) return null;

  if (!transition.from.includes(reviewCase.status)) {
    throw new DecisionError(409, 'INVALID_STATUS_TRANSITION', `Cannot ${transition.verb} a review case in status ${reviewCase.status}.`);
  }
  if (transition.independent && (await submitterOf(reviewCase)) === userID) {
    throw new DecisionError(403, 'SELF_DECISION_NOT_ALLOWED', 'A review case must be decided by someone other than its submitter.');
  }

  if (acknowledgeWarnings !== undefined && acknowledgeWarnings !== null && typeof acknowledgeWarnings !== 'boolean') {
    throw new DecisionError(400, 'INVALID_ACKNOWLEDGEMENT', 'acknowledgeWarnings must be true or false.');
  }
  const evidence = await checkEvidence(reviewCase, transition, rawRun, acknowledgeWarnings === true);
  return applyTransition(reviewCase, transition, { userID, comment, now, ...evidence });
}

/**
 * Slice 2a.1: the run named by the reviewer must belong to this case and be its latest run.
 * Unknown runs and runs of other cases (including other plants) get the same answer.
 */
async function checkEvidence(reviewCase, transition, rawRun, acknowledged) {
  if (transition.evidence === 'none') return {};
  const basedOnRun = rawRun || null;
  if (transition.evidence === 'required') {
    if (!reviewCase.latestRun_ID) throw new DecisionError(409, 'NO_EVIDENCE', `Cannot ${transition.verb} a review case without an impact run; run the impact calculation first.`);
    if (!basedOnRun) throw new DecisionError(400, 'EVIDENCE_REFERENCE_REQUIRED', `Name the impact run you evaluated (basedOnRun) to ${transition.verb} the case.`);
  }
  if (!basedOnRun) return {};
  const { ImpactRuns } = cds.entities('assemblyimpact');
  const run = await SELECT.one.from(ImpactRuns).columns('ID', 'status', 'flags').where({ ID: basedOnRun, reviewCase_ID: reviewCase.ID });
  if (!run) throw new DecisionError(400, 'UNKNOWN_EVIDENCE_RUN', 'The referenced impact run does not belong to this review case.');
  if (basedOnRun !== reviewCase.latestRun_ID) throw staleEvidence();
  const result = { basedOnRun, evidenceStatus: run.status, warningsAcknowledged: null };
  if (transition.runStatusPolicy) {
    const policy = EVIDENCE_POLICY[run.status] ?? 'refuse';
    if (policy === 'refuse') {
      throw new DecisionError(409, 'EVIDENCE_INCOMPLETE', `Cannot ${transition.verb} on an impact run with status ${run.status}` +
        `${run.flags ? ` (${run.flags})` : ''}; resolve the missing inputs and run the impact calculation again.`);
    }
    if (policy === 'acknowledge') {
      if (!acknowledged) {
        throw new DecisionError(409, 'WARNINGS_ACKNOWLEDGEMENT_REQUIRED', `The evaluated impact run has warnings (${run.flags ?? 'unspecified'}); ` +
          'confirm acknowledgeWarnings to approve on this evidence.');
      }
      result.warningsAcknowledged = true;
    }
  }
  return result;
}

const staleEvidence = () => new DecisionError(409, 'STALE_EVIDENCE', 'The impact evidence changed since you reviewed it; reload the case and review the latest impact run.');

/**
 * Writes the status change and its DecisionEvents row for a case read earlier.
 * Compare-and-set on status and version (and, when evidence is named, on latestRun): if a
 * concurrent decision or impact run committed after `reviewCase` was read, nothing is written
 * and DecisionError 409 is thrown (STALE_EVIDENCE when the latest run moved).
 */
export async function applyTransition(reviewCase, transition, { userID, comment, now, basedOnRun = null, evidenceStatus = null, warningsAcknowledged = null }) {
  const { ReviewCases, DecisionEvents } = cds.entities('assemblyimpact');
  const guard = { ID: reviewCase.ID, status: reviewCase.status, version: reviewCase.version ?? null };
  if (transition.evidence === 'required' || basedOnRun) guard.latestRun_ID = basedOnRun;
  const affected = await UPDATE(ReviewCases).set({ status: transition.to, version: cds.utils.uuid() }).where(guard);
  if (affected !== 1) {
    const current = await SELECT.one.from(ReviewCases).columns('latestRun_ID').where({ ID: reviewCase.ID });
    if ('latestRun_ID' in guard && current && current.latestRun_ID !== basedOnRun) throw staleEvidence();
    throw new DecisionError(409, 'CONCURRENT_UPDATE', 'The review case changed in the meantime; reload and retry.');
  }

  await INSERT.into(DecisionEvents).entries({ reviewCase_ID: reviewCase.ID, action: transition.event,
    fromStatus: reviewCase.status, toStatus: transition.to, actor: userID, comment, at: now, basedOnRun_ID: basedOnRun,
    evidenceStatus, warningsAcknowledged });
  return { fromStatus: reviewCase.status, toStatus: transition.to };
}
