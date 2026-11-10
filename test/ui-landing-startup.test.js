// UI correction and startup milestone: landing page (live counts, provenance, integration modes), the
// development root URL, Studio layout/empty-state fixes and the landing page entry points into the Studio.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { before, after, test } from 'node:test';
import { dataSourceMode, genaiMode, jouleStatus, systemStatus } from '../srv/lib/system-status.js';

process.env.CDS_ENV = 'test';
process.env.CDS_CONFIG = JSON.stringify({ requires: { db: { data: ['db/data', 'db/csv', 'test/data'] } } });
const { default: cds } = await import('@sap/cds');
const ROOT = join(import.meta.dirname, '..');
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');
let server, origin;

/** Loads a sap.ui.define module in a sandbox; deps are passed in order. */
function loadUi5(file, deps = []) {
  let result;
  const sandbox = { sap: { ui: { define: (_names, factory) => { result = factory(...deps); }, require: () => undefined } }, window: {}, console };
  vm.runInNewContext(read(file), sandbox);
  return result;
}
const call = async (path, user = 'cviewer') => {
  const headers = user ? { authorization: `Basic ${Buffer.from(`${user}:test`).toString('base64')}` } : {};
  const r = await fetch(origin + '/odata/v4/engineering-review/' + path, { headers });
  const type = r.headers.get('content-type') ?? '';
  return { status: r.status, body: type.includes('json') ? await r.json() : await r.text() };
};

before(async () => {
  server = await cds.server({ port: 0, in_memory: true });
  if (!server.listening) await once(server, 'listening');
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise((resolve, reject) => server.close(e => (e ? reject(e) : resolve())));
  await cds.db?.disconnect();
});

test('systemStatus: modes come from configuration; a sandbox without API key is not reported as SANDBOX; no secrets', () => {
  assert.equal(dataSourceMode({ fixtures: 'x' }), 'MOCK');
  assert.equal(dataSourceMode({ fixtures: 'x', sandbox: { url: 'https://s', apiKeyEnv: 'K' } }, {}), 'MOCK', 'key missing');
  assert.equal(dataSourceMode({ fixtures: 'x', sandbox: { url: 'https://s', apiKeyEnv: 'K' } }, { K: 'secret' }), 'SANDBOX');
  assert.equal(dataSourceMode({ fixtures: 'x', s4: { enabled: true } }), 'S4HANA');
  assert.equal(dataSourceMode({}), 'NONE');
  assert.equal(genaiMode({ provider: 'fixture' }), 'FIXTURE');
  assert.equal(genaiMode({ provider: 'genai-hub' }), 'GENAI_HUB');
  assert.equal(genaiMode({}), 'NOT_CONFIGURED');
  assert.equal(jouleStatus({}), 'NOT_CONNECTED');
  assert.equal(jouleStatus({ actionsReleased: true }), 'CONFIGURED');
  const s = systemStatus({ requires: { 'erp-source': { sandbox: { url: 'https://s', apiKeyEnv: 'PATH' } }, auth: { kind: 'xsuaa' } }, features: {} });
  assert.deepEqual(Object.keys(s).sort(), ['authMode', 'dataSourceMode', 'demoImport', 'genaiMode', 'jouleStatus']);
  assert.doesNotMatch(JSON.stringify(s), /https|PATH|secret/, 'no URLs or key names returned');
  assert.equal(s.authMode, 'PRODUCTION');
});

test('systemStatus over OData: authenticated only; test profile reports MOCK, FIXTURE, NOT_CONNECTED, DEVELOPMENT', async () => {
  assert.equal((await call('systemStatus()', null)).status, 401);
  const r = await call('systemStatus()');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.dataSourceMode, 'MOCK');
  assert.equal(r.body.genaiMode, 'FIXTURE');
  assert.equal(r.body.jouleStatus, 'NOT_CONNECTED');
  assert.equal(r.body.authMode, 'DEVELOPMENT');
  assert.equal(r.body.demoImport, true);
});

test('landing page queries: accepted by the service and restricted to the user\'s plants', async () => {
  const sandbox = loadUi5('app/home/webapp/lib/overview.js');
  const counts = {};
  for (const [key, filter] of Object.entries(sandbox.COUNTS)) {
    const r = await call(sandbox.countPath(filter));
    assert.equal(r.status, 200, `${key}: ${r.body}`);
    counts[key] = Number(r.body);
  }
  assert(counts.total > 0);
  assert.equal(counts.open + counts.inReview + counts.decided, counts.total, 'status buckets add up');
  assert(counts.notCalculated <= counts.open);
  const other = await call(sandbox.countPath(''), 'cviewer2');
  assert.notEqual(Number(other.body), counts.total, 'another plant sees other cases');
  for (const s of sandbox.SOURCES) assert.equal((await call(sandbox.sourcePath(s.key))).status, 200, s.key);
  const recent = await call(sandbox.RECENT_PATH);
  assert.equal(recent.status, 200, JSON.stringify(recent.body));
  assert(recent.body.value.length > 0 && recent.body.value.length <= 6);
  assert('latestRun' in recent.body.value[0]);
});

test('landing page helpers: no run is "Not calculated"; S/4HANA is always listed; intents keep app IDs', () => {
  const ov = loadUi5('app/home/webapp/lib/overview.js');
  assert.equal(ov.latest(null), 'Not calculated');
  assert.equal(ov.latest({ status: 'COMPLETE', costDeltaTotal: '6756.00', currency: 'EUR', materialsShort: 2, asOfDate: '2026-11-10' }),
    '+6,756.00 EUR · 2 short · as of 2026-11-10');
  assert.equal(ov.latest({ status: 'INCOMPLETE', costDeltaTotal: null, materialsShort: 0, asOfDate: '2026-11-10' }), 'cost not calculable · 0 short · as of 2026-11-10');
  const rows = ov.sources({ SYNTHETIC_FIXTURE: 7, DEMO_IMPORT: 0 });
  assert.equal(JSON.stringify(rows.map(r => [r.key, r.count, r.real])), JSON.stringify([['SYNTHETIC_FIXTURE', 7, false], ['S4_IMPORT', 0, true]]));
  assert.equal(ov.dataSource('MOCK').text, 'MOCK');
  assert.match(ov.genai('FIXTURE').description, /not live/);
  assert.equal(ov.hash.studioCase('a b'), 'EngineeringCase-investigate&/cases/a%20b');
  assert.equal(ov.hash.create(), 'EngineeringCase-investigate&/?create=true');
  assert.equal(ov.hash.worklist(), 'EngineeringCase-manage');
});

test('development root URL opens the launchpad; production keeps the app router welcome file; npm run dev', async () => {
  const r = await fetch(origin + '/');
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /url=launchpad\.html/);
  assert.match(html, /location\.replace\("launchpad\.html"/);
  assert.equal(JSON.parse(read('app/router/xs-app.json')).welcomeFile, '/launchpad.html');
  assert.doesNotMatch(read('tools/btp/stage-ui.mjs'), /'index\.html'/, 'not shipped');
  assert.match(read('app/launchpad.html'), /\^#\?\(Shell-home\)\?\$\/\.test\(window\.location\.hash\)[^\n]*replace\("#AssemblyImpact-overview"\)/, 'tile page replaced');
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts.dev, 'cds watch');
  assert.equal(pkg.scripts.start, 'cds-serve');
});

test('Studio: full width in the launchpad, layout by its own width, KPIs and cost tab without empty values', () => {
  for (const app of ['home', 'case-worklist', 'investigation-studio'])
    assert.equal(JSON.parse(read('app', app, 'webapp', 'manifest.json'))['sap.ui'].fullWidth, true, app);
  const component = read('app/investigation-studio/webapp/Component.js');
  assert.match(component, /offsetWidth : window\.innerWidth\) >= 1200/);
  assert.doesNotMatch(component, /min-width: 1500px/);
  const view = read('app/investigation-studio/webapp/view/Workspace.view.xml');
  assert.match(view, /<cssgrid:CSSGrid gridTemplateColumns="repeat\(auto-fit, minmax\(min\(100%, 9\.5rem\), 1fr\)\)"[^>]*class="aiKpis">/);
  assert.match(view, /<IllustratedMessage visible="\{= !\$\{ws>\/run\} \}"[^>]*title="Not calculated yet"/);
  const cost = view.slice(view.indexOf('key="cost"'), view.indexOf('key="explain"'));
  assert.match(cost, /<VBox visible="\{= !!\$\{ws>\/run\} \}"/, 'figures and note only with a run');
  assert.match(cost, /containerQuery="true"/);
  assert.doesNotMatch(cost, /\(\{ws>\/run\/asOfDate\}\)/);
  const fmt = loadUi5('app/investigation-studio/webapp/lib/format.js');
  assert.equal(fmt.runMoney.call({}, null, null, undefined), 'Not calculated');
  assert.equal(fmt.runMoney.call({}, null, 'EUR', 'INCOMPLETE'), 'Not calculable');
  assert.equal(fmt.runMoney.call({}, '-12.5', 'EUR', 'COMPLETE'), '−12.50 EUR');
});

test('Studio entry points from the landing page: ?status filters the list, ?create opens the form only if allowed', async () => {
  const stub = name => ({ extend: (_n, o) => o, name });
  const ctrl = loadUi5('app/investigation-studio/webapp/controller/CaseList.controller.js',
    [stub('Controller'), function Filter() {}, {}, function JSONModel() {}, {}, {}, {}, {}, {}]);
  const run = async (query, allowed) => {
    const calls = [];
    const self = Object.assign(Object.create(ctrl), {
      byId: () => ({ setSelectedKey: k => calls.push('status:' + k) }),
      _applyFilters: () => calls.push('filter'),
      onOpenCreate: () => calls.push('create'),
      _capsReady: Promise.resolve(allowed)
    });
    self._applyQuery(query);
    await self._capsReady; await Promise.resolve();
    return calls;
  };
  assert.deepEqual(await run({ status: 'IN_REVIEW' }, false), ['status:IN_REVIEW', 'filter']);
  assert.deepEqual(await run({ status: 'DROP TABLE' }, false), [], 'unknown status ignored');
  assert.deepEqual(await run({ create: 'true' }, true), ['create']);
  assert.deepEqual(await run({ create: 'true' }, false), [], 'not offered without the import capability');
  assert.deepEqual(await run(undefined, true), []);
});
