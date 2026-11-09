import cds from '@sap/cds';
import { calculateImpact, ImpactRejection, RULESET } from './lib/impact-calculator.js';
import { loadImpactInput, fingerprint, persistImpactRun, ConcurrentRunError } from './lib/impact-persistence.js';
import { userPlants } from './lib/plants.js';

// Calculations are deterministic server-side (lib/impact-calculator.js); no LLM is involved.
export default class EngineeringReview extends cds.ApplicationService {
  init() {
    // Malformed or missing plant memberships never grant access (same rule as M03).
    this.before('*', req => { if (!userPlants(req.user)) req.reject(403); });
    this.on('runImpact', 'ReviewCases', req => this.#runImpact(req));
    return super.init();
  }

  async #runImpact(req) {
    const key = req.params.at(-1);
    const caseID = typeof key === 'object' ? key.ID : key;
    const asOfDate = req.data.asOfDate ?? new Date().toISOString().slice(0, 10);

    const loaded = await loadImpactInput(caseID, userPlants(req.user), asOfDate);
    // Missing and foreign-plant cases are indistinguishable to the caller.
    if (!loaded) return req.reject(404);

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
      if (error instanceof ConcurrentRunError) {
        return req.reject({ status: 409, code: 'CONCURRENT_IMPACT_RUN', message: 'Another impact run completed first; reload and retry.' });
      }
      throw error;
    }
  }
}
