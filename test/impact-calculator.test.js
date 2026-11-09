import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateImpact, ImpactRejection, RULESET } from '../srv/lib/impact-calculator.js';
import { Exact } from '../srv/lib/exact.js';
import { loadDataset, readJson, applyMutations, toCalculatorInput } from './m04-fixtures.js';

// Golden comparison against independently generated expected results (fixtures/tools/oracle.py).
const project = r => ({
  status: r.status, flags: r.flags,
  comparison: r.comparison.map(l => [l.itemNo, l.fromMaterial, l.fromQuantity, l.toMaterial, l.toQuantity, l.unit, l.change]),
  cost: ['status', 'fromPerAssembly', 'toPerAssembly', 'deltaPerAssembly', 'fromTotal', 'toTotal', 'deltaTotal', 'deltaPercent']
    .map(k => r.cost[k]),
  costIssues: r.cost.issues,
  stock: r.stock.map(l => [l.material, l.unit, l.required, l.available, l.gap, l.status, l.stale]),
  instructions: r.instructions,
  summary: ['instructionFindings', 'instructionsToUpdate', 'materialsShort', 'materialsUnknown', 'costDeltaTotal', 'costDeltaPercent']
    .map(k => r.summary[k]),
  findings: r.findings.map(f => [f.type, f.severity, f.material ?? null]),
});

for (const id of ['DS-ORACLE-01', 'DS-DEMO-01']) {
  test(`calculator reproduces ${id} expected results`, () => {
    const data = loadDataset(id);
    const expected = readJson(id, 'expected-results.json');
    assert.equal(expected.ruleset, RULESET);
    for (const exp of expected.cases) {
      const got = calculateImpact(toCalculatorInput(data, exp.caseNumber, expected.referenceDate));
      assert.deepEqual(project(got), project(exp), `${id} ${exp.caseNumber}`);
    }
  });
}

test('calculator reproduces all DS-NEG-01 outcomes', () => {
  const spec = readJson('DS-NEG-01', 'cases.json');
  assert.equal(spec.cases.length, 16);
  for (const c of spec.cases) {
    const data = applyMutations(loadDataset(c.baseDataset), c.mutations);
    let result, code = null;
    try { result = calculateImpact(toCalculatorInput(data, c.caseNumber)); } catch (error) {
      if (!(error instanceof ImpactRejection)) throw error;
      code = error.code;
    }
    assert.equal(result?.status ?? 'REJECTED', c.expected.status, c.id);
    assert.equal(code, c.expected.errorCode ?? null, c.id);
    for (const flag of c.expected.flagsInclude ?? []) assert(result.flags.includes(flag), `${c.id} flag ${flag}`);
    for (const [path, value] of Object.entries(c.expected.checks ?? {})) {
      const actual = path.split('.').reduce((cur, part) => (Array.isArray(cur) ? cur[Number(part)] : cur?.[part]), result);
      assert.deepEqual(actual, value, `${c.id} ${path}`);
    }
  }
});

test('canonical COOL-100 values and mockup corrections', () => {
  const r = calculateImpact(toCalculatorInput(loadDataset('DS-ORACLE-01'), 'EC-000473'));
  assert.deepEqual([r.cost.fromPerAssembly, r.cost.toPerAssembly, r.cost.deltaTotal, r.cost.deltaPercent],
    ['56.00', '68.00', '1200.00', '21.43']);
  assert.notEqual(r.cost.deltaTotal, '1250.00');
  assert.equal(r.summary.materialsShort, 2);
  assert.equal(r.findings.length, 7);
});

test('calculator is deterministic and does not mutate its input', () => {
  const input = toCalculatorInput(loadDataset('DS-DEMO-01'), 'EC-000471');
  const before = JSON.stringify(input);
  const first = JSON.stringify(calculateImpact(input));
  assert.equal(JSON.stringify(calculateImpact(input)), first);
  assert.equal(JSON.stringify(input), before);
});

test('exact arithmetic avoids binary floating point and rounds half away from zero', () => {
  assert.equal(Exact.of('0.1').add('0.2').toPlain(), '0.3');
  assert.equal(Exact.of('1').div('3').mul('3').toPlain(), '1');
  assert.equal(Exact.of('2.345').toFixed(2), '2.35');
  assert.equal(Exact.of('-2.345').toFixed(2), '-2.35');
  assert.throws(() => Exact.of('1e3'), TypeError);
  assert.throws(() => Exact.of('abc'), TypeError);
  assert.throws(() => Exact.of('1').div('3').toPlain(), RangeError);
});
