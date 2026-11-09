# Synthetic development seed (SEED-M04-01)

These CSV files are **synthetic demonstration data** for the fictional company
NovaMotion Manufacturing. They are not SAP S/4HANA records and contain no real
prices, stock levels or engineering changes.

- Generated: `node tools/m04/build-seed.mjs` (check: `--check`). Do not edit by hand;
  `test/seed-data.test.js` fails if these files differ from the generator output.
- Source: `test/fixtures/m04/DS-ORACLE-01` (COOL-100, case EC-000473) plus a
  plant-2000 mirror (EC-200473) whose evidence references start with `PLANT-2000-MIRROR:`.
- Loaded by CAP in the development profile only. The test profile excludes this
  folder by configuration and the production profile never includes it.
- PUMP-200 (DS-DEMO-01) is intentionally absent (test-only, Decision A).
- Review cases start in status `OPEN` (M04 Slice 2a). Submission, approval and rejection
  happen only through the service actions, so the decision history contains real actions
  only; no decision events are seeded.
