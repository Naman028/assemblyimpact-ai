# E2E workflow, BAS three roles (2026-11-11 ~00:56 CET)

- Environment: BAS dev server (`cds watch`, `[development]` profile, SQLite with synthetic data, mocked users `analyst`, `approver`, `cviewer`, `analyst2000`; dev password only valid in this profile). **Not production.** Production keeps XSUAA.
- Commit: 091bf2d (main). Driver: browser `fetch` with Basic auth per role, same origin as `dev-users.html`.
- Cases: EC-000473 COOL-100 (approve path), EC-000481 GEAR-300 (reject path).

| # | Step | Role | Call | HTTP | ms | Observed |
|---|------|------|------|------|----|----------|
| 7 | Impact run | analyst | `runImpact` COOL-100 | 200 | 174 | COMPLETE, +1200.00 EUR, 2 short, 1 instruction finding |
| 3-5 | BOM / materials / cost / findings | analyst | `ImpactRuns?$expand=...` | 200 | 135 | 4 comparison lines, 4 material lines, 7 findings |
| 6 | Consumption Planning | analyst | `materialCoverage(2026-11-11, 30)` | 200 | 122 | 4 materials; FAN-B shortage 20, BRKT-01 shortage 50 |
| - | Viewer cannot run | cviewer | `runImpact` | 403 | 120 | Forbidden |
| - | Approver cannot run | approver | `runImpact` | 403 | 116 | Forbidden |
| - | Plant isolation | analyst2000 | read COOL-100 | 404 | 121 | not visible (no existence leak) |
| - | Viewer cannot submit | cviewer | `submitForReview` | 403 | 117 | Forbidden |
| - | Approve before submit | approver | `approve` | 409 | 120 | INVALID_STATUS_TRANSITION (OPEN) |
| 8 | Submit for review | analyst | `submitForReview` | 200 | 122 | OPEN -> IN_REVIEW |
| - | Self-approval | analyst | `approve` | 403 | 116 | Forbidden (separation of duties) |
| 9 | Approve | approver | `approve` | 200 | 121 | IN_REVIEW -> APPROVED (run COMPLETE, no warning acknowledgement required) |
| - | Approve twice | approver | `approve` | 409 | 116 | INVALID_STATUS_TRANSITION (APPROVED) |
| 7b/8b | Run + submit | analyst | GEAR-300 | 200/200 | 123/123 | COMPLETE, +2588.00 EUR; IN_REVIEW |
| - | Reject without comment | approver | `rejectCase` | 400 | 121 | ASSERT_MANDATORY |
| 9b | Reject | approver | `rejectCase` | 200 | 124 | IN_REVIEW -> REJECTED |
| 10 | Viewer reads history | cviewer | `DecisionEvents` | 200 | - | 4 events: 2x SUBMIT (analyst), APPROVE, REJECT (approver), with comments, status transitions, evidenceStatus |
| - | Viewer cannot decide | cviewer | `approve` | 403 | 115 | Forbidden |
| 11 | Consistency after re-read | cviewer | `ReviewCases` | 200 | 116 | EC-000473 APPROVED, EC-000481 REJECTED, latestRun set |

Notes
- The step labelled "approve without acknowledgement" became the approval because the local run is COMPLETE (no warnings); its comment is "x". On the deployed HANA data the COOL-100 run is COMPLETE_WITH_WARNINGS, where acknowledgement is required (covered by `test/m05-review-workflow.test.js`).
- `approve` accepts an optional comment; `rejectCase` requires one (by design).
- One query error in the script itself (`$orderby=createdAt`; the field is `at`), re-run without it.

## Layout (iframe at fixed width, BAS, analyst)
| Width | Home | Worklist |
|-------|------|----------|
| 1440 | no horizontal scroll, no clipped controls | same |
| 768 | same | same |
| 390 | same | same |

Investigation Studio and the object page were not part of the automated width check (they need a case context); see earlier evidence `worklist-narrow-screen/`.
