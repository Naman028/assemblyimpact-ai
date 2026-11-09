// M05: controlled demo-data import — validation, preview, explicit confirmation, transactional commit,
// provenance, role/plant authorization, no overwrite, rollback on failure, purge of one batch.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { before, after, test } from 'node:test';

process.env.CDS_ENV = 'test';
process.env.CDS_CONFIG = JSON.stringify({ requires: { db: { data: ['db/data', 'db/csv', 'test/data'] } } });
const { default: cds } = await import('@sap/cds');
const SAMPLE = readFileSync(join(import.meta.dirname, '..', 'docs', 'm05', 'demo-import-PRESS-810.json'), 'utf8');
const sample = () => JSON.parse(SAMPLE);
const ENTITIES = ['Assemblies', 'BOMStates', 'BOMItems', 'CostPrices', 'StockSnapshots', 'Instructions', 'InstructionReferences', 'ReviewCases', 'ImportBatches'];
let server, base;

const request = async (path, { user = 'importer', method = 'GET', body } = {}) => {
  const response = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(user ? { authorization: `Basic ${Buffer.from(`${user}:test`).toString('base64')}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = text;
  try { data = JSON.parse(text); } catch { /* not JSON */ }
  return { status: response.status, data, headers: response.headers };
};
const validate = (doc, user) => request('/validateDemoImport', { method: 'POST', user, body: { fileName: 'x.json', content: typeof doc === 'string' ? doc : JSON.stringify(doc) } });
const commit = (doc, user, extra = { confirm: true }) => request('/commitDemoImport', { method: 'POST', user, body: { fileName: 'press.json', content: typeof doc === 'string' ? doc : JSON.stringify(doc), ...extra } });
const counts = async () => Object.fromEntries(await Promise.all(ENTITIES.map(async e => [e, (await SELECT.from(cds.entities('assemblyimpact')[e]).columns('ID')).length])));
const codes = r => r.data.errors.map(e => e.code);

before(async () => {
  server = await cds.server({ port: 0, in_memory: true });
  if (!server.listening) await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}/odata/v4/engineering-review`;
});
after(async () => {
  if (server) await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  await cds.db?.disconnect();
});

test('authorization: role DemoDataManager required; disabled outside development/test', async () => {
  for (const user of ['cviewer', 'analyst', 'approver']) assert.equal((await validate(sample(), user)).status, 403, user);
  assert.equal((await validate(sample(), null)).status, 401);
  const flag = cds.env.requires['demo-import'];
  cds.env.requires['demo-import'] = { enabled: false };
  try {
    const r = await validate(sample());
    assert.equal(r.status, 403);
    assert.match(r.data.error.message, /disabled/);
  } finally { cds.env.requires['demo-import'] = flag; }
});

test('validate: a correct file returns a preview and writes nothing', async () => {
  const before = await counts();
  const r = await validate(sample());
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.ok, true, JSON.stringify(r.data.errors));
  assert.equal(r.data.committed, false);
  assert.deepEqual([r.data.plant, r.data.caseNumber], ['1000', 'EC-000810']);
  assert.match(r.data.sha256, /^[0-9a-f]{64}$/);
  const kinds = r.data.records.map(x => x.kind);
  assert.deepEqual([...new Set(kinds)], ['Assembly', 'BOM revision', 'Material', 'Instruction', 'Review case', 'Totals']);
  assert.match(r.data.records.at(-1).details, /BOMItems 8/);
  assert.deepEqual(await counts(), before, 'validation never writes');
});

test('validate: every rule reports a precise problem', async () => {
  const cases = [
    ['{not json', 'INVALID_JSON'],
    [JSON.stringify({ ...sample(), padding: 'x'.repeat(70 * 1024) }), 'FILE_TOO_LARGE'],
    [{ ...sample(), synthetic: false }, 'NOT_SYNTHETIC'],
    [{ ...sample(), format: 'csv' }, 'UNSUPPORTED_FORMAT'],
    [{ ...sample(), plant: '2000' }, 'PLANT_NOT_AUTHORIZED'],
    [{ ...sample(), plant: '10' }, 'INVALID_PLANT'],
    [(d => { d.materials[0].unit = 'XX'; return d; })(sample()), 'INVALID_UNIT'],
    [(d => { d.materials[1].price = -1; return d; })(sample()), 'INVALID_PRICE'],
    [(d => { d.materials[1].price = 1.234; return d; })(sample()), 'INVALID_PRICE'],
    [(d => { d.materials[2].stock = 'many'; return d; })(sample()), 'INVALID_QUANTITY'],
    [(d => { d.materials[2].snapshotAt = '2099-01-01T00:00:00Z'; return d; })(sample()), 'FUTURE_TIMESTAMP'],
    [(d => { d.materials.push({ ...d.materials[0] }); return d; })(sample()), 'DUPLICATE_IN_FILE'],
    [(d => { d.revisions.B.items[1].material = 'NOPE-1'; return d; })(sample()), 'UNKNOWN_MATERIAL'],
    [(d => { d.revisions.B.items[1].itemNo = '0010'; return d; })(sample()), 'DUPLICATE_IN_FILE'],
    [(d => { d.revisions.B.items[1].quantity = 0; return d; })(sample()), 'INVALID_QUANTITY'],
    [(d => { d.revisions.B.items[1].quantity = 1.2345; return d; })(sample()), 'INVALID_QUANTITY'],
    [(d => { d.revisions.A.validTo = '2026-12-15'; return d; })(sample()), 'OVERLAPPING_REVISIONS'],
    [(d => { d.revisions.A.validFrom = '2026-02-30'; return d; })(sample()), 'INVALID_DATE'],
    [(d => { delete d.revisions.B; return d; })(sample()), 'MISSING_REVISION'],
    [(d => { d.revisions.A.items = []; return d; })(sample()), 'EMPTY_BOM'],
    [(d => { d.instructions[0].appliesToRevision = 'C'; return d; })(sample()), 'UNKNOWN_REVISION'],
    [(d => { d.reviewCase.caseNumber = '810'; return d; })(sample()), 'INVALID_CASE_NUMBER'],
    [(d => { d.reviewCase.productionQuantity = 2.5; return d; })(sample()), 'INVALID_QUANTITY'],
    [(d => { d.reviewCase.caseNumber = 'EC-000473'; return d; })(sample()), 'ALREADY_EXISTS'],
    [(d => { d.assembly.assemblyCode = 'COOL-100'; return d; })(sample()), 'ALREADY_EXISTS'],
    [(d => { d.materials[0].material = 'FAN-A'; d.revisions.A.items[0].material = 'FAN-A'; d.revisions.B.items[0].material = 'FAN-A'; return d; })(sample()), 'ALREADY_EXISTS'],
  ];
  for (const [doc, code] of cases) {
    const r = await validate(doc);
    assert.equal(r.status, 200, `${code}: ${JSON.stringify(r.data)}`);
    assert.equal(r.data.ok, false, code);
    assert(codes(r).includes(code), `${code} expected, got ${codes(r)}`);
    assert.deepEqual(r.data.records, [], `${code}: no preview for an invalid file`);
  }
  assert.equal((await validate('x'.repeat(2 * 1024 * 1024))).status, 413, 'the server body limit applies first for huge uploads');
  assert.equal((await validate(sample(), 'importer2')).data.errors[0].code, 'PLANT_NOT_AUTHORIZED', 'plant-2000 manager cannot import into plant 1000');
});

test('commit: requires explicit confirmation; invalid files write nothing (422)', async () => {
  const before = await counts();
  for (const extra of [{ confirm: false }, {}]) assert.equal((await commit(sample(), 'importer', extra)).status, 400, JSON.stringify(extra));
  const bad = await commit({ ...sample(), synthetic: false });
  assert.equal(bad.status, 422);
  assert.equal(bad.data.error.code, 'IMPORT_INVALID');
  assert.deepEqual(await counts(), before);
});

test('commit: a database failure mid-import rolls everything back', async () => {
  const before = await counts();
  let fail = true;
  cds.db.before('CREATE', cds.entities('assemblyimpact').ReviewCases, req => { if (fail) req.reject(500, 'injected failure after BOM, prices and stock were written'); });
  try {
    const r = await commit(sample());
    assert.equal(r.status, 500);
  } finally { fail = false; }
  assert.deepEqual(await counts(), before, 'no partial import');
});

test('commit: valid file persists with provenance and appears in the worklist; runImpact works on it', async () => {
  const r = await commit(sample());
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.committed, true);
  assert.match(r.headers.get('sap-messages') ?? '', /Imported synthetic case EC-000810/);
  const batch = r.data.batchID;
  const list = await request(`/ReviewCases?$filter=caseNumber eq 'EC-000810'&$select=ID,caseNumber,status,sourceType,sourceTypeText,evidenceRef,assemblyCode`, { user: 'cviewer' });
  const c = list.data.value[0];
  assert.deepEqual([c.status, c.sourceType, c.sourceTypeText, c.assemblyCode], ['OPEN', 'DEMO_IMPORT', 'Demo Import (synthetic)', 'PRESS-810']);
  assert.equal(c.evidenceRef, `DEMO-IMPORT/${batch}/review_cases/EC-000810`);
  assert.equal((await request(`/ReviewCases?$filter=caseNumber eq 'EC-000810'`, { user: 'analyst2' })).data.value.length, 0, 'other plants do not see it');
  const batches = (await request('/ImportBatches')).data.value;
  assert.deepEqual(batches.map(b => [b.ID, b.caseNumber, b.plant, b.importedBy]), [[batch, 'EC-000810', '1000', 'importer']]);
  assert.equal((await request('/ImportBatches', { user: 'importer2' })).data.value.length, 0);
  const run = await request(`/ReviewCases(${c.ID})/EngineeringReview.runImpact`, { method: 'POST', user: 'analyst', body: { asOfDate: '2026-11-08' } });
  assert.equal(run.status, 200, JSON.stringify(run.data));
  assert.equal(run.data.status, 'COMPLETE');
  assert.equal(Number(run.data.costDeltaTotal), 30 * (44.9 - 31.2 + 12.4), 'calculated by the engine from the imported prices');
  // Re-importing the same file never overwrites.
  const again = await validate(sample());
  assert.equal(again.data.ok, false);
  assert(codes(again).includes('ALREADY_EXISTS'));
});

test('purge removes exactly one batch; refused once the case has decisions', async () => {
  const before = await counts();
  const doc = sample();
  doc.assembly.assemblyCode = 'PRESS-811';
  doc.reviewCase.caseNumber = 'EC-000811';
  doc.materials = doc.materials.map(m => ({ ...m, material: `${m.material}-X` }));
  for (const rev of ['A', 'B']) doc.revisions[rev].items = doc.revisions[rev].items.map(i => ({ ...i, material: `${i.material}-X` }));
  doc.instructions[0].steps = doc.instructions[0].steps.map(s => ({ ...s, material: `${s.material}-X` }));
  const sameInstruction = await validate(doc);
  assert(codes(sameInstruction).includes('ALREADY_EXISTS') && sameInstruction.data.errors.some(e => e.path === 'instructions[0].instructionId'), 'existing instruction version is a validation error, not a database error');
  doc.instructions[0].instructionId = 'WI-PRESS-811-ASM';
  const r = await commit(doc);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const caseID = (await request(`/ReviewCases?$filter=caseNumber eq 'EC-000811'`, { user: 'cviewer' })).data.value[0].ID;
  assert.equal((await request(`/ReviewCases(${caseID})/EngineeringReview.runImpact`, { method: 'POST', user: 'analyst', body: { asOfDate: '2026-11-08' } })).status, 200);
  assert.equal((await request('/purgeDemoImport', { method: 'POST', user: 'importer2', body: { batchID: r.data.batchID } })).status, 404, 'other plant');
  assert.equal((await request('/purgeDemoImport', { method: 'POST', user: 'cviewer', body: { batchID: r.data.batchID } })).status, 403);
  assert.equal((await request('/purgeDemoImport', { method: 'POST', body: { batchID: r.data.batchID } })).status, 200);
  assert.deepEqual(await counts(), before, 'every row of the batch (including its impact run) is gone, nothing else');
  // The first batch (EC-000810) gets a decision and can then no longer be purged.
  const kept = (await request('/ImportBatches')).data.value[0];
  const id810 = (await request(`/ReviewCases?$filter=caseNumber eq 'EC-000810'`, { user: 'cviewer' })).data.value[0].ID;
  assert.equal((await request(`/ReviewCases(${id810})/EngineeringReview.submitForReview`, { method: 'POST', user: 'analyst', body: {} })).status, 200);
  const purge = await request('/purgeDemoImport', { method: 'POST', body: { batchID: kept.ID } });
  assert.equal(purge.status, 409);
  assert.equal(purge.data.error.code, 'HAS_DECISIONS');
});
