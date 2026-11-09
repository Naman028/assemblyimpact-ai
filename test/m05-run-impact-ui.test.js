// M05 targeted UI corrections for Run Impact: refresh after the action (side effects), a result
// message, readable status/source labels and currency formatting. The calculation is unchanged.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { join } from 'node:path';
import { before, after, test } from 'node:test';
import { buildSeed } from './m04-seed.js';

process.env.CDS_ENV = 'test';
process.env.CDS_CONFIG = JSON.stringify({ requires: { db: { data: ['db/data', 'db/csv', 'test/data'] } } });
const { default: cds } = await import('@sap/cds');
const ROOT = join(import.meta.dirname, '..');
const SVC = '/odata/v4/engineering-review';
const CASE = buildSeed().ReviewCases.find(c => c.caseNumber === 'EC-000473').ID;
let server, root;

const request = async (path, { user = 'analyst', method = 'GET', body } = {}) => {
  const response = await fetch(root + path, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Basic ${Buffer.from(`${user}:test`).toString('base64')}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = text;
  try { data = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: response.status, data, headers: response.headers };
};

before(async () => {
  server = await cds.server({ port: 0, in_memory: true });
  if (!server.listening) await once(server, 'listening');
  root = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  await cds.db?.disconnect();
});

test('UI annotations: side effects on runImpact, readable labels, currency for unit price', async () => {
  const model = await cds.load([join(ROOT, 'srv'), join(ROOT, 'app', 'case-worklist', 'annotations.cds')]);
  const edmx = cds.compile.to.edmx(model, { service: 'EngineeringReview' });
  const action = edmx.match(/<Annotations Target="EngineeringReview\.runImpact\(EngineeringReview\.ReviewCases\)">[\s\S]*?<\/Annotations>/)?.[0];
  assert.ok(action, 'action annotations exist');
  assert.match(action, /Term="Common\.SideEffects"/);
  for (const target of ['in/latestRun', 'in/runs']) assert.match(action, new RegExp(`<NavigationPropertyPath>${target}</NavigationPropertyPath>`), target);
  assert.match(action, /<String>in\/latestRun_ID<\/String>/);
  assert.match(edmx, /<Annotations Target="EngineeringReview\.ReviewCases\/status">[\s\S]*?Term="Common\.Text" Path="statusText"[\s\S]*?TextArrangement/);
  assert.match(edmx, /<Annotations Target="EngineeringReview\.ReviewCases\/sourceType">[\s\S]*?Term="Common\.Text" Path="sourceTypeText"/);
  assert.match(edmx, /<Annotations Target="EngineeringReview\.ImpactMaterialLines\/unitPrice">[\s\S]*?Term="Measures\.ISOCurrency" Path="run\/currency"/);
});

test('readable labels are served next to the unchanged codes', async () => {
  const labels = async () => {
    const r = await request(`${SVC}/ReviewCases(${CASE})?$select=status,statusText,sourceType,sourceTypeText`);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return [r.data.status, r.data.statusText, r.data.sourceType, r.data.sourceTypeText];
  };
  // Seeded cases start OPEN (M04 Slice 2a); the analyst submits through the real action.
  assert.deepEqual(await labels(), ['OPEN', 'Open', 'SYNTHETIC_FIXTURE', 'Synthetic Fixture']);
  assert.equal((await request(`${SVC}/ReviewCases(${CASE})/EngineeringReview.submitForReview`, { method: 'POST', body: {} })).status, 200);
  assert.deepEqual(await labels(), ['IN_REVIEW', 'In Review', 'SYNTHETIC_FIXTURE', 'Synthetic Fixture']);
  const filtered = await request(`${SVC}/ReviewCases?$filter=status eq 'IN_REVIEW'&$select=caseNumber`);
  assert.deepEqual(filtered.data.value.map(c => c.caseNumber), ['EC-000473'], 'filtering still uses codes');
});

test('runImpact returns a result message with the persisted figures; viewers still get 403', async () => {
  const r = await request(`${SVC}/ReviewCases(${CASE})/EngineeringReview.runImpact`, { method: 'POST', body: { asOfDate: '2026-11-08' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const messages = JSON.parse(r.headers.get('sap-messages') ?? '[]');
  assert.equal(messages.length, 1);
  assert.equal(messages[0].message, 'Impact calculated as of 2026-11-08 (COMPLETE): estimated cost delta 1200.00 EUR, 2 material(s) short, 1 outdated instruction reference(s).');
  assert.equal(Number(r.data.costDeltaTotal), 1200, 'response is the persisted run');
  const denied = await request(`${SVC}/ReviewCases(${CASE})/EngineeringReview.runImpact`, { user: 'cviewer', method: 'POST', body: { asOfDate: '2026-11-08' } });
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get('sap-messages'), null);
});
