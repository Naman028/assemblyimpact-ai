# P1 alternative: Engineering Assistant as a Node.js agent (Gemini function calling)

Status 2026-11-11: implemented, automated tests pass (8 tests in `test/p1-node-agent.test.js`). Live runs: see the evidence below once recorded.

## Why
The SAP Build Joule agent (`p1/joule/`) is saved and validated in the EU10 tenant, but it cannot reach the US10 CAP backend
until an EU10 subaccount administrator creates the destination (`p1/joule/ADMIN-HANDOFF-EU10-DESTINATION.md`).
This agent gives the same four skills inside the application itself, without Joule or a destination. It does **not**
replace or claim the Joule integration; both are documented separately.

| Joule skill (EU10) | Node.js agent tool | CAP operation (as the signed-in user) |
|---|---|---|
| Engineering Case Lookup | `lookupCases` | function `lookupCases` (plant-filtered) |
| Explain Case Impact | `getImpact` | `lookupCases` + read `ImpactRuns` with lines and findings |
| Review Decision History | `getDecisionHistory` | `lookupCases` + read `DecisionEvents` |
| Run Engineering Impact (confirmation) | `proposeRunImpact` | **no write**; the UI asks the user to confirm, then calls `runImpact` |
| (P2) AI Explanation tab | `getAiExplanation` | the validated `explainImpact` result of the latest run |

Each reply lists the SAP Build Action names it used (`LookupEngineeringCases`, `GetEngineeringImpact`, `GetDecisionHistory`, `RunEngineeringImpact`), i.e. the operations of `p1/build-actions/assemblyimpact-engineering-actions.openapi.json`, and the Gemini token usage reported by the API (`usageMetadata`).

## Limits
- Per question: at most 5 model requests and 8 tool calls; then the answer is given from the data so far, or withheld.
- Gemini quotas are per Google project (requests/minute, input tokens/minute, requests/day; daily reset at midnight Pacific time). On the free tier Gemini 3.5 Flash-Lite is listed with about 10 requests/minute and 500/day. One assistant question uses 2-5 requests; `getAiExplanation` adds one more. Over quota, Gemini returns HTTP 429 and the tab shows "rate limit or quota reached".

## How it works
1. UI: Investigation Studio, tab **Assistant** (also free-text questions about any case in the user's plants).
2. Browser → `POST /odata/v4/engineering-review/askAssistant { message, history }` (roles ChangeViewer/Analyst/Approver).
3. CAP backend (`srv/integration/genai/assistant.js`) calls Gemini `generateContent` with four function declarations
   (temperature 0, max 5 steps). Gemini returns function calls; the backend runs each through the EngineeringReview
   service **in the caller's request context**, so `@restrict`, plant isolation (404) and roles apply unchanged.
4. Results go back to Gemini as function responses; Gemini writes the answer.
5. The backend checks the answer: every number must occur in the tool results or the question, every case number must be
   known, no approve/reject recommendation. Otherwise the answer is **withheld** (status WITHHELD + reason).
6. The reply lists the CAP operations used. A run request comes back as a proposal; **Run impact** in the UI calls the
   normal `runImpact` action, which checks the user's role again.

Not tools: submit, approve, reject, edit input, import. Only synthetic/demo cases are sent to Gemini (`allowedSourceTypes`).
The key comes from `GEMINI_API_KEY` (BTP: set on `assemblyimpact-srv`, kept across deploys; BAS: `npm run dev:gemini`).

## Run locally (BAS)
```sh
read -rs GEMINI_API_KEY && export GEMINI_API_KEY   # paste, Enter; not shown, not saved
npm run dev:gemini
```
Open `dev-users.html` → Analyst → Investigation Studio → a case → **Assistant**. Without a key the tab answers
`Live AI explanations are not configured.` (HTTP 409). The `test` profile uses `FIXTURE_RULES`, a deterministic
keyword stand-in that is labelled as such in every reply and never shown as a language model.
