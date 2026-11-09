// Independent cross-check of expected-results.json (check 2 of 3).
// Different language and arithmetic from oracle.py: integer micro-euro BigInt math,
// own CSV parser, own comparison logic. Reads the same fixture CSVs.
// Usage: node crosscheck.mjs <dataset_dir>
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const csv = (name) => {
  const [head, ...lines] = readFileSync(join(dir, `${name}.csv`), 'utf8').trim().split(/\r?\n/);
  const cols = head.split(',');
  return lines.map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v])));
};
const MICRO = 1_000_000n;
const toMicro = (s) => { // decimal string -> BigInt micro units (exact for <= 6 decimals)
  const [i, f = ''] = s.split('.');
  const neg = i.startsWith('-');
  const v = BigInt(i.replace('-', '')) * MICRO + BigInt((f + '000000').slice(0, 6));
  return neg ? -v : v;
};
const fmt2 = (micro) => { // half-up to cents
  const neg = micro < 0n; let m = neg ? -micro : micro;
  let cents = m / 10_000n; if (m % 10_000n >= 5_000n) cents += 1n;
  const s = `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
  return neg ? `-${s}` : s;
};

const expected = JSON.parse(readFileSync(join(dir, 'expected-results.json'), 'utf8'));
const items = csv('bom_items'), prices = csv('cost_prices'), stock = csv('stock_snapshots');
const cases = csv('review_cases');
let failures = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
};

for (const c of cases) {
  const exp = expected.cases.find((x) => x.caseNumber === c.caseNumber);
  const qty = BigInt(c.productionQuantity);
  const bom = (id) => items.filter((r) => r.bomStateId === id);
  const unitPriceMicro = (mat) => {
    const p = prices.filter((x) => x.material === mat && x.plant === c.plant);
    if (p.length !== 1) throw new Error(`price lookup ${mat}`);
    return toMicro(p[0].price) / BigInt(p[0].priceUnit); // exact for fixture values
  };
  const cost = (id) => bom(id).reduce((s, r) => s + BigInt(r.quantity) * unitPriceMicro(r.material), 0n);
  const a = cost(c.fromBomStateId), b = cost(c.toBomStateId);
  check(`${c.caseNumber} from/assembly`, fmt2(a), exp.cost.fromPerAssembly);
  check(`${c.caseNumber} to/assembly`, fmt2(b), exp.cost.toPerAssembly);
  check(`${c.caseNumber} delta total`, fmt2((b - a) * qty), exp.cost.deltaTotal);
  // percent in basis points of 0.01 %, half-up
  const pctMicro = ((b - a) * 100n * MICRO) / a;
  check(`${c.caseNumber} delta percent`, fmt2(pctMicro), exp.cost.deltaPercent);

  // classification by item number
  const A = Object.fromEntries(bom(c.fromBomStateId).map((r) => [r.itemNo, r]));
  const B = Object.fromEntries(bom(c.toBomStateId).map((r) => [r.itemNo, r]));
  const classes = [...new Set([...Object.keys(A), ...Object.keys(B)])].sort().map((k) => {
    const x = A[k], y = B[k];
    if (!y) return [k, 'REMOVED'];
    if (!x) return [k, 'ADDED'];
    if (x.material !== y.material) return [k, 'REPLACED'];
    return [k, x.quantity === y.quantity ? 'UNCHANGED' : 'QUANTITY_CHANGED'];
  });
  check(`${c.caseNumber} comparison`, classes, exp.comparison.map((l) => [l.itemNo, l.change]));

  // stock gaps on target revision, same plant only
  const need = {};
  for (const r of bom(c.toBomStateId)) need[r.material] = (need[r.material] ?? 0n) + BigInt(r.quantity) * qty;
  const gaps = Object.keys(need).sort().map((m) => {
    const s = stock.filter((x) => x.material === m && x.plant === c.plant);
    const avail = BigInt(s[0].availableQuantity);
    const gap = need[m] > avail ? need[m] - avail : 0n;
    return [m, String(need[m]), String(avail), String(gap)];
  });
  check(`${c.caseNumber} stock`, gaps, exp.stock.map((l) => [l.material, l.required, l.available, l.gap]));
}
console.log(`crosscheck ${dir}: ${failures} failure(s)`);
process.exit(failures ? 1 : 0);
