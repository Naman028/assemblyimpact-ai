// P2: evidence-grounded GenAI explanation (srv/integration/genai/impact-explanation.js).
// No live model is called here: the 'fixture' provider returns canned answers labelled FIXTURE_LLM_RESPONSE.
// The tests prove the contract around the model: what it is given, how its answer is checked, and that
// ungrounded or decision-making answers are withheld, plant isolation, and the SAP Generative AI Hub request shape.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { before, after, test } from 'node:test';
import { buildSeed } from './m04-seed.js';

process.env.CDS_ENV = 'test';
process.env.CDS_CONFIG = JSON.stringify({ requires: { db: { data: ['db/data', 'db/csv', 'test/data'] } } });
const { default: cds } = await import('@sap/cds');
const genai = await import('../srv/integration/genai/impact-explanation.js');
const seed = buildSeed();
const idOf = n => seed.ReviewCases.find(c => c.caseNumber === n).ID;
let server, base;

const call = async (method, path, { user = 'cviewer', body } = {}) => {
  const response = await fetch(base + path, { method,
    headers: { 'content-type': 'application/json', authorization: `Basic ${Buffer.from(`${user}:test`).toString('base64')}` },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, data: await response.json().catch(() => null) };
};
const run = id => call('POST', `/ReviewCases(${id})/EngineeringReview.runImpact`, { user: 'analyst', body: { asOfDate: '2026-11-08' } });
const explain = (id, user) => call('GET', `/ReviewCases(${id})/EngineeringReview.explainImpact()`, { user });

before(async () => {
  server = await cds.server({ port: 0, in_memory: true });
  if (!server.listening) await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}/odata/v4/engineering-review`;
});
after(async () => {
  if (server) await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  await cds.db?.disconnect();
});

test('no explanation without a persisted run (409 NO_IMPACT_RUN)', async () => {
  const r = await explain(idOf('EC-000485'));
  assert.equal(r.status, 409);
  assert.equal(r.data.error.code, 'NO_IMPACT_RUN');
});

test('grounded answer: returned with citations, provenance and the prompt hash', async () => {
  const id = idOf('EC-000485');
  const ran = await run(id);
  assert.equal(ran.status, 200, JSON.stringify(ran.data));
  const r = await explain(id);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.status, 'GROUNDED', r.data.issues);
  assert.equal(r.data.runID, ran.data.ID, 'explains the latest run');
  assert.equal(r.data.generatedBy, 'FIXTURE_LLM_RESPONSE', 'canned answer is labelled, never presented as a live model');
  assert.match(r.data.text, /6756\.00 EUR/);
  assert.deepEqual(r.data.citations.split(',').sort(), ['B1', 'B2', 'B3', 'F1', 'F2', 'F3', 'F4', 'F5', 'F8', 'M1', 'M2', 'RUN']);
  assert.match(r.data.promptSha256, /^[0-9a-f]{64}$/);
  assert.equal(r.data.issues, null);
});

test('an invented figure or a decision recommendation is withheld (text null, issues listed)', async () => {
  for (const [caseNumber, issue] of [['EC-000484', 'UNGROUNDED_NUMBER:99999'], ['EC-000483', 'DECISION_RECOMMENDATION']]) {
    const id = idOf(caseNumber);
    assert.equal((await run(id)).status, 200);
    const r = await explain(id);
    assert.equal(r.status, 200);
    assert.equal(r.data.status, 'WITHHELD', caseNumber);
    assert.equal(r.data.text, null, `${caseNumber}: ungrounded text never reaches the user`);
    assert(r.data.issues.split(';').includes(issue), `${caseNumber}: ${r.data.issues}`);
  }
});

test('plant isolation and roles: foreign plant 404, Joule reader allowed, no write side effect', async () => {
  const id = idOf('EC-000485');
  assert.equal((await explain(id, 'analyst2')).status, 404, 'plant-2000 user');
  assert.equal((await explain(id, 'joulereader')).status, 200, 'read-only role suffices');
  const before = (await call('GET', `/ReviewCases(${id})/runs?$count=true`)).data['@odata.count'];
  await explain(id);
  assert.equal((await call('GET', `/ReviewCases(${id})/runs?$count=true`)).data['@odata.count'], before, 'explaining never creates a run');
});

test('validator: citations must exist, numbers must come from the evidence', () => {
  const evidence = { case: { caseNumber: 'EC-000001' }, run: { id: 'RUN', costDeltaTotal: 1200, currency: 'EUR', asOfDate: '2026-11-08' },
    facts: [{ id: 'M1', material: 'BRG-300A', required: 400, available: 350, gap: 50 }] };
  assert.equal(genai.validateExplanation('Cost rises by 1,200.00 EUR [RUN]; BRG-300A is short by 50 [M1].', evidence).ok, true);
  assert.deepEqual(genai.validateExplanation('Cost rises by 1300 EUR [RUN].', evidence).issues, ['UNGROUNDED_NUMBER:1300']);
  assert.deepEqual(genai.validateExplanation('BRG-300A is short [M9].', evidence).issues, ['UNKNOWN_CITATION:M9']);
  assert.deepEqual(genai.validateExplanation('Cost rises.', evidence).issues, ['NO_CITATIONS']);
  assert.deepEqual(genai.validateExplanation('', evidence).issues, ['EMPTY_ANSWER']);
  assert(genai.validateExplanation('Data is complete [RUN]. We recommend that you approve it.', evidence).issues.includes('DECISION_RECOMMENDATION'));
});

test('the prompt carries only the run evidence and the grounding rules', () => {
  const messages = genai.messagesFor({ case: {}, run: {}, facts: [] });
  assert.equal(messages.length, 2);
  assert.match(messages[0].content, /Use ONLY the JSON evidence/);
  assert.match(messages[0].content, /Do not recommend approving or rejecting/);
  assert.match(messages[1].content, /^Evidence:\n\{/);
});

test('providers: unconfigured modes are refused; SAP Generative AI Hub request shape', async () => {
  assert.throws(() => genai.providerFor({}), genai.GenAiConfigError);
  assert.throws(() => genai.providerFor({ provider: 'genai-hub', resourceGroup: 'default' }), genai.GenAiConfigError);
  assert.throws(() => genai.providerFor({ provider: 'fixture' }), genai.GenAiConfigError);
  const original = cds.connect.to, sent = [];
  cds.connect.to = async name => ({ send: async req => { sent.push({ name, ...req }); return { model: 'gpt-4o', choices: [{ message: { content: 'ok [RUN]' } }] }; } });
  try {
    const provider = genai.providerFor({ provider: 'genai-hub', service: 'genai-hub', deploymentId: 'd123', resourceGroup: 'assemblyimpact', apiVersion: '2024-02-01' });
    const answer = await provider([{ role: 'user', content: 'x' }]);
    assert.deepEqual(answer, { text: 'ok [RUN]', model: 'gpt-4o', generatedBy: 'SAP_GENAI_HUB' });
    assert.equal(sent[0].name, 'genai-hub');
    assert.equal(sent[0].method, 'POST');
    assert.equal(sent[0].path, '/v2/inference/deployments/d123/chat/completions?api-version=2024-02-01');
    assert.deepEqual(sent[0].headers, { 'AI-Resource-Group': 'assemblyimpact' });
    assert.equal(sent[0].data.temperature, 0);
  } finally { cds.connect.to = original; }
});

test('Investigation Studio: AI Explanation tab calls explainImpact and shows withheld answers as a warning', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const web = join(import.meta.dirname, '..', 'app', 'investigation-studio', 'webapp');
  const view = readFileSync(join(web, 'view', 'Workspace.view.xml'), 'utf8');
  const ctrl = readFileSync(join(web, 'controller', 'Workspace.controller.js'), 'utf8');
  assert.match(view, /<IconTabFilter key="explain" text="AI Explanation"/);
  assert.match(view, /id="btnExplain"[^>]*press="\.onExplain"[^>]*enabled="\{= !!\$\{ws>\/run\} \}"/, 'enabled only with a run');
  assert.match(view, /visible="\{= \$\{ws>\/explanation\/status\} === 'WITHHELD' \}"/);
  assert.match(view, /generatedBy/, 'provenance is shown');
  assert.match(ctrl, /bindContext\("EngineeringReview\.explainImpact\(\.\.\.\)", this\._binding\.getBoundContext\(\)\)/);
  assert.match(ctrl, /explanation\/runID"\) !== run\.ID/, 'stale explanation is cleared when the run changes');
});
