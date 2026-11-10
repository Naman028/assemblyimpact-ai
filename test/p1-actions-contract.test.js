// P1: the SAP Build Actions spec (five operations) against the running CAP service. Every operation is
// executed exactly as SAP Build would call it (relative path under the destination), and each response is
// checked against the spec's response schema: declared properties, types, enums, nullability.
// This replaces a live Actions "Test" run, which is blocked by the missing BTP destination (p1/build-actions/README.md).
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { before, after, test } from 'node:test';
import { buildSeed } from './m04-seed.js';

process.env.CDS_ENV = 'test';
process.env.CDS_CONFIG = JSON.stringify({ requires: { db: { data: ['db/data', 'db/csv', 'test/data'] } } });
const { default: cds } = await import('@sap/cds');
const ROOT = join(import.meta.dirname, '..');
const spec = JSON.parse(readFileSync(join(ROOT, 'p1', 'build-actions', 'assemblyimpact-engineering-actions.openapi.json'), 'utf8'));
const skills = JSON.parse(readFileSync(join(ROOT, 'p1', 'joule', 'skills.json'), 'utf8'));
const seed = buildSeed();
const CASE = seed.ReviewCases.find(c => c.caseNumber === 'EC-000485').ID;
let server, base;

const call = async (method, path, { user = 'analyst', body } = {}) => {
  const response = await fetch(base + path, { method,
    headers: { 'content-type': 'application/json', authorization: `Basic ${Buffer.from(`${user}:test`).toString('base64')}` },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, data: await response.json().catch(() => null) };
};
const resolve = ref => ref.split('/').slice(1).reduce((o, k) => o[k], spec);
const schemaOf = s => (s?.$ref ? resolve(s.$ref) : s?.allOf?.length === 1 ? { ...schemaOf(s.allOf[0]), nullable: s.nullable } : s);

/** Validates `value` against an OpenAPI 3.0 schema subset (object/array/string/integer/number/boolean, enum, nullable, anyOf). */
function check(value, schema, path, seen = 0) {
  schema = schemaOf(schema);
  if (!schema || seen > 6) return;
  if (value === null) { assert(schema.nullable || schema.anyOf, `${path}: null not allowed`); return; }
  if (schema.anyOf) { const errors = []; for (const s of schema.anyOf) { try { check(value, s, path, seen + 1); return; } catch (e) { errors.push(e.message); } } assert.fail(`${path}: ${errors.join(' | ')}`); }
  switch (schema.type) {
    case 'object':
      assert.equal(typeof value, 'object', path);
      for (const [k, v] of Object.entries(value)) {
        if (k.startsWith('@')) continue;
        if (schema.properties?.[k]) check(v, schema.properties[k], `${path}.${k}`, seen + 1);
      }
      break;
    case 'array': assert(Array.isArray(value), path); value.forEach((v, i) => check(v, schema.items, `${path}[${i}]`, seen + 1)); break;
    case 'string': assert.equal(typeof value, 'string', path); if (schema.enum) assert(schema.enum.includes(value), `${path}: ${value} not in enum`); break;
    case 'integer': assert(Number.isInteger(value), `${path}: integer`); break;
    case 'number': assert(typeof value === 'number' || (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)), `${path}: number`); break;
    case 'boolean': assert.equal(typeof value, 'boolean', path); break;
  }
}
const responseSchema = (path, method) => spec.paths[path][method].responses['200'].content['application/json'].schema;

before(async () => {
  server = await cds.server({ port: 0, in_memory: true });
  if (!server.listening) await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}${spec.servers[0].url}`;
});
after(async () => {
  if (server) await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  await cds.db?.disconnect();
});

test('the spec exposes the three original operations plus two read-only ones from PR #11', () => {
  const ops = Object.entries(spec.paths).flatMap(([p, m]) => Object.entries(m).map(([verb, o]) => `${verb.toUpperCase()} ${p} ${o.operationId}`));
  assert.deepEqual(ops.sort(), ['GET /ImpactRuns({ID}) GetEngineeringImpact', 'GET /ReviewCases FindEngineeringCases',
    'GET /ReviewCases({ID})/decisions GetDecisionHistory', 'GET /lookupCases LookupEngineeringCases',
    'POST /ReviewCases({ID})/EngineeringReview.runImpact RunEngineeringImpact']);
  const writes = Object.values(spec.paths).flatMap(m => Object.keys(m)).filter(v => v !== 'get');
  assert.deepEqual(writes, ['post'], 'RunEngineeringImpact is the only write');
});

test('RunEngineeringImpact -> GetEngineeringImpact -> FindEngineeringCases: responses conform to the spec', async () => {
  const run = await call('POST', `/ReviewCases(${CASE})/EngineeringReview.runImpact`, { body: { asOfDate: '2026-11-08' } });
  assert.equal(run.status, 200, JSON.stringify(run.data));
  check(run.data, responseSchema('/ReviewCases({ID})/EngineeringReview.runImpact', 'post'), 'RunEngineeringImpact');

  const impact = await call('GET', `/ImpactRuns(${run.data.ID})?$expand=findings,materialLines,comparisonLines`, { user: 'cviewer' });
  assert.equal(impact.status, 200);
  check(impact.data, responseSchema('/ImpactRuns({ID})', 'get'), 'GetEngineeringImpact');
  assert.equal(impact.data.findings.length, 10);

  const list = await call('GET', `/ReviewCases?$filter=${encodeURIComponent("status eq 'OPEN'")}&$expand=latestRun&$count=true`, { user: 'cviewer' });
  assert.equal(list.status, 200);
  check(list.data, responseSchema('/ReviewCases', 'get'), 'FindEngineeringCases');
  assert.equal(list.data['@odata.count'], 7);
});

test('documented error statuses: 403 for a viewer running impact, 404 across plants', async () => {
  assert.equal((await call('POST', `/ReviewCases(${CASE})/EngineeringReview.runImpact`, { user: 'cviewer', body: {} })).status, 403);
  assert.equal((await call('POST', `/ReviewCases(${CASE})/EngineeringReview.runImpact`, { user: 'analyst2', body: {} })).status, 404);
  assert.equal((await call('GET', `/ReviewCases(${CASE})`, { user: 'analyst2' })).status, 404);
});

test('Joule skill design maps every skill to an existing operation and keeps decisions out of the agent', () => {
  const operationIds = Object.values(spec.paths).flatMap(m => Object.values(m).map(o => o.operationId));
  assert.deepEqual(skills.skills.map(s => s.name), ['find_engineering_cases', 'explain_case_impact', 'run_engineering_impact', 'review_decision_history']);
  for (const s of skills.skills) {
    for (const step of s.steps) if (step.action) assert(operationIds.includes(step.action), `${s.name}: ${step.action}`);
    for (const code of [401, 403, 404]) assert(s.errorHandling[String(code)], `${s.name} handles ${code}`);
  }
  assert.equal(skills.skills.find(s => s.name === 'run_engineering_impact').confirmationRequired, true);
  assert(!JSON.stringify(skills.skills.map(s => s.steps)).match(/approve|reject|submitForReview/i), 'no review decision is delegated to Joule');
  assert.deepEqual(skills.identities.reader.roles, ['ChangeViewer']);
  assert.deepEqual(skills.identities.impactRunner.roles, ['ChangeViewer', 'ImpactRunner']);
  for (const s of skills.skills) {
    const writes = JSON.stringify(s.steps).includes('RunEngineeringImpact');
    assert.equal(s.requiredRoleCollection, writes ? 'AssemblyImpact_JouleImpactRunner' : 'AssemblyImpact_JouleReader', `${s.name} role`);
    if (writes) assert(s.steps.some(st => st.confirm), `${s.name} asks for confirmation`);
  }
  for (const s of skills.skills) assert.match(JSON.stringify(s.steps), /value is empty|not exactly 1/, `${s.name} handles an empty result`);
  // Review finding: no skill builds an OData $filter from user input; single-case skills stop unless exactly one case matches.
  for (const s of skills.skills) {
    assert.equal(s.steps[0].action, 'LookupEngineeringCases', `${s.name} starts with the named lookup`);
    assert.doesNotMatch(JSON.stringify(s.steps), /\$filter=/, `${s.name} builds no $filter`);
    if (s.name !== 'find_engineering_cases') assert.equal(s.steps[1].condition, 'value length is not exactly 1', s.name);
  }
  assert.equal(skills.skills.find(s => s.name === 'find_engineering_cases').steps[0].action, 'LookupEngineeringCases', 'named parameters, no $filter string');
});

test('Joule identity (ChangeViewer + ImpactRunner): reads and runs impact in its plant; everything else is refused by the server', async () => {
  const run = await call('POST', `/ReviewCases(${CASE})/EngineeringReview.runImpact`, { user: 'joule', body: { asOfDate: '2026-11-08' } });
  assert.equal(run.status, 200, JSON.stringify(run.data));
  assert.equal(run.data.computedBy, 'joule', 'attributed to the calling identity');
  assert.equal((await call('GET', `/ReviewCases(${CASE})?$select=canRunImpact,canSubmit,canDecide`, { user: 'joule' })).data.canSubmit, false);
  for (const action of ['submitForReview', 'approve', 'rejectCase']) {
    const r = await call('POST', `/ReviewCases(${CASE})/EngineeringReview.${action}`, { user: 'joule', body: { comment: 'x', basedOnRun: run.data.ID } });
    assert.equal(r.status, 403, action);
  }
  assert.equal((await call('POST', '/importScenario', { user: 'joule', body: { format: 'json', content: '{}', dryRun: true } })).status, 403);
  const other = seed.ReviewCases.find(c => c.caseNumber === 'EC-200473').ID;
  assert.equal((await call('POST', `/ReviewCases(${other})/EngineeringReview.runImpact`, { user: 'joule', body: {} })).status, 404, 'foreign plant');
});

test('LookupEngineeringCases: named filters, caller plants only, validated input, conforms to the spec', async () => {
  const path = '/lookupCases', schema = responseSchema(path, 'get');
  const all = await call('GET', path, { user: 'cviewer' });
  assert.equal(all.status, 200, JSON.stringify(all.data));
  check(all.data, schema, 'LookupEngineeringCases');
  assert(all.data.value.length > 0 && all.data.value.every(c => c.plant === '1000'), 'only plant 1000');
  const one = await call('GET', `${path}(caseNumber='EC-000485')`, { user: 'joulereader' });
  assert.equal(one.status, 200, JSON.stringify(one.data));
  assert.deepEqual(one.data.value.map(c => c.caseNumber), ['EC-000485']);
  assert.equal(one.data.value[0].ID, CASE, 'returns the key the single-case skills need');
  assert.equal((await call('GET', `${path}(caseNumber='EC-200473')`, { user: 'cviewer' })).data.value.length, 0, 'foreign plant is invisible');
  assert.equal((await call('GET', `${path}(caseNumber='EC-200473')`, { user: 'analyst2' })).data.value.length, 1, 'visible in its own plant');
  assert.equal((await call('GET', `${path}(caseNumber='x'' or 1=1')`, { user: 'cviewer' })).status, 400, 'malformed input refused');
  assert.equal((await call('GET', `${path}(status='DONE')`, { user: 'cviewer' })).status, 400);
  // The form the published spec describes (quoted query values, as SAP Build sends them) and the plain query form.
  const param = spec.paths[path].get.parameters.find(p => p.name === 'caseNumber');
  assert.equal(param.in, 'query');
  for (const q of [`?caseNumber='EC-000485'`, '?caseNumber=EC-000485', `?status='OPEN'&assemblyCode='HYD-700'`]) {
    const r = await call('GET', path + q, { user: 'cviewer' });
    assert.equal(r.status, 200, `${q}: ${JSON.stringify(r.data)}`);
    assert.deepEqual(r.data.value.map(c => c.caseNumber), ['EC-000485'], q);
  }
});

test('GetDecisionHistory conforms to the spec and is plant-restricted', async () => {
  const history = await call('GET', `/ReviewCases(${CASE})/decisions?$orderby=at`, { user: 'joulereader' });
  assert.equal(history.status, 200, JSON.stringify(history.data));
  check(history.data, responseSchema('/ReviewCases({ID})/decisions', 'get'), 'GetDecisionHistory');
  assert.equal((await call('GET', `/ReviewCases(${CASE})/decisions`, { user: 'analyst2' })).status, 404);
});

test('Joule reader identity (ChangeViewer only) cannot run impact or decide', async () => {
  assert.equal((await call('POST', `/ReviewCases(${CASE})/EngineeringReview.runImpact`, { user: 'joulereader', body: {} })).status, 403);
  for (const action of ['submitForReview', 'approve', 'rejectCase'])
    assert.equal((await call('POST', `/ReviewCases(${CASE})/EngineeringReview.${action}`, { user: 'joulereader', body: { comment: 'x' } })).status, 403, action);
});

test('Joule destination narrows the exchanged token to ChangeViewer + ImpactRunner', () => {
  const dest = JSON.parse(readFileSync(join(ROOT, 'p1', 'joule', 'destination.template.json'), 'utf8'));
  const xs = JSON.parse(readFileSync(join(ROOT, 'xs-security.json'), 'utf8'));
  assert.equal(dest.Authentication, 'OAuth2JWTBearer', 'principal propagation');
  const scopes = dest.scope.split(' ');
  assert.deepEqual(scopes.map(s => s.replace('<xsappname>.', '')).sort(), ['ChangeViewer', 'ImpactRunner']);
  for (const s of scopes) assert(xs.scopes.some(x => x.name === s.replace('<xsappname>', '$XSAPPNAME')), `${s} exists in xs-security.json`);
});
