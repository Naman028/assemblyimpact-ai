# Full P1-P4 flow through the P1 Actions bot (BAS, live Gemini) - 2026-11-11 02:50 CET

Branch fix/p1-ui-polish b185126, `npm run dev:gemini`, model gemini-3.5-flash-lite, dev users from dev-users.html.

| # | Role | Request (bot) | Skill -> Action | Confirm result |
|---|---|---|---|---|
| 1 | analyst | paste pump-950-demo-scenario.json, "Import this scenario." | Import Scenario -> importScenario (dry run, then import) | EC-000501 PUMP-950 created, OPEN |
| 2 | analyst | "Please run the impact for EC-000501." | Run Engineering Impact -> RunEngineeringImpact | COMPLETE, 66.20 -> 84.10, **+2,148.00 EUR (+27.04 %)**, short 2 (IMP-950S 30, SENS-950 20) |
| 3 | analyst | "In EC-000501 set the revision B quantity of item 0040 to 6." | Edit Input -> reviseDemoInput | SCR-950 8 -> 6 |
| 4 | analyst | "Please run the impact for EC-000501 again." | Run Engineering Impact | 83.70 per pump, **+2,100.00 EUR (+26.44 %)** (= 2 x 0.20 x 120 less) |
| 5 | analyst | "...add a consumption rate for material IMP-950S of 5 per week from 2026-11-12 to 2026-12-31." | Consumption rate -> POST MaterialConsumptionRates | rate stored (5 PC/week) |
| 6 | analyst | "Submit EC-000501 for review with the comment: ..." | Submit for Review -> submitForReview | IN_REVIEW |
| 7 | analyst | "Approve EC-000501 ..." | Review Decision | refused: NOT_AUTHORIZED (only approvers) |
| 8 | approver | "Approve EC-000501 with the comment: checked, ..." | Review Decision -> approve | APPROVED |
| 9 | cviewer | "Show the decision history of EC-000501." | Review Decision History -> GetDecisionHistory | SUBMIT by analyst, APPROVE by approver, with comments and times |

Each Gemini question: 2 requests, ~2,900-5,600 tokens. Defect found and fixed during this run: a repeated "run again" request was
answered from chat history without a tool call (no Confirm); now such replies are withheld and the prompt requires a new tool call.
Screenshots: P1-04 (Home: P1 Engineering Actions "Agent ready", development sign-in as information), P1-05 (analyst chat;
only the conversation scrolls), P1-06 (viewer history after approval).
