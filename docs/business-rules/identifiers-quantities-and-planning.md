# Identifiers, quantity semantics, consumption planning and review actions

Business rules introduced on branch `fix/app-defects`. Every rule below has an automated test; the test name is given in brackets.

## 1. Identifiers

| Identifier | Example | Meaning | Who sets it | Editable |
|---|---|---|---|---|
| Internal ID | `7263f5aa-…` (UUID) | Technical key of every record. Never shown as a business key. | Server | Never |
| Case number | `EC-000496` | Identifies one review case (one engineering change under review). Unique across plants. | Proposed by the server (`nextCaseNumber()`), may be changed in the form before import | Until the import is committed; never afterwards |
| Change number | `EC-000496` | The case number recorded on the proposed BOM revision (`BOMStates.changeNumber`), i.e. which change introduced the revision. | Import (copied from the case number) | Never |
| Assembly ID | `PUMP-950` | Material number of the assembly; unique per plant. | First import of the assembly | Never (a new code is a new assembly) |
| Revision ID | `A`, `B`, `C` … | Label of one BOM state of an assembly (bomUsage + alternative + revision + validity). | Form (defaults A/B; for an existing assembly the next free letters are proposed) | Never after import |
| BOM state key | `BOM-PUMP-950-EC-000496-A` | Business key of a BOM state inside an import file. Derived from assembly + case number, so a second change of the same assembly never collides with the first. | Form | Never after import |

Case-number allocation: `nextCaseNumber()` only **proposes** a number (one above the highest number in the caller's plants, skipping numbers used anywhere). The database unique constraint on `ReviewCases.caseNumber` decides at import time: a concurrent import that took the number gets `409 IMPORT_CONFLICT`, the whole import is rolled back, and the form keeps its input and proposes a fresh number [demo-data: concurrent imports].

Rules:

* A new case for an **existing assembly** references the stored assembly (it is not sent again, never changed) [demo-data: Scenario B, second change]. `searchAssemblies(term)` lists the assemblies of the caller's plants with their revisions and number of cases, so the user can see that e.g. PUMP-450 already exists before entering it.
* A new revision must not reuse a revision ID that already exists for the same assembly and period: refused in the form and on the server (`REVISION_EXISTS`).
* Assemblies of other plants are never looked up or revealed (`UNKNOWN_ASSEMBLY`, empty search result).
* Nothing is overwritten: existing assemblies, BOM states, prices and stock are only referenced; duplicates are refused (`ALREADY_EXISTS`).

## 2. Quantity semantics

| Situation | Accepted? | Representation | Comparison result |
|---|---|---|---|
| Component in A and B, same quantity | yes | line in both | UNCHANGED |
| Quantity increases / decreases | yes | line in both | QUANTITY_CHANGED |
| Component removed in B | yes | **no line in B** (form: B qty empty or 0; edit: proposed quantity 0) | REMOVED |
| Component added in B | yes | no line in A (form: A qty empty or 0) | ADDED |
| Same item, other material | yes | line in both, different material | REPLACED |
| BOM line with quantity 0 | stored? **never** | — | — |
| Negative quantity, text, > 3 decimals | no | refused in form and on server | — |
| Revision B without any component | no | `LAST_ITEM` (edit) / `EMPTY_BOM` (import) | — |
| Production quantity 0 or negative | no | refused (an engineering change is evaluated for a positive build quantity) | — |
| Stock 0 | yes | snapshot with 0 | shortage if required |
| Price 0 | yes | a real zero price (e.g. free-issue part), as in the import and the calculator (R-COST-1) | cost counted as 0 |
| Price missing (form: empty) | yes | no new price; the stored price is used, or the run reports `MISSING_PRICE` and cost INCOMPLETE | — |
| Different units on rate/stock/BOM line | no conversion | `UNIT_MISMATCH`, no numbers | — |

Edit Input on an OPEN synthetic case: proposed quantity `0` removes the line from revision B (audited with the removed line), a positive quantity on an item that is only in revision A re-adds it. Re-adding restores the earlier result exactly [demo-data: quantity 0 removes …]. The COOL-100 oracle (EC-000473: +1200.00 EUR, 2 materials short) is unchanged [planning-and-hints: oracle unchanged].

## 3. Time-based consumption (planning view)

The deterministic impact calculation answers *what revision B needs for the production quantity at the as-of date*. The planning view answers *how long the stock lasts under stated consumption*. They are computed and shown separately ("Consumption Planning" tab); the planning view never changes an impact run.

| Rule | Definition |
|---|---|
| R1 Calendar | UTC calendar days; horizon = start date + (days − 1); 1 to 366 days. Dates must be real calendar dates (2026-02-30 and 2027-02-29 are refused); validity periods are inclusive at both ends. |
| R2 Rates | `MaterialConsumptionRates`: material, plant, period DAY/WEEK/MONTH, quantity, unit, validFrom–validTo (inclusive). Per day: DAY = q, WEEK = q / 7, MONTH = q / days of that calendar month. Exact rational arithmetic, rounded to 3 decimals only for display. |
| R3 Gaps | At most one active rate per material, plant and day (overlaps refused). A day without a rate has **unknown** demand, never zero: it is counted (`noRateDays`, `missingRanges`), demand figures become lower bounds (`demandComplete = false`) and the status is `INCOMPLETE` — or `SHORTAGE` when the stock runs out even with the unknown days at zero (`exhaustionIsLatestPossible = true`). A rate of 0 is a known zero (explicitly inactive period) and is fully evaluated. |
| R4 Opening stock | Latest stock snapshot taken on or before the start date. Later snapshots are never mixed in. None → `NO_STOCK`, no projection. |
| R5 Case requirement | production quantity × proposed BOM quantity per material, consumed once on the effective date (validFrom) of revision B if it lies in the horizon. |
| R6 Units | Rate, stock and BOM unit must be equal; otherwise `UNIT_MISMATCH`. |
| R7 Zero / negative | Rate 0 is valid (no consumption); negative rates and more than 3 decimals are refused. |
| R8 Audit | Rate records are never updated or deleted. A wrong rate is withdrawn with `deactivate(reason)` (who, when, why are stored) and a corrected rate is entered; withdrawn rates are ignored. |

Outputs per material: status (COVERED / SHORTAGE / NO_STOCK / UNIT_MISMATCH), opening stock, rate per day at start, case requirement, expected demand, projected end stock, shortage at end, covered days, first day short (exhaustion date), days without rate. Tests: `test/coverage.test.js` (month lengths, leap year, boundaries) and `test/planning-and-hints.test.js` (API, plant isolation, validation).

## 4. Review actions and why they are unavailable

The server returns, per case and signed-in user, `canRunImpact / canSubmit / canDecide` plus `runImpactHint / submitHint / decideHint` (null = available). Reasons, in the order a user can act on them: missing role → case status → separation of duties → missing evidence. Shown in the Studio Review tab and in the Worklist object page ("Review Actions"). The hints are advisory; every action re-checks on the server, and self-approval is refused (`SELF_DECISION_NOT_ALLOWED`) [planning-and-hints: disabled actions explain why].

Two-person flow: analyst runs impact → submits; an approver (another user with ChangeApprover in the same plant) opens the case (Studio header shows "Ready for your decision"), inspects, acknowledges warnings if any, approves or rejects.
