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
  assert.deepEqual(JSON.parse(r.data.toolCalls)[0], { tool: 'getImpact', action: 'GetEngineeringImpact', args: { caseNumber: 'EC-000473' }, ok: false, error: 'NOT_FOUND' });
});

test('agent: run impact is only proposed (no write); confirming uses the normal action and its role check', async () => {
  const runsBefore = await runCount();
  const r = await ask('Please run the impact for EC-000482');
  assert.equal(r.data.status, 'ANSWERED');
  const proposal = JSON.parse(r.data.proposal);
  assert.deepEqual(proposal, { action: 'runImpact', caseID: '1e76023c-ed28-5b84-a7f2-2d11fe48e458', caseNumber: 'EC-000482', assemblyCode: 'CTRL-400' });
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
    assert.equal(tools.length, 5);
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
  assert.deepEqual(body.tools[0].functionDeclarations.map(t => t.name), ['lookupCases', 'getImpact', 'getDecisionHistory', 'getAiExplanation', 'proposeRunImpact']);
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
