import cds from '@sap/cds';
import { calculateImpact, ImpactRejection, RULESET } from './lib/impact-calculator.js';
import { loadImpactInput, fingerprint, persistImpactRun, ConcurrentRunError, CaseDecidedError, IMPACT_ALLOWED_STATUSES } from './lib/impact-persistence.js';
import { userPlants } from './lib/plants.js';
import { prepareAttachment, acceptUpload, checkRemoval, reviseInput, DemoDataError } from './lib/demo-data.js';
import { decide, DecisionError, TRANSITIONS, submittersOf, availabilityFor } from './lib/review-decisions.js';
import { parseImport, validateBundle, commitBundle, checksum, ImportFormatError, ImportConflictError } from './lib/scenario-import.js';
import { extract, transportFor, ErpConfigError, ErpTransportError, MODE_SOURCE_TYPE } from './integration/erp/erp-source.js';
import { MappingError } from './integration/erp/s4-mapping.js';
import { explain, providerFor, GenAiConfigError, GenAiTransportError } from './integration/genai/impact-explanation.js';

// Calculations are deterministic server-side (lib/impact-calculator.js); no LLM is involved.
export default class EngineeringReview extends cds.ApplicationService {
  init() {
    // Malformed or missing plant memberships never grant access (same rule as M03).
    this.before('*', req => { if (!userPlants(req.user)) req.reject(403); });
    this.on('runImpact', 'ReviewCases', req => this.#runImpact(req));
    this.on('importScenario', req => this.#importScenario(req));
    this.on('extractFromErp', req => this.#extractFromErp(req));
    this.after('READ', 'ReviewCases', (rows, req) => annotateAvailability(rows, req));
    this.on('myCapabilities', req => capabilitiesOf(req.user));
    this.on('lookupCases', req => this.#lookupCases(req));
    // Faculty demo: supporting images and controlled synthetic input edits (lib/demo-data.js).
    const asReject = (req, error) => { if (error instanceof DemoDataError) return req.reject({ status: error.status, code: error.code, message: error.message }); throw error; };
    this.before('CREATE', 'CaseAttachments', async req => {
      try { Object.assign(req.data, await prepareAttachment(req.data, { plants: userPlants(req.user), user: req.user.id })); } catch (e) { return asReject(req, e); }
    });
    this.before('UPDATE', 'CaseAttachments', async req => {
      const key = req.params.at(-1); const ID = typeof key === 'object' ? key.ID : key;
      try { const accepted = await acceptUpload(ID, req.data, { plants: userPlants(req.user) }); delete req.data.mediaType; Object.assign(req.data, accepted); } catch (e) { return asReject(req, e); }
    });
    this.before('DELETE', 'CaseAttachments', async req => {
      const key = req.params.at(-1); const ID = typeof key === 'object' ? key.ID : key;
      try { await checkRemoval(ID, { plants: userPlants(req.user) }); } catch (e) { return asReject(req, e); }
    });
    this.on('reviseDemoInput', 'ReviewCases', async req => {
      if (!cds.env.features?.demo_import) return req.reject({ status: 403, code: 'DEMO_EDIT_DISABLED', message: 'Editing demonstration data is disabled in this environment.' });
      const key = req.params.at(-1); const caseID = typeof key === 'object' ? key.ID : key;
      try {
        const { change } = await reviseInput({ caseID, ...req.data }, { plants: userPlants(req.user), user: req.user.id });
        req.info({ message: `${change.kind} ${change.itemNo ?? change.material}: ${change.from ?? '-'} -> ${change.to}. Run the impact calculation again; earlier runs are unchanged.` });
      } catch (e) { return asReject(req, e); }
      return SELECT.one.from(this.entities.ReviewCases, caseID);
    });
    this.on('explainImpact', 'ReviewCases', req => this.#explainImpact(req));
    for (const action of Object.keys(TRANSITIONS)) this.on(action, 'ReviewCases', req => this.#decide(req, TRANSITIONS[action]));
    return super.init();
  }

  // P2: GenAI explanation of the latest run (lib: integration/genai/impact-explanation.js).
  async #explainImpact(req) {
    const key = req.params.at(-1);
    const caseID = typeof key === 'object' ? key.ID : key;
    const plants = userPlants(req.user);
    if (!plants) return req.reject(404);
    const { ReviewCases, ImpactRuns } = cds.entities('assemblyimpact');
    const rc = await SELECT.one.from(ReviewCases).columns(c => { c.ID, c.caseNumber, c.title, c.plant, c.sourceType, c.status, c.latestRun_ID, c.assembly(a => { a.assemblyCode; }); })
      .where({ ID: caseID, plant: { in: plants } });
    if (!rc) return req.reject(404); // missing and foreign-plant cases are indistinguishable
    if (!rc.latestRun_ID) return req.reject({ status: 409, code: 'NO_IMPACT_RUN', message: 'Run the impact calculation before requesting an explanation.' });
    const run = await SELECT.one.from(ImpactRuns, rc.latestRun_ID).columns(r => { r('*'), r.findings('*'), r.materialLines('*'), r.comparisonLines('*'); });
    let provider;
    try { provider = providerFor(); } catch (error) {
      if (error instanceof GenAiConfigError) return req.reject({ status: 409, code: 'GENAI_NOT_CONFIGURED', message: error.message });
      throw error;
    }
    try {
      return await explain({ ...rc, assemblyCode: rc.assembly?.assemblyCode }, run, provider);
    } catch (error) {
      if (error instanceof GenAiTransportError) return req.reject({ status: 502, code: 'GENAI_UNAVAILABLE', message: error.message });
      throw error;
    }
  }

  // P1: read-only case lookup with named parameters (Joule contract, ported from PR #11). Plant-filtered, max 50 rows.
  async #lookupCases(req) {
    // The OpenAPI spec (and so SAP Build) sends OData string literals as quoted query values (?caseNumber='EC-000485');
    // CAP passes the quotes through for query-form function parameters. Accept both the quoted and the plain form.
    const unquote = v => (typeof v === 'string' && /^'.*'$/s.test(v) ? v.slice(1, -1).replace(/''/g, "'") : v);
    const [caseNumber, status, assemblyCode] = ['caseNumber', 'status', 'assemblyCode'].map(k => unquote(req.data[k]) || undefined);
    if (caseNumber && !/^EC-\d{6}$/.test(caseNumber)) return req.reject(400, 'caseNumber must look like EC-000123.');
    if (status && !['OPEN', 'IN_REVIEW', 'APPROVED', 'REJECTED'].includes(status)) return req.reject(400, 'status must be OPEN, IN_REVIEW, APPROVED or REJECTED.');
    if (assemblyCode && !/^[A-Z][A-Z0-9-]{1,39}$/.test(assemblyCode)) return req.reject(400, 'assemblyCode has an invalid format.');
    const plants = userPlants(req.user);
    if (!plants) return []; // missing or malformed plant attribute = no access
    const where = { plant: { in: plants } };
    if (caseNumber) where.caseNumber = caseNumber;
    if (status) where.status = status;
    if (assemblyCode) where.assemblyCode = assemblyCode;
    const rows = await SELECT.from(this.entities.ReviewCases).columns(c => {
      c.ID, c.caseNumber, c.title, c.assemblyCode, c.plant, c.fromRevision, c.toRevision, c.status, c.statusText, c.sourceType,
      c.latestRun(r => { r.ID, r.status, r.asOfDate, r.costDeltaTotal, r.currency, r.materialsShort, r.instructionFindings; });
    }).where(where).orderBy('caseNumber').limit(50);
    return rows.map(({ latestRun: r, ...c }) => ({ ...c, latestRun_ID: r?.ID ?? null, latestRunStatus: r?.status ?? null, latestRunAsOf: r?.asOfDate ?? null,
      costDeltaTotal: r?.costDeltaTotal ?? null, currency: r?.currency ?? null, materialsShort: r?.materialsShort ?? null, instructionFindings: r?.instructionFindings ?? null }));
  }

  // M04 Slice 2a: submitForReview / approve / reject (rules in lib/review-decisions.js).
  async #decide(req, transition) {
    const key = req.params.at(-1);
    const caseID = typeof key === 'object' ? key.ID : key;
    let result;
    try {
      result = await decide({ caseID, transition, userID: req.user.id, plants: userPlants(req.user), rawComment: req.data.comment, basedOnRun: req.data.basedOnRun, acknowledgeWarnings: req.data.acknowledgeWarnings });
    } catch (error) {
      if (error instanceof DecisionError) return req.reject({ status: error.status, code: error.code, message: error.message });
      throw error;
    }
    // Missing and foreign-plant cases are indistinguishable to the caller.
    if (!result) return req.reject(404);
    req.info({ message: `Review case status changed from ${result.fromStatus} to ${result.toStatus}.` });
    // Read through the service so the returned case carries the refreshed availability flags.
    return this.read(this.entities.ReviewCases, caseID);
  }

  // M05: demo-data import (see lib/scenario-import.js). Errors are returned as data in a dry run and as
  // 400 with the same list on commit, so a failed commit never leaves partial rows (transaction rollback).
  async #importScenario(req) {
    if (!cds.env.features?.demo_import) return req.reject({ status: 403, code: 'IMPORT_DISABLED', message: 'Demo-data import is disabled in this environment.' });
    const { fileName = null, format, content, dryRun = true } = req.data;
    let parsed;
    try {
      parsed = parseImport(content, format);
    } catch (error) {
      if (!(error instanceof ImportFormatError)) throw error;
      const result = { dryRun: dryRun !== false, accepted: false, errors: [{ line: null, field: null, code: error.code, message: error.message }], preview: [], caseIds: [] };
      if (dryRun !== false) return result;
      return req.reject({ status: 400, code: error.code, message: error.message });
    }
    const validated = await validateBundle(parsed, { plants: userPlants(req.user), sourceType: 'DEMO_IMPORT' });
    const base = { dryRun: dryRun !== false, plant: validated.plant, checksum: checksum(content), counts: JSON.stringify(validated.counts),
      errors: validated.errors, preview: validated.preview, caseIds: [] };
    if (dryRun !== false) return { ...base, importId: null, accepted: !validated.errors.length };
    if (validated.errors.length) {
      const first = validated.errors[0];
      return req.reject({ status: 400, code: 'IMPORT_VALIDATION_FAILED',
        message: `Import refused: ${validated.errors.length} validation error(s); first: ${first.line ?? ''} ${first.message}`.trim() });
    }
    const importId = cds.utils.uuid();
    let caseIds;
    try {
      ({ caseIds } = await commitBundle(validated, { importId, user: req.user.id, fileName, format: String(format).toLowerCase(), content, meta: parsed.meta }));
    } catch (error) {
      if (error instanceof ImportConflictError || /UNIQUE|unique constraint/i.test(error.message)) {
        return req.reject({ status: 409, code: 'IMPORT_CONFLICT', message: 'A concurrent change conflicts with this import; nothing was imported. Validate again.' });
      }
      throw error;
    }
    req.info({ message: `Imported ${validated.counts.reviewCases} review case(s) and ${Object.values(validated.counts).reduce((a, b) => a + b, 0)} records (import ${importId}).` });
    return { ...base, importId, accepted: true, caseIds };
  }

  // P2: ERP extract -> import bundle -> the same validation and transactional commit as file imports.
  async #extractFromErp(req) {
    const { mode, material, plant, bomUsage = '1', alternative = '01', fromDate, toDate, changeNumber, caseNumber, title,
      productionQuantity, dryRun = true } = req.data;
    if (!(mode in MODE_SOURCE_TYPE)) return req.reject({ status: 400, code: 'INVALID_ERP_MODE', message: 'mode must be synthetic, sandbox or s4.' });
    if (!/^\d{1,2}$/.test(String(alternative))) return req.reject({ status: 400, code: 'INVALID_ALTERNATIVE', message: 'alternative must be a number of at most two digits.' });
    if (!userPlants(req.user).includes(plant)) return req.reject({ status: 403, code: 'PLANT_NOT_AUTHORIZED', message: `You are not authorized for plant ${plant}.` });
    let bundle;
    try {
      const transport = transportFor(mode);
      bundle = await extract({ transport, mode, selection: { material, plant, bomUsage, alternative: String(Number(alternative)),
        fromDate, toDate, changeNumber, caseNumber, title, productionQuantity, description: null,
        validityEnd: cds.env.requires?.['erp-source']?.validityEnd ?? 'inclusive' } });
    } catch (error) {
      if (error instanceof ErpConfigError) return req.reject({ status: 409, code: error.code, message: error.message });
      if (error instanceof ErpTransportError) return req.reject({ status: 502, code: error.code, message: error.message });
      if (error instanceof MappingError) return req.reject({ status: 422, code: error.code, message: error.message });
      throw error;
    }
    const content = JSON.stringify(bundle);
    const sourceType = MODE_SOURCE_TYPE[mode];
    const validated = await validateBundle({ meta: {}, records: Object.fromEntries(Object.entries(bundle)
      .filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v.map((r, i) => ({ ...r, _line: `${k}[${i}]` }))])) },
    { plants: userPlants(req.user), sourceType, policy: 'erp-merge' });
    const base = { dryRun: dryRun !== false, plant: validated.plant, checksum: checksum(content), counts: JSON.stringify(validated.counts),
      errors: validated.errors, preview: validated.preview, caseIds: [] };
    if (dryRun !== false) return { ...base, importId: null, accepted: !validated.errors.length };
    if (validated.errors.length) {
      return req.reject({ status: 400, code: 'IMPORT_VALIDATION_FAILED', message: `ERP extract refused: ${validated.errors[0].message}` });
    }
    const importId = cds.utils.uuid();
    let caseIds;
    try {
      ({ caseIds } = await commitBundle(validated, { importId, user: req.user.id, fileName: null, format: 'odata', content,
        meta: { datasetId: bundle.datasetId, source: bundle.source } }));
    } catch (error) {
      if (error instanceof ImportConflictError || /UNIQUE|unique constraint/i.test(error.message)) {
        return req.reject({ status: 409, code: 'IMPORT_CONFLICT', message: 'A concurrent change conflicts with this extract; nothing was imported. Validate again.' });
      }
      throw error;
    }
    return { ...base, importId, accepted: true, caseIds };
  }

  async #runImpact(req) {
    const key = req.params.at(-1);
    const caseID = typeof key === 'object' ? key.ID : key;
    const asOfDate = req.data.asOfDate ?? new Date().toISOString().slice(0, 10);

    const loaded = await loadImpactInput(caseID, userPlants(req.user), asOfDate);
    // Missing and foreign-plant cases are indistinguishable to the caller.
    if (!loaded) return req.reject(404);
    // M04 Slice 2a (Decision B): decided cases keep the evidence they were decided on.
    if (!IMPACT_ALLOWED_STATUSES.includes(loaded.reviewCase.status)) return req.reject(caseDecided(loaded.reviewCase.status));

    let result;
    try {
      result = calculateImpact(loaded.input);
    } catch (error) {
      if (error instanceof ImpactRejection) {
        return req.reject({ status: 422, code: error.code, message: `Impact cannot be calculated: ${error.code}`, args: [error.detail] });
      }
      throw error;
    }

    try {
      const runID = await persistImpactRun(loaded.reviewCase, result, {
        fingerprint: fingerprint(RULESET, loaded.input), user: req.user.id, now: new Date().toISOString(),
      });
      const run = await SELECT.one.from(this.entities.ImpactRuns, runID);
      // M05: confirm the result to the caller (shown by Fiori elements); figures are the persisted run's.
      req.info({ message: `Impact calculated as of ${run.asOfDate} (${run.status}): estimated cost delta ` +
        `${run.costDeltaTotal ?? 'not available'} ${run.currency}, ${run.materialsShort} material(s) short, ` +
        `${run.instructionFindings} outdated instruction reference(s).` });
      return run;
    } catch (error) {
      if (error instanceof CaseDecidedError) return req.reject(caseDecided(error.caseStatus));
      if (error instanceof ConcurrentRunError) {
        return req.reject({ status: 409, code: 'CONCURRENT_IMPACT_RUN', message: 'Another impact run completed first; reload and retry.' });
      }
      throw error;
    }
  }
}

const VIRTUAL_FLAGS = ['canRunImpact', 'canSubmit', 'canDecide', 'submittedBy'];

/**
 * M05: fills the virtual availability flags used by the UIs to show only meaningful actions — only those
 * the request selected. Rules come from lib/review-decisions.js (same submitter rule as the actions).
 */
async function annotateAvailability(result, req) {
  const rows = (Array.isArray(result) ? result : [result]).filter(r => r && r.ID);
  if (!rows.length) return;
  const columns = req.query?.SELECT?.columns;
  const selected = !columns || columns.some(c => c === '*') ? VIRTUAL_FLAGS
    : VIRTUAL_FLAGS.filter(f => columns.some(c => c?.ref?.length === 1 && c.ref[0] === f));
  if (!selected.length) return;
  const { ReviewCases } = cds.entities('assemblyimpact');
  const stored = new Map((await SELECT.from(ReviewCases).columns('ID', 'status', 'createdBy').where({ ID: { in: rows.map(r => r.ID) } }))
    .map(r => [r.ID, r]));
  const inReview = [...stored.values()].filter(r => r.status === 'IN_REVIEW');
  const submitters = new Map((await submittersOf(inReview)).map((s, i) => [inReview[i].ID, s]));
  for (const row of rows) {
    const status = stored.get(row.ID)?.status, submittedBy = submitters.get(row.ID) ?? null;
    const flags = { ...availabilityFor({ status, submittedBy }, req.user, IMPACT_ALLOWED_STATUSES), submittedBy };
    for (const f of selected) row[f] = flags[f];
  }
}

/** M05: what the signed-in user may do globally (drives optional UI controls such as the import button). */
function capabilitiesOf(user) {
  return { canImport: !!cds.env.features?.demo_import && user.is('DemoDataImporter') };
}

const caseDecided = status => ({ status: 409, code: 'CASE_ALREADY_DECIDED',
  message: `Impact cannot be recalculated for a review case in status ${status}; the evidence of the decision is preserved.` });
