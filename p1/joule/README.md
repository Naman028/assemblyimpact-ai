# P1 — Joule skill design and integration contract (status 2026-11-09)

Continues the existing SAP Build projects (**not recreated**): Actions project *AssemblyImpact Engineering Actions*
(3 operations) and Joule project *AssemblyImpact Engineering Assistant*.

| File | Purpose |
| --- | --- |
| `skills.json` | Agent instructions, three skills with inputs, action steps, outputs, error handling and the confirmation rule; technical identity. Checked by `test/p1-actions-contract.test.js`. |
| `destination.template.json` | BTP destination template (placeholders only, no secrets) for the deployed CAP service. |
| `../build-actions/*.openapi.json` | Actions spec. M05 change: `sourceType` enum gained `DEMO_IMPORT`, `SANDBOX_IMPORT` (additive). Re-upload the reduced spec in the existing Actions project (*Update API specification*), keep the three operation IDs. |

## What was verified here
`test/p1-actions-contract.test.js` executes all three operations against the CAP service exactly as SAP Build would
(relative paths under the destination) and validates every response against the spec's response schemas, plus the
documented 403/404 behaviour. The contract drift it found (new source types missing in the enum) is fixed in the spec.

## Not done here (needs the owner in SAP Build / BTP, no workaround)
1. Configure the three skills in Joule Studio from `skills.json` (the studio's data-protection disclaimer must be
   accepted by the project owner first).
2. Live Actions test: blocked by the same dependency as before — **a deployed CAP backend with XSUAA and a destination**
   (`destination.template.json`). Deployment is prepared on branch `feat/btp-deployment-prep` and needs separate approval.
3. Releasing the Actions project and deploying the Joule project to the shared tenant: not done (requires authorization).

Identity (review finding C1, decided): **principal propagation only** (`OAuth2JWTBearer` destination). Users of the
assistant get the role collection with **ChangeViewer + ImpactRunner**: read and run the deterministic calculation in
their own plants, nothing else. Submit, approve, reject, import and ERP extraction are refused by the server (403),
not only by the skill text (`test/p1-actions-contract.test.js`). Runs are attributed to the signed-in person. A
client-credentials technical user is not supported (no `plants` attribute, no personal attribution).
