# SAP HANA Cloud read-only verification (E10), 2026-11-11 00:39 CET

SAP **HANA Cloud** (HDI container `assemblyimpact-db`) is the productive database. SAP **S/4HANA** is not available (`dataSourceMode: NONE`); all cases are synthetic demo data.

- App: CF US10 trial, approuter -> `assemblyimpact-srv`; build at time of check 0c9c961, re-checked after deploy of 091bf2d.
- `systemStatus()`: `databaseKind: HANA`, `authMode: PRODUCTION`, `dataSourceMode: NONE`, `genaiMode: GEMINI` (after 091bf2d).
- Bindings (from deploy log 2026-11-10 23:45 UTC): `assemblyimpact-db` (HDI), `assemblyimpact-auth` (XSUAA), `assemblyimpact-destination`; services were updated in place, none recreated, `--delete-services` not used.
- Only GET requests. No reset, reseed, second database or SQLite fallback.

| Entity | Count | | Entity | Count |
|---|---|---|---|---|
| ReviewCases | 7 | | BOMStates | 14 |
| ImpactRuns | 1 | | BOMItems | 54 |
| ImpactComparisonLines | 4 | | CostPrices | 36 |
| ImpactMaterialLines | 4 | | StockSnapshots | 36 |
| Findings | 7 | | Instructions | 13 |
| DecisionEvents | 0 | | InstructionReferences | 38 |
| DataImports | 1 | | MaterialConsumptionRates | 0 |
| CaseAttachments | 0 | | | |

COOL-100 (EC-000473, OPEN), latest run 76c59610-...: COMPLETE_WITH_WARNINGS, revision A -> B, quantity 100,
cost 5600.00 -> 6800.00 EUR (+1200.00, +21.43 %), materials short 2 (BRKT-01 300/250, FAN-B 100/80), unknown 0, instruction findings 1, computed 2026-11-10 12:13 UTC.

Screenshot: `E10-01-worklist-hana-7-cases.jpg`. Raw timings: `api-latency-raw.csv`.
