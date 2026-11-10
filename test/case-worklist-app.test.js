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
  // Phone widths (found on the deployed app at 390 px: only the image column was visible): identifying columns keep
  // High importance, the image column Medium, so case number, assembly and status stay on screen.
  const importance = path => (lineItem.split('</Record>').find(r => r.includes(`Path="${path}"/>`))
    ?.match(/UI\.ImportanceType\/(\w+)/) ?? [])[1];
  for (const path of ['assemblyCode', 'caseNumber', 'status']) assert.equal(importance(path), 'High', path);
  assert.equal(importance('latestRun/costDeltaTotal'), 'Medium');
  const lr = Object.values(manifest['sap.ui5'].routing.targets).find(t => t.options?.settings?.controlConfiguration)?.options.settings.controlConfiguration['@com.sap.vocabularies.UI.v1.LineItem'];
  assert.equal(lr.columns.AssemblyImage.importance, 'Medium');
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
  // M05: plant 1000 holds the oracle case plus the six DS-SCENARIOS-01 cases.
  assert.equal(before.data['@odata.count'], 7);
  assert.deepEqual(before.data.value.filter(c => c.caseNumber === 'EC-000473').map(c => [c.caseNumber, c.assemblyCode, c.status, c.latestRun]), [['EC-000473', 'COOL-100', 'OPEN', null]]);
  const other = await request(`${SVC}${LIST}`, { user: 'analyst2' });
  assert.deepEqual(other.data.value.map(c => c.caseNumber), ['EC-200473']);
  // The action button is shown to everyone; the server decides.
  const run = await request(`${SVC}/ReviewCases(${CASE_1000})/EngineeringReview.runImpact`, { user: 'analyst', method: 'POST', body: { asOfDate: '2026-11-08' } });
  assert.equal(run.status, 200, JSON.stringify(run.data));
  assert.equal((await request(`${SVC}/ReviewCases(${CASE_1000})/EngineeringReview.runImpact`, { user: 'cviewer', method: 'POST', body: { asOfDate: '2026-11-08' } })).status, 403);
  assert.equal((await request(`${SVC}/ReviewCases(${CASE_1000})/EngineeringReview.runImpact`, { user: 'analyst2', method: 'POST', body: { asOfDate: '2026-11-08' } })).status, 404);
  const after = await request(`${SVC}${LIST}`);
  const row = after.data.value.find(c => c.caseNumber === 'EC-000473');
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

test('P3 <-> P4 navigation keeps the case context in both directions', () => {
  const root = join(import.meta.dirname, '..', 'app');
  const wl = JSON.parse(readFileSync(join(root, 'case-worklist', 'webapp', 'manifest.json'), 'utf8'));
  const st = JSON.parse(readFileSync(join(root, 'investigation-studio', 'webapp', 'manifest.json'), 'utf8'));
  // Worklist -> Studio: the existing DataFieldWithUrl in the General field group (no second link is added).
  const annotations = readFileSync(join(root, 'case-worklist', 'annotations.cds'), 'utf8');
  assert.match(annotations, /'\.\.\/\.\.\/launchpad\.html#EngineeringCase-investigate&\/cases\/',\s*\{\$Path: 'ID'\}/);
  assert.equal((annotations.match(/EngineeringCase-investigate/g) || []).length, 1, 'exactly one worklist -> Studio link');
  assert(st['sap.ui5'].routing.routes.some(r => r.name === 'workspace' && r.pattern.startsWith('cases/{caseId}')), 'Studio route matches the link');
  // Studio -> worklist: the same case's object page.
  const ctrl = readFileSync(join(root, 'investigation-studio', 'webapp', 'controller', 'Workspace.controller.js'), 'utf8');
  assert.match(ctrl, /"\.\.\/\.\.\/launchpad\.html#EngineeringCase-manage&\/ReviewCases\(" \+ encodeURIComponent\(this\._caseId\) \+ "\)"/);
  assert(wl['sap.ui5'].routing.routes.some(r => r.name === 'ReviewCasesObjectPage' && r.pattern.startsWith('ReviewCases({key})')), 'worklist route matches the button');
  const view = readFileSync(join(root, 'investigation-studio', 'webapp', 'view', 'Workspace.view.xml'), 'utf8');
  assert.match(view, /id="btnOpenInWorklist"[^>]*press="\.onOpenInWorklist"[^>]*tooltip="[^"]+"/, 'button has an accessible tooltip');
  const xsApp = JSON.parse(readFileSync(join(root, 'router', 'xs-app.json'), 'utf8'));
  for (const app of ['case-worklist', 'investigation-studio']) assert(xsApp.routes.some(r => r.source === `^/${app}/webapp/(.*)$`), `${app} served under the same relative layout`);
});

test('Studio start-up: CaseList reads the OData model from the component in onInit (found in the BAS browser check)', async () => {
  const vm = await import('node:vm');
  const src = readFileSync(join(import.meta.dirname, '..', 'app', 'investigation-studio', 'webapp', 'controller', 'CaseList.controller.js'), 'utf8');
  let factory, deps;
  vm.runInNewContext(src, { sap: { ui: { define: (d, f) => { deps = d; factory = f; } } } });
  const ctrl = factory(...deps.map(d => (d === 'sap/ui/core/mvc/Controller' ? { extend: (n, def) => def } : {})));
  let requested = null;
  const caps = { setProperty: (k, v) => { caps[k] = v; } };
  const self = Object.assign(Object.create(ctrl), {
    // In onInit the view has no default model yet (it is not attached to the component).
    getView: () => ({ getModel: name => (name === 'caps' ? caps : undefined) }),
    getOwnerComponent: () => ({ getModel: () => ({ bindContext: path => { requested = path; return { requestObject: () => Promise.resolve({ canImport: true }), destroy() {} }; } }) }),
  });
  self._loadCapabilities();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(requested, '/myCapabilities()');
  assert.equal(caps['/canImport'], true);
});

test('one application: the launchpad hosts the apps; intents match the apps\' inbounds and component IDs', () => {
  const root = join(import.meta.dirname, '..', 'app');
  const html = readFileSync(join(root, 'launchpad.html'), 'utf8');
  const config = JSON.parse(html.match(/window\["sap-ushell-config"\] = (\{[\s\S]*?\});\n/)[1]
    .replace(/(\w+):/g, '"$1":').replace(/"(https?)":/g, '$1:'));
  for (const [intent, app] of Object.entries(config.applications)) {
    const manifest = JSON.parse(readFileSync(join(root, app.url, 'manifest.json'), 'utf8'));
    assert.equal(app.additionalInformation, `SAPUI5.Component=${manifest['sap.app'].id}`, intent);
    assert(manifest['sap.app'].crossNavigation.inbounds[intent], `${intent} inbound in ${app.url}`);
  }
  assert.deepEqual(Object.keys(config.applications).sort(), ['AssemblyImpact-overview', 'EngineeringCase-investigate', 'EngineeringCase-manage']);
  // The shell's Home opens the landing page.
  assert.equal(config.renderers.fiori2.componentData.config.rootIntent, 'AssemblyImpact-overview');
  // Static assets must resolve to the app folder from both pages (standalone index.html and the launchpad);
  // a page-relative 'assets/...' broke the worklist thumbnails inside the launchpad (BAS walkthrough).
  for (const f of ['AssemblyIllustration', 'AssemblyThumbnail']) {
    const prefix = readFileSync(join(root, 'case-worklist', 'webapp', 'ext', 'fragment', `${f}.fragment.xml`), 'utf8').match(/src="\{= '([^']+)'/)[1];
    for (const page of ['http://host/case-worklist/webapp/index.html', 'http://host/launchpad.html'])
      assert.equal(new URL(prefix, page).pathname, '/case-worklist/webapp/assets/assemblies/', `${f} from ${page}`);
  }
  // Fiori tools (BAS Storyboard / Application Info) find both apps.
  const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'));
  assert.deepEqual(pkg.sapux, ['app/case-worklist', 'app/investigation-studio', 'app/home']);
  for (const app of ['case-worklist', 'investigation-studio', 'home']) assert.match(readFileSync(join(root, app, 'ui5.yaml'), 'utf8'), /type: application/);
});
