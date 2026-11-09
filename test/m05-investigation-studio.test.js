// M05 Deliverable C: Investigation Studio (freestyle SAPUI5, same EngineeringReview service).
// Static contract checks (manifest, views, bindings against the CDS model), the generated component
// schematic, and the server paths the Studio uses. UI rendering evidence: docs/evidence/m05.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { before, after, test } from 'node:test';
import { buildSeed } from './m04-seed.js';
import { loadDataset, toCalculatorInput } from './m04-fixtures.js';
import { calculateImpact } from '../srv/lib/impact-calculator.js';

process.env.CDS_ENV = 'test';
process.env.CDS_CONFIG = JSON.stringify({ requires: { db: { data: ['db/data', 'db/csv', 'test/data'] } } });
const { default: cds } = await import('@sap/cds');
const ROOT = join(import.meta.dirname, '..');
const WEBAPP = join(ROOT, 'app', 'investigation-studio', 'webapp');
const manifest = JSON.parse(readFileSync(join(WEBAPP, 'manifest.json'), 'utf8'));
const read = (...p) => readFileSync(join(WEBAPP, ...p), 'utf8');
// The schematic module registers itself on globalThis when no UI5 loader is present.
new Function(read('lib', 'schematic.js'))();
const schematic = globalThis.__aiSchematic;
let server, root;

const request = async (path, user = 'cviewer') => {
  const response = await fetch(root + path, { headers: user ? { authorization: `Basic ${Buffer.from(`${user}:test`).toString('base64')}` } : {} });
  return { status: response.status, text: await response.text() };
};

/** Minimal XML well-formedness check: balanced tags, quoted attributes, no stray '<'. */
function assertWellFormed(xml, name) {
  const stack = [];
  const re = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*"[^"]*")*)\s*(\/?)>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>/g;
  let last = 0, m;
  while ((m = re.exec(xml))) {
    assert(!/</.test(xml.slice(last, m.index)), `${name}: malformed markup near offset ${last}`);
    last = re.lastIndex;
    if (!m[2]) continue;
    if (m[1]) assert.equal(stack.pop(), m[2], `${name}: closing </${m[2]}>`);
    else if (!m[4]) stack.push(m[2]);
  }
  assert(!/</.test(xml.slice(last)), `${name}: trailing markup`);
  assert.deepEqual(stack, [], `${name}: unclosed tags`);
}

before(async () => {
  server = await cds.server({ port: 0, in_memory: true });
  if (!server.listening) await once(server, 'listening');
  root = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  await cds.db?.disconnect();
});

test('manifest: same OData V4 service as the worklist, OpenUI5-available libraries only, deep-link route', () => {
  const p3 = JSON.parse(readFileSync(join(ROOT, 'app', 'case-worklist', 'webapp', 'manifest.json'), 'utf8'));
  assert.equal(manifest['sap.app'].id, 'assemblyimpact.investigationstudio');
  assert.deepEqual(manifest['sap.app'].dataSources.mainService, p3['sap.app'].dataSources.mainService);
  assert.deepEqual(Object.keys(manifest['sap.ui5'].dependencies.libs).sort(), ['sap.f', 'sap.m', 'sap.ui.core', 'sap.ui.layout', 'sap.ui.unified']);
  assert.equal(manifest['sap.ui5'].models[''].settings.autoExpandSelect, true);
  assert.deepEqual(manifest['sap.ui5'].routing.routes.map(r => r.pattern), [':?query:', 'cases/{caseId}:?query:']);
  for (const t of Object.values(manifest['sap.ui5'].routing.targets)) assert(existsSync(join(WEBAPP, 'view', `${t.name}.view.xml`)), t.name);
  assert.match(read('index.html'), /sapui5\.hana\.ondemand\.com\/1\.149\.0\/resources\/sap-ui-core\.js/);
});

test('views and fragments are well-formed and reference only existing controller handlers', () => {
  const files = readdirSync(join(WEBAPP, 'view')).filter(f => f.endsWith('.xml'));
  assert.deepEqual(files.sort(), ['App.view.xml', 'CaseList.view.xml', 'CreateScenarioDialog.fragment.xml', 'ImportDialog.fragment.xml', 'Workspace.view.xml']);
  const controllers = { CaseList: read('controller', 'CaseList.controller.js'), Workspace: read('controller', 'Workspace.controller.js') };
  for (const f of files) {
    const xml = read('view', f);
    assertWellFormed(xml, f);
    const controller = ['ImportDialog.fragment.xml', 'CreateScenarioDialog.fragment.xml'].includes(f) ? controllers.CaseList : controllers[f.replace('.view.xml', '')];
    for (const [, handler] of xml.matchAll(/="\.(on\w+)"/g)) assert.match(controller, new RegExp(`\\b${handler}: function`), `${f} -> ${handler}`);
  }
});

test('Studio bindings use only elements that the service exposes', () => {
  const svc = cds.model.definitions;
  const caseEl = Object.keys(svc['EngineeringReview.ReviewCases'].elements);
  const runEl = Object.keys(svc['EngineeringReview.ImpactRuns'].elements);
  const ws = read('view', 'Workspace.view.xml'), list = read('view', 'CaseList.view.xml');
  for (const [, p] of ws.matchAll(/ws>\/case\/(\w+)/g)) assert(caseEl.includes(p), `ReviewCases.${p}`);
  for (const [, p] of ws.matchAll(/ws>\/run\/(\w+)/g)) assert(runEl.includes(p), `ImpactRuns.${p}`);
  const select = /\$select: '([^']+)'/.exec(list)[1].split(',');
  for (const p of select) assert(caseEl.includes(p), `list $select ${p}`);
  // No business rule in the UI: availability comes from the server flags; no cost arithmetic in controllers.
  assert.match(ws, /canRunImpact/); assert.match(ws, /canSubmit/); assert.match(ws, /canDecide/);
  for (const c of ['Workspace', 'CaseList']) assert.doesNotMatch(read('controller', `${c}.controller.js`), /price\s*\*|quantity\s*\*|\*\s*productionQuantity/, c);
});

test('schematic: every BOM position is a focusable, labelled component; states come only from run lines', () => {
  const data = loadDataset('DS-SCENARIOS-01');
  for (const c of data.review_cases) {
    const result = calculateImpact(toCalculatorInput(data, c.caseNumber));
    for (const view of ['A', 'B']) {
      const svg = schematic.build({ assemblyCode: c.assemblyCode, view, fromRevision: 'A', toRevision: 'B', lines: result.comparison, selected: result.comparison[0].itemNo });
      assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 \d+ \d+"/);
      assert.match(svg, /<title id="ai-sch-t">[^<]*not CAD/);
      const groups = [...svg.matchAll(/<g class="([^"]+)" data-item-no="(\d{4})"[^>]*tabindex="0" role="button" aria-pressed="(true|false)" aria-label="([^"]+)"/g)];
      assert.deepEqual(groups.map(g => g[2]), result.comparison.map(l => l.itemNo), `${c.caseNumber} ${view}`);
      for (const [, cls, itemNo, , label] of groups) {
        const line = result.comparison.find(l => l.itemNo === itemNo);
        assert(cls.includes(schematic.STATE_CLASS[line.change]), `${itemNo} state class`);
        assert(label.includes(schematic.STATE_LABEL[line.change]), `${itemNo} state in text alternative (not colour only)`);
        if (view === 'B' && line.change === 'REMOVED') assert(cls.includes('ai-absent'));
        if (view === 'A' && line.change === 'ADDED') assert(cls.includes('ai-absent'));
      }
      assert.equal(groups.filter(g => g[3] === 'true').length, 1, 'exactly one selected');
    }
  }
  // Before any run: no change state is invented; text is escaped.
  const svg = schematic.build({ assemblyCode: 'X<1>', view: 'B', lines: [{ itemNo: '0010', toMaterial: 'A&B', toQuantity: '2', unit: 'PC', change: null }] });
  assert.doesNotMatch(svg, /ai-state-/);
  assert.match(svg, /X&lt;1&gt;/); assert.match(svg, /A&amp;B/);
});

test('curated COOL-100 diagram matches the seeded BOM item numbers', () => {
  const map = JSON.parse(read('assets', 'COOL-100.component-map.json'));
  const svg = read('assets', 'COOL-100.components.svg');
  const seed = buildSeed();
  const toState = seed.BOMStates.find(s => s.stateKey === 'BOM-COOL-100-B');
  const items = seed.BOMItems.filter(i => i.bomState_ID === toState.ID).map(i => i.itemNo).sort();
  assert.deepEqual(map.components.map(c => c.itemNo).sort(), items);
  for (const c of map.components) for (const id of c.elementIds) assert.match(svg, new RegExp(`id="${id}" class="ai-component" data-item-no="${c.itemNo}"`));
  assert.equal(read('assets', 'COOL-100.components.svg'), readFileSync(join(ROOT, 'design', 'p4-visual-investigation', 'COOL-100.components.svg'), 'utf8'), 'copy of the design asset');
});

test('server: the Studio is served, its case request works, and the worklist links to it', async () => {
  const html = await request('/investigation-studio/webapp/index.html', null);
  assert.equal(html.status, 200);
  for (const f of ['manifest.json', 'Component.js', 'samples/scenario-import-sample.json', 'samples/scenario-import-sample.csv', 'assets/COOL-100.components.svg'])
    assert.equal((await request(`/investigation-studio/webapp/${f}`, null)).status, 200, f);
  const id = buildSeed().ReviewCases.find(c => c.caseNumber === 'EC-000485').ID;
  const expand = 'latestRun($expand=comparisonLines,materialLines,findings),decisions($orderby=at desc;$expand=basedOnRun($select=ID,asOfDate,status)),' +
    'runs($select=ID,computedAt,asOfDate,status,costDeltaTotal,currency,computedBy;$orderby=computedAt desc),sourceImport,fromState($expand=items),toState($expand=items)';
  const r = await request(`/odata/v4/engineering-review/ReviewCases(${id})?$expand=${encodeURIComponent(expand)}`);
  assert.equal(r.status, 200, r.text);
  const body = JSON.parse(r.text);
  assert.equal(body.toState.items.length, 5);
  assert.equal(body.canSubmit, false, 'viewer');
  const instr = await request(`/odata/v4/engineering-review/Instructions?$filter=assemblyCode eq 'HYD-700' and plant eq '1000'&$expand=references`);
  assert.equal(JSON.parse(instr.text).value.length, 2);
  // Foreign plant: the deep link reveals nothing.
  assert.equal((await request(`/odata/v4/engineering-review/ReviewCases(${id})`, 'cviewer2')).status, 404);
  const annotations = readFileSync(join(ROOT, 'app', 'case-worklist', 'annotations.cds'), 'utf8');
  assert.match(annotations, /'\.\.\/\.\.\/investigation-studio\/webapp\/index\.html#\/cases\/'/);
});

test('Fiori elements contract: review actions are availability-driven, default to the displayed run, refresh history', async () => {
  const model = await cds.load([join(ROOT, 'srv'), join(ROOT, 'app', 'case-worklist')]);
  const edmx = cds.compile.to.edmx(model, { service: 'EngineeringReview' });
  for (const [action, path] of [['runImpact', 'in/canRunImpact'], ['submitForReview', 'in/canSubmit'], ['approve', 'in/canDecide'], ['reject', 'in/canDecide']]) {
    const block = new RegExp(`<Annotations Target="EngineeringReview\\.${action}\\(EngineeringReview\\.ReviewCases\\)">[\\s\\S]*?</Annotations>`).exec(edmx)?.[0] ?? '';
    assert.match(block, new RegExp(`Core.OperationAvailable" Path="${path}"`), action);
    assert.match(block, /Common.SideEffects/, `${action} side effects`);
  }
  for (const action of ['approve', 'reject']) {
    const block = new RegExp(`<Annotations Target="EngineeringReview\\.${action}\\(EngineeringReview\\.ReviewCases\\)/basedOnRun">[\\s\\S]*?</Annotations>`).exec(edmx)?.[0] ?? '';
    assert.match(block, /UI.ParameterDefaultValue" Path="in\/latestRun_ID"/, action);
  }
  assert.match(edmx, /decisions\/@UI.PresentationVariant/);
});

test('instruction-step contract: the Studio parser matches the calculator text for outdated references', () => {
  const data = loadDataset('DS-SCENARIOS-01');
  const result = calculateImpact(toCalculatorInput(data, 'EC-000485'));
  const body = /_outdatedKey: function \(details\) \{([\s\S]*?)\n {4}\},/.exec(read('controller', 'Workspace.controller.js'))[1];
  const parse = new Function('details', body);
  const keys = result.findings.filter(f => f.type === 'OUTDATED_INSTRUCTION_REFERENCE').map(f => parse(f.details)).sort();
  assert.deepEqual(keys, ['WI-HYD-700-ASM/5/0020', 'WI-HYD-700-ASM/5/0030', 'WI-HYD-700-PRS/2/0010']);
});
