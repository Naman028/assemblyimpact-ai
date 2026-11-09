// Loads the versioned M04 synthetic fixtures (test/fixtures/m04) for tests only.
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

export const FIXTURES = join(import.meta.dirname, 'fixtures', 'm04');
// M05: scenario datasets live in fixtures/m05 and use the same file layout.
export const FIXTURES_M05 = join(import.meta.dirname, 'fixtures', 'm05');
export const datasetDir = id => (existsSync(join(FIXTURES, id)) ? join(FIXTURES, id) : join(FIXTURES_M05, id));
const FILES = ['assemblies', 'materials', 'bom_states', 'bom_items', 'cost_prices', 'stock_snapshots',
  'instructions', 'instruction_references', 'review_cases'];

const parseCsv = text => {
  const [head, ...lines] = text.trim().split(/\r?\n/);
  const cols = head.split(',');
  return lines.map(line => Object.fromEntries(line.split(',').map((v, i) => [cols[i], v])));
};

export const loadDataset = id => {
  const dir = datasetDir(id);
  const data = Object.fromEntries(FILES.map(f => [f, parseCsv(readFileSync(join(dir, `${f}.csv`), 'utf8'))]));
  data.manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  return data;
};

export const readJson = (...path) => JSON.parse(readFileSync(join(FIXTURES, ...path), 'utf8'));

export const applyMutations = (data, mutations) => {
  const copy = structuredClone(data);
  for (const m of mutations) {
    const match = row => Object.entries(m.where ?? {}).every(([k, v]) => row[k] === v);
    if (m.op === 'delete') copy[m.file] = copy[m.file].filter(row => !match(row));
    else if (m.op === 'update') {
      const hits = copy[m.file].filter(match);
      if (!hits.length) throw new Error(`mutation matched nothing: ${JSON.stringify(m)}`);
      hits.forEach(row => Object.assign(row, m.set));
    } else if (m.op === 'append') copy[m.file].push({ ...m.row });
    else throw new Error(`unknown mutation op ${m.op}`);
  }
  return copy;
};

/** Maps fixture CSV rows to the calculator input contract for one review case. */
export const toCalculatorInput = (data, caseNumber, asOfDate = data.manifest.referenceDate) => {
  const c = data.review_cases.find(r => r.caseNumber === caseNumber);
  return {
    asOfDate,
    reviewCase: { caseNumber: c.caseNumber, assemblyCode: c.assemblyCode, plant: c.plant,
      fromStateKey: c.fromBomStateId, toStateKey: c.toBomStateId, productionQuantity: c.productionQuantity },
    bomStates: data.bom_states.map(s => ({ ...s, stateKey: s.bomStateId })),
    bomItems: data.bom_items.map(i => ({ ...i, stateKey: i.bomStateId })),
    costPrices: data.cost_prices,
    stockSnapshots: data.stock_snapshots,
    instructions: data.instructions.map(i => ({ ...i, appliesToRevision: i.appliesToRevision || null })),
    instructionReferences: data.instruction_references,
  };
};

/** Deterministic UUID (name-based, SHA-256 truncated, RFC 4122 variant bits) for stable fixture keys. */
export const stableId = name => {
  const h = createHash('sha256').update(`assemblyimpact:${name}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
