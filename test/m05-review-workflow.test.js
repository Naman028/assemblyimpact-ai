// M05 Deliverable A: approval evidence policy by impact-run status and per-user action availability.
// INCOMPLETE runs can never be approved; COMPLETE_WITH_WARNINGS needs an explicit, audited
// acknowledgement; COMPLETE behaves as before. Runs on OPEN synthetic copies of EC-000473.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { before, after, test } from 'node:test';
import { buildSeed } from './m04-seed.js';
import { stableId } from './m04-fixtures.js';

process.env.CDS_ENV = 'test';
process.env.CDS_CONFIG = JSON.stringify({ requires: { db: { data: ['db/data', 'db/csv', 'test/data'] } } });
const { default: cds } = await import('@sap/cds');
const seed = buildSeed();
const SEEDED = seed.ReviewCases.find(c => c.caseNumber === 'EC-000473');
const COPY = Object.fromEntries(['INC', 'WARN', 'WARN2', 'OK', 'AVAIL'].map(k => [k, stableId(`m05-a:open:${k}`)]));
let server, base;

const request = async (path, { user = 'analyst', method = 'GET', body } = {}) => {
  const response = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Basic ${Buffer.from(`${user}:test`).toString('base64')}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = text;
  try { data = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: response.status, data };
};
const act = (id, action, user, body = {}) => request(`/ReviewCases(${id})/EngineeringReview.${action}`, { method: 'POST', user, body });
const run = async (id, asOfDate) => {
  const r = await act(id, 'runImpact', 'analyst', { asOfDate });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
};
const eventsOf = id => SELECT.from(cds.entities('assemblyimpact').DecisionEvents).where({ reviewCase_ID: id }).orderBy('at');
const statusOf = async id => (await SELECT.one.from(cds.entities('assemblyimpact').ReviewCases, id).columns('status')).status;

before(async () => {
  server = await cds.server({ port: 0, in_memory: true });
  if (!server.listening) await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}/odata/v4/engineering-review`;
  const { ReviewCases } = cds.entities('assemblyimpact');
  await INSERT.into(ReviewCases).entries(Object.entries(COPY).map(([k, ID]) => ({ ...SEEDED, ID,
    caseNumber: `EC-T5A-${k}`, title: `${SEEDED.title} [SYNTHETIC test copy ${k}]`, status: 'OPEN', version: cds.utils.uuid() })));
});
after(async () => {
  if (server) await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  await cds.db?.disconnect();
});

test('INCOMPLETE evidence: approval is refused with 409 EVIDENCE_INCOMPLETE and nothing is written', async () => {
  // Before every synthetic price validity (2026-01-01): MISSING_PRICE -> INCOMPLETE.
  const evaluated = await run(COPY.INC, '2025-12-31');
  assert.equal(evaluated.status, 'INCOMPLETE');
  assert.equal((await act(COPY.INC, 'submitForReview', 'analyst')).status, 200);
  for (const acknowledgeWarnings of [undefined, true]) {
    const r = await act(COPY.INC, 'approve', 'approver', { basedOnRun: evaluated.ID, acknowledgeWarnings });
    assert.equal(r.status, 409, JSON.stringify(r.data));
    assert.equal(r.data.error.code, 'EVIDENCE_INCOMPLETE');
  }
  assert.equal(await statusOf(COPY.INC), 'IN_REVIEW');
  assert.deepEqual((await eventsOf(COPY.INC)).map(e => e.action), ['SUBMIT']);
  // Rejection on incomplete evidence stays possible (it is the safe outcome) and records the run status.
  const rejected = await act(COPY.INC, 'reject', 'approver', { comment: 'Prices missing', basedOnRun: evaluated.ID });
  assert.equal(rejected.status, 200, JSON.stringify(rejected.data));
  const last = (await eventsOf(COPY.INC)).at(-1);
  assert.equal(last.evidenceStatus, 'INCOMPLETE');
  assert.equal(last.warningsAcknowledged, null);
});

test('COMPLETE_WITH_WARNINGS: approval needs acknowledgeWarnings=true; the acknowledgement is audited', async () => {
  // 12 days after the 2026-11-08 stock snapshot: STOCK_STALE only -> COMPLETE_WITH_WARNINGS.
  const evaluated = await run(COPY.WARN, '2026-11-20');
  assert.equal(evaluated.status, 'COMPLETE_WITH_WARNINGS');
  assert.equal(evaluated.flags, 'STOCK_STALE');
  assert.equal((await act(COPY.WARN, 'submitForReview', 'analyst')).status, 200);

  for (const acknowledgeWarnings of [undefined, false]) {
    const r = await act(COPY.WARN, 'approve', 'approver', { basedOnRun: evaluated.ID, acknowledgeWarnings });
    assert.equal(r.status, 409, JSON.stringify(r.data));
    assert.equal(r.data.error.code, 'WARNINGS_ACKNOWLEDGEMENT_REQUIRED');
    assert.match(r.data.error.message, /STOCK_STALE/);
  }
  assert.equal(await statusOf(COPY.WARN), 'IN_REVIEW');

  const approved = await act(COPY.WARN, 'approve', 'approver', { basedOnRun: evaluated.ID, acknowledgeWarnings: true, comment: 'Stock re-checked by phone' });
  assert.equal(approved.status, 200, JSON.stringify(approved.data));
  assert.equal(approved.data.status, 'APPROVED');
  const last = (await eventsOf(COPY.WARN)).at(-1);
  assert.deepEqual({ action: last.action, basedOnRun_ID: last.basedOnRun_ID, evidenceStatus: last.evidenceStatus, warningsAcknowledged: last.warningsAcknowledged },
    { action: 'APPROVE', basedOnRun_ID: evaluated.ID, evidenceStatus: 'COMPLETE_WITH_WARNINGS', warningsAcknowledged: true });
});

test('acknowledgement type is validated (400) and never substitutes for the evaluated run', async () => {
  const evaluated = await run(COPY.WARN2, '2026-11-20');
  assert.equal((await act(COPY.WARN2, 'submitForReview', 'analyst')).status, 200);
  const wrongType = await act(COPY.WARN2, 'approve', 'approver', { basedOnRun: evaluated.ID, acknowledgeWarnings: 'yes' });
  assert.equal(wrongType.status, 400);
  // A newer run replaces the evidence: acknowledging the older one is stale, not approvable.
  await run(COPY.WARN2, '2026-11-21');
  const stale = await act(COPY.WARN2, 'approve', 'approver', { basedOnRun: evaluated.ID, acknowledgeWarnings: true });
  assert.equal(stale.status, 409);
  assert.equal(stale.data.error.code, 'STALE_EVIDENCE');
  assert.equal(await statusOf(COPY.WARN2), 'IN_REVIEW');
});

test('COMPLETE evidence: approval works without acknowledgement and records the run status', async () => {
  const evaluated = await run(COPY.OK, '2026-11-08');
  assert.equal(evaluated.status, 'COMPLETE');
  assert.equal((await act(COPY.OK, 'submitForReview', 'analyst')).status, 200);
  const approved = await act(COPY.OK, 'approve', 'approver', { basedOnRun: evaluated.ID });
  assert.equal(approved.status, 200, JSON.stringify(approved.data));
  const last = (await eventsOf(COPY.OK)).at(-1);
  assert.equal(last.evidenceStatus, 'COMPLETE');
  assert.equal(last.warningsAcknowledged, null);
});

test('availability flags follow role, status and separation of duties; readable run status', async () => {
  const flags = async user => {
    const r = await request(`/ReviewCases(${COPY.AVAIL})?$select=status,canRunImpact,canSubmit,canDecide,submittedBy`, { user });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return [r.data.canRunImpact, r.data.canSubmit, r.data.canDecide, r.data.submittedBy];
  };
  assert.deepEqual(await flags('analyst'), [true, true, false, null]);
  assert.deepEqual(await flags('approver'), [false, false, false, null]);
  assert.deepEqual(await flags('cviewer'), [false, false, false, null]);

  await run(COPY.AVAIL, '2026-11-08');
  assert.equal((await act(COPY.AVAIL, 'submitForReview', 'dual')).status, 200);
  assert.deepEqual(await flags('approver'), [false, false, true, 'dual']);
  assert.deepEqual(await flags('dual'), [true, false, false, 'dual'], 'the submitter is not offered the decision');

  const list = await request('/ReviewCases?$select=caseNumber,canSubmit&$filter=status eq \'OPEN\'', { user: 'analyst' });
  assert.equal(list.status, 200);
  assert(list.data.value.length > 0 && list.data.value.every(r => r.canSubmit === true));

  const runs = await request(`/ReviewCases(${COPY.AVAIL})/runs?$select=status,statusText`, { user: 'cviewer' });
  assert.equal(runs.data.value[0].statusText, 'Complete');
});
