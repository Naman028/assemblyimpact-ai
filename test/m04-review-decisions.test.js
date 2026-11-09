// M04 Slice 2a: backend review decisions — submitForReview / approve / reject, insert-only
// DecisionEvents, ChangeApprover role, plant isolation, no self-decision, rejection comment.
// Runs against the committed synthetic seed (test/data) plus OPEN copies of EC-000473.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { before, after, test } from 'node:test';
import { buildSeed } from './m04-seed.js';
import { stableId } from './m04-fixtures.js';

process.env.CDS_ENV = 'test';
process.env.CDS_CONFIG = JSON.stringify({ requires: { db: { data: ['db/data', 'db/csv', 'test/data'] } } });
const { default: cds } = await import('@sap/cds');
const { applyTransition, normaliseComment, DecisionError, TRANSITIONS } = await import('../srv/lib/review-decisions.js');
const seed = buildSeed();
const SEEDED_1000 = seed.ReviewCases.find(c => c.caseNumber === 'EC-000473');
const SEEDED_2000 = seed.ReviewCases.find(c => c.caseNumber === 'EC-200473').ID;
// OPEN test copies of the plant-1000 case (synthetic, test-only, never committed as seed data).
const OPEN = Object.fromEntries(['A', 'B', 'C', 'D', 'E', 'F'].map(k => [k, stableId(`m04-2a:open:${k}`)]));
let server, base;

const request = async (path, { user = 'analyst', method = 'GET', body } = {}) => {
  const response = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(user ? { authorization: `Basic ${Buffer.from(`${user}:test`).toString('base64')}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = text;
  try { data = JSON.parse(text); } catch { /* non-JSON body */ }
  return { status: response.status, data, headers: response.headers };
};
const act = (id, action, user, body = {}) => request(`/ReviewCases(${id})/EngineeringReview.${action}`, { method: 'POST', user, body });
const statusOf = async id => (await SELECT.one.from(cds.entities('assemblyimpact').ReviewCases, id).columns('status')).status;
const eventsOf = id => SELECT.from(cds.entities('assemblyimpact').DecisionEvents).where({ reviewCase_ID: id }).orderBy('at', 'action');
const errorCode = r => r.data?.error?.code;

before(async () => {
  server = await cds.server({ port: 0, in_memory: true });
  if (!server.listening) await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}/odata/v4/engineering-review`;
  const { ReviewCases } = cds.entities('assemblyimpact');
  await INSERT.into(ReviewCases).entries(Object.entries(OPEN).map(([k, ID]) => ({ ...SEEDED_1000, ID,
    caseNumber: `EC-T2A-${k}`, title: `${SEEDED_1000.title} [SYNTHETIC test copy ${k}]`, status: 'OPEN', version: cds.utils.uuid() })));
});
after(async () => {
  if (server) await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  await cds.db?.disconnect();
});

test('metadata: three bound actions, read-only DecisionEvents, decisions navigation, no version token', async () => {
  const metadata = await request('/$metadata', { user: 'cviewer' });
  assert.equal(metadata.status, 200);
  for (const action of ['submitForReview', 'approve', 'reject'])
    assert.match(metadata.data, new RegExp(`Action Name="${action}" IsBound="true"`), action);
  const reviewCase = metadata.data.match(/<EntityType Name="ReviewCases">[\s\S]*?<\/EntityType>/)[0];
  assert.match(reviewCase, /NavigationProperty Name="decisions" Type="Collection\(EngineeringReview.DecisionEvents\)"/);
  assert.doesNotMatch(reviewCase, /Property Name="version"/, 'concurrency token stays internal');
  assert.match(metadata.data, /<EntitySet Name="DecisionEvents"/);
  // Insert-only history: no client may create, change or delete decision events.
  for (const user of ['analyst', 'approver', 'dual']) {
    assert([403, 405].includes((await request('/DecisionEvents', { method: 'POST', user, body: { action: 'APPROVE' } })).status), user);
  }
});

test('happy path: analyst submits, a different approver approves; status and history persist', async () => {
  const submitted = await act(OPEN.A, 'submitForReview', 'analyst', { comment: '  ready for review  ' });
  assert.equal(submitted.status, 200, JSON.stringify(submitted.data));
  assert.equal(submitted.data.status, 'IN_REVIEW');
  assert.match(submitted.headers.get('sap-messages') ?? '', /status changed from OPEN to IN_REVIEW/);
  const approved = await act(OPEN.A, 'approve', 'approver', { comment: 'Cost delta and instruction finding accepted.' });
  assert.equal(approved.status, 200, JSON.stringify(approved.data));
  assert.equal(approved.data.status, 'APPROVED');
  // Independent re-read through the service and the database.
  assert.equal((await request(`/ReviewCases(${OPEN.A})`, { user: 'cviewer' })).data.status, 'APPROVED');
  assert.equal(await statusOf(OPEN.A), 'APPROVED');
  const history = (await request(`/ReviewCases(${OPEN.A})/decisions?$orderby=at`, { user: 'cviewer' })).data.value;
  assert.deepEqual(history.map(e => [e.action, e.fromStatus, e.toStatus, e.actor, e.comment]), [
    ['SUBMIT', 'OPEN', 'IN_REVIEW', 'analyst', 'ready for review'],
    ['APPROVE', 'IN_REVIEW', 'APPROVED', 'approver', 'Cost delta and instruction finding accepted.'],
  ]);
  assert(history.every(e => !Number.isNaN(Date.parse(e.at))));
});

test('seeded demonstration cases start OPEN without history; submission creates a genuine SUBMIT event', async () => {
  for (const [id, user] of [[SEEDED_1000.ID, 'cviewer'], [SEEDED_2000, 'cviewer2']]) {
    const c = await request(`/ReviewCases(${id})?$expand=decisions`, { user });
    assert.equal(c.status, 200);
    assert.equal(c.data.status, 'OPEN');
    assert.deepEqual(c.data.decisions, [], 'no seeded or fabricated decision events');
  }
  assert.equal(SEEDED_1000.status, 'OPEN', 'seed builder output matches the committed CSV status');
  // An approver cannot short-cut the review of a seeded case.
  assert.equal(errorCode(await act(SEEDED_1000.ID, 'approve', 'approver')), 'INVALID_STATUS_TRANSITION');
  assert.equal((await act(SEEDED_1000.ID, 'submitForReview', 'analyst', { comment: 'seeded demo case submitted' })).status, 200);
  const events = (await request(`/ReviewCases(${SEEDED_1000.ID})/decisions`, { user: 'cviewer' })).data.value;
  assert.deepEqual(events.map(e => [e.action, e.fromStatus, e.toStatus, e.actor]), [['SUBMIT', 'OPEN', 'IN_REVIEW', 'analyst']]);
  // The submitter is now recorded, so the no-self-decision rule has a real actor to compare against.
  assert.equal(errorCode(await act(SEEDED_1000.ID, 'submitForReview', 'analyst')), 'INVALID_STATUS_TRANSITION', 'no double submission');
});

test('reject requires a non-blank comment; a refused attempt changes nothing', async () => {
  assert.equal((await act(OPEN.B, 'submitForReview', 'analyst')).status, 200);
  for (const body of [{}, { comment: '' }, { comment: '   ' }, { comment: null }]) {
    const r = await act(OPEN.B, 'reject', 'approver', body);
    assert.equal(r.status, 400, JSON.stringify(body));
    // Empty/missing values are caught by CAP's @mandatory check, blank text by the handler rule.
    assert(['ASSERT_MANDATORY', 'REJECTION_COMMENT_REQUIRED'].includes(errorCode(r)), `${JSON.stringify(body)} -> ${errorCode(r)}`);
  }
  assert.equal(await statusOf(OPEN.B), 'IN_REVIEW');
  assert.equal((await eventsOf(OPEN.B)).length, 1, 'only the SUBMIT event');
  const rejected = await act(OPEN.B, 'reject', 'approver', { comment: ' Instruction WI-COOL-100 v1 must be revised first. ' });
  assert.equal(rejected.status, 200, JSON.stringify(rejected.data));
  assert.equal(rejected.data.status, 'REJECTED');
  const last = (await eventsOf(OPEN.B)).at(-1);
  assert.deepEqual([last.action, last.fromStatus, last.toStatus, last.actor, last.comment],
    ['REJECT', 'IN_REVIEW', 'REJECTED', 'approver', 'Instruction WI-COOL-100 v1 must be revised first.']);
});

test('invalid status transitions return 409 and write nothing', async () => {
  // OPEN.C is OPEN; OPEN.A is APPROVED and OPEN.B is REJECTED from the previous tests.
  const cases = [
    [OPEN.C, 'approve', 'approver', { comment: 'x' }], [OPEN.C, 'reject', 'approver', { comment: 'x' }],
    [OPEN.A, 'approve', 'approver', { comment: 'x' }], [OPEN.A, 'reject', 'approver', { comment: 'x' }], [OPEN.A, 'submitForReview', 'analyst', {}],
    [OPEN.B, 'approve', 'approver', { comment: 'x' }], [OPEN.B, 'submitForReview', 'analyst', {}],
    [SEEDED_1000.ID, 'submitForReview', 'analyst', {}],
  ];
  for (const [id, action, user, body] of cases) {
    const statusBefore = await statusOf(id);
    const eventsBefore = (await eventsOf(id)).length;
    const r = await act(id, action, user, body);
    assert.equal(r.status, 409, `${action} on ${statusBefore}`);
    assert.equal(errorCode(r), 'INVALID_STATUS_TRANSITION');
    assert.equal(await statusOf(id), statusBefore);
    assert.equal((await eventsOf(id)).length, eventsBefore);
  }
});

test('authorization: roles, plants, malformed memberships; foreign cases look missing', async () => {
  const id = OPEN.D;
  assert.equal((await act(id, 'submitForReview', null)).status, 401);
  for (const user of ['cviewer', 'approver', 'maintainer']) assert.equal((await act(id, 'submitForReview', user)).status, 403, `${user} may not submit`);
  assert.equal((await act(id, 'submitForReview', 'analyst2')).status, 404, 'foreign plant masked as not found');
  assert.equal((await act(stableId('m04-2a:missing'), 'submitForReview', 'analyst')).status, 404);
  assert.equal((await act(id, 'submitForReview', 'analyst')).status, 200);
  for (const user of ['cviewer', 'analyst', 'maintainer']) {
    assert.equal((await act(id, 'approve', user)).status, 403, `${user} may not approve`);
    assert.equal((await act(id, 'reject', user, { comment: 'x' })).status, 403, `${user} may not reject`);
  }
  assert.equal((await act(id, 'approve', 'approver2')).status, 404, 'plant-2000 approver cannot decide a plant-1000 case');
  assert.equal((await act(SEEDED_2000, 'approve', 'approver')).status, 404, 'plant-1000 approver cannot decide a plant-2000 case');
  for (const user of ['cbad', 'cwild']) assert.equal((await act(id, 'submitForReview', user)).status, 403, user);
  assert.equal(await statusOf(id), 'IN_REVIEW', 'no refused call changed the case');
  assert.equal((await eventsOf(id)).length, 1);
});

test('plant isolation of the decision history: collection, key, $count and $expand', async () => {
  assert.equal((await act(SEEDED_2000, 'submitForReview', 'analyst2')).status, 200);
  assert.equal((await act(SEEDED_2000, 'approve', 'approver2', { comment: 'plant 2000 decision' })).status, 200);
  const own = await request('/DecisionEvents?$count=true', { user: 'cviewer' });
  const foreign = await request('/DecisionEvents?$count=true', { user: 'cviewer2' });
  assert.equal(own.status, 200);
  assert(own.data.value.length > 0);
  assert.equal(own.data['@odata.count'], own.data.value.length);
  const ownIds = new Set(own.data.value.map(e => e.ID));
  assert.equal(foreign.data.value.length, 2, 'plant-2000 viewer sees only the plant-2000 SUBMIT and APPROVE events');
  assert(foreign.data.value.every(e => !ownIds.has(e.ID)));
  assert.equal((await request(`/DecisionEvents(${own.data.value[0].ID})`, { user: 'cviewer2' })).status, 404);
  const expanded = await request('/ReviewCases?$expand=decisions', { user: 'cviewer2' });
  assert(expanded.data.value.every(c => c.plant === '2000' && c.decisions.every(e => !ownIds.has(e.ID))));
  // Approvers read the evidence they decide on, but only in their plants.
  assert.equal((await request(`/ReviewCases(${OPEN.D})/runs`, { user: 'approver' })).status, 200);
  assert.equal((await request(`/ReviewCases(${OPEN.D})`, { user: 'approver2' })).status, 404);
});

test('no self-decision: the submitter cannot approve or reject, even with both roles', async () => {
  assert.equal((await act(OPEN.E, 'submitForReview', 'dual')).status, 200);
  const selfApprove = await act(OPEN.E, 'approve', 'dual', { comment: 'own case' });
  assert.equal(selfApprove.status, 403);
  assert.equal(errorCode(selfApprove), 'SELF_DECISION_NOT_ALLOWED');
  assert.equal(errorCode(await act(OPEN.E, 'reject', 'dual', { comment: 'own case' })), 'SELF_DECISION_NOT_ALLOWED');
  assert.equal(await statusOf(OPEN.E), 'IN_REVIEW');
  assert.equal((await act(OPEN.E, 'approve', 'approver')).status, 200, 'an independent approver may decide');
  // A dual-role user may decide a case someone else submitted.
  assert.equal((await act(OPEN.D, 'approve', 'dual')).status, 200);
});

test('comment validation: length limit and type', async () => {
  assert.equal((await act(OPEN.F, 'submitForReview', 'analyst')).status, 200);
  assert.equal((await act(OPEN.F, 'reject', 'approver', { comment: 'x'.repeat(1001) })).status, 400);
  assert.equal((await act(OPEN.F, 'reject', 'approver', { comment: 42 })).status, 400);
  assert.equal(await statusOf(OPEN.F), 'IN_REVIEW');
  assert.equal((await act(OPEN.F, 'reject', 'approver', { comment: 'y'.repeat(1000) })).status, 200, 'exactly 1000 characters is allowed');
});

test('concurrent decisions: exactly one wins, the other gets 409, one event is written', async () => {
  const { ReviewCases } = cds.entities('assemblyimpact');
  const id = stableId('m04-2a:race');
  await INSERT.into(ReviewCases).entries({ ...SEEDED_1000, ID: id, caseNumber: 'EC-T2A-RACE', status: 'IN_REVIEW', version: cds.utils.uuid() });
  const results = await Promise.all([act(id, 'approve', 'approver', { comment: 'first' }), act(id, 'reject', 'dual', { comment: 'second' })]);
  const statuses = results.map(r => r.status).sort();
  assert.deepEqual(statuses, [200, 409], JSON.stringify(results.map(r => r.data)));
  assert.equal((await eventsOf(id)).length, 1);
  assert(['APPROVED', 'REJECTED'].includes(await statusOf(id)));
});

test('stale read: the database-level compare-and-set refuses the write and rolls back', async () => {
  const { ReviewCases } = cds.entities('assemblyimpact');
  const id = stableId('m04-2a:stale');
  await INSERT.into(ReviewCases).entries({ ...SEEDED_1000, ID: id, caseNumber: 'EC-T2A-STALE', status: 'IN_REVIEW', version: cds.utils.uuid() });
  const stale = await SELECT.one.from(ReviewCases).columns('ID', 'status', 'version').where({ ID: id });
  assert.equal((await act(id, 'approve', 'approver', { comment: 'committed first' })).status, 200);
  await assert.rejects(
    cds.tx(() => applyTransition(stale, TRANSITIONS.reject, { userID: 'approver', comment: 'stale', now: new Date().toISOString() })),
    e => e instanceof DecisionError && e.status === 409 && e.code === 'CONCURRENT_UPDATE');
  assert.equal(await statusOf(id), 'APPROVED');
  assert.deepEqual((await eventsOf(id)).map(e => e.action), ['APPROVE'], 'no event from the stale attempt');
});

test('stale read after an impact run: same status, new version — the write is still refused', async () => {
  const { ReviewCases } = cds.entities('assemblyimpact');
  const id = stableId('m04-2a:stale-run');
  await INSERT.into(ReviewCases).entries({ ...SEEDED_1000, ID: id, caseNumber: 'EC-T2A-STALE2', status: 'IN_REVIEW', version: cds.utils.uuid() });
  const stale = await SELECT.one.from(ReviewCases).columns('ID', 'status', 'version').where({ ID: id });
  const runResult = await act(id, 'runImpact', 'analyst', { asOfDate: '2026-11-08' });
  assert.equal(runResult.status, 200, 'an impact run commits after the stale read');
  assert.equal(await statusOf(id), 'IN_REVIEW', 'status unchanged, only the version moved');
  await assert.rejects(
    cds.tx(() => applyTransition(stale, TRANSITIONS.approve, { userID: 'approver', comment: null, now: new Date().toISOString() })),
    e => e instanceof DecisionError && e.code === 'CONCURRENT_UPDATE');
  assert.equal(await statusOf(id), 'IN_REVIEW');
  assert.equal((await eventsOf(id)).length, 0);
});

test('rule unit: rejection comment is required independently of the OData @mandatory check', () => {
  for (const raw of [undefined, null, '', '   ', '\n\t'])
    assert.throws(() => normaliseComment(TRANSITIONS.reject, raw), e => e.code === 'REJECTION_COMMENT_REQUIRED', JSON.stringify(raw));
  assert.equal(normaliseComment(TRANSITIONS.reject, '  reason  '), 'reason');
  assert.equal(normaliseComment(TRANSITIONS.approve, '   '), null, 'approval comment stays optional');
  assert.throws(() => normaliseComment(TRANSITIONS.approve, 'x'.repeat(1001)), e => e.code === 'COMMENT_TOO_LONG');
  assert.throws(() => normaliseComment(TRANSITIONS.approve, 5), e => e.code === 'INVALID_COMMENT');
});
