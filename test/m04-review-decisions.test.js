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
const NO_RUN = stableId('m04-2a1:no-such-run');
const latestRunOf = async id => (await SELECT.one.from(cds.entities('assemblyimpact').ReviewCases, id).columns('latestRun_ID'))?.latestRun_ID;
// Slice 2a.1: approve names the evaluated run. Unless a test passes basedOnRun explicitly, the helper
// uses the case's current latest run (or a placeholder when none exists) so older tests keep their focus.
const act = async (id, action, user, body = {}) => {
  if (action === 'approve' && !('basedOnRun' in body)) body = { ...body, basedOnRun: (await latestRunOf(id)) ?? NO_RUN };
  return request(`/ReviewCases(${id})/EngineeringReview.${action}`, { method: 'POST', user, body });
};
const runFor = async (id, user = 'analyst') => {
  const r = await request(`/ReviewCases(${id})/EngineeringReview.runImpact`, { method: 'POST', user, body: { asOfDate: '2026-11-08' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.ID;
};
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
  const runA = await runFor(OPEN.A);
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
  assert.deepEqual(history.map(e => e.basedOnRun_ID), [null, runA], 'the approval records the evaluated run');
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
  await runFor(SEEDED_2000, 'analyst2');
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
  await runFor(OPEN.E);
  assert.equal((await act(OPEN.E, 'approve', 'approver')).status, 200, 'an independent approver may decide');
  await runFor(OPEN.D);
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
  await runFor(id);
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
  await runFor(id);
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
    e => e instanceof DecisionError && e.code === 'STALE_EVIDENCE');
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

// ---- Decision B: decided cases keep their evidence (no runImpact on APPROVED/REJECTED) ----
const { loadImpactInput, persistImpactRun, CaseDecidedError, fingerprint } = await import('../srv/lib/impact-persistence.js');
const AS_OF = '2026-11-08';
const snapshot = async id => {
  const { ReviewCases, ImpactRuns, Findings, ImpactMaterialLines } = cds.entities('assemblyimpact');
  const c = await SELECT.one.from(ReviewCases).columns('status', 'version', 'latestRun_ID').where({ ID: id });
  const runs = await SELECT.from(ImpactRuns).columns('ID').where({ reviewCase_ID: id });
  const runIds = runs.map(r => r.ID);
  const count = async E => (runIds.length ? (await SELECT.from(E).columns('ID').where({ run_ID: { in: runIds } })).length : 0);
  return { ...c, runs: runIds.length, findings: await count(Findings), lines: await count(ImpactMaterialLines), events: (await eventsOf(id)).length };
};
const newCase = async (key, status) => {
  const id = stableId(`m04-2a:b:${key}`);
  await INSERT.into(cds.entities('assemblyimpact').ReviewCases).entries({ ...SEEDED_1000, ID: id, caseNumber: `EC-T2B-${key}`, status, version: cds.utils.uuid() });
  return id;
};

test('runImpact is allowed on OPEN and IN_REVIEW cases', async () => {
  for (const status of ['OPEN', 'IN_REVIEW']) {
    const id = await newCase(`allowed-${status}`, status);
    const r = await act(id, 'runImpact', 'analyst', { asOfDate: AS_OF });
    assert.equal(r.status, 200, `${status}: ${JSON.stringify(r.data)}`);
    assert.equal(Number(r.data.costDeltaTotal), 1200);
    assert.equal(await statusOf(id), status, 'running impact never changes the review status');
  }
});

test('runImpact on APPROVED or REJECTED returns 409 and changes nothing', async () => {
  for (const [id, decision, comment] of [[await newCase('approved', 'OPEN'), 'approve', 'ok'], [await newCase('rejected', 'OPEN'), 'reject', 'no']]) {
    assert.equal((await act(id, 'runImpact', 'analyst', { asOfDate: AS_OF })).status, 200, 'evidence before the decision');
    assert.equal((await act(id, 'submitForReview', 'analyst')).status, 200);
    assert.equal((await act(id, decision, 'approver', { comment })).status, 200);
    const before = await snapshot(id);
    const r = await act(id, 'runImpact', 'analyst', { asOfDate: AS_OF });
    assert.equal(r.status, 409, `${before.status}: ${JSON.stringify(r.data)}`);
    assert.equal(errorCode(r), 'CASE_ALREADY_DECIDED');
    assert.match(r.data.error.message, new RegExp(`status ${before.status}`));
    assert.deepEqual(await snapshot(id), before, 'status, version, latestRun, runs, findings, lines and history unchanged');
    // Existing role and plant rules still take precedence over the state rule.
    assert.equal((await act(id, 'runImpact', 'cviewer', { asOfDate: AS_OF })).status, 403);
    assert.equal((await act(id, 'runImpact', 'analyst2', { asOfDate: AS_OF })).status, 404);
    assert.deepEqual(await snapshot(id), before);
  }
});

test('a decision committed during a calculation: the run is refused and rolled back (CaseDecidedError)', async () => {
  const id = await newCase('race-run', 'OPEN');
  assert.equal((await act(id, 'submitForReview', 'analyst')).status, 200);
  await runFor(id); // evidence the approver evaluates
  // The calculation reads its inputs before the approval commits ...
  const loaded = await cds.tx(() => loadImpactInput(id, ['1000'], AS_OF));
  const { calculateImpact, RULESET } = await import('../srv/lib/impact-calculator.js');
  const result = calculateImpact(loaded.input);
  assert.equal((await act(id, 'approve', 'approver', { comment: 'decided on the current evidence' })).status, 200);
  const before = await snapshot(id);
  // ... and tries to persist afterwards.
  await assert.rejects(cds.tx(() => persistImpactRun(loaded.reviewCase, result,
    { fingerprint: fingerprint(RULESET, loaded.input), user: 'analyst', now: new Date().toISOString() })),
  e => e instanceof CaseDecidedError && e.caseStatus === 'APPROVED');
  assert.deepEqual(await snapshot(id), before, 'no run, finding or line from the late calculation; latestRun unchanged');
});

test('a calculation committed during a decision: the stale decision is refused (CONCURRENT_UPDATE)', async () => {
  const id = await newCase('race-decision', 'OPEN');
  assert.equal((await act(id, 'submitForReview', 'analyst')).status, 200);
  const stale = await SELECT.one.from(cds.entities('assemblyimpact').ReviewCases).columns('ID', 'status', 'version').where({ ID: id });
  assert.equal((await act(id, 'runImpact', 'analyst', { asOfDate: AS_OF })).status, 200, 'new evidence arrives');
  const before = await snapshot(id);
  await assert.rejects(cds.tx(() => applyTransition(stale, TRANSITIONS.approve, { userID: 'approver', comment: null, now: new Date().toISOString() })),
    e => e instanceof DecisionError && e.code === 'STALE_EVIDENCE');
  assert.deepEqual(await snapshot(id), before, 'an approval based on older evidence is not recorded');
});

test('parallel runImpact and approve on the evaluated run: exactly one wins and the rows match', async () => {
  const id = await newCase('parallel', 'OPEN');
  assert.equal((await act(id, 'submitForReview', 'analyst')).status, 200);
  const evaluated = await runFor(id);
  const [run, decision] = await Promise.all([act(id, 'runImpact', 'analyst', { asOfDate: AS_OF }),
    act(id, 'approve', 'approver', { comment: 'parallel', basedOnRun: evaluated })]);
  assert.deepEqual([run.status, decision.status].sort(), [200, 409], JSON.stringify([run.data, decision.data]));
  const after = await snapshot(id);
  if (decision.status === 200) {
    assert.equal(errorCode(run), 'CASE_ALREADY_DECIDED');
    assert.deepEqual([after.status, after.runs, after.latestRun_ID], ['APPROVED', 1, evaluated], 'approved on exactly the evaluated run');
  } else {
    assert.equal(errorCode(decision), 'STALE_EVIDENCE');
    assert.deepEqual([after.status, after.runs], ['IN_REVIEW', 2], 'the newer run stands; the stale approval is not recorded');
  }
  assert.equal(after.events, decision.status === 200 ? 2 : 1);
});

test('guard layers: the state check runs before any calculation, and the database guard checks status itself', async () => {
  const { ReviewCases } = cds.entities('assemblyimpact');
  // 1. Handler pre-check: a decided case with invalid inputs answers 409, not the calculator's 422.
  const decided = await newCase('precheck', 'APPROVED');
  await UPDATE(ReviewCases).set({ productionQuantity: 0 }).where({ ID: decided });
  const r = await act(decided, 'runImpact', 'analyst', { asOfDate: AS_OF });
  assert.equal(r.status, 409);
  assert.equal(errorCode(r), 'CASE_ALREADY_DECIDED');
  // 2. Database guard: a status change that did not move the version (out-of-band edit) still blocks the write.
  const id = await newCase('db-guard', 'IN_REVIEW');
  const loaded = await cds.tx(() => loadImpactInput(id, ['1000'], AS_OF));
  const { calculateImpact, RULESET } = await import('../srv/lib/impact-calculator.js');
  const result = calculateImpact(loaded.input);
  await UPDATE(ReviewCases).set({ status: 'REJECTED' }).where({ ID: id }); // version deliberately unchanged
  const before = await snapshot(id);
  await assert.rejects(cds.tx(() => persistImpactRun(loaded.reviewCase, result,
    { fingerprint: fingerprint(RULESET, loaded.input), user: 'analyst', now: new Date().toISOString() })),
  e => e instanceof CaseDecidedError && e.caseStatus === 'REJECTED');
  assert.deepEqual(await snapshot(id), before);
});

// ---- Slice 2a.1: evidence freshness (basedOnRun) ----
test('approve requires an evaluated impact run: missing reference 400, no run at all 409 NO_EVIDENCE', async () => {
  const id = await newCase('ev-none', 'OPEN');
  assert.equal((await act(id, 'submitForReview', 'analyst')).status, 200);
  const missing = await request(`/ReviewCases(${id})/EngineeringReview.approve`, { method: 'POST', user: 'approver', body: { comment: 'x' } });
  assert.equal(missing.status, 400, JSON.stringify(missing.data));
  assert(['ASSERT_MANDATORY', 'EVIDENCE_REFERENCE_REQUIRED'].includes(errorCode(missing)), errorCode(missing));
  const noRun = await act(id, 'approve', 'approver', { basedOnRun: NO_RUN });
  assert.equal(noRun.status, 409);
  assert.equal(errorCode(noRun), 'NO_EVIDENCE');
  assert.deepEqual([await statusOf(id), (await eventsOf(id)).length], ['IN_REVIEW', 1]);
  // With a run but without a reference, the request is refused as well.
  await runFor(id);
  const noRef = await request(`/ReviewCases(${id})/EngineeringReview.approve`, { method: 'POST', user: 'approver', body: { comment: 'x' } });
  assert.equal(noRef.status, 400);
  assert(['ASSERT_MANDATORY', 'EVIDENCE_REFERENCE_REQUIRED'].includes(errorCode(noRef)), errorCode(noRef));
  assert.equal(await statusOf(id), 'IN_REVIEW');
});

test('approve refuses runs of other cases, other plants or unknown runs with the same 400', async () => {
  const id = await newCase('ev-foreign', 'OPEN');
  assert.equal((await act(id, 'submitForReview', 'analyst')).status, 200);
  await runFor(id);
  const other = await newCase('ev-other', 'OPEN');
  const otherRun = await runFor(other);
  // Plant-2000 run created earlier (that case is approved now, so its evidence is frozen).
  const foreignRun = (await SELECT.one.from(cds.entities('assemblyimpact').ImpactRuns).columns('ID').where({ reviewCase_ID: SEEDED_2000 })).ID;
  const before = await snapshot(id);
  for (const basedOnRun of [otherRun, foreignRun, stableId('m04-2a1:random')]) {
    const r = await act(id, 'approve', 'approver', { basedOnRun });
    assert.equal(r.status, 400, basedOnRun);
    assert.equal(errorCode(r), 'UNKNOWN_EVIDENCE_RUN');
  }
  assert.deepEqual(await snapshot(id), before);
});

test('stale evidence: approving an older run returns 409 STALE_EVIDENCE; the latest run is approved and recorded', async () => {
  const id = await newCase('ev-stale', 'OPEN');
  assert.equal((await act(id, 'submitForReview', 'analyst')).status, 200);
  const runA = await runFor(id); // the reviewer opens the case and evaluates run A
  const runB = await runFor(id); // another engineer recalculates
  const before = await snapshot(id);
  const stale = await act(id, 'approve', 'approver', { comment: 'looked at A', basedOnRun: runA });
  assert.equal(stale.status, 409);
  assert.equal(errorCode(stale), 'STALE_EVIDENCE');
  assert.deepEqual(await snapshot(id), before, 'nothing written for the stale approval');
  const ok = await act(id, 'approve', 'approver', { comment: 'looked at B', basedOnRun: runB });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const event = (await request(`/ReviewCases(${id})/decisions?$filter=action eq 'APPROVE'&$expand=basedOnRun($select=ID,costDeltaTotal)`, { user: 'cviewer' })).data.value[0];
  assert.equal(event.basedOnRun_ID, runB);
  assert.equal(event.basedOnRun.ID, runB);
  assert.equal(Number(event.basedOnRun.costDeltaTotal), 1200, 'the evaluated figures stay reachable from the decision');
});

test('reject: run reference optional; when given it must be the latest run and is recorded', async () => {
  const noEvidence = await newCase('rej-none', 'OPEN');
  assert.equal((await act(noEvidence, 'submitForReview', 'analyst')).status, 200);
  const r1 = await act(noEvidence, 'reject', 'approver', { comment: 'no impact calculation possible yet' });
  assert.equal(r1.status, 200, 'rejection does not require an impact run');
  assert.equal((await eventsOf(noEvidence)).at(-1).basedOnRun_ID, null);

  const id = await newCase('rej-stale', 'OPEN');
  assert.equal((await act(id, 'submitForReview', 'analyst')).status, 200);
  const runA = await runFor(id);
  const runB = await runFor(id);
  const stale = await act(id, 'reject', 'approver', { comment: 'x', basedOnRun: runA });
  assert.equal(errorCode(stale), 'STALE_EVIDENCE');
  assert.equal(await statusOf(id), 'IN_REVIEW');
  assert.equal((await act(id, 'reject', 'approver', { comment: 'B shows a shortage', basedOnRun: runB })).status, 200);
  assert.equal((await eventsOf(id)).at(-1).basedOnRun_ID, runB);
});

// ---- Slice 2b: evidence quality rules for approval, and per-user action flags ----
test('approval refuses INCOMPLETE evidence; rejection stays possible', async () => {
  const { CostPrices } = cds.entities('assemblyimpact');
  const id = await newCase('ev-incomplete', 'OPEN');
  assert.equal((await act(id, 'submitForReview', 'analyst')).status, 200);
  const price = await SELECT.one.from(CostPrices).where({ material: 'FAN-B', plant: '1000' });
  await DELETE.from(CostPrices).where({ ID: price.ID }); // a missing price makes the cost INCOMPLETE
  try {
    const run = await act(id, 'runImpact', 'analyst', { asOfDate: AS_OF });
    assert.equal(run.data.status, 'INCOMPLETE');
    const before = await snapshot(id);
    const r = await act(id, 'approve', 'approver', { basedOnRun: run.data.ID });
    assert.equal(r.status, 409);
    assert.equal(errorCode(r), 'EVIDENCE_INCOMPLETE');
    assert.deepEqual(await snapshot(id), before);
    assert.equal((await act(id, 'reject', 'approver', { comment: 'price data missing', basedOnRun: run.data.ID })).status, 200);
  } finally {
    await INSERT.into(CostPrices).entries(price);
  }
});

test('COMPLETE_WITH_WARNINGS needs an explicit acknowledgement, which is audited', async () => {
  const id = await newCase('ev-warn', 'OPEN');
  assert.equal((await act(id, 'submitForReview', 'analyst')).status, 200);
  const run = await act(id, 'runImpact', 'analyst', { asOfDate: '2026-11-30' }); // stock snapshot older than allowed
  assert.equal(run.data.status, 'COMPLETE_WITH_WARNINGS');
  for (const acknowledgeWarnings of [undefined, false]) {
    const r = await act(id, 'approve', 'approver', { basedOnRun: run.data.ID, acknowledgeWarnings });
    assert.equal(errorCode(r), 'WARNINGS_NOT_ACKNOWLEDGED', String(acknowledgeWarnings));
  }
  assert.equal(await statusOf(id), 'IN_REVIEW');
  const ok = await act(id, 'approve', 'approver', { basedOnRun: run.data.ID, acknowledgeWarnings: true, comment: 'stock re-checked by phone' });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const e = (await eventsOf(id)).at(-1);
  assert.deepEqual([e.action, e.basedOnRun_ID, e.acknowledgedWarnings], ['APPROVE', run.data.ID, 'STOCK_STALE']);
  // A COMPLETE run records no acknowledgement even if the flag is sent.
  const id2 = await newCase('ev-complete', 'OPEN');
  assert.equal((await act(id2, 'submitForReview', 'analyst')).status, 200);
  await runFor(id2);
  assert.equal((await act(id2, 'approve', 'approver', { acknowledgeWarnings: true })).status, 200);
  assert.equal((await eventsOf(id2)).at(-1).acknowledgedWarnings, null);
});

test('per-user action flags follow role and status (UI hints only)', async () => {
  const id = await newCase('flags', 'OPEN');
  const flags = async user => {
    const r = await request(`/ReviewCases(${id})?$select=status,canSubmit,canDecide,canRunImpact`, { user });
    return [r.data.canSubmit, r.data.canDecide, r.data.canRunImpact];
  };
  assert.deepEqual(await flags('analyst'), [true, false, true]);
  assert.deepEqual(await flags('approver'), [false, false, false]);
  assert.deepEqual(await flags('cviewer'), [false, false, false]);
  assert.equal((await act(id, 'submitForReview', 'analyst')).status, 200);
  assert.deepEqual(await flags('analyst'), [false, false, true]);
  assert.deepEqual(await flags('approver'), [false, true, false]);
  await runFor(id);
  assert.equal((await act(id, 'approve', 'approver')).status, 200);
  for (const user of ['analyst', 'approver', 'dual']) assert.deepEqual(await flags(user), [false, false, false], `${user}: decided case is read-only`);
  const list = await request(`/ReviewCases?$select=ID,status,canDecide&$filter=status eq 'IN_REVIEW'`, { user: 'approver' });
  assert(list.data.value.every(c => c.canDecide === true), 'collection reads get the flags too');
});
