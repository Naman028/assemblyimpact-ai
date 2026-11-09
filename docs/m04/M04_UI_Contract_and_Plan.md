# AssemblyImpact AI — P3/P4 UI Contract and M04 Implementation Plan (v1.2, draft for owner approval)

> v1.1 corrections: C-02 (instructions moved into Slice 1a), C-05 (per-entity plant isolation tests), C-01 (P3/P4 show COOL-100 only). See `M04_Corrections_v1.1.md`.

**Status:** prepared, not implemented. Entity and field names refer to the planned schema in `M04_Data_Contract.md` §7. None of them exist in the repository yet, except `Assemblies`.

## 1. Two applications, one backend

| | P3 — Case Worklist | P4 — Engineering Investigation Studio |
|---|---|---|
| Type | SAP Fiori elements OData V4, List Report + Object Page | Freestyle SAPUI5 (OData V4 model) |
| App ID (proposal) | `assemblyimpact.caseworklist` | `assemblyimpact.investigationstudio` |
| Origin | AI-assisted: Project Accelerator output (sandbox) or the standard Fiori generator, with student modifications recorded separately | Hand-built |
| Service | `EngineeringReview` at `/odata/v4/engineering-review` (new), plus the existing `AssemblyCatalog` for assembly master data | Same service |
| Business logic in UI | None | None — display, input and calling CAP actions only |
| Demonstrable alone | Yes | Yes (deep link with case ID) |

**Enforced in CAP, never only in the browser or an LLM:**
- comparison, cost, stock and instruction results (action `runImpact`, ruleset 1.1.0)
- review transitions (`submitForReview`, `approve`, `reject`, with separation of duties)
- plant/role authorization
- ETag concurrency

## 2. P3 Case Worklist — mapping to OData

**Filter bar:**
- Assembly — `assembly/assemblyCode`, value help from `AssemblyCatalog.Assemblies`
- Plant — `plant`
- Proposed revision — `toState/revision`
- Review status — `status`, code list
- Source type — `sourceType`, code list

| Column (mockup) | Binding | Rule / correction |
|---|---|---|
| Assembly | `assembly/assemblyCode` | — |
| Change ID | `caseNumber` | — |
| Current Rev. | `fromState/revision` | Add **Proposed Rev.** (`toState/revision`) |
| Instruction Findings | `latestRun/instructionFindings` | Oracle: **1**, not "2 instruction updates" |
| Stock Exposure | `latestRun/materialsShort` and `latestRun/materialsUnknown`, criticality | Show "2 materials short", **not "Gap (70 units)"** — units of different materials must not be added up |
| Estimated Cost Delta | `latestRun/costDeltaTotal` (EUR) and `latestRun/costDeltaPercent` | Oracle: **+1,200.00 EUR (+21.43 %)**, not +1,250 (~+6.2 %). An INCOMPLETE run shows "Not calculable" with a reason, never 0.00. |
| Source Type | `sourceType` | COOL-100 is **Synthetic Fixture**. "GenAI Proposal" appears only after the P2 gate. |
| Review Status | `status` with criticality | — |
| (new) Data label | constant header text | "Synthetic demo data — NovaMotion Manufacturing" on every page |

**Object Page sections** (matches the generation request):
- General Information
- Findings (`latestRun/findings`)
- Material Impact (`latestRun/materialLines`)
- Decision History (`decisions`, slice 2)
- Header action: **Open Investigation Studio**

Slice 1 is read-only. There is no "Create Change" button; that comes later with a CAP action and validation.

## 3. P4 Engineering Investigation Studio — mapping

| Area (mockup) | Binding | Correction |
|---|---|---|
| Header | `/ReviewCases(ID)` with `assembly`, `fromState`, `toState` expanded | Revision A → B from BOM states |
| Assembly Overview images | static illustrations, labelled "illustrative" | Images are not evidence |
| BOM Comparison | `latestRun/comparisonLines` | Use material codes (BRKT-01, SENS-01, SEAL-01), not "BRACKET/SENSOR/SEAL"; display "FAN-A → FAN-B" |
| Work Instructions tab | `Instructions` filtered by assembly, with references; findings of type OUTDATED_INSTRUCTION_REFERENCE | WI IDs pending handbook reconciliation (mockup: WI-COOL-100-A/-B; fixture: WI-COOL-100-ASM/-TST) |
| Material & Cost Impact | `latestRun/materialLines` + cost totals | Show all Rev B materials (SENS-01 and SEAL-01 too), or a "shortages only" toggle. Replace "ILLUSTRATIVE — DEPENDS ON ASSUMED PRICES" with the computed **+€1,200.00** and "synthetic standard prices, EUR". |
| Evidence & Provenance | `evidenceRefs` of findings, dataset ID/version, ruleset, `computedAt` | Replace "Generated On 15 Jan 2025 (demo)" with the run's `computedAt` |
| AI Explanation | **disabled until the P2 gate** | Panel reads "No AI explanation — deterministic findings only". Later, every sentence must cite a finding/evidence ID. |
| Review tab / "Create Review Proposal", "Save" | CAP actions `submitForReview`, PATCH with `If-Match` | Transitions validated in CAP |

## 4. Navigation and binding

- **P3 → P4:**
  - Standalone: URL `…/investigation-studio/index.html#/cases/{ID}`
  - In a launchpad later: intent `EngineeringChange-investigate?caseId={ID}`
- **P4 → P3:** back navigation, or intent `EngineeringChange-manage`.
- Both apps bind the same entity key (`ReviewCases.ID`). P4 never re-computes; it calls `runImpact` and re-reads `latestRun`.

## 5. UI states (both apps)

| State | Trigger | Behaviour |
|---|---|---|
| Loading | request pending | Busy indicator; no stale values shown as current |
| Empty | 0 cases or 0 findings | Illustrated message ("No review cases for your plants") |
| Success | 200 | Data and run timestamp |
| Invalid | 400 | Field-level message from CAP message target; nothing is saved |
| Unauthorized | 401/403, or 404 for another plant's case | Message page; no data leak (same as M03 404/412 masking) |
| Stale | 412 ETag mismatch; run STALE flag | "Changed by someone else — reload"; stock-age warning badge |
| Disconnected | network/5xx | Retry option; no optimistic state changes |
| Incomplete calculation | run INCOMPLETE | Values shown as "Not calculable" with the missing-input reason (e.g. MISSING_PRICE) |

## 6. Ordered implementation plan

Each step happens only after your approval. Work goes on branch `feat/m04-slice1` — no push or merge without authorization.

**Step 0 — Accelerator evidence** (approval pending, see Kickoff Report §B)

**Step 1 — Slice 1a: COOL-100 impact core incl. instruction checks (backend, read-only + one action)**

| File | Change |
|---|---|
| `db/schema.cds` | Append BOMStates, BOMItems, CostPrices, StockSnapshots, **Instructions, InstructionReferences**, ReviewCases, ImpactRuns, Findings (+ line entities if approved), code lists. `Assemblies` untouched. Associations named `reviewCase` (not `case`). |
| `srv/engineering-review.cds` (new) | Read-only projections, plant-scoped `@restrict`, bound action `runImpact` |
| `srv/engineering-review.js` (new) | Auth/plant checks, input fingerprint, persist run + findings |
| `srv/lib/impact-calculator.js` (new) | Pure deterministic ruleset 1.1.0 implementation (written against the spec, not translated from `tools/m04/oracle.py`) |
| `test/data/*.csv` (new) | DS-ORACLE-01 only, with deterministic UUIDs. DS-DEMO-01 is used inside unit tests only (not seeded). |
| `test/fixtures/m04/**` (new) | Fixtures, `expected-results.json`, `DS-NEG-01/cases.json`, oracle tools |
| `test/impact-calculator.test.js` (new) | Golden tests |
| `test/engineering-review.test.js` (new) | HTTP tests |
| `package.json` | Test script includes the new test files; mocked users get the new roles |
| `readme.md` | Contract and evidence register update |

Acceptance tests (all must be executed and recorded):
1. M03 regression: 13/13 existing tests unchanged and passing; lint 0; audit 0.
2. The calculator reproduces both `expected-results.json` files exactly (cost, percent, comparison, stock, findings, status).
3. All 15 DS-NEG-01 outcomes reproduced.
4. HTTP:
   - A plant-2000 user cannot see or run COOL-100.
   - A viewer gets 403 on `runImpact`.
   - Re-running with unchanged inputs gives the same fingerprint and results.
   - Runs and findings cannot be written by clients (405/403).
   - **Every exposed entity** (ReviewCases, Findings, ImpactRuns, BOMStates, BOMItems, CostPrices, StockSnapshots, Instructions, InstructionReferences) returns 0 rows to a plant-2000 user via direct GET, `$count` and `$expand` (C-05).
   - Expected findings: 7 for EC-000473 including the OUTDATED_INSTRUCTION_REFERENCE (now testable because instructions are in this slice).

**Step 2 — Slice 1b: P3 worklist on real OData**
- `app/case-worklist/` comes from the Fiori generator or is ported from the Accelerator sandbox. Each ported file gets an origin header, and generated-vs-modified files are recorded in the evidence register.
- Annotations go in `app/case-worklist/annotations.cds`.
- Acceptance:
  - LR shows EC-000473 with 1 / 2 short / +1,200.00 EUR (+21.43 %). (PUMP-200 is not seeded — C-01.)
  - Filters work.
  - OP shows 7 findings for EC-000473.
  - A wrong-plant user sees an empty list.
  - Screenshot evidence; one OPA5 journey.

**Step 3 — Slice 2:**
- DecisionEvents + review transitions (separation of duties)
- P3 Decision History

**Step 4 — Slice 3:** P4 studio, hosted persistence (HANA) and deployment — each a separate approval.

**Separate gates:**
- P2 GenAI: provider/model access, authorized S/4HANA records, AIUsageEvents
- P1 Joule Studio availability

These stay blocked until verified. Synthetic data does not satisfy them.
