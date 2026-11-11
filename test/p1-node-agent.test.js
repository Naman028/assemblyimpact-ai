// P1 alternative: Node.js Engineering Assistant (askAssistant) with Gemini function calling.
// Integration tests use the test profile's labelled rule-based model (FIXTURE_RULES) against the real CAP service;
// unit tests drive the agent loop with a scripted Gemini-shaped model and a stubbed Gemini HTTP API.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { before, after, test } from 'node:test';

process.env.CDS_ENV = 'test';
process.env.CDS_CONFIG = JSON.stringify({ requires: { db: { data: ['db/data', 'db/csv', 'test/data'] } } });
const { default: cds } = await import('@sap/cds');
const agent = await import('../srv/integration/genai/assistant.js');
let server, base;

const call = async (method, path, { user = 'analyst', body } = {}) => {
  const response = await fetch(base + path, { method,
    headers: { 'content-type': 'application/json', authorization: `Basic ${Buffer.from(`${user}:test`).toString('base64')}` },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, data: await response.json().catch(() => null) };
};
const ask = (message, user = 'analyst', history) => call('POST', '/askAssistant', { user, body: { message, history } });
const runCount = async () => (await cds.run(SELECT.one.from('assemblyimpact.ImpactRuns').columns('count(1) as n'))).n;
const decisionCount = async () => (await cds.run(SELECT.one.from('assemblyimpact.DecisionEvents').columns('count(1) as n'))).n;

before(async () => {
  server = await cds.server({ port: 0, in_memory: true });
  if (!server.listening) await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}/odata/v4/engineering-review`;
});
after(async () => {
  if (server) await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  await cds.db?.disconnect();
});

test('agent: impact question uses lookup + impact tools as the caller and answers from the run', async () => {
  const run = await call('POST', '/ReviewCases(7263f5aa-71cf-5325-8dd7-41ca2e1a0fd5)/EngineeringReview.runImpact', { body: {} });
  assert.equal(run.status, 200, JSON.stringify(run.data));
  const r = await ask('What is the impact of EC-000473?');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.status, 'ANSWERED', r.data.issues);
  assert.equal(r.data.generatedBy, 'FIXTURE_RULES');
  assert.match(r.data.answer, /EC-000473 \(COOL-100\).*1200\.00 EUR, 2 material\(s\) short/);
  assert.deepEqual(JSON.parse(r.data.toolCalls).map(t => [t.tool, t.ok]), [['getImpact', true]]);
  assert.equal(r.data.proposal, null);
});

test('agent: plant isolation - a plant-2000 user cannot see EC-000473 through the agent', async () => {
  const r = await ask('What is the impact of EC-000473?', 'analyst2');
  assert.equal(r.status, 200);
  assert.match(r.data.answer, /not found or is not visible/);
  assert.deepEqual(JSON.parse(r.data.toolCalls)[0], { tool: 'getImpact', skill: 'Explain Case Impact', action: 'GetEngineeringImpact', args: { caseNumber: 'EC-000473' }, ok: false, error: 'NOT_FOUND' });
});

test('agent: run impact is only proposed (no write); confirming uses the normal action and its role check', async () => {
  const runsBefore = await runCount();
  const r = await ask('Please run the impact for EC-000482');
  assert.equal(r.data.status, 'ANSWERED');
  const proposal = JSON.parse(r.data.proposal);
  assert.deepEqual(proposal, { action: 'runImpact', caseID: '1e76023c-ed28-5b84-a7f2-2d11fe48e458', caseNumber: 'EC-000482', assemblyCode: 'CTRL-400', params: {},
    summary: 'Run the impact calculation for EC-000482 (CTRL-400).' });
  assert.equal(await runCount(), runsBefore, 'the agent itself never runs the calculation');
  const confirmed = await call('POST', `/ReviewCases(${proposal.caseID})/EngineeringReview.runImpact`, { body: {} });
  assert.equal(confirmed.status, 200);
  assert.equal(await runCount(), runsBefore + 1);
});

test('agent: a viewer gets no run proposal; approver too (roles unchanged)', async () => {
  for (const user of ['cviewer', 'approver']) {
    const r = await ask('run the impact for EC-000482', user);
    assert.equal(r.status, 200, user);
    assert.equal(r.data.proposal, null, user);
    assert.match(r.data.answer, /cannot run impact/, user);
  }
});

test('agent: decision history is read-only and plant-scoped; users without a business role are refused', async () => {
  const before = await decisionCount();
  const r = await ask('Show the decision history of EC-000473', 'cviewer');
  assert.equal(r.data.status, 'ANSWERED');
  assert.match(r.data.answer, /EC-000473/);
  assert.equal(await decisionCount(), before);
  assert.equal((await ask('hello', 'norole')).status, 403);
  assert.equal((await ask('', 'analyst')).status, 400);
});

test('agent loop with a Gemini-shaped model: multi-step tools, thought signatures kept, grounded answer', async () => {
  const seen = [];
  const model = async ({ contents, tools }) => {
    seen.push(structuredClone(contents));
    assert.equal(tools.length, 10);
    if (seen.length === 1) return { parts: [{ functionCall: { name: 'lookupCases', args: { assemblyCode: 'COOL-100' } }, thoughtSignature: 'sig-1' }], model: 'm' };
    if (seen.length === 2) return { parts: [{ functionCall: { name: 'getImpact', args: { caseNumber: 'EC-000473' } }, thoughtSignature: 'sig-2' }], model: 'm' };
    return { parts: [{ text: 'EC-000473 on COOL-100 costs 1,200.00 EUR more; BRKT-01 is short by 50 PC.' }], model: 'm', usage: { promptTokens: 900, outputTokens: 40, totalTokens: 940 } };
  };
  model.generatedBy = 'GOOGLE_GEMINI_API';
  const tools = {
    lookupCases: async () => ({ count: 1, cases: [{ caseNumber: 'EC-000473', assemblyCode: 'COOL-100' }] }),
    getImpact: async () => ({ caseNumber: 'EC-000473', run: { costDeltaTotal: '1200.00', currency: 'EUR', shortages: [{ material: 'BRKT-01', gap: '50.000' }] } }),
  };
  const r = await agent.runAssistant({ message: 'cost of the COOL-100 change?', tools, model });
  assert.equal(r.status, 'ANSWERED', r.issues);
  assert.equal(r.steps, 3);
  assert.deepEqual(JSON.parse(r.usage), { requests: 3, promptTokens: 900, outputTokens: 40, totalTokens: 940 });
  assert.deepEqual(JSON.parse(r.toolCalls).map(t => t.action), ['LookupEngineeringCases', 'GetEngineeringImpact']);
  assert.deepEqual(seen[2].map(c => c.role), ['user', 'model', 'user', 'model', 'user']);
  assert.deepEqual([seen[2][1].parts[0].thoughtSignature, seen[2][3].parts[0].thoughtSignature], ['sig-1', 'sig-2'], 'model turns are sent back unchanged');
  assert.equal(seen[2].at(-1).parts[0].functionResponse.name, 'getImpact');
});

test('agent answer check: invented figures, unknown cases and decision advice are withheld', async () => {
  const results = [{ run: { costDeltaTotal: '1200.00', materialsShort: 2 }, caseNumber: 'EC-000473' }];
  assert.deepEqual(agent.checkAnswer('EC-000473 costs 1,200.00 EUR more and 2 materials (BRKT-01, FAN-B) are short.', results, 'q'), []);
  assert.deepEqual(agent.checkAnswer('It costs 1,250.00 EUR more.', results, 'q'), ['UNGROUNDED_NUMBER:1250']);
  assert.deepEqual(agent.checkAnswer('See also EC-000999.', results, 'q'), ['UNKNOWN_CASE:EC-000999']);
  assert.deepEqual(agent.checkAnswer('I recommend that you approve EC-000473.', results, 'q'), ['DECISION_RECOMMENDATION']);
  assert.deepEqual(agent.checkAnswer('', results, 'q'), ['EMPTY_ANSWER']);
  const loop = async () => ({ parts: [{ functionCall: { name: 'lookupCases', args: {} } }] });
  loop.generatedBy = 'x';
  const r = await agent.runAssistant({ message: 'q', tools: { lookupCases: async () => ({ count: 0, cases: [] }) }, model: loop });
  assert.deepEqual([r.status, r.issues, r.steps], ['WITHHELD', 'MAX_STEPS', agent.MAX_STEPS]);
});

test('Gemini agent HTTP: function declarations sent, key only as header, errors mapped without body text', async () => {
  let request;
  const fetchOk = async (url, init) => { request = { url, init }; return { ok: true, status: 200, json: async () => ({ modelVersion: 'gemini-3.5-flash-lite', candidates: [{ content: { parts: [{ text: 'hi' }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, thoughtsTokenCount: 1, totalTokenCount: 13 } }) }; };
  const model = agent.geminiAgentModel({ modelId: 'gemini-3.5-flash-lite', apiKeyEnv: 'K' }, { K: 'secret-key' }, fetchOk);
  const out = await model({ system: 's', contents: [{ role: 'user', parts: [{ text: 'q' }] }], tools: agent.TOOL_DECLARATIONS });
  assert.deepEqual(out, { parts: [{ text: 'hi' }], model: 'gemini-3.5-flash-lite', usage: { promptTokens: 10, outputTokens: 3, totalTokens: 13 } });
  assert.match(request.url, /models\/gemini-3\.5-flash-lite:generateContent$/);
  assert.equal(request.init.headers['x-goog-api-key'], 'secret-key');
  assert(!request.url.includes('secret-key'));
  const body = JSON.parse(request.init.body);
  assert.deepEqual(body.tools[0].functionDeclarations.map(t => t.name), ['lookupCases', 'getImpact', 'getDecisionHistory', 'getAiExplanation', 'proposeRunImpact', 'proposeEditInput', 'proposeConsumptionRate', 'proposeSubmitForReview', 'proposeDecision', 'proposeImportScenario']);
  assert.equal(body.generationConfig.temperature, 0);
  const fail = agent.geminiAgentModel({ modelId: 'x', apiKeyEnv: 'K' }, { K: 'k' }, async () => ({ ok: false, status: 404, json: async () => ({ error: { status: 'NOT_FOUND', message: 'secret details' } }) }));
  await assert.rejects(fail({ system: '', contents: [], tools: [] }), e => e.status === 404 && /HTTP 404 NOT_FOUND/.test(e.message) && !/secret/.test(e.message));
  assert.throws(() => agent.geminiAgentModel({ modelId: 'x', apiKeyEnv: 'K' }, {}), /not configured/);
  assert.deepEqual(agent.parseHistory(JSON.stringify([{ role: 'user', text: 'a' }, { role: 'system', text: 'x' }, { role: 'model', text: 'b' }])),
    [{ role: 'user', parts: [{ text: 'a' }] }, { role: 'model', parts: [{ text: 'b' }] }]);
});

test('agent: AI explanation tool reuses the validated P2 explanation (same plant check, no write)', async () => {
  assert.equal((await call('POST', '/ReviewCases(08c74846-d7d2-55ff-ad09-c7ad9c4fa733)/EngineeringReview.runImpact', { body: {} })).status, 200);
  const runs = await runCount();
  const r = await ask('Give me the AI explanation for EC-000485');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(JSON.parse(r.data.toolCalls).map(t => [t.tool, t.action, t.ok]), [['getAiExplanation', 'explainImpact (P2 AI Explanation)', true]]);
  assert.match(r.data.answer, /^(AI explanation for EC-000485: |The AI explanation was withheld by the grounding check \()/);
  const missing = await ask('Give me the AI explanation for EC-000481');
  assert.match(missing.data.answer, /nothing to explain/);
  assert.equal(await runCount(), runs);
  const foreign = await ask('Give me the AI explanation for EC-000473', 'analyst2');
  assert.match(foreign.data.answer, /not found or is not visible/);
});

test('agent: tool budget stops runaway lookups', async () => {
  const greedy = async () => ({ parts: Array.from({ length: 3 }, () => ({ functionCall: { name: 'lookupCases', args: {} } })) });
  greedy.generatedBy = 'x';
  let calls = 0;
  const r = await agent.runAssistant({ message: 'q', tools: { lookupCases: async () => { calls++; return { count: 0, cases: [] }; } }, model: greedy });
  assert.equal(calls, agent.MAX_TOOL_CALLS);
  assert.equal(JSON.parse(r.toolCalls).filter(t => t.error === 'TOOL_BUDGET').length, 3 * agent.MAX_STEPS - agent.MAX_TOOL_CALLS);
});

// ---- write proposals (agent prepares, the user confirms through the normal CAP endpoints) ----
const tool = (name, args, user, extra = {}) => call('POST', '/askAssistant', { user, body: { message: `#tool ${JSON.stringify({ name, args })}`, ...extra } });
const proposalOf = r => JSON.parse(r.data.proposal);
const confirm = (p, user) => p.action === 'createRate' ? call('POST', '/MaterialConsumptionRates', { user, body: p.params })
  : p.action === 'importScenario' ? call('POST', '/importScenario', { user, body: p.params })
  : call('POST', `/ReviewCases(${p.caseID})/EngineeringReview.${p.action}`, { user, body: p.params });

test('agent write: edit input is only proposed; confirm applies it with the importer role; viewer gets nothing', async () => {
  const item = () => cds.run(SELECT.one.from('assemblyimpact.BOMItems').columns('quantity').where({ bomState_ID: SELECT.one.from('assemblyimpact.ReviewCases').columns('toState_ID').where({ caseNumber: 'EC-000486' }), itemNo: '0010' }));
  const before = Number((await item()).quantity);
  const r = await tool('proposeEditInput', { caseNumber: 'EC-000486', kind: 'PROPOSED_QUANTITY', itemNo: '0010', value: before + 1 }, 'importer');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const p = proposalOf(r);
  assert.deepEqual([p.action, p.params], ['reviseDemoInput', { kind: 'PROPOSED_QUANTITY', itemNo: '0010', value: String(before + 1) }]);
  assert.equal(Number((await item()).quantity), before, 'nothing changed before confirmation');
  assert.equal((await confirm(p, 'importer')).status, 200);
  assert.equal(Number((await item()).quantity), before + 1);
  assert.match((await tool('proposeEditInput', { caseNumber: 'EC-000486', kind: 'PRICE', material: 'X-1', value: 1 }, 'cviewer')).data.answer, /cannot edit/);
  assert.equal((await confirm(p, 'cviewer')).status, 403, 'a forged confirmation still meets the role check');
});

test('agent write: consumption rate proposal takes unit and plant from the case; confirm creates the rate', async () => {
  const r = await tool('proposeConsumptionRate', { caseNumber: 'EC-000482', material: 'ENCL-400', period: 'WEEK', quantity: 2, validFrom: '2026-11-11', validTo: '2026-12-31' }, 'analyst');
  const p = proposalOf(r);
  assert.deepEqual(p.params, { material: 'ENCL-400', plant: '1000', period: 'WEEK', quantity: '2', unit: 'PC', validFrom: '2026-11-11', validTo: '2026-12-31', note: 'Entered via Engineering Assistant for EC-000482' });
  const created = await confirm(p, 'analyst');
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.match((await tool('proposeConsumptionRate', { caseNumber: 'EC-000482', material: 'NOPE-1', period: 'WEEK', quantity: 2, validFrom: '2026-11-11', validTo: '2026-12-31' }, 'analyst')).data.answer, /not a component/);
});

test('agent write: scenario import is validated as a dry run, written only on confirmation', async () => {
  const { readFileSync } = await import('node:fs');
  const file = readFileSync(new URL('../app/investigation-studio/webapp/samples/scenario-import-sample.json', import.meta.url), 'utf8')
    .replaceAll('BLOW-900', 'BLOW-901').replaceAll('EC-000490', 'EC-000590');
  const cases = async () => (await cds.run(SELECT.one.from('assemblyimpact.ReviewCases').columns('count(1) as n'))).n;
  const n = await cases();
  const r = await tool('proposeImportScenario', {}, 'importer', { attachment: file, attachmentName: 'my-scenario.json' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const p = proposalOf(r);
  assert.equal(p.action, 'importScenario');
  assert.equal(p.params.dryRun, false);
  assert.match(p.summary, /EC-000590 BLOW-901/);
  assert.equal(await cases(), n, 'dry run wrote nothing');
  const done = await confirm(p, 'importer');
  assert.equal(done.status, 200, JSON.stringify(done.data));
  assert.equal(done.data.accepted, true);
  assert.equal(await cases(), n + 1);
  assert.match((await tool('proposeImportScenario', {}, 'importer')).data.answer, /Paste the scenario file/);
  assert.match((await tool('proposeImportScenario', {}, 'analyst', { attachment: file })).data.answer, /cannot import/);
});

test('agent write: submit and decision proposals; the approver confirms; separation of duties still enforced', async () => {
  const id = '7263f5aa-71cf-5325-8dd7-41ca2e1a0fd5';                       // EC-000473, has a run from the first test
  const s = proposalOf(await tool('proposeSubmitForReview', { caseNumber: 'EC-000473', comment: 'via assistant' }, 'dual'));
  assert.deepEqual([s.action, s.params], ['submitForReview', { comment: 'via assistant' }]);
  assert.equal((await confirm(s, 'dual')).status, 200);
  const own = proposalOf(await tool('proposeDecision', { caseNumber: 'EC-000473', decision: 'APPROVE' }, 'dual'));
  assert.equal((await confirm(own, 'dual')).status, 403, 'the submitter cannot approve, assistant or not');
  assert.match((await tool('proposeDecision', { caseNumber: 'EC-000473', decision: 'REJECT' }, 'approver')).data.answer, /needs a comment/);
  assert.match((await tool('proposeDecision', { caseNumber: 'EC-000473', decision: 'APPROVE' }, 'analyst')).data.answer, /Only approvers/);
  const a = proposalOf(await tool('proposeDecision', { caseNumber: 'EC-000473', decision: 'APPROVE', comment: 'ok' }, 'approver'));
  assert.equal(a.action, 'approve');
  const status = async () => (await cds.run(SELECT.one.from('assemblyimpact.ReviewCases').columns('status').where({ ID: id }))).status;
  assert.equal(await status(), 'IN_REVIEW', 'nothing decided before confirmation');
  const done = await confirm(a, 'approver');
  assert.equal(done.status, 200, JSON.stringify(done.data));
  assert.equal(await status(), 'APPROVED');
});

test('exam demo scenario PUMP-950: imports through the agent and calculates the documented figures', async () => {
  const { readFileSync } = await import('node:fs');
  const file = readFileSync(new URL('../app/investigation-studio/webapp/samples/pump-950-demo-scenario.json', import.meta.url), 'utf8');
  const asked = await tool('proposeImportScenario', {}, 'importer', { attachment: file, attachmentName: 'pump-950-demo-scenario.json' });
  assert(asked.data.proposal, JSON.stringify(asked.data));
  const p = proposalOf(asked);
  const done = await confirm(p, 'importer');
  assert.equal(done.status, 200, JSON.stringify(done.data));
  const run = await call('POST', `/ReviewCases(${done.data.caseIds[0]})/EngineeringReview.runImpact`, { user: 'importer', body: { asOfDate: '2026-12-01' } });
  assert.equal(run.status, 200, JSON.stringify(run.data));
  assert.deepEqual([run.data.fromCostPerAssembly, run.data.toCostPerAssembly, run.data.deltaPerAssembly, run.data.costDeltaTotal, run.data.costDeltaPercent, run.data.materialsShort, run.data.instructionFindings],
    ['66.20', '84.10', '17.90', '2148.00', '27.04', 2, run.data.instructionFindings]);
  assert(run.data.instructionFindings >= 1, 'IMP-950 and SCR-950 x6 in the work instruction no longer match revision B');
});

test('Gemini agent HTTP: one retry on a temporary 503, no retry on 400', async () => {
  let calls = 0;
  const flaky = async () => (++calls === 1 ? { ok: false, status: 503, json: async () => ({ error: { status: 'UNAVAILABLE' } }) }
    : { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }) });
  const m = agent.geminiAgentModel({ modelId: 'x', apiKeyEnv: 'K', retryDelayMs: 1 }, { K: 'k' }, flaky);
  assert.equal((await m({ system: '', contents: [], tools: [] })).parts[0].text, 'ok');
  assert.equal(calls, 2);
  let bad = 0;
  const m400 = agent.geminiAgentModel({ modelId: 'x', apiKeyEnv: 'K', retryDelayMs: 1 }, { K: 'k' }, async () => { bad++; return { ok: false, status: 400, json: async () => ({}) }; });
  await assert.rejects(m400({ system: '', contents: [], tools: [] }), e => e.status === 400);
  assert.equal(bad, 1);
});
