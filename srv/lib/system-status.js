// Landing page: which integrations are configured in this deployment. Read from cds.env only:
// no data access, no secrets (an API key is reported as present/absent, never returned).
// "Configured" is not "verified live": the landing page labels it that way.
import cds from '@sap/cds';

/** Highest configured ERP source: S4HANA > SANDBOX > MOCK > NONE. */
export function dataSourceMode(erp = cds.env.requires?.['erp-source'] ?? {}, env = process.env) {
  if (erp.s4?.enabled) return 'S4HANA';
  if (erp.sandbox?.url && erp.sandbox?.apiKeyEnv && env[erp.sandbox.apiKeyEnv]) return 'SANDBOX';
  if (erp.fixtures) return 'MOCK';
  return 'NONE';
}

/** GENAI_HUB (live provider configured), FIXTURE (labelled test answers) or NOT_CONFIGURED. */
export function genaiMode(genai = cds.env.requires?.genai ?? {}) {
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
    genaiMode: genaiMode(env.requires?.genai ?? {}),
    jouleStatus: jouleStatus(env.requires?.joule ?? {}),
    demoImport: !!env.features?.demo_import,
    authMode: auth === 'xsuaa' || auth === 'ias' ? 'PRODUCTION' : 'DEVELOPMENT',
  };
}
