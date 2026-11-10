// Consumption coverage (planning view), consumption-rate maintenance and the "why is this action disabled" hints.
// The COOL-100 oracle case (EC-000473) is only read here; its BOM, prices and stock are never changed.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { before, after, test } from 'node:test';

process.env.CDS_ENV = 'test';
process.env.CDS_CONFIG = JSON.stringify({ requires: { db: { data: ['db/data', 'db/csv', 'test/data'] } } });
const { default: cds } = await import('@sap/cds');
const ORACLE = '7263f5aa-71cf-5325-8dd7-41ca2e1a0fd5';      // EC-000473, plant 1000
const ORACLE_2000 = 'de4c98ab-fdc6-50f6-ae2a-47b8018b0f7a'; // plant-2000 mirror
const GEAR = '59b1c0b8-f534-5d1c-8c06-e730182feaaa';        // EC-000481, OPEN
let server, base;

const call = async (method, path, { user = 'analyst', body } = {}) => {
  const headers = { authorization: `Basic ${Buffer.from(`${user}:test`).toString('base64')}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, data: (r.headers.get('content-type') ?? '').includes('json') ? await r.json() : await r.text() };
};
const coverage = (id, q = 'startDate=2026-11-25,horizonDays=10', user) => call('GET', `/ReviewCases(${id})/EngineeringReview.materialCoverage(${q})`, { user });
const rate = (body, user) => call('POST', '/MaterialConsumptionRates', { user, body: { plant: '1000', unit: 'PC', validFrom: '2026-11-01', validTo: '2026-12-31', ...body } });
const hints = async (id, user) => (await call('GET', `/ReviewCases(${id})?$select=status,canRunImpact,canSubmit,canDecide,runImpactHint,submitHint,decideHint`, { user })).data;

before(async () => {
  server = await cds.server({ port: 0, in_memory: true });
  if (!server.listening) await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}/odata/v4/engineering-review`;
});
after(async () => {
  if (server) await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  await cds.db?.disconnect();
});

test('coverage without rates: only the case requirement on the effective date is consumed', async () => {
  const r = await coverage(ORACLE, undefined, 'cviewer');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const fan = r.data.value.find(m => m.material === 'FAN-B');
  assert.equal(fan.effectiveDate, '2026-12-01');
  assert.equal(fan.requirementInHorizon, true);
  assert.equal(Number(fan.caseRequirement), 100);
  assert.equal(fan.noRateDays, 10);
  assert.equal(Number(fan.expectedDemand), 100);
  assert.equal(fan.status, 'SHORTAGE');                 // 80 in stock
  assert.equal(fan.exhaustionDate, '2026-12-01');
  assert.equal(r.data.value.length, 4, 'one row per material of revision B');
});

test('a weekly consumption rate is spread per day and combined with the case requirement', async () => {
  const created = await rate({ material: 'FAN-B', period: 'WEEK', quantity: 14 });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const fan = (await coverage(ORACLE)).data.value.find(m => m.material === 'FAN-B');
  // 2/day; 6 days before 12-01 = 12 -> 68; 12-01: 2 + 100 -> -34 (exhausted); 3 more days -> -40.
  assert.equal(Number(fan.dailyRateAtStart), 2);
  assert.equal(Number(fan.expectedDemand), 120);
  assert.equal(Number(fan.projectedEndStock), -40);
  assert.equal(Number(fan.shortageAtEnd), 40);
  assert.equal(fan.coveredDays, 6);
  assert.equal(fan.noRateDays, 0);
  // Outside the horizon the requirement is not counted (point-in-time impact stays a separate view).
  const early = (await coverage(ORACLE, 'startDate=2026-11-10,horizonDays=5')).data.value.find(m => m.material === 'FAN-B');
  assert.equal(early.requirementInHorizon, false);
  assert.equal(Number(early.expectedDemand), 10);
  assert.equal(early.status, 'COVERED');
});

test('the impact result of the oracle case is unchanged by planning data', async () => {
  const run = await call('POST', `/ReviewCases(${ORACLE})/EngineeringReview.runImpact`, { body: { asOfDate: '2026-12-01' } });
  assert.equal(run.status, 200, JSON.stringify(run.data));
  assert.equal(Number(run.data.costDeltaTotal).toFixed(2), '1200.00');
  assert.equal(run.data.materialsShort, 2);
});

test('consumption rates are validated and plant-isolated', async () => {
  for (const [body, code] of [
    [{ material: 'SEAL-01', period: 'WEEK', quantity: -1 }, 'INVALID_QUANTITY'],
    [{ material: 'SEAL-01', period: 'YEAR', quantity: 1 }, null],          // enum refused by CAP
    [{ material: 'SEAL-01', period: 'DAY', quantity: 1, validFrom: '2026-12-31', validTo: '2026-12-01' }, 'INVALID_PERIOD_DATES'],
    [{ material: 'FAN-B', period: 'DAY', quantity: 1 }, 'OVERLAPPING_RATE'],
  ]) {
    const r = await rate(body);
    assert.equal(r.status, 400, JSON.stringify(body));
    if (code) assert.equal(r.data.error?.code, code, JSON.stringify(r.data));
  }
  assert.equal((await rate({ material: 'SEAL-01', period: 'DAY', quantity: 0 })).status, 201, 'zero consumption is valid');
  assert.equal((await rate({ material: 'SEAL-01', period: 'DAY', quantity: 1, plant: '2000', validFrom: '2027-01-01', validTo: '2027-01-31' })).status, 400, 'foreign plant');
  assert.equal((await rate({ material: 'SEAL-01', period: 'DAY', quantity: 1, validFrom: '2027-02-01', validTo: '2027-02-28' }, 'cviewer')).status, 403, 'viewers read only');
  assert.equal((await call('GET', '/MaterialConsumptionRates', { user: 'analyst2' })).data.value.length, 0, 'plant 2000 sees no plant-1000 rates');
  const id = (await call('GET', "/MaterialConsumptionRates?$filter=material eq 'SEAL-01'")).data.value[0].ID;
  const moved = await call('PATCH', `/MaterialConsumptionRates(${id})`, { body: { plant: '2000' } });
  assert.notEqual(moved.status, 200, 'a rate cannot be moved to a foreign plant');
  assert.equal((await call('PATCH', `/MaterialConsumptionRates(${id})`, { body: { quantity: -5 } })).data.error?.code, 'INVALID_QUANTITY');
});

test('coverage is refused for foreign cases and invalid horizons', async () => {
  assert.equal((await coverage(ORACLE_2000)).status, 404);
  assert.equal((await coverage(ORACLE, 'startDate=2026-11-25,horizonDays=0')).data.error?.code, 'INVALID_HORIZON');
  assert.equal((await coverage(ORACLE, 'startDate=2026-11-25,horizonDays=367')).data.error?.code, 'INVALID_HORIZON');
  assert.equal((await coverage(ORACLE, 'startDate=2026-11-25,horizonDays=366')).status, 200);
});

test('disabled actions explain why: role, status, missing evidence and separation of duties', async () => {
  let h = await hints(GEAR, 'cviewer');
  assert.equal(h.canDecide, false);
  assert.match(h.decideHint, /Change Approver role/);
  assert.match(h.runImpactHint, /Change Analyst role/);
  h = await hints(GEAR, 'approver');
  assert.match(h.decideHint, /must submit the case/);
  h = await hints(GEAR, 'dual');
  assert.equal(h.canSubmit, true);
  assert.match(h.submitHint, /run the calculation first/);
  assert.equal((await call('POST', `/ReviewCases(${GEAR})/EngineeringReview.runImpact`, { user: 'dual', body: { asOfDate: '2026-12-01' } })).status, 200);
  assert.equal((await hints(GEAR, 'dual')).submitHint, null, 'available without reservation once a run exists');
  assert.equal((await call('POST', `/ReviewCases(${GEAR})/EngineeringReview.submitForReview`, { user: 'dual', body: {} })).status, 200);
  h = await hints(GEAR, 'dual');
  assert.equal(h.canDecide, false);
  assert.match(h.decideHint, /separation of duties/);
  assert.match(h.submitHint, /Only open cases/);
  assert.equal((await call('POST', `/ReviewCases(${GEAR})/EngineeringReview.rejectCase`, { user: 'dual', body: { comment: 'self' } })).status, 403, 'the server still enforces it');
  h = await hints(GEAR, 'approver');
  assert.equal(h.canDecide, true);
  assert.equal(h.decideHint, null);
});
