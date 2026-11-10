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
    SELECT.from(MaterialConsumptionRates).columns('material', 'unit', 'period', 'quantity', 'validFrom', 'validTo').where({ plant: rc.plant, material: { in: names } })
  ]);
  return projectCoverage({ startDate, days: horizonDays, effectiveDate: to?.validFrom ?? null, materials, stock, rates });
}

/** Validates a rate before CREATE/UPDATE (merges stored values for partial updates). Throws CoverageRejection. */
export async function checkRate(data, plants, ID) {
  const { MaterialConsumptionRates } = E();
  const stored = ID ? await SELECT.one.from(MaterialConsumptionRates).where({ ID }) : null;
  const rate = { ...(stored ?? {}), ...data, ID: ID ?? data.ID };
  if (!plants.includes(rate.plant)) throw new CoverageRejection('PLANT_NOT_ALLOWED', `You are not authorised for plant ${rate.plant}.`);
  if (!rate.material || !rate.unit) throw new CoverageRejection('MISSING_FIELD', 'material and unit are required.');
  const others = await SELECT.from(MaterialConsumptionRates).columns('ID', 'validFrom', 'validTo').where({ material: rate.material, plant: rate.plant });
  validateRate(rate, others);
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

/** Next unused case number EC-nnnnnn (global, because case numbers are unique across plants). */
export async function nextCaseNumber() {
  const { ReviewCases } = E();
  const rows = await SELECT.from(ReviewCases).columns('caseNumber');
  const max = rows.map(r => /^EC-(\d{6})$/.exec(r.caseNumber)?.[1]).filter(Boolean).map(Number).reduce((a, b) => Math.max(a, b), 0);
  if (max >= 999999) throw new CoverageRejection('NUMBER_RANGE_EXHAUSTED', 'No case number is left in the EC-nnnnnn range.');
  return `EC-${String(max + 1).padStart(6, '0')}`;
}

export { CoverageRejection };
