// Runtime repairs: action names must not shadow CAP service methods (the 'reject' startup warning), the
// development-only persistent demo database, authentication per profile, and the landing page's load behaviour.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { test } from 'node:test';
import cds from '@sap/cds';

const ROOT = join(import.meta.dirname, '..');
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');
const envFor = (profile, expr) => {
  const out = spawnSync(process.execPath, ['-e', `import('@sap/cds').then(({default:cds})=>console.log(JSON.stringify(${expr})))`],
    { cwd: ROOT, env: { ...process.env, CDS_ENV: profile, CDS_CONFIG: '' }, encoding: 'utf8' });
  return JSON.parse(out.stdout.trim().split('\n').pop());
};

test('no action or function of EngineeringReview shadows a CAP service method (was: reject)', async () => {
  const csn = await cds.load(join(ROOT, 'srv', 'engineering-review.cds'));
  const names = [];
  for (const [name, def] of Object.entries(csn.definitions)) {
    if (!name.startsWith('EngineeringReview.')) continue;
    if (def.kind === 'action' || def.kind === 'function') names.push(name.split('.').pop());
    for (const op of Object.keys(def.actions ?? {})) names.push(op);
  }
  const methods = new Set();
  for (let p = cds.ApplicationService.prototype; p && p !== Object.prototype; p = Object.getPrototypeOf(p))
    Object.getOwnPropertyNames(p).forEach(m => methods.add(m));
  assert(methods.has('reject'), 'sanity: ApplicationService has reject()');
  assert.deepEqual(names.filter(n => methods.has(n)), []);
  assert(names.includes('rejectCase') && !names.includes('reject'));
});

test('rejectCase contract: every client uses the new name; decision semantics unchanged', async () => {
  assert.match(read('srv/engineering-review.cds'), /grant: \['approve', 'rejectCase'\], to: 'ChangeApprover'/);
  assert.match(read('app/case-worklist/annotations.cds'), /Action\s*: 'EngineeringReview\.rejectCase'/);
  assert.match(read('app/case-worklist/annotations.cds'), /\n\s*rejectCase\(comment @title: 'Reason for Rejection'/);
  assert.match(read('app/investigation-studio/webapp/controller/Workspace.controller.js'), /_execute\("rejectCase"/);
  for (const f of ['app/case-worklist/annotations.cds', 'app/investigation-studio/webapp/controller/Workspace.controller.js', 'srv/engineering-review.cds'])
    assert.doesNotMatch(read(f), /EngineeringReview\.reject\b(?!Case)|_execute\("reject"|grant: \[[^\]]*'reject'/, f);
  const { DECISION_ACTIONS } = await import('../srv/engineering-review.js');
  const { TRANSITIONS } = await import('../srv/lib/review-decisions.js');
  assert.deepEqual(Object.keys(DECISION_ACTIONS), ['submitForReview', 'approve', 'rejectCase']);
  assert.equal(DECISION_ACTIONS.rejectCase, TRANSITIONS.reject, 'same transition: event REJECT, status REJECTED, comment required');
  // The P1 Actions contract (SAP Build) never contained the rejection and is unchanged.
  assert.doesNotMatch(read('p1/build-actions/assemblyimpact-engineering-actions.openapi.json'), /EngineeringReview\.reject/);
});

test('demo profile: development-only persistent SQLite file; production stays HANA + XSUAA; files not committed', () => {
  const expr = '{auth:cds.env.requires.auth.kind,db:cds.env.requires.db.kind,url:cds.env.requires.db.credentials?.url??null,demo:cds.env.features.demo_import}';
  assert.deepEqual(envFor('demo', expr), { auth: 'mocked', db: 'sqlite', url: 'db/demo.sqlite', demo: true });
  assert.deepEqual(envFor('', expr), { auth: 'mocked', db: 'sqlite', url: ':memory:', demo: true }, 'plain development stays in memory');
  for (const p of ['production', 'production,demo', 'hybrid,demo']) {
    const e = envFor(p, expr);
    assert.equal(e.auth, 'xsuaa', p); assert.equal(e.db, 'hana', p); assert.equal(e.demo, false, p);
  }
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts['demo:init'], 'cds deploy --to sqlite:db/demo.sqlite --no-save');
  assert.equal(pkg.scripts.demo, 'cds-serve --profile demo');
  const ignore = new Set(read('.gitignore').split('\n').map(l => l.trim()));
  for (const pattern of ['*.sqlite', '*.sqlite-journal', '*.sqlite-wal', '*.sqlite-shm', '.env']) assert(ignore.has(pattern), pattern);
});

test('mocked users exist only in development and test; documented development users and roles', () => {
  const dev = envFor('', '{kind:cds.env.requires.auth.kind,users:Object.fromEntries(Object.entries(cds.env.requires.auth.users).filter(([,u])=>u).map(([k,u])=>[k,[u.roles,u.attr]]))}');
  assert.equal(dev.kind, 'mocked');
  assert.deepEqual(dev.users, {
    developer: [['AssemblyMaintainer'], { plants: ['1000'] }],
    analyst: [['ChangeAnalyst', 'DemoDataImporter', 'ErpExtractor'], { plants: ['1000'] }],
    cviewer: [['ChangeViewer'], { plants: ['1000'] }],
    analyst2000: [['ChangeAnalyst'], { plants: ['2000'] }],
    approver: [['ChangeApprover'], { plants: ['1000'] }]
  });
  const prod = envFor('production', '{kind:cds.env.requires.auth.kind,users:cds.env.requires.auth.users??null}');
  assert.equal(prod.kind, 'xsuaa');
  assert.equal(prod.users, null, 'no mocked users in production');
});

test('landing page: sap.m.Page (no DynamicPage content-fit oscillation); one request before the rest; auth errors keep the page', () => {
  const view = read('app/home/webapp/view/Home.view.xml');
  assert.match(view, /<App id="homeApp"[^>]*>\s*<pages>\s*<Page id="homePage" showHeader="false"/, 'Page inside App (a Page alone had 0 px height)');
  assert.doesNotMatch(view, /<f:DynamicPage/);
  const ctrl = read('app/home/webapp/controller/Home.controller.js');
  const first = ctrl.indexOf('return this._get("systemStatus()").then(function (status) {');
  assert(first > 0 && first < ctrl.indexOf('Promise.all(countKeys'), 'systemStatus is requested alone first');
  let ov;
  vm.runInNewContext(read('app/home/webapp/lib/overview.js'), { sap: { ui: { define: (_d, f) => { ov = f(); } } } });
  assert.match(ov.loadError({ status: 401 }), /^Sign-in required/);
  assert.match(ov.loadError({ status: 403 }), /no role/);
  assert.match(ov.loadError(new Error('HTTP 500 for x')), /could not be loaded/);
});
