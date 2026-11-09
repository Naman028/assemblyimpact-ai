// P2: evidence-grounded GenAI explanation of one persisted impact run.
// The language model never calculates. It receives only the immutable run (figures, findings, shortages,
// BOM changes) as numbered facts and must cite them. Its answer is checked before it is returned:
// every citation must exist and every number must appear in the evidence; otherwise the text is withheld.
// Providers: SAP Generative AI Hub (SAP AI Core, via a BTP destination) or a labelled fixture for tests.
// An unconfigured provider is refused (409), never replaced by a silent stand-in.
import cds from '@sap/cds';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export class GenAiConfigError extends Error {}
export class GenAiTransportError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

const MAX_FACTS = 40;
const num = v => (v === null || v === undefined ? null : Number(v));

/** Numbered facts from a run (with comparisonLines, materialLines, findings) and its case. Deterministic order. */
export function evidenceOf(reviewCase, run) {
  const facts = [];
  const sev = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  [...run.findings].sort((a, b) => (sev[a.severity] ?? 3) - (sev[b.severity] ?? 3) || a.type.localeCompare(b.type) || String(a.material).localeCompare(String(b.material)))
    .forEach((f, i) => facts.push({ id: `F${i + 1}`, kind: 'finding', severity: f.severity, type: f.type, material: f.material ?? null, details: f.details, evidenceRefs: f.evidenceRefs }));
  run.materialLines.filter(m => m.status !== 'SUFFICIENT' || m.stale).sort((a, b) => a.material.localeCompare(b.material))
    .forEach((m, i) => facts.push({ id: `M${i + 1}`, kind: 'material', material: m.material, unit: m.unit, required: num(m.required), available: num(m.available), gap: num(m.gap), status: m.status, stale: m.stale }));
  run.comparisonLines.filter(c => c.change !== 'UNCHANGED').sort((a, b) => a.itemNo.localeCompare(b.itemNo))
    .forEach((c, i) => facts.push({ id: `B${i + 1}`, kind: 'bom-change', itemNo: c.itemNo, change: c.change, fromMaterial: c.fromMaterial ?? null, fromQuantity: num(c.fromQuantity), toMaterial: c.toMaterial ?? null, toQuantity: num(c.toQuantity), unit: c.unit }));
  return {
    case: { caseNumber: reviewCase.caseNumber, title: reviewCase.title, assemblyCode: reviewCase.assemblyCode, plant: reviewCase.plant, sourceType: reviewCase.sourceType, status: reviewCase.status },
    run: { id: 'RUN', runID: run.ID, status: run.status, flags: run.flags ?? null, asOfDate: run.asOfDate, currency: run.currency,
      productionQuantity: run.productionQuantity, fromRevision: run.fromRevision, toRevision: run.toRevision,
      fromCostPerAssembly: num(run.fromCostPerAssembly), toCostPerAssembly: num(run.toCostPerAssembly), deltaPerAssembly: num(run.deltaPerAssembly),
      costDeltaTotal: num(run.costDeltaTotal), costDeltaPercent: num(run.costDeltaPercent), materialsShort: run.materialsShort,
      materialsUnknown: run.materialsUnknown, instructionFindings: run.instructionFindings, instructionsToUpdate: run.instructionsToUpdate },
    facts: facts.slice(0, MAX_FACTS),
    truncated: facts.length > MAX_FACTS,
  };
}

export const SYSTEM_PROMPT = [
  'You explain an engineering change impact to a manufacturing engineer reviewing the change.',
  'Use ONLY the JSON evidence provided. Do not calculate, estimate, round or invent any figure, material, date or reference.',
  'After every statement, cite the fact it comes from in square brackets: [RUN] for run figures, or a fact id such as [F1], [M2], [B3].',
  'Copy numbers exactly as they appear in the evidence, with the currency where relevant.',
  'Cover: overall run status (and missing inputs if INCOMPLETE, warnings if COMPLETE_WITH_WARNINGS), cost delta, material shortages, BOM changes and work instructions to update.',
  'State the data source from case.sourceType (SYNTHETIC_FIXTURE or DEMO_IMPORT: fictional demo data; SANDBOX_IMPORT: SAP API sandbox data; S4_IMPORT: SAP S/4HANA extract).',
  'Do not recommend approving or rejecting; the reviewer decides. At most 180 words, plain text, no markdown tables.',
].join('\n');

export function messagesFor(evidence) {
  return [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: `Evidence:\n${JSON.stringify(evidence)}` }];
}

// Numbers are compared as decimal values ("1200.00" == "1200", "-5" == "5" for sign wording such as "a decrease of 5").
const NUMBER = /\d+(?:[.,]\d+)*(?:\.\d+)?/g;
const norm = token => { const n = Number(token.replace(/,(?=\d{3}\b)/g, '').replace(',', '.')); return Number.isFinite(n) ? String(Math.abs(n)) : token; };
const numbersIn = text => new Set((String(text).replace(/\[[A-Z]+\d*\]/g, ' ').match(NUMBER) ?? []).map(norm));

/** Checks a model answer against the evidence. Returns { ok, issues, citations }. */
export function validateExplanation(text, evidence) {
  const issues = [];
  if (typeof text !== 'string' || !text.trim()) return { ok: false, issues: ['EMPTY_ANSWER'], citations: [] };
  const ids = new Set(['RUN', ...evidence.facts.map(f => f.id)]);
  const citations = [...new Set([...text.matchAll(/\[([A-Z]+\d*)\]/g)].map(m => m[1]))];
  if (!citations.length) issues.push('NO_CITATIONS');
  for (const c of citations) if (!ids.has(c)) issues.push(`UNKNOWN_CITATION:${c}`);
  const allowed = numbersIn(JSON.stringify(evidence));
  for (const n of numbersIn(text)) if (!allowed.has(n)) issues.push(`UNGROUNDED_NUMBER:${n}`);
  if (/\b(should|must|recommend(?:ed|s)?|advise)\b[^.]{0,60}\b(approv|reject)/i.test(text)) issues.push('DECISION_RECOMMENDATION');
  if (text.length > 2000) issues.push('TOO_LONG');
  return { ok: issues.length === 0, issues, citations };
}

/** SAP Generative AI Hub (SAP AI Core) chat completion through a CAP remote service bound to a BTP destination. */
export function genAiHubProvider(env) {
  if (!env.deploymentId || !env.resourceGroup) throw new GenAiConfigError('SAP Generative AI Hub is not configured (deployment ID and resource group).');
  return async messages => {
    const srv = await cds.connect.to(env.service ?? 'genai-hub');
    let response;
    try {
      response = await srv.send({ method: 'POST',
        path: `/v2/inference/deployments/${encodeURIComponent(env.deploymentId)}/chat/completions?api-version=${encodeURIComponent(env.apiVersion ?? '2024-02-01')}`,
        headers: { 'AI-Resource-Group': env.resourceGroup }, data: { messages, temperature: 0, max_tokens: 500 } });
    } catch (error) {
      throw new GenAiTransportError(`SAP Generative AI Hub answered ${error.statusCode ?? error.status ?? 'with an error'}.`, error.statusCode ?? error.status);
    }
    return { text: response?.choices?.[0]?.message?.content ?? '', model: response?.model ?? env.model ?? 'unknown', generatedBy: 'SAP_GENAI_HUB' };
  };
}

/** Canned model answers keyed by case number. Tests and offline demos only; always labelled as such. */
export function fixtureProvider(file) {
  return async (messages, evidence) => {
    const answers = JSON.parse(readFileSync(file, 'utf8'));
    const answer = answers[evidence.case.caseNumber];
    if (!answer) throw new GenAiTransportError(`No fixture answer for ${evidence.case.caseNumber}.`, 404);
    return { text: answer, model: 'fixture', generatedBy: 'FIXTURE_LLM_RESPONSE' };
  };
}

/** Provider for the configured mode; refuses an unconfigured one. */
export function providerFor(env = cds.env.requires?.genai ?? {}) {
  if (env.provider === 'genai-hub') return genAiHubProvider(env);
  if (env.provider === 'fixture') {
    if (!env.fixture) throw new GenAiConfigError('The GenAI fixture provider needs genai.fixture.');
    return fixtureProvider(join(cds.root, env.fixture));
  }
  throw new GenAiConfigError('No GenAI provider is configured (cds.requires.genai.provider).');
}

/** Builds the evidence, calls the provider and validates the answer. Ungrounded text is never returned. */
export async function explain(reviewCase, run, provider) {
  const evidence = evidenceOf(reviewCase, run);
  const messages = messagesFor(evidence);
  const promptSha256 = createHash('sha256').update(JSON.stringify(messages)).digest('hex');
  const answer = await provider(messages, evidence);
  const check = validateExplanation(answer.text, evidence);
  return {
    runID: run.ID, caseNumber: reviewCase.caseNumber, status: check.ok ? 'GROUNDED' : 'WITHHELD',
    text: check.ok ? answer.text.trim() : null, issues: check.issues.join(';') || null, citations: check.citations.join(',') || null,
    generatedBy: answer.generatedBy, model: answer.model, promptSha256, factCount: evidence.facts.length, generatedAt: new Date().toISOString(),
  };
}
