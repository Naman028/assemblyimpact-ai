import cds from '@sap/cds';
import { calculateImpact, ImpactRejection, RULESET } from './lib/impact-calculator.js';
import { loadImpactInput, fingerprint, persistImpactRun, ConcurrentRunError, CaseDecidedError, IMPACT_ALLOWED_STATUSES } from './lib/impact-persistence.js';
import { userPlants } from './lib/plants.js';
import { decide, DecisionError, TRANSITIONS } from './lib/review-decisions.js';
import { parseImport, validateBundle, commitBundle, checksum, ImportFormatError } from './lib/scenario-import.js';
import { extract, transportFor, ErpConfigError, MODE_SOURCE_TYPE } from './integration/erp/erp-source.js';
import { MappingError } from './integration/erp/s4-mapping.js';

// Calculations are deterministic server-side (lib/impact-calculator.js); no LLM is involved.
export default class EngineeringReview extends cds.ApplicationService {
  init() {
    // Malformed or missing plant memberships never grant access (same rule as M03).
    this.before('*', req => { if (!userPlants(req.user)) req.reject(403); });
    this.on('runImpact', 'ReviewCases', req => this.#runImpact(req));
    this.on('importScenario', req => this.#importScenario(req));
    this.on('extractFromErp', req => this.#extractFromErp(req));
    this.after('READ', 'ReviewCases', (rows, req) => annotateAvailability(rows, req.user));
    for (const action of Object.keys(TRANSITIONS)) this.on(action, 'ReviewCases', req => this.#decide(req, TRANSITIONS[action]));
    return super.init();
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
    return SELECT.one.from(this.entities.ReviewCases, caseID);
  }

  // M05: demo-data import (see lib/scenario-import.js). Errors are returned as data in a dry run and as
  // 400 with the same list on commit, so a failed commit never leaves partial rows (transaction rollback).
  async #importScenario(req) {
    if (!cds.env.features?.demo_import) return req.reject(403, 'IMPORT_DISABLED', 'Demo-data import is disabled in this environment.');
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
    const { caseIds } = await commitBundle(validated, { importId, user: req.user.id, fileName, format: String(format).toLowerCase(), content, meta: parsed.meta });
    req.info({ message: `Imported ${validated.counts.reviewCases} review case(s) and ${Object.values(validated.counts).reduce((a, b) => a + b, 0)} records (import ${importId}).` });
    return { ...base, importId, accepted: true, caseIds };
  }

  // P2: ERP extract -> import bundle -> the same validation and transactional commit as file imports.
  async #extractFromErp(req) {
    const { mode, material, plant, bomUsage = '1', alternative = '01', fromDate, toDate, changeNumber, caseNumber, title,
      productionQuantity, dryRun = true } = req.data;
    if (!(mode in MODE_SOURCE_TYPE)) return req.reject(400, 'INVALID_ERP_MODE', 'mode must be synthetic, sandbox or s4.');
    if (!userPlants(req.user).includes(plant)) return req.reject(403, 'PLANT_NOT_AUTHORIZED', `You are not authorized for plant ${plant}.`);
    let bundle;
    try {
      const transport = transportFor(mode);
      bundle = await extract({ transport, mode, selection: { material, plant, bomUsage, alternative: String(Number(alternative)),
        fromDate, toDate, changeNumber, caseNumber, title, productionQuantity, description: null } });
    } catch (error) {
      if (error instanceof ErpConfigError) return req.reject({ status: 409, code: error.code, message: error.message });
      if (error instanceof MappingError) return req.reject({ status: 422, code: error.code, message: error.message });
      if (error?.name === 'TimeoutError' || error?.cause) return req.reject({ status: 502, code: 'ERP_UNREACHABLE', message: 'The ERP system could not be reached.' });
      throw error;
    }
    const content = JSON.stringify(bundle);
    const sourceType = MODE_SOURCE_TYPE[mode];
    const validated = await validateBundle({ meta: {}, records: Object.fromEntries(Object.entries(bundle)
      .filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v.map((r, i) => ({ ...r, _line: `${k}[${i}]` }))])) },
    { plants: userPlants(req.user), sourceType });
    const base = { dryRun: dryRun !== false, plant: validated.plant, checksum: checksum(content), counts: JSON.stringify(validated.counts),
      errors: validated.errors, preview: validated.preview, caseIds: [] };
    if (dryRun !== false) return { ...base, importId: null, accepted: !validated.errors.length };
    if (validated.errors.length) {
      return req.reject({ status: 400, code: 'IMPORT_VALIDATION_FAILED', message: `ERP extract refused: ${validated.errors[0].message}` });
    }
    const importId = cds.utils.uuid();
    const { caseIds } = await commitBundle(validated, { importId, user: req.user.id, fileName: null, format: 'odata', content,
      meta: { datasetId: bundle.datasetId, source: bundle.source } });
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

/**
 * M05: fills the virtual availability flags used by the UIs to show only meaningful actions.
 * Mirrors the server rules (roles, status, no self-decision); it never grants anything itself.
 */
async function annotateAvailability(result, user) {
  const rows = (Array.isArray(result) ? result : [result]).filter(r => r && r.ID);
  if (!rows.length) return;
  const { ReviewCases } = cds.entities('assemblyimpact');
  const missing = rows.filter(r => !('status' in r)).map(r => r.ID);
  const statusOf = new Map(rows.filter(r => 'status' in r).map(r => [r.ID, r.status]));
  if (missing.length) {
    for (const r of await SELECT.from(ReviewCases).columns('ID', 'status').where({ ID: { in: missing } })) statusOf.set(r.ID, r.status);
  }
  const inReview = rows.filter(r => statusOf.get(r.ID) === 'IN_REVIEW').map(r => r.ID);
  const submitters = new Map();
  if (inReview.length) {
    const { DecisionEvents } = cds.entities('assemblyimpact');
    const events = await SELECT.from(DecisionEvents).columns('reviewCase_ID', 'actor', 'at')
      .where({ reviewCase_ID: { in: inReview }, toStatus: 'IN_REVIEW' }).orderBy('at');
    for (const e of events) submitters.set(e.reviewCase_ID, e.actor); // ascending: the latest wins
  }
  const analyst = user.is('ChangeAnalyst'), approver = user.is('ChangeApprover');
  for (const row of rows) {
    const submittedBy = submitters.get(row.ID) ?? null, status = statusOf.get(row.ID);
    row.canRunImpact = analyst && IMPACT_ALLOWED_STATUSES.includes(status);
    row.canSubmit = analyst && status === 'OPEN';
    row.canDecide = approver && status === 'IN_REVIEW' && submittedBy !== user.id;
    row.submittedBy = submittedBy;
  }
}

const caseDecided = status => ({ status: 409, code: 'CASE_ALREADY_DECIDED',
  message: `Impact cannot be recalculated for a review case in status ${status}; the evidence of the decision is preserved.` });
