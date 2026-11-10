// P2: S/4HANA adapter — contract mapping, HTTP transport against a local mock of the OData V2 APIs,
// mode guards and provenance, and the CAP action end to end (extract -> validate -> commit -> runImpact).
// No real SAP system is called; the sandbox and S/4 modes are tested only for their configuration guards.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { before, after, test } from 'node:test';

process.env.CDS_ENV = 'test';
process.env.CDS_CONFIG = JSON.stringify({ requires: { db: { data: ['db/data', 'db/csv', 'test/data'] } } });
const { default: cds } = await import('@sap/cds');
const { rowsOf, odataDate, mapBomStates, mapStock, mapPrices, MappingError } = await import('../srv/integration/erp/s4-mapping.js');
const { extract, httpTransport, fixtureTransport, transportFor, queries, readAll, ErpConfigError, ErpTransportError, MODE_SOURCE_TYPE } = await import('../srv/integration/erp/erp-source.js');
const { validateBundle, commitBundle } = await import('../srv/lib/scenario-import.js');
const { calculateImpact } = await import('../srv/lib/impact-calculator.js');
const DIR = join(import.meta.dirname, 'fixtures', 'p2', 's4-contract');
const fx = name => JSON.parse(readFileSync(join(DIR, `${name}.json`), 'utf8'));
const SELECTION = { material: 'PMP-4711', plant: '1000', bomUsage: '1', alternative: '1', fromDate: '2026-12-01', toDate: '2027-01-01',
  caseNumber: 'EC-S4-0001', title: 'Impeller change PMP-4711 (ECN 500000000012)', productionQuantity: 100 };
const NOW = '2026-11-09T10:00:00.000Z';
let server, base, mock, mockUrl, mockRequests = [];

const request = async (path, { user = 'erp', method = 'GET', body } = {}) => {
  const response = await fetch(base + path, { method,
    headers: { 'content-type': 'application/json', authorization: `Basic ${Buffer.from(`${user}:test`).toString('base64')}` },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let data = text;
  try { data = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: response.status, data };
};

before(async () => {
  // Local mock of the three S/4HANA OData V2 services (serves the contract fixtures, checks the API key).
  mock = createServer((req, res) => {
    mockRequests.push({ url: req.url, apiKey: req.headers.apikey });
    if (req.headers.apikey !== 'test-key') { res.writeHead(401); return res.end(); }
    const entity = /\/(A_[A-Za-z]+)\?/.exec(req.url)?.[1];
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(readFileSync(join(DIR, `${entity}.json`)));
  });
  mock.listen(0);
  await once(mock, 'listening');
  mockUrl = `http://127.0.0.1:${mock.address().port}`;
  server = await cds.server({ port: 0, in_memory: true });
  if (!server.listening) await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}/odata/v4/engineering-review`;
});
after(async () => {
  mock?.close();
  if (server) await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  await cds.db?.disconnect();
});

test('mapping primitives: V2 payload shapes, Edm.DateTime, numbers', () => {
  assert.equal(rowsOf({ d: { results: [1, 2] } }).length, 2);
  assert.equal(rowsOf({ value: [1] }).length, 1);
  assert.equal(odataDate('/Date(1798761600000)/'), '2027-01-01');
  assert.equal(odataDate('/Date(1798761600000+0000)/'), '2027-01-01');
  assert.equal(odataDate('2027-01-01T00:00:00'), '2027-01-01');
  assert.throws(() => odataDate('/Date(x)/'), MappingError);
});

test('BOM: date-effective items give the current and the proposed state; units mapped; ECN recorded', () => {
  const header = rowsOf(fx('A_BillOfMaterial'))[0];
  const { bomStates, bomItems } = mapBomStates({ header, items: rowsOf(fx('A_BillOfMaterialItem')), fromDate: '2026-12-01', toDate: '2027-01-01' });
  assert.deepEqual(bomStates.map(s => [s.revision, s.validFrom, s.validTo, s.status, s.changeNumber ?? null, s.alternative]),
    [['D20261201', '2026-12-01', '2026-12-31', 'RELEASED', null, '01'], ['D20270101', '2027-01-01', '9999-12-31', 'PROPOSED', null, '01']]);
  assert.deepEqual(bomStates.map(s => s.stateKey), ['S4-PMP-4711-101-20261201', 'S4-PMP-4711-101-20270101']);
  const byState = day => bomItems.filter(i => i.stateKey.endsWith(day)).map(i => `${i.itemNo}:${i.material}x${i.quantity}${i.unit}`);
  assert.deepEqual(byState('20261201'), ['0010:HSG-4711x1PC', '0020:IMP-4711-Ax1PC', '0030:SCREW-M5x6PC', '0050:CLIP-4711x2PC']);
  assert.deepEqual(byState('20270101'), ['0010:HSG-4711x1PC', '0020:IMP-4711-Bx1PC', '0030:SCREW-M5x8PC', '0040:SEAL-4711x1PC']);
  assert.throws(() => mapBomStates({ header, items: [], fromDate: '2026-12-01', toDate: '2027-01-01' }), { code: 'ERP_EMPTY_BOM' });
  assert.throws(() => mapBomStates({ header, items: [], fromDate: '2027-01-01', toDate: '2026-12-01' }), { code: 'ERP_DATES' });
});

test('stock: unrestricted only, special stock and other stock types excluded, summed over storage locations', () => {
  const stock = mapStock(rowsOf(fx('A_MatlStkInAcctMod')), { plant: '1000', retrievedAt: NOW });
  assert.deepEqual(Object.fromEntries(stock.map(s => [s.material, s.availableQuantity])),
    { 'CLIP-4711': '300', 'HSG-4711': '150', 'IMP-4711-A': '75', 'IMP-4711-B': '40', 'SCREW-M5': '5000', 'SEAL-4711': '80' });
  assert(stock.every(s => s.unit === 'PC' && s.snapshotAt === NOW));
});

test('prices: standard price of the plant valuation area; other areas and split valuation ignored; price unit kept', () => {
  const prices = mapPrices(rowsOf(fx('A_ProductValuation')), { plant: '1000', validFrom: '2026-11-09' });
  assert.deepEqual(prices.map(p => [p.material, p.price, p.priceUnit, p.currency]), [
    ['CLIP-4711', '0.4', 1, 'EUR'], ['HSG-4711', '45', 1, 'EUR'], ['IMP-4711-A', '30', 1, 'EUR'], ['IMP-4711-B', '36.5', 1, 'EUR'],
    ['SCREW-M5', '4', 100, 'EUR'], ['SEAL-4711', '1.2', 1, 'EUR']]);
});

test('extract over HTTP (mock S/4 OData V2): exact query contract, validated bundle, hand-calculated impact', async () => {
  mockRequests = [];
  const bundle = await extract({ transport: httpTransport({ baseUrl: mockUrl, headers: { APIKey: 'test-key' } }), mode: 'sandbox', selection: SELECTION, now: NOW });
  assert.deepEqual(mockRequests.map(r => r.url.split('?')[0]).sort(), ['/sap/opu/odata/sap/API_BILL_OF_MATERIAL_SRV/A_BillOfMaterial',
    '/sap/opu/odata/sap/API_BILL_OF_MATERIAL_SRV/A_BillOfMaterialItem', '/sap/opu/odata/sap/API_MATERIAL_STOCK_SRV/A_MatlStkInAcctMod',
    '/sap/opu/odata/sap/API_PRODUCT_SRV/A_ProductValuation']);
  assert(mockRequests.every(r => r.apiKey === 'test-key'));
  assert.equal(decodeURIComponent(mockRequests[0].url.split('$filter=')[1].split('&')[0]),
    "Material eq 'PMP-4711' and Plant eq '1000' and BillOfMaterialVariantUsage eq '1' and BillOfMaterialVariant eq '1'");
  assert.match(queries({ ...SELECTION, material: "X'Y" }).header, /X''Y/, 'quotes escaped in $filter');
  assert.match(bundle.source, /sandbox \(SAP API sandbox, not business data\)/);

  const v = await cds.tx(() => validateBundle({ records: Object.fromEntries(Object.entries(bundle).filter(([, x]) => Array.isArray(x))) }, { plants: ['1000'], sourceType: 'SANDBOX_IMPORT' }));
  assert.deepEqual(v.errors, []);
  // Hand calculation: current 45 + 30 + 6 x 0.04 + 2 x 0.40 = 76.04; proposed 45 + 36.50 + 8 x 0.04 + 1.20 = 83.02 EUR.
  const r = calculateImpact({ asOfDate: '2026-11-09', reviewCase: { caseNumber: 'EC-S4-0001', assemblyCode: 'PMP-4711', plant: '1000',
    fromStateKey: bundle.bomStates[0].stateKey, toStateKey: bundle.bomStates[1].stateKey, productionQuantity: '100' },
  bomStates: bundle.bomStates, bomItems: bundle.bomItems, costPrices: bundle.costPrices, stockSnapshots: bundle.stockSnapshots, instructions: [], instructionReferences: [] });
  assert.deepEqual([r.status, r.cost.fromPerAssembly, r.cost.toPerAssembly, r.cost.deltaTotal, r.cost.deltaPercent, r.summary.materialsShort],
    ['COMPLETE', '76.04', '83.02', '698.00', '9.18', 2]);
  assert.deepEqual(Object.fromEntries(r.comparison.map(l => [l.itemNo, l.change])),
    { '0010': 'UNCHANGED', '0020': 'REPLACED', '0030': 'QUANTITY_CHANGED', '0040': 'ADDED', '0050': 'REMOVED' });
  await assert.rejects(extract({ transport: httpTransport({ baseUrl: mockUrl, headers: { APIKey: 'wrong' } }), mode: 'sandbox', selection: SELECTION }), { code: 'ERP_UNAVAILABLE' });
});

test('modes: unconfigured sandbox and S/4 are refused; source types never mislabel sandbox or synthetic data', () => {
  assert.deepEqual(MODE_SOURCE_TYPE, { synthetic: 'DEMO_IMPORT', sandbox: 'SANDBOX_IMPORT', s4: 'S4_IMPORT' });
  delete process.env.SAP_API_HUB_KEY;
  assert.throws(() => transportFor('sandbox'), ErpConfigError);
  assert.throws(() => transportFor('s4'), ErpConfigError);
  assert.throws(() => transportFor('other'), ErpConfigError);
  assert.equal(typeof transportFor('synthetic'), 'function');
  assert.equal(typeof fixtureTransport(DIR), 'function');
});

test('CAP action: role and plant checks, dry run, commit with provenance, then runImpact on the extracted case', async () => {
  const body = { mode: 'synthetic', ...SELECTION, fromDate: SELECTION.fromDate, dryRun: true };
  delete body.description;
  assert.equal((await request('/extractFromErp', { method: 'POST', user: 'analyst', body })).status, 403, 'role required');
  assert.equal((await request('/extractFromErp', { method: 'POST', body: { ...body, plant: '2000' } })).status, 403, 'plant');
  const s4 = await request('/extractFromErp', { method: 'POST', body: { ...body, mode: 's4' } });
  // Development/test select FIXTURE explicitly (erp-source.mode): another mode is refused, not attempted.
  assert.equal(s4.status, 409); assert.equal(s4.data.error.code, 'ERP_MODE_NOT_ACTIVE');
  const dry = await request('/extractFromErp', { method: 'POST', body });
  assert.equal(dry.status, 200, JSON.stringify(dry.data));
  assert.equal(dry.data.accepted, true, JSON.stringify(dry.data.errors));
  assert.deepEqual(dry.data.preview.map(p => [p.caseNumber, p.fromRevision, p.toRevision, p.fromItems, p.toItems]), [['EC-S4-0001', 'D20261201', 'D20270101', 4, 4]]);
  const commit = await request('/extractFromErp', { method: 'POST', body: { ...body, dryRun: false } });
  assert.equal(commit.status, 200, JSON.stringify(commit.data));
  const id = commit.data.caseIds[0];
  const rc = await request(`/ReviewCases(${id})?$expand=sourceImport`);
  assert.deepEqual([rc.data.sourceType, rc.data.sourceImport.format, rc.data.sourceImport.sourceType], ['DEMO_IMPORT', 'odata', 'DEMO_IMPORT']);
  assert.match(rc.data.sourceImport.source, /^erp-adapter:synthetic/);
  const today = new Date().toISOString().slice(0, 10);
  const run = await request(`/ReviewCases(${id})/EngineeringReview.runImpact`, { method: 'POST', body: { asOfDate: today } });
  assert.equal(run.status, 200, JSON.stringify(run.data));
  assert.deepEqual([run.data.costDeltaTotal, run.data.materialsShort], ['698.00', 2]);
  const again = await request('/extractFromErp', { method: 'POST', body: { ...body, dryRun: false } });
  assert.equal(again.status, 400, 'the same case number is not imported twice');
});

test('real-world item rows: text and deleted items ignored; configured validity-end convention applied consistently', () => {
  const header = rowsOf(fx('A_BillOfMaterial'))[0];
  const items = rowsOf(fx('A_BillOfMaterialItem'));
  const end = '/Date(' + Date.parse('2027-01-01T00:00:00Z') + ')/';
  // S/4 variant: the superseded record ends ON the successor's start date.
  const exclusive = items.map(i => (/2026-12-31|1798675200000/.test(String(i.ValidityEndDate)) || odataDate(i.ValidityEndDate) === '2026-12-31' ? { ...i, ValidityEndDate: end } : i));
  const extra = [
    { ...items[0], BillOfMaterialItemNumber: '0090', BillOfMaterialItemCategory: 'T', BillOfMaterialComponent: '' },
    { ...items[0], BillOfMaterialItemNumber: '0095', BillOfMaterialComponent: 'OLD-PART', IsDeleted: true },
  ];
  // CLIP-4711 (removed) also ends on 2027-01-01 in the exclusive representation, so it must disappear too.
  const { bomItems } = mapBomStates({ header, items: [...exclusive, ...extra], fromDate: '2026-12-01', toDate: '2027-01-01', validityEnd: 'exclusive' });
  const proposed = bomItems.filter(i => i.stateKey.endsWith('20270101')).map(i => `${i.itemNo}:${i.material}x${i.quantity}`);
  assert.deepEqual(proposed, ['0010:HSG-4711x1', '0020:IMP-4711-Bx1', '0030:SCREW-M5x8', '0040:SEAL-4711x1']);
  assert(!bomItems.some(i => ['OLD-PART', ''].includes(i.material)));
  // The same rows read with the wrong convention are detectably wrong (duplicate item numbers), not silently merged.
  const wrong = mapBomStates({ header, items: exclusive, fromDate: '2026-12-01', toDate: '2027-01-01' }).bomItems.filter(i => i.stateKey.endsWith('20270101'));
  assert(wrong.length > new Set(wrong.map(i => i.itemNo)).size);
  assert.throws(() => mapBomStates({ header, items, fromDate: '2026-12-01', toDate: '2027-01-01', validityEnd: 'maybe' }), { code: 'ERP_CONFIG' });
});

test('paging and chunking: __next links are followed, long material lists are split, truncation is refused', async () => {
  const pages = { '/p1': { d: { results: [{ a: 1 }], __next: 'http://mock/p2' } }, '/p2': { d: { results: [{ a: 2 }] } } };
  const transport = async path => pages[path.replace('http://mock', '')];
  assert.deepEqual((await readAll(transport, '/p1')).map(r => r.a), [1, 2]);
  const endless = async () => ({ d: { results: [{}], __next: '/again' } });
  await assert.rejects(readAll(endless, '/again'), { code: 'ERP_TOO_LARGE' });
  const seen = [];
  const recording = async path => { seen.push(path); return { d: { results: path.includes('A_BillOfMaterial?') ? rowsOf(fx('A_BillOfMaterial')) : path.includes('A_BillOfMaterialItem') ? manyItems : [] } }; };
  const base = rowsOf(fx('A_BillOfMaterialItem'))[0];
  const manyItems = Array.from({ length: 95 }, (_, k) => ({ ...base, BillOfMaterialItemNumber: String(10 * (k + 1)).padStart(4, '0'), BillOfMaterialComponent: `PART-${k}` }));
  await extract({ transport: recording, mode: 'synthetic', selection: SELECTION, now: NOW });
  assert.equal(seen.filter(p => p.includes('A_MatlStkInAcctMod')).length, 3, '95 materials -> 3 chunks of at most 40');
  assert(seen.every(p => p.length < 4000), 'URLs stay short');
});

test('upstream failures are reported as 502-class transport errors, not as client errors', async () => {
  await assert.rejects(extract({ transport: httpTransport({ baseUrl: mockUrl, headers: { APIKey: 'wrong' } }), mode: 'sandbox', selection: SELECTION }),
    e => e instanceof ErpTransportError && e.upstreamStatus === 401);
  await assert.rejects(extract({ transport: httpTransport({ baseUrl: 'http://127.0.0.1:9', timeoutMs: 2000 }), mode: 'sandbox', selection: SELECTION }),
    e => e instanceof ErpTransportError);
  await assert.rejects(httpTransport({ baseUrl: mockUrl })('https://evil.example/x'), e => e instanceof ErpTransportError);
});

test('a second engineering change of the same material, and shared components, are extracted (merge policy)', async () => {
  const body = { mode: 'synthetic', ...SELECTION, caseNumber: 'EC-S4-0002', title: 'Second change PMP-4711', dryRun: false };
  const first = await request('/extractFromErp', { method: 'POST', body: { ...body, caseNumber: 'EC-S4-0003', title: 'Baseline', fromDate: '2026-11-01', toDate: '2026-12-01' } });
  assert.equal(first.status, 200, JSON.stringify(first.data));
  const second = await request('/extractFromErp', { method: 'POST', body });
  assert.equal(second.status, 200, JSON.stringify(second.data));
  const { Assemblies, BOMStates, CostPrices } = cds.entities('assemblyimpact');
  assert.equal((await SELECT.from(Assemblies).where({ assemblyCode: 'PMP-4711', plant: '1000' })).length, 1, 'assembly reused');
  assert.equal((await SELECT.from(BOMStates).where({ stateKey: 'S4-PMP-4711-101-20261201', plant: '1000' })).length, 1, 'same-date state reused');
  const prices = await SELECT.from(CostPrices).where({ material: 'HSG-4711', plant: '1000' });
  assert.equal(prices.length, 1, 'identical price reused, not duplicated');
  // A changed ERP price closes the previous period instead of being refused.
  const v = fx('A_ProductValuation');
  const later = { ...SELECTION, caseNumber: 'EC-S4-0004', title: 'Price moved' };
  const changed = { d: { results: v.d.results.map(r => (r.Product === 'HSG-4711' && r.ValuationArea === '1000' && !r.ValuationType ? { ...r, StandardPrice: '48.00' } : r)) } };
  const transport = async path => (path.includes('A_ProductValuation') ? changed : fixtureTransport(DIR)(path));
  // Next calendar day (UTC), and less than 24 h ahead, i.e. within the validator's one-day clock tolerance.
  // (Was now + 20 h, which stays on the same date before 04:00 UTC and made the test fail at night.)
  const midnight = new Date(); midnight.setUTCHours(24, 1, 0, 0);
  const nextDay = midnight.toISOString();
  const bundle = await extract({ transport, mode: 'synthetic', selection: later, now: nextDay });
  const result = await cds.tx(async () => {
    const validated = await validateBundle({ records: Object.fromEntries(Object.entries(bundle).filter(([, x]) => Array.isArray(x))) }, { plants: ['1000'], sourceType: 'DEMO_IMPORT', policy: 'erp-merge' });
    assert.deepEqual(validated.errors, []);
    await commitBundle(validated, { importId: cds.utils.uuid(), user: 'erp', format: 'odata', content: JSON.stringify(bundle), meta: {} });
    return SELECT.from(CostPrices).columns('price', 'validFrom', 'validTo').where({ material: 'HSG-4711', plant: '1000' }).orderBy('validFrom');
  });
  assert.deepEqual(result.map(p => [String(Number(p.price)), String(p.validFrom).slice(0, 10), String(p.validTo).slice(0, 10)]),
    [['45', new Date().toISOString().slice(0, 10), new Date(Date.parse(`${nextDay.slice(0, 10)}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)],
      ['48', nextDay.slice(0, 10), '9999-12-31']]);
});
