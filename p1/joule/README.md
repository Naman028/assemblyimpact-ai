# P1 — Joule skill design and integration contract (status 2026-11-09)

Continues the existing SAP Build projects (**not recreated**): Actions project *AssemblyImpact Engineering Actions*
(5 operations after this update) and Joule project *AssemblyImpact Engineering Assistant*.

| File | Purpose |
| --- | --- |
| `skills.json` | Agent instructions, four skills with inputs, action steps, outputs, error handling, the confirmation rule and the role collection each skill needs; identities. Checked by `test/p1-actions-contract.test.js`. |
| `destination.template.json` | BTP destination template (placeholders only, no secrets) for the deployed CAP service. |
| `../build-actions/*.openapi.json` | Actions spec. M05 change: `sourceType` enum gained `DEMO_IMPORT`, `SANDBOX_IMPORT` (additive). Re-upload the reduced spec in the existing Actions project (*Update API specification*), keep the existing operation IDs; the reconciliation adds `LookupEngineeringCases` and `GetDecisionHistory` (read-only, from PR #11). |

## What was verified here
`test/p1-actions-contract.test.js` executes all five operations against the CAP service exactly as SAP Build would
(relative paths under the destination) and validates every response against the spec's response schemas, plus the
documented 403/404 behaviour. The contract drift it found (new source types missing in the enum) is fixed in the spec.

## Not done here (needs the owner in SAP Build / BTP, no workaround)
1. Configure the four skills in Joule Studio from `skills.json` (the studio's data-protection disclaimer must be
   accepted by the project owner first).
2. Live Actions test: blocked by the same dependency as before — **a deployed CAP backend with XSUAA and a destination**
   (`destination.template.json`). The deployment configuration (`mta.yaml`, `xs-security.json`) is in the repository and needs separate approval.
3. Releasing the Actions project and deploying the Joule project to the shared tenant: not done (requires authorization).

Identity (review finding C1, decided; reconciled with PR #11): **principal propagation only** (`OAuth2JWTBearer`
destination), split into two role collections:

| Role collection | Roles | Skills |
| --- | --- | --- |
| `AssemblyImpact_JouleReader` (default) | ChangeViewer | find_engineering_cases, explain_case_impact, review_decision_history |
| `AssemblyImpact_JouleImpactRunner` | ChangeViewer + ImpactRunner | additionally run_engineering_impact (confirmed per run) |

Reading never carries the right to calculate, and neither collection can submit, approve, reject, import or extract
from the ERP: the server refuses these (403), not only the skill text (`test/p1-actions-contract.test.js`).

Enforcement layers (review finding): a token exchanged by `OAuth2JWTBearer` would otherwise carry **all** of the
user's scopes, so a person holding `AssemblyImpact_Analyst` + `AssemblyImpact_JouleReader` could run calculations
through Joule. The destination therefore sets `scope` to `<xsappname>.ChangeViewer <xsappname>.ImpactRunner`
(`destination.template.json`): XSUAA issues only the intersection of these and the user's own scopes. The Actions
spec additionally exposes no decision, import or ERP operation, and the server checks role and plant on every call.
To verify after deployment: decode the exchanged token for an Analyst + JouleReader user — `scope` must not contain
`ChangeAnalyst`, and RunEngineeringImpact must return 403. Plants
always come from the signed-in user. PR #11's `JouleReader` client-credentials identity (plants from server
configuration) was deliberately not carried over: it would bypass per-user plant isolation and hide who asked.
