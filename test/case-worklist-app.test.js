// P3 Case Worklist: Fiori elements app wiring against the existing EngineeringReview
// service - manifest/model consistency, annotation contract, static serving and the
// OData requests the List Report and Object Pages issue, including authorization.
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
const APP = join(ROOT, 'app', 'case-worklist');
const manifest = JSON.parse(readFileSync(join(APP, 'webapp', 'manifest.json'), 'utf8'));
const seed = buildSeed();
const CASE_1000 = seed.ReviewCases.find(c => c.caseNumber === 'EC-000473').ID;
const CASE_2000 = seed.ReviewCases.find(c => c.caseNumber === 'EC-200473').ID;
let server, root, model;

const request = async (path, { user = 'cviewer', method = 'GET', body } = {}) => {
  const response = await fetch(root + path, {
    method,
    headers: { 'content-type': 'application/json', ...(user ? { authorization: `Basic ${Buffer.from(`${user}:test`).toString('base64')}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = text;
  try { data = JSON.parse(text); } catch { /* non-JSON body */ }
  return { status: response.status, data };
};
const SVC = manifest['sap.app'].dataSources.mainService.uri.replace(/\/$/, '');
// The List Report's request shape: columns incl. latestRun paths (autoExpandSelect).
const LIST = '/ReviewCases?$select=ID,assemblyCode,caseNumber,fromRevision,toRevision,sourceType,status' +
  '&$expand=latestRun($select=ID,instructionFindings,materialsShort,costDeltaTotal)&$orderby=caseNumber&$count=true';

before(async () => {
  server = await cds.server({ port: 0, in_memory: true });
  if (!server.listening) await once(server, 'listening');
  root = `http://127.0.0.1:${server.address().port}`;
  model = cds.model;
});
after(async () => {
  if (server) await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  await cds.db?.disconnect();
});

test('manifest targets the existing EngineeringReview service and resolves against the model', () => {
  const source = manifest['sap.app'].dataSources.mainService;
  assert.equal(source.uri, '/odata/v4/engineering-review/');
  assert.equal(source.settings.odataVersion, '4.0');
  assert.doesNotMatch(JSON.stringify(manifest), /draft/i, 'no draft configuration');
  const { routes, targets } = manifest['sap.ui5'].routing;
  for (const r of routes) assert(targets[r.target], `route ${r.name} -> existing target`);
  const entity = name => model.definitions[`EngineeringReview.${name}`];
  for (const [id, t] of Object.entries(targets)) {
    const { contextPath, navigation = {} } = t.options.settings;
    // Walk "/ReviewCases/runs/findings" through the service's associations.
    const [set, ...path] = contextPath.split('/').filter(Boolean);
    let current = entity(set);
    assert(current, `${id}: entity set ${set}`);
    for (const step of path) {
      const element = current.elements[step];
      assert(element?.target, `${id}: navigation ${step}`);
      current = model.definitions[element.target];
    }
    for (const [nav, cfg] of Object.entries(navigation)) {
      if (nav !== set) assert(current.elements[nav]?.target, `${id}: navigation property ${nav}`);
      assert(routes.some(r => r.name === cfg.detail.route), `${id}: route ${cfg.detail.route}`);
    }
  }
});

test('UI annotations implement the agreed worklist contract without draft', async () => {
  const edmx = cds.compile.to.edmx(model, { service: 'EngineeringReview' });
  const block = target => edmx.match(new RegExp(`<Annotations Target="EngineeringReview\\.${target}">[\\s\\S]*?</Annotations>`))[0];
  const cases = block('ReviewCases');
  const lineItem = cases.match(/Term="UI.LineItem">[\s\S]*?<\/Collection>/)[0];
  const columns = [...lineItem.matchAll(/<PropertyValue Property="Value" Path="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(columns, ['assemblyCode', 'caseNumber', 'fromRevision', 'toRevision', 'latestRun/instructionFindings',
    'latestRun/materialsShort', 'latestRun/costDeltaTotal', 'sourceType', 'status']);
  assert.match(lineItem, /UI.DataFieldForAction[\s\S]*EngineeringReview.runImpact/);
  const filters = [...cases.match(/Term="UI.SelectionFields">[\s\S]*?<\/Collection>/)[0].matchAll(/<PropertyPath>([^<]+)</g)].map(m => m[1]);
  assert.deepEqual(filters, ['assemblyCode', 'plant', 'toRevision', 'status', 'sourceType']);
  for (const facet of ['@UI.FieldGroup#General', '@UI.FieldGroup#Impact', 'runs/@UI.PresentationVariant']) assert(cases.includes(facet), facet);
  const runs = block('ImpactRuns');
  for (const facet of ['findings/@UI.PresentationVariant', 'materialLines/@UI.PresentationVariant', 'comparisonLines/@UI.PresentationVariant']) assert(runs.includes(facet), facet);
  assert.match(block('Findings'), /Property="Criticality">\s*<If>/, 'severity criticality');
  for (const [target, first] of [['ImpactComparisonLines', 'itemNo'], ['ImpactMaterialLines', 'material'], ['Findings', 'type'], ['ImpactRuns', 'computedAt']])
    assert.match(block(target), new RegExp(`UI.PresentationVariant[\\s\\S]*?<PropertyValue Property="Property" PropertyPath="${first}"`), `${target} sorted by ${first}`);
  // Facets target the PresentationVariant so Fiori elements applies the sort order (LineItem targets ignore it).
  assert.doesNotMatch(edmx, /Target="[a-zA-Z]+\/@UI.LineItem"|AnnotationPath="[a-zA-Z]+\/@UI.LineItem"/, 'no table facet bypasses its PresentationVariant');
  assert.doesNotMatch(edmx, /Draft/, 'service stays non-draft');
  const metadata = await request(`${SVC}/$metadata`);
  assert.equal(metadata.status, 200);
  assert.match(metadata.data, /UI.SelectionFields/, 'annotations are served in $metadata');
});

test('CAP serves the app statically', async () => {
  for (const file of ['index.html', 'manifest.json', 'Component.js', 'i18n/i18n.properties']) {
    const r = await request(`/case-worklist/webapp/${file}`, { user: null });
    assert.equal(r.status, 200, file);
  }
  const html = (await request('/case-worklist/webapp/index.html', { user: null })).data;
  assert.match(html, /#container-uiarea/, 'component area gets full height (standalone rendering fix)');
  assert.match(html, /sapui5\.hana\.ondemand\.com\/1\.149\.0\/resources\/sap-ui-core\.js/);
});

test('List Report request returns only the user\'s plant; runImpact fills the columns', async () => {
  const before = await request(`${SVC}${LIST}`);
  assert.equal(before.status, 200, JSON.stringify(before.data));
  assert.equal(before.data['@odata.count'], 1);
  assert.deepEqual(before.data.value.map(c => [c.caseNumber, c.assemblyCode, c.status, c.latestRun]), [['EC-000473', 'COOL-100', 'IN_REVIEW', null]]);
  const other = await request(`${SVC}${LIST}`, { user: 'analyst2' });
  assert.deepEqual(other.data.value.map(c => c.caseNumber), ['EC-200473']);
  // The action button is shown to everyone; the server decides.
  const run = await request(`${SVC}/ReviewCases(${CASE_1000})/EngineeringReview.runImpact`, { user: 'analyst', method: 'POST', body: { asOfDate: '2026-11-08' } });
  assert.equal(run.status, 200, JSON.stringify(run.data));
  assert.equal((await request(`${SVC}/ReviewCases(${CASE_1000})/EngineeringReview.runImpact`, { user: 'cviewer', method: 'POST', body: { asOfDate: '2026-11-08' } })).status, 403);
  assert.equal((await request(`${SVC}/ReviewCases(${CASE_1000})/EngineeringReview.runImpact`, { user: 'analyst2', method: 'POST', body: { asOfDate: '2026-11-08' } })).status, 404);
  const after = await request(`${SVC}${LIST}`);
  const row = after.data.value[0];
  assert.deepEqual([row.latestRun.instructionFindings, row.latestRun.materialsShort, Number(row.latestRun.costDeltaTotal)], [1, 2, 1200]);
});

test('Object Page navigation paths: case -> runs -> findings / material lines, plant-isolated', async () => {
  const runs = await request(`${SVC}/ReviewCases(${CASE_1000})/runs?$orderby=computedAt desc`);
  assert.equal(runs.status, 200);
  const runID = runs.data.value[0].ID;
  const findings = await request(`${SVC}/ReviewCases(${CASE_1000})/runs(${runID})/findings`);
  assert.equal(findings.status, 200);
  assert.equal(findings.data.value.length, 7);
  const finding = findings.data.value[0].ID;
  assert.equal((await request(`${SVC}/ReviewCases(${CASE_1000})/runs(${runID})/findings(${finding})`)).status, 200);
  const lines = await request(`${SVC}/ReviewCases(${CASE_1000})/runs(${runID})/materialLines?$orderby=material`);
  assert.deepEqual(lines.data.value.filter(l => l.status === 'SHORT').map(l => [l.material, Number(l.gap)]), [['BRKT-01', 50], ['FAN-B', 20]]);
  // A plant-2000 user cannot reach the plant-1000 case or its run through any path.
  for (const path of [`/ReviewCases(${CASE_1000})`, `/ReviewCases(${CASE_1000})/runs`, `/ImpactRuns(${runID})`, `/Findings(${finding})`]) {
    const r = await request(`${SVC}${path}`, { user: 'analyst2' });
    assert(r.status === 404 || (r.status === 200 && r.data.value?.length === 0), `${path} -> ${r.status}`);
  }
  assert.equal((await request(`${SVC}/ReviewCases(${CASE_2000})`, { user: 'analyst2' })).status, 200);
  assert.equal((await request(`${SVC}/ReviewCases`, { user: null })).status, 401);
});
