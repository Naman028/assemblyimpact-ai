// M05: controlled import of SYNTHETIC demonstration scenarios (one assembly + one review case per file).
// Two steps: validate (no writes, returns a preview and every problem found) and commit (re-validates the
// same file, requires explicit confirmation, writes everything in the caller's transaction or nothing).
// Never overwrites: existing assemblies, cases, prices or stock in the target plant are conflicts.
// Provenance: sourceType DEMO_IMPORT, evidenceRef "DEMO-IMPORT/<batch>/...", one ImportBatches row per import.
// Not an ERP integration: genuine S/4HANA data would arrive through the P2 adapters with sourceType S4_IMPORT.
import cds from '@sap/cds';
import { createHash } from 'node:crypto';

// Well below CAP's request-body limit (413), so oversized files get a precise FILE_TOO_LARGE answer.
export const MAX_BYTES = 64 * 1024;
export const FORMAT = 'assemblyimpact-demo-import';
export const UNITS = Object.freeze(['PC', 'EA', 'M', 'KG', 'L', 'SET']);
const LIMITS = { materials: 100, items: 200, instructions: 20, steps: 100 };
const RX = {
  plant: /^\d{4}$/, assemblyCode: /^[A-Z][A-Z0-9-]{1,19}$/, material: /^[A-Z0-9][A-Z0-9-]{1,39}$/,
  caseNumber: /^EC-\d{6}$/, itemNo: /^\d{4}$/, instructionId: /^WI-[A-Z0-9-]{2,36}$/, step: /^\d{4}$/,
  date: /^\d{4}-\d{2}-\d{2}$/, timestamp: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/,
};

const isText = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const validDate = v => typeof v === 'string' && RX.date.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);
const decimals = n => (String(n).split('.')[1] ?? '').length;
const quantity = (v, { integer = false, max = 1e6 } = {}) => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= max && (integer ? Number.isInteger(v) : decimals(v) <= 3);

/** Pure structural validation (no database). Returns a list of { path, code, message }. */
export function checkStructure(doc, { plants }) {
  const errors = [];
  const err = (path, code, message) => errors.push({ path, code, message });
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) { err('', 'INVALID_DOCUMENT', 'The file must contain one JSON object.'); return errors; }
  if (doc.format !== FORMAT || doc.version !== 1) err('format', 'UNSUPPORTED_FORMAT', `Expected "format": "${FORMAT}" and "version": 1.`);
  if (doc.synthetic !== true) err('synthetic', 'NOT_SYNTHETIC', 'Only files declaring "synthetic": true can be imported as demonstration data.');
  if (!RX.plant.test(doc.plant ?? '')) err('plant', 'INVALID_PLANT', 'Plant must be a 4-digit code.');
  else if (!plants.includes(doc.plant)) err('plant', 'PLANT_NOT_AUTHORIZED', `You are not authorized for plant ${doc.plant}.`);
  if (!isText(doc.label, 120)) err('label', 'MISSING_LABEL', 'A label (max 120 characters) describing the synthetic scenario is required.');

  const a = doc.assembly ?? {};
  if (!RX.assemblyCode.test(a.assemblyCode ?? '')) err('assembly.assemblyCode', 'INVALID_CODE', 'Assembly code: upper-case letters, digits and "-", 2-20 characters, starting with a letter.');
  if (!isText(a.description, 100)) err('assembly.description', 'MISSING_TEXT', 'Assembly description is required (max 100 characters).');

  const materials = Array.isArray(doc.materials) ? doc.materials : (err('materials', 'MISSING_LIST', 'materials must be a list.'), []);
  if (materials.length > LIMITS.materials) err('materials', 'TOO_MANY', `At most ${LIMITS.materials} materials.`);
  const unitOf = new Map();
  materials.forEach((m, i) => {
    const p = `materials[${i}]`;
    if (!RX.material.test(m?.material ?? '')) { err(`${p}.material`, 'INVALID_CODE', 'Material: upper-case letters, digits and "-", 2-40 characters.'); return; }
    if (unitOf.has(m.material)) err(`${p}.material`, 'DUPLICATE_IN_FILE', `Material ${m.material} is listed twice.`);
    if (!UNITS.includes(m.unit)) err(`${p}.unit`, 'INVALID_UNIT', `Unit must be one of ${UNITS.join(', ')}.`);
    if (!isText(m.description, 80)) err(`${p}.description`, 'MISSING_TEXT', 'Material description is required (max 80 characters).');
    if (m.price !== null && m.price !== undefined && !(typeof m.price === 'number' && m.price >= 0 && m.price <= 1e7 && decimals(m.price) <= 2))
      err(`${p}.price`, 'INVALID_PRICE', 'Price must be a number >= 0 with at most 2 decimals (EUR per 1 unit), or null if not maintained.');
    if (!(typeof m.stock === 'number' && m.stock >= 0 && m.stock <= 1e7 && decimals(m.stock) <= 3)) err(`${p}.stock`, 'INVALID_QUANTITY', 'Stock must be a number >= 0 with at most 3 decimals.');
    if (!RX.timestamp.test(m.snapshotAt ?? '') || Number.isNaN(Date.parse(m.snapshotAt))) err(`${p}.snapshotAt`, 'INVALID_TIMESTAMP', 'snapshotAt must be an ISO timestamp in UTC (e.g. 2026-11-07T08:00:00Z).');
    else if (Date.parse(m.snapshotAt) > Date.now() + 86_400_000) err(`${p}.snapshotAt`, 'FUTURE_TIMESTAMP', 'Stock snapshots cannot lie in the future.');
    unitOf.set(m.material, m.unit);
  });

  const revs = doc.revisions ?? {};
  for (const rev of ['A', 'B']) {
    const r = revs[rev], p = `revisions.${rev}`;
    if (!r) { err(p, 'MISSING_REVISION', `Revision ${rev} is required (A = current, B = proposed).`); continue; }
    if (!validDate(r.validFrom) || !validDate(r.validTo)) err(p, 'INVALID_DATE', 'validFrom and validTo must be valid dates (YYYY-MM-DD).');
    else if (r.validFrom > r.validTo) err(p, 'INVALID_DATE_RANGE', 'validFrom must not be after validTo.');
    const items = Array.isArray(r.items) ? r.items : (err(`${p}.items`, 'MISSING_LIST', 'items must be a list.'), []);
    if (!items.length) err(`${p}.items`, 'EMPTY_BOM', 'A revision needs at least one BOM item.');
    if (items.length > LIMITS.items) err(`${p}.items`, 'TOO_MANY', `At most ${LIMITS.items} items.`);
    const seen = new Set();
    items.forEach((it, i) => {
      const q = `${p}.items[${i}]`;
      if (!RX.itemNo.test(it?.itemNo ?? '')) err(`${q}.itemNo`, 'INVALID_ITEM_NO', 'Item number must have 4 digits.');
      else if (seen.has(it.itemNo)) err(`${q}.itemNo`, 'DUPLICATE_IN_FILE', `Item ${it.itemNo} appears twice in revision ${rev}.`);
      seen.add(it?.itemNo);
      if (!unitOf.has(it?.material)) err(`${q}.material`, 'UNKNOWN_MATERIAL', `Material ${it?.material} is not listed under materials.`);
      if (!quantity(it?.quantity)) err(`${q}.quantity`, 'INVALID_QUANTITY', 'Quantity must be > 0 and <= 1000000 with at most 3 decimals.');
    });
  }
  if (validDate(revs.A?.validTo) && validDate(revs.B?.validFrom) && !(revs.A.validTo < revs.B.validFrom))
    err('revisions', 'OVERLAPPING_REVISIONS', 'Revision A must end before revision B becomes effective.');

  const instructions = doc.instructions === undefined ? [] : Array.isArray(doc.instructions) ? doc.instructions : (err('instructions', 'MISSING_LIST', 'instructions must be a list.'), []);
  if (instructions.length > LIMITS.instructions) err('instructions', 'TOO_MANY', `At most ${LIMITS.instructions} instructions.`);
  const instrKeys = new Set();
  instructions.forEach((w, i) => {
    const p = `instructions[${i}]`;
    if (!RX.instructionId.test(w?.instructionId ?? '')) err(`${p}.instructionId`, 'INVALID_CODE', 'Instruction ID must look like WI-<CODE>.');
    if (!Number.isInteger(w?.version) || w.version < 1 || w.version > 999) err(`${p}.version`, 'INVALID_VERSION', 'Version must be an integer 1-999.');
    const key = `${w?.instructionId}/${w?.version}`;
    if (instrKeys.has(key)) err(p, 'DUPLICATE_IN_FILE', `Instruction ${key} appears twice.`);
    instrKeys.add(key);
    if (!isText(w?.title, 160)) err(`${p}.title`, 'MISSING_TEXT', 'Instruction title is required.');
    if (![undefined, null, '', 'A', 'B'].includes(w?.appliesToRevision)) err(`${p}.appliesToRevision`, 'UNKNOWN_REVISION', 'appliesToRevision must be A, B or empty (all revisions).');
    if (!['RELEASED', 'SUPERSEDED'].includes(w?.status)) err(`${p}.status`, 'INVALID_STATUS', 'Instruction status must be RELEASED or SUPERSEDED.');
    if (!validDate(w?.validFrom)) err(`${p}.validFrom`, 'INVALID_DATE', 'validFrom must be a valid date.');
    const steps = Array.isArray(w?.steps) ? w.steps : [];
    if (steps.length > LIMITS.steps) err(`${p}.steps`, 'TOO_MANY', `At most ${LIMITS.steps} steps.`);
    const stepSeen = new Set();
    steps.forEach((s, j) => {
      const q = `${p}.steps[${j}]`;
      if (!RX.step.test(s?.step ?? '')) err(`${q}.step`, 'INVALID_STEP', 'Step must have 4 digits.');
      else if (stepSeen.has(s.step)) err(`${q}.step`, 'DUPLICATE_IN_FILE', `Step ${s.step} appears twice.`);
      stepSeen.add(s?.step);
      if (!unitOf.has(s?.material)) err(`${q}.material`, 'UNKNOWN_MATERIAL', `Material ${s?.material} is not listed under materials.`);
      if (s?.quantity !== undefined && s?.quantity !== null && !quantity(s.quantity)) err(`${q}.quantity`, 'INVALID_QUANTITY', 'Quantity must be > 0 with at most 3 decimals.');
      if (s?.text !== undefined && !(typeof s.text === 'string' && s.text.length <= 200)) err(`${q}.text`, 'INVALID_TEXT', 'Step text max 200 characters.');
    });
  });

  const c = doc.reviewCase ?? {};
  if (!RX.caseNumber.test(c.caseNumber ?? '')) err('reviewCase.caseNumber', 'INVALID_CASE_NUMBER', 'Case number must look like EC-000123.');
  if (!isText(c.title, 120)) err('reviewCase.title', 'MISSING_TEXT', 'Case title is required (max 120 characters).');
  if (!quantity(c.productionQuantity, { integer: true })) err('reviewCase.productionQuantity', 'INVALID_QUANTITY', 'Production quantity must be an integer between 1 and 1000000.');
  if (c.owner !== undefined && !(typeof c.owner === 'string' && c.owner.length <= 80)) err('reviewCase.owner', 'INVALID_TEXT', 'Owner max 80 characters.');
  return errors;
}

/** Conflicts with existing data in the target plant (never overwrite). */
async function checkConflicts(doc) {
  const { Assemblies, ReviewCases, CostPrices, StockSnapshots, Instructions } = cds.entities('assemblyimpact');
  const errors = [];
  const materials = doc.materials.map(m => m.material);
  if (await SELECT.one.from(Assemblies).columns('ID').where({ assemblyCode: doc.assembly.assemblyCode, plant: doc.plant }))
    errors.push({ path: 'assembly.assemblyCode', code: 'ALREADY_EXISTS', message: `Assembly ${doc.assembly.assemblyCode} already exists in plant ${doc.plant}; imports never overwrite.` });
  if (await SELECT.one.from(ReviewCases).columns('ID').where({ caseNumber: doc.reviewCase.caseNumber }))
    errors.push({ path: 'reviewCase.caseNumber', code: 'ALREADY_EXISTS', message: `Case ${doc.reviewCase.caseNumber} already exists.` });
  for (const [E, what] of [[CostPrices, 'a price'], [StockSnapshots, 'stock']]) {
    const hits = await SELECT.from(E).columns('material').where({ plant: doc.plant, material: { in: materials } });
    for (const m of new Set(hits.map(h => h.material)))
      errors.push({ path: `materials[${materials.indexOf(m)}].material`, code: 'ALREADY_EXISTS', message: `Material ${m} already has ${what} in plant ${doc.plant}; use a new material code.` });
  }
  for (const [i, w] of (doc.instructions ?? []).entries())
    if (await SELECT.one.from(Instructions).columns('ID').where({ instructionId: w.instructionId, version: w.version, plant: doc.plant }))
      errors.push({ path: `instructions[${i}].instructionId`, code: 'ALREADY_EXISTS', message: `Instruction ${w.instructionId} v${w.version} already exists in plant ${doc.plant}.` });
  return errors;
}

/** Rows to insert, keyed by entity; IDs are fresh UUIDs, provenance points to the batch. */
function plan(doc, batchID) {
  const id = () => cds.utils.uuid();
  const ref = path => `DEMO-IMPORT/${batchID}/${path}`;
  const code = doc.assembly.assemblyCode, plant = doc.plant;
  const assemblyID = id(), state = { A: id(), B: id() };
  const rows = { Assemblies: [], BOMStates: [], BOMItems: [], CostPrices: [], StockSnapshots: [], Instructions: [], InstructionReferences: [], ReviewCases: [] };
  rows.Assemblies.push({ ID: assemblyID, assemblyCode: code, plant, description: `${doc.assembly.description} [SYNTHETIC DEMO IMPORT ${batchID.slice(0, 8)}]`, version: id() });
  const unitOf = Object.fromEntries(doc.materials.map(m => [m.material, m.unit]));
  for (const rev of ['A', 'B']) {
    const r = doc.revisions[rev];
    rows.BOMStates.push({ ID: state[rev], stateKey: `BOM-${code}-${rev}`, assembly_ID: assemblyID, plant, bomUsage: '1', alternative: '01', revision: rev,
      validFrom: r.validFrom, validTo: r.validTo, status: rev === 'A' ? 'RELEASED' : 'PROPOSED', changeNumber: rev === 'B' ? doc.reviewCase.caseNumber : null,
      sourceType: 'DEMO_IMPORT', evidenceRef: ref(`bom_states/BOM-${code}-${rev}`) });
    for (const it of r.items) rows.BOMItems.push({ ID: id(), bomState_ID: state[rev], itemNo: it.itemNo, material: it.material, quantity: it.quantity,
      unit: unitOf[it.material], evidenceRef: ref(`bom_items/BOM-${code}-${rev}/${it.itemNo}`) });
  }
  for (const m of doc.materials) {
    if (m.price !== null && m.price !== undefined) rows.CostPrices.push({ ID: id(), material: m.material, plant, price: m.price, currency: 'EUR', priceUnit: 1, unit: m.unit,
      priceBasis: 'SYNTHETIC_STANDARD_PRICE', validFrom: doc.revisions.A.validFrom, validTo: '9999-12-31', sourceType: 'DEMO_IMPORT', evidenceRef: ref(`cost_prices/${m.material}`) });
    rows.StockSnapshots.push({ ID: id(), material: m.material, plant, availableQuantity: m.stock, unit: m.unit, snapshotAt: m.snapshotAt,
      sourceType: 'DEMO_IMPORT', evidenceRef: ref(`stock_snapshots/${m.material}`) });
  }
  for (const w of doc.instructions ?? []) {
    const wid = id();
    rows.Instructions.push({ ID: wid, instructionId: w.instructionId, version: w.version, assembly_ID: assemblyID, plant, title: w.title,
      appliesToRevision: w.appliesToRevision || null, status: w.status, validFrom: w.validFrom, sourceType: 'DEMO_IMPORT', evidenceRef: ref(`instructions/${w.instructionId}/v${w.version}`) });
    for (const s of w.steps ?? []) rows.InstructionReferences.push({ ID: id(), instruction_ID: wid, step: s.step, material: s.material,
      quantity: s.quantity ?? null, unit: s.quantity ? unitOf[s.material] : null, text: s.text ?? null });
  }
  const c = doc.reviewCase;
  rows.ReviewCases.push({ ID: id(), caseNumber: c.caseNumber, title: c.title, assembly_ID: assemblyID, plant, fromState_ID: state.A, toState_ID: state.B,
    productionQuantity: c.productionQuantity, status: 'OPEN', owner: c.owner ?? null, sourceType: 'DEMO_IMPORT', evidenceRef: ref(`review_cases/${c.caseNumber}`), version: id() });
  return rows;
}

const preview = (doc, rows) => [
  { kind: 'Assembly', recordKey: `${doc.assembly.assemblyCode} / plant ${doc.plant}`, details: doc.assembly.description },
  ...['A', 'B'].map(rev => ({ kind: 'BOM revision', recordKey: `BOM-${doc.assembly.assemblyCode}-${rev}`,
    details: `${doc.revisions[rev].items.length} item(s), valid ${doc.revisions[rev].validFrom} to ${doc.revisions[rev].validTo}` })),
  ...doc.materials.map(m => ({ kind: 'Material', recordKey: m.material,
    details: `${m.description}; price ${m.price === null || m.price === undefined ? 'not maintained' : `${m.price} EUR/${m.unit}`}; stock ${m.stock} ${m.unit}` })),
  ...(doc.instructions ?? []).map(w => ({ kind: 'Instruction', recordKey: `${w.instructionId} v${w.version}`, details: `${w.title} (${(w.steps ?? []).length} step(s))` })),
  { kind: 'Review case', recordKey: doc.reviewCase.caseNumber, details: `${doc.reviewCase.title}; quantity ${doc.reviewCase.productionQuantity}; status OPEN` },
  { kind: 'Totals', recordKey: 'records', details: Object.entries(rows).map(([e, r]) => `${e} ${r.length}`).join(', ') },
];

/** Validates without writing. Result: { ok, errors[], records[], plant, caseNumber, sha256 }. */
export async function validateDemoImport({ content, plants }) {
  const result = { ok: false, errors: [], records: [], plant: null, caseNumber: null, sha256: null };
  if (typeof content !== 'string' || !content.length) { result.errors.push({ path: '', code: 'EMPTY_FILE', message: 'The file is empty.' }); return result; }
  if (Buffer.byteLength(content, 'utf8') > MAX_BYTES) { result.errors.push({ path: '', code: 'FILE_TOO_LARGE', message: `The file exceeds ${MAX_BYTES / 1024} KB.` }); return result; }
  result.sha256 = createHash('sha256').update(content).digest('hex');
  let doc;
  try { doc = JSON.parse(content); } catch (e) { result.errors.push({ path: '', code: 'INVALID_JSON', message: `Not valid JSON: ${e.message.slice(0, 120)}` }); return result; }
  result.errors.push(...checkStructure(doc, { plants }));
  if (result.errors.length) return result;
  result.errors.push(...await checkConflicts(doc));
  result.plant = doc.plant; result.caseNumber = doc.reviewCase.caseNumber;
  if (result.errors.length) return result;
  result.records = preview(doc, plan(doc, '00000000-0000-0000-0000-000000000000'));
  result.ok = true;
  result.doc = doc;
  return result;
}

/** Re-validates and writes everything (caller's transaction). Returns the validation result plus batchID. */
export async function commitDemoImport({ content, fileName, plants, user, now = new Date().toISOString() }) {
  const result = await validateDemoImport({ content, plants });
  if (!result.ok) return result;
  const batchID = cds.utils.uuid();
  const rows = plan(result.doc, batchID);
  const E = cds.entities('assemblyimpact');
  for (const [entity, list] of Object.entries(rows)) if (list.length) await INSERT.into(E[entity]).entries(list);
  await INSERT.into(E.ImportBatches).entries({ ID: batchID, fileName: (fileName || 'upload.json').slice(0, 120), sha256: result.sha256, plant: result.doc.plant,
    caseNumber: result.doc.reviewCase.caseNumber, label: result.doc.label, importedBy: user, importedAt: now,
    recordCounts: Object.entries(rows).map(([e, r]) => `${e}=${r.length}`).join(';') });
  result.records = preview(result.doc, rows);
  result.batchID = batchID;
  return result;
}

/** Removes exactly one demo batch (rollback). Refused once the case has review decisions (history is kept). */
export async function purgeDemoImport({ batchID, plants }) {
  const E = cds.entities('assemblyimpact');
  const batch = await SELECT.one.from(E.ImportBatches).where({ ID: batchID, plant: { in: plants } });
  if (!batch) return { status: 404 };
  const prefix = `DEMO-IMPORT/${batchID}/`;
  const reviewCase = await SELECT.one.from(E.ReviewCases).columns('ID', 'assembly_ID').where({ caseNumber: batch.caseNumber, evidenceRef: { like: `${prefix}%` } });
  if (reviewCase && await SELECT.one.from(E.DecisionEvents).columns('ID').where({ reviewCase_ID: reviewCase.ID }))
    return { status: 409, code: 'HAS_DECISIONS', message: 'The imported case already has review decisions; the batch is kept for the audit trail.' };
  if (reviewCase) {
    const runs = (await SELECT.from(E.ImpactRuns).columns('ID').where({ reviewCase_ID: reviewCase.ID })).map(r => r.ID);
    await UPDATE(E.ReviewCases).set({ latestRun_ID: null }).where({ ID: reviewCase.ID });
    if (runs.length) {
      for (const child of ['Findings', 'ImpactMaterialLines', 'ImpactComparisonLines', 'ImpactInstructionLines']) if (E[child]) await DELETE.from(E[child]).where({ run_ID: { in: runs } });
      await DELETE.from(E.ImpactRuns).where({ ID: { in: runs } });
    }
    await DELETE.from(E.ReviewCases).where({ ID: reviewCase.ID });
  }
  const instr = (await SELECT.from(E.Instructions).columns('ID').where({ evidenceRef: { like: `${prefix}%` } })).map(r => r.ID);
  if (instr.length) await DELETE.from(E.InstructionReferences).where({ instruction_ID: { in: instr } });
  for (const name of ['Instructions', 'StockSnapshots', 'CostPrices', 'BOMItems', 'BOMStates']) await DELETE.from(E[name]).where({ evidenceRef: { like: `${prefix}%` } });
  if (reviewCase) await DELETE.from(E.Assemblies).where({ ID: reviewCase.assembly_ID });
  await DELETE.from(E.ImportBatches).where({ ID: batchID });
  return { status: 200 };
}
