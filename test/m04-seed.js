// M04 Slice 1b: builds CAP rows for the synthetic seed dataset from the versioned
// fixtures in test/fixtures/m04. tools/m04/build-seed.mjs writes test/data from it,
// and test/seed-data.test.js checks the committed CSVs against it (no drift).
// Everything produced here is SYNTHETIC; nothing comes from SAP S/4HANA.
import { loadDataset, stableId } from './m04-fixtures.js';

export const SEED_ID = 'SEED-M04-01';

/**
 * M04 Slice 2a (Decision A): seeded demonstration cases start OPEN, so every review runs through
 * EngineeringReview.submitForReview and leaves a genuine SUBMIT event with a real actor. No
 * historical decision events are seeded. The oracle fixture keeps its own status (IN_REVIEW);
 * the impact calculation does not read the case status.
 */
export const SEED_INITIAL_CASE_STATUS = 'OPEN';

/**
 * Seeded scenarios. Decision D-1b-1: only COOL-100 (DS-ORACLE-01) is application seed
 * data; PUMP-200 (DS-DEMO-01) stays test-only (Decision A). The plant-2000 mirror exists
 * so that plant isolation can be demonstrated on seeded records.
 */
export const SEED_SCENARIOS = [
  { dataset: 'DS-ORACLE-01', caseNumber: 'EC-000473' },
  { dataset: 'DS-ORACLE-01', caseNumber: 'EC-000473', mirrorToPlant: '2000', mirrorCaseNumber: 'EC-200473' },
];

/** CSV column order per entity (CAP element names; associations as <name>_ID). */
export const COLUMNS = {
  Assemblies: ['ID', 'assemblyCode', 'plant', 'description', 'version'],
  BOMStates: ['ID', 'stateKey', 'assembly_ID', 'plant', 'bomUsage', 'alternative', 'revision', 'validFrom', 'validTo',
    'status', 'changeNumber', 'sourceType', 'evidenceRef'],
  BOMItems: ['ID', 'bomState_ID', 'itemNo', 'material', 'quantity', 'unit', 'evidenceRef'],
  CostPrices: ['ID', 'material', 'plant', 'price', 'currency', 'priceUnit', 'unit', 'priceBasis', 'validFrom', 'validTo',
    'sourceType', 'evidenceRef'],
  StockSnapshots: ['ID', 'material', 'plant', 'availableQuantity', 'unit', 'snapshotAt', 'sourceType', 'evidenceRef'],
  Instructions: ['ID', 'instructionId', 'version', 'assembly_ID', 'plant', 'title', 'appliesToRevision', 'status',
    'validFrom', 'sourceType', 'evidenceRef'],
  InstructionReferences: ['ID', 'instruction_ID', 'step', 'material', 'quantity', 'unit', 'text'],
  ReviewCases: ['ID', 'caseNumber', 'title', 'assembly_ID', 'plant', 'fromState_ID', 'toState_ID', 'productionQuantity',
    'status', 'owner', 'sourceType', 'evidenceRef', 'version'],
};
export const ENTITIES = Object.keys(COLUMNS);

const orNull = v => (v === '' || v === undefined ? null : v);

/**
 * Rows for one scenario. Keys are name-based UUIDs, so the output is identical on every run.
 * A mirror copies only the case plant's rows to `mirrorToPlant` and prefixes evidence references.
 */
export function buildRows({ dataset, caseNumber, mirrorToPlant, mirrorCaseNumber, keyPrefix = 'seed' }) {
  const data = loadDataset(dataset);
  const source = data.review_cases.find(c => c.caseNumber === caseNumber);
  if (!source) throw new Error(`${dataset} has no case ${caseNumber}`);
  const casePlant = source.plant;
  const inScope = row => !mirrorToPlant || row.plant === undefined || row.plant === casePlant;
  const plantOf = row => (mirrorToPlant ? mirrorToPlant : row.plant);
  const ref = r => (mirrorToPlant ? `PLANT-${mirrorToPlant}-MIRROR:${r}` : r);
  const id = name => stableId(`${keyPrefix}:${dataset}:${mirrorToPlant ?? 'primary'}:${name}`);
  const label = `[SYNTHETIC ${dataset}${mirrorToPlant ? ` mirror ${mirrorToPlant}` : ''}]`;
  const assemblyId = (code, plant) => id(`assembly:${code}:${plant}`);
  const stateId = key => id(`bom:${key}`);
  const instrId = (i, v) => id(`instruction:${i}/${v}`);

  const rows = Object.fromEntries(ENTITIES.map(e => [e, []]));
  for (const a of data.assemblies.filter(inScope)) {
    const plant = plantOf(a);
    rows.Assemblies.push({ ID: assemblyId(a.assemblyCode, plant), assemblyCode: a.assemblyCode, plant,
      description: `${a.description} ${label}`, version: id(`assembly-version:${a.assemblyCode}:${plant}`) });
  }
  const stateAssembly = {};
  for (const s of data.bom_states.filter(inScope)) {
    const plant = plantOf(s);
    stateAssembly[s.bomStateId] = assemblyId(s.assemblyCode, plant);
    rows.BOMStates.push({ ID: stateId(s.bomStateId), stateKey: s.bomStateId, assembly_ID: assemblyId(s.assemblyCode, plant),
      plant, bomUsage: s.bomUsage, alternative: s.alternative, revision: s.revision, validFrom: s.validFrom,
      validTo: s.validTo, status: s.status, changeNumber: orNull(s.changeNumber), sourceType: s.sourceType,
      evidenceRef: ref(s.evidenceRef) });
  }
  for (const i of data.bom_items.filter(i => stateAssembly[i.bomStateId])) {
    rows.BOMItems.push({ ID: id(`bom-item:${i.bomStateId}/${i.itemNo}`), bomState_ID: stateId(i.bomStateId),
      itemNo: i.itemNo, material: i.material, quantity: i.quantity, unit: i.unit, evidenceRef: ref(i.evidenceRef) });
  }
  for (const c of data.cost_prices.filter(inScope)) {
    const plant = plantOf(c);
    rows.CostPrices.push({ ID: id(`price:${c.material}:${plant}:${c.validFrom}`), material: c.material, plant,
      price: c.price, currency: c.currency, priceUnit: c.priceUnit, unit: c.unit, priceBasis: c.priceBasis,
      validFrom: c.validFrom, validTo: c.validTo, sourceType: c.sourceType, evidenceRef: ref(c.evidenceRef) });
  }
  for (const s of data.stock_snapshots.filter(inScope)) {
    const plant = plantOf(s);
    rows.StockSnapshots.push({ ID: id(`stock:${s.material}:${plant}:${s.snapshotAt}`), material: s.material, plant,
      availableQuantity: s.availableQuantity, unit: s.unit, snapshotAt: s.snapshotAt, sourceType: s.sourceType,
      evidenceRef: ref(s.evidenceRef) });
  }
  const instructionKeys = new Set();
  for (const i of data.instructions.filter(inScope)) {
    const plant = plantOf(i);
    instructionKeys.add(`${i.instructionId}/${i.version}`);
    rows.Instructions.push({ ID: instrId(i.instructionId, i.version), instructionId: i.instructionId, version: i.version,
      assembly_ID: assemblyId(i.assemblyCode, plant), plant, title: i.title, appliesToRevision: orNull(i.appliesToRevision),
      status: i.status, validFrom: i.validFrom, sourceType: i.sourceType, evidenceRef: ref(i.evidenceRef) });
  }
  for (const r of data.instruction_references.filter(r => instructionKeys.has(`${r.instructionId}/${r.version}`))) {
    rows.InstructionReferences.push({ ID: id(`instruction-ref:${r.instructionId}/${r.version}/${r.step}`),
      instruction_ID: instrId(r.instructionId, r.version), step: r.step, material: r.material,
      quantity: orNull(r.quantity), unit: orNull(r.unit), text: orNull(r.text) });
  }
  const plant = mirrorToPlant ?? casePlant;
  const number = mirrorToPlant ? mirrorCaseNumber : caseNumber;
  rows.ReviewCases.push({ ID: id(`case:${number}`), caseNumber: number,
    title: mirrorToPlant ? `${source.title} (plant ${mirrorToPlant} isolation mirror)` : source.title,
    assembly_ID: assemblyId(source.assemblyCode, plant), plant, fromState_ID: stateId(source.fromBomStateId),
    toState_ID: stateId(source.toBomStateId), productionQuantity: source.productionQuantity, status: SEED_INITIAL_CASE_STATUS,
    owner: source.owner, sourceType: source.sourceType, evidenceRef: ref(source.evidenceRef), version: id(`case-version:${number}`) });
  return rows;
}

/** All seeded rows, merged across SEED_SCENARIOS, in a stable order. */
export function buildSeed() {
  const merged = Object.fromEntries(ENTITIES.map(e => [e, []]));
  for (const scenario of SEED_SCENARIOS) {
    const rows = buildRows(scenario);
    for (const e of ENTITIES) merged[e].push(...rows[e]);
  }
  return merged;
}

const cell = v => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CAP CSV text for one entity (header = element names, LF line endings, trailing newline). */
export const toCsv = (entity, rows) =>
  [COLUMNS[entity].join(','), ...rows.map(r => COLUMNS[entity].map(c => cell(r[c])).join(','))].join('\n') + '\n';

export const csvFileName = entity => `assemblyimpact-${entity}.csv`;
