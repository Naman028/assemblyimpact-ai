# AssemblyImpact AI — M05 integrated development milestone (report)

Date: 2026-11-09 · Baseline: `main` @ `5c11905` (PR #9 merged) · Data: synthetic (fictional NovaMotion Manufacturing)

## 1. Delivery: four stacked draft-PR branches

| # | Branch (base) | Content | Diff | Tests (cumulative) |
| --- | --- | --- | --- | --- |
| 1 | `feat/integrated-review-workspace` (`main`) | A review workflow (Slice 2b) · B scenarios + import · C Investigation Studio | 63 files, +3,334 / −50 | 95 / 95 |
| 2 | `feat/p2-s4-adapter` (#1) | E S/4HANA adapter (synthetic / sandbox / S/4 modes) | 12 files, +1,022 | 102 / 102 |
| 3 | `feat/p1-joule-skill-contract` (#2) | D Joule skill design + Actions contract tests | 7 files, +227 | 106 / 106 |
| 4 | `feat/btp-deployment-prep` (#3) | F HANA Cloud / XSUAA / MTA / app router (not deployed) | 13 files, +528 | 111 / 111 |

The branches are stacked to avoid repeated `package.json` conflicts; merge them in order. Every branch passed
lint (0 warnings), the full test suite, `npm audit --audit-level=high` (0) and the seed drift check
(`tools/m04/build-seed.mjs --check`). GitHub Actions has **not** run (see §6).

## 2. What was implemented and why

### A — Review workflow (M04 Slice 2b)
- **Approval evidence policy** (`srv/lib/review-decisions.js`): `basedOnRun` stays authoritative; the run's status
  is now checked. `INCOMPLETE` → 409 `EVIDENCE_INCOMPLETE`; `COMPLETE_WITH_WARNINGS` → 409
  `WARNINGS_ACKNOWLEDGEMENT_REQUIRED` unless `acknowledgeWarnings: true`; `COMPLETE` unchanged; unknown statuses fail
  closed. `DecisionEvents` stores `evidenceStatus` and `warningsAcknowledged` (audit). *Why:* before, a reviewer could
  approve a run with missing prices or stale stock without any trace of it.
- **Per-user action availability**: virtual `canRunImpact`, `canSubmit`, `canDecide`, `submittedBy`, computed from
  role, status and separation of duties (advisory; every action re-checks).
- **P3 worklist (Fiori elements)**: Submit / Approve / Reject header actions with `Core.OperationAvailable` and side
  effects, approve/reject default to the displayed run, Decision History section, readable run status, link to the
  Studio. *Limitation:* Fiori elements pages could not be rendered in this environment (`sap.fe` is not on npm and the
  SAPUI5 CDN is blocked); annotations are compile- and request-tested only — **check visually in BAS**.

### B — Scenarios and validated import (M05)
- `test/fixtures/m05/DS-SCENARIOS-01`: six independent changes, hand-calculated in `expected-results.json` and matched
  exactly by the engine:

| Case | Assembly | Change pattern | Run status | Cost delta | Short | WI findings |
| --- | --- | --- | --- | --- | --- | --- |
| EC-000481 | GEAR-300 | replace bearing, bolts 6→8, add shims | COMPLETE | +2,588.00 EUR (+7.99 %) | 2 | 1 |
| EC-000482 | CTRL-400 | replace board, remove obsolete relay | COMPLETE | −900.00 EUR (−3.88 %) | 0 | 2 |
| EC-000483 | VALVE-500 | seal material change, stale stock | COMPLETE_WITH_WARNINGS | +600.00 EUR (+5.67 %) | 0 | 0 |
| EC-000484 | CONV-600 | motor uprate, belt qty, unpriced new guard | INCOMPLETE | not calculable | 1 (+1 unknown) | 1 |
| EC-000485 | HYD-700 | multi-component (replace, remove, qty, add) | COMPLETE | +6,756.00 EUR (+35.49 %) | 2 | 3 |
| EC-000486 | MOTOR-800 | insulation kit, outdated instructions only | COMPLETE | +210.00 EUR (+0.27 %) | 0 | 2 |

  DS-ORACLE-01 / EC-000473 and the plant-2000 mirror are unchanged; PUMP-200 stays test-only; no impact runs are seeded.
- **Import** (`EngineeringReview.importScenario`, `srv/lib/scenario-import.js`): JSON or single-table CSV; role
  `DemoDataImporter`; feature flag on only in development/test; ≤512 KB / 2,000 records; checks for fields, codes,
  units, currencies, numbers/scales, dates, periods, duplicates, foreign keys, overlapping prices, no overwrite,
  one authorized plant, and engine calculability; dry-run preview; commit re-validates and writes in one transaction;
  provenance in `DataImports` (checksum, user, counts), `sourceType DEMO_IMPORT`, `IMPORT:<id>/…` evidence refs.

### C — Investigation Studio (P4)
Freestyle SAPUI5 app `app/investigation-studio` on the same OData service: case list → case workspace with KPI header
and tabs Assembly · BOM Comparison · Materials & Stock · Cost · Work Instructions · Findings · Evidence · Review. COOL-100
uses the curated component-addressable diagram; other assemblies a generated component schematic (labelled synthetic,
not CAD). Selecting a component (mouse or keyboard) synchronizes BOM change, stock, unit price, findings, instruction
steps and evidence references. Review actions, warning acknowledgement and the import dialog are integrated. No
calculation in the browser.

### D — P1 Joule / SAP Build Actions
`p1/joule/skills.json` (agent rules, three skills mapped to the existing operations, confirmation before running,
error handling per status, least-privilege identity), destination template, and a contract test that executes the three
operations against CAP and validates the responses against the Actions spec. It found real drift (new `sourceType`
values) which is fixed in the spec — **re-upload the reduced spec in the existing Actions project**.

### E — P2 S/4HANA adapter
`srv/integration/erp`: transport-independent extraction of one engineering change (two date-effective BOM states, unrestricted
stock, standard prices) from `API_BILL_OF_MATERIAL_SRV`, `API_MATERIAL_STOCK_SRV`, `API_PRODUCT_SRV`; contract verified
against SAP Cloud SDK VDM 2.1.0; mapped into the same import bundle and validation; provenance per mode
(`DEMO_IMPORT` / `SANDBOX_IMPORT` / `S4_IMPORT`). Tested against a local mock of the OData V2 services. See `docs/p2/S4HANA_Adapter.md`.

### F — BTP deployment preparation
Production profile (HANA, XSUAA), `xs-security.json` derived from the model's roles with the `plants` attribute and
role collections, `mta.yaml`, app router, opt-in demo-data extension, rollback/cleanup. `cds build --production`
verified. See `docs/btp/Deployment.md`.

## 3. Tests actually executed (final gate, branch 4)
111 tests, 0 failures: 71 baseline (4 adjusted for the larger seed: counts and the illustration rule; 1 production-auth
test isolated from the new HANA requirement) + 40 new (`m05-review-workflow` 5, `m05-scenarios` 4, `m05-import` 9,
`m05-investigation-studio` 6, `p2-erp-adapter` 7, `p1-actions-contract` 4, `btp-deployment-config` 5).
Also: ESLint 0 warnings; `npm audit` 0 high; seed drift check; a pattern scan of the diff for secrets (none);
`cds build --production` (cds-dk 10.2.1).

UI evidence (`docs/evidence/m05/screenshots`, headless Chromium, OpenUI5 1.149.0 from npm, CAP development profile):
1 HYD-700 component selected · 2 COOL-100 curated diagram · 3 materials & stock · 4 approve dialog with warning
acknowledgement · 5 decision history after approval · 6 INCOMPLETE run "not calculable" · 7 import validation errors ·
8 imported case in the list · 9 phone layout. The flows were driven through the UI (run → submit as `analyst` →
acknowledge and approve as `approver`; invalid and valid import).

## 4. Status of the four exam projects

| Project | Status after this milestone |
| --- | --- |
| P1 Joule & agents | Skill design and contracts complete and tested; Joule Studio configuration, release and live test need the owner + a deployed backend |
| P2 S/4HANA + GenAI | Adapter and contract tests complete; no live S/4 or sandbox call (blockers below); GenAI explanation still disabled by design |
| P3 Fiori app (BAS / Accelerator) | Review workflow actions and history added; visual check in BAS pending |
| P4 Fiori on BTP | Studio implemented and demonstrated locally; deployment prepared, not executed |

## 5. External blockers (recorded once, not worked around)
1. **GitHub push / draft PRs**: this session is not authorized for `Naman028/assemblyimpact-ai` (proxy 403) and the
   linked computer was offline. Branches are delivered as a git bundle with push instructions.
2. **SAP API sandbox**: needs a personal API key; `sandbox.api.sap.com` is unreachable from this environment.
3. **Real S/4HANA**: no authorized system/destination.
4. **SAP Build**: live Actions test and Joule release need a deployed backend + destination and owner actions.
5. **BTP provisioning/deployment**: requires separate authorization.
6. **Fiori elements rendering** of P3 not possible here (see §2 A).

## 6. Generative AI usage (for the project report)
- Tool: Claude (Anthropic), in Claude Cowork, working on a clone of the repository.
- Prompt: the owner's instruction "AssemblyImpact AI — Autonomous Integrated Development Execution" (deliverables A–F,
  efficiency, GitHub and reporting rules), plus the course's *Final Exam Projects* brief.
- AI-generated: all code, fixtures, tests, documentation and screenshots in these four branches.
- Human-supplied: requirements, existing baseline, approved mockups and contracts, design decisions recorded in earlier
  milestones. Students must still review, run in BAS, and decide on merge.
- Validation performed by the AI: hand calculations for every new scenario before running the engine; full regression
  per branch; UI flows driven in a real browser; API field names checked against SAP Cloud SDK VDM packages.
- Commits use the project's configured author (Naman Patel, noreply e-mail) as instructed, without AI co-author
  trailers; this section is the AI-assistance disclosure.
