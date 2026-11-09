// P2: ERP data-source adapter. Separates the transport (synthetic fixture, SAP Business Accelerator Hub
// sandbox, real S/4HANA via BTP destination) from the mapping (s4-mapping.js) and from the deterministic
// impact engine, which never sees where its inputs came from except through provenance fields.
import cds from '@sap/cds';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rowsOf, toImportBundle, isComponentItem, MappingError } from './s4-mapping.js';

export const SERVICES = Object.freeze({
  bom: '/sap/opu/odata/sap/API_BILL_OF_MATERIAL_SRV',
  stock: '/sap/opu/odata/sap/API_MATERIAL_STOCK_SRV',
  product: '/sap/opu/odata/sap/API_PRODUCT_SRV',
});
/** sourceType written for each mode; sandbox and synthetic data are never labelled as S/4HANA business data. */
export const MODE_SOURCE_TYPE = Object.freeze({ synthetic: 'DEMO_IMPORT', sandbox: 'SANDBOX_IMPORT', s4: 'S4_IMPORT' });

export class ErpConfigError extends Error {
  constructor(message) { super(message); this.code = 'ERP_NOT_CONFIGURED'; }
}

/** The ERP system answered with an error, timed out or was unreachable (reported as 502, not as a client error). */
export class ErpTransportError extends Error {
  constructor(message, status) { super(message); this.code = 'ERP_UNAVAILABLE'; this.upstreamStatus = status ?? null; }
}

export const PAGE_LIMIT = 20;      // max. pages followed per query (server-driven paging, d.__next)
export const FILTER_CHUNK = 40;    // materials per $filter, keeps URLs well below common limits

const q = s => `'${String(s).replace(/'/g, "''")}'`;

/** OData V2 query paths (relative to the service root) for one material BOM selection. */
export function queries({ material, plant, bomUsage, alternative }) {
  const bomFilter = `Material eq ${q(material)} and Plant eq ${q(plant)} and BillOfMaterialVariantUsage eq ${q(bomUsage)} and BillOfMaterialVariant eq ${q(alternative)}`;
  return {
    header: `${SERVICES.bom}/A_BillOfMaterial?$filter=${encodeURIComponent(bomFilter)}&$top=10&$format=json`,
    items: bom => `${SERVICES.bom}/A_BillOfMaterialItem?$filter=${encodeURIComponent(`BillOfMaterial eq ${q(bom.BillOfMaterial)} and BillOfMaterialCategory eq ${q(bom.BillOfMaterialCategory)} and BillOfMaterialVariant eq ${q(bom.BillOfMaterialVariant)}`)}&$format=json`,
    stock: materials => `${SERVICES.stock}/A_MatlStkInAcctMod?$filter=${encodeURIComponent(`Plant eq ${q(plant)} and (${materials.map(m => `Material eq ${q(m)}`).join(' or ')})`)}&$format=json`,
    valuation: materials => `${SERVICES.product}/A_ProductValuation?$filter=${encodeURIComponent(`ValuationArea eq ${q(plant)} and (${materials.map(m => `Product eq ${q(m)}`).join(' or ')})`)}&$format=json`,
  };
}

/** HTTP transport (sandbox or any reachable OData endpoint). headers: e.g. { APIKey } for the sandbox. */
export function httpTransport({ baseUrl, headers = {}, timeoutMs = 15000 }) {
  const root = baseUrl.replace(/\/$/, '');
  return async path => {
    // Server-driven paging: __next may be absolute or relative to the service root.
    const url = /^https?:\/\//.test(path) ? path : `${root}${path}`;
    if (!url.startsWith(root)) throw new ErpTransportError('Refusing to follow a next link outside the configured ERP host.');
    let response;
    try {
      response = await fetch(url, { headers: { accept: 'application/json', ...headers }, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      throw new ErpTransportError(error?.name === 'TimeoutError' ? 'The ERP system did not answer in time.' : 'The ERP system could not be reached.');
    }
    if (!response.ok) throw new ErpTransportError(`The ERP system answered HTTP ${response.status}.`, response.status);
    return response.json();
  };
}

/** BTP destination transport via CAP remote services (requires the destination and connectivity setup on BTP). */
export function destinationTransport(serviceNames = { bom: 'API_BILL_OF_MATERIAL_SRV', stock: 'API_MATERIAL_STOCK_SRV', product: 'API_PRODUCT_SRV' }) {
  return async path => {
    const key = Object.keys(SERVICES).find(k => path.includes(SERVICES[k]));
    const srv = await cds.connect.to(serviceNames[key]);
    try {
      return await srv.send({ method: 'GET', path: path.slice(path.indexOf(SERVICES[key]) + SERVICES[key].length) });
    } catch (error) {
      throw new ErpTransportError(`The ERP system answered ${error.statusCode ?? error.status ?? 'with an error'}.`, error.statusCode ?? error.status);
    }
  };
}

/** Synthetic transport: serves contract fixtures (authored from the API definitions, not captured data). */
export function fixtureTransport(dir) {
  const load = name => JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8'));
  return async path => {
    if (path.includes('/A_BillOfMaterialItem')) return load('A_BillOfMaterialItem');
    if (path.includes('/A_BillOfMaterial')) return load('A_BillOfMaterial');
    if (path.includes('/A_MatlStkInAcctMod')) return load('A_MatlStkInAcctMod');
    if (path.includes('/A_ProductValuation')) return load('A_ProductValuation');
    throw new MappingError('ERP_HTTP', `No fixture for ${path}.`);
  };
}

/** Transport for a configured mode; refuses unconfigured modes instead of falling back silently. */
export function transportFor(mode, env = cds.env.requires?.['erp-source'] ?? {}) {
  if (mode === 'synthetic') {
    if (!env.fixtures) throw new ErpConfigError('Synthetic ERP mode is not configured (erp-source.fixtures).');
    return fixtureTransport(join(cds.root, env.fixtures));
  }
  if (mode === 'sandbox') {
    const key = env.sandbox?.apiKeyEnv ? process.env[env.sandbox.apiKeyEnv] : undefined;
    if (!env.sandbox?.url || !key) throw new ErpConfigError('SAP Business Accelerator Hub sandbox is not configured (URL and API key environment variable).');
    return httpTransport({ baseUrl: env.sandbox.url, headers: { APIKey: key } });
  }
  if (mode === 's4') {
    if (!env.s4?.enabled) throw new ErpConfigError('Real S/4HANA access is not configured (destination and authorization required).');
    return destinationTransport(env.s4.services);
  }
  throw new ErpConfigError(`Unknown ERP mode ${mode}.`);
}

/** All rows of a query, following OData V2 server-driven paging (d.__next); refuses silent truncation. */
export async function readAll(transport, path) {
  const rows = [];
  let next = path;
  for (let page = 0; next; page++) {
    if (page >= PAGE_LIMIT) throw new MappingError('ERP_TOO_LARGE', `More than ${PAGE_LIMIT} result pages; narrow the selection.`);
    const payload = await transport(next);
    rows.push(...rowsOf(payload));
    next = payload?.d?.__next ?? payload?.['@odata.nextLink'] ?? null;
  }
  return rows;
}

const chunks = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

/** Reads one BOM change, its stock and valuation through `transport` and returns an import bundle. */
export async function extract({ transport, mode, selection, now = new Date().toISOString() }) {
  const Q = queries(selection);
  let headers = await readAll(transport, Q.header);
  // Version-managed BOMs return one header per version: use the latest version when flagged.
  if (headers.length > 1 && headers.some(h => h.IsLatestBOMVersion === true)) headers = headers.filter(h => h.IsLatestBOMVersion === true);
  if (!headers.length) throw new MappingError('ERP_BOM_NOT_FOUND', `No material BOM for ${selection.material} in plant ${selection.plant}.`);
  if (headers.length > 1) throw new MappingError('ERP_BOM_AMBIGUOUS', 'The selection matches more than one material BOM.');
  const header = headers[0];
  const items = await readAll(transport, Q.items(header));
  const materials = [...new Set(items.filter(isComponentItem).map(i => String(i.BillOfMaterialComponent).trim()))];
  const read = async query => (await Promise.all(chunks(materials, FILTER_CHUNK).map(c => readAll(transport, query(c))))).flat();
  const [stockRows, valuationRows] = materials.length ? await Promise.all([read(Q.stock), read(Q.valuation)]) : [[], []];
  return toImportBundle({ header, items, stockRows, valuationRows, selection, retrievedAt: now,
    source: `erp-adapter:${mode}${mode === 'sandbox' ? ' (SAP API sandbox, not business data)' : ''}` });
}
