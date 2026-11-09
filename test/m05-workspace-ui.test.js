// M05/P4 integrated workspace: Slice 2b review annotations, Investigation Studio view model (with real
// engine runs for every seeded scenario), illustration component regions vs BOM, manifest wiring.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { before, after, test } from 'node:test';
import { buildSeed } from './m04-seed.js';
import { SCENARIOS } from '../tools/m05/scenarios.mjs';
import { changeStates } from '../design/assets-src/m05/build-assembly-svgs.mjs';

process.env.CDS_ENV = 'test';
process.env.CDS_CONFIG = JSON.stringify({ requires: { db: { data: ['db/data', 'db/csv', 'test/data'] } } });
const { default: cds } = await import('@sap/cds');
const ROOT = join(import.meta.dirname, '..');
const WEBAPP = join(ROOT, 'app', 'case-worklist', 'webapp');
const seed = buildSeed();
let server, base;

// Load the UI5 module (sap.ui.define) in Node with a minimal stub: it has no UI5 dependencies.
const loadUi5Module = file => {
  let exported;
  const sap = { ui: { define: (deps, factory) => { exported = factory(); } } };
  new Function('sap', readFileSync(file, 'utf8'))(sap);
  return exported;
};
const StudioModel = loadUi5Module(join(WEBAPP, 'ext', 'control', 'studioModel.js'));

const request = async (path, { user = 'analyst', method = 'GET', body } = {}) => {
  const response = await fetch(base + path, { method, headers: { 'content-type': 'application/json', authorization: `Basic ${Buffer.from(`${user}:test`).toString('base64')}` },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  try { return { status: response.status, data: JSON.parse(text) }; } catch { return { status: response.status, data: text }; }
};

before(async () => {
  server = await cds.server({ port: 0, in_memory: true });
  if (!server.listening) await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}/odata/v4/engineering-review`;
});
after(async () => {
  if (server) await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  await cds.db?.disconnect();
});

test('Slice 2b annotations: role-aware header actions, evaluated-run default, refresh after decisions, history section', async () => {
  const edmx = (await request('/$metadata', { user: 'cviewer' })).data;
  const identification = edmx.match(/<Annotations Target="EngineeringReview\.ReviewCases">[\s\S]*?<\/Annotations>/)[0];
  for (const [action, flag] of [['runImpact', 'canRunImpact'], ['submitForReview', 'canSubmit'], ['approve', 'canDecide'], ['reject', 'canDecide']]) {
    assert.match(identification, new RegExp(`<PropertyValue Property="Action" String="EngineeringReview\\.${action}"/>[\\s\\S]*?<Not>\\s*<Path>${flag}</Path>`), `${action} hidden unless ${flag}`);
    assert.match(edmx, new RegExp(`Target="EngineeringReview\\.${action}\\(EngineeringReview\\.ReviewCases\\)"[\\s\\S]*?OperationAvailable"(?: Path="in/${flag}"|[^>]*>\\s*<Path>in/${flag}</Path>)`), `${action} available only with ${flag}`);
  }
  for (const action of ['approve', 'reject']) {
    assert.match(edmx, new RegExp(`Target="EngineeringReview\\.${action}\\(EngineeringReview\\.ReviewCases\\)/basedOnRun"[\\s\\S]*?ParameterDefaultValue"(?: Path="in/latestRun_ID"|[^>]*>\\s*<Path>in/latestRun_ID</Path>)`), `${action}: evaluated run defaults to the displayed latest run`);
    assert.doesNotMatch(edmx.match(new RegExp(`Target="EngineeringReview\\.${action}\\(EngineeringReview\\.ReviewCases\\)/basedOnRun">[\\s\\S]*?</Annotations>`))[0], /FieldControl[^>]*ReadOnly/, 'not read-only (CAP would skip @mandatory)');
  }
  for (const action of ['submitForReview', 'approve', 'reject'])
    assert.match(edmx, new RegExp(`Target="EngineeringReview\\.${action}\\(EngineeringReview\\.ReviewCases\\)"[\\s\\S]*?SideEffects[\\s\\S]*?<String>in/status</String>[\\s\\S]*?<NavigationPropertyPath>in/decisions</NavigationPropertyPath>`), `${action} refreshes status and history`);
  assert.match(edmx, /<PropertyValue Property="Target" AnnotationPath="decisions\/@UI\.PresentationVariant"\/>/);
  assert.match(edmx, /<PropertyValue Property="Label" String="Decision History"\/>/);
});

test('every seeded scenario calculates, and the studio view model maps each BOM item with its evidence', async () => {
  const expected = { 'EC-000512': 'COMPLETE', 'EC-000538': 'COMPLETE', 'EC-000561': 'COMPLETE', 'EC-000587': 'COMPLETE', 'EC-000703': 'INCOMPLETE', 'EC-200610': 'COMPLETE_WITH_WARNINGS' };
  for (const s of SCENARIOS) {
    const c = seed.ReviewCases.find(r => r.caseNumber === s.caseNumber);
    const user = c.plant === '1000' ? 'analyst' : 'analyst2';
    const run = await request(`/ReviewCases(${c.ID})/EngineeringReview.runImpact`, { method: 'POST', user, body: { asOfDate: '2026-11-08' } });
    assert.equal(run.status, 200, `${s.caseNumber}: ${JSON.stringify(run.data)}`);
    assert.equal(run.data.status, expected[s.caseNumber], s.caseNumber);
    const full = (await request(`/ImpactRuns(${run.data.ID})?$expand=comparisonLines,materialLines,findings`, { user })).data;
    const view = StudioModel.build(full);
    // One tile per BOM item number of either revision, in item order, with the engine's change type.
    const states = changeStates(s);
    assert.deepEqual(view.items.map(i => i.itemNo), Object.keys(states).sort(), s.caseNumber);
    for (const i of view.items) {
      assert.equal(i.change, states[i.itemNo], `${s.caseNumber} item ${i.itemNo}`);
      if (i.toMaterial) assert.equal(i.stock?.material, i.toMaterial, 'stock line of the proposed material');
      assert(i.findings.every(f => [i.fromMaterial, i.toMaterial].includes(f.material)), 'only findings of this item');
    }
    assert.equal(view.items.filter(i => i.short).length, run.data.materialsShort, `${s.caseNumber} short badges`);
    assert.equal(view.summary.changed, view.items.filter(i => i.change !== 'unchanged').length);
    for (const rev of ['A', 'B']) assert(existsSync(join(WEBAPP, StudioModel.illustration(s.assemblyCode, rev))), `${s.assemblyCode}-${rev} illustration exists`);
  }
  assert.equal(StudioModel.illustration('COOL-100', 'A'), null, 'no unvalidated COOL-100 rev A drawing');
  assert.equal(StudioModel.num('100.000'), '100');
  assert.equal(StudioModel.num('2.500'), '2.5');
  assert.equal(StudioModel.money('1200.0000'), '1,200.00');
});

test('illustration component regions are keyed to the BOM item numbers of their revision', () => {
  for (const s of SCENARIOS) {
    const states = changeStates(s);
    for (const rev of ['A', 'B']) {
      const svg = readFileSync(join(WEBAPP, 'assets', 'assemblies', `${s.assemblyCode}-${rev}.svg`), 'utf8');
      const regions = [...svg.matchAll(/<g id="ai-item-(\d{4})" class="ai-component ai-state-([\w-]+)" data-item-no="\1" data-material="([^"]+)" data-quantity="([^"]+)" tabindex="0" role="button" aria-label="[^"]+"/g)];
      const bom = rev === 'A' ? s.a : s.b;
      assert.deepEqual(regions.map(r => [r[1], r[3], Number(r[4])]), bom.map(([no, m, q]) => [no, m, q]), `${s.assemblyCode}-${rev} regions = BOM`);
      for (const r of regions) {
        const st = states[r[1]];
        const want = rev === 'B' ? st : ['replaced', 'removed', 'quantity-changed'].includes(st) ? `${st}-from` : 'unchanged';
        assert.equal(r[2], want, `${s.assemblyCode}-${rev} ${r[1]} state class`);
      }
      assert.match(svg, /SYNTHETIC ILLUSTRATION - not CAD/);
    }
  }
  execFileSync(process.execPath, [join(ROOT, 'design', 'assets-src', 'm05', 'build-assembly-svgs.mjs'), '--check']);
  execFileSync(process.execPath, [join(ROOT, 'tools', 'm05', 'build-scenarios.mjs'), '--check']);
});

test('manifest wires the studio section and the import action to existing modules', () => {
  const manifest = JSON.parse(readFileSync(join(WEBAPP, 'manifest.json'), 'utf8'));
  const targets = manifest['sap.ui5'].routing.targets;
  const studio = targets.ReviewCasesObjectPage.options.settings.content.body.sections.InvestigationStudio;
  assert.deepEqual([studio.template, studio.position], ['assemblyimpact.caseworklist.ext.fragment.InvestigationStudio', { anchor: 'General', placement: 'Before' }]);
  const fragment = readFileSync(join(WEBAPP, 'ext', 'fragment', 'InvestigationStudio.fragment.xml'), 'utf8');
  assert.match(fragment, /xmlns:ai="assemblyimpact\.caseworklist\.ext\.control"/);
  assert.match(fragment, /<ai:InvestigationStudio caseId="\{ID\}" latestRunId="\{latestRun_ID\}"/);
  assert(existsSync(join(WEBAPP, 'ext', 'control', 'InvestigationStudio.js')));
  const action = targets.ReviewCasesList.options.settings.controlConfiguration['@com.sap.vocabularies.UI.v1.LineItem'].actions.ImportDemoData;
  assert.deepEqual([action.press, action.requiresSelection], ['assemblyimpact.caseworklist.ext.ImportDemo.onImport', false]);
  const handler = readFileSync(join(WEBAPP, 'ext', 'ImportDemo.js'), 'utf8');
  assert.match(handler, /onImport: function/);
  assert.match(handler, /validateDemoImport/);
  assert.match(handler, /commitDemoImport", \{ fileName: file\.name, content: file\.text, confirm: true \}/);
  assert.ok(manifest['sap.ui5'].dependencies.libs['sap.ui.unified']);
  for (const file of ['ext/ImportDemo.js', 'ext/control/InvestigationStudio.js', 'ext/control/studioModel.js'])
    execFileSync(process.execPath, ['--check', join(WEBAPP, file)]);
});
