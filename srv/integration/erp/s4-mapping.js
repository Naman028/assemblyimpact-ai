// P2: typed mapping from SAP S/4HANA OData V2 API payloads to the AssemblyImpact import bundle
// (the same bundle that lib/scenario-import.js validates). Pure functions, no I/O.
//
// API contracts (verified against the SAP Cloud SDK VDM 2.1.0 type definitions, which are generated
// from the published API metadata; re-verify against the target system's $metadata before go-live):
//   API_BILL_OF_MATERIAL_SRV  A_BillOfMaterial (BillOfMaterial, BillOfMaterialCategory, BillOfMaterialVariant,
//     BillOfMaterialVariantUsage, Material, Plant, HeaderValidityStartDate, HeaderValidityEndDate,
//     EngineeringChangeDocument, BOMHeaderBaseUnit, BOMHeaderQuantityInBaseUnit), navigation to_BillOfMaterialItem
//   A_BillOfMaterialItem (BillOfMaterialItemNumber, BillOfMaterialComponent, BillOfMaterialItemQuantity,
//     BillOfMaterialItemUnit, ValidityStartDate, ValidityEndDate, EngineeringChangeDocument, ChgToEngineeringChgDocument)
//   API_MATERIAL_STOCK_SRV    A_MatlStkInAcctMod (Material, Plant, StorageLocation, InventoryStockType,
//     InventorySpecialStockType, MaterialBaseUnit, MatlWrhsStkQtyInMatlBaseUnit)
//   API_PRODUCT_SRV           A_ProductValuation (Product, ValuationArea, ValuationType, StandardPrice,
//     PriceUnitQty, Currency, BaseUnit)
// Work instructions are not part of these APIs; extracts carry no instructions (instruction checks then
// report nothing for ERP cases, which the UI states as "No work instructions for this assembly").
import { Exact } from '../../lib/exact.js';

export class MappingError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

/** OData V2 JSON: { d: { results: [...] } } or { d: {...} } or { value: [...] } (V4/sandbox variants). */
export function rowsOf(payload) {
  const d = payload?.d ?? payload;
  if (Array.isArray(d?.results)) return d.results;
  if (Array.isArray(d?.value)) return d.value;
  if (Array.isArray(d)) return d;
  if (d && typeof d === 'object') return [d];
  throw new MappingError('ERP_PAYLOAD', 'Unexpected OData payload shape.');
}

/** Edm.DateTime in V2 JSON is "/Date(ms)/" (optionally with offset); also accepts ISO dates. Returns YYYY-MM-DD. */
export function odataDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const m = /^\/Date\((-?\d+)([+-]\d{4})?\)\/$/.exec(String(value));
  // Edm.DateTime carries no time zone: interpret ISO values without an offset as UTC (as the /Date()/ form is).
  const iso = String(value);
  const date = m ? new Date(Number(m[1])) : new Date(/T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(iso) ? `${iso}Z` : iso);
  if (Number.isNaN(date.getTime())) throw new MappingError('ERP_DATE', `Invalid date ${value}.`);
  return date.toISOString().slice(0, 10);
}

const dec = (value, field) => {
  try { return Exact.of(String(value).trim()).toPlain(); } catch { throw new MappingError('ERP_NUMBER', `${field}: invalid number ${value}.`); }
};

/** Optional mapping of S/4 internal/language-dependent unit codes to the codes used by the app. */
export const DEFAULT_UNIT_MAP = Object.freeze({ ST: 'PC', PCE: 'PC', EA: 'PC' });
const unitOf = (u, map) => { const code = String(u ?? '').trim().toUpperCase(); return map[code] ?? code; };

const validOn = (row, day, from = 'ValidityStartDate', to = 'ValidityEndDate') => {
  const start = odataDate(row[from]) ?? '0001-01-01', end = odataDate(row[to]) ?? '9999-12-31';
  return start <= day && day <= end;
};

/**
 * Two date-effective BOM states of one material BOM: the configuration valid on `fromDate` (current) and on
 * `toDate` (after the engineering change). Items whose validity covers the date belong to that state.
 */
export function mapBomStates({ header, items, fromDate, toDate, fromRevision = 'CURRENT', toRevision = 'PROPOSED', unitMap = DEFAULT_UNIT_MAP, changeNumber }) {
  if (!header) throw new MappingError('ERP_BOM_NOT_FOUND', 'No material BOM found for the selection.');
  if (!(fromDate < toDate)) throw new MappingError('ERP_DATES', 'fromDate must be before toDate.');
  const material = String(header.Material).trim(), plant = String(header.Plant).trim();
  const key = rev => `S4-${material}-${plant}-${header.BillOfMaterialVariantUsage}-${header.BillOfMaterialVariant}-${rev}`.slice(0, 40);
  const dayBefore = d => new Date(Date.parse(`${d}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const states = [
    { stateKey: key(fromRevision), revision: fromRevision, validFrom: fromDate, validTo: dayBefore(toDate), status: 'RELEASED', changeNumber: null, day: fromDate },
    { stateKey: key(toRevision), revision: toRevision, validFrom: toDate, validTo: odataDate(header.HeaderValidityEndDate) ?? '9999-12-31',
      status: 'PROPOSED', changeNumber: changeNumber ?? header.EngineeringChangeDocument ?? null, day: toDate },
  ];
  const bomStates = [], bomItems = [];
  for (const s of states) {
    const rows = items.filter(i => validOn(i, s.day));
    if (!rows.length) throw new MappingError('ERP_EMPTY_BOM', `The BOM of ${material} has no items valid on ${s.day}.`);
    bomStates.push({ stateKey: s.stateKey, assemblyCode: material, plant, bomUsage: String(header.BillOfMaterialVariantUsage),
      alternative: String(header.BillOfMaterialVariant).padStart(2, '0'), revision: s.revision, validFrom: s.validFrom, validTo: s.validTo,
      status: s.status, ...(s.changeNumber ? { changeNumber: s.changeNumber } : {}) });
    for (const i of rows) {
      bomItems.push({ stateKey: s.stateKey, itemNo: String(i.BillOfMaterialItemNumber).padStart(4, '0'), material: String(i.BillOfMaterialComponent).trim(),
        quantity: dec(i.BillOfMaterialItemQuantity, 'BillOfMaterialItemQuantity'), unit: unitOf(i.BillOfMaterialItemUnit, unitMap) });
    }
  }
  return { bomStates, bomItems };
}

/** Unrestricted-use stock (InventoryStockType '01', no special stock), summed over storage locations. */
export function mapStock(rows, { plant, retrievedAt, unitMap = DEFAULT_UNIT_MAP }) {
  const sums = new Map();
  for (const r of rows) {
    if (String(r.Plant).trim() !== plant || String(r.InventoryStockType ?? '') !== '01' || String(r.InventorySpecialStockType ?? '').trim()) continue;
    const k = `${String(r.Material).trim()}\u0000${unitOf(r.MaterialBaseUnit, unitMap)}`;
    sums.set(k, (sums.get(k) ?? new Exact(0n)).add(Exact.of(dec(r.MatlWrhsStkQtyInMatlBaseUnit, 'MatlWrhsStkQtyInMatlBaseUnit'))));
  }
  return [...sums.entries()].sort().map(([k, qty]) => {
    const [material, unit] = k.split('\u0000');
    const quantity = qty.cmp(0) < 0 ? '0' : qty.toPlain(); // negative stock is reported as zero available
    return { material, plant, availableQuantity: quantity, unit, snapshotAt: retrievedAt };
  });
}

/** Standard price per material from valuation data of the plant's valuation area (no split valuation). */
export function mapPrices(rows, { plant, validFrom, unitMap = DEFAULT_UNIT_MAP }) {
  const out = [];
  for (const r of rows) {
    if (String(r.ValuationArea).trim() !== plant || String(r.ValuationType ?? '').trim()) continue;
    if (r.StandardPrice === null || r.StandardPrice === undefined || r.StandardPrice === '') continue;
    out.push({ material: String(r.Product).trim(), plant, price: dec(r.StandardPrice, 'StandardPrice'), currency: String(r.Currency).trim(),
      priceUnit: Number(r.PriceUnitQty || 1), unit: unitOf(r.BaseUnit, unitMap), priceBasis: 'S4_STANDARD_PRICE', validFrom, validTo: '9999-12-31' });
  }
  return out.sort((a, b) => (a.material < b.material ? -1 : 1));
}

/** Complete import bundle for one engineering change extracted from S/4HANA. */
export function toImportBundle({ header, items, stockRows, valuationRows, selection, retrievedAt, source }) {
  const { fromDate, toDate, caseNumber, title, productionQuantity, fromRevision, toRevision, changeNumber, description } = selection;
  const { bomStates, bomItems } = mapBomStates({ header, items, fromDate, toDate, fromRevision, toRevision, changeNumber });
  const plant = bomStates[0].plant, material = bomStates[0].assemblyCode;
  const materials = new Set(bomItems.map(i => i.material));
  return {
    datasetId: `ERP-${material}-${retrievedAt.slice(0, 10)}`.slice(0, 40),
    source,
    assemblies: [{ assemblyCode: material, plant, description: description || `Material BOM ${header.BillOfMaterial} of ${material}` }],
    bomStates, bomItems,
    costPrices: mapPrices(valuationRows.filter(r => materials.has(String(r.Product).trim())), { plant, validFrom: retrievedAt.slice(0, 10) }),
    stockSnapshots: mapStock(stockRows.filter(r => materials.has(String(r.Material).trim())), { plant, retrievedAt }),
    instructions: [], instructionReferences: [],
    reviewCases: [{ caseNumber, title, assemblyCode: material, plant, fromStateKey: bomStates[0].stateKey, toStateKey: bomStates[1].stateKey,
      productionQuantity, owner: null }],
  };
}
