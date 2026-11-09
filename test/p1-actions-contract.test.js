// P1: the SAP Build Actions spec (three operations) against the running CAP service. Every operation is
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

test('the spec exposes exactly the three operations the SAP Build project was created with', () => {
  const ops = Object.entries(spec.paths).flatMap(([p, m]) => Object.entries(m).map(([verb, o]) => `${verb.toUpperCase()} ${p} ${o.operationId}`));
  assert.deepEqual(ops.sort(), ['GET /ImpactRuns({ID}) GetEngineeringImpact', 'GET /ReviewCases FindEngineeringCases',
    'POST /ReviewCases({ID})/EngineeringReview.runImpact RunEngineeringImpact']);
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
  assert.deepEqual(skills.skills.map(s => s.name), ['find_engineering_cases', 'explain_case_impact', 'run_engineering_impact']);
  for (const s of skills.skills) {
    for (const step of s.steps) if (step.action) assert(operationIds.includes(step.action), `${s.name}: ${step.action}`);
    for (const code of [401, 403, 404]) assert(s.errorHandling[String(code)], `${s.name} handles ${code}`);
  }
  assert.equal(skills.skills.find(s => s.name === 'run_engineering_impact').confirmationRequired, true);
  assert(!JSON.stringify(skills.skills.map(s => s.steps)).match(/approve|reject|submitForReview/i), 'no review decision is delegated to Joule');
  assert.deepEqual(skills.technicalIdentity.roles, ['ChangeViewer', 'ChangeAnalyst']);
});
