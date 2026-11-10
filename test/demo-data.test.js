// Faculty demo data management: controlled synthetic input edits (Scenario C) and supporting images.
// Proves that an edited input changes the next calculation by exactly the expected amount, that earlier runs
// stay immutable, and that edits and uploads are refused outside their allowed scope.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { before, after, test } from 'node:test';
import { buildSeed } from './m04-seed.js';

process.env.CDS_ENV = 'test';
process.env.CDS_CONFIG = JSON.stringify({ requires: { db: { data: ['db/data', 'db/csv', 'test/data'] } } });
const { default: cds } = await import('@sap/cds');
const seed = buildSeed();
const idOf = n => seed.ReviewCases.find(c => c.caseNumber === n).ID;
const today = new Date().toISOString().slice(0, 10);
let server, base;

const call = async (method, path, { user = 'importer', body, raw, type } = {}) => {
  const headers = { authorization: `Basic ${Buffer.from(`${user}:test`).toString('base64')}` };
  if (raw) headers['content-type'] = type; else if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(base + path, { method, headers, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
  const ct = response.headers.get('content-type') ?? '';
  const data = ct.includes('json') ? await response.json() : Buffer.from(await response.arrayBuffer());
  return { status: response.status, data, type: ct };
};
const run = async id => {
  const r = await call('POST', `/ReviewCases(${id})/EngineeringReview.runImpact`, { user: 'analyst', body: { asOfDate: today } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
};
const revise = (id, body, user = 'importer') => call('POST', `/ReviewCases(${id})/EngineeringReview.reviseDemoInput`, { user, body });
const money = v => Number(v).toFixed(2);

before(async () => {
  server = await cds.server({ port: 0, in_memory: true });
  if (!server.listening) await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}/odata/v4/engineering-review`;
});
after(async () => {
  if (server) await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  await cds.db?.disconnect();
});

test('Scenario C: a changed proposed quantity changes the next run by exactly qty x price x production quantity', async () => {
  const id = idOf('EC-000485');
  const first = await run(id);
  const r = await revise(id, { kind: 'PROPOSED_QUANTITY', itemNo: '0040', value: 7 }); // FIT-700 6 -> 7, 6.80 EUR, 60 assemblies
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.latestRun_ID, null, 'latestRun cleared: the next decision needs a new calculation');
  const second = await run(id);
  assert.equal(money(second.costDeltaTotal - first.costDeltaTotal), '408.00');
  const lines = (await call('GET', `/ImpactRuns(${second.ID})/materialLines?$filter=material eq 'FIT-700'`, { user: 'cviewer' })).data.value;
  assert.equal(Number(lines[0].required), 420);
  const old = (await call('GET', `/ImpactRuns(${first.ID})`, { user: 'cviewer' })).data;
  assert.equal(money(old.costDeltaTotal), money(first.costDeltaTotal), 'earlier run unchanged (immutable)');
  const audit = (await call('GET', `/DataImports?$filter=format eq 'edit'`, { user: 'cviewer' })).data.value;
  assert(audit.some(a => /EC-000485: PROPOSED_QUANTITY 0040 6 -> 7/.test(a.source)), 'edit recorded in DataImports');
});

test('Scenario C: price and stock edits change cost and shortage as expected', async () => {
  const id = idOf('EC-000485');
  const before = await run(id);
  assert.equal((await revise(id, { kind: 'PRICE', material: 'PSENS-700', value: 80 })).status, 200); // 74.00 -> 80.00, x1, 60
  const priced = await run(id);
  assert.equal(money(priced.costDeltaTotal - before.costDeltaTotal), '360.00');
  assert.equal((await revise(id, { kind: 'STOCK', material: 'FIT-700', value: 1000 })).status, 200);
  const stocked = await run(id);
  assert.equal(stocked.materialsShort, priced.materialsShort - 1, 'FIT-700 no longer short');
});

test('edits are refused outside their scope', async () => {
  const id = idOf('EC-000485');
  assert.equal((await revise(id, { kind: 'PRICE', material: 'PSENS-700', value: 1 }, 'analyst')).status, 403, 'needs DemoDataImporter');
  assert.equal((await revise(id, { kind: 'PROPOSED_QUANTITY', itemNo: '0040', value: 2 }, 'importer2000')).status, 404, 'foreign plant');
  for (const [body, code] of [
    [{ kind: 'DELETE_ALL', value: 1 }, 'INVALID_KIND'],
    [{ kind: 'PROPOSED_QUANTITY', itemNo: '0040', value: 0 }, 'INVALID_VALUE'],
    [{ kind: 'PROPOSED_QUANTITY', itemNo: '9999', value: 1 }, 'ITEM_NOT_FOUND'],
    [{ kind: 'PRICE', material: 'COOL-FAN-1', value: 1 }, 'MATERIAL_NOT_IN_CASE'],
    [{ kind: 'STOCK', material: 'FIT-700', value: -1 }, 'INVALID_VALUE'],
  ]) {
    const r = await revise(id, body);
    assert.equal(r.data.error?.code, code, JSON.stringify(body));
  }
  // Not OPEN: submitted for review -> read-only inputs.
  const sub = idOf('EC-000486');
  await run(sub);
  assert.equal((await call('POST', `/ReviewCases(${sub})/EngineeringReview.submitForReview`, { user: 'analyst', body: {} })).status, 200);
  assert.equal((await revise(sub, { kind: 'STOCK', material: 'COIL-800', value: 1 })).data.error?.code, 'CASE_NOT_EDITABLE');
});

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000' + '1f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4b30000000049454e44ae426082', 'hex');

test('supporting image: create, upload once, read back in plant; validated type and size', async () => {
  const caseID = idOf('EC-000484');
  const created = await call('POST', '/CaseAttachments', { user: 'analyst', body: { reviewCase_ID: caseID, fileName: '../../etc/conv guard.png', mediaType: 'image/png', description: 'Guard sketch' } });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.fileName, 'conv_guard.png', 'path and unsafe characters removed');
  assert.equal(created.data.uploadedBy, 'analyst');
  const id = created.data.ID;
  assert.equal((await call('PUT', `/CaseAttachments(${id})/content`, { user: 'analyst', raw: Buffer.from('<svg onload=alert(1)>'), type: 'image/png' })).status, 415, 'not a PNG');
  assert.equal((await call('PUT', `/CaseAttachments(${id})/content`, { user: 'analyst', raw: PNG, type: 'image/png' })).status, 204);
  assert.equal((await call('PUT', `/CaseAttachments(${id})/content`, { user: 'analyst', raw: PNG, type: 'image/png' })).status, 409, 'immutable once uploaded');
  const meta = (await call('GET', `/CaseAttachments(${id})`, { user: 'cviewer' })).data;
  assert.equal(meta.size, PNG.length);
  assert.match(meta.sha256, /^[0-9a-f]{64}$/);
  const img = await call('GET', `/CaseAttachments(${id})/content`, { user: 'cviewer' });
  assert.equal(img.status, 200);
  assert.match(img.type, /image\/png/);
  assert(img.data.equals(PNG), 'bytes round-trip');
  const raw = await fetch(`${base}/CaseAttachments(${id})/content`, { headers: { authorization: `Basic ${Buffer.from('cviewer:test').toString('base64')}` } });
  assert.equal(raw.headers.get('x-content-type-options'), 'nosniff', 'no content sniffing on served images');
  assert.equal((await call('GET', `/CaseAttachments(${id})/content`, { user: 'cviewer2' })).status, 404, 'other plant cannot read');
  assert.equal((await call('PATCH', `/CaseAttachments(${id})`, { user: 'analyst', body: { fileName: 'x.png' } })).status, 400, 'metadata immutable');
});

test('supporting image: refused for viewers, other plants, wrong types, oversize and decided cases', async () => {
  const caseID = idOf('EC-000484');
  const body = { reviewCase_ID: caseID, fileName: 'a.png', mediaType: 'image/png' };
  assert.equal((await call('POST', '/CaseAttachments', { user: 'cviewer', body })).status, 403);
  assert.equal((await call('POST', '/CaseAttachments', { user: 'analyst2', body })).status, 404);
  assert.equal((await call('POST', '/CaseAttachments', { user: 'analyst', body: { ...body, mediaType: 'image/svg+xml' } })).status, 415);
  const jpg = await call('POST', '/CaseAttachments', { user: 'analyst', body: { ...body, fileName: 'b.jpg', mediaType: 'image/jpeg' } });
  assert.equal((await call('PUT', `/CaseAttachments(${jpg.data.ID})/content`, { user: 'analyst', raw: PNG, type: 'image/jpeg' })).status, 415, 'PNG declared as JPEG');
  const big = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]);
  const large = await call('POST', '/CaseAttachments', { user: 'analyst', body: { ...body, fileName: 'c.png' } });
  assert.equal((await call('PUT', `/CaseAttachments(${large.data.ID})/content`, { user: 'analyst', raw: big, type: 'image/png' })).status, 413);
  assert.equal((await call('DELETE', `/CaseAttachments(${large.data.ID})`, { user: 'analyst' })).status, 204, 'undecided case: removable');
  // Decided case (real workflow: run, submit, independent rejection): attachments are decision evidence.
  const decided = idOf('EC-000483');
  const r = await run(decided);
  assert.equal((await call('POST', `/ReviewCases(${decided})/EngineeringReview.submitForReview`, { user: 'analyst', body: {} })).status, 200);
  const rej = await call('POST', `/ReviewCases(${decided})/EngineeringReview.reject`, { user: 'approver', body: { comment: 'Seal supplier not qualified', basedOnRun: r.ID } });
  assert.equal(rej.status, 200, JSON.stringify(rej.data));
  const late = await call('POST', '/CaseAttachments', { user: 'analyst', body: { ...body, reviewCase_ID: decided } });
  assert.equal(late.status, 409);
  assert.equal(late.data.error.code, 'CASE_DECIDED');
});

test('Scenario B: the Create Scenario form bundle passes server validation, imports and calculates', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const vm = await import('node:vm');
  let builder;
  vm.runInNewContext(readFileSync(join(import.meta.dirname, '..', 'app', 'investigation-studio', 'webapp', 'lib', 'scenarioBuilder.js'), 'utf8'),
    { sap: { ui: { define: (d, f) => { builder = f(); } } }, Date });
  const form = builder.example();
  assert.equal(builder.check(form).length, 0, JSON.stringify(builder.check(form)));
  assert.equal(builder.check({ ...form, components: [], productionQuantity: 0 }).length, 3, 'empty form refused client-side');
  const content = JSON.stringify(builder.build(form));
  const imp = (dryRun, user = 'importer') => call('POST', '/importScenario', { user, body: { fileName: 'form-EC-000495', format: 'json', content, dryRun } });
  const dry = await imp(true);
  assert.equal(dry.status, 200, JSON.stringify(dry.data));
  assert.equal(dry.data.accepted, true, JSON.stringify(dry.data.errors));
  assert.equal(dry.data.preview[0].caseNumber, 'EC-000495');
  const done = await imp(false);
  assert.equal(done.status, 200, JSON.stringify(done.data));
  const caseID = done.data.caseIds[0];
  const r = await run(caseID);
  // Per assembly: MOT-950 95.00 -> MOT-950E 128.00 (+33.00), SEAL-950 1 -> 2 (+11.50) = +44.50; x 120 = 5340.00
  assert.equal(money(r.costDeltaTotal), '5340.00');
  assert.equal(r.materialsShort, 2, 'MOT-950E needs 120 (60 in stock), SEAL-950 needs 240 (180)');
  assert(r.instructionFindings >= 1, 'work instruction still references the replaced motor');
  assert.equal((await imp(false)).status, 400, 'the same scenario cannot be imported twice');
});

test('Studio Edit Input: the quantity option lists revision B items and sends the item number (BAS walkthrough defect)', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const vm = await import('node:vm');
  const src = readFileSync(join(import.meta.dirname, '..', 'app', 'investigation-studio', 'webapp', 'controller', 'Workspace.controller.js'), 'utf8');
  let factory, deps;
  vm.runInNewContext(src, { sap: { ui: { define: (d, f) => { deps = d; factory = f; } } } });
  // Like sap.m.Select before rendering: getSelectedKey() is '' unless a key was set.
  class Select {
    constructor(s = {}) { this.key = s.selectedKey ?? ''; this.items = []; this.handlers = []; }
    getSelectedKey() { return this.key; } setSelectedKey(k) { this.key = k; return this; }
    addItem(i) { this.items.push(i); return this; } destroyItems() { this.items = []; return this; }
    attachChange(f) { this.handlers.push(f); return this; }
  }
  class Item { constructor(s) { Object.assign(this, s); } }
  class Input { constructor() { this.v = ''; } getValue() { return this.v; } setValue(v) { this.v = v; return this; } }
  class Control { constructor(s) { Object.assign(this, s); } addStyleClass() { return this; } }
  const stubs = { 'sap/ui/core/mvc/Controller': { extend: (n, def) => def }, 'sap/m/Select': Select, 'sap/ui/core/Item': Item, 'sap/m/Input': Input,
    'sap/m/MessageStrip': Control, 'sap/m/Label': Control, 'sap/m/MessageBox': { warning() {} }, 'sap/ui/core/library': { InvisibleMessageMode: {} } };
  const ctrl = factory(...deps.map(d => stubs[d] ?? {}));
  let content, ok, executed;
  const self = Object.assign(Object.create(ctrl), {
    getView: () => ({ getModel: () => ({ getProperty: () => [
      { itemNo: '0020', fromMaterial: 'MOT-950', toMaterial: 'MOT-950E', toQuantity: '1', unit: 'PC' },
      { itemNo: '0030', fromMaterial: 'SEAL-950', toMaterial: 'SEAL-950', toQuantity: '2', unit: 'PC' }] }) }),
    _dialog: (title, c, text, type, onOk) => { content = c; ok = onOk; },
    _execute: (action, params) => { executed = { action, params }; },
  });
  self.onEditInput();
  const [, , kind, , target, , value] = content;
  assert.equal(kind.getSelectedKey(), 'PROPOSED_QUANTITY');
  assert.deepEqual(target.items.map(i => i.key), ['0020', '0030'], 'revision B item numbers, not materials');
  target.setSelectedKey('0030'); value.setValue('3');
  ok();
  assert.equal(executed.action, 'reviseDemoInput');
  assert.equal(executed.params.itemNo, '0030');
  assert.equal(executed.params.kind, 'PROPOSED_QUANTITY');
});
