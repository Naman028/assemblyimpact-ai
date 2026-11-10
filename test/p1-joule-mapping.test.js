// P1: focused checks of the Joule skill mappings (EU10 Joule Studio) against the real CAP service.
// The Joule formulas are reproduced literally:
//   quote(x)        = ConcatenateStrings(["'", x, "'"], "")        (Engineering Case Lookup, all skills' lookup step)
//   idOf(value, f)  = ConcatenateStrings(Map(value, f), "")         (impact ID, decisions ID, run-impact ID)
//   costDelta(v)    = StringToNumber(ConcatenateStrings([v], ""))  (Explain Case Impact, output costDeltaTotal: Number)
//   available(v)    = Not(IsEmptyString(ConcatenateStrings([v], "")))  (output costDeltaAvailable: Boolean)
// Joule's ConcatenateStrings is assumed to render null as "" (not verifiable without a runtime call; see EU10-STATUS).
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { before, after, test } from 'node:test';

process.env.CDS_ENV = 'test';
process.env.CDS_CONFIG = JSON.stringify({ requires: { db: { data: ['db/data', 'db/csv', 'test/data'] } } });
const { default: cds } = await import('@sap/cds');
let server, base;

const call = async (method, path, { user = 'joule', body } = {}) => {
  const response = await fetch(base + path, { method,
    headers: { 'content-type': 'application/json', authorization: `Basic ${Buffer.from(`${user}:test`).toString('base64')}` },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, data: await response.json().catch(() => null) };
};
const quote = x => ConcatenateStrings(["'", x, "'"]);
function ConcatenateStrings(parts, sep = '') { return parts.map(p => (p === null || p === undefined ? '' : String(p))).join(sep); }
const idOf = (value, field) => ConcatenateStrings(value.map(v => v[field]));
// Exactly as SAP Build sends LookupEngineeringCases: query parameters, values URL-encoded by the Actions runtime.
const lookupQ = (params, user) => call('GET', `/lookupCases?${Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`, { user });
const runCount = async () => (await cds.run(SELECT.one.from('assemblyimpact.ImpactRuns').columns('count(1) as n'))).n;

before(async () => {
  server = await cds.server({ port: 0, in_memory: true });
  if (!server.listening) await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}/odata/v4/engineering-review`;
});
after(async () => {
  if (server) await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  await cds.db?.disconnect();
});

test('escaping: valid quoted case number resolves exactly one case in the caller plant', async () => {
  const r = await lookupQ({ caseNumber: quote('EC-000473') });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.value.length, 1);
  assert.equal(r.data.value[0].caseNumber, 'EC-000473');
  assert.equal(r.data.value[0].plant, '1000');
});

test('escaping: quotes, OData injection and malformed values are refused with 4xx, never widened', async () => {
  for (const [field, raw] of [['caseNumber', "EC-000473' or caseNumber ne '"], ['assemblyCode', "O'Brien"], ['status', "OPEN' or '1'='1"],
    ['caseNumber', 'ec-000473'], ['caseNumber', 'EC-473'], ['assemblyCode', 'cool-100']]) {
    const r = await lookupQ({ [field]: quote(raw) });
    assert.ok(r.status >= 400 && r.status < 500, `${field}=${raw} -> ${r.status} ${JSON.stringify(r.data)}`);
    assert.ok(!r.data?.value, 'no rows returned');
  }
});

test('cross-plant: the plant-2000 mirror is invisible to a plant-1000 Joule user', async () => {
  const r = await lookupQ({ caseNumber: quote('EC-200473') });
  assert.equal(r.status, 200);
  assert.equal(r.data.value.length, 0);
});

test('one-case resolution: zero matches give an empty ID and every downstream call fails closed', async () => {
  const r = await lookupQ({ caseNumber: quote('EC-999999') });
  assert.equal(r.data.value.length, 0);
  const id = idOf(r.data.value, 'ID');
  assert.equal(id, '');
  const before = await runCount();
  assert.ok((await call('GET', `/ImpactRuns(${id})`)).status >= 400);
  assert.ok((await call('GET', `/ReviewCases(${id})/decisions`)).status >= 400);
  assert.ok((await call('POST', `/ReviewCases(${id})/EngineeringReview.runImpact`, { body: {} })).status >= 400);
  assert.equal(await runCount(), before, 'no impact run was written');
});

test('one-case resolution: a blank case number matches several cases; the concatenated ID is rejected, nothing is written', async () => {
  const r = await lookupQ({ caseNumber: quote('') });
  assert.equal(r.status, 200);
  assert.ok(r.data.value.length > 1, 'blank filter returns all cases of the plant (documented)');
  const before = await runCount();
  for (const [field, path, method] of [['latestRun_ID', id => `/ImpactRuns(${id})`, 'GET'], ['ID', id => `/ReviewCases(${id})/decisions`, 'GET'],
    ['ID', id => `/ReviewCases(${id})/EngineeringReview.runImpact`, 'POST']]) {
    const id = idOf(r.data.value, field);
    const res = await call(method, path(id), method === 'POST' ? { body: {} } : {});
    assert.ok(res.status >= 400, `${method} with concatenated ${field} -> ${res.status}`);
  }
  assert.equal(await runCount(), before, 'no impact run was written');
});

test('authorization: ChangeViewer cannot run impact; ImpactRunner can only in its own plant', async () => {
  const own = (await lookupQ({ caseNumber: quote('EC-000473') })).data.value;
  assert.equal((await call('POST', `/ReviewCases(${idOf(own, 'ID')})/EngineeringReview.runImpact`, { user: 'cviewer', body: {} })).status, 403);
  const foreign = (await lookupQ({ caseNumber: quote('EC-200473') }, 'cviewer2')).data.value;
  assert.equal(foreign.length, 1);
  assert.equal((await call('POST', `/ReviewCases(${idOf(foreign, 'ID')})/EngineeringReview.runImpact`, { user: 'joule', body: {} })).status, 404);
});

test('costDeltaTotal: Joule conversion keeps sign and cents; null stays detectable via costDeltaAvailable', async () => {
  const costDelta = v => Number(ConcatenateStrings([v]));
  const available = v => ConcatenateStrings([v]) !== '';
  for (const v of ['1200.00', '-1200.00', 1200, -0.01, '0.00']) {
    assert.equal(costDelta(v).toFixed(2), Number(v).toFixed(2), `value ${v}`);
    assert.equal(available(v), true);
  }
  assert.equal(available(null), false, 'INCOMPLETE runs (costDeltaTotal null) are flagged, not reported as a number');
  // Decimal(17,2): exact in binary64 only while |value| * 100 <= 2^53 (about 90 trillion). Larger values lose cents.
  assert.equal(costDelta('90071992547409.91').toFixed(2), '90071992547409.91');
  assert.notEqual(costDelta('999999999999999.99').toFixed(2), '999999999999999.99');
  // Real response shape for a run from the service.
  const own = (await lookupQ({ caseNumber: quote('EC-000485') }, 'analyst')).data.value;
  const run = await call('POST', `/ReviewCases(${idOf(own, 'ID')})/EngineeringReview.runImpact`, { user: 'analyst', body: { asOfDate: '2026-11-08' } });
  assert.equal(run.status, 200, JSON.stringify(run.data));
  const impact = await call('GET', `/ImpactRuns(${run.data.ID})`, { user: 'cviewer' });
  const v = impact.data.costDeltaTotal;
  assert.ok(v === null || ['number', 'string'].includes(typeof v));
  if (v !== null) assert.equal(costDelta(v).toFixed(2), Number(v).toFixed(2));
  else assert.equal(impact.data.status, 'INCOMPLETE');
});
