# AssemblyImpact AI — final execution report (2026-11-10)

Branch `feat/faculty-demo-completion` → draft PR #18 to `main` (base `8246abb`). CI `verify` green.
`npm test` 149/149 · `npm run lint` clean · `npm audit --omit=dev` 0 vulnerabilities.

## Requirement → evidence

| Area | Requirement | Status | Evidence |
|---|---|---|---|
| P1 | SAP Build Actions project for Joule | Exists, **not released** | Tenant EU10 trial: "AssemblyImpact Engineering Actions", owner-only, 3 of 5 contract operations (missing `lookupCases`, decision history). Contract: `p1/build-actions/assemblyimpact-engineering-actions.openapi.json` |
| P1 | Joule agent and skills | Exists, **not deployed** | Lobby: "AssemblyImpact Engineering Assistant" (Joule Agent and Skill), no version |
| P1 | Genuine Joule execution | **Blocked (gate)** | No AssemblyImpact destination in the tenant; the backend is not deployed. Other users' destinations were not used |
| P2 | S/4HANA extraction | Contract + sandbox adapter only | `test/p2-erp-adapter.test.js`; S/4 disabled in production config; no S/4 credentials of our own |
| P2 | GenAI explanation | Fixture only (labelled) | `test/fixtures/p2/genai`; no live model claimed |
| P3 | Case worklist (Fiori elements) | Done | `docs/evidence/faculty-demo/14-worklist-via-launchpad.jpg` |
| P4 | Investigation Studio | Done | screenshots 02–13 |
| P3/P4 | One entry, shared navigation, case kept | Done | `app/launchpad.html`, intents `EngineeringCase-manage/-investigate`; screenshot 01 |
| P3/P4 | BAS Storyboard lists UI apps | Fixed | `sapux` registration + app package.json/ui5.yaml |
| Demo | Create scenario by form | Done | screenshots 03–05 (EC-000495) |
| Demo | Deterministic impact from new data | Done | +5,340.00 EUR = (195.10 − 150.60) × 120, screenshot 06 |
| Demo | Input edit gives a correct new result; old runs immutable | Done | 2→3 → +6,720.00 EUR, screenshots 07–09; `test/demo-data.test.js` |
| Demo | PNG/JPEG evidence, secure | Done | content sniffing, 2 MB, plant-scoped, nosniff, frozen after OPEN; screenshot 10 |
| Demo | Review decision → back to worklist | Done | screenshots 11–14 |
| BTP | Build readiness | `mbt build` OK in BAS | `assemblyimpact-ai_0.5.0.mtar` (12 MB), not deployed |

## Review (one AI model, ten review angles)
No blockers. Fixed with failing-first tests: STOCK edits changed shared plant data (HIGH);
attachments could change during review (MEDIUM). Open LOW items: Edit Input button visible to
users without the importer role (server returns 403); oversized uploads are read to the end before
the 413; two simultaneous first uploads are not compare-and-set; an attachment row created
without an upload shows as 0 KB; the scenario form's example case number repeats on reuse.

## Owner decisions needed
1. Approve and merge PR #18.
2. Close PRs #10 and #11 without merging (feature parity confirmed; the closing call was blocked for the assistant).
3. Deployment to BTP (HANA, XSUAA, app router), then destination + Actions release + Joule deploy for a genuine Joule run.
4. Delete the backup branches `backup/pr13…pr16` once satisfied.

## AI disclosure
Implementation, tests, review and screenshots were produced with an AI assistant (Claude) under the owner's direction.
