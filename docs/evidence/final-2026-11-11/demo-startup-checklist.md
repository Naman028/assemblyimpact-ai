# Exam demo startup checklist (12 Nov 2026, 13:00-13:30 CET)

Do not assume trial services kept running overnight. Start at 12:15.

1. **HANA Cloud** (BTP cockpit > US10 trial > SAP HANA Cloud): instance *Running*. If stopped: Start, wait until running (can take ~10 min).
2. **CF apps** (cockpit > Spaces > dev): `assemblyimpact-srv` and `assemblyimpact-router` *Started*. If stopped: Start (no redeploy needed).
3. **Backend status**: open `<router>/odata/v4/engineering-review/systemStatus()` -> `databaseKind HANA`, `genaiMode GEMINI`, `authMode PRODUCTION`.
4. **Login**: open the launchpad, sign in with XSUAA, check Home shows 7 cases and "Google Gemini" (Ctrl+Shift+R if the old tile shows).
5. **Records**: COOL-100 (EC-000473) shows +1,200.00 EUR, 2 short.
6. **BAS** (three-role part): start the dev space, `cds watch` in `~/projects/assemblyimpact-ai`, open `dev-users.html` on port 4004. Local data resets on restart; that is expected.
7. **Joule**: Joule Studio project open in a tab, skills/agent screenshots ready (no live backend call possible, see blocker).
8. **Fallback**: screen recording of the full flow (record once tonight from this checklist) plus `docs/evidence/` screenshots.

## Demo flow (25 min)
1. Deployed launchpad (P4, HANA, XSUAA) -> Home status tiles.
2. Worklist -> COOL-100 -> Investigation Studio: BOM comparison, materials/shortages, cost, instruction findings, Consumption Planning.
3. Impact evidence (existing run; do not re-run on production) and AI explanation (Gemini, grounded or withheld).
4. BAS: switch Analyst -> run impact, submit; Approver -> approve; Analyst cannot approve (403); Viewer reads history; reload shows the same state.
5. Joule (P1): skills, agent, validation, private test; destination blocker.
6. ERP adapter (P2): contract and tests; S/4HANA not available.
7. Tests and measurements: 203/203, accuracy table, latency.
