# M04 Slice 1b — Engineering decision log

Milestone: M04 Slice 1b — synthetic dataset integration. Branch `feat/m04-slice1b`,
implementation commit `68d6501126a1dafcb9f35e0b65a226f11cfc9efb` (parent `eaf97f2`).
Decisions were proposed and implemented by Claude (Anthropic) under the owner's
milestone authorization of 2026-11-09; they are pending owner review.

| ID | Decision | Rationale | Alternatives rejected |
| --- | --- | --- | --- |
| D-1b-1 | Seed only COOL-100 (DS-ORACLE-01, case EC-000473) as application data; keep PUMP-200 (DS-DEMO-01) test-only. | Accepted Decision A (M04 v1.2): PUMP-200 is a rule-coverage fixture outside the product scope and must never be seeded or shown in the UI. The milestone's "reuse DS-DEMO-01" requirement is met by a test that loads DS-DEMO-01 into the test database and verifies a persisted `runImpact` against its expected results. | Seeding PUMP-200 (would silently reverse Decision A). Dropping DS-DEMO-01 coverage. |
| D-1b-2 | Add a labelled plant-2000 mirror of the COOL-100 scenario (case EC-200473). | Plant isolation must be demonstrable on seeded records, not only on test-inserted rows. The mirror copies only the case plant's rows; every evidence reference is prefixed `PLANT-2000-MIRROR:` and titles/descriptions say "mirror". | Inventing a second, unrelated scenario (no oracle, unverifiable figures). |
| D-1b-3 | Location `test/data` (CAP development/test data). | CAP 10.2.2 (installed) resolves `requires.db.data` to `db/data, db/csv, test/data` in development and to `db/data, db/csv` in production. Synthetic records therefore cannot reach a production deployment. Verified by an automated child-process test. | `db/data` (would be deployed to production as initial data). |
| D-1b-4 | The `test` profile sets `requires.db.data` to `db/data, db/csv`; `test/seed-data.test.js` opts in via `CDS_CONFIG`. | Existing Slice 1a and M03 suites insert their own COOL-100 rows and assert exact counts; auto-loading the seed would break their isolation. | Rewriting the existing suites (risk to verified Slice 1a evidence). |
| D-1b-5 | Generate CSVs from fixtures (`test/m04-seed.js` + `tools/m04/build-seed.mjs`) with name-based UUID keys; a test fails on drift. | One source of truth (the versioned fixtures and their independent oracle). Deterministic keys make the dataset reproducible byte-for-byte across machines. | Hand-written CSVs (drift risk, no oracle link). Random UUIDs (non-reproducible). |
| D-1b-6 | Do not seed `ImpactRuns`, lines or findings. | Runs are immutable snapshots that must be produced by `runImpact` (fingerprinted inputs). Seeding computed results would fabricate calculation history. | Pre-computed run CSVs. |
| D-1b-7 | Seed every `ReviewCases.version` and `Assemblies.version`. | `persistImpactRun` performs compare-and-set on `ReviewCases.version`; a null token would make the first run fail. M03 uses `Assemblies.version` as its ETag. | Leaving versions null. |
| D-1b-8 | Development mock users `analyst`, `cviewer` (plant 1000) and `analyst2000` (plant 2000), password `development-only`. | The development profile previously had no EngineeringReview role, so the seeded data could not be demonstrated with `npm start`. Mocked auth remains development/test only; production keeps `jwt`. | Running demos under the test profile. |
| D-1b-9 | Provenance labelling: `sourceType = SYNTHETIC_FIXTURE`, fixture evidence references, `[SYNTHETIC ...]` in assembly descriptions, `test/data/README.md`. | Synthetic data must be unmistakable in every consumer (OData, future UI). The Assemblies entity (M03) has no `sourceType`, so the label is carried in the description. | Adding a `sourceType` column to M03 Assemblies (out of scope; schema change). |

## Corrections during the milestone

| When | Issue | Correction |
| --- | --- | --- |
| E-06a (BAS) | One evidence check reported 400 instead of 405 for `DELETE ImpactRuns(...)`. | Harness error: the run ID was assigned inside a piped subshell and was empty. Re-run with the real ID (E-06b): DELETE and PATCH both 405, run still present. No application change. |
