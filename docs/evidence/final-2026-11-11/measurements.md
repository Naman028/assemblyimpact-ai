# Measurements (2026-11-11)

All numbers below were measured in this session. Nothing is estimated.

## A. Functional accuracy vs independent oracle

Expected results come from `test/fixtures/m04/*/expected-results.json`, generated independently by `test/fixtures/tools/oracle.py` (not by the CAP calculator). Observed = `calculateImpact()` at commit 9e75478/091bf2d. Raw: `functional-accuracy-raw.json`.

| Check | Input | Expected (oracle) | Observed | Pass | Reference |
|---|---|---|---|---|---|
| BOM classification | DS-ORACLE-01 + DS-DEMO-01, 17 comparison lines | change type per line | 17/17 equal | PASS | `test/impact-calculator.test.js` |
| Quantities | same 17 lines | from/to quantity | 17/17 equal | PASS | same |
| Material shortages | 16 stock lines | status + gap | 16/16 equal | PASS | same |
| Exact cost delta | EC-000473 COOL-100 | +1200.00 EUR, +21.43 % (56.00 -> 68.00 x 100) | +1200.00, 21.43 | PASS | same; also live HANA run |
| Exact cost delta | EC-000471 (DS-DEMO-01) | +2902.50 | +2902.50 | PASS | same |
| Work-instruction findings | 2 oracle cases | findings list | 2/2 equal (1 and 2 findings) | PASS | same |
| Incomplete data | DS-NEG-01, 5 cases | INCOMPLETE | 5/5 | PASS | same |
| Warnings | DS-NEG-01, 1 case | COMPLETE_WITH_WARNINGS | 1/1 | PASS | same |
| Invalid input rejected | DS-NEG-01, 8 cases | REJECTED with error code | 8/8 | PASS | same |
| Review authorization | 4 roles, 11 negative calls | 403/404/409/400 as designed | 11/11 | PASS | `e2e-bas-three-roles.md`, `test/m05-review-workflow.test.js` |
| Deployed = local | COOL-100 on HANA | +1200.00 EUR, 2 short | +1200.00 EUR, 2 short | PASS | `hana-readonly-verification.md` |

Total: 2 golden cases, 16 negative cases, 17 BOM lines, 16 stock lines; 0 mismatches.

## B. Technical performance (deployed, US10, HANA)

Client: Chrome in Germany -> CF US10 (includes network round trip). 30 sequential GETs per endpoint, 2026-11-10 23:39 UTC. Raw: `api-latency-raw.csv`, summary `api-latency-summary.json`.

| Endpoint | p50 ms | p95 ms | min | max | ok |
|---|---|---|---|---|---|
| Case list (`ReviewCases`, $count) | 133.5 | 242.7 | 129.7 | 303.2 | 30/30 |
| Impact read (`ImpactRuns(id)`) | 135.6 | 145.7 | 128.7 | 200.5 | 30/30 |
| `lookupCases` (Joule contract) | 136.5 | 158.2 | 130.5 | 286.0 | 30/30 |
| `systemStatus()` | 121.7 | 128.7 | 118.0 | 132.9 | 30/30 |

- Launchpad page load (deployed, warm session): DOMContentLoaded 640 ms, load 1758 ms (Navigation Timing, n=1).
- Gemini live call (`explainImpact`, COOL-100): 2440 ms total, n=1 (single call by instruction). Answer withheld by grounding check; see `gemini-live-call-1.json`.
- BAS local write path (SQLite, dev): runImpact 123-174 ms, submit 122 ms, approve 121 ms, reject 124 ms (n=1 each).
- Memory: `assemblyimpact-srv` 512M limit; earlier observation 251M used at 256M limit on HANA (2026-11-10, recorded in `mta.yaml`). Not re-measured today (no `cf` CLI in this session).

## C. Business evaluation: manual vs app

**NOT MEASURED.** No timed manual comparison with a participant was carried out. The design-time estimate in the report must stay labelled as an estimate. To measure: one person times the manual spreadsheet comparison for COOL-100, GEAR-300 and HYD-700, then the same three in the app; record start/end times and errors.

## D. Quality

- `npm test`: 203 tests, 203 pass, 0 fail, 18.8 s, commit 9e75478 (`test-baseline.json`); 203/203 again on PR #28 and PR #29 branches.
- `npm run lint` (eslint, max-warnings 0): clean.
- CI on main: success.
- Authorization: role, plant isolation and separation of duties covered by tests and by the BAS E2E above. **No penetration test was performed.**
