// M05: controlled import of synthetic demonstration scenarios (and, later, mapped ERP extracts).
// parseImport() turns a JSON or CSV file into a bundle, validateBundle() checks it completely
// without writing, commitBundle() persists a validated bundle in the caller's transaction.
// Nothing here computes impact results: imported cases start OPEN without runs.
import cds from '@sap/cds';
import { createHash } from 'node:crypto';
import { calculateImpact, ImpactRejection } from './impact-calculator.js';
import { Exact } from './exact.js';

export const IMPORT_LIMITS = Object.freeze({ maxBytes: 512 * 1024, maxRecords: 2000, maxErrors: 200 });

/** Record types, their fields (required marked with !) and the CAP entity they create. */
export const RECORD_TYPES = Object.freeze({
  assemblies: ['assemblyCode!', 'plant!', 'description!'],
  bomStates: ['stateKey!', 'assemblyCode!', 'plant!', 'bomUsage!', 'alternative!', 'revision!', 'validFrom!', 'validTo!', 'status!', 'changeNumber'],
  bomItems: ['stateKey!', 'itemNo!', 'material!', 'quantity!', 'unit!'],
  costPrices: ['material!', 'plant!', 'price!', 'currency!', 'priceUnit!', 'unit!', 'priceBasis', 'validFrom!', 'validTo!'],
  stockSnapshots: ['material!', 'plant!', 'availableQuantity!', 'unit!', 'snapshotAt!'],
  instructions: ['instructionId!', 'version!', 'assemblyCode!', 'plant!', 'title!', 'appliesToRevision', 'status!', 'validFrom!'],
  instructionReferences: ['instructionId!', 'version!', 'step!', 'material!', 'quantity', 'unit', 'text'],
  reviewCases: ['caseNumber!', 'title!', 'assemblyCode!', 'plant!', 'fromStateKey!', 'toStateKey!', 'productionQuantity!', 'owner'],
});
const fieldsOf = type => RECORD_TYPES[type].map(f => f.replace('!', ''));
const requiredOf = type => RECORD_TYPES[type].filter(f => f.endsWith('!')).map(f => f.slice(0, -1));
/** Union header of the single-table CSV format: recordType first, then every field once. */
export const CSV_COLUMNS = Object.freeze(['recordType', ...new Set(Object.keys(RECORD_TYPES).flatMap(fieldsOf))]);

const ALLOWED_STATE_STATUS = ['RELEASED', 'PROPOSED', 'OBSOLETE'];
const ALLOWED_INSTRUCTION_STATUS = ['RELEASED', 'SUPERSEDED', 'DRAFT'];
const RE = {
  code: /^[A-Z0-9][A-Z0-9._/-]{0,39}$/,
  plant: /^[A-Z0-9]{4}$/,
  unit: /^[A-Z]{1,3}$/,
  currency: /^[A-Z]{3}$/,
  revision: /^[A-Z0-9]{1,10}$/,
  itemNo: /^\d{4}$/,
  date: /^\d{4}-\d{2}-\d{2}$/,
  timestamp: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/,
  caseNumber: /^[A-Z]{2,4}-[0-9A-Z-]{3,15}$/,
};

export class ImportFormatError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// ------------------------------------------------------------ parsing

/** RFC 4180 CSV (quoted fields, doubled quotes, CRLF/LF). Returns rows of strings. */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false, i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 2; continue; }
      if (ch === '"') { quoted = false; i++; continue; }
      field += ch; i++; continue;
    }
    if (ch === '"' && field === '') { quoted = true; i++; continue; }
    if (ch === ',') { row.push(field); field = ''; i++; continue; }
    if (ch === '\r' && text[i + 1] === '\n') i++;
    if (ch === '\n' || ch === '\r') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += ch; i++;
  }
  if (quoted) throw new ImportFormatError('CSV_UNTERMINATED_QUOTE', 'The CSV file has an unterminated quoted field.');
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

/** Parses the uploaded text into { meta, records: { type: [ {..., _line} ] } }. */
export function parseImport(content, format) {
  if (typeof content !== 'string' || !content.trim()) throw new ImportFormatError('EMPTY_FILE', 'The file is empty.');
  if (Buffer.byteLength(content, 'utf8') > IMPORT_LIMITS.maxBytes) {
    throw new ImportFormatError('FILE_TOO_LARGE', `The file exceeds ${IMPORT_LIMITS.maxBytes / 1024} KB.`);
  }
  const fmt = String(format ?? '').toLowerCase();
  const records = Object.fromEntries(Object.keys(RECORD_TYPES).map(t => [t, []]));
  let meta = {};
  if (fmt === 'json') {
    let data;
    try { data = JSON.parse(content); } catch (e) { throw new ImportFormatError('JSON_SYNTAX', `The JSON file cannot be parsed: ${e.message}`); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ImportFormatError('JSON_STRUCTURE', 'The JSON file must contain one object.');
    const unknown = Object.keys(data).filter(k => !(k in RECORD_TYPES) && !['datasetId', 'synthetic', 'description', 'source'].includes(k));
    if (unknown.length) throw new ImportFormatError('UNKNOWN_SECTION', `Unknown section(s): ${unknown.join(', ')}.`);
    meta = { datasetId: data.datasetId, synthetic: data.synthetic, description: data.description, source: data.source };
    for (const type of Object.keys(RECORD_TYPES)) {
      if (data[type] === undefined) continue;
      if (!Array.isArray(data[type])) throw new ImportFormatError('JSON_STRUCTURE', `Section ${type} must be an array.`);
      data[type].forEach((r, index) => records[type].push({ ...(r && typeof r === 'object' && !Array.isArray(r) ? r : { _invalid: true }), _line: `${type}[${index}]` }));
    }
  } else if (fmt === 'csv') {
    const rows = parseCsv(content.replace(/^\uFEFF/, ''));
    if (!rows.length) throw new ImportFormatError('EMPTY_FILE', 'The file is empty.');
    const header = rows[0].map(h => h.trim());
    if (header[0] !== 'recordType') throw new ImportFormatError('CSV_HEADER', 'The first CSV column must be recordType.');
    const unknown = header.filter(h => !CSV_COLUMNS.includes(h));
    if (unknown.length) throw new ImportFormatError('CSV_HEADER', `Unknown CSV column(s): ${unknown.join(', ')}.`);
    if (new Set(header).size !== header.length) throw new ImportFormatError('CSV_HEADER', 'The CSV header repeats a column.');
    rows.slice(1).forEach((cells, index) => {
      const line = index + 2;
      if (cells.length !== header.length) {
        records._malformed ??= [];
        records._malformed.push({ _line: `line ${line}`, cells: cells.length, expected: header.length });
        return;
      }
      const raw = Object.fromEntries(header.map((h, i) => [h, cells[i].trim()]));
      const type = raw.recordType;
      const record = { _line: `line ${line}` };
      for (const f of header.slice(1)) if (raw[f] !== '') record[f] = raw[f];
      if (!(type in RECORD_TYPES)) { (records._unknownType ??= []).push({ ...record, recordType: type }); return; }
      for (const f of header.slice(1)) if (raw[f] !== '' && !fieldsOf(type).includes(f)) (record._foreign ??= []).push(f);
      records[type].push(record);
    });
  } else {
    throw new ImportFormatError('UNSUPPORTED_FORMAT', 'Supported formats are JSON and CSV.');
  }
  const total = Object.keys(RECORD_TYPES).reduce((n, t) => n + records[t].length, 0);
  if (total > IMPORT_LIMITS.maxRecords) throw new ImportFormatError('TOO_MANY_RECORDS', `The file contains more than ${IMPORT_LIMITS.maxRecords} records.`);
  const rejected = (records._malformed?.length ?? 0) + (records._unknownType?.length ?? 0);
  if (!total && !rejected) throw new ImportFormatError('NO_RECORDS', 'The file contains no records.');
  return { meta, records };
}

// ------------------------------------------------------------ validation

const str = v => (v === undefined || v === null ? '' : String(v).trim());
const isDate = v => RE.date.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);
function decimal(v, { scale, intDigits, min, allowZero }) {
  const s = str(v);
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const [int, frac = ''] = s.replace('-', '').split('.');
  if (frac.length > scale || int.replace(/^0+(?=\d)/, '').length > intDigits) return null;
  const x = Exact.of(s);
  if (x.cmp(min) < 0 || (!allowZero && x.isZero())) return null;
  return x.toPlain();
}

/**
 * Validates a parsed bundle against field rules, cross-references, the user's plants and the
 * existing database. Returns { errors, plan, preview, counts } where plan holds normalised rows.
 * `existing` lets callers inject lookups (tests); default reads the database.
 */
export async function validateBundle(parsed, { plants, sourceType = 'DEMO_IMPORT' } = {}) {
  const errors = [];
  const err = (record, field, code, message) => { if (errors.length < IMPORT_LIMITS.maxErrors) errors.push({ line: record?._line ?? null, field: field ?? null, code, message }); };
  const { records } = parsed;
  for (const m of records._malformed ?? []) err(m, null, 'CSV_COLUMN_COUNT', `Row has ${m.cells} values; ${m.expected} expected.`);
  for (const u of records._unknownType ?? []) err(u, 'recordType', 'UNKNOWN_RECORD_TYPE', `Unknown record type "${u.recordType ?? ''}".`);

  // 1) per-record field checks and normalisation
  const plan = Object.fromEntries(Object.keys(RECORD_TYPES).map(t => [t, []]));
  for (const type of Object.keys(RECORD_TYPES)) {
    for (const r of records[type]) {
      if (r._invalid) { err(r, null, 'INVALID_RECORD', 'Record must be an object.'); continue; }
      const extra = Object.keys(r).filter(k => k !== '_line' && k !== '_foreign' && !fieldsOf(type).includes(k));
      for (const f of [...extra, ...(r._foreign ?? [])]) err(r, f, 'UNKNOWN_FIELD', `Field ${f} is not allowed for ${type}.`);
      let ok = true;
      for (const f of requiredOf(type)) if (!str(r[f])) { err(r, f, 'REQUIRED', `${f} is required.`); ok = false; }
      if (!ok) continue;
      const n = normalise(type, r, (f, code, msg) => { err(r, f, code, msg); ok = false; });
      if (ok) plan[type].push({ ...n, _line: r._line });
    }
  }

  // 2) plants: one plant per import, and it must be one of the user's plants
  const filePlants = [...new Set(Object.values(plan).flat().map(r => r.plant).filter(Boolean))];
  if (filePlants.length > 1) err(null, 'plant', 'MULTIPLE_PLANTS', `One import may contain one plant only; found ${filePlants.join(', ')}.`);
  for (const p of filePlants) if (!plants?.includes(p)) err(null, 'plant', 'PLANT_NOT_AUTHORIZED', `You are not authorized for plant ${p}.`);
  const plant = filePlants[0] ?? null;

  // 3) duplicates within the file
  const dup = (type, keyOf, label) => {
    const seen = new Map();
    for (const r of plan[type]) {
      const k = keyOf(r);
      if (seen.has(k)) err(r, null, 'DUPLICATE_RECORD', `Duplicate ${label} ${k} (also ${seen.get(k)}).`); else seen.set(k, r._line);
    }
  };
  dup('assemblies', r => `${r.assemblyCode}/${r.plant}`, 'assembly');
  dup('bomStates', r => r.stateKey, 'BOM state');
  dup('bomItems', r => `${r.stateKey}/${r.itemNo}`, 'BOM item');
  dup('costPrices', r => `${r.material}/${r.plant}/${r.validFrom}`, 'price');
  dup('stockSnapshots', r => `${r.material}/${r.plant}/${r.snapshotAt}`, 'stock snapshot');
  dup('instructions', r => `${r.instructionId}/${r.version}/${r.plant}`, 'instruction');
  dup('instructionReferences', r => `${r.instructionId}/${r.version}/${r.step}`, 'instruction step');
  dup('reviewCases', r => r.caseNumber, 'case number');

  // 4) references inside the file
  const assemblies = new Map(plan.assemblies.map(a => [`${a.assemblyCode}/${a.plant}`, a]));
  const states = new Map(plan.bomStates.map(s => [s.stateKey, s]));
  const instructions = new Map(plan.instructions.map(i => [`${i.instructionId}/${i.version}`, i]));
  for (const s of plan.bomStates) if (!assemblies.has(`${s.assemblyCode}/${s.plant}`)) err(s, 'assemblyCode', 'UNKNOWN_ASSEMBLY', `Assembly ${s.assemblyCode} (plant ${s.plant}) is not in the file.`);
  for (const i of plan.bomItems) if (!states.has(i.stateKey)) err(i, 'stateKey', 'UNKNOWN_BOM_STATE', `BOM state ${i.stateKey} is not in the file.`);
  for (const s of plan.bomStates) if (!plan.bomItems.some(i => i.stateKey === s.stateKey)) err(s, 'stateKey', 'EMPTY_BOM', `BOM state ${s.stateKey} has no items.`);
  for (const i of plan.instructions) if (!assemblies.has(`${i.assemblyCode}/${i.plant}`)) err(i, 'assemblyCode', 'UNKNOWN_ASSEMBLY', `Assembly ${i.assemblyCode} (plant ${i.plant}) is not in the file.`);
  for (const r of plan.instructionReferences) if (!instructions.has(`${r.instructionId}/${r.version}`)) err(r, 'instructionId', 'UNKNOWN_INSTRUCTION', `Instruction ${r.instructionId} v${r.version} is not in the file.`);
  for (const c of plan.reviewCases) {
    if (!assemblies.has(`${c.assemblyCode}/${c.plant}`)) err(c, 'assemblyCode', 'UNKNOWN_ASSEMBLY', `Assembly ${c.assemblyCode} (plant ${c.plant}) is not in the file.`);
    for (const f of ['fromStateKey', 'toStateKey']) {
      const s = states.get(c[f]);
      if (!s) err(c, f, 'UNKNOWN_BOM_STATE', `BOM state ${c[f]} is not in the file.`);
      else if (s.assemblyCode !== c.assemblyCode || s.plant !== c.plant) err(c, f, 'CASE_BOM_MISMATCH', `BOM state ${c[f]} belongs to ${s.assemblyCode}/${s.plant}.`);
    }
    if (c.fromStateKey === c.toStateKey) err(c, 'toStateKey', 'SAME_BOM_STATE', 'Current and proposed BOM states must differ.');
  }
  if (!plan.reviewCases.length && !errors.length) err(null, null, 'NO_REVIEW_CASE', 'The file must contain at least one review case.');

  // 5) price periods must not overlap per material and plant (file + database)
  const { CostPrices, Assemblies, BOMStates, ReviewCases, Instructions, StockSnapshots } = cds.entities('assemblyimpact');
  const materials = [...new Set(plan.costPrices.map(p => p.material))];
  const dbPrices = materials.length && plant ? await SELECT.from(CostPrices).columns('material', 'validFrom', 'validTo').where({ plant, material: { in: materials } }) : [];
  for (const p of plan.costPrices) {
    const day = v => String(v).slice(0, 10);
    const overlaps = [...dbPrices.map(d => ({ ...d, _line: 'database' })), ...plan.costPrices.filter(o => o !== p)]
      .filter(o => o.material === p.material && day(o.validFrom) <= p.validTo && p.validFrom <= day(o.validTo));
    if (overlaps.length) err(p, 'validFrom', 'OVERLAPPING_PRICE', `Price for ${p.material} overlaps another price (${overlaps[0]._line}).`);
  }

  // 6) no overwrite of existing records (imports only add data)
  if (plant) {
    const exists = async (entity, where) => !!(await SELECT.one.from(entity).columns('ID').where(where));
    for (const a of plan.assemblies) if (await exists(Assemblies, { assemblyCode: a.assemblyCode, plant: a.plant })) err(a, 'assemblyCode', 'ALREADY_EXISTS', `Assembly ${a.assemblyCode} already exists in plant ${a.plant}.`);
    for (const s of plan.bomStates) if (await exists(BOMStates, { stateKey: s.stateKey })) err(s, 'stateKey', 'ALREADY_EXISTS', `BOM state ${s.stateKey} already exists.`);
    for (const c of plan.reviewCases) if (await exists(ReviewCases, { caseNumber: c.caseNumber })) err(c, 'caseNumber', 'ALREADY_EXISTS', `Review case ${c.caseNumber} already exists.`);
    for (const i of plan.instructions) if (await exists(Instructions, { instructionId: i.instructionId, version: i.version, plant: i.plant })) err(i, 'instructionId', 'ALREADY_EXISTS', `Instruction ${i.instructionId} v${i.version} already exists.`);
    for (const s of plan.stockSnapshots) if (await exists(StockSnapshots, { material: s.material, plant: s.plant, snapshotAt: s.snapshotAt })) err(s, 'snapshotAt', 'ALREADY_EXISTS', `Stock snapshot ${s.material} at ${s.snapshotAt} already exists.`);
  }

  // 7) each case must be calculable in principle (same rules the engine applies; nothing is stored)
  if (!errors.length) {
    for (const c of plan.reviewCases) {
      try {
        calculateImpact({ asOfDate: plan.bomStates.find(s => s.stateKey === c.toStateKey).validFrom,
          reviewCase: { caseNumber: c.caseNumber, assemblyCode: c.assemblyCode, plant: c.plant, fromStateKey: c.fromStateKey, toStateKey: c.toStateKey, productionQuantity: c.productionQuantity },
          bomStates: plan.bomStates, bomItems: plan.bomItems, costPrices: plan.costPrices, stockSnapshots: plan.stockSnapshots,
          instructions: plan.instructions, instructionReferences: plan.instructionReferences });
      } catch (e) {
        if (e instanceof ImpactRejection) err(c, null, `NOT_CALCULABLE_${e.code}`, `Case ${c.caseNumber} cannot be calculated: ${e.code} (${e.detail}).`);
        else throw e;
      }
    }
  }

  const counts = Object.fromEntries(Object.keys(RECORD_TYPES).map(t => [t, plan[t].length]));
  const preview = plan.reviewCases.map(c => {
    const from = states.get(c.fromStateKey), to = states.get(c.toStateKey);
    return { caseNumber: c.caseNumber, title: c.title, assemblyCode: c.assemblyCode, plant: c.plant,
      fromRevision: from?.revision ?? null, toRevision: to?.revision ?? null, productionQuantity: c.productionQuantity,
      fromItems: plan.bomItems.filter(i => i.stateKey === c.fromStateKey).length,
      toItems: plan.bomItems.filter(i => i.stateKey === c.toStateKey).length };
  });
  return { errors, plan, preview, counts, plant, sourceType };
}

function normalise(type, r, bad) {
  const out = {};
  const code = (f, re = RE.code) => { const v = str(r[f]).toUpperCase(); if (!re.test(v)) bad(f, 'INVALID_CODE', `${f} "${str(r[f])}" has an invalid format.`); return v; };
  const text = (f, max) => { const v = str(r[f]); if (v.length > max) bad(f, 'TOO_LONG', `${f} must not exceed ${max} characters.`); return v || null; };
  const date = f => { const v = str(r[f]); if (!isDate(v)) bad(f, 'INVALID_DATE', `${f} "${v}" is not a valid date (YYYY-MM-DD).`); return v; };
  const dec = (f, opts) => { const v = decimal(r[f], opts); if (v === null) bad(f, 'INVALID_NUMBER', `${f} "${str(r[f])}" must be a number ${opts.allowZero ? '>= 0' : '> 0'} with at most ${opts.scale} decimals.`); return v; };
  const int = (f, min, max) => { const v = str(r[f]); const n = Number(v); if (!/^\d+$/.test(v) || n < min || n > max) bad(f, 'INVALID_INTEGER', `${f} must be a whole number between ${min} and ${max}.`); return n; };
  const oneOf = (f, list) => { const v = str(r[f]).toUpperCase(); if (!list.includes(v)) bad(f, 'INVALID_VALUE', `${f} must be one of ${list.join(', ')}.`); return v; };
  const period = (from, to) => { if (out[from] && out[to] && isDate(out[from]) && isDate(out[to]) && out[from] > out[to]) bad(to, 'INVALID_PERIOD', `${to} is before ${from}.`); };
  switch (type) {
    case 'assemblies':
      out.assemblyCode = code('assemblyCode'); out.plant = code('plant', RE.plant); out.description = text('description', 120); break;
    case 'bomStates':
      out.stateKey = code('stateKey'); out.assemblyCode = code('assemblyCode'); out.plant = code('plant', RE.plant);
      out.bomUsage = code('bomUsage', /^[0-9A-Z]$/); out.alternative = code('alternative', /^[0-9]{2}$/);
      out.revision = code('revision', RE.revision); out.validFrom = date('validFrom'); out.validTo = date('validTo'); period('validFrom', 'validTo');
      out.status = oneOf('status', ALLOWED_STATE_STATUS); out.changeNumber = str(r.changeNumber) ? code('changeNumber') : null; break;
    case 'bomItems':
      out.stateKey = code('stateKey'); out.itemNo = code('itemNo', RE.itemNo); out.material = code('material');
      out.quantity = dec('quantity', { scale: 3, intDigits: 10, min: 0 }); out.unit = code('unit', RE.unit); break;
    case 'costPrices':
      out.material = code('material'); out.plant = code('plant', RE.plant);
      out.price = dec('price', { scale: 4, intDigits: 11, min: 0, allowZero: true }); out.currency = code('currency', RE.currency);
      out.priceUnit = int('priceUnit', 1, 10000); out.unit = code('unit', RE.unit);
      out.priceBasis = str(r.priceBasis) ? text('priceBasis', 30).toUpperCase() : 'IMPORTED_DEMO_PRICE';
      out.validFrom = date('validFrom'); out.validTo = date('validTo'); period('validFrom', 'validTo'); break;
    case 'stockSnapshots': {
      out.material = code('material'); out.plant = code('plant', RE.plant);
      out.availableQuantity = dec('availableQuantity', { scale: 3, intDigits: 10, min: 0, allowZero: true }); out.unit = code('unit', RE.unit);
      const ts = str(r.snapshotAt);
      if (!RE.timestamp.test(ts) || Number.isNaN(Date.parse(ts))) bad('snapshotAt', 'INVALID_TIMESTAMP', `snapshotAt "${ts}" must be an ISO timestamp with time zone.`);
      else if (Date.parse(ts) > Date.now() + 86_400_000) bad('snapshotAt', 'FUTURE_TIMESTAMP', 'snapshotAt must not be in the future.');
      else out.snapshotAt = new Date(ts).toISOString();
      break;
    }
    case 'instructions':
      out.instructionId = code('instructionId'); out.version = int('version', 1, 9999); out.assemblyCode = code('assemblyCode');
      out.plant = code('plant', RE.plant); out.title = text('title', 160);
      out.appliesToRevision = str(r.appliesToRevision) ? code('appliesToRevision', RE.revision) : null;
      out.status = oneOf('status', ALLOWED_INSTRUCTION_STATUS); out.validFrom = date('validFrom'); break;
    case 'instructionReferences':
      out.instructionId = code('instructionId'); out.version = int('version', 1, 9999); out.step = code('step', RE.itemNo); out.material = code('material');
      out.quantity = str(r.quantity) ? dec('quantity', { scale: 3, intDigits: 10, min: 0 }) : null;
      out.unit = str(r.unit) ? code('unit', RE.unit) : null; out.text = text('text', 200); break;
    case 'reviewCases':
      out.caseNumber = code('caseNumber', RE.caseNumber); out.title = text('title', 160); out.assemblyCode = code('assemblyCode');
      out.plant = code('plant', RE.plant); out.fromStateKey = code('fromStateKey'); out.toStateKey = code('toStateKey');
      out.productionQuantity = int('productionQuantity', 1, 1_000_000); out.owner = text('owner', 80); break;
  }
  return out;
}

// ------------------------------------------------------------ persistence

export const checksum = content => `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`;

/**
 * Inserts a validated plan (validateBundle result without errors) in the caller's transaction.
 * Every row gets sourceType and an evidence reference IMPORT:<importId>/...; the DataImports row
 * records file, checksum, user and counts. Any failure propagates and rolls the whole import back.
 */
export async function commitBundle(validated, { importId, user, fileName, format, content, meta, now = new Date().toISOString() }) {
  const E = cds.entities('assemblyimpact');
  const { plan, plant, sourceType } = validated;
  const id = () => cds.utils.uuid();
  const ev = path => `IMPORT:${importId}/${path}`.slice(0, 200);
  await INSERT.into(E.DataImports).entries({ ID: importId, plant, datasetId: str(meta?.datasetId).slice(0, 40) || null,
    fileName: str(fileName).slice(0, 120) || null, format, checksum: checksum(content), sourceType,
    source: str(meta?.source).slice(0, 200) || null, importedBy: user, importedAt: now,
    counts: JSON.stringify(validated.counts) });

  const assemblyIds = new Map();
  for (const a of plan.assemblies) {
    const ID = id(); assemblyIds.set(`${a.assemblyCode}/${a.plant}`, ID);
    await INSERT.into(E.Assemblies).entries({ ID, assemblyCode: a.assemblyCode, plant: a.plant,
      description: `${a.description} [${sourceType === 'S4_IMPORT' ? 'ERP extract' : 'imported demo data'}]`.slice(0, 160), version: id() });
  }
  const stateIds = new Map();
  for (const s of plan.bomStates) {
    const ID = id(); stateIds.set(s.stateKey, ID);
    await INSERT.into(E.BOMStates).entries({ ID, stateKey: s.stateKey, assembly_ID: assemblyIds.get(`${s.assemblyCode}/${s.plant}`), plant: s.plant,
      bomUsage: s.bomUsage, alternative: s.alternative, revision: s.revision, validFrom: s.validFrom, validTo: s.validTo,
      status: s.status, changeNumber: s.changeNumber, sourceType, evidenceRef: ev(`bom_states/${s.stateKey}`) });
  }
  if (plan.bomItems.length) await INSERT.into(E.BOMItems).entries(plan.bomItems.map(i => ({ ID: id(), bomState_ID: stateIds.get(i.stateKey),
    itemNo: i.itemNo, material: i.material, quantity: i.quantity, unit: i.unit, evidenceRef: ev(`bom_items/${i.stateKey}/${i.itemNo}`) })));
  if (plan.costPrices.length) await INSERT.into(E.CostPrices).entries(plan.costPrices.map(p => ({ ID: id(), material: p.material, plant: p.plant,
    price: p.price, currency: p.currency, priceUnit: p.priceUnit, unit: p.unit, priceBasis: p.priceBasis, validFrom: p.validFrom,
    validTo: p.validTo, sourceType, evidenceRef: ev(`cost_prices/${p.material}/${p.validFrom}`) })));
  if (plan.stockSnapshots.length) await INSERT.into(E.StockSnapshots).entries(plan.stockSnapshots.map(s => ({ ID: id(), material: s.material,
    plant: s.plant, availableQuantity: s.availableQuantity, unit: s.unit, snapshotAt: s.snapshotAt, sourceType,
    evidenceRef: ev(`stock_snapshots/${s.material}/${s.snapshotAt}`) })));
  const instructionIds = new Map();
  for (const i of plan.instructions) {
    const ID = id(); instructionIds.set(`${i.instructionId}/${i.version}`, ID);
    await INSERT.into(E.Instructions).entries({ ID, instructionId: i.instructionId, version: i.version,
      assembly_ID: assemblyIds.get(`${i.assemblyCode}/${i.plant}`), plant: i.plant, title: i.title, appliesToRevision: i.appliesToRevision,
      status: i.status, validFrom: i.validFrom, sourceType, evidenceRef: ev(`instructions/${i.instructionId}/v${i.version}`) });
  }
  if (plan.instructionReferences.length) await INSERT.into(E.InstructionReferences).entries(plan.instructionReferences.map(r => ({ ID: id(),
    instruction_ID: instructionIds.get(`${r.instructionId}/${r.version}`), step: r.step, material: r.material, quantity: r.quantity, unit: r.unit, text: r.text })));
  const caseIds = [];
  for (const c of plan.reviewCases) {
    const ID = id(); caseIds.push(ID);
    await INSERT.into(E.ReviewCases).entries({ ID, caseNumber: c.caseNumber, title: c.title, assembly_ID: assemblyIds.get(`${c.assemblyCode}/${c.plant}`),
      plant: c.plant, fromState_ID: stateIds.get(c.fromStateKey), toState_ID: stateIds.get(c.toStateKey), productionQuantity: c.productionQuantity,
      status: 'OPEN', owner: c.owner, sourceType, evidenceRef: ev(`review_cases/${c.caseNumber}`), version: id(), sourceImport_ID: importId });
  }
  return { caseIds };
}
