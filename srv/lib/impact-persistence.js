// Loads calculation inputs for one review case and persists an immutable run snapshot.
// Both functions run inside the caller's transaction (cds.context.tx).
import cds from '@sap/cds';
import { createHash } from 'node:crypto';
import { Exact } from './exact.js';

const E = () => cds.entities('assemblyimpact');
const text = v => (v === null || v === undefined ? null : String(v));
const dec = v => (v === null || v === undefined ? null : Exact.of(v).toPlain());
const day = v => (v ? String(v).slice(0, 10) : v);

export class ConcurrentRunError extends Error {}

/** M04 Slice 2a (Decision B): impact runs are allowed only before a decision. */
export const IMPACT_ALLOWED_STATUSES = Object.freeze(['OPEN', 'IN_REVIEW']);

/** The case reached APPROVED/REJECTED: its evidence is frozen and no run may be added. */
export class CaseDecidedError extends Error {
  constructor(status) { super(`Impact cannot be recalculated for a review case in status ${status}.`); this.caseStatus = status; }
}

/** Reads the case (only if in one of `plants`) and every input row the calculator may use. */
export async function loadImpactInput(caseID, plants, asOfDate) {
  const { ReviewCases, Assemblies, BOMStates, BOMItems, CostPrices, StockSnapshots, Instructions, InstructionReferences } = E();
  const rc = await SELECT.one.from(ReviewCases).where({ ID: caseID, plant: { in: plants } });
  if (!rc) return null;

  const states = await SELECT.from(BOMStates).where(
    { ID: { in: [rc.fromState_ID, rc.toState_ID] } }).or({ assembly_ID: rc.assembly_ID, plant: rc.plant });
  const assemblyIds = [...new Set([rc.assembly_ID, ...states.map(s => s.assembly_ID)])];
  const assemblies = new Map((await SELECT.from(Assemblies).columns('ID', 'assemblyCode').where({ ID: { in: assemblyIds } }))
    .map(a => [a.ID, a.assemblyCode]));
  const keyOf = new Map(states.map(s => [s.ID, s.stateKey]));
  const items = await SELECT.from(BOMItems).where({ bomState_ID: { in: [rc.fromState_ID, rc.toState_ID] } });
  const materials = [...new Set(items.map(i => i.material))];
  const prices = materials.length ? await SELECT.from(CostPrices).where({ plant: rc.plant, material: { in: materials } }) : [];
  const stock = materials.length ? await SELECT.from(StockSnapshots).where({ plant: rc.plant, material: { in: materials } }) : [];
  const instructions = await SELECT.from(Instructions).where({ assembly_ID: rc.assembly_ID, plant: rc.plant });
  const refs = instructions.length
    ? await SELECT.from(InstructionReferences).where({ instruction_ID: { in: instructions.map(i => i.ID) } }) : [];
  const instructionById = new Map(instructions.map(i => [i.ID, i]));

  const input = {
    asOfDate,
    reviewCase: { caseNumber: rc.caseNumber, assemblyCode: assemblies.get(rc.assembly_ID), plant: rc.plant,
      fromStateKey: keyOf.get(rc.fromState_ID) ?? null, toStateKey: keyOf.get(rc.toState_ID) ?? null,
      productionQuantity: text(rc.productionQuantity) },
    bomStates: states.map(s => ({ stateKey: s.stateKey, assemblyCode: assemblies.get(s.assembly_ID), plant: s.plant,
      bomUsage: s.bomUsage, alternative: s.alternative, revision: s.revision, validFrom: day(s.validFrom),
      validTo: day(s.validTo), evidenceRef: s.evidenceRef })),
    bomItems: items.map(i => ({ stateKey: keyOf.get(i.bomState_ID), itemNo: i.itemNo, material: i.material,
      quantity: dec(i.quantity), unit: i.unit, evidenceRef: i.evidenceRef })),
    costPrices: prices.map(p => ({ material: p.material, plant: p.plant, price: dec(p.price), currency: p.currency,
      priceUnit: text(p.priceUnit), unit: p.unit, validFrom: day(p.validFrom), validTo: day(p.validTo), evidenceRef: p.evidenceRef })),
    stockSnapshots: stock.map(s => ({ material: s.material, plant: s.plant, availableQuantity: dec(s.availableQuantity),
      unit: s.unit, snapshotAt: new Date(s.snapshotAt).toISOString(), evidenceRef: s.evidenceRef })),
    instructions: instructions.map(i => ({ instructionId: i.instructionId, version: text(i.version),
      assemblyCode: assemblies.get(i.assembly_ID), plant: i.plant, appliesToRevision: i.appliesToRevision || null,
      status: i.status, validFrom: day(i.validFrom), evidenceRef: i.evidenceRef })),
    instructionReferences: refs.map(r => ({ instructionId: instructionById.get(r.instruction_ID).instructionId,
      version: text(instructionById.get(r.instruction_ID).version), step: r.step, material: r.material })),
  };
  return { reviewCase: rc, input };
}

/** SHA-256 over a canonical (sorted, normalised) serialisation of every calculation input. */
export function fingerprint(ruleset, input) {
  const canon = value => Array.isArray(value)
    ? value.map(canon).map(v => JSON.stringify(v)).sort()
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canon(value[k])]))
      : value;
  return `sha256:${createHash('sha256').update(JSON.stringify({ ruleset, input: canon(input) })).digest('hex')}`;
}

/**
 * Inserts the run with all snapshot lines and moves ReviewCases.latestRun with a
 * compare-and-set on ReviewCases.version. A stale version means another run
 * committed after this one read the case: throws ConcurrentRunError so the
 * surrounding transaction rolls back every row written here. The same statement also
 * requires an undecided status, so a decision committed during the calculation makes the
 * run fail with CaseDecidedError (rolled back as well) instead of replacing evidence.
 */
export async function persistImpactRun(reviewCase, result, { fingerprint: inputFingerprint, user, now }) {
  const { ReviewCases, ImpactRuns, ImpactComparisonLines, ImpactMaterialLines, Findings } = E();
  const runID = cds.utils.uuid();
  const c = result.cost, s = result.summary;
  await INSERT.into(ImpactRuns).entries({
    ID: runID, reviewCase_ID: reviewCase.ID, ruleset: result.ruleset, asOfDate: result.asOfDate, inputFingerprint,
    status: result.status, flags: result.flags.join(',') || null, currency: c.currency,
    productionQuantity: c.productionQuantity, fromRevision: result.from.revision, toRevision: result.to.revision,
    fromCostPerAssembly: c.fromPerAssembly, toCostPerAssembly: c.toPerAssembly, deltaPerAssembly: c.deltaPerAssembly,
    fromCostTotal: c.fromTotal, toCostTotal: c.toTotal, costDeltaTotal: c.deltaTotal, costDeltaPercent: c.deltaPercent,
    instructionFindings: s.instructionFindings, instructionsToUpdate: s.instructionsToUpdate,
    materialsShort: s.materialsShort, materialsUnknown: s.materialsUnknown, computedAt: now, computedBy: user,
  });
  if (result.comparison.length) await INSERT.into(ImpactComparisonLines).entries(result.comparison.map(l => ({ run_ID: runID, ...l })));
  if (result.materialLines.length) {
    await INSERT.into(ImpactMaterialLines).entries(result.materialLines.map(l => ({
      run_ID: runID, material: l.material, unit: l.unit, required: l.required, available: l.available, gap: l.gap,
      status: l.status, stale: l.stale, snapshotAt: l.snapshotAt ?? null, unitPrice: l.unitPrice,
      priceEvidenceRef: l.priceEvidenceRef, stockEvidenceRef: l.evidenceRef ?? null })));
  }
  if (result.findings.length) {
    await INSERT.into(Findings).entries(result.findings.map(f => ({ run_ID: runID, type: f.type, severity: f.severity,
      material: f.material, details: f.details.slice(0, 500), evidenceRefs: f.evidenceRefs.join(' ').slice(0, 1000) })));
  }
  const affected = await UPDATE(ReviewCases).set({ latestRun_ID: runID, version: cds.utils.uuid() })
    .where({ ID: reviewCase.ID, version: reviewCase.version ?? null, status: { in: IMPACT_ALLOWED_STATUSES } });
  if (affected !== 1) {
    const current = await SELECT.one.from(ReviewCases).columns('status').where({ ID: reviewCase.ID });
    if (current && !IMPACT_ALLOWED_STATUSES.includes(current.status)) throw new CaseDecidedError(current.status);
    throw new ConcurrentRunError(`review case ${reviewCase.ID} changed during the run`);
  }
  return runID;
}
