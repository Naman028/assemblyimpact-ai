// M04 Slice 1b: synthetic seed dataset (test/data) - drift, integrity, CAP loading,
// OData access, plant isolation and runImpact on persisted scenario data.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { before, after, test } from 'node:test';
import { readJson } from './m04-fixtures.js';
import { buildSeed, buildRows, toCsv, csvFileName, ENTITIES } from './m04-seed.js';

// The [test] profile excludes test/data so the other suites start empty; this suite opts in.
process.env.CDS_ENV = 'test';
process.env.CDS_CONFIG = JSON.stringify({ requires: { db: { data: ['db/data', 'db/csv', 'test/data'] } } });
const { default: cds } = await import('@sap/cds');
const ROOT = join(import.meta.dirname, '..');
const AS_OF = '2026-11-08';
const seed = buildSeed();
const byNumber = n => seed.ReviewCases.find(c => c.caseNumber === n);
const CASE_1000 = byNumber('EC-000473').ID;
const CASE_2000 = byNumber('EC-200473').ID;
let server, root;

const request = async (path, { user = 'analyst', method = 'GET', body } = {}) => {
  const response = await fetch(root + path, {
    method,
    headers: { 'content-type': 'application/json', ...(user ? { authorization: `Basic ${Buffer.from(`${user}:test`).toString('base64')}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = text;
  try { data = JSON.parse(text); } catch { /* non-JSON body */ }
  return { status: response.status, data };
};
const er = (path, options) => request(`/odata/v4/engineering-review${path}`, options);
const runImpact = (id, user = 'analyst', body = { asOfDate: AS_OF }) =>
  er(`/ReviewCases(${id})/runImpact`, { method: 'POST', user, body });
const num = v => (v === null || v === undefined ? null : Number(v));

/** Compares a persisted run (and its lines) with one case of an oracle expected-results file. */
async function assertMatchesOracle(run, expected) {
  assert.equal(run.status, expected.status);
  assert.deepEqual([run.ruleset, run.asOfDate, run.fromRevision, run.toRevision, run.productionQuantity, run.currency],
    ['1.1.0', AS_OF, expected.from.revision, expected.to.revision, expected.cost.productionQuantity, expected.cost.currency]);
  const c = expected.cost;
  assert.deepEqual(
    [run.fromCostPerAssembly, run.toCostPerAssembly, run.deltaPerAssembly, run.fromCostTotal, run.toCostTotal, run.costDeltaTotal, run.costDeltaPercent].map(num),
    [c.fromPerAssembly, c.toPerAssembly, c.deltaPerAssembly, c.fromTotal, c.toTotal, c.deltaTotal, c.deltaPercent].map(num));
  const s = expected.summary;
  assert.deepEqual([run.instructionFindings, run.instructionsToUpdate, run.materialsShort, run.materialsUnknown],
    [s.instructionFindings, s.instructionsToUpdate, s.materialsShort, s.materialsUnknown]);
  const lines = (await er(`/ImpactMaterialLines?$filter=run_ID eq ${run.ID}&$orderby=material`)).data.value;
  const byMaterial = [...expected.stock].sort((a, b) => (a.material < b.material ? -1 : 1));
  assert.deepEqual(lines.map(l => [l.material, num(l.required), num(l.available), num(l.gap), l.status, l.stale]),
    byMaterial.map(l => [l.material, num(l.required), num(l.available), num(l.gap), l.status, l.stale]));
  const cmp = (await er(`/ImpactComparisonLines?$filter=run_ID eq ${run.ID}&$orderby=itemNo`)).data.value;
  assert.deepEqual(cmp.map(l => [l.itemNo, l.fromMaterial, l.toMaterial, l.change]),
    expected.comparison.map(l => [l.itemNo, l.fromMaterial, l.toMaterial, l.change]));
  const findings = (await er(`/Findings?$filter=run_ID eq ${run.ID}`)).data.value;
  assert.deepEqual(findings.map(f => f.type).sort(), expected.findings.map(f => f.type).sort());
  const severities = {};
  for (const f of findings) severities[f.severity] = (severities[f.severity] ?? 0) + 1;
  assert.deepEqual(severities, s.findingsBySeverity);
}

before(async () => {
  server = await cds.server({ port: 0, in_memory: true });
  if (!server.listening) await once(server, 'listening');
  root = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  await cds.db?.disconnect();
});

test('committed test/data CSVs are exactly the generator output (reproducible, no drift)', () => {
  for (const entity of ENTITIES) {
    const committed = readFileSync(join(ROOT, 'test', 'data', csvFileName(entity)), 'utf8');
    assert.equal(committed, toCsv(entity, seed[entity]), `${csvFileName(entity)} is stale: run node tools/m04/build-seed.mjs`);
  }
  assert.deepEqual(buildSeed(), seed, 'generator is deterministic');
});

test('seed data is referentially and semantically consistent', () => {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const index = {};
  for (const e of ENTITIES) {
    const ids = seed[e].map(r => r.ID);
    assert(ids.every(id => uuid.test(id)), `${e} keys are UUIDs`);
    assert.equal(new Set(ids).size, ids.length, `${e} keys are unique`);
    index[e] = new Map(seed[e].map(r => [r.ID, r]));
  }
  const unique = (rows, key, what) => assert.equal(new Set(rows.map(key)).size, rows.length, `${what} unique`);
  unique(seed.Assemblies, a => `${a.assemblyCode}|${a.plant}`, 'assembly per plant');
  unique(seed.BOMItems, i => `${i.bomState_ID}|${i.itemNo}`, 'item per BOM state');
  unique(seed.ReviewCases, c => c.caseNumber, 'case number');
  unique(seed.Instructions, i => `${i.instructionId}|${i.version}|${i.plant}`, 'instruction version per plant');

  for (const s of seed.BOMStates) {
    const a = index.Assemblies.get(s.assembly_ID);
    assert(a && a.plant === s.plant, `BOM state ${s.stateKey} -> assembly in same plant`);
    assert(s.validFrom <= s.validTo, `${s.stateKey} validity`);
  }
  for (const i of seed.BOMItems) assert(index.BOMStates.has(i.bomState_ID), `item ${i.itemNo} -> BOM state`);
  for (const i of seed.Instructions) assert.equal(index.Assemblies.get(i.assembly_ID)?.plant, i.plant, `instruction ${i.instructionId} plant`);
  for (const r of seed.InstructionReferences) assert(index.Instructions.has(r.instruction_ID), `reference ${r.step} -> instruction`);
  for (const c of seed.ReviewCases) {
    const from = index.BOMStates.get(c.fromState_ID), to = index.BOMStates.get(c.toState_ID);
    assert(from && to, `${c.caseNumber} states exist`);
    for (const s of [from, to]) assert.deepEqual([s.assembly_ID, s.plant], [c.assembly_ID, c.plant], `${c.caseNumber} states belong to the case`);
    assert(from.validTo < to.validFrom, `${c.caseNumber}: revision ${from.revision} ends before ${to.revision} becomes effective`);
    assert(Number.isInteger(Number(c.productionQuantity)) && Number(c.productionQuantity) > 0);
    assert(uuid.test(c.version), `${c.caseNumber} has a concurrency token`);
    // Every BOM material is priced and stocked in the case plant with a matching unit.
    for (const item of seed.BOMItems.filter(i => [from.ID, to.ID].includes(i.bomState_ID))) {
      const price = seed.CostPrices.find(p => p.material === item.material && p.plant === c.plant);
      const stock = seed.StockSnapshots.find(s => s.material === item.material && s.plant === c.plant);
      assert(price && price.unit === item.unit && price.currency === 'EUR', `${c.caseNumber} ${item.material} price`);
      assert(stock && stock.unit === item.unit, `${c.caseNumber} ${item.material} stock`);
    }
  }
  // Provenance: synthetic, labelled and traceable; PUMP-200 stays test-only (Decision A).
  for (const e of ENTITIES.filter(e => !['Assemblies', 'BOMItems', 'InstructionReferences'].includes(e)))
    for (const r of seed[e]) assert.equal(r.sourceType, 'SYNTHETIC_FIXTURE', `${e} sourceType`);
  for (const e of ENTITIES.filter(e => !['Assemblies', 'InstructionReferences'].includes(e)))
    for (const r of seed[e]) assert(r.evidenceRef?.length, `${e} evidenceRef`);
  for (const a of seed.Assemblies) assert.match(a.description, /\[SYNTHETIC DS-ORACLE-01/);
  assert(!seed.Assemblies.some(a => a.assemblyCode === 'PUMP-200'), 'PUMP-200 is not application seed data');
});

test('CAP loads test/data; authenticated OData returns the seeded records per plant', async () => {
  const counts = async user => {
    const out = {};
    for (const set of ['ReviewCases', 'BOMStates', 'BOMItems', 'CostPrices', 'StockSnapshots', 'Instructions', 'InstructionReferences'])
      out[set] = Number((await er(`/${set}/$count`, { user })).data);
    return out;
  };
  const expected = { ReviewCases: 1, BOMStates: 2, BOMItems: 7, CostPrices: 5, StockSnapshots: 5, Instructions: 3, InstructionReferences: 9 };
  assert.deepEqual(await counts('cviewer'), expected);
  assert.deepEqual(await counts('analyst2'), expected);
  const cases = (await er('/ReviewCases?$orderby=caseNumber', { user: 'cviewer' })).data.value;
  assert.deepEqual(cases.map(c => [c.caseNumber, c.plant, c.assemblyCode, c.fromRevision, c.toRevision, c.productionQuantity, c.sourceType]),
    [['EC-000473', '1000', 'COOL-100', 'A', 'B', 100, 'SYNTHETIC_FIXTURE']]);
  const other = (await er('/ReviewCases', { user: 'analyst2' })).data.value;
  assert.deepEqual(other.map(c => [c.caseNumber, c.plant]), [['EC-200473', '2000']]);
  const items = (await er(`/BOMItems?$filter=bomState/stateKey eq 'BOM-COOL-100-B'&$orderby=itemNo`, { user: 'cviewer' })).data.value;
  assert.deepEqual(items.map(i => [i.itemNo, i.material, Number(i.quantity), i.unit]),
    [['0010', 'FAN-B', 1, 'PC'], ['0020', 'BRKT-01', 3, 'PC'], ['0030', 'SENS-01', 1, 'PC'], ['0040', 'SEAL-01', 1, 'PC']]);
  // M03 still serves its own entity, now with the seeded assembly, and still filters by plant.
  const m03 = await request('/odata/v4/assembly-catalog/Assemblies', { user: 'viewer' });
  assert.equal(m03.status, 200);
  assert.deepEqual(m03.data.value.map(a => [a.assemblyCode, a.plant]), [['COOL-100', '1000']]);
  assert.match(m03.data.value[0].description, /\[SYNTHETIC DS-ORACLE-01\]/);
});

test('runImpact on the persisted seed case reproduces DS-ORACLE-01 and is deterministic', async () => {
  const expected = readJson('DS-ORACLE-01', 'expected-results.json').cases[0];
  const first = await runImpact(CASE_1000);
  assert.equal(first.status, 200, JSON.stringify(first.data));
  await assertMatchesOracle(first.data, expected);
  const second = (await runImpact(CASE_1000)).data;
  assert.notEqual(second.ID, first.data.ID, 'each run is a new snapshot');
  assert.equal(second.inputFingerprint, first.data.inputFingerprint, 'same persisted inputs, same fingerprint');
  // The plant-2000 mirror is the same scenario and yields the same figures for its own plant.
  const mirror = await runImpact(CASE_2000, 'analyst2');
  assert.equal(mirror.status, 200, JSON.stringify(mirror.data));
  assert.deepEqual([mirror.data.costDeltaTotal, mirror.data.materialsShort].map(Number), [1200, 2]);
  const latest = await er(`/ReviewCases(${CASE_1000})?$expand=latestRun($select=ID)`, { user: 'cviewer' });
  assert.equal(latest.data.latestRun.ID, second.ID);
});

test('seeded records keep authentication, role, plant and input checks', async () => {
  assert.equal((await er('/ReviewCases', { user: null })).status, 401);
  assert.equal((await er(`/ReviewCases(${CASE_1000})`, { user: 'analyst2' })).status, 404, 'foreign plant key read');
  assert.equal((await runImpact(CASE_1000, 'analyst2')).status, 404, 'foreign plant runImpact');
  assert.equal((await runImpact(CASE_2000, 'analyst')).status, 404, 'foreign plant runImpact (reverse)');
  assert.equal((await runImpact(CASE_1000, 'cviewer')).status, 403, 'viewer cannot run');
  assert.equal((await er('/ReviewCases', { user: 'cwild' })).status, 403, 'wildcard plant attribute');
  assert.equal((await er('/ReviewCases', { user: 'cbad' })).status, 403, 'malformed plant attribute');
  assert.equal((await er('/ReviewCases', { user: 'viewer' })).status, 403, 'M03 role has no M04 access');
  assert.equal((await runImpact(CASE_1000, 'analyst', { asOfDate: 'not-a-date' })).status, 400, 'malformed date');
  assert.equal((await runImpact('00000000-0000-4000-8000-000000000000')).status, 404, 'unknown case');
  for (const method of ['PATCH', 'DELETE'])
    assert([403, 405].includes((await er(`/CostPrices(${seed.CostPrices[0].ID})`, { method, body: method === 'PATCH' ? { price: 1 } : undefined })).status));
  const prices = (await er(`/CostPrices?$filter=material eq 'FAN-B'`, { user: 'cviewer' })).data.value;
  assert.deepEqual(prices.map(p => Number(p.price)), [42], 'seeded price unchanged');
});

test('DS-DEMO-01 (test-only, not seeded) reproduces its expected results through persisted runImpact', async () => {
  const rows = buildRows({ dataset: 'DS-DEMO-01', caseNumber: 'EC-000471', keyPrefix: 'test' });
  const A = cds.entities('assemblyimpact');
  for (const e of ENTITIES) if (rows[e].length) await INSERT.into(A[e]).entries(rows[e]);
  const expected = readJson('DS-DEMO-01', 'expected-results.json').cases[0];
  const response = await runImpact(rows.ReviewCases[0].ID);
  assert.equal(response.status, 200, JSON.stringify(response.data));
  await assertMatchesOracle(response.data, expected);
});

test('production configuration never loads test/data', () => {
  const probe = `const cds=require('@sap/cds');(async()=>{const r=await cds.deploy.resources('*');` +
    `console.log(JSON.stringify({data:cds.env.requires.db.data,files:Object.keys(r)}))})()`;
  const out = spawnSync(process.execPath, ['-e', probe], { cwd: ROOT, env: { ...process.env, CDS_ENV: 'production', CDS_CONFIG: '' }, encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  const { data, files } = JSON.parse(out.stdout.trim().split('\n').at(-1));
  assert(!data.some(d => d.includes('test')), JSON.stringify(data));
  assert(!files.some(f => f.includes(join('test', 'data'))), JSON.stringify(files));
  // The development profile, by contrast, does load the seed.
  const dev = spawnSync(process.execPath, ['-e', probe], { cwd: ROOT, env: { ...process.env, CDS_ENV: 'development', CDS_CONFIG: '' }, encoding: 'utf8' });
  assert.equal(dev.status, 0, dev.stderr);
  assert.equal(JSON.parse(dev.stdout.trim().split('\n').at(-1)).files.filter(f => f.includes(join('test', 'data'))).length, ENTITIES.length);
});
