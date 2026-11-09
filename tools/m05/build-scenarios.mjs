// Writes the M05 synthetic scenario fixtures (test/fixtures/m05/<dataset>/*.csv + manifest.json)
// from tools/m05/scenarios.mjs. Usage: node tools/m05/build-scenarios.mjs [--check]
// Same CSV layout as test/fixtures/m04/DS-ORACLE-01 (which is never touched by this tool).
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { SCENARIOS } from './scenarios.mjs';

const ROOT = join(import.meta.dirname, '..', '..', 'test', 'fixtures', 'm05');
const check = process.argv.includes('--check');
const LABEL = 'SYNTHETIC DEMO DATA - fictional company NovaMotion Manufacturing - not SAP S/4HANA data';
// The fixture parser (test/m04-fixtures.js) splits on commas without quoting: refuse such values.
const field = v => { const s = String(v ?? ''); if (/[,\r\n"]/.test(s)) throw new Error(`fixture value must not contain , " or newlines: ${s}`); return s; };
const csv = (cols, rows) => [cols.join(','), ...rows.map(r => cols.map(c => field(r[c])).join(','))].join('\n') + '\n';
const money = v => v.toFixed(2);

export function filesFor(s) {
  const ds = s.dataset, a = `BOM-${s.assemblyCode}-A`, b = `BOM-${s.assemblyCode}-B`, ref = path => `${ds}/${path}`;
  const items = (state, list) => list.map(([itemNo, material, quantity]) => {
    const unit = s.materials.find(m => m[0] === material)[2];
    return { bomStateId: state, itemNo, material, quantity, unit, evidenceRef: ref(`bom_items/${state}/${itemNo}`) };
  });
  return {
    'manifest.json': JSON.stringify({ datasetId: ds, version: '1.0.0', purpose: s.purpose, synthetic: true, dataLabel: LABEL,
      company: 'NovaMotion Manufacturing', plant: s.plant, currency: 'EUR', referenceDate: '2026-11-08', randomness: 'none - all values fixed',
      sourceOfFixedValues: 'Synthetic M05 scenario spec (tools/m05/scenarios.mjs); no impact results are stored' }, null, 2) + '\n',
    'assemblies.csv': csv(['assemblyCode', 'plant', 'description', 'sourceType', 'evidenceRef'],
      [{ assemblyCode: s.assemblyCode, plant: s.plant, description: s.description, sourceType: 'SYNTHETIC_FIXTURE', evidenceRef: ref(`assemblies/${s.assemblyCode}`) }]),
    'materials.csv': csv(['material', 'description', 'baseUnit', 'sourceType'],
      s.materials.map(([material, description, baseUnit]) => ({ material, description, baseUnit, sourceType: 'SYNTHETIC_FIXTURE' }))),
    'bom_states.csv': csv(['bomStateId', 'assemblyCode', 'plant', 'bomUsage', 'alternative', 'revision', 'validFrom', 'validTo', 'status', 'changeNumber', 'sourceType', 'evidenceRef'], [
      { bomStateId: a, assemblyCode: s.assemblyCode, plant: s.plant, bomUsage: '1', alternative: '01', revision: 'A', validFrom: '2026-01-01', validTo: '2026-11-30', status: 'RELEASED', changeNumber: '', sourceType: 'SYNTHETIC_FIXTURE', evidenceRef: ref(`bom_states/${a}`) },
      { bomStateId: b, assemblyCode: s.assemblyCode, plant: s.plant, bomUsage: '1', alternative: '01', revision: 'B', validFrom: '2026-12-01', validTo: '9999-12-31', status: 'PROPOSED', changeNumber: s.caseNumber, sourceType: 'SYNTHETIC_FIXTURE', evidenceRef: ref(`bom_states/${b}`) }]),
    'bom_items.csv': csv(['bomStateId', 'itemNo', 'material', 'quantity', 'unit', 'evidenceRef'], [...items(a, s.a), ...items(b, s.b)]),
    'cost_prices.csv': csv(['material', 'plant', 'price', 'currency', 'priceUnit', 'unit', 'priceBasis', 'validFrom', 'validTo', 'sourceType', 'evidenceRef'],
      s.materials.filter(m => m[3] !== null).map(([material, , unit, price]) => ({ material, plant: s.plant, price: money(price), currency: 'EUR', priceUnit: '1', unit,
        priceBasis: 'SYNTHETIC_STANDARD_PRICE', validFrom: '2026-01-01', validTo: '9999-12-31', sourceType: 'SYNTHETIC_FIXTURE', evidenceRef: ref(`cost_prices/${material}`) }))),
    'stock_snapshots.csv': csv(['material', 'plant', 'availableQuantity', 'unit', 'snapshotAt', 'sourceType', 'valueStatus', 'evidenceRef'],
      s.materials.map(([material, , unit, , stock]) => ({ material, plant: s.plant, availableQuantity: stock, unit, snapshotAt: s.snapshotAt,
        sourceType: 'SYNTHETIC_FIXTURE', valueStatus: 'SYNTHETIC', evidenceRef: ref(`stock_snapshots/${material}`) }))),
    'instructions.csv': csv(['instructionId', 'version', 'assemblyCode', 'plant', 'title', 'appliesToRevision', 'status', 'validFrom', 'sourceType', 'valueStatus', 'evidenceRef'],
      s.instructions.map(([instructionId, version, title, appliesToRevision, status, validFrom]) => ({ instructionId, version, assemblyCode: s.assemblyCode, plant: s.plant,
        title, appliesToRevision, status, validFrom, sourceType: 'SYNTHETIC_FIXTURE', valueStatus: 'SYNTHETIC', evidenceRef: ref(`instructions/${instructionId}/v${version}`) }))),
    'instruction_references.csv': csv(['instructionId', 'version', 'step', 'material', 'quantity', 'unit', 'text'],
      s.instructions.flatMap(([instructionId, version, , , , , steps]) => steps.map(([step, material, quantity, text]) =>
        ({ instructionId, version, step, material, quantity, unit: s.materials.find(m => m[0] === material)[2], text })))),
    'review_cases.csv': csv(['caseNumber', 'title', 'assemblyCode', 'plant', 'fromBomStateId', 'toBomStateId', 'productionQuantity', 'status', 'sourceType', 'owner', 'evidenceRef'],
      [{ caseNumber: s.caseNumber, title: s.title, assemblyCode: s.assemblyCode, plant: s.plant, fromBomStateId: a, toBomStateId: b,
        productionQuantity: s.productionQuantity, status: 'OPEN', sourceType: 'SYNTHETIC_FIXTURE', owner: s.owner, evidenceRef: ref(`review_cases/${s.caseNumber}`) }]),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let stale = 0;
  for (const s of SCENARIOS) {
    const dir = join(ROOT, s.dataset);
    if (!check) mkdirSync(dir, { recursive: true });
    for (const [name, text] of Object.entries(filesFor(s))) {
      const file = join(dir, name);
      if (check) { if (!existsSync(file) || readFileSync(file, 'utf8') !== text) { stale++; console.log(`OUT OF DATE ${file}`); } }
      else writeFileSync(file, text);
    }
    if (!check) console.log(`${s.dataset}: ${s.assemblyCode} / ${s.caseNumber}`);
  }
  if (check) { console.log(stale ? `${stale} file(s) out of date` : 'test/fixtures/m05 is up to date'); process.exit(stale ? 1 : 0); }
}
