// P1: JouleReader technical identity and the named-parameter lookupCases function.
// Mocked identities stand in for XSUAA client-credentials tokens (role system-user + scope JouleReader).
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { before, after, test } from 'node:test';
import { buildSeed } from './m04-seed.js';
import { jouleReaderPlants } from '../srv/lib/plants.js';

process.env.CDS_ENV = 'test';
process.env.CDS_CONFIG = JSON.stringify({ requires: { db: { data: ['db/data', 'db/csv', 'test/data'] } } });
const { default: cds } = await import('@sap/cds');
const seed = buildSeed();
const CASE_1000 = seed.ReviewCases.find(c => c.caseNumber === 'EC-000473').ID;
const CASE_2000 = seed.ReviewCases.find(c => c.caseNumber === 'EC-200473').ID;
let server, base;

const request = async (path, { user = 'joule', method = 'GET', body } = {}) => {
  const response = await fetch(base + path, { method, headers: { 'content-type': 'application/json', authorization: `Basic ${Buffer.from(`${user}:test`).toString('base64')}` },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  try { return { status: response.status, data: JSON.parse(text) }; } catch { return { status: response.status, data: text }; }
};

before(async () => {
  server = await cds.server({ port: 0, in_memory: true });
  if (!server.listening) await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}/odata/v4/engineering-review`;
  const run = await request(`/ReviewCases(${CASE_1000})/EngineeringReview.runImpact`, { user: 'analyst', method: 'POST', body: { asOfDate: '2026-11-08' } });
  assert.equal(run.status, 200);
});
after(async () => {
  if (server) await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  await cds.db?.disconnect();
});

test('identity rule (unit): technical client only, no business roles, configured plants only', () => {
  const user = roles => ({ is: r => roles.includes(r) });
  assert.deepEqual(jouleReaderPlants(user(['JouleReader', 'system-user']), ['1000']), ['1000']);
  assert.equal(jouleReaderPlants(user(['JouleReader']), ['1000']), null, 'not a technical client');
  assert.equal(jouleReaderPlants(user(['system-user']), ['1000']), null, 'system-user alone is not enough');
  assert.equal(jouleReaderPlants(user(['JouleReader', 'system-user', 'ChangeApprover']), ['1000']), null, 'no mixing with business roles');
  for (const bad of [undefined, [], ['*'], [''], ['10000'], '1000']) assert.equal(jouleReaderPlants(user(['JouleReader', 'system-user']), bad), null, JSON.stringify(bad));
});

test('JouleReader reads the review data of its configured plant only', async () => {
  const cases = await request('/ReviewCases?$select=caseNumber,plant');
  assert.equal(cases.status, 200, JSON.stringify(cases.data));
  assert(cases.data.value.length === 6 && cases.data.value.every(c => c.plant === '1000'));
  assert.equal((await request(`/ReviewCases(${CASE_2000})`)).status, 404, 'other plant looks missing');
  const run = await request(`/ReviewCases(${CASE_1000})/latestRun?$expand=findings,materialLines`);
  assert.equal(run.status, 200);
  assert.equal(Number(run.data.costDeltaTotal), 1200);
  assert.equal(run.data.findings.length, 7);
  assert.equal((await request(`/ReviewCases(${CASE_1000})/decisions`)).status, 200);
  // Master data outside the P1 scope is not readable.
  for (const set of ['BOMItems', 'CostPrices', 'StockSnapshots', 'Instructions', 'ImportBatches']) assert.equal((await request(`/${set}`)).status, 403, set);
});

test('JouleReader cannot change anything', async () => {
  for (const action of ['runImpact', 'submitForReview', 'approve', 'reject'])
    assert.equal((await request(`/ReviewCases(${CASE_1000})/EngineeringReview.${action}`, { method: 'POST', body: action === 'runImpact' ? { asOfDate: '2026-11-08' } : { comment: 'x' } })).status, 403, action);
  assert([403, 405].includes((await request('/ReviewCases', { method: 'POST', body: { caseNumber: 'EC-999999' } })).status));
  assert.equal((await request('/validateDemoImport', { method: 'POST', body: { content: '{}' } })).status, 403);
});

test('other identities holding JouleReader are refused; missing configuration refuses everything', async () => {
  for (const user of ['joulehuman', 'joulemixed']) assert.equal((await request('/ReviewCases', { user })).status, 403, user);
  const config = cds.env.requires.joule;
  cds.env.requires.joule = undefined;
  try { assert.equal((await request('/ReviewCases')).status, 403); } finally { cds.env.requires.joule = config; }
  cds.env.requires.joule = { plants: ['*'] };
  try { assert.equal((await request('/ReviewCases')).status, 403, 'wildcard plants are never accepted'); } finally { cds.env.requires.joule = config; }
});

test('lookupCases: named parameters, validated, plant-filtered, includes latest run figures', async () => {
  const all = await request('/lookupCases()');
  assert.equal(all.status, 200, JSON.stringify(all.data));
  assert.deepEqual(all.data.value.map(c => c.caseNumber), ['EC-000473', 'EC-000512', 'EC-000538', 'EC-000561', 'EC-000587', 'EC-000703']);
  const one = (await request("/lookupCases(caseNumber='EC-000473',status=null,assemblyCode=null)")).data.value;
  assert.deepEqual(one.map(c => [c.caseNumber, c.assemblyCode, c.statusText, c.latestRunStatus, Number(c.costDeltaTotal), c.materialsShort]),
    [['EC-000473', 'COOL-100', 'Open', 'COMPLETE', 1200, 2]]);
  assert.equal((await request("/lookupCases(caseNumber='EC-200473',status=null,assemblyCode=null)")).data.value.length, 0, 'other plant');
  assert.equal((await request("/lookupCases(caseNumber=null,status=null,assemblyCode='GEAR-210')")).data.value[0].latestRunStatus, null, 'no run yet');
  for (const bad of ["caseNumber='473',status=null,assemblyCode=null", "caseNumber=null,status='DONE',assemblyCode=null", "caseNumber=null,status=null,assemblyCode='x y'"])
    assert.equal((await request(`/lookupCases(${bad})`)).status, 400, bad);
  assert.equal((await request('/lookupCases()', { user: 'cviewer' })).data.value.length, 6, 'business users can use it too');
  assert.equal((await request('/lookupCases()', { user: 'maintainer' })).status, 403);
});
