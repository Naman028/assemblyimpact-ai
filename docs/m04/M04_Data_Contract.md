# AssemblyImpact AI — M04 Data Contract (v1.2.0, draft for owner approval)

> v1.1 corrections (9 Nov 2026): see `M04_Corrections_v1.1.md` (C-01…C-07). v1.0 is preserved unchanged.

| Field | Value |
|---|---|
| Date | 8 Nov 2026 |
| Status | **Prepared, not implemented.** No repository file was changed. |
| Datasets | `DS-ORACLE-01` (4-component oracle; the only dataset seeded into the app), `DS-DEMO-01` (PUMP-200 — **test-only rule-coverage fixture, outside product scope, never seeded or shown**), `DS-NEG-01` (16 negative/edge cases) |
| Ruleset | `1.1.0` (deterministic; implemented in `tools/m04/oracle.py`) |
| Label on every record | `SYNTHETIC_FIXTURE` — fictional company *NovaMotion Manufacturing*; never SAP S/4HANA data |

## 0. Input availability and value provenance

| Input | Available to me? | Effect |
|---|---|---|
| Implementation Handbook (.docx) | **No** (not uploaded) | Fixed oracle values taken from the handbook figures quoted in your M04 kickoff text. Anything else is marked **PROPOSED**. |
| Blueprint (.docx) | **No** (only the 3 extracted mockup images) | UI references used as images only. |
| Course overview PDF | **No** | Academic mapping not verified. |

Every fixture row carries `valueStatus` or a manifest note:
- **HANDBOOK** — value quoted in the kickoff text (COOL-100 BOM A/B, prices, FAN-B and BRKT-01 stock, quantity 100, €56/€68/+€1,200).
- **PROPOSED** — invented here to make the dataset complete; needs owner confirmation against the handbook.

| PROPOSED item | Value | Why it was needed |
|---|---|---|
| SENS-01 and SEAL-01 stock | 120 and 150 PC (sufficient) | Kickoff gives stock only for FAN-B and BRKT-01; without these, availability for the other Rev B components is UNKNOWN |
| FAN-A stock | 40 PC | Proves only target-revision materials are assessed |
| Work instruction IDs, versions and steps | WI-COOL-100-ASM v2/v3, WI-COOL-100-TST v2 | Kickoff requires "two applicable versioned instructions, one with an outdated reference" but gives no IDs. Mockup shows `WI-COOL-100-A / -B` — reconcile with the handbook. |
| BOM usage / alternative / validity | usage `1`, alternative `01`, Rev A 2026-01-01…2026-11-30, Rev B from 2026-12-01 | Required for comparability rules |
| Price basis | `SYNTHETIC_STANDARD_PRICE`, price unit 1 PC, EUR | Kickoff gives unit prices only |
| Severity rules, stale threshold (7 days) | see §3 | Needed for deterministic findings |
| Whole `DS-DEMO-01` | PUMP-200, 15 materials | Kickoff requires a 10–15-component fixture but gives no values |

## 1. Versioning and determinism

- Dataset IDs and semantic versions are in each `manifest.json`. Any value change → new dataset version; any rule change → new ruleset version. `expected-results.json` records both.
- No randomness, no "today": all date logic uses the manifest `referenceDate` (2026-11-08).
- Stable business IDs (`BOM-COOL-100-B`, `EC-000473`, item `0010`, …). When seeded into CAP, technical UUIDs must be derived deterministically (UUIDv5 of the stable ID), so tests and links are reproducible.
- Every record has `sourceType` and `evidenceRef` (e.g. `DS-ORACLE-01/bom_items/BOM-COOL-100-B/0010`). Findings cite the evidence refs they were derived from.

## 2. Canonical oracle — `DS-ORACLE-01` (COOL-100, plant 1000, quantity 100)

| Item | Rev A | Rev B | Unit price | Change |
|---|---|---|---|---|
| 0010 | FAN-A × 1 | FAN-B × 1 | €35 → €42 | REPLACED |
| 0020 | BRKT-01 × 2 | BRKT-01 × 3 | €3 | QUANTITY_CHANGED |
| 0030 | SENS-01 × 1 | SENS-01 × 1 | €15 | UNCHANGED |
| 0040 | — | SEAL-01 × 1 | €2 | ADDED |

| Expected result | Value | Source |
|---|---|---|
| Cost per assembly A → B | **€56.00 → €68.00** (+€12.00) | HANDBOOK, reproduced |
| Totals for 100 | €5,600.00 → €6,800.00 | derived |
| **Cost delta for 100** | **+€1,200.00** | HANDBOOK, reproduced |
| Delta percent | **+21.43 %** (1,200 / 5,600) | derived |
| FAN-B need / available / gap | 100 / 80 / **20** | HANDBOOK |
| BRKT-01 need / available / gap | 300 / 250 / **50** | HANDBOOK |
| SENS-01, SEAL-01 | 100 / 120 / 0; 100 / 150 / 0 | PROPOSED |
| Materials short | **2** | derived |
| Applicable instructions | WI-COOL-100-ASM v3 (consistent), WI-COOL-100-TST v2 (**step 0030 still references FAN-A**) | PROPOSED IDs |
| Instruction findings | **1** (1 instruction to update) | derived |
| Findings | 7: Replaced (Medium), Quantity changed (Low), Added (Low), Cost change (Medium), Stock gap FAN-B (High), Stock gap BRKT-01 (High), Outdated instruction reference (High) | derived |
| Run status | COMPLETE | derived |

## 3. Deterministic ruleset 1.1.0 (v1.0 was 1.0.0; 1.1.0 adds the R-INS-1 validFrom check)

| ID | Rule |
|---|---|
| R-VAL-1 | Production quantity must be an integer ≥ 1, otherwise REJECTED `INVALID_PRODUCTION_QUANTITY`. |
| R-VAL-2 | From/to BOM states must exist (`MISSING_BOM_STATE`) and share assembly, plant, BOM usage and alternative (`NON_COMPARABLE_BOM_STATES`). The case's assembly/plant must match (`CASE_BOM_MISMATCH`). |
| R-VAL-3 | Two states with the same assembly/plant/usage/alternative/revision and overlapping validity → REJECTED `AMBIGUOUS_BOM_STATE`. |
| R-VAL-4 | BOM quantity must be > 0 (`INVALID_BOM_QUANTITY`); item numbers must be unique per state (`DUPLICATE_ITEM_NUMBER`). |
| R-CMP-1 | Items are matched by item number. Same item no., different material → REPLACED; same material, different quantity → QUANTITY_CHANGED; only in target → ADDED; only in source → REMOVED; equal → UNCHANGED. A material moved to another item number counts as REMOVED + ADDED. |
| R-CMP-2 | Different units on a matched item → NON_COMPARABLE (no unit conversion); run becomes INCOMPLETE. |
| R-COST-1 | Unit price = price ÷ price unit, from the single price valid on the reference date for the same material, plant and unit. Exact decimal arithmetic; round half-up to 2 decimals only for presentation. |
| R-COST-2 | Missing, ambiguous (> 1 valid), foreign-currency or unit-mismatched price → cost INCOMPLETE; totals are **null, never 0**. No currency conversion. |
| R-COST-3 | Percent = delta ÷ source cost × 100; null if source cost is 0. |
| R-STK-1 | Required = Σ target-revision quantity × production quantity, per material. Only the case plant's snapshots count. |
| R-STK-2 | Latest snapshot at or before the reference date; gap = max(required − available, 0); gap > 0 → SHORT. |
| R-STK-3 | No snapshot → UNKNOWN (never "sufficient"); unit mismatch → NON_COMPARABLE; snapshot older than 7 days → value used but flagged STALE (status COMPLETE_WITH_WARNINGS if that is the only flag). |
| R-INS-1 | Applicable instructions: same assembly and plant, status RELEASED, `appliesToRevision` empty or equal to the target revision, **`validFrom` ≤ target BOM `validFrom` (effectivity date)**; highest version per instruction ID. (v1.1: date check added; NEG-16) |
| R-INS-2 | A reference to a material that is not in the target BOM → OUTDATED_INSTRUCTION_REFERENCE. |
| R-SEV | Stock gap, outdated instruction reference, non-comparable unit → HIGH; replaced/removed → MEDIUM; added/quantity changed → LOW; cost change → MEDIUM if \|percent\| ≥ 5 %, else LOW. |

## 4. Rule-coverage fixture — `DS-DEMO-01` (PUMP-200) — PROPOSED, TEST-ONLY

**Scope correction (v1.1, C-01):** the handbook defines one cooling module. PUMP-200 is kept only as an automated-test fixture covering rules the 4-component oracle cannot (REMOVED, price-unit normalisation, plant-isolated stock, equal-stock boundary). It is not seeded, not shown in P3/P4 and not a product claim. Owner option B: replace it with a COOL-100 full-BOM fixture (10–15 components, separate seed profile, same +€1,200 delta, different per-assembly totals).

- 15 materials. Rev A has 11 items, Rev B has 12 items.
- **Changes:** 2 replacements (IMP-70→IMP-72, PCB-CTRL1→PCB-CTRL2), 2 quantity changes (ORING-30 3→4, SCR-M4X12 8→10), 1 removal (GSKT-P200), 2 additions (SENS-T02, CLIP-05).
- **Price units:** SCR-M4X12 €6.00/100 PC, LBL-200 €15.00/100 PC and CLIP-05 €1.20/10 PC test normalisation.
- **Plant isolation:** an IMP-72 snapshot in plant 2000 (500 PC) must be ignored.
- **Boundary:** PCB-CTRL2 has need 250 = available 250, so gap 0 and status SUFFICIENT.

| Expected (computed by `tools/m04/oracle.py`, cross-checked by `crosscheck.mjs`) | Value |
|---|---|
| Cost per assembly A → B | €115.23 → €126.84 (+€11.61) |
| Cost delta for 250 | **+€2,902.50 (+10.08 %)** |
| Materials short | 4: IMP-72 gap 70, ORING-30 gap 100, CBL-200 gap 10, SENS-T02 gap 250 |
| Instruction findings | 2 (WI-PUMP-200-ASM v5 steps 0020 IMP-70 and 0030 GSKT-P200); 1 instruction to update |
| Findings | 14 (6 High, 4 Medium, 4 Low) |

## 5. Negative and edge cases — `DS-NEG-01` (mutations of the oracle; all 16 executable)

| ID | Category | Mutation | Expected |
|---|---|---|---|
| NEG-16 (v1.1) | validity | WI-COOL-100-TST v2 validFrom 2027-01-01 | COMPLETE; 0 instruction findings (instruction not yet effective) |
| NEG-01 | missing | delete SEAL-01 price | INCOMPLETE; delta null; issue MISSING_PRICE |
| NEG-02 | missing | delete SENS-01 stock | INCOMPLETE; STOCK_UNKNOWN; 1 unknown, 2 short; cost still +1,200 |
| NEG-03 | stale | FAN-B snapshot 2026-10-20 | COMPLETE_WITH_WARNINGS; STOCK_STALE |
| NEG-04 | non-comparable | FAN-B price in USD | INCOMPLETE; NON_COMPARABLE_CURRENCY |
| NEG-05 | non-comparable | Rev B BRKT-01 unit KG | INCOMPLETE; comparison NON_COMPARABLE; cost and stock non-comparable |
| NEG-06 | ambiguous | second overlapping Rev B state | REJECTED AMBIGUOUS_BOM_STATE |
| NEG-07 | non-comparable | Rev B in plant 2000 | REJECTED NON_COMPARABLE_BOM_STATES |
| NEG-08 | invalid | production quantity 0 | REJECTED INVALID_PRODUCTION_QUANTITY |
| NEG-09 | invalid | BOM quantity −3 | REJECTED INVALID_BOM_QUANTITY |
| NEG-10 | invalid | duplicate item 0040 | REJECTED DUPLICATE_ITEM_NUMBER |
| NEG-11 | positive control | BRKT-01 €30.00 per 10 PC | COMPLETE; still €56 / €68 / +€1,200 |
| NEG-12 | ambiguous | two valid BRKT-01 prices | INCOMPLETE; AMBIGUOUS_PRICE |
| NEG-13 | missing | unknown target BOM state | REJECTED MISSING_BOM_STATE |
| NEG-14 | non-comparable | Rev B alternative 02 | REJECTED NON_COMPARABLE_BOM_STATES |
| NEG-15 | invalid | production quantity 100.5 | REJECTED INVALID_PRODUCTION_QUANTITY |

Not yet covered (add with later slices): authorization (plant/role) cases — they belong in CAP HTTP tests, not the data oracle; instruction validity dates; multi-level BOMs (out of scope: single-level only).

## 6. Verification performed (three distinct checks)

| # | Check | Method | Result (8 Nov 2026) |
|---|---|---|---|
| 1 | Model/contract | `tools/m04/oracle.py` (Python, exact `Decimal`) generates `expected-results.json` for both datasets and evaluates all 16 negative cases against their declared outcomes | 16/16 pass (9 Nov, ruleset 1.1.0). History: v1.0 had 15 cases, 15/15 on 8 Nov. |
| 2 | Independent recomputation | `crosscheck.mjs` (Node 24, own CSV parser, BigInt micro-euro arithmetic, own classification) recomputes costs, percent, classifications and stock gaps | 0 failures for both datasets |
| 3 | Regression against fixed values | `test_handbook_values.py` asserts the hard-coded handbook numbers (56, 68, +1,200, gaps 20/50, 4 BOM changes, 1 outdated reference) and that mockup values (+1,250, ~6.2 %) are **not** reproduced | 7/7 tests pass |

These checks verify the **expected results**, not any CAP implementation (none exists yet).

## 7. Schema and relationship plan (proposal; nothing implemented)

**Reuse from M03 (unchanged)**
- `Assemblies` entity and `AssemblyCatalog` service — new entities reference `Assemblies` via association; no M03 file is modified in slice 1 except `package.json` (test script, mocked roles).
- Patterns:
  - `cuid` / `managed` aspects
  - UUID `version` with `@odata.etag` for any editable entity (ReviewCases)
  - plant-scoped `@restrict … where: 'plant = $user.plants'`
  - the handler-side membership validation (non-empty array, no wildcard)
  - 409/412/428 error conventions
  - `node --test` in-process CAP server tests

**New entities, in implementation order**

| Order | Entity | Key fields / relationships | Notes |
|---|---|---|---|
| 1 | `BOMStates` | assembly → Assemblies; plant, bomUsage, alternative, revision, validFrom/To, status, changeNumber, sourceType, evidenceRef; items: Composition of many BOMItems | plant must equal assembly.plant (handler check) |
| 1 | `BOMItems` | bomState →; itemNo, material, quantity Decimal(13,3), unit | unique (bomState, itemNo) |
| 1 | `CostPrices` | material, plant, price Decimal(15,4), currency, priceUnit, unit, priceBasis, validFrom/To | read-only to clients |
| 1 | `StockSnapshots` | material, plant, availableQuantity, unit, snapshotAt | read-only to clients |
| 1 | `ReviewCases` | caseNumber (unique), title, assembly →, plant, fromState → BOMStates, toState → BOMStates, productionQuantity, status, owner, sourceType, version (ETag), latestRun → ImpactRuns | `latestRun` lets the worklist sort/filter on results |
| 1 | `ImpactRuns` | reviewCase →; ruleset, datasetVersion, inputFingerprint (SHA-256 of inputs), status, flags, cost totals, counts, computedAt/By; findings: Composition of many Findings | insert-only, written only by CAP action `runImpact` |
| 1 | `Findings` | run →, reviewCase →; type, severity, material, details, evidenceRefs | produced by the rules, never by the browser or an LLM |
| 1* | `ImpactMaterialLines`, `ImpactComparisonLines` | run → | **Not in the handbook entity list** — needed to keep per-material and per-item results auditable. Alternative: compute on read (loses audit trail). Owner decision. |
| 2 | `Instructions`, `InstructionReferences` | instructionId+version, assembly →, appliesToRevision, status; references: step, material, quantity | enables R-INS rules |
| 2 | `DecisionEvents` | reviewCase →; fromStatus, toStatus, actor, comment, at | insert-only; status transitions only via CAP actions |
| P2 gate | `AIUsageEvents` | provider, model, purpose, prompt/evidence refs, tokens, outcome | only after real model access is confirmed |

**Code lists:** ReviewStatus (OPEN, IN_REVIEW, APPROVED, REJECTED, with criticality), SourceType (SYNTHETIC_FIXTURE, MANUAL, GENAI_PROPOSAL, S4_IMPORT reserved), FindingType, Severity.

**Naming correction (v1.1, C-04):** `case` is a reserved CDS word (cds-compiler 7.2.1 rejects it — probe P-1). All associations formerly named `case` are now `reviewCase`.

**Instance authorization for every entity (v1.1, C-05, BLOCKER for Slice 1a):** probe P-2 proved that a child entity exposed with only a role check leaks across plants (plant-2000 user read 1 plant-1000 finding via `GET /Findings`). Every exposed entity therefore needs its own `where` rule:
- `ReviewCases`, `BOMStates`, `CostPrices`, `StockSnapshots`, `Instructions`: `plant = $user.plants`
- `Findings`, `ImpactRuns`, `DecisionEvents`: `reviewCase.plant = $user.plants` (verified pattern)
- `BOMItems`: `bomState.plant = $user.plants`; `InstructionReferences`: `instruction.plant = $user.plants`
- Line entities: `run.reviewCase.plant = $user.plants` (path depth to be verified in Slice 1a)
- Entities not needed by the UI are not exposed at all. Writes to runs/findings/lines: none for clients (only the `runImpact` action).

**Roles (proposal):**
- `ChangeViewer` — read
- `ChangeAnalyst` — `runImpact`
- `ChangeApprover` — approve/reject, cannot approve own case
- All roles are plant-scoped through the existing `plants` attribute.

**Seeding:** fixtures as CAP CSV under `test/data/` (development/test only, never production). Verify CAP 10 loading behaviour first. Direct CSV loads bypass service validation and ETag generation (M03 README warning), so CSVs must contain valid `version` UUIDs and pass a load-time validation test.

## 8. Decisions recorded in v1.2 (owner, 9 Nov 2026)

**Decision A — PUMP-200:** stays a test-only rule-coverage fixture (`DS-DEMO-01`). It is never seeded and never shown in P3/P4. The user-facing scenario is COOL-100 only. Any change needs owner authorization.

**Decision B — immutable, persisted calculation snapshots per ImpactRun.**

| Stored with each run | Purpose (why it is not redundant) |
|---|---|
| `ImpactRuns`: ruleset, dataset version, `inputFingerprint` (SHA-256 over the canonical JSON of every input row used: BOM items, prices, stock, instructions, case quantity), status, flags, totals, counts, `computedAt`, `computedBy` | Proves *which* inputs and rules produced a result; recomputing with the same fingerprint must give identical output |
| `ImpactComparisonLines` (item no., from/to material and quantity, unit, change) | Displays BOM comparison as computed, even after BOM states change |
| `ImpactMaterialLines` (material, unit, required, available, gap, status, stale flag, snapshotAt, unit price used, price evidenceRef) | Keeps stock and price values *as used*. A later price or stock update must not alter history (probe P-3: snapshot kept €42 after the source changed to €50). |
| `Findings` (type, severity, material, details, evidenceRefs) | Explainable, citable results for P3/P4 and later P2 grounding |
| `ReviewCases.latestRun` | Pointer only; lets the worklist sort and filter without recomputing |

**Rules:**
- Runs and all child rows are insert-only. Exposed `@readonly`; no client write (P-3: PATCH/DELETE → 405).
- Written only by `runImpact`, inside the action's single transaction together with `latestRun` (P-3: a simulated failure after line insert left 0 runs/0 lines; a successful run set `latestRun` atomically).
- Plant isolation by path: runs `reviewCase.plant`, lines `run.reviewCase.plant` (P-3: plant-2000 user saw 0 runs, 0 lines; plant-1000 user saw 1/1).
- Recalculation creates a **new** run; old runs are never updated.

**Open design points for Slice 1a (not yet probed):**
- **Concurrent runs:** two simultaneous `runImpact` calls would both write, last writer wins on `latestRun`. Require `If-Match` (ReviewCases ETag) on the action, or reject when a newer run exists.
- **Foreign-plant masking:** CAP returned **403** for an action on another plant's case (P-3), while M03 masks foreign records as **404**. Add a handler pre-check so foreign cases return 404, consistent with M03.
- **Idempotence:** an equal fingerprint may return the existing run instead of inserting a duplicate. This needs an owner decision; the default is a new run for full audit.
