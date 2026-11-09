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

test('role collections: separation of duties and a least-privilege Joule identity', () => {
  const rc = Object.fromEntries(xs['role-collections'].map(c => [c.name, c['role-template-references'].map(r => r.replace('$XSAPPNAME.', ''))]));
  assert(!rc.AssemblyImpact_Analyst.includes('ChangeApprover'));
  assert(!rc.AssemblyImpact_Approver.includes('ChangeAnalyst'));
  assert.deepEqual(rc.AssemblyImpact_JouleAssistant.sort(), ['ChangeAnalyst', 'ChangeViewer']);
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
  assert.equal(resources['assemblyimpact-destination'].service, 'destination');
  for (const f of ['mta.yaml', 'mta-demo.mtaext', 'xs-security.json', 'app/router/xs-app.json']) assert.doesNotMatch(read(f), /clientsecret|password|BEGIN (RSA )?PRIVATE KEY/i, f);
  assert.match(read('mta-demo.mtaext'), /stage-demo-data\.mjs/);
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

test('production profile: XSUAA, SAP HANA, demo import disabled, no seed data', () => {
  const probe = "import('@sap/cds').then(({default:cds})=>console.log(JSON.stringify({auth:cds.env.requires.auth.kind,db:cds.env.requires.db.kind,demo:cds.env.features.demo_import,data:cds.env.requires.db.data??null})))";
  const out = spawnSync(process.execPath, ['-e', probe], { cwd: ROOT, env: { ...process.env, CDS_ENV: 'production', CDS_CONFIG: '' }, encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  const env = JSON.parse(out.stdout.trim().split('\n').at(-1));
  assert.deepEqual([env.auth, env.db, env.demo], ['xsuaa', 'hana', false]);
  assert(!JSON.stringify(env.data ?? []).includes('test'));
  const pkg = JSON.parse(read('package.json'));
  for (const dep of ['@cap-js/hana', '@sap/xssec']) assert(pkg.dependencies[dep], dep);
});
