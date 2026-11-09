// Derives the SAP Build Actions input spec from the CAP-generated OpenAPI document of EngineeringReview.
// Usage: node make-actions-spec.mjs engineering-review.openapi.full.json > assemblyimpact-engineering-actions.openapi.json
// Seven read-mostly operations are exposed (one write: RunEngineeringImpact); all calculations stay in the CAP backend.
import { readFileSync } from 'node:fs';
const full = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const pick = (path, method, operationId, summary, description) => {
  const op = structuredClone(full.paths[path][method]);
  Object.assign(op, { operationId, summary, description, tags: ['AssemblyImpact Engineering Actions'] });
  return [path, method, op];
};
const ops = [
  pick('/ReviewCases', 'get', 'FindEngineeringCases', 'Find engineering review cases',
    'Lists the review cases visible to the calling user. The service restricts results to the user\'s plants (plant attribute). Use $filter (e.g. status eq \'IN_REVIEW\'), $select and $expand=latestRun to include the latest impact figures.'),
  pick('/ImpactRuns({ID})', 'get', 'GetEngineeringImpact', 'Get an engineering impact run',
    'Returns one immutable impact run. Use $expand=findings,materialLines,comparisonLines to include findings, stock shortages and BOM changes. The run ID is ReviewCases.latestRun_ID or the result of RunEngineeringImpact. Cross-plant IDs return 404.'),
  pick('/ReviewCases({ID})/EngineeringReview.runImpact', 'post', 'RunEngineeringImpact', 'Run the engineering impact calculation',
    'Invokes the existing bound OData V4 action runImpact for one review case. Allowed for role ChangeAnalyst within the user\'s plants only (403 otherwise, 404 for other plants). Returns the new immutable impact run. Body: {"asOfDate": "YYYY-MM-DD"}.'),
  // P1 (feat/platform-integration): read-only operations for the four Joule skills. lookupCases takes
  // named parameters, so a skill maps its inputs directly instead of building an OData $filter string.
  pick('/lookupCases', 'get', 'LookupEngineeringCases', 'Look up engineering review cases',
    'Read-only. Optional named filters caseNumber (EC-000123), status (OPEN, IN_REVIEW, APPROVED, REJECTED) and assemblyCode. Returns at most 50 cases of the caller\'s plants with the latest impact figures. Synthetic demo data.'),
  pick('/ImpactRuns({ID})/findings', 'get', 'GetImpactFindings', 'Get the findings of an impact run',
    'Read-only. BOM and work-instruction findings with severity and evidence references, as calculated by the backend.'),
  pick('/ImpactRuns({ID})/materialLines', 'get', 'GetMaterialImpact', 'Get the material impact of an impact run',
    'Read-only. Required, available and gap quantity, stock status and unit price per material, as calculated by the backend.'),
  pick('/ReviewCases({ID})/decisions', 'get', 'GetDecisionHistory', 'Get the review decision history of a case',
    'Read-only. Submit, approve and reject events with actor, comment and the evaluated impact run. Joule never approves or rejects.'),
];
const paths = {};
for (const [p, m, op] of ops) (paths[p] ??= {})[m] = op;
// keep only referenced component schemas
const used = new Set(); const walk = (o) => { if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { if (k === '$ref' && typeof v === 'string') { if (!used.has(v)) { used.add(v); walk(resolve(v)); } } else walk(v); } };
const resolve = (ref) => ref.split('/').slice(1).reduce((a, k) => a?.[k], full);
walk(paths);
const components = {};
for (const ref of used) { const [, , sect, name] = ref.split('/'); (components[sect] ??= {})[name] = resolve(ref); }
components.securitySchemes = { oauth2: { type: 'oauth2', description: 'XSUAA client credentials / user token via an SAP BTP destination (production). Development preview uses mocked basic auth and is not reachable from SAP Build.', flows: { clientCredentials: { tokenUrl: 'https://<subaccount>.authentication.<region>.hana.ondemand.com/oauth/token', scopes: {} } } } };
const spec = {
  openapi: full.openapi,
  info: { title: 'AssemblyImpact Engineering Actions', version: '0.1.0', description: 'Subset of the AssemblyImpact EngineeringReview OData V4 service (CAP) for SAP Build Actions and Joule. All data is synthetic (NovaMotion Manufacturing). Calculations are performed only by the backend runImpact action.' },
  servers: [{ url: '/odata/v4/engineering-review', description: 'Relative path; the base URL comes from the SAP BTP destination selected in SAP Build.' }],
  security: [{ oauth2: [] }],
  tags: [{ name: 'AssemblyImpact Engineering Actions' }],
  paths, components,
};
process.stdout.write(JSON.stringify(spec, null, 2) + '\n');
