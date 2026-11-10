// Landing page: which integrations are configured in this deployment. Read from cds.env only:
// no data access, no secrets (an API key is reported as present/absent, never returned).
// "Configured" is not "verified live": the landing page labels it that way.
import cds from '@sap/cds';

/**
 * Active ERP source. Explicit: cds.requires['erp-source'].mode = S4 | SANDBOX | FIXTURE | NONE (set per profile or
 * via CDS_CONFIG in the runtime environment). A selected mode whose configuration is incomplete is reported as
 * MISCONFIGURED, never replaced by another source. Without an explicit mode (tests, older configurations) the
 * highest configured source is reported: S4HANA > SANDBOX > FIXTURE > NONE.
 */
export const ERP_MODES = Object.freeze(['S4', 'SANDBOX', 'FIXTURE', 'NONE']);
export function dataSourceMode(erp = cds.env.requires?.['erp-source'] ?? {}, env = process.env) {
  const sandboxReady = !!(erp.sandbox?.url && erp.sandbox?.apiKeyEnv && env[erp.sandbox.apiKeyEnv]);
  if (erp.mode !== undefined && erp.mode !== null) {
    const mode = String(erp.mode).toUpperCase();
    if (mode === 'NONE') return 'NONE';
    if (mode === 'FIXTURE') return erp.fixtures ? 'FIXTURE' : 'MISCONFIGURED';
    if (mode === 'SANDBOX') return sandboxReady ? 'SANDBOX' : 'MISCONFIGURED';
    if (mode === 'S4') return erp.s4?.enabled ? 'S4HANA' : 'MISCONFIGURED';
    return 'MISCONFIGURED';
  }
  if (erp.s4?.enabled) return 'S4HANA';
  if (sandboxReady) return 'SANDBOX';
  if (erp.fixtures) return 'FIXTURE';
  return 'NONE';
}

/** Request mode of extractFromErp that the active source allows (null = any configured mode, legacy). */
export function allowedExtractMode(erp = cds.env.requires?.['erp-source'] ?? {}) {
  if (erp.mode === undefined || erp.mode === null) return null;
  return { S4: 's4', SANDBOX: 'sandbox', FIXTURE: 'synthetic' }[String(erp.mode).toUpperCase()] ?? 'none';
}

/** Database actually configured for this process: HANA (production) or SQLITE (development, tests). */
export function databaseKind(db = cds.env.requires?.db ?? {}) {
  const kind = String(db.kind ?? '').toLowerCase();
  if (kind === 'hana') return 'HANA';
  if (kind === 'sqlite' || kind === 'better-sqlite') return 'SQLITE';
  return kind ? kind.toUpperCase() : 'UNKNOWN';
}

/** GEMINI or GENAI_HUB (live provider configured), FIXTURE (labelled test answers) or NOT_CONFIGURED. */
export function genaiMode(genai = cds.env.requires?.genai ?? {}, environment = process.env) {
  // Gemini: same preconditions as geminiProvider() — a model id and the key in the named environment variable.
  // Only the presence of the key is checked; its value is never read into the status.
  if (genai.provider === 'gemini') return genai.modelId && environment[genai.apiKeyEnv ?? 'GEMINI_API_KEY'] ? 'GEMINI' : 'NOT_CONFIGURED';
  // Same preconditions as providerFor(): without deployment and resource group every call would fail.
  if (genai.provider === 'genai-hub') return genai.deploymentId && genai.resourceGroup ? 'GENAI_HUB' : 'NOT_CONFIGURED';
  if (genai.provider === 'fixture') return 'FIXTURE';
  return 'NOT_CONFIGURED';
}

/**
 * P1 Joule: the backend cannot observe SAP Build, so it reports what the deployment declares
 * (cds.requires.joule.actionsReleased, set only after the Actions project is released and a destination exists).
 */
export function jouleStatus(joule = cds.env.requires?.joule ?? {}) {
  return joule.actionsReleased === true ? 'CONFIGURED' : 'NOT_CONNECTED';
}

export function systemStatus(env = cds.env) {
  const auth = env.requires?.auth?.kind;
  return {
    dataSourceMode: dataSourceMode(env.requires?.['erp-source'] ?? {}),
    databaseKind: databaseKind(env.requires?.db ?? {}),
    genaiMode: genaiMode(env.requires?.genai ?? {}),
    jouleStatus: jouleStatus(env.requires?.joule ?? {}),
    demoImport: !!env.features?.demo_import,
    authMode: auth === 'xsuaa' || auth === 'ias' ? 'PRODUCTION' : 'DEVELOPMENT',
  };
}
