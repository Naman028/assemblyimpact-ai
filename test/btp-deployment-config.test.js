// BTP deployment preparation: static consistency of xs-security.json, mta.yaml, the app router and the
// production profile with the CDS model. Nothing is deployed or provisioned by this test.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { test } from 'node:test';
import cds from '@sap/cds';

const ROOT = join(import.meta.dirname, '..');
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');
const xs = JSON.parse(read('xs-security.json'));
const mta = cds.parse.yaml(read('mta.yaml'));
const router = JSON.parse(read('app', 'router', 'xs-app.json'));

test('xs-security: a scope and role template for every role the CDS model requires; plants attribute on every template', async () => {
  const model = await cds.load(['srv'], { cwd: ROOT });
  const roles = new Set();
  const collect = v => { for (const r of [].concat(v ?? [])) if (typeof r === 'string' && !['authenticated-user', 'any', 'system-user'].includes(r)) roles.add(r); };
  for (const def of Object.values(model.definitions)) {
    collect(def['@requires']);
    for (const rule of def['@restrict'] ?? []) collect(rule.to);
    for (const action of Object.values(def.actions ?? {})) collect(action['@requires']);
  }
  const scopes = xs.scopes.map(s => s.name.replace('$XSAPPNAME.', ''));
  for (const r of roles) {
    assert(scopes.includes(r), `scope ${r}`);
    const template = xs['role-templates'].find(t => t.name === r);
    assert(template?.['scope-references'].includes(`$XSAPPNAME.${r}`), `role template ${r}`);
    assert.deepEqual(template['attribute-references'], [{ name: 'plants' }], `${r} carries plants`);
  }
  assert.deepEqual(xs.attributes, [{ name: 'plants', description: 'Plants the user may access', valueType: 'string', valueRequired: true }]);
});

test('role collections (cockpit definitions): separation of duties and a least-privilege Joule identity', () => {
  assert.equal(xs['role-collections'], undefined, 'not in the descriptor: templates require the plants attribute');
  const doc = JSON.parse(read('docs', 'btp', 'role-collections.json'));
  const rc = Object.fromEntries(doc.collections.map(c => [c.name, c.roleTemplates]));
  const templates = xs['role-templates'].map(t => t.name);
  for (const roles of Object.values(rc)) for (const r of roles) assert(templates.includes(r), r);
  assert(!rc.AssemblyImpact_Analyst.includes('ChangeApprover'));
  assert(!rc.AssemblyImpact_Approver.includes('ChangeAnalyst'));
  assert.deepEqual(rc.AssemblyImpact_JouleAssistant.sort(), ['ChangeViewer', 'ImpactRunner']);
  assert(rc.AssemblyImpact_ErpExtractor.includes('ErpExtractor'));
  for (const roles of Object.values(rc)) assert(!roles.includes('DemoDataImporter'), 'no collection grants the demo import');
});

test('mta.yaml: CAP service, HDI deployer, app router, HANA/XSUAA/destination resources; no secrets', () => {
  const modules = Object.fromEntries(mta.modules.map(m => [m.name, m]));
  assert.deepEqual(Object.keys(modules).sort(), ['assemblyimpact-db-deployer', 'assemblyimpact-router', 'assemblyimpact-srv']);
  assert.equal(modules['assemblyimpact-srv'].path, 'gen/srv');
  assert.equal(modules['assemblyimpact-db-deployer'].type, 'hdb');
  assert.equal(modules['assemblyimpact-router'].type, 'approuter.nodejs');
  const resources = Object.fromEntries(mta.resources.map(r => [r.name, r.parameters]));
  assert.deepEqual([resources['assemblyimpact-db'].service, resources['assemblyimpact-db']['service-plan']], ['hana', 'hdi-shared']);
  assert.deepEqual([resources['assemblyimpact-auth'].service, resources['assemblyimpact-auth'].path], ['xsuaa', './xs-security.json']);
  // OAuth redirect: exactly this space's router host, no cross-landscape wildcard.
  assert.deepEqual(resources['assemblyimpact-auth'].config['oauth2-configuration']['redirect-uris'],
    ['https://${org}-${space}-assemblyimpact-router.${default-domain}/**']);
  assert.equal(modules['assemblyimpact-router'].parameters.routes[0].route, '${org}-${space}-assemblyimpact-router.${default-domain}');
  assert.doesNotMatch(read('xs-security.json'), /\*\.cfapps\.\*/);
  // The build uses a pinned CAP CLI (not whatever npx resolves for "cds").
  assert.match(read('mta.yaml'), /npx --yes -p @sap\/cds-dk@10\.2\.1 cds build --production/);
  assert(JSON.parse(read('app', 'router', 'package-lock.json')).packages['node_modules/@sap/approuter'], 'router lockfile');
  assert.equal(resources['assemblyimpact-destination'].service, 'destination');
  for (const f of ['mta.yaml', 'mta-demo.mtaext', 'xs-security.json', 'app/router/xs-app.json']) assert.doesNotMatch(read(f), /clientsecret|password|BEGIN (RSA )?PRIVATE KEY/i, f);
  // Demo data is staged into db/data before the build (so CAP generates .hdbtabledata) and removed afterwards.
  assert.match(read('mta-demo.mtaext'), /stage-demo-data\.mjs\n[\s\S]*cds build --production\n[\s\S]*stage-demo-data\.mjs --clean/);
  assert.doesNotMatch(read('mta.yaml'), /stage-demo-data/, 'demo data is opt-in only');
});

test('app router: every route authenticates with XSUAA; OData is forwarded with CSRF protection; both UIs served', () => {
  assert.equal(router.authenticationMethod, 'route');
  for (const r of router.routes) assert.equal(r.authenticationType, 'xsuaa', r.source);
  const odata = router.routes.find(r => r.destination === 'srv-api');
  assert.equal(odata.csrfProtection, true);
  assert.deepEqual(router.routes.filter(r => r.localDir).map(r => r.localDir).sort(), ['resources/case-worklist', 'resources/investigation-studio']);
  // The UIs call relative OData URIs that the router forwards.
  for (const app of ['case-worklist', 'investigation-studio']) {
    const uri = JSON.parse(read('app', app, 'webapp', 'manifest.json'))['sap.app'].dataSources.mainService.uri;
    assert.match(uri, new RegExp(odata.source.replace('^', '').replace('(.*)$', '')));
  }
});

test('production and hybrid profiles: XSUAA, SAP HANA, demo import and non-S/4 ERP modes disabled, no seed data', () => {
  const probe = "import('@sap/cds').then(({default:cds})=>console.log(JSON.stringify({auth:cds.env.requires.auth.kind,db:cds.env.requires.db.kind,demo:cds.env.features.demo_import,data:cds.env.requires.db.data??null,erp:cds.env.requires['erp-source']})))";
  const envFor = profile => {
    const out = spawnSync(process.execPath, ['-e', probe], { cwd: ROOT, env: { ...process.env, CDS_ENV: profile, CDS_CONFIG: '' }, encoding: 'utf8' });
    assert.equal(out.status, 0, out.stderr);
    return JSON.parse(out.stdout.trim().split('\n').at(-1));
  };
  const env = envFor('production');
  assert.deepEqual([env.auth, env.db, env.demo], ['xsuaa', 'hana', false]);
  assert.deepEqual([env.erp.fixtures ?? null, env.erp.sandbox ?? null, env.erp.s4.enabled], [null, null, false]);
  const hybrid = envFor('hybrid');
  assert.deepEqual([hybrid.auth, hybrid.db, hybrid.demo, hybrid.erp.fixtures ?? null], ['xsuaa', 'hana', false, null]);
  assert(!JSON.stringify(env.data ?? []).includes('test'));
  const pkg = JSON.parse(read('package.json'));
  for (const dep of ['@cap-js/hana', '@sap/xssec']) assert(pkg.dependencies[dep], dep);
});
