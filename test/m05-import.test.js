// M05 Deliverable B: controlled demo-data import — validation, preview, authorization,
// transactional commit, provenance, and that imported cases are calculable by the engine.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { before, after, test } from 'node:test';

process.env.CDS_ENV = 'test';
process.env.CDS_CONFIG = JSON.stringify({ requires: { db: { data: ['db/data', 'db/csv', 'test/data'] } } });
const { default: cds } = await import('@sap/cds');
const { parseImport, validateBundle, commitBundle, parseCsv } = await import('../srv/lib/scenario-import.js');
const SAMPLES = join(import.meta.dirname, '..', 'app', 'investigation-studio', 'webapp', 'samples');
const SAMPLE_JSON = readFileSync(join(SAMPLES, 'scenario-import-sample.json'), 'utf8');
const SAMPLE_CSV = readFileSync(join(SAMPLES, 'scenario-import-sample.csv'), 'utf8');
let server, base;

const request = async (path, { user = 'importer', method = 'GET', body } = {}) => {
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
const importFile = (body, user = 'importer') => request('/importScenario', { method: 'POST', user, body });
const E = () => cds.entities('assemblyimpact');
const counts = async () => Object.fromEntries(await Promise.all(['Assemblies', 'BOMStates', 'BOMItems', 'CostPrices', 'StockSnapshots',
  'Instructions', 'InstructionReferences', 'ReviewCases', 'DataImports'].map(async n => [n, (await SELECT.one.from(E()[n]).columns('count(1) as n')).n])));
const mutate = fn => { const d = JSON.parse(SAMPLE_JSON); fn(d); return JSON.stringify(d); };

before(async () => {
  server = await cds.server({ port: 0, in_memory: true });
  if (!server.listening) await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}/odata/v4/engineering-review`;
});
after(async () => {
  if (server) await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  await cds.db?.disconnect();
});

test('dry run (JSON and CSV): accepted with a preview, and nothing is written', async () => {
  const before = await counts();
  for (const [format, content] of [['json', SAMPLE_JSON], ['csv', SAMPLE_CSV]]) {
    const r = await importFile({ fileName: `sample.${format}`, format, content, dryRun: true });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.accepted, true, JSON.stringify(r.data.errors));
    assert.equal(r.data.dryRun, true);
    assert.equal(r.data.importId, null);
    assert.deepEqual(r.data.errors, []);
    assert.deepEqual(r.data.preview.map(p => [p.caseNumber, p.assemblyCode, p.fromRevision, p.toRevision, p.fromItems, p.toItems]),
      [['EC-000490', 'BLOW-900', 'A', 'B', 3, 4]]);
    assert.deepEqual(JSON.parse(r.data.counts), { assemblies: 1, bomStates: 2, bomItems: 7, costPrices: 5, stockSnapshots: 4,
      instructions: 1, instructionReferences: 2, reviewCases: 1 });
    assert.match(r.data.checksum, /^sha256:[0-9a-f]{64}$/);
  }
  assert.deepEqual(await counts(), before);
});

test('invalid file: every problem is reported with line and field; commit is refused and writes nothing', async () => {
  const content = mutate(d => {
    d.bomItems[0].quantity = '-1';                       // non-positive quantity
    d.bomItems[1].stateKey = 'BOM-NOPE';                 // unknown foreign key
    d.bomItems.push({ ...d.bomItems[2] });               // duplicate item
    d.costPrices[0].validTo = '2025-01-01';              // period ends before it starts
    d.costPrices[1].currency = 'euro';                   // invalid currency code
    d.stockSnapshots[0].snapshotAt = '2026-13-01';       // invalid timestamp
    d.instructions[0].color = 'blue';                    // unknown field
    d.reviewCases[0].productionQuantity = 0;             // invalid quantity
    d.bomStates[1].validFrom = '2027-02-30';             // impossible date
  });
  const before = await counts();
  const dry = await importFile({ format: 'json', content, dryRun: true });
  assert.equal(dry.status, 200);
  assert.equal(dry.data.accepted, false);
  const codes = dry.data.errors.map(e => `${e.line}:${e.field}:${e.code}`);
  for (const expected of ['bomItems[0]:quantity:INVALID_NUMBER', 'bomItems[1]:stateKey:UNKNOWN_BOM_STATE', 'bomItems[7]:null:DUPLICATE_RECORD',
    'costPrices[0]:validTo:INVALID_PERIOD', 'costPrices[1]:currency:INVALID_CODE', 'stockSnapshots[0]:snapshotAt:INVALID_TIMESTAMP',
    'instructions[0]:color:UNKNOWN_FIELD', 'reviewCases[0]:productionQuantity:INVALID_INTEGER', 'bomStates[1]:validFrom:INVALID_DATE']) {
    assert(codes.includes(expected), `${expected} missing in ${codes.join(', ')}`);
  }
  const commit = await importFile({ format: 'json', content, dryRun: false });
  assert.equal(commit.status, 400);
  assert.equal(commit.data.error.code, 'IMPORT_VALIDATION_FAILED');
  assert.deepEqual(await counts(), before);
});

test('format errors: malformed JSON, unsupported format, oversize, bad CSV header and column count', async () => {
  const cases = [
    [{ format: 'json', content: '{"assemblies": [' }, 'JSON_SYNTAX'],
    [{ format: 'xml', content: '<a/>' }, 'UNSUPPORTED_FORMAT'],
    [{ format: 'json', content: JSON.stringify({ x: 'y'.repeat(600 * 1024) }) }, 'FILE_TOO_LARGE'],
    [{ format: 'csv', content: 'type,assemblyCode\nassemblies,X' }, 'CSV_HEADER'],
    [{ format: 'json', content: '{"evil": []}' }, 'UNKNOWN_SECTION'],
  ];
  for (const [body, code] of cases) {
    const r = await importFile({ ...body, dryRun: true });
    assert.equal(r.status, 200, code);
    assert.equal(r.data.accepted, false);
    assert.equal(r.data.errors[0].code, code);
    assert.equal((await importFile({ ...body, dryRun: false })).status, 400, code);
  }
  const header = SAMPLE_CSV.split('\n')[0];
  const r = await importFile({ format: 'csv', content: `${header}\nassemblies,ONLY,TWO\n`, dryRun: true });
  assert.equal(r.data.errors[0].code, 'CSV_COLUMN_COUNT');
  // quoted CSV fields with commas, quotes and line breaks survive parsing
  const parsed = parseCsv('a,b\n"x, ""y""","multi\nline"\nc,d\n');
  assert.deepEqual(parsed.map(r => [...r]), [['a', 'b'], ['x, "y"', 'multi\nline'], ['c', 'd']]);
  assert.deepEqual(parsed.map(r => r.line), [1, 2, 4], 'physical line numbers survive multi-line quoted fields');
});

test('authorization: role required, plants enforced per record, viewers and analysts without the role refused', async () => {
  for (const user of ['cviewer', 'analyst', 'approver']) {
    assert.equal((await importFile({ format: 'json', content: SAMPLE_JSON, dryRun: true }, user)).status, 403, user);
  }
  const foreign = await importFile({ format: 'json', content: SAMPLE_JSON, dryRun: true }, 'importer2000');
  assert.equal(foreign.status, 200);
  assert.equal(foreign.data.accepted, false);
  assert(foreign.data.errors.some(e => e.code === 'PLANT_NOT_AUTHORIZED'));
  assert.equal((await importFile({ format: 'json', content: SAMPLE_JSON, dryRun: false }, 'importer2000')).status, 400);
  const mixed = mutate(d => { d.costPrices[0].plant = '2000'; });
  const r = await importFile({ format: 'json', content: mixed, dryRun: true });
  assert(r.data.errors.some(e => e.code === 'MULTIPLE_PLANTS'), JSON.stringify(r.data.errors));
});

test('commit: records persisted with provenance; the case appears in the worklist and calculates as hand-computed', async () => {
  const before = await counts();
  const r = await importFile({ fileName: 'scenario-import-sample.json', format: 'json', content: SAMPLE_JSON, dryRun: false });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.accepted, true);
  assert.equal(r.data.caseIds.length, 1);
  const after = await counts();
  assert.deepEqual(Object.fromEntries(Object.keys(after).map(k => [k, after[k] - before[k]])),
    { Assemblies: 1, BOMStates: 2, BOMItems: 7, CostPrices: 5, StockSnapshots: 4, Instructions: 1, InstructionReferences: 2, ReviewCases: 1, DataImports: 1 });

  const id = r.data.caseIds[0];
  const listed = await request(`/ReviewCases(${id})?$select=caseNumber,status,sourceType,sourceTypeText,evidenceRef&$expand=sourceImport`, { user: 'cviewer' });
  assert.equal(listed.status, 200);
  assert.equal(listed.data.caseNumber, 'EC-000490');
  assert.equal(listed.data.status, 'OPEN');
  assert.equal(listed.data.sourceType, 'DEMO_IMPORT');
  assert.equal(listed.data.sourceTypeText, 'Demo Import');
  assert.equal(listed.data.evidenceRef, `IMPORT:${r.data.importId}/review_cases/EC-000490`);
  assert.deepEqual([listed.data.sourceImport.ID, listed.data.sourceImport.importedBy, listed.data.sourceImport.fileName, listed.data.sourceImport.checksum],
    [r.data.importId, 'importer', 'scenario-import-sample.json', r.data.checksum]);
  // Plant isolation of the import record.
  assert.equal((await request('/DataImports', { user: 'cviewer2' })).data.value.length, 0);

  // No impact run is imported; the engine computes it. Hand calculation: Rev A 243.40, Rev B 264.60 EUR per assembly.
  const run = await request(`/ReviewCases(${id})/EngineeringReview.runImpact`, { method: 'POST', user: 'importer', body: { asOfDate: '2026-11-08' } });
  assert.equal(run.status, 200, JSON.stringify(run.data));
  assert.deepEqual([run.data.status, run.data.fromCostPerAssembly, run.data.toCostPerAssembly, run.data.costDeltaTotal, run.data.costDeltaPercent,
    run.data.materialsShort, run.data.instructionFindings], ['COMPLETE', '243.40', '264.60', '1590.00', '8.71', 1, 1]);
});

test('re-import of the same file is refused (no overwrite) and leaves the database unchanged', async () => {
  // Self-contained: make sure the sample has been committed once (independent of test order).
  const once = await importFile({ format: 'json', content: SAMPLE_JSON, dryRun: true });
  if (once.data.accepted) assert.equal((await importFile({ format: 'json', content: SAMPLE_JSON, dryRun: false })).status, 200);
  const before = await counts();
  const dry = await importFile({ format: 'csv', content: SAMPLE_CSV, dryRun: true });
  assert.equal(dry.data.accepted, false);
  assert(dry.data.errors.some(e => e.code === 'ALREADY_EXISTS' && e.field === 'caseNumber'));
  assert(dry.data.errors.some(e => e.code === 'OVERLAPPING_PRICE'));
  assert.equal((await importFile({ format: 'csv', content: SAMPLE_CSV, dryRun: false })).status, 400);
  assert.deepEqual(await counts(), before);
});

test('cases the engine would reject are refused at validation (e.g. non-comparable BOM states)', async () => {
  const content = mutate(d => {
    d.assemblies[0].assemblyCode = 'BLOW-901'; for (const k of ['bomStates', 'instructions', 'reviewCases']) d[k].forEach(x => { x.assemblyCode = 'BLOW-901'; });
    d.bomStates.forEach(s => { s.stateKey = s.stateKey.replace('900', '901'); });
    d.bomItems.forEach(i => { i.stateKey = i.stateKey.replace('900', '901'); });
    d.reviewCases[0].fromStateKey = 'BOM-BLOW-901-A'; d.reviewCases[0].toStateKey = 'BOM-BLOW-901-B'; d.reviewCases[0].caseNumber = 'EC-000491';
    d.instructions[0].instructionId = 'WI-BLOW-901-ASM'; d.instructionReferences.forEach(r => { r.instructionId = 'WI-BLOW-901-ASM'; });
    d.costPrices = []; d.stockSnapshots = [];
    d.bomStates[1].alternative = '02';
  });
  const r = await importFile({ format: 'json', content, dryRun: true });
  assert.equal(r.data.accepted, false);
  assert.deepEqual(r.data.errors.map(e => e.code), ['NOT_CALCULABLE_NON_COMPARABLE_BOM_STATES']);
});

test('transactional commit: a failure after the first inserts rolls back every row of the import', async () => {
  const content = mutate(d => {
    d.assemblies[0].assemblyCode = 'ROLL-1';
    for (const k of ['bomStates', 'instructions', 'reviewCases']) d[k].forEach(x => { x.assemblyCode = 'ROLL-1'; });
    d.bomStates.forEach(s => { s.stateKey = s.stateKey.replace('BLOW-900', 'ROLL-1'); });
    d.bomItems.forEach(i => { i.stateKey = i.stateKey.replace('BLOW-900', 'ROLL-1'); });
    d.reviewCases[0].fromStateKey = 'BOM-ROLL-1-A'; d.reviewCases[0].toStateKey = 'BOM-ROLL-1-B'; d.reviewCases[0].caseNumber = 'EC-ROLL-01';
    d.instructions[0].instructionId = 'WI-ROLL-1'; d.instructionReferences.forEach(r => { r.instructionId = 'WI-ROLL-1'; });
    d.costPrices = []; d.stockSnapshots = [];
  });
  const parsed = parseImport(content, 'json');
  const validated = await cds.tx(() => validateBundle(parsed, { plants: ['1000'] }));
  assert.deepEqual(validated.errors, []);
  // Simulate a conflict that appears after validation (e.g. a concurrent import): the case number now exists.
  validated.plan.reviewCases[0].caseNumber = 'EC-000473';
  const before = await counts();
  // The failure happens after the assembly, BOM, price and stock inserts (at the review case insert).
  await assert.rejects(cds.tx(() => commitBundle(validated, { importId: cds.utils.uuid(), user: 'importer', format: 'json', content, meta: {} })),
    /UNIQUE|unique/);
  assert.deepEqual(await counts(), before);
  assert.equal(await SELECT.one.from(E().Assemblies).where({ assemblyCode: 'ROLL-1' }), undefined);
});

test('disabled outside development/test: the feature flag gates the action', async () => {
  const saved = cds.env.features.demo_import;
  cds.env.features.demo_import = false;
  try {
    const r = await importFile({ format: 'json', content: SAMPLE_JSON, dryRun: true });
    assert.equal(r.status, 403);
    assert.equal(r.data.error.code, 'IMPORT_DISABLED');
    assert.equal((await request('/myCapabilities()')).data.canImport, false);
  } finally { cds.env.features.demo_import = saved; }
  assert.equal((await request('/myCapabilities()')).data.canImport, true, 'importer with the flag on');
  assert.equal((await request('/myCapabilities()', { user: 'analyst' })).data.canImport, false, 'role required');
});

test('identifiers of other plants are reported neutrally; a plant-2000 importer learns nothing about plant 1000', async () => {
  const content = mutate(d => {
    for (const k of Object.keys(d)) if (Array.isArray(d[k])) d[k].forEach(r => { if ('plant' in r) r.plant = '2000'; });
    d.reviewCases[0].caseNumber = 'EC-000473'; // exists in plant 1000 only
  });
  const r = await importFile({ format: 'json', content, dryRun: true }, 'importer2000');
  const hit = r.data.errors.find(e => e.field === 'caseNumber');
  assert.equal(hit.code, 'IDENTIFIER_NOT_AVAILABLE');
  assert.doesNotMatch(JSON.stringify(r.data.errors), /already exists/);
  // BOM state keys are per plant: the same key as a plant-1000 state is fine in plant 2000.
  assert(!r.data.errors.some(e => e.field === 'stateKey'), JSON.stringify(r.data.errors));
});

test('database backstops: duplicate BOM state key per plant and duplicate stock snapshot are rejected by constraints', async () => {
  const { BOMStates, StockSnapshots } = E();
  const state = await SELECT.one.from(BOMStates).where({ stateKey: 'BOM-COOL-100-A', plant: '1000' });
  await assert.rejects(cds.tx(() => INSERT.into(BOMStates).entries({ ...state, ID: cds.utils.uuid() })), /UNIQUE|unique/);
  const stock = await SELECT.one.from(StockSnapshots).where({ material: 'FAN-B', plant: '1000' });
  await assert.rejects(cds.tx(() => INSERT.into(StockSnapshots).entries({ ...stock, ID: cds.utils.uuid() })), /UNIQUE|unique/);
});
