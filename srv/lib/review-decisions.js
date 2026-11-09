// M04 Slice 2a: review decision rules. Pure data + checks; persistence is in decide().
// Status changes happen only here, together with an insert-only DecisionEvents row,
// in the caller's transaction (cds.context.tx).
import cds from '@sap/cds';

export const COMMENT_MAX = 1000;

/**
 * Allowed transitions per bound action. `independent`: the decider must not be the submitter.
 * `evidence` (Slice 2a.1): 'required' = the request must name the case's latest impact run;
 * 'optional' = a named run is validated and recorded, but may be omitted; 'none' = not applicable.
 */
export const TRANSITIONS = Object.freeze({
  submitForReview: Object.freeze({ event: 'SUBMIT', from: Object.freeze(['OPEN']), to: 'IN_REVIEW', verb: 'submit', independent: false, commentRequired: false, evidence: 'none' }),
  approve: Object.freeze({ event: 'APPROVE', from: Object.freeze(['IN_REVIEW']), to: 'APPROVED', verb: 'approve', independent: true, commentRequired: false, evidence: 'required' }),
  reject: Object.freeze({ event: 'REJECT', from: Object.freeze(['IN_REVIEW']), to: 'REJECTED', verb: 'reject', independent: true, commentRequired: true, evidence: 'optional' }),
});

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
  const { DecisionEvents } = cds.entities('assemblyimpact');
  const last = await SELECT.one.from(DecisionEvents).columns('actor')
    .where({ reviewCase_ID: reviewCase.ID, toStatus: 'IN_REVIEW' }).orderBy('at desc');
  return last?.actor ?? reviewCase.createdBy ?? null;
}

/**
 * Applies one transition. Returns null when the case is missing or outside the user's plants
 * (callers answer 404 for both). Throws DecisionError for rule violations.
 */
export async function decide({ caseID, transition, userID, plants, rawComment, basedOnRun: rawRun, acknowledgeWarnings = false, now = new Date().toISOString() }) {
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

  const { basedOnRun, acknowledgedFlags } = await checkEvidence(reviewCase, transition, rawRun, acknowledgeWarnings === true);
  return applyTransition(reviewCase, transition, { userID, comment, now, basedOnRun, acknowledgedFlags });
}

/**
 * Slice 2a.1: the run named by the reviewer must belong to this case and be its latest run.
 * Unknown runs and runs of other cases (including other plants) get the same answer.
 */
async function checkEvidence(reviewCase, transition, rawRun, acknowledged) {
  const none = { basedOnRun: null, acknowledgedFlags: null };
  if (transition.evidence === 'none') return none;
  const basedOnRun = rawRun || null;
  if (transition.evidence === 'required') {
    if (!reviewCase.latestRun_ID) throw new DecisionError(409, 'NO_EVIDENCE', `Cannot ${transition.verb} a review case without an impact run; run the impact calculation first.`);
    if (!basedOnRun) throw new DecisionError(400, 'EVIDENCE_REFERENCE_REQUIRED', `Name the impact run you evaluated (basedOnRun) to ${transition.verb} the case.`);
  }
  if (!basedOnRun) return none;
  const { ImpactRuns } = cds.entities('assemblyimpact');
  const run = await SELECT.one.from(ImpactRuns).columns('ID', 'status', 'flags').where({ ID: basedOnRun, reviewCase_ID: reviewCase.ID });
  if (!run) throw new DecisionError(400, 'UNKNOWN_EVIDENCE_RUN', 'The referenced impact run does not belong to this review case.');
  if (basedOnRun !== reviewCase.latestRun_ID) throw staleEvidence();
  // Slice 2b: approval is only possible on complete evidence; warnings need an explicit, audited acknowledgement.
  let acknowledgedFlags = null;
  if (transition.event === 'APPROVE') {
    if (run.status === 'INCOMPLETE') throw new DecisionError(409, 'EVIDENCE_INCOMPLETE', 'The evaluated impact run is incomplete (missing prices or stock); it cannot be approved. Complete the data and run the impact again, or reject the case.');
    if (run.status === 'COMPLETE_WITH_WARNINGS') {
      if (!acknowledged) throw new DecisionError(409, 'WARNINGS_NOT_ACKNOWLEDGED', `The evaluated impact run has warnings (${run.flags || 'see run'}); confirm "Acknowledge Warnings" to approve.`);
      acknowledgedFlags = run.flags || 'COMPLETE_WITH_WARNINGS';
    } else if (run.status !== 'COMPLETE') {
      throw new DecisionError(409, 'EVIDENCE_INCOMPLETE', `Impact run status ${run.status} cannot be approved.`);
    }
  }
  return { basedOnRun, acknowledgedFlags };
}

const staleEvidence = () => new DecisionError(409, 'STALE_EVIDENCE', 'The impact evidence changed since you reviewed it; reload the case and review the latest impact run.');

/**
 * Writes the status change and its DecisionEvents row for a case read earlier.
 * Compare-and-set on status and version (and, when evidence is named, on latestRun): if a
 * concurrent decision or impact run committed after `reviewCase` was read, nothing is written
 * and DecisionError 409 is thrown (STALE_EVIDENCE when the latest run moved).
 */
export async function applyTransition(reviewCase, transition, { userID, comment, now, basedOnRun = null, acknowledgedFlags = null }) {
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
    fromStatus: reviewCase.status, toStatus: transition.to, actor: userID, comment, at: now, basedOnRun_ID: basedOnRun, acknowledgedWarnings: acknowledgedFlags });
  return { fromStatus: reviewCase.status, toStatus: transition.to };
}
