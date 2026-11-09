// Deterministic engineering-change impact calculation, ruleset 1.1.0.
// Pure function: no I/O, no clock, no CAP dependency. Rule IDs refer to
// docs/m04/M04_Data_Contract.md section 3. Inputs are plain rows whose numeric
// fields are decimal strings or numbers; dates are ISO strings.
import { Exact } from './exact.js';

export const RULESET = '1.1.0';
export const RUN_CURRENCY = 'EUR';
export const STALE_AFTER_DAYS = 7;

export class ImpactRejection extends Error {
  constructor(code, detail) { super(`${code}: ${detail}`); this.code = code; this.detail = detail; }
}

const DAY_MS = 86_400_000;
const isoDay = value => String(value).slice(0, 10);
const plain = value => (value === null || value === undefined ? null : Exact.of(value).toPlain());
const money = value => (value === null ? null : value.toFixed(2));
// Unit prices may be non-terminating after price-unit division; persist at the DB scale (9).
const decimalText = value => { try { return value.toPlain(); } catch { return value.toFixed(9); } };
const byItemNo = (a, b) => (a.itemNo < b.itemNo ? -1 : a.itemNo > b.itemNo ? 1 : 0);

const CHANGE_FINDING = {
  REPLACED: ['COMPONENT_REPLACED', 'MEDIUM'],
  REMOVED: ['COMPONENT_REMOVED', 'MEDIUM'],
  ADDED: ['COMPONENT_ADDED', 'LOW'],
  QUANTITY_CHANGED: ['QUANTITY_CHANGED', 'LOW'],
  NON_COMPARABLE: ['NON_COMPARABLE_UNIT', 'HIGH'],
};

function validate({ reviewCase, bomStates, bomItems }) {
  const qty = reviewCase.productionQuantity;
  let exactQty;
  try { exactQty = Exact.of(qty); } catch { throw new ImpactRejection('INVALID_PRODUCTION_QUANTITY', String(qty)); }
  if (!exactQty.isInteger() || exactQty.cmp(1) < 0) throw new ImpactRejection('INVALID_PRODUCTION_QUANTITY', String(qty));

  const from = bomStates.find(s => s.stateKey === reviewCase.fromStateKey);
  const to = bomStates.find(s => s.stateKey === reviewCase.toStateKey);
  if (!from || !to) throw new ImpactRejection('MISSING_BOM_STATE', `${reviewCase.fromStateKey}/${reviewCase.toStateKey}`);
  for (const key of ['assemblyCode', 'plant', 'bomUsage', 'alternative']) {
    if (from[key] !== to[key]) throw new ImpactRejection('NON_COMPARABLE_BOM_STATES', `${key}: ${from[key]} vs ${to[key]}`);
  }
  if (from.plant !== reviewCase.plant || from.assemblyCode !== reviewCase.assemblyCode) {
    throw new ImpactRejection('CASE_BOM_MISMATCH', 'case assembly/plant differs from BOM state');
  }
  for (const state of [from, to]) {
    const overlap = bomStates.find(other => other !== state &&
      ['assemblyCode', 'plant', 'bomUsage', 'alternative', 'revision'].every(k => other[k] === state[k]) &&
      isoDay(other.validFrom) <= isoDay(state.validTo) && isoDay(state.validFrom) <= isoDay(other.validTo));
    if (overlap) throw new ImpactRejection('AMBIGUOUS_BOM_STATE', `${state.stateKey} overlaps ${overlap.stateKey}`);
  }
  const itemsOf = state => {
    const rows = bomItems.filter(i => i.stateKey === state.stateKey);
    const seen = new Set();
    for (const row of rows) {
      if (Exact.of(row.quantity).cmp(0) <= 0) throw new ImpactRejection('INVALID_BOM_QUANTITY', `${state.stateKey}/${row.itemNo}=${row.quantity}`);
      if (seen.has(row.itemNo)) throw new ImpactRejection('DUPLICATE_ITEM_NUMBER', `${state.stateKey}/${row.itemNo}`);
      seen.add(row.itemNo);
    }
    return new Map(rows.map(r => [r.itemNo, r]));
  };
  return { qty: exactQty, from, to, aItems: itemsOf(from), bItems: itemsOf(to) };
}

function compareBoms(aItems, bItems, flags, findings) {
  const positions = [...new Set([...aItems.keys(), ...bItems.keys()])].sort();
  return positions.map(itemNo => {
    const a = aItems.get(itemNo), b = bItems.get(itemNo);
    const line = {
      itemNo,
      fromMaterial: a?.material ?? null, fromQuantity: a ? plain(a.quantity) : null,
      toMaterial: b?.material ?? null, toQuantity: b ? plain(b.quantity) : null,
      unit: (b ?? a).unit,
    };
    if (a && b && a.unit !== b.unit) { line.change = 'NON_COMPARABLE'; line.unit = null; flags.add('NON_COMPARABLE_UNIT'); }
    else if (!b) line.change = 'REMOVED';
    else if (!a) line.change = 'ADDED';
    else if (a.material !== b.material) line.change = 'REPLACED';
    else line.change = Exact.of(a.quantity).cmp(b.quantity) === 0 ? 'UNCHANGED' : 'QUANTITY_CHANGED';
    const mapping = CHANGE_FINDING[line.change];
    if (mapping) {
      findings.push({ type: mapping[0], severity: mapping[1], material: line.toMaterial ?? line.fromMaterial,
        details: `Item ${itemNo}: ${line.fromMaterial ?? '-'} x${line.fromQuantity ?? '-'} -> ${line.toMaterial ?? '-'} x${line.toQuantity ?? '-'}`,
        evidenceRefs: [a, b].filter(Boolean).map(r => r.evidenceRef) });
    }
    return line;
  });
}

function costOf(items, prices, plant, asOfDate) {
  let total = new Exact(0n);
  const issues = [], lines = [];
  for (const row of [...items.values()].sort(byItemNo)) {
    const candidates = prices.filter(p => p.material === row.material && p.plant === plant &&
      isoDay(p.validFrom) <= asOfDate && asOfDate <= isoDay(p.validTo));
    let issue = null;
    if (!candidates.length) issue = 'MISSING_PRICE';
    else if (candidates.length > 1) issue = 'AMBIGUOUS_PRICE';
    else if (candidates[0].currency !== RUN_CURRENCY) issue = 'NON_COMPARABLE_CURRENCY';
    else if (candidates[0].unit !== row.unit) issue = 'NON_COMPARABLE_PRICE_UNIT';
    else if (Exact.of(candidates[0].priceUnit).cmp(0) <= 0 || Exact.of(candidates[0].price).cmp(0) < 0) issue = 'INVALID_PRICE';
    if (issue) {
      issues.push({ material: row.material, issue });
      lines.push({ itemNo: row.itemNo, material: row.material, unitPrice: null, lineCost: null });
      continue;
    }
    const unitPrice = Exact.of(candidates[0].price).div(candidates[0].priceUnit);
    const lineCost = Exact.of(row.quantity).mul(unitPrice);
    total = total.add(lineCost);
    lines.push({ itemNo: row.itemNo, material: row.material, unitPrice: decimalText(unitPrice), lineCost: decimalText(lineCost),
      priceEvidenceRef: candidates[0].evidenceRef });
  }
  return { total: issues.length ? null : total, issues, lines };
}

function assessStock(bItems, qty, snapshots, plant, asOfDate, findings, flags) {
  const required = new Map();
  for (const row of bItems.values()) {
    const key = `${row.material}\u0000${row.unit}`;
    required.set(key, (required.get(key) ?? new Exact(0n)).add(Exact.of(row.quantity).mul(qty)));
  }
  const endOfDay = `${asOfDate}T23:59:59.999Z`;
  return [...required.keys()].sort().map(key => {
    const [material, unit] = key.split('\u0000');
    const need = required.get(key);
    const candidates = snapshots.filter(s => s.material === material && s.plant === plant &&
      new Date(s.snapshotAt).toISOString() <= endOfDay);
    const line = { material, unit, required: need.toPlain() };
    if (!candidates.length) {
      flags.add('STOCK_UNKNOWN');
      return { ...line, available: null, gap: null, status: 'UNKNOWN', stale: false };
    }
    const latest = candidates.reduce((x, y) => (new Date(y.snapshotAt) > new Date(x.snapshotAt) ? y : x));
    if (latest.unit !== unit) {
      flags.add('STOCK_NON_COMPARABLE');
      return { ...line, available: null, gap: null, status: 'NON_COMPARABLE', stale: false };
    }
    const available = Exact.of(latest.availableQuantity);
    const shortfall = need.sub(available);
    const gap = shortfall.cmp(0) > 0 ? shortfall : new Exact(0n);
    const ageDays = (Date.parse(`${asOfDate}T00:00:00Z`) - Date.parse(`${isoDay(new Date(latest.snapshotAt).toISOString())}T00:00:00Z`)) / DAY_MS;
    const stale = ageDays > STALE_AFTER_DAYS;
    if (stale) flags.add('STOCK_STALE');
    const result = { ...line, available: available.toPlain(), gap: gap.toPlain(), status: gap.isZero() ? 'SUFFICIENT' : 'SHORT',
      stale, snapshotAt: new Date(latest.snapshotAt).toISOString(), evidenceRef: latest.evidenceRef };
    if (!gap.isZero()) {
      findings.push({ type: 'STOCK_GAP', severity: 'HIGH', material,
        details: `Required ${result.required} ${unit}, available ${result.available}, gap ${result.gap}`,
        evidenceRefs: [latest.evidenceRef] });
    }
    return result;
  });
}

function checkInstructions({ reviewCase, instructions, instructionReferences }, to, bItems, findings) {
  const targetMaterials = new Set([...bItems.values()].map(r => r.material));
  const applicable = instructions.filter(i => i.assemblyCode === reviewCase.assemblyCode && i.plant === reviewCase.plant &&
    i.status === 'RELEASED' && (!i.appliesToRevision || i.appliesToRevision === to.revision) &&
    isoDay(i.validFrom) <= isoDay(to.validFrom));
  const latest = new Map();
  for (const i of applicable) {
    if (!latest.has(i.instructionId) || Number(i.version) > Number(latest.get(i.instructionId).version)) latest.set(i.instructionId, i);
  }
  return [...latest.keys()].sort().map(id => {
    const instruction = latest.get(id);
    const refs = instructionReferences.filter(r => r.instructionId === id && Number(r.version) === Number(instruction.version));
    const outdated = refs.filter(r => !targetMaterials.has(r.material)).sort((x, y) => (x.step < y.step ? -1 : 1));
    for (const ref of outdated) {
      findings.push({ type: 'OUTDATED_INSTRUCTION_REFERENCE', severity: 'HIGH', material: ref.material,
        details: `${id} v${instruction.version} step ${ref.step} references ${ref.material}, which is not in revision ${to.revision}`,
        evidenceRefs: [instruction.evidenceRef] });
    }
    return { instructionId: id, version: Number(instruction.version), status: outdated.length ? 'NEEDS_UPDATE' : 'CONSISTENT',
      outdatedSteps: outdated.map(r => r.step) };
  });
}

/**
 * @param input { reviewCase, bomStates, bomItems, costPrices, stockSnapshots, instructions, instructionReferences, asOfDate }
 * @returns impact result; throws ImpactRejection for invalid or non-comparable inputs
 */
export function calculateImpact(input) {
  const asOfDate = isoDay(input.asOfDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) throw new ImpactRejection('INVALID_AS_OF_DATE', String(input.asOfDate));
  const { reviewCase } = input;
  const { qty, from, to, aItems, bItems } = validate(input);
  const findings = [], flags = new Set();

  const comparison = compareBoms(aItems, bItems, flags, findings);

  const a = costOf(aItems, input.costPrices, reviewCase.plant, asOfDate);
  const b = costOf(bItems, input.costPrices, reviewCase.plant, asOfDate);
  const cost = { currency: RUN_CURRENCY, productionQuantity: Number(qty.num),
    fromPerAssembly: money(a.total), toPerAssembly: money(b.total), fromLines: a.lines, toLines: b.lines,
    issues: [...a.issues, ...b.issues] };
  if (a.total === null || b.total === null || flags.has('NON_COMPARABLE_UNIT')) {
    Object.assign(cost, { status: 'INCOMPLETE', deltaPerAssembly: null, fromTotal: null, toTotal: null, deltaTotal: null, deltaPercent: null });
    flags.add('COST_INCOMPLETE');
  } else {
    const delta = b.total.sub(a.total);
    const percent = a.total.isZero() ? null : delta.div(a.total).mul(100);
    Object.assign(cost, { status: 'COMPLETE', deltaPerAssembly: money(delta), fromTotal: money(a.total.mul(qty)),
      toTotal: money(b.total.mul(qty)), deltaTotal: money(delta.mul(qty)), deltaPercent: percent === null ? null : money(percent) });
    if (!delta.isZero()) {
      const refs = [...new Set([...a.lines, ...b.lines].map(l => l.priceEvidenceRef).filter(Boolean))].sort();
      findings.push({ type: 'COST_CHANGE', severity: percent === null || percent.abs().cmp(5) >= 0 ? 'MEDIUM' : 'LOW', material: null,
        details: `Material cost delta ${cost.deltaTotal} ${RUN_CURRENCY} for ${cost.productionQuantity} assemblies (${cost.deltaPercent ?? 'n/a'} %)`,
        evidenceRefs: refs });
    }
  }

  const stock = assessStock(bItems, qty, input.stockSnapshots, reviewCase.plant, asOfDate, findings, flags);
  const instructionLines = checkInstructions(input, to, bItems, findings);

  const unitPrices = new Map(b.lines.filter(l => l.unitPrice).map(l => [l.material, l]));
  const materialLines = stock.map(line => ({ ...line, unitPrice: unitPrices.get(line.material)?.unitPrice ?? null,
    priceEvidenceRef: unitPrices.get(line.material)?.priceEvidenceRef ?? null }));

  const summary = {
    instructionFindings: findings.filter(f => f.type === 'OUTDATED_INSTRUCTION_REFERENCE').length,
    instructionsToUpdate: instructionLines.filter(l => l.status === 'NEEDS_UPDATE').length,
    materialsShort: stock.filter(l => l.status === 'SHORT').length,
    materialsUnknown: stock.filter(l => ['UNKNOWN', 'NON_COMPARABLE'].includes(l.status)).length,
    costDeltaTotal: cost.deltaTotal, costDeltaPercent: cost.deltaPercent,
  };
  const sortedFlags = [...flags].sort();
  const status = !sortedFlags.length ? 'COMPLETE'
    : sortedFlags.length === 1 && sortedFlags[0] === 'STOCK_STALE' ? 'COMPLETE_WITH_WARNINGS' : 'INCOMPLETE';
  return { ruleset: RULESET, asOfDate, status, flags: sortedFlags,
    from: { stateKey: from.stateKey, revision: from.revision }, to: { stateKey: to.stateKey, revision: to.revision },
    comparison, cost, stock, materialLines, instructions: instructionLines, findings, summary };
}
