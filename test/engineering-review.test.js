import assert from 'node:assert/strict';
import { once } from 'node:events';
import { before, after, test } from 'node:test';
import { loadDataset, readJson, stableId } from './m04-fixtures.js';

process.env.CDS_ENV = 'test';
const { default: cds } = await import('@sap/cds');
const { persistImpactRun, ConcurrentRunError } = await import('../srv/lib/impact-persistence.js');
let server, base;
const AS_OF = '2026-11-08';
const CASE = stableId('case:EC-000473');
const FOREIGN_CASE = stableId('case:EC-900001');

const request = async (path, { user = 'analyst', method = 'GET', body } = {}) => {
  const response = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(user ? { authorization: `Basic ${Buffer.from(`${user}:test`).toString('base64')}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const textBody = await response.text();
  let data = textBody;
  try { data = JSON.parse(textBody); } catch { /* non-JSON body */ }
  return { status: response.status, data };
};
const run = (id = CASE, user = 'analyst', body = { asOfDate: AS_OF }) =>
  request(`/ReviewCases(${id})/runImpact`, { method: 'POST', user, body });

/** Seeds DS-ORACLE-01 (plant 1000) and a plant-2000 copy, with deterministic keys. */
async function seed() {
  const A = cds.entities('assemblyimpact');
  const data = loadDataset('DS-ORACLE-01');
  for (const plant of ['1000', '2000']) {
    const p = name => stableId(`${plant}:${name}`);
    const caseNumber = plant === '1000' ? 'EC-000473' : 'EC-900001';
    await INSERT.into(A.Assemblies).entries({ ID: p('assembly'), assemblyCode: 'COOL-100', plant, description: 'Cooling Module', version: cds.utils.uuid() });
    await INSERT.into(A.BOMStates).entries(data.bom_states.map(s => ({ ID: p(s.bomStateId), stateKey: s.bomStateId, assembly_ID: p('assembly'),
      plant, bomUsage: s.bomUsage, alternative: s.alternative, revision: s.revision, validFrom: s.validFrom, validTo: s.validTo,
      status: s.status, changeNumber: s.changeNumber || null, sourceType: s.sourceType, evidenceRef: s.evidenceRef })));
    await INSERT.into(A.BOMItems).entries(data.bom_items.map(i => ({ bomState_ID: p(i.bomStateId), itemNo: i.itemNo, material: i.material,
      quantity: i.quantity, unit: i.unit, evidenceRef: i.evidenceRef })));
    await INSERT.into(A.CostPrices).entries(data.cost_prices.map(c => ({ ...c, plant, priceUnit: Number(c.priceUnit) })));
    await INSERT.into(A.StockSnapshots).entries(data.stock_snapshots.map(s => ({ material: s.material, plant,
      availableQuantity: s.availableQuantity, unit: s.unit, snapshotAt: s.snapshotAt, sourceType: s.sourceType, evidenceRef: s.evidenceRef })));
    for (const i of data.instructions) {
      await INSERT.into(A.Instructions).entries({ ID: p(`${i.instructionId}/${i.version}`), instructionId: i.instructionId, version: Number(i.version),
        assembly_ID: p('assembly'), plant, title: i.title, appliesToRevision: i.appliesToRevision || null, status: i.status,
        validFrom: i.validFrom, sourceType: i.sourceType, evidenceRef: i.evidenceRef });
    }
    await INSERT.into(A.InstructionReferences).entries(data.instruction_references.map(r => ({
      instruction_ID: p(`${r.instructionId}/${r.version}`), step: r.step, material: r.material, quantity: r.quantity, unit: r.unit, text: r.text })));
    const c = data.review_cases[0];
    await INSERT.into(A.ReviewCases).entries({ ID: plant === '1000' ? CASE : FOREIGN_CASE, caseNumber, title: c.title,
      assembly_ID: p('assembly'), plant, fromState_ID: p(c.fromBomStateId), toState_ID: p(c.toBomStateId),
      productionQuantity: Number(c.productionQuantity), status: c.status, owner: c.owner, sourceType: c.sourceType,
      evidenceRef: c.evidenceRef, version: cds.utils.uuid() });
  }
}

before(async () => {
  server = await cds.server({ port: 0, in_memory: true });
  if (!server.listening) await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}/odata/v4/engineering-review`;
  await seed();
});
after(async () => {
  if (server) await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  await cds.db?.disconnect();
});

test('model compiles; metadata exposes read-only entities and the runImpact action', async () => {
  const model = await cds.load('*');
  for (const e of ['ReviewCases', 'ImpactRuns', 'Findings', 'ImpactMaterialLines', 'ImpactComparisonLines', 'BOMItems'])
    assert(model.definitions[`EngineeringReview.${e}`], e);
  assert(model.definitions['AssemblyCatalog.Assemblies'], 'M03 service still present');
  const sql = cds.compile.to.sql(model, { dialect: 'sqlite' }).join('\n');
  assert.match(sql, /CREATE TABLE assemblyimpact_ImpactRuns/);
  const metadata = await request('/$metadata', { user: 'cviewer' });
  assert.equal(metadata.status, 200);
  assert.match(metadata.data, /Action Name="runImpact" IsBound="true"/);
  const reviewCaseType = metadata.data.match(/<EntityType Name="ReviewCases">[\s\S]*?<\/EntityType>/)[0];
  assert.doesNotMatch(reviewCaseType, /Property Name="version"/, 'internal concurrency token is not exposed');
});

test('runImpact persists a snapshot that matches the independent oracle', async () => {
  const expected = readJson('DS-ORACLE-01', 'expected-results.json').cases[0];
  const response = await run();
  assert.equal(response.status, 200, JSON.stringify(response.data));
  const r = response.data;
  assert.deepEqual([r.status, r.ruleset, r.asOfDate, r.fromRevision, r.toRevision, r.productionQuantity],
    ['COMPLETE', '1.1.0', AS_OF, 'A', 'B', 100]);
  assert.deepEqual([r.fromCostPerAssembly, r.toCostPerAssembly, r.costDeltaTotal, r.costDeltaPercent].map(Number),
    [56, 68, 1200, 21.43]);
  assert.deepEqual([r.instructionFindings, r.materialsShort, r.materialsUnknown], [1, 2, 0]);
  assert.match(r.inputFingerprint, /^sha256:[0-9a-f]{64}$/);
  const lines = (await request(`/ImpactMaterialLines?$filter=run_ID eq ${r.ID}&$orderby=material`, { user: 'cviewer' })).data.value;
  assert.deepEqual(lines.map(l => [l.material, Number(l.required), Number(l.available), Number(l.gap), l.status]),
    expected.stock.map(l => [l.material, Number(l.required), Number(l.available), Number(l.gap), l.status]));
  const cmp = (await request(`/ImpactComparisonLines?$filter=run_ID eq ${r.ID}&$orderby=itemNo`, { user: 'cviewer' })).data.value;
  assert.deepEqual(cmp.map(l => [l.itemNo, l.change]), expected.comparison.map(l => [l.itemNo, l.change]));
  const findings = (await request(`/Findings?$filter=run_ID eq ${r.ID}`, { user: 'cviewer' })).data.value;
  assert.deepEqual(findings.map(f => f.type).sort(), expected.findings.map(f => f.type).sort());
  const viaCase = await request(`/ReviewCases(${CASE})?$expand=latestRun($select=ID,costDeltaTotal)`, { user: 'cviewer' });
  assert.equal(viaCase.data.latestRun.ID, r.ID);
  assert.equal(viaCase.data.assemblyCode, 'COOL-100');
});

test('same inputs give the same fingerprint; each run is a new immutable record', async () => {
  const first = (await run()).data, second = (await run()).data;
  assert.notEqual(first.ID, second.ID);
  assert.equal(first.inputFingerprint, second.inputFingerprint);
  // Historical snapshots do not change when source data changes later.
  const { CostPrices } = cds.entities('assemblyimpact');
  await UPDATE(CostPrices).set({ price: 50 }).where({ material: 'FAN-B', plant: '1000' });
  const third = (await run()).data;
  assert.notEqual(third.inputFingerprint, first.inputFingerprint);
  assert.equal(Number(third.costDeltaTotal), 2000);
  const old = (await request(`/ImpactRuns(${first.ID})`, { user: 'cviewer' })).data;
  assert.equal(Number(old.costDeltaTotal), 1200);
  const oldLine = (await request(`/ImpactMaterialLines?$filter=run_ID eq ${first.ID} and material eq 'FAN-B'`, { user: 'cviewer' })).data.value[0];
  assert.equal(Number(oldLine.unitPrice), 42);
  await UPDATE(CostPrices).set({ price: 42 }).where({ material: 'FAN-B', plant: '1000' });
});

test('snapshot entities reject every client write', async () => {
  const runID = (await run()).data.ID;
  const line = (await request(`/ImpactMaterialLines?$filter=run_ID eq ${runID}&$top=1`, { user: 'cviewer' })).data.value[0];
  for (const [path, body] of [[`/ImpactRuns(${runID})`, { costDeltaTotal: 1 }], [`/ImpactMaterialLines(${line.ID})`, { gap: 0 }],
    [`/ReviewCases(${CASE})`, { status: 'APPROVED' }]]) {
    for (const method of ['PATCH', 'PUT', 'DELETE']) {
      const r = await request(path, { method, body: method === 'DELETE' ? undefined : body });
      assert([403, 405].includes(r.status), `${method} ${path} -> ${r.status}`);
    }
  }
  for (const set of ['ImpactRuns', 'Findings', 'ReviewCases', 'BOMItems', 'CostPrices'])
    assert([403, 405].includes((await request(`/${set}`, { method: 'POST', body: {} })).status), set);
  assert.equal(Number((await request(`/ImpactRuns(${runID})`, { user: 'cviewer' })).data.costDeltaTotal), 1200);
});

test('plant isolation on every exposed entity: collection, $count, key, $expand', async () => {
  await run(FOREIGN_CASE, 'analyst2');
  const sets = ['ReviewCases', 'ImpactRuns', 'ImpactComparisonLines', 'ImpactMaterialLines', 'Findings', 'BOMStates', 'BOMItems',
    'CostPrices', 'StockSnapshots', 'Instructions', 'InstructionReferences'];
  for (const set of sets) {
    const own = await request(`/${set}?$count=true`, { user: 'cviewer' });
    const foreign = await request(`/${set}?$count=true`, { user: 'cviewer2' });
    assert.equal(own.status, 200, set);
    assert(own.data.value.length > 0, `${set} has own-plant rows`);
    assert.equal(own.data['@odata.count'], own.data.value.length, `${set} count`);
    const ownIds = new Set(own.data.value.map(r => r.ID));
    assert(foreign.data.value.every(r => !ownIds.has(r.ID)), `${set}: plant-2000 user sees no plant-1000 row`);
  }
  assert.equal((await request(`/ReviewCases(${CASE})`, { user: 'cviewer2' })).status, 404);
  const expanded = await request(`/ReviewCases?$expand=runs($expand=findings,materialLines)`, { user: 'cviewer2' });
  assert(expanded.data.value.every(c => c.plant === '2000'));
  const someRun = (await request(`/ImpactRuns?$top=1`, { user: 'cviewer' })).data.value[0];
  assert.equal((await request(`/ImpactRuns(${someRun.ID})`, { user: 'cviewer2' })).status, 404);
  assert.equal((await request(`/Findings?$filter=run_ID eq ${someRun.ID}`, { user: 'cviewer2' })).data.value.length, 0);
});

test('runImpact authorization: roles, foreign plant, malformed memberships', async () => {
  assert.equal((await run(CASE, null)).status, 401);
  assert.equal((await run(CASE, 'cviewer')).status, 403, 'viewer may not run');
  assert.equal((await run(CASE, 'maintainer')).status, 403, 'M03 role grants nothing here');
  assert.equal((await run(CASE, 'analyst2')).status, 404, 'foreign plant is masked as not found');
  assert.equal((await run(stableId('missing'), 'analyst')).status, 404);
  for (const user of ['cbad', 'cwild']) {
    assert.equal((await run(CASE, user)).status, 403, user);
    assert.equal((await request('/ReviewCases', { user })).status, 403, user);
  }
});

test('invalid and non-comparable inputs are rejected without persisting a run', async () => {
  const { ReviewCases, ImpactRuns } = cds.entities('assemblyimpact');
  const before = (await SELECT.from(ImpactRuns)).length;
  await UPDATE(ReviewCases).set({ productionQuantity: 0 }).where({ ID: CASE });
  const r = await run();
  assert.equal(r.status, 422);
  assert.equal(r.data.error.code, 'INVALID_PRODUCTION_QUANTITY');
  await UPDATE(ReviewCases).set({ productionQuantity: 100 }).where({ ID: CASE });
  assert.equal((await run(CASE, 'analyst', { asOfDate: 'not-a-date' })).status, 400);
  assert.equal((await SELECT.from(ImpactRuns)).length, before);
});

test('stale case version is detected by the database-level compare-and-set and rolls back', async () => {
  const { ReviewCases, ImpactRuns, Findings } = cds.entities('assemblyimpact');
  const counts = async () => [(await SELECT.from(ImpactRuns)).length, (await SELECT.from(Findings)).length];
  const beforeCounts = await counts();
  const stale = await SELECT.one.from(ReviewCases).where({ ID: CASE });
  await run(); // another run commits after "stale" was read
  const afterOther = await counts();
  const minimal = { ruleset: '1.1.0', asOfDate: AS_OF, status: 'COMPLETE', flags: [], from: { revision: 'A' }, to: { revision: 'B' },
    cost: { currency: 'EUR', productionQuantity: 100 }, summary: { instructionFindings: 0, instructionsToUpdate: 0, materialsShort: 0, materialsUnknown: 0 },
    comparison: [], materialLines: [], findings: [{ type: 'COST_CHANGE', severity: 'LOW', material: null, details: 'x', evidenceRefs: [] }] };
  await assert.rejects(cds.tx(() => persistImpactRun(stale, minimal, { fingerprint: 'sha256:' + '0'.repeat(64), user: 'test', now: new Date().toISOString() })),
    ConcurrentRunError);
  assert.deepEqual(await counts(), afterOther, 'rolled back: no run or finding from the stale attempt');
  assert.notDeepEqual(afterOther, beforeCounts);
});

test('parallel runImpact requests never lose an update or leave orphans', async () => {
  const { ImpactRuns, ReviewCases } = cds.entities('assemblyimpact');
  const before = (await SELECT.from(ImpactRuns).where({ reviewCase_ID: CASE })).length;
  const results = await Promise.all(Array.from({ length: 5 }, () => run()));
  assert(results.every(r => [200, 409].includes(r.status)), JSON.stringify(results.map(r => r.status)));
  const ok = results.filter(r => r.status === 200);
  const after = (await SELECT.from(ImpactRuns).where({ reviewCase_ID: CASE })).length;
  assert.equal(after - before, ok.length, 'one persisted run per successful response');
  const latest = (await SELECT.one.from(ReviewCases).where({ ID: CASE })).latestRun_ID;
  assert(ok.some(r => r.data.ID === latest), 'latestRun points to a successful run');
});
