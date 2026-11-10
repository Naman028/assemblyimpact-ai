// Time-based consumption planning (pure rules R1..R7 of srv/lib/coverage.js).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectCoverage, dailyQuantity, validateRate, CoverageRejection, MAX_HORIZON_DAYS } from '../srv/lib/coverage.js';

const stock = (q, at = '2026-01-01T08:00:00Z', unit = 'PC') => ({ material: 'M1', unit, availableQuantity: q, snapshotAt: at });
const rate = (period, quantity, validFrom = '2026-01-01', validTo = '2026-12-31', unit = 'PC') => ({ material: 'M1', unit, period, quantity, validFrom, validTo });
const run = (o = {}) => projectCoverage({ startDate: '2026-01-01', days: 10, effectiveDate: null,
  materials: [{ material: 'M1', unit: 'PC', caseRequirement: null }], stock: [stock('100')], rates: [rate('DAY', '10')], ...o })[0];

test('R2 converts DAY, WEEK and MONTH rates per calendar day', () => {
  assert.equal(dailyQuantity(rate('DAY', '5'), '2026-03-01').toFixed(3), '5.000');
  assert.equal(dailyQuantity(rate('WEEK', '70'), '2026-03-01').toFixed(3), '10.000');
  assert.equal(dailyQuantity(rate('MONTH', '310'), '2026-01-15').toFixed(3), '10.000');   // 31 days
  assert.equal(dailyQuantity(rate('MONTH', '280'), '2026-02-15').toFixed(3), '10.000');   // 28 days
  assert.equal(dailyQuantity(rate('MONTH', '290'), '2028-02-15').toFixed(3), '10.000');   // leap year, 29 days
});

test('a month rate summed over the whole month equals the monthly quantity exactly', () => {
  const r = projectCoverage({ startDate: '2026-02-01', days: 28, materials: [{ material: 'M1', unit: 'PC', caseRequirement: null }],
    stock: [stock('1000')], rates: [rate('MONTH', '100')] })[0];
  assert.equal(r.expectedDemand, '100.000');
  assert.equal(r.projectedEndStock, '900.000');
});

test('stock exactly consumed at the horizon is covered, one unit more is a shortage (boundary)', () => {
  const exact = run({ stock: [stock('100')] });
  assert.equal(exact.status, 'COVERED');
  assert.equal(exact.projectedEndStock, '0.000');
  assert.equal(exact.coveredDays, 10);
  const short = run({ stock: [stock('99')] });
  assert.equal(short.status, 'SHORTAGE');
  assert.equal(short.exhaustionDate, '2026-01-10');
  assert.equal(short.coveredDays, 9);
  assert.equal(short.shortageAtEnd, '1.000');
});

test('R5 case requirement is consumed once on the effective date inside the horizon only', () => {
  const materials = [{ material: 'M1', unit: 'PC', caseRequirement: '50' }];
  const inside = run({ materials, effectiveDate: '2026-01-03' });
  assert.equal(inside.requirementInHorizon, true);
  assert.equal(inside.expectedDemand, '150.000');
  assert.equal(inside.exhaustionDate, '2026-01-06');
  const outside = run({ materials, effectiveDate: '2026-02-01' });
  assert.equal(outside.requirementInHorizon, false);
  assert.equal(outside.expectedDemand, '100.000');
});

test('R3 days without a rate consume nothing and are reported', () => {
  const r = run({ rates: [rate('DAY', '10', '2026-01-06', '2026-01-31')] });
  assert.equal(r.noRateDays, 5);
  assert.equal(r.expectedDemand, '50.000');
  assert.equal(r.dailyRateAtStart, null);
});

test('R7 a zero rate is valid and consumes nothing', () => {
  const r = run({ rates: [rate('WEEK', '0')] });
  assert.equal(r.status, 'COVERED');
  assert.equal(r.expectedDemand, '0.000');
  assert.equal(r.noRateDays, 0);
});

test('R4 uses the latest snapshot up to the start date and never a later one', () => {
  const r = run({ stock: [stock('10', '2025-12-01T00:00:00Z'), stock('40', '2026-01-01T23:59:00Z'), stock('999', '2026-01-02T00:00:00Z')] });
  assert.equal(r.openingStock, '40');
  assert.equal(run({ stock: [stock('999', '2026-01-02T00:00:00Z')] }).status, 'NO_STOCK');
});

test('R6 unit mismatch yields no numbers', () => {
  const r = run({ stock: [stock('100', undefined, 'KG')] });
  assert.equal(r.status, 'UNIT_MISMATCH');
  assert.equal(r.expectedDemand, undefined);
  assert.equal(run({ rates: [rate('DAY', '1', undefined, undefined, 'KG')] }).status, 'UNIT_MISMATCH');
});

test('R1 horizon and start date are validated', () => {
  for (const days of [0, -1, MAX_HORIZON_DAYS + 1, 1.5, '10']) assert.throws(() => run({ days }), { code: 'INVALID_HORIZON' });
  assert.throws(() => run({ startDate: '01.01.2026' }), { code: 'INVALID_START' });
  assert.equal(run({ days: 1 }).endDate, '2026-01-01');
  assert.equal(run({ days: MAX_HORIZON_DAYS }).endDate, '2027-01-01');
});

test('validateRate rejects negatives, bad periods, bad dates and overlaps', () => {
  assert.doesNotThrow(() => validateRate(rate('DAY', '0')));
  assert.throws(() => validateRate(rate('DAY', '-1')), { code: 'INVALID_QUANTITY' });
  assert.throws(() => validateRate(rate('DAY', 'abc')), { code: 'INVALID_QUANTITY' });
  assert.throws(() => validateRate(rate('YEAR', '1')), { code: 'INVALID_PERIOD' });
  assert.throws(() => validateRate(rate('DAY', '1', '2026-02-01', '2026-01-01')), { code: 'INVALID_PERIOD_DATES' });
  const stored = [{ ...rate('DAY', '1', '2026-01-01', '2026-01-31'), ID: 'a' }];
  assert.throws(() => validateRate({ ...rate('WEEK', '7', '2026-01-31', '2026-02-28'), ID: 'b' }, stored), { code: 'OVERLAPPING_RATE' });
  assert.doesNotThrow(() => validateRate({ ...rate('WEEK', '7', '2026-02-01', '2026-02-28'), ID: 'b' }, stored));
  assert.doesNotThrow(() => validateRate({ ...rate('DAY', '2', '2026-01-01', '2026-01-31'), ID: 'a' }, stored), 'editing itself');
  assert.ok(new CoverageRejection('X', 'y') instanceof Error);
});
