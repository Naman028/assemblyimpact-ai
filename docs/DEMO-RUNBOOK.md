# AssemblyImpact AI - exam demo runbook (12 Nov 2026, 13:00-13:30)

## 1. How everything is connected

```
 Browser (Fiori launchpad: Home, Worklist, Investigation Studio + floating "P1 Actions" button)
   |  OData V4 (your session)
   v
 App router (BTP: XSUAA sign-in)  -- BAS: cds watch with mocked users (dev-users.html)
   |
   v
 CAP service EngineeringReview (Node.js, srv/)                      <- the only place that calculates and writes
   |-- runImpact ............ deterministic ruleset (BOM compare, cost, stock, work instructions)      [P4]
   |-- submitForReview / approve / rejectCase ... four-eyes review, history in DecisionEvents          [P4]
   |-- reviseDemoInput / importScenario / MaterialConsumptionRates ... demo inputs, planning           [P3/P4]
   |-- extractFromErp ....... ERP adapter (synthetic/sandbox; S/4HANA contract, no S/4 system)        [P2]
   |-- explainImpact ........ P2 AI Explanation: Gemini writes, CAP checks every figure (else WITHHELD)  [P2]
   |-- askAssistant ......... P1 agent: Gemini chooses tools = the same operations as the EU10
   |                          SAP Build Actions; reads run as you; changes are only PROPOSED          [P1]
   v
 SAP HANA Cloud (HDI)  (BAS: SQLite in memory, resets on restart)

 EU10 SAP Build: Joule skills + agent + Actions project (saved/validated; calling the US10 backend
 needs an EU10 destination from an EU10 admin -> documented blocker; the in-app P1 agent covers the same skills)
 Google Gemini API (key only in the backend: BTP env GEMINI_API_KEY; BAS: npm run dev:gemini)
```

P1 agent, one request: you type -> `askAssistant` -> Gemini picks a tool (e.g. *Explain Case Impact* = Action `GetEngineeringImpact`)
-> CAP runs it **as you** (roles, plant) -> result back to Gemini -> answer -> CAP checks numbers/case numbers -> you see it.
A change (run, edit, rate, import, submit, approve/reject) comes back as **"Prepared, not yet saved"** -> **Confirm** -> the
browser calls the normal CAP action in your session (same checks as the buttons) -> saved in HANA.

## 2. Start-up (12:15)
1. BTP cockpit (US10 trial) -> SAP HANA Cloud: instance **Running** (Start if stopped, ~10 min).
2. BAS terminal: `cf apps` -> `assemblyimpact-srv` and `assemblyimpact-router` **started**. If stopped:
   `cf start assemblyimpact-srv && cf start assemblyimpact-router` (no redeploy).
3. Open `https://78485bd6trial-dev-assemblyimpact-router.cfapps.us10-001.hana.ondemand.com/launchpad.html`, sign in.
   Home: Database *SAP HANA Cloud*, AI explanations **Google Gemini**, P1 Engineering Actions **Agent ready**, Sign-in **SAP BTP sign-in**.
4. Approver on BTP: a second SAP account in role collection `AssemblyImpact_Approver` (cockpit -> Security -> Role Collections),
   signed in in a **private window**. Without it: show approval in BAS (step 6).
5. BAS (three roles): new terminal ->
   `cd ~/projects/assemblyimpact-ai && git fetch -q origin main && git checkout -q origin/main`
   `read -rs GEMINI_API_KEY && export GEMINI_API_KEY` (paste key, Enter) -> `npm run dev:gemini`
   -> open the port-4004 preview -> `dev-users.html`.
6. Keep `pump-950-demo-scenario.json` (app/investigation-studio/webapp/samples/) open in Notepad.
7. Fallback: screen recording of this flow + `docs/evidence/`.

## 3. Demo script (25 min)
| Min | Where | Do | Show / expected |
|---|---|---|---|
| 0-2 | BTP Home | Status tiles | HANA Cloud, Gemini, P1 agent ready, BTP sign-in; S/4HANA not connected (honest) |
| 2-6 | BTP Studio, EC-000473 COOL-100 | Assembly, BOM Comparison, Materials, Cost, Consumption Planning, Work Instructions | +1,200.00 EUR (56.00 -> 68.00 x 100, +21.43 %), BRKT-01 short 50, FAN-B short 20, 1 WI finding |
| 6-8 | AI Explanation tab (P2) | Explain | grounded sections or WITHHELD with reason; CAP figures unchanged |
| 8-14 | **P1 Actions** button | 1. paste PUMP-950 file -> *Import pasted scenario* -> Confirm; 2. open EC-000501 -> *Run Engineering Impact* -> Confirm | 66.20 -> 84.10 EUR per pump, **+2,148.00 EUR (+27.04 %)**, IMP-950S short 30, SENS-950 short 20, WI still references IMP-950 |
| 14-17 | P1 Actions | *Change a revision-B quantity…* e.g. "In EC-000501 set the revision B quantity of item 0040 to 6" -> Confirm -> run again | cost drops by 2 x 0.20 x 120 = 48.00 EUR -> +2,100.00 EUR |
| 17-19 | P1 Actions | *Add a consumption rate…* "In EC-000501 add a consumption rate for material IMP-950S of 5 per week from 2026-11-12 to 2026-12-31" -> Confirm -> Consumption Planning tab | rate listed; projection uses it |
| 19-21 | P1 Actions | *Submit for review…* -> Confirm | status IN_REVIEW; analyst cannot approve (refused) |
| 21-24 | Approver (BTP private window, or BAS dev-users -> Approver) | P1 Actions: "Approve EC-000501 with the comment: checked" -> Confirm (or Review tab) | APPROVED; the run has warnings -> confirmation acknowledges them |
| 24-25 | Viewer | *Review Decision History* | SUBMIT by analyst, APPROVE by approver, comments, times |

Calculation (for questions): per revision, quantity x standard price valid on the as-of date, summed per assembly;
delta = (B - A) x production quantity; required = quantity x production quantity vs. latest stock snapshot; exact decimals, no AI.

## 4. Rules for the live demo
- On BTP the import writes HANA permanently: EC-000501 can be imported **once**. Rehearse in BAS (resets on restart).
- Do not edit/re-run COOL-100 on BTP; it is the reference case.
- Gemini quota is per Google project (free tier ~10 requests/min); one agent question = 2-5 requests. On HTTP 429 wait a minute.
