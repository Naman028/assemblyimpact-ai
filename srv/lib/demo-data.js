// Faculty demo data management: supporting images for a case and controlled edits of synthetic inputs.
// Both reuse the existing domain model (CaseAttachments, BOMItems, CostPrices, StockSnapshots, DataImports);
// neither touches persisted impact runs or decision events.
import cds from '@sap/cds';
import { createHash } from 'node:crypto';
import { Exact } from './exact.js';

export class DemoDataError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const fail = (status, code, message) => { throw new DemoDataError(status, code, message); };
const E = () => cds.entities('assemblyimpact');
const DECIDED = ['APPROVED', 'REJECTED'];
const SYNTHETIC = ['DEMO_IMPORT', 'SYNTHETIC_FIXTURE'];

// ------------------------------------------------------------------------------------------ attachments
export const MEDIA_TYPES = Object.freeze({ 'image/png': 'png', 'image/jpeg': 'jpeg' });
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
export const maxAttachmentBytes = () => Number(cds.env.requires?.attachments?.maxBytes) || DEFAULT_MAX_BYTES;

/** Basename only, safe characters, keeps one extension. Never trusted for the content type. */
export function safeFileName(name) {
  const base = String(name ?? '').split(/[\\/]/).pop().normalize('NFKC');
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+/, '').replace(/_{2,}/g, '_').slice(0, 120);
  return cleaned || 'attachment';
}

/** Detects PNG or JPEG from the file signature; anything else (SVG, HTML, PDF, ...) is refused. */
export function sniffImage(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  return null;
}

/** Reads an upload (Buffer, string or stream) with a hard size limit. */
export async function readLimited(content, limit = maxAttachmentBytes()) {
  if (content == null) return null;
  if (Buffer.isBuffer(content)) { if (content.length > limit) tooLarge(limit); return content; }
  if (typeof content === 'string') { const b = Buffer.from(content, 'base64'); if (b.length > limit) tooLarge(limit); return b; }
  // Drain the whole request (aborting mid-upload resets the client connection) but keep at most `limit` bytes.
  const chunks = []; let size = 0;
  for await (const chunk of content) {
    size += chunk.length;
    if (size <= limit) chunks.push(Buffer.from(chunk));
  }
  if (size > limit) tooLarge(limit);
  return Buffer.concat(chunks);
}
const tooLarge = limit => fail(413, 'ATTACHMENT_TOO_LARGE', `The image exceeds ${Math.round(limit / 1024)} KB.`);

/** The case of an attachment if it is in the user's plants (404 otherwise, as for every other entity). */
async function attachableCase(caseID, plants, { forChange } = {}) {
  if (!plants) fail(404, 'NOT_FOUND', 'Not found.');
  const rc = await SELECT.one.from(E().ReviewCases).columns('ID', 'plant', 'status').where({ ID: caseID, plant: { in: plants } });
  if (!rc) fail(404, 'NOT_FOUND', 'Not found.');
  if (forChange && DECIDED.includes(rc.status))
    fail(409, 'CASE_DECIDED', `The case is ${rc.status}; its attachments are part of the decision evidence and cannot change.`);
  // Evidence under review must not move while the approver looks at it: changes only while OPEN.
  if (forChange && rc.status !== 'OPEN')
    fail(409, 'CASE_IN_REVIEW', `The case is ${rc.status}; attachments can only change while it is OPEN.`);
  return rc;
}

/** CREATE: metadata only. The binary follows with PUT .../content. */
export async function prepareAttachment(data, { plants, user }) {
  if (!data.reviewCase_ID) fail(400, 'CASE_REQUIRED', 'reviewCase_ID is required.');
  await attachableCase(data.reviewCase_ID, plants, { forChange: true });
  if (!(data.mediaType in MEDIA_TYPES)) fail(415, 'UNSUPPORTED_MEDIA_TYPE', 'Only PNG and JPEG images are accepted.');
  if (data.content != null) fail(400, 'UPLOAD_SEPARATELY', 'Create the attachment first, then upload the image with PUT .../content.');
  return { ...data, fileName: safeFileName(data.fileName), description: data.description ? String(data.description).slice(0, 300) : null,
    content: null, size: null, sha256: null, uploadedBy: user, uploadedAt: new Date().toISOString() };
}

/** UPDATE: only the binary, once, validated against size and signature. Metadata is immutable. */
export async function acceptUpload(ID, data, { plants }) {
  const allowed = new Set(['ID', 'content', 'mediaType']);
  const extra = Object.keys(data).filter(k => !allowed.has(k));
  if (extra.length) fail(400, 'IMMUTABLE_METADATA', `Attachment metadata cannot be changed (${extra.join(', ')}).`);
  const att = await SELECT.one.from(E().CaseAttachments).columns('ID', 'reviewCase_ID', 'mediaType', 'size').where({ ID });
  if (!att) fail(404, 'NOT_FOUND', 'Not found.');
  await attachableCase(att.reviewCase_ID, plants, { forChange: true });
  if (att.size != null) fail(409, 'ALREADY_UPLOADED', 'The image was already uploaded; delete the attachment and create a new one to replace it.');
  const buffer = await readLimited(data.content);
  if (!buffer || !buffer.length) fail(400, 'EMPTY_UPLOAD', 'The upload is empty.');
  const detected = sniffImage(buffer);
  if (!detected) fail(415, 'UNSUPPORTED_MEDIA_TYPE', 'The file is not a PNG or JPEG image.');
  if (detected !== att.mediaType || (data.mediaType && data.mediaType !== detected))
    fail(415, 'MEDIA_TYPE_MISMATCH', `The file is ${detected}, not the declared ${att.mediaType}.`);
  return { content: buffer, size: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex') };
}

/** DELETE: allowed while the case is undecided. */
export async function checkRemoval(ID, { plants }) {
  const att = await SELECT.one.from(E().CaseAttachments).columns('reviewCase_ID').where({ ID });
  if (!att) fail(404, 'NOT_FOUND', 'Not found.');
  await attachableCase(att.reviewCase_ID, plants, { forChange: true });
}

// ------------------------------------------------------------------------------- synthetic input edits
export const EDIT_KINDS = Object.freeze(['PROPOSED_QUANTITY', 'PRICE', 'STOCK']);
const MATERIAL = /^[A-Z0-9][A-Z0-9-]{0,39}$/;
const plain = v => Exact.of(String(v)).toPlain();

/**
 * Changes one synthetic calculation input of an OPEN case and clears latestRun (compare-and-set on version),
 * so the next approval needs a new run. Earlier runs and decisions are never modified. Records the change in
 * DataImports (format 'edit'). Must run inside the request transaction.
 */
export async function reviseInput({ caseID, kind, itemNo, material, value }, { plants, user }) {
  const { ReviewCases, BOMStates, BOMItems, CostPrices, StockSnapshots, DataImports } = E();
  if (!EDIT_KINDS.includes(kind)) fail(400, 'INVALID_KIND', `kind must be one of ${EDIT_KINDS.join(', ')}.`);
  let v;
  try { v = Exact.of(String(value)); } catch { fail(400, 'INVALID_VALUE', 'value must be a decimal number.'); }
  // Zero rules: STOCK 0 = nothing on hand; PRICE 0 = a real zero price (e.g. a free-issue part), as in the import
  // and the calculator (R-COST-1; only a missing price makes cost INCOMPLETE); PROPOSED_QUANTITY 0 = the component
  // is removed from revision B (see below). Negatives are always refused.
  if (v.cmp('0') < 0) fail(400, 'INVALID_VALUE', kind === 'STOCK' ? 'Stock cannot be negative.' : 'The value cannot be negative.');
  if (kind === 'PRICE' && !v.mul(10000).isInteger()) fail(400, 'INVALID_VALUE', 'Prices have at most 4 decimals.');
  if (kind !== 'PRICE' && !v.mul(1000).isInteger()) fail(400, 'INVALID_VALUE', 'Quantities have at most 3 decimals.');
  if (v.cmp('1000000') > 0) fail(400, 'INVALID_VALUE', 'The value is unrealistically large (max. 1,000,000).');
  if (!plants) fail(404, 'NOT_FOUND', 'Not found.');
  const rc = await SELECT.one.from(ReviewCases).where({ ID: caseID, plant: { in: plants } });
  if (!rc) fail(404, 'NOT_FOUND', 'Not found.');
  if (!SYNTHETIC.includes(rc.sourceType)) fail(409, 'NOT_SYNTHETIC', 'Only synthetic demonstration data can be edited; ERP and sandbox extracts are read-only.');
  if (rc.status !== 'OPEN') fail(409, 'CASE_NOT_EDITABLE', `Inputs can only change while the case is OPEN (it is ${rc.status}).`);
  const states = [rc.fromState_ID, rc.toState_ID];
  const shared = await SELECT.one.from(ReviewCases).columns('caseNumber')
    .where`ID != ${rc.ID} and (fromState_ID in ${states} or toState_ID in ${states})`;

  let change;
  if (kind === 'PROPOSED_QUANTITY') {
    if (!/^\d{4}$/.test(String(itemNo ?? ''))) fail(400, 'ITEM_REQUIRED', 'itemNo of the proposed BOM item is required (e.g. 0020).');
    if (shared) fail(409, 'SHARED_RECORD', `The proposed BOM is also used by ${shared.caseNumber}; create a separate scenario instead.`);
    const item = await SELECT.one.from(BOMItems).where({ bomState_ID: rc.toState_ID, itemNo });
    if (item && v.isZero()) {
      // Quantity 0 means "not in revision B": the line is removed, so the comparison reports it as REMOVED.
      // A BOM line with quantity 0 is never stored (the calculator rejects it). The audit record keeps the line.
      const remaining = await SELECT.from(BOMItems).columns('ID').where({ bomState_ID: rc.toState_ID });
      if (remaining.length <= 1) fail(409, 'LAST_ITEM', 'The proposed BOM needs at least one component; this is its last item.');
      await DELETE.from(BOMItems).where({ ID: item.ID });
      change = { kind, itemNo, material: item.material, from: plain(item.quantity), to: '0', removed: { unit: item.unit, evidenceRef: item.evidenceRef } };
    } else if (item) {
      await UPDATE(BOMItems).set({ quantity: v.toPlain() }).where({ ID: item.ID });
      change = { kind, itemNo, material: item.material, from: plain(item.quantity), to: v.toPlain() };
    } else {
      // Not in revision B: a positive quantity re-adds a line of revision A (same item, material and unit).
      const original = await SELECT.one.from(BOMItems).where({ bomState_ID: rc.fromState_ID, itemNo });
      if (!original) fail(404, 'ITEM_NOT_FOUND', `Item ${itemNo} is in neither BOM revision of this case.`);
      if (v.isZero()) fail(409, 'ALREADY_REMOVED', `Item ${itemNo} is already not part of the proposed BOM.`);
      await INSERT.into(BOMItems).entries({ ID: cds.utils.uuid(), bomState_ID: rc.toState_ID, itemNo, material: original.material,
        quantity: v.toPlain(), unit: original.unit, evidenceRef: `DEMO-EDIT/${rc.caseNumber}/bom/${itemNo}`.slice(0, 200) });
      change = { kind, itemNo, material: original.material, from: '0', to: v.toPlain(), added: true };
    }
  } else {
    if (!MATERIAL.test(String(material ?? ''))) fail(400, 'MATERIAL_REQUIRED', 'A material of this case is required.');
    const used = await SELECT.one.from(BOMItems).columns('ID').where({ bomState_ID: { in: states }, material });
    if (!used) fail(400, 'MATERIAL_NOT_IN_CASE', `${material} is not in either BOM revision of this case.`);
    // Prices and stock are plant-wide records: refuse if another BOM of the plant uses the material.
    const others = await SELECT.from(BOMStates).columns('ID').where({ plant: rc.plant, ID: { 'not in': states } });
    const elsewhere = others.length && await SELECT.one.from(BOMItems).columns('ID').where({ material, bomState_ID: { in: others.map(o => o.ID) } });
    if (elsewhere) fail(409, 'SHARED_RECORD', `${material} is used by other BOMs in plant ${rc.plant}; changing its ${kind === 'PRICE' ? 'price' : 'stock'} would change their results too.`);
    if (kind === 'PRICE') {
      const prices = await SELECT.from(CostPrices).where({ material, plant: rc.plant });
      if (prices.length !== 1) fail(409, 'AMBIGUOUS_PRICE', `${material} has ${prices.length} price records; only a single open price can be edited.`);
      if (!SYNTHETIC.includes(prices[0].sourceType)) fail(409, 'NOT_SYNTHETIC', 'Only synthetic prices can be edited.');
      await UPDATE(CostPrices).set({ price: v.toPlain() }).where({ ID: prices[0].ID });
      change = { kind, material, from: plain(prices[0].price), to: v.toPlain(), currency: prices[0].currency };
    } else {
      const snapshots = await SELECT.from(StockSnapshots).where({ material, plant: rc.plant }).orderBy({ snapshotAt: 'desc' });
      if (snapshots.some(s => !SYNTHETIC.includes(s.sourceType))) fail(409, 'NOT_SYNTHETIC', 'Only synthetic stock can be edited.');
      const last = snapshots[0];
      const ID = cds.utils.uuid();
      await INSERT.into(StockSnapshots).entries({ ID, material, plant: rc.plant, availableQuantity: v.toPlain(), unit: last?.unit ?? 'PC',
        snapshotAt: new Date().toISOString(), sourceType: 'DEMO_IMPORT', evidenceRef: `DEMO-EDIT/${rc.caseNumber}/stock/${material}/${ID}`.slice(0, 200) });
      change = { kind, material, from: last ? plain(last.availableQuantity) : null, to: v.toPlain() };
    }
  }
  // Exclusive with runImpact and decisions: same compare-and-set token. Clears latestRun, keeps all runs.
  const moved = await UPDATE(ReviewCases).set({ latestRun_ID: null, version: cds.utils.uuid() })
    .where({ ID: rc.ID, version: rc.version ?? null, status: 'OPEN' });
  if (moved !== 1) fail(409, 'CONCURRENT_CHANGE', 'The case changed meanwhile; reload and try again. Nothing was saved.');
  const record = { case: rc.caseNumber, ...change };
  await INSERT.into(DataImports).entries({ ID: cds.utils.uuid(), plant: rc.plant, datasetId: null, fileName: null, format: 'edit',
    checksum: 'sha256:' + createHash('sha256').update(JSON.stringify(record)).digest('hex'), sourceType: 'DEMO_IMPORT',
    source: `demo-edit ${rc.caseNumber}: ${kind} ${change.itemNo ?? change.material} ${change.from ?? '-'} -> ${change.to}`.slice(0, 200),
    importedBy: user, importedAt: new Date().toISOString(), counts: JSON.stringify(record).slice(0, 500) });
  return { caseID: rc.ID, change };
}
