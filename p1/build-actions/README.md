# P1 — SAP Build Actions and Joule (development)

Status 2026-11-09: **Actions project created; execution blocked by connectivity** (no deployed, reachable
AssemblyImpact backend). Joule project created; skills not yet configured (see "Joule").

## What exists in SAP Build (EU10 trial tenant, shared)

| Artifact | Type | ID / location | State |
| --- | --- | --- | --- |
| AssemblyImpact Engineering Actions | Actions project (source: uploaded OpenAPI) | `eu10.sap-build-eu10-trial-2-97yhudg4.assemblyimpactengineeringactions` | created, 3 actions, editable `main`, not released |
| AssemblyImpact Engineering Assistant | Joule Agent and Skill project | `eu10.sap-build-eu10-trial-2-97yhudg4.assemblyimpactengineeringassistant` | created, empty; studio disclaimer awaiting owner acceptance |

Members of both projects: owner only ("Me"). The tenant is a shared SAP trial tenant; other users'
projects and destinations are visible and were not used.

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

## Joule

The project was created through *Create → Joule Agent and Skill* (Joule Studio, classic edition).
Opening the studio shows a data-protection disclaimer that the owner must accept. Planned next steps:
1. Skill `Find engineering cases` using `FindEngineeringCases` (status/assembly filters).
2. Skill `Explain case impact` using `GetEngineeringImpact` (findings, shortages, cost delta).
3. Skill `Run engineering impact` using `RunEngineeringImpact`, with explicit user confirmation.
4. Agent `AssemblyImpact Engineering Assistant` combining the skills, with instructions to answer only
   from action results and to say when data is missing.
Using the actions in Joule requires releasing the Actions project; testing requires the destination above.

AI assistance: prepared with Claude (Anthropic) under owner authorization; student review pending.
