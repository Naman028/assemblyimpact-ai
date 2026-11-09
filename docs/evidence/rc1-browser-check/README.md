# RC1 reconciliation — browser check in SAP Business Application Studio (2026-11-09)

Where: BAS dev space `ws-lecln` (trial subaccount 78485bd6trial, us10), Chrome, branch `feat/rc1-final-reconciliation`
at `08e6651`, cloned into a temporary folder (removed afterwards; the project checkout was not touched).

Setup for the check only (not committed): Node 24.21.0, `npm ci`, `npm test` → 139/139; server on port 4010 with an
in-memory SQLite DB loaded from `db/data`, `db/csv`, `test/data`; a throw-away auth middleware signing in one
plant-1000 user (ChangeViewer, ChangeAnalyst, DemoDataImporter), because the browser tool cannot fill a Basic-auth
dialog; GenAI provider `fixture` (canned answer labelled `FIXTURE_LLM_RESPONSE` — **not a live model**).

| # | Screenshot | What it shows |
| --- | --- | --- |
| 1 | `01-worklist-scenario-thumbnails.jpg` | Worklist: seven cases, thumbnails generated from the DS-SCENARIOS-01 BOMs (plus COOL-100). |
| 2 | `02-object-page-hyd700-illustration.jpg` | EC-000485 object page: existing "Open in Investigation Studio" link; HYD-700 revision B illustration with change states. |
| 3 | `03-studio-deep-link-ec000485.jpg` | Studio opened from that link on the same case, after Run Impact (as of 2026-11-08: +6,756.00 EUR, 2 short, 3 findings). |
| 4 | `04-studio-ai-explanation-fixture.jpg` | AI Explanation tab: grounded answer with citations and provenance (fixture provider). |

Also verified: the Studio's "Open in worklist" button returned to the same object page.

Defect found and fixed: the Studio crashed on start (`CaseList.controller.js`, `getView().getModel()` is undefined in
`onInit`); both panes stayed empty. Fixed by reading the model from the component; regression test in
`test/case-worklist-app.test.js` (fails on the old code, passes on the fix). The screenshots 3–4 were taken with the
fix hot-patched into the temporary copy. A duplicate worklist→Studio link added during reconciliation was removed
because the General field group already has one.
