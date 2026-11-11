# Final check of the deployed app (main fa03c6d, PR #36), 2026-11-11

Read-only requests from the signed-in browser session on the BTP app router.

| Check | Result |
|---|---|
| systemStatus | databaseKind HANA, genaiMode GEMINI, authMode PRODUCTION, demoImport true, jouleStatus NOT_CONNECTED (EU10 destination open) |
| ReviewCases count | 7 |
| Home / Worklist (P3) / Studio (P4) manifests | 200 / 200 / 200 |
| P1 lookupCases(EC-000473) | 200, COOL-100 returned |
| P1 Actions agent in Studio view | present ("P1 Engineering Actions") |
| Home "Sign out / switch user" link (PR #36) | present |
| P1 button CSS edge-to-edge (PR #36) | served (`padding: 0 !important`) |
| /logout.html | 200 |
