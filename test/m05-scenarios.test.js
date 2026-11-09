// M05 Deliverable B: scenario expansion (DS-SCENARIOS-01). The engine reproduces the hand-calculated
// outcomes, and the seeded cases are listed, isolated by plant and calculable through the service.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { before, after, test } from 'node:test';
import { loadDataset, toCalculatorInput, FIXTURES_M05 } from './m04-fixtures.js';
import { buildSeed } from './m04-seed.js';
import { calculateImpact } from '../srv/lib/impact-calculator.js';

process.env.CDS_ENV = 'test';
process.env.CDS_CONFIG = JSON.stringify({ requires: { db: { data: ['db/data', 'db/csv', 'test/data'] } } });
const { default: cds } = await import('@sap/cds');
const expected = JSON.parse(readFileSync(join(FIXTURES_M05, 'DS-SCENARIOS-01', 'expected-results.json'), 'utf8'));
const data = loadDataset('DS-SCENARIOS-01');
const seed = buildSeed();
let server, base;

const request = async (path, { user = 'cviewer', method = 'GET', body } = {}) => {
  const response = await fetch(base + path, { method,
    headers: { 'content-type': 'application/json', authorization: `Basic ${Buffer.from(`${user}:test`).toString('base64')}` },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, data: await response.json() };
};
const summaryOf = r => ({ status: r.status, flags: r.flags, fromPerAssembly: r.cost.fromPerAssembly, toPerAssembly: r.cost.toPerAssembly,
  deltaPerAssembly: r.cost.deltaPerAssembly, deltaTotal: r.cost.deltaTotal, deltaPercent: r.cost.deltaPercent,
  materialsShort: r.summary.materialsShort, materialsUnknown: r.summary.materialsUnknown, instructionFindings: r.summary.instructionFindings,
  instructionsToUpdate: r.summary.instructionsToUpdate, short: r.stock.filter(l => l.status === 'SHORT').map(l => l.material),
  changes: Object.fromEntries(r.comparison.map(l => [l.itemNo, l.change])) });

before(async () => {
  server = await cds.server({ port: 0, in_memory: true });
  if (!server.listening) await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}/odata/v4/engineering-review`;
});
after(async () => {
  if (server) await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  await cds.db?.disconnect();
});

test('engine reproduces every hand-calculated scenario outcome', () => {
  assert.equal(data.manifest.synthetic, true);
  assert.deepEqual(data.review_cases.map(c => c.caseNumber).sort(), Object.keys(expected.cases).sort());
  for (const [caseNumber, want] of Object.entries(expected.cases)) {
    assert.deepEqual(summaryOf(calculateImpact(toCalculatorInput(data, caseNumber, expected.asOfDate))), want, caseNumber);
  }
});

test('scenario coverage: replacement, quantity change, added, removed, shortage, cost up/down, outdated instructions, warnings, incomplete', () => {
  const all = Object.values(expected.cases);
  const changes = new Set(all.flatMap(c => Object.values(c.changes)));
  for (const c of ['REPLACED', 'QUANTITY_CHANGED', 'ADDED', 'REMOVED']) assert(changes.has(c), c);
  assert(all.some(c => c.materialsShort > 0));
  assert(all.some(c => Number(c.deltaTotal) > 0) && all.some(c => Number(c.deltaTotal) < 0));
  assert(all.some(c => c.instructionFindings > 1));
  assert.deepEqual([...new Set(all.map(c => c.status))].sort(), ['COMPLETE', 'COMPLETE_WITH_WARNINGS', 'INCOMPLETE']);
  assert(all.some(c => Object.values(c.changes).filter(x => x !== 'UNCHANGED').length >= 3), 'multi-component revision');
});

test('seed: the oracle case is unchanged, six scenario cases are added OPEN, no impact runs are seeded', () => {
  const numbers = seed.ReviewCases.map(c => c.caseNumber);
  assert.deepEqual(numbers.slice(0, 2), ['EC-000473', 'EC-200473']);
  assert.deepEqual(numbers.slice(2), Object.keys(expected.cases));
  assert(seed.ReviewCases.every(c => c.status === 'OPEN'));
  assert(!('ImpactRuns' in seed));
  assert(!seed.Assemblies.some(a => a.assemblyCode === 'PUMP-200'), 'PUMP-200 stays test-only');
  assert.equal(new Set(seed.CostPrices.map(r => r.ID)).size, seed.CostPrices.length, 'no duplicate keys');
});

test('service: worklist lists the scenario cases for plant 1000 only; each calculates as expected', async () => {
  const p1000 = await request('/ReviewCases?$select=caseNumber&$orderby=caseNumber');
  assert.deepEqual(p1000.data.value.map(c => c.caseNumber), ['EC-000473', ...Object.keys(expected.cases)]);
  const p2000 = await request('/ReviewCases?$select=caseNumber', { user: 'cviewer2' });
  assert.deepEqual(p2000.data.value.map(c => c.caseNumber), ['EC-200473']);
  for (const [caseNumber, want] of Object.entries(expected.cases)) {
    const id = seed.ReviewCases.find(c => c.caseNumber === caseNumber).ID;
    const run = await request(`/ReviewCases(${id})/EngineeringReview.runImpact`, { method: 'POST', user: 'analyst', body: { asOfDate: expected.asOfDate } });
    assert.equal(run.status, 200, `${caseNumber} ${JSON.stringify(run.data)}`);
    assert.deepEqual([run.data.status, run.data.costDeltaTotal, run.data.materialsShort, run.data.materialsUnknown, run.data.instructionFindings],
      [want.status, want.deltaTotal, want.materialsShort, want.materialsUnknown, want.instructionFindings], caseNumber);
  }
});
