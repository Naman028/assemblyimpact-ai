// P2: Google Gemini API provider for structured, evidence-grounded explanations.
// No live model is called here. Gemini's HTTP answers are simulated with a stubbed fetch; these tests prove the
// request shape, the structured-output contract, the grounding checks and the error mapping. They are NOT
// evidence that the external API was called (see docs/p2/genai-provider.md for the live test record).
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
const KEY = 'test-key-not-a-secret-0123456789';

// ------------------------------------------------------------------ evidence used by the unit tests
const caseOf = (over = {}) => ({ caseNumber: 'EC-000485', assemblyCode: 'HYD-700', plant: '1000', sourceType: 'SYNTHETIC_FIXTURE', status: 'OPEN', ...over });
const runOf = (over = {}) => ({ ID: 'run-1', status: 'COMPLETE', flags: null, asOfDate: '2026-11-08', currency: 'EUR', productionQuantity: 60,
  fromRevision: 'A', toRevision: 'B', fromCostPerAssembly: '317.28', toCostPerAssembly: '429.88', deltaPerAssembly: '112.60', costDeltaTotal: '6756.00',
  costDeltaPercent: '35.49', materialsShort: 1, materialsUnknown: 0, instructionFindings: 1, instructionsToUpdate: 1,
  findings: [{ severity: 'HIGH', type: 'STOCK_GAP', material: 'FIT-700', details: 'Required 360 PC, available 250, gap 110', evidenceRefs: 'DS/stock/FIT-700' },
    { severity: 'MEDIUM', type: 'WI_REFERENCES_REMOVED_PART', material: 'PLUG-700', details: 'WI-HYD-700-ASM v5 step 0030 references PLUG-700', evidenceRefs: 'WI-HYD-700-ASM' }],
  materialLines: [{ material: 'FIT-700', unit: 'PC', required: '360', available: '250', gap: '110', status: 'SHORT', stale: false }],
  comparisonLines: [{ itemNo: '0040', change: 'QUANTITY_CHANGED', fromMaterial: 'FIT-700', fromQuantity: '4', toMaterial: 'FIT-700', toQuantity: '6', unit: 'PC' }],
  ...over });
const good = () => ({
  summary: 'The run is COMPLETE as of 2026-11-08 [RUN]. Cost rises by 6756.00 EUR and FIT-700 is short [RUN][M1].',
  verifiedImpact: 'Per assembly the cost rises from 317.28 EUR to 429.88 EUR (112.60 EUR); for 60 assemblies 6756.00 EUR, 35.49 % [RUN]. FIT-700 goes from 4 to 6 at item 0040 [B1].',
  shortageAnalysis: 'FIT-700 needs 360 PC, 250 available, gap 110 [M1][F1].',
  workInstructionImplications: 'WI-HYD-700-ASM v5 step 0030 still references PLUG-700 [F2].',
  nextActions: ['Confirm the FIT-700 delivery date with purchasing [M1].', 'Update WI-HYD-700-ASM v5 step 0030 [F2].'],
  warnings: ['Fictional synthetic demo data [RUN].'],
  references: ['RUN', 'M1', 'F1', 'F2', 'B1'],
});

/** A fetch stub answering like the Gemini generateContent endpoint. */
const geminiFetch = (respond, calls = []) => async (url, init) => {
  calls.push({ url: String(url), init, body: JSON.parse(init.body) });
  return respond(url, init);
};
const ok = sections => async () => new Response(JSON.stringify({ modelVersion: 'gemini-2.5-flash',
  candidates: [{ finishReason: 'STOP', content: { parts: [{ text: typeof sections === 'string' ? sections : JSON.stringify(sections) }] } }] }), { status: 200 });
const cfg = { provider: 'gemini', model: 'gemini-2.5-flash', apiKeyEnv: 'GEMINI_API_KEY', timeoutMs: 200 };
const gem = (respond, calls, over = {}) => genai.geminiProvider({ ...cfg, ...over }, { GEMINI_API_KEY: KEY }, geminiFetch(respond, calls));

test('valid structured explanation: grounded, sections returned, request shape and key handling', async () => {
  const calls = [];
  const r = await genai.explain(caseOf(), runOf(), gem(ok(good()), calls));
  assert.equal(r.status, 'GROUNDED', r.issues);
  assert.equal(r.generatedBy, 'GOOGLE_GEMINI_API');
  assert.equal(r.model, 'gemini-2.5-flash');
  const sections = JSON.parse(r.sections);
  assert.deepEqual(Object.keys(sections), ['summary', 'verifiedImpact', 'shortageAnalysis', 'workInstructionImplications', 'nextActions', 'warnings', 'references']);
  assert.match(r.text, /Proposed next actions \(not decisions\)/);
  const [call] = calls;
  assert.equal(call.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
  assert.equal(call.init.headers['x-goog-api-key'], KEY, 'key sent as header');
  assert.equal(call.url.includes(KEY), false, 'key never in the URL');
  assert.equal(call.init.body.includes(KEY), false, 'key never in the body');
  assert.equal(JSON.stringify(r).includes(KEY), false, 'key never returned');
  assert.equal(call.body.generationConfig.responseMimeType, 'application/json');
  assert.deepEqual(call.body.generationConfig.responseSchema.required, ['summary', 'verifiedImpact', 'shortageAnalysis', 'workInstructionImplications', 'nextActions', 'warnings', 'references']);
  assert.equal(call.body.generationConfig.temperature, 0);
  const sent = call.body.contents[0].parts[0].text;
  assert.match(sent, /^Evidence:\n\{/);
  assert.equal(sent.includes('"plant"'), false, 'plant is not in the approved data list');
  assert.equal(sent.includes('run-1'), false, 'run UUID is not sent');
  assert.match(call.body.systemInstruction.parts[0].text, /never approve, reject or release the change/);
});

test('incomplete cost and unknown coverage need a limitation warning', async () => {
  const incomplete = runOf({ status: 'INCOMPLETE', flags: 'MISSING_PRICE', costDeltaTotal: null, costDeltaPercent: null, deltaPerAssembly: null, toCostPerAssembly: null });
  const noWarning = { ...good(), verifiedImpact: 'The cost delta cannot be calculated because prices are missing [RUN].', warnings: [] };
  let r = await genai.explain(caseOf(), incomplete, gem(ok({ ...noWarning, summary: 'The run is INCOMPLETE [RUN].' })));
  assert.equal(r.status, 'WITHHELD');
  assert(r.issues.includes('warnings:MISSING_LIMITATION_WARNING'), r.issues);
  // Unknown stock coverage (materialsUnknown > 0) also needs a warning; the invented cost figure is caught too.
  r = await genai.explain(caseOf(), runOf({ materialsUnknown: 2 }), gem(ok({ ...good(), warnings: [], summary: 'Cost rises by 7000 EUR [RUN].' })));
  assert.equal(r.status, 'WITHHELD');
  assert(r.issues.includes('warnings:MISSING_LIMITATION_WARNING'), r.issues);
  assert(r.issues.includes('summary:UNGROUNDED_NUMBER:7000'), r.issues);
  // With the warning stated, an incomplete run is explained.
  r = await genai.explain(caseOf(), incomplete, gem(ok({ ...noWarning, summary: 'The run is INCOMPLETE; prices are missing [RUN].',
    warnings: ['The cost figures are incomplete: MISSING_PRICE [RUN].'] })));
  assert.equal(r.status, 'GROUNDED', r.issues);
});

test('empty, invalid and contradicting model output is withheld', async () => {
  const cases = [
    [ok(''), 'EMPTY_ANSWER'],
    [async () => new Response(JSON.stringify({ candidates: [{ finishReason: 'SAFETY' }] }), { status: 200 }), 'EMPTY_ANSWER'],
    [ok('{"summary": "not closed'), 'INVALID_STRUCTURED_OUTPUT'],
    [ok({ summary: 'x [RUN]' }), 'INVALID_STRUCTURED_OUTPUT'],
    [ok({ ...good(), nextActions: 'call purchasing' }), 'INVALID_STRUCTURED_OUTPUT'],
    [ok({ ...good(), shortageAnalysis: 'The run is complete and no shortages exist [RUN].' }), 'shortageAnalysis:CONTRADICTS_SHORTAGES'],
    [ok({ ...good(), verifiedImpact: 'Cost falls by 6756.00 EUR [RUN].' }), 'verifiedImpact:COST_DIRECTION'],
    [ok({ ...good(), nextActions: ['We recommend that you approve the change [RUN].'] }), 'nextActions[0]:DECISION_RECOMMENDATION'],
    [ok({ ...good(), references: ['RUN', 'X9'] }), 'references:UNKNOWN_CITATION:X9'],
    [ok({ ...good(), workInstructionImplications: 'Update the instructions.' }), 'workInstructionImplications:NO_CITATIONS'],
  ];
  for (const [respond, issue] of cases) {
    const r = await genai.explain(caseOf(), runOf(), gem(respond));
    assert.equal(r.status, 'WITHHELD', issue);
    assert.equal(r.text, null);
    assert.equal(r.sections, null);
    assert(r.issues.split(';').includes(issue), `${issue}: ${r.issues}`);
  }
});

test('timeout, rate limit, HTTP errors and network failures map to typed errors without leaking the key', async () => {
  const slow = (url, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  await assert.rejects(genai.explain(caseOf(), runOf(), gem(slow, [], { timeoutMs: 20 })), e => e instanceof genai.GenAiTimeoutError && e.status === 504);
  await assert.rejects(genai.explain(caseOf(), runOf(), gem(async () => new Response('{}', { status: 429, headers: { 'retry-after': '30' } }))),
    e => e instanceof genai.GenAiTransportError && e.status === 429 && e.retryAfter === 30);
  await assert.rejects(genai.explain(caseOf(), runOf(), gem(async () => new Response(`{"error":"bad key ${KEY}"}`, { status: 400 }))),
    e => e.status === 400 && !e.message.includes(KEY));
  await assert.rejects(genai.explain(caseOf(), runOf(), gem(async () => { throw new TypeError(`fetch failed ${KEY}`); })),
    e => e instanceof genai.GenAiTransportError && e.status === 502 && !e.message.includes(KEY));
});

test('missing credentials or model: "Live AI explanations are not configured."', () => {
  for (const [env, environment] of [[cfg, {}], [cfg, { GEMINI_API_KEY: '' }], [{ ...cfg, model: null }, { GEMINI_API_KEY: KEY }], [{}, { GEMINI_API_KEY: KEY }]]) {
    assert.throws(() => genai.providerFor(env, environment), e => e instanceof genai.GenAiConfigError && e.message === 'Live AI explanations are not configured.');
  }
  assert.equal(typeof genai.providerFor(cfg, { GEMINI_API_KEY: KEY }), 'function');
  assert.equal(typeof genai.providerFor({ ...cfg, apiKeyEnv: 'OTHER_KEY' }, { OTHER_KEY: KEY }), 'function', 'variable name configurable');
});

test('only approved synthetic data is sent to the external model', async () => {
  const calls = [];
  for (const sourceType of ['MANUAL', 'S4_IMPORT', 'SANDBOX_IMPORT', 'GENAI_PROPOSAL']) {
    await assert.rejects(genai.explain(caseOf({ sourceType }), runOf(), gem(ok(good()), calls)), genai.GenAiDataNotApprovedError);
  }
  assert.equal(calls.length, 0, 'nothing was sent');
  assert.equal((await genai.explain(caseOf({ sourceType: 'DEMO_IMPORT' }), runOf(), gem(ok(good()), calls))).status, 'GROUNDED');
});

test('production profile: Gemini provider configured, key only from the environment', async () => {
  const { readFileSync } = await import('node:fs');
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const prod = pkg.cds.requires['[production]'].genai;
  assert.equal(prod.provider, 'gemini');
  assert.equal(prod.apiKeyEnv, 'GEMINI_API_KEY');
  assert.equal(JSON.stringify(pkg).match(/AIza[0-9A-Za-z_-]{20,}/), null, 'no Google API key committed');
  const mta = readFileSync(new URL('../mta.yaml', import.meta.url), 'utf8');
  assert.equal(/GEMINI_API_KEY\s*:/.test(mta), false, 'the key is never in the deployment descriptor');
});

// ------------------------------------------------------------------ through the OData service
let server, base;
const call = async (method, path, { user = 'cviewer', body } = {}) => {
  const response = await realFetch(base + path, { method,
    headers: { 'content-type': 'application/json', authorization: `Basic ${Buffer.from(`${user}:test`).toString('base64')}` },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, data: await response.json().catch(() => null) };
};
const realFetch = globalThis.fetch;
let geminiResponder = ok(good());
before(async () => {
  server = await cds.server({ port: 0, in_memory: true });
  if (!server.listening) await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}/odata/v4/engineering-review`;
  globalThis.fetch = async (url, init) => (String(url).startsWith('https://generativelanguage.googleapis.com/') ? geminiResponder(url, init) : realFetch(url, init));
});
after(async () => {
  globalThis.fetch = realFetch;
  if (server) await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  await cds.db?.disconnect();
});

test('OData explainImpact with Gemini: not configured, 429, 504, wrong plant, missing run, grounded', async () => {
  const original = cds.env.requires.genai, key = process.env.GEMINI_API_KEY;
  const id = idOf('EC-000485');
  const explainCall = (user = 'cviewer') => call('GET', `/ReviewCases(${id})/EngineeringReview.explainImpact()`, { user });
  try {
    cds.env.requires.genai = { ...cfg };
    delete process.env.GEMINI_API_KEY;
    // No persisted run yet: 409 before any provider call.
    assert.equal((await explainCall()).data.error.code, 'NO_IMPACT_RUN');
    assert.equal((await call('POST', `/ReviewCases(${id})/EngineeringReview.runImpact`, { user: 'analyst', body: { asOfDate: '2026-11-08' } })).status, 200);
    let r = await explainCall();
    assert.equal(r.status, 409);
    assert.equal(r.data.error.code, 'GENAI_NOT_CONFIGURED');
    assert.equal(r.data.error.message, 'Live AI explanations are not configured.');
    process.env.GEMINI_API_KEY = KEY;
    geminiResponder = async () => new Response('{}', { status: 429, headers: { 'retry-after': '12' } });
    r = await explainCall();
    assert.equal(r.status, 429);
    assert.equal(r.data.error.code, 'GENAI_RATE_LIMITED');
    assert.match(r.data.error.message, /Retry after 12 s/);
    cds.env.requires.genai = { ...cfg, timeoutMs: 20 };
    geminiResponder = (url, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    r = await explainCall();
    assert.equal(r.status, 504);
    assert.equal(r.data.error.code, 'GENAI_TIMEOUT');
    cds.env.requires.genai = { ...cfg };
    assert.equal((await explainCall('analyst2')).status, 404, 'wrong plant: indistinguishable from a missing case');
    let sent = null;
    geminiResponder = async (url, init) => { sent = init.body; return ok({ ...good(), warnings: ['Fictional synthetic demo data [RUN].'] })(); };
    r = await explainCall();
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.generatedBy, 'GOOGLE_GEMINI_API');
    assert.ok(r.data.status === 'GROUNDED' || r.data.status === 'WITHHELD');
    assert.match(sent, /EC-000485/);
    assert.equal(JSON.stringify(r.data).includes(KEY), false);
  } finally {
    cds.env.requires.genai = original;
    if (key === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = key;
  }
});
