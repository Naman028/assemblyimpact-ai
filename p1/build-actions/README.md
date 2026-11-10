# P1 — SAP Build Actions and Joule (development)

Status 2026-11-10: **both Actions projects released and published to the EU10 library (owner-approved);
execution still blocked by connectivity** (no deployed, reachable AssemblyImpact backend, no destination).
Joule skill *Engineering Case Lookup* configured and saved with 0 design errors; agent not deployed.

## What exists in SAP Build (EU10 trial tenant, shared)

| Artifact | Type | ID / location | State |
| --- | --- | --- | --- |
| AssemblyImpact Engineering Actions | Actions project (source: uploaded OpenAPI) | `eu10.sap-build-eu10-trial-2-97yhudg4.assemblyimpactengineeringactions` | 3 actions (find cases, get impact run, run impact); **Released + Published 1.0.0** |
| AssemblyImpact Engineering Read Actions | Actions project (custom actions) | `eu10.sap-build-eu10-trial-2-97yhudg4.assemblyimpactengineeringreadactions` | 2 read-only actions; Published 1.0.0, **Published 1.0.1** (current) |
| AssemblyImpact Engineering Assistant | Joule Agent and Skill project | `eu10.sap-build-eu10-trial-2-97yhudg4.assemblyimpactengineeringassistant` | skill *Engineering Case Lookup* configured (below); not released, not deployed |

The trial editor allows **3 actions per project**, so the two read-only operations live in a second project.
All five operations are discoverable in *Browse library* (search "AssemblyImpact").
Spec check before publishing: no credentials, hosts, tokens or tenant URLs in either project (paths are relative
to a destination). The publish dialog offered no LoB/Product fields on this trial tenant.

Second project, actions (paths relative to the destination):

| Action | HTTP | Path | Input | Output (`200`) |
| --- | --- | --- | --- | --- |
| Look up cases | GET | `/lookupCases` | query `caseNumber`, `status`, `assemblyCode` (optional, quoted OData strings, e.g. `'EC-000495'`) | `value[]`: ID, caseNumber, title, assemblyCode, plant, status, statusText, sourceType, latestRun_ID, latestRunStatus, latestRunAsOf, costDeltaTotal, currency, materialsShort, instructionFindings |
| Get decisions | GET | `/ReviewCases({ID})/decisions` | path `ID` (mandatory) | `value[]`: ID, reviewCase_ID, action, fromStatus, toStatus, actor, comment, at, basedOnRun_ID, evidenceStatus, warningsAcknowledged |

1.0.1 fix: in 1.0.0 the response schemas were stored under the editor's `default` response, which Joule treats
as an error schema (step outputs empty). 1.0.1 declares them under `200`; no path or input change.
`lookupCases` with the query-option form was verified against the running CAP service (`/lookupCases?caseNumber='EC-000495'`).

Members: owner only, except project 1 which shows "Everyone" after publishing. The tenant is a shared SAP trial
tenant; other users' projects and destinations are visible and were not used.

## Operation mapping

Input spec: `assemblyimpact-engineering-actions.openapi.json`, generated from the CAP model with
`@cap-js/openapi` 1.7.0 (`engineering-review.openapi.full.json`) and reduced by `make-actions-spec.mjs`.
SAP Build accepted the original three operations (0 unsupported), including the bound OData V4 action, so no
adapter is needed and the service contract is unchanged.

| Action (operationId) | HTTP | Path (relative to destination) | Input | Output | Errors |
| --- | --- | --- | --- | --- | --- |
| `FindEngineeringCases` | GET | `/ReviewCases` | `$filter` (e.g. `status eq 'IN_REVIEW'`), `$select`, `$expand=latestRun`, `$orderby`, `$top`, `$skip`, `$count`, `$search` | `value[]` of ReviewCases (caseNumber, assemblyCode, plant, revisions, status, latestRun_ID …) | 401 unauthenticated, 403 role missing |
| `GetEngineeringImpact` | GET | `/ImpactRuns({ID})` | path `ID` (from `latestRun_ID` or RunEngineeringImpact), `$expand=findings,materialLines,comparisonLines`, `$select` | ImpactRun with cost per assembly, cost delta, materials short, findings, material lines, BOM comparison | 401, 403, 404 (unknown or other plant) |
| `LookupEngineeringCases` | GET | `/lookupCases(caseNumber='…',status='…',assemblyCode='…')` | optional named filters | `value[]` (max 50) of case summaries with latest impact figures | 400 malformed filter, 401, 403 |
| `GetDecisionHistory` | GET | `/ReviewCases({ID})/decisions` | path `ID`, `$orderby=at` | `value[]` of decision events | 401, 403, 404 (other plant) |
| `RunEngineeringImpact` | POST | `/ReviewCases({ID})/EngineeringReview.runImpact` | path `ID`; body `{"asOfDate":"YYYY-MM-DD"}` | new immutable ImpactRun | 400 bad date, 401, 403 (not ChangeAnalyst or ImpactRunner), 404 (other plant), 409 (concurrent change) |

Rules carried into the Actions and the future Joule skills:
- All figures come from these responses. The agent never computes or invents stock, prices, findings or decisions.
- `RunEngineeringImpact` stays server-authorized (ChangeAnalyst + plant). The skill must ask the user to confirm before calling it.
- Plant isolation is enforced by the backend for every call (user attribute `plants`).

## Connectivity blocker (exact)

- The Actions **Test** tab requires an SAP BTP destination. The tenant lists only other projects'
  destinations; there is **no destination for the AssemblyImpact CAP service**, and the CAP source list
  contains only another user's service.
- The backend currently runs only as a private BAS preview with mocked basic authentication. It must not
  be exposed publicly, so it cannot be used as a destination.
- Required to execute the actions: deploy the CAP service to Cloud Foundry with XSUAA
  (`xs-security.json` with ChangeViewer/ChangeAnalyst and the `plants` attribute), then create a
  destination (OAuth2 client credentials or user propagation) and select it in the Actions Test tab.
  Deployment needs separate approval.

## Joule (status 2026-11-10)

Skill **Engineering Case Lookup** in the existing project (no new assistant created), saved, Design Console 0 errors:

1. Trigger inputs *Assembly Code*, *Case Status* (strings).
2. Call Action **Look up cases** (Read Actions 1.0.1), destination variable `assemblyImpactBackend`
   (project environment variable, not yet bound to a real destination); `assemblyCode ← Assembly Code`,
   `status ← Case Status`.
3. Branch **Default** (any non-2xx, including 401/403): Send Message "Engineering cases could not be retrieved",
   telling the user that sign-in or an engineering role for the plant is required and that Joule cannot bypass
   these checks.
4. Branch **Success 2XX** → End; skill output **Cases** (type `get_lookupCases_200_output_schema`) bound to the
   action result. Plant filtering is not done in the skill: the backend returns only the caller's plants.

Not yet configured (open): decision-history step (needs the case `ID` from the lookup result, i.e. a list
item selection), and the *Run engineering impact* skill with a *Send Confirmation Request* before the call.
Live test: blocked — no deployed backend and no destination to bind to `assemblyImpactBackend`.
Release/deploy of the Joule project: not done (separate approval).

Original plan:
1. Skill `Find engineering cases` using `FindEngineeringCases` (status/assembly filters).
2. Skill `Explain case impact` using `GetEngineeringImpact` (findings, shortages, cost delta).
3. Skill `Run engineering impact` using `RunEngineeringImpact`, with explicit user confirmation.
4. Agent `AssemblyImpact Engineering Assistant` combining the skills, with instructions to answer only
   from action results and to say when data is missing.
Using the actions in Joule requires releasing the Actions project; testing requires the destination above.

AI assistance: prepared with Claude (Anthropic) under owner authorization; student review pending.
