// M04 Slice 2a: review decision rules. Pure data + checks; persistence is in decide().
// Status changes happen only here, together with an insert-only DecisionEvents row,
// in the caller's transaction (cds.context.tx).
import cds from '@sap/cds';

export const COMMENT_MAX = 1000;

/** Allowed transitions per bound action. `independent`: the decider must not be the submitter. */
export const TRANSITIONS = Object.freeze({
  submitForReview: Object.freeze({ event: 'SUBMIT', from: Object.freeze(['OPEN']), to: 'IN_REVIEW', verb: 'submit', independent: false, commentRequired: false }),
  approve: Object.freeze({ event: 'APPROVE', from: Object.freeze(['IN_REVIEW']), to: 'APPROVED', verb: 'approve', independent: true, commentRequired: false }),
  reject: Object.freeze({ event: 'REJECT', from: Object.freeze(['IN_REVIEW']), to: 'REJECTED', verb: 'reject', independent: true, commentRequired: true }),
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
export async function decide({ caseID, transition, userID, plants, rawComment, now = new Date().toISOString() }) {
  const comment = normaliseComment(transition, rawComment);
  const { ReviewCases } = cds.entities('assemblyimpact');
  const reviewCase = await SELECT.one.from(ReviewCases).columns('ID', 'status', 'plant', 'version', 'createdBy')
    .where({ ID: caseID, plant: { in: plants } });
  if (!reviewCase) return null;

  if (!transition.from.includes(reviewCase.status)) {
    throw new DecisionError(409, 'INVALID_STATUS_TRANSITION', `Cannot ${transition.verb} a review case in status ${reviewCase.status}.`);
  }
  if (transition.independent && (await submitterOf(reviewCase)) === userID) {
    throw new DecisionError(403, 'SELF_DECISION_NOT_ALLOWED', 'A review case must be decided by someone other than its submitter.');
  }

  return applyTransition(reviewCase, transition, { userID, comment, now });
}

/**
 * Writes the status change and its DecisionEvents row for a case read earlier.
 * Compare-and-set on status and version: if a concurrent decision or impact run committed
 * after `reviewCase` was read, nothing is written and DecisionError 409 is thrown.
 */
export async function applyTransition(reviewCase, transition, { userID, comment, now }) {
  const { ReviewCases, DecisionEvents } = cds.entities('assemblyimpact');
  const affected = await UPDATE(ReviewCases).set({ status: transition.to, version: cds.utils.uuid() })
    .where({ ID: reviewCase.ID, status: reviewCase.status, version: reviewCase.version ?? null });
  if (affected !== 1) throw new DecisionError(409, 'CONCURRENT_UPDATE', 'The review case changed in the meantime; reload and retry.');

  await INSERT.into(DecisionEvents).entries({ reviewCase_ID: reviewCase.ID, action: transition.event,
    fromStatus: reviewCase.status, toStatus: transition.to, actor: userID, comment, at: now });
  return { fromStatus: reviewCase.status, toStatus: transition.to };
}
