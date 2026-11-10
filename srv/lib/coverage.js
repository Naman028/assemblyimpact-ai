// Time-based material coverage (planning view). Separate from the deterministic engineering-change impact
// calculation (impact-calculator.js), which stays unchanged: it answers "what does revision B need for the
// production quantity, at the as-of date"; this answers "how long does the stock last under a stated
// consumption rate, and when does the case's one-off requirement fall into that horizon".
//
// Calculation rules (documented in docs/business-rules/identifiers-quantities-and-planning.md):
//  R1 Calendar: UTC calendar days. The horizon is [startDate, startDate + days - 1], 1..366 days.
//  R2 Rates: a rate is DAY, WEEK or MONTH quantity. Per calendar day: DAY = q, WEEK = q / 7,
//     MONTH = q / (number of days of that calendar month). Exact rational arithmetic, no rounding inside.
//  R3 At most one active rate per material, plant and day (validFrom..validTo inclusive). A day without a rate
//     has UNKNOWN demand, never zero: it is counted (noRateDays, missingRanges), the demand figures become lower
//     bounds, and the result can only be SHORTAGE (proven even with the unknown days at zero) or INCOMPLETE.
//     A rate of 0 is a known, explicitly planned zero consumption (an inactive period) and is fully evaluated.
//     Deactivated (withdrawn) rate records are ignored, as if never entered.
//  R4 Opening stock: the latest stock snapshot taken before the end of startDate. No snapshot -> NO_STOCK,
//     no projection (stock is never assumed). Snapshots after the start are not mixed into the projection.
//  R5 The case requirement (production quantity x proposed BOM quantity, from the impact rules) is consumed
//     once, on the effective date of the proposed revision, if that date lies in the horizon.
//  R6 Units of rate, stock and BOM line must be equal; otherwise UNIT_MISMATCH and no numbers.
//  R7 Zero rates and zero requirements are valid (no consumption); negative values are rejected on input.
import { Exact } from './exact.js';

export const PERIODS = Object.freeze(['DAY', 'WEEK', 'MONTH']);
export const MAX_HORIZON_DAYS = 366;

const DAY_MS = 86400000;
const isoDay = d => new Date(d).toISOString().slice(0, 10);
/** A real calendar date in YYYY-MM-DD (rejects 2026-02-30, 2026-13-01, 2027-02-29). */
export const isCalendarDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v)) && !Number.isNaN(Date.parse(v + 'T00:00:00Z')) && isoDay(Date.parse(v + 'T00:00:00Z')) === v;
const addDays = (iso, n) => isoDay(Date.parse(iso + 'T00:00:00Z') + n * DAY_MS);
const daysInMonth = iso => { const d = new Date(iso + 'T00:00:00Z'); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); };

export class CoverageRejection extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

/** Per-day consumption of one rate record on one calendar day (R2). */
export function dailyQuantity(rate, day) {
  const q = Exact.of(String(rate.quantity));
  if (rate.period === 'DAY') return q;
  if (rate.period === 'WEEK') return q.div(7);
  if (rate.period === 'MONTH') return q.div(daysInMonth(day));
  throw new CoverageRejection('INVALID_PERIOD', `Unknown period ${rate.period}.`);
}

/** Checks a rate record before it is stored (R2, R3, R7). `others` = stored rates of the same material/plant. */
export function validateRate(rate, others = []) {
  if (!PERIODS.includes(rate.period)) throw new CoverageRejection('INVALID_PERIOD', `period must be one of ${PERIODS.join(', ')}.`);
  let q;
  try { q = Exact.of(String(rate.quantity)); } catch { throw new CoverageRejection('INVALID_QUANTITY', 'quantity must be a decimal number.'); }
  if (q.cmp(0) < 0) throw new CoverageRejection('INVALID_QUANTITY', 'A consumption rate cannot be negative (use 0 for no consumption).');
  if (q.cmp(10000000) > 0) throw new CoverageRejection('INVALID_QUANTITY', 'The consumption rate is unrealistically large.');
  if (!q.mul(1000).isInteger()) throw new CoverageRejection('INVALID_QUANTITY', 'At most 3 decimals are allowed.');
  if (!isCalendarDate(rate.validFrom) || !isCalendarDate(rate.validTo) || rate.validFrom > rate.validTo)
    throw new CoverageRejection('INVALID_PERIOD_DATES', 'validFrom and validTo must be real calendar dates (YYYY-MM-DD) with validFrom <= validTo (both inclusive).');
  const overlap = others.find(o => o.ID !== rate.ID && o.active !== false && o.validFrom <= rate.validTo && rate.validFrom <= o.validTo);
  if (overlap) throw new CoverageRejection('OVERLAPPING_RATE', `A rate for ${rate.material} already covers ${overlap.validFrom}..${overlap.validTo}.`);
}

/**
 * Projects stock per day for each material.
 * @param materials [{ material, unit, caseRequirement }]  caseRequirement may be null (material not in revision B)
 * @param stock [{ material, unit, availableQuantity, snapshotAt }]
 * @param rates [{ material, unit, period, quantity, validFrom, validTo }]
 */
export function projectCoverage({ startDate, days, effectiveDate, materials, stock, rates }) {
  if (!isCalendarDate(startDate)) throw new CoverageRejection('INVALID_START', 'startDate must be a real calendar date (YYYY-MM-DD).');
  if (!Number.isInteger(days) || days < 1 || days > MAX_HORIZON_DAYS) throw new CoverageRejection('INVALID_HORIZON', `days must be 1..${MAX_HORIZON_DAYS}.`);
  const endDate = addDays(startDate, days - 1), cutoff = Date.parse(addDays(startDate, 1) + 'T00:00:00Z');
  return materials.map(m => {
    const base = { material: m.material, unit: m.unit, startDate, endDate, effectiveDate: effectiveDate ?? null,
      caseRequirement: m.caseRequirement == null ? null : Exact.of(String(m.caseRequirement)).toPlain() };
    const snap = stock.filter(s => s.material === m.material && Date.parse(s.snapshotAt) < cutoff)
      .sort((a, b) => Date.parse(b.snapshotAt) - Date.parse(a.snapshotAt))[0];
    if (!snap) return { ...base, status: 'NO_STOCK' };
    const own = rates.filter(r => r.material === m.material && r.active !== false);
    if (snap.unit !== m.unit || own.some(r => r.unit !== m.unit)) return { ...base, status: 'UNIT_MISMATCH' };
    let level = Exact.of(String(snap.availableQuantity)), total = Exact.of(0), noRate = 0, exhaustion = null, coveredDays = 0;
    const missing = []; // [from, to] ranges of days with unknown demand
    const requirementInHorizon = m.caseRequirement != null && effectiveDate && effectiveDate >= startDate && effectiveDate <= endDate;
    for (let i = 0; i < days; i++) {
      const day = addDays(startDate, i);
      const rate = own.find(r => r.validFrom <= day && day <= r.validTo);
      let use = rate ? dailyQuantity(rate, day) : Exact.of(0);
      if (!rate) {
        noRate++;
        const last = missing.at(-1);
        if (last && last[1] === addDays(day, -1)) last[1] = day; else missing.push([day, day]);
      }
      if (requirementInHorizon && day === effectiveDate) use = use.add(String(m.caseRequirement));
      total = total.add(use);
      level = level.sub(use);
      if (level.cmp(0) < 0 && !exhaustion) exhaustion = day;
      // Covered days count only days whose demand is known and that are not short.
      if (!exhaustion && !noRate) coveredDays++;
    }
    const firstRate = own.find(r => r.validFrom <= startDate && startDate <= r.validTo);
    const complete = noRate === 0;
    // A shortage found with unknown days treated as zero is certain (unknown demand can only add consumption);
    // the exhaustion date is then the latest possible date. Without a shortage, unknown days make the result INCOMPLETE.
    const status = exhaustion ? 'SHORTAGE' : complete ? 'COVERED' : 'INCOMPLETE';
    return { ...base, status, demandComplete: complete,
      openingStock: Exact.of(String(snap.availableQuantity)).toPlain(), stockSnapshotAt: snap.snapshotAt,
      dailyRateAtStart: firstRate ? dailyQuantity(firstRate, startDate).toFixed(3) : null,
      expectedDemand: total.toFixed(3), projectedEndStock: level.toFixed(3),
      shortageAtEnd: level.cmp(0) < 0 ? level.abs().toFixed(3) : '0.000',
      coveredDays, exhaustionDate: exhaustion, exhaustionIsLatestPossible: !!exhaustion && !complete,
      noRateDays: noRate, missingRanges: missing.map(([a, b]) => (a === b ? a : `${a}..${b}`)).join(', ') || null,
      requirementInHorizon: !!requirementInHorizon };
  });
}
