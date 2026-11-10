// Data access for the planning view (consumption coverage) and the case-creation helpers.
// The rules themselves live in lib/coverage.js (pure, unit-tested); this module only loads plant-filtered rows.
import cds from '@sap/cds';
import { Exact } from './exact.js';
import { projectCoverage, validateRate, CoverageRejection } from './coverage.js';

const E = () => cds.entities('assemblyimpact');

/** Coverage of every material of the proposed BOM (revision B) of one case. null = case missing/foreign. */
export async function caseCoverage(caseID, plants, { startDate, horizonDays }) {
  const { ReviewCases, BOMStates, BOMItems, StockSnapshots, MaterialConsumptionRates } = E();
  const rc = await SELECT.one.from(ReviewCases).columns('ID', 'plant', 'productionQuantity', 'toState_ID').where({ ID: caseID, plant: { in: plants } });
  if (!rc) return null;
  const to = await SELECT.one.from(BOMStates).columns('validFrom').where({ ID: rc.toState_ID });
  const items = await SELECT.from(BOMItems).columns('material', 'quantity', 'unit').where({ bomState_ID: rc.toState_ID }).orderBy('itemNo');
  // R5: requirement per material = production quantity x sum of its proposed BOM quantities.
  const byMaterial = new Map();
  for (const i of items) {
    const prev = byMaterial.get(i.material);
    if (prev && prev.unit !== i.unit) { prev.unitConflict = true; continue; }
    const req = Exact.of(String(i.quantity)).mul(rc.productionQuantity);
    byMaterial.set(i.material, prev ? { ...prev, requirement: prev.requirement.add(req) } : { unit: i.unit, requirement: req });
  }
  const materials = [...byMaterial].map(([material, m]) => ({ material, unit: m.unitConflict ? '?' : m.unit, caseRequirement: m.requirement.toPlain() }));
  if (!materials.length) return [];
  const names = materials.map(m => m.material);
  const [stock, rates] = await Promise.all([
    SELECT.from(StockSnapshots).columns('material', 'unit', 'availableQuantity', 'snapshotAt').where({ plant: rc.plant, material: { in: names } }),
    SELECT.from(MaterialConsumptionRates).columns('material', 'unit', 'period', 'quantity', 'validFrom', 'validTo', 'active').where({ plant: rc.plant, material: { in: names }, active: true })
  ]);
  return projectCoverage({ startDate, days: horizonDays, effectiveDate: to?.validFrom ?? null, materials, stock, rates });
}

/** Validates a new rate before CREATE. Throws CoverageRejection. */
export async function checkRate(data, plants) {
  const { MaterialConsumptionRates } = E();
  const rate = { ...data };
  if (!plants.includes(rate.plant)) throw new CoverageRejection('PLANT_NOT_ALLOWED', `You are not authorised for plant ${rate.plant}.`);
  if (!rate.material || !rate.unit) throw new CoverageRejection('MISSING_FIELD', 'material and unit are required.');
  for (const f of ['active', 'deactivatedAt', 'deactivatedBy', 'deactivationReason']) delete data[f];
  const others = await SELECT.from(MaterialConsumptionRates).columns('ID', 'validFrom', 'validTo', 'active').where({ material: rate.material, plant: rate.plant, active: true });
  validateRate(rate, others);
}

/** Withdraws a rate (audited, never deleted). null = missing or foreign plant. */
export async function deactivateRate(ID, reason, plants, user) {
  const { MaterialConsumptionRates } = E();
  const text = String(reason ?? '').trim();
  if (text.length < 3) throw new CoverageRejection('REASON_REQUIRED', 'Give a reason (at least 3 characters) for withdrawing the rate.');
  const rate = await SELECT.one.from(MaterialConsumptionRates).columns('ID', 'plant', 'active').where({ ID, plant: { in: plants } });
  if (!rate) return null;
  if (!rate.active) throw new CoverageRejection('ALREADY_INACTIVE', 'This rate has already been withdrawn.');
  const n = await UPDATE(MaterialConsumptionRates).set({ active: false, deactivatedAt: new Date().toISOString(), deactivatedBy: user, deactivationReason: text.slice(0, 200) })
    .where({ ID, active: true });
  if (n !== 1) throw new CoverageRejection('ALREADY_INACTIVE', 'This rate has already been withdrawn.');
  return SELECT.one.from(MaterialConsumptionRates, ID);
}

/** Existing assemblies in the caller's plants whose code or description contains the term (max 20). */
export async function searchAssemblies(term, plants) {
  const { Assemblies, BOMStates, ReviewCases } = E();
  const t = String(term ?? '').trim().toUpperCase();
  if (t && !/^[A-Z0-9 \-_.]{1,40}$/.test(t)) throw new CoverageRejection('INVALID_TERM', 'The search term may contain letters, digits, spaces and - _ . only.');
  const all = await SELECT.from(Assemblies).columns('ID', 'assemblyCode', 'plant', 'description').where({ plant: { in: plants } }).orderBy('assemblyCode');
  const hits = all.filter(a => !t || a.assemblyCode.toUpperCase().includes(t) || (a.description ?? '').toUpperCase().includes(t)).slice(0, 20);
  if (!hits.length) return [];
  const ids = hits.map(a => a.ID);
  const [states, cases] = await Promise.all([
    SELECT.from(BOMStates).columns('assembly_ID', 'revision').where({ assembly_ID: { in: ids } }),
    SELECT.from(ReviewCases).columns('assembly_ID').where({ assembly_ID: { in: ids } })
  ]);
  return hits.map(a => ({ assemblyCode: a.assemblyCode, plant: a.plant, description: a.description,
    revisions: [...new Set(states.filter(s => s.assembly_ID === a.ID).map(s => s.revision))].sort().join(', '),
    cases: cases.filter(c => c.assembly_ID === a.ID).length }));
}

/**
 * Proposes the next case number EC-nnnnnn: one above the highest number in the caller's plants, skipping numbers
 * used anywhere (case numbers are unique across plants). A proposal only: the database unique constraint on
 * ReviewCases.caseNumber decides at import time (409 IMPORT_CONFLICT for a concurrent import).
 */
export async function nextCaseNumber(plants = []) {
  const { ReviewCases } = E();
  const num = c => Number(/^EC-(\d{6})$/.exec(c)?.[1] ?? NaN);
  const all = await SELECT.from(ReviewCases).columns('caseNumber', 'plant');
  const used = new Set(all.map(r => num(r.caseNumber)).filter(Number.isFinite));
  let n = all.filter(r => plants.includes(r.plant)).map(r => num(r.caseNumber)).filter(Number.isFinite).reduce((a, b) => Math.max(a, b), 0) + 1;
  while (used.has(n) && n <= 999999) n++;
  if (n > 999999) throw new CoverageRejection('NUMBER_RANGE_EXHAUSTED', 'No case number is left in the EC-nnnnnn range.');
  return `EC-${String(n).padStart(6, '0')}`;
}

export { CoverageRejection };
