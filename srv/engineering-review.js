import cds from '@sap/cds';
import { calculateImpact, ImpactRejection, RULESET } from './lib/impact-calculator.js';
import { loadImpactInput, fingerprint, persistImpactRun, ConcurrentRunError, CaseDecidedError, IMPACT_ALLOWED_STATUSES } from './lib/impact-persistence.js';
import { userPlants, jouleReaderPlants } from './lib/plants.js';
import { decide, DecisionError, TRANSITIONS } from './lib/review-decisions.js';
import { validateDemoImport, commitDemoImport, purgeDemoImport } from './lib/demo-import.js';

// P1: a JouleReader technical client gets its plants from server configuration (cds.requires.joule.plants).
// Runs right after authentication, i.e. before @restrict evaluates $user.plants. Nothing is granted to any
// other identity: human users, mixed roles or a missing/invalid configuration keep plants = undefined.
if (!globalThis.__aiJouleMiddleware) {
  globalThis.__aiJouleMiddleware = true;
  cds.middlewares.add(function jouleReaderPlantsFromConfig(req, res, next) {
    const user = cds.context?.user ?? req.user;
    if (user?.is?.('JouleReader')) {
      const plants = jouleReaderPlants(user, cds.env.requires.joule?.plants);
      if (plants) user.attr = { ...user.attr, plants };
    }
    next();
  }, { after: 'auth' });
}

// Calculations are deterministic server-side (lib/impact-calculator.js); no LLM is involved.
export default class EngineeringReview extends cds.ApplicationService {
  init() {
    // P1: identities holding JouleReader that the middleware below did not accept are refused here.
    this.before('*', req => {
      if (req.user.is('JouleReader') && !jouleReaderPlants(req.user, cds.env.requires.joule?.plants))
        return req.reject(403, 'JouleReader is accepted only for a configured technical client without business roles.');
    });
    // Malformed or missing plant memberships never grant access (same rule as M03).
    this.before('*', req => { if (!userPlants(req.user)) req.reject(403); });
    this.on('lookupCases', req => this.#lookupCases(req));
    this.on('runImpact', 'ReviewCases', req => this.#runImpact(req));
    for (const action of Object.keys(TRANSITIONS)) this.on(action, 'ReviewCases', req => this.#decide(req, TRANSITIONS[action]));
    // Slice 2b: per-user action availability for the UI (hints; the actions enforce the rules).
    this.after('READ', 'ReviewCases', (rows, req) => {
      for (const row of Array.isArray(rows) ? rows : rows ? [rows] : []) {
        if (row.status === undefined) continue;
        row.canSubmit = row.status === 'OPEN' && req.user.is('ChangeAnalyst');
        row.canDecide = row.status === 'IN_REVIEW' && req.user.is('ChangeApprover');
        row.canRunImpact = IMPACT_ALLOWED_STATUSES.includes(row.status) && req.user.is('ChangeAnalyst');
      }
    });
    // M05: controlled demo import (development/test only; see lib/demo-import.js).
    this.before(['validateDemoImport', 'commitDemoImport', 'purgeDemoImport'], req => {
      if (!cds.env.requires['demo-import']?.enabled) return req.reject(403, 'Demo data import is disabled in this environment.');
    });
    const shape = (r, committed) => ({ ok: r.ok, committed, batchID: r.batchID ?? null, plant: r.plant, caseNumber: r.caseNumber,
      sha256: r.sha256, errors: r.errors, records: r.records });
    this.on('validateDemoImport', async req => shape(await validateDemoImport({ content: req.data.content, plants: userPlants(req.user) }), false));
    this.on('commitDemoImport', async req => {
      if (req.data.confirm !== true) return req.reject(400, 'Confirm the import explicitly (confirm = true) after reviewing the preview.');
      const r = await commitDemoImport({ content: req.data.content, fileName: req.data.fileName, plants: userPlants(req.user), user: req.user.id });
      if (!r.ok) return req.reject({ status: 422, code: 'IMPORT_INVALID', message: `Import refused: ${r.errors.length} problem(s). Validate the file to see them.`, details: r.errors.slice(0, 20).map(e => ({ code: e.code, message: `${e.path}: ${e.message}`, target: e.path })) });
      req.info({ message: `Imported synthetic case ${r.caseNumber} (batch ${r.batchID}).` });
      return shape(r, true);
    });
    this.on('purgeDemoImport', async req => {
      const r = await purgeDemoImport({ batchID: req.data.batchID, plants: userPlants(req.user) });
      if (r.status !== 200) return req.reject(r.status === 404 ? 404 : { status: r.status, code: r.code, message: r.message });
      return true;
    });
    return super.init();
  }

  // P1: read-only case lookup with named parameters (Joule action contract). Plant-filtered, max 50 rows.
  async #lookupCases(req) {
    const { caseNumber, status, assemblyCode } = req.data;
    if (caseNumber && !/^EC-\d{6}$/.test(caseNumber)) return req.reject(400, 'caseNumber must look like EC-000123.');
    if (status && !['OPEN', 'IN_REVIEW', 'APPROVED', 'REJECTED'].includes(status)) return req.reject(400, 'status must be OPEN, IN_REVIEW, APPROVED or REJECTED.');
    if (assemblyCode && !/^[A-Z][A-Z0-9-]{1,39}$/.test(assemblyCode)) return req.reject(400, 'assemblyCode has an invalid format.');
    const where = { plant: { in: userPlants(req.user) } };
    if (caseNumber) where.caseNumber = caseNumber;
    if (status) where.status = status;
    if (assemblyCode) where.assemblyCode = assemblyCode;
    const rows = await SELECT.from(this.entities.ReviewCases).columns(c => {
      c.caseNumber, c.title, c.assemblyCode, c.plant, c.fromRevision, c.toRevision, c.status, c.statusText,
      c.latestRun(r => { r.status, r.asOfDate, r.costDeltaTotal, r.currency, r.materialsShort, r.instructionFindings; });
    }).where(where).orderBy('caseNumber').limit(50);
    return rows.map(({ latestRun: r, ...c }) => ({ ...c, latestRunStatus: r?.status ?? null, latestRunAsOf: r?.asOfDate ?? null,
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
    return SELECT.one.from(this.entities.ReviewCases, caseID);
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

const caseDecided = status => ({ status: 409, code: 'CASE_ALREADY_DECIDED',
  message: `Impact cannot be recalculated for a review case in status ${status}; the evidence of the decision is preserved.` });
