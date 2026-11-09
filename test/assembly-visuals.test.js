// Assembly visuals: P3 illustration/thumbnail wiring and P4 component-addressable diagram.
// Checks that every image matches validated synthetic BOM data, is accessible and self-contained,
// is served by CAP, and that the P4 component map agrees with the DS-ORACLE-01 fixture.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { before, after, test } from 'node:test';
import { buildSeed } from './m04-seed.js';

process.env.CDS_ENV = 'test';
const { default: cds } = await import('@sap/cds');
const ROOT = join(import.meta.dirname, '..');
const WEBAPP = join(ROOT, 'app', 'case-worklist', 'webapp');
const ASSETS = join(WEBAPP, 'assets', 'assemblies');
const P4 = join(ROOT, 'design', 'p4-visual-investigation');
const FIXTURE = join(ROOT, 'test', 'fixtures', 'm04', 'DS-ORACLE-01');
const manifest = JSON.parse(readFileSync(join(WEBAPP, 'manifest.json'), 'utf8'));
const csv = (file) => {
  const [head, ...rows] = readFileSync(file, 'utf8').trim().split(/\r?\n/);
  const keys = head.split(',');
  return rows.map(r => Object.fromEntries(r.split(',').map((v, i) => [keys[i], v])));
};
// Availability lives in the fragments' expression bindings ("(code + '-' + rev) === 'COOL-100-B'").
// targetType 'any' keeps the bound strings from being converted to the boolean type of "visible".
// Fiori elements ignores core:require in custom column templates, so no formatter module is used.
const FRAGMENTS = ['AssemblyIllustration', 'AssemblyThumbnail'].map(n => join(WEBAPP, 'ext', 'fragment', `${n}.fragment.xml`));
const availability = (xml) => [...new Set([...xml.matchAll(/\(\$\{path: 'assemblyCode', targetType: 'any'\} \+ '-' \+ \$\{path: 'toRevision', targetType: 'any'\}\) === '([\w-]+)-(\w+)'/g)].map(m => `${m[1]}-${m[2]}`))];
const available = {};
for (const key of availability(readFileSync(FRAGMENTS[0], 'utf8'))) {
  const [rev, ...code] = key.split('-').reverse();
  (available[code.reverse().join('-')] ??= []).push(rev);
}
const fragmentFile = (name) => join(WEBAPP, ...name.replace('assemblyimpact.caseworklist.', '').split('.')) + '.fragment.xml';
const svgFiles = () => Object.entries(available).flatMap(([code, revs]) => revs.flatMap(rev => [`${code}-${rev}.svg`, `${code}-${rev}-thumb.svg`]));
let server, root;

before(async () => {
  server = await cds.server({ port: 0, in_memory: true });
  if (!server.listening) await once(server, 'listening');
  root = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  await cds.db?.disconnect();
});

test('manifest wires the illustration section and thumbnail column to existing fragments', () => {
  const targets = manifest['sap.ui5'].routing.targets;
  const section = targets.ReviewCasesObjectPage.options.settings.content.body.sections.AssemblyIllustration;
  assert.deepEqual(section.position, { anchor: 'General', placement: 'After' });
  const column = targets.ReviewCasesList.options.settings.controlConfiguration['@com.sap.vocabularies.UI.v1.LineItem'].columns.AssemblyImage;
  assert.equal(column.position.anchor, 'DataField::assemblyCode');
  for (const template of [section.template, column.template]) {
    const xml = readFileSync(fragmentFile(template), 'utf8');
    assert.doesNotMatch(xml, /core:require|formatter:/, `${template}: no formatter module (not loaded in FE custom columns)`);
    assert.deepEqual(availability(xml).sort(), Object.entries(available).flatMap(([c, rs]) => rs.map(r => `${c}-${r}`)).sort(), `${template} availability rule`);
    assert.match(xml, /src="\{= 'assets\/assemblies\/' \+ \$\{assemblyCode\} \+ '-' \+ \$\{toRevision\} \+ '(-thumb)?\.svg' \}"/, `${template} image path`);
    assert.match(xml, /alt="\{= 'Synthetic illustration of assembly '/, `${template} has a text alternative`);
  }
  assert.ok(existsSync(join(WEBAPP, manifest['sap.ui5'].resources.css[0].uri)));
});

test('every seeded review case has an illustration for its proposed revision', () => {
  const seed = buildSeed();
  // M05: DS-SCENARIOS-01 cases are visualised by the Investigation Studio's generated component
  // schematic (test/m05-investigation-studio.test.js); curated illustrations cover DS-ORACLE-01.
  for (const c of seed.ReviewCases.filter(rc => !rc.evidenceRef.startsWith('DS-SCENARIOS-01/'))) {
    const code = seed.Assemblies.find(a => a.ID === c.assembly_ID).assemblyCode;
    const rev = seed.BOMStates.find(s => s.ID === c.toState_ID).revision;
    assert.ok(available[code]?.includes(rev), `${c.caseNumber} ${code}-${rev}`);
  }
  for (const [code] of Object.entries(available)) assert.ok(seed.Assemblies.some(a => a.assemblyCode === code), `${code} exists in the dataset`);
});

test('SVG assets are small, self-contained, accessible and labelled synthetic', () => {
  for (const [dir, file] of [...svgFiles().map(f => [ASSETS, f]), [P4, 'COOL-100.components.svg']]) {
    const path = join(dir, file);
    const svg = readFileSync(path, 'utf8');
    assert.ok(statSync(path).size < 20_000, `${file} under 20 kB`);
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="[\d. ]+"/, `${file} scalable root`);
    assert.match(svg, /role="(img|group)" aria-labelledby="t( d)?"[^>]*><title id="t">[^<]+<\/title>/, `${file} title`);
    assert.doesNotMatch(svg, /<script|<image|<foreignObject|href=|url\(http|on\w+=/i, `${file} has no scripts or external references`);
    if (!file.endsWith('-thumb.svg')) assert.match(svg, /SYNTHETIC/, `${file} visibly synthetic`);
  }
  // Illustration labels must match the proposed-revision BOM exactly.
  const bom = csv(join(FIXTURE, 'bom_items.csv')).filter(r => r.bomStateId === 'BOM-COOL-100-B');
  const svg = readFileSync(join(ASSETS, 'COOL-100-B.svg'), 'utf8');
  for (const item of bom) assert.match(svg, new RegExp(`${item.itemNo} · ${item.material} ×${item.quantity}<`), `${item.itemNo} ${item.material}`);
  assert.equal((svg.match(/×\d+</g) || []).length, bom.length, 'no extra components');
});

test('CAP serves the image assets and fragments', async () => {
  for (const file of [...svgFiles().map(f => `assets/assemblies/${f}`), 'ext/fragment/AssemblyIllustration.fragment.xml', 'css/style.css']) {
    const response = await fetch(`${root}/case-worklist/webapp/${file}`);
    assert.equal(response.status, 200, file);
    if (file.endsWith('.svg')) assert.match(response.headers.get('content-type'), /image\/svg\+xml/);
  }
});

test('P4 component map agrees with the fixture BOM, comparison and the SVG', () => {
  const map = JSON.parse(readFileSync(join(P4, 'COOL-100.component-map.json'), 'utf8'));
  const svg = readFileSync(join(P4, map.svg), 'utf8');
  assert.equal(map.synthetic, true);
  const bom = csv(join(FIXTURE, 'bom_items.csv'));
  for (const [rev, state] of Object.entries(map.bomStates)) {
    const items = bom.filter(r => r.bomStateId === state);
    const mapped = map.components.filter(c => c.materials[rev]);
    assert.deepEqual(mapped.map(c => c.itemNo).sort(), items.map(i => i.itemNo).sort(), `revision ${rev} item set`);
    for (const item of items) {
      const c = map.components.find(x => x.itemNo === item.itemNo);
      assert.equal(c.materials[rev], item.material, `${rev} ${item.itemNo}`);
      const units = c.unitElements ? c.unitElements[rev] : c.elementIds;
      if (c.unitElements) assert.equal(units.length, Number(item.quantity), `${rev} ${item.itemNo} one element per unit`);
    }
  }
  const ids = new Set();
  for (const c of map.components) {
    for (const id of c.elementIds) {
      assert.ok(!ids.has(id), `unique ${id}`); ids.add(id);
      const g = svg.match(new RegExp(`<g id="${id}" class="ai-component" data-item-no="(\\d+)" data-material-rev-a="([^"]*)" data-material-rev-b="([^"]*)"[^>]*tabindex="0" role="button" aria-label="[^"]+">`));
      assert.ok(g, `${id} is a focusable component group`);
      assert.equal(g[1], c.itemNo);
      const unitInRevA = !c.unitElements || c.unitElements.A.includes(id);
      assert.equal(g[2], unitInRevA ? (c.materials.A ?? '') : '', `${id} rev A`);
      assert.equal(g[3], c.materials.B, `${id} rev B`);
    }
  }
  assert.equal((svg.match(/class="ai-component"/g) || []).length, ids.size, 'every selectable element is mapped');
  const expected = JSON.parse(readFileSync(join(FIXTURE, 'expected-results.json'), 'utf8'));
  const comparison = expected.cases.find(c => c.assemblyCode === 'COOL-100' || c.caseId === 'EC-000473')?.comparison ?? expected.cases[0].comparison;
  for (const line of comparison) {
    assert.ok(map.components.some(c => c.itemNo === line.itemNo), `comparison item ${line.itemNo} mapped`);
    const cls = map.stateClasses[line.change];
    assert.ok(cls && svg.includes(`.${cls}`), `${line.change} has a style`);
  }
  assert.ok(svg.includes(`.${map.stateClasses.REMOVED}`), 'REMOVED style available');
});

test('M05 scenario illustrations match the DS-SCENARIOS-01 BOMs item by item and are up to date', async () => {
  const { SCENARIOS, svgFor } = await import('../design/assets-src/m05/build-assembly-svgs.mjs');
  assert.equal(SCENARIOS.length, 6);
  for (const s of SCENARIOS) {
    assert.ok(available[s.assemblyCode]?.includes('B'), `${s.assemblyCode}-B enabled in the fragments`);
    for (const [rev, items] of [['A', s.a], ['B', s.b]]) {
      const file = `${s.assemblyCode}-${rev}.svg`;
      const svg = readFileSync(join(ASSETS, file), 'utf8');
      assert.equal(svg, svgFor(s, rev), `${file} regenerated from the fixture (run build-assembly-svgs.mjs)`);
      const drawn = [...svg.matchAll(/<g id="ai-item-(\d+)"[^>]*data-item-no="\1" data-material="([^"]+)" data-quantity="([\d.]+)"/g)]
        .map(m => [m[1], m[2], Number(m[3])]);
      assert.deepEqual(drawn, items, `${file}: item numbers, materials and quantities equal BOM-${s.assemblyCode}-${rev}`);
    }
    assert.equal(readFileSync(join(ASSETS, `${s.assemblyCode}-B-thumb.svg`), 'utf8'), svgFor(s, 'B', { thumb: true }));
  }
});
