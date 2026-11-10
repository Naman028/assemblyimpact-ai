# Deployment of main@22158b7 to the US10 trial — 2026-11-10 (evidence)

Deployed by `cf deploy mta_archives/assemblyimpact-ai_0.5.0.mtar` (built with `mbt build` from `main@22158b7` in a
separate BAS clone). No `--delete-services` or `--delete-service-keys`; the deployer reported "Skipping deletion of services".

## Before deployment (deployed version was main@ca75e77)
- `MaterialConsumptionRates` and `whoAmI()` returned 404, so the running version predated PR #21.
- Safety checks on the build: 0 `.hdbtabledata`/CSV files in `gen/db`; the only new HDI artifacts were
  `assemblyimpact.MaterialConsumptionRates.hdbtable` and `EngineeringReview.MaterialConsumptionRates.hdbview`.

## Runtime evidence after deployment
- HDI deployer: "2 modified or added files", `Deploying "src/gen/assemblyimpact.MaterialConsumptionRates.hdbtable"`, "Deployment to container 42EAC27F…B41FB done".
- CAP service log: `connect to db > hana { … schema: '42EAC27F…B41FB' … }` (same container), "serving EngineeringReview", "server listening".
- `CDS_CONFIG={"features":{"demo_import":true}}` kept on `assemblyimpact-srv`; srv memory 512 MB, running.
- `systemStatus()`: authMode PRODUCTION, dataSourceMode NONE (no ERP source authorized), demoImport true.

## Record counts (OData, signed-in SAP ID user with plant 1000)

| Entity | Before deploy | After deploy | After `cf restart assemblyimpact-srv` |
|---|---|---|---|
| ReviewCases | 7 | 7 | 7 |
| BOMStates / BOMItems | 14 / 54 | 14 / 54 | 14 / 54 |
| CostPrices / StockSnapshots | 36 / 36 | 36 / 36 | 36 / 36 |
| Instructions | 13 | 13 | 13 |
| ImpactRuns / Findings | 1 / 7 | 1 / 7 | 1 / 7 |
| DecisionEvents | 0 | 0 | 0 |
| DataImports (audit) | 1 | 1 | 1 |
| CaseAttachments | 0 | 0 | 0 |
| MaterialConsumptionRates | 404 (not deployed) | 0 | 0 |

The persisted impact run `76c59610…` (COOL-100, +1,200.00 EUR, 2 materials short) is unchanged.
No attachments exist yet, so attachment persistence is not evidenced by data.
