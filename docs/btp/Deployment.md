# BTP deployment preparation (prepared, NOT deployed)

Status 2026-11-09: configuration and code only. No HANA Cloud instance, XSUAA instance, Cloud Foundry space or
destination was provisioned, and nothing was deployed. Each of these needs the owner's separate authorization.

## What is prepared

| Item | File | Verified by |
| --- | --- | --- |
| SAP HANA Cloud persistence (HDI container, `hdi-shared`) | `package.json` `[production].db.kind = hana`, `@cap-js/hana` | `cds build --production` (cds-dk 10.2.1) produced `gen/db` with 50+ `.hdbtable/.hdbindex` artefacts; test |
| XSUAA: scopes/role templates for every role in the CDS model, `plants` attribute, role collections | `xs-security.json` | `test/btp-deployment-config.test.js` derives roles from the compiled model |
| Separation of duties | role collections Analyst / Approver / Viewer / JouleReader / JouleImpactRunner / ErpExtractor | test (Analyst ∌ Approver; JouleReader = Viewer only; JouleImpactRunner = Viewer + ImpactRunner) |
| MTA: CAP service, HDI deployer, app router, destination service | `mta.yaml` | YAML parsed and checked in test |
| App router: XSUAA login on every route, CSRF on OData, both UIs served from local resources | `app/router/xs-app.json`, `tools/btp/stage-ui.mjs` | test; staging script executed |
| Controlled demo data (opt-in) | `mta-demo.mtaext`, `tools/btp/stage-demo-data.mjs` | seed staged into `db/data` before the build, so `cds build` generates `.hdbtabledata`; removed afterwards |
| Demo import disabled in production | `[production].features.demo_import = false` | test |
| Joule/Actions destination | `p1/joule/destination.template.json` (branch `feat/p1-joule-skill-contract`) | placeholders only |
| S/4HANA destinations | `docs/p2/S4HANA_Adapter.md` (branch `feat/p2-s4-adapter`) | blocked: no authorized system |
| GenAI explanation destination | `ASSEMBLYIMPACT_GENAI_HUB` → SAP AI Core (`docs/p2/S4HANA_Adapter.md`, section GenAI) | blocked: needs an AI Core instance, a foundation-model deployment and `cds.requires.genai` values |

UI5: both apps keep loading SAPUI5 1.149.0 from the SAP CDN (`index.html`); no bundling step is required.

## Deployment steps (after approval)

1. Subaccount with Cloud Foundry space, entitlements: SAP HANA Cloud (+ a running instance), `hana/hdi-shared`,
   `xsuaa/application`, `destination/lite`. Note: HANA Cloud trial instances stop nightly.
2. `npm ci && npm test` (must be green), then `mbt build` (or `mbt build -e mta-demo.mtaext` for a demo space).
3. `cf login` → `cf deploy mta_archives/assemblyimpact-ai_0.5.0.mtar`.
4. BTP cockpit: create the role collections listed in `docs/btp/role-collections.json` (roles from the templates
   with the `plants` attribute: static value such as `1000`, or an IdP attribute), then assign users. Without a
   `plants` value every request is refused (fail closed).
5. Smoke test: open the router URL → Investigation Studio; analyst runs impact and submits; a different approver
   approves. Check `/odata/v4/engineering-review/$metadata` is not reachable without a token.
6. For P1: create destination `ASSEMBLYIMPACT_ENGINEERING` from the template with a dedicated XSUAA service key
   (role collection `AssemblyImpact_JouleReader`, plus `AssemblyImpact_JouleImpactRunner` for users who may run calculations), select it in the existing Actions project's Test tab.

## Rollback and cleanup

- Rollback application **without the database module**:
  `cf deploy <previous>.mtar -m assemblyimpact-srv -m assemblyimpact-router`. Redeploying the old HDI deployer
  would migrate the tables back and drop the new audit columns (`DecisionEvents.evidenceStatus`,
  `warningsAcknowledged`, `ReviewCases.sourceImport_ID`). The schema change is additive (nullable columns, new table
  `DataImports`, new unique indexes), so the previous application runs against the newer schema. Schema rollback is
  forward-only.
- Remove everything: `cf undeploy assemblyimpact-ai --delete-services --delete-service-keys` (deletes the HDI
  container and all data, the XSUAA instance and the destination instance). Remove role-collection assignments
  and any manually created destinations in the cockpit.

AI assistance: prepared with Claude (Anthropic) under the owner's instruction; review pending.
