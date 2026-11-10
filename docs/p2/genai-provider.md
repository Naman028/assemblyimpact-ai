# P2 — GenAI explanation provider (Google Gemini API)

Status on 2026-11-10: **implemented and locally tested only.** No live Gemini call has been made. There is no API key
in this repository, in the BTP application or in the test environment. All Gemini tests use a stubbed HTTP response,
so they test the contract around the model. They are not evidence that the model was called.

## What it does

The Investigation Studio's **AI Explanation** tab calls the bound function `explainImpact` on a review case. The CAP
backend then works through these steps:

1. It loads the case's **latest persisted impact run**. Without a run it returns 409 `NO_IMPACT_RUN`. If the user's
   plants do not include the case's plant, it returns 404, so a case in another plant cannot be told apart from a
   missing one.
2. It builds numbered evidence from that run (`srv/integration/genai/impact-explanation.js`, `evidenceOf`). Only this
   approved data is sent:
   - case number, assembly and revisions
   - run status, flags and as-of date
   - calculated cost figures (per assembly, total, percent)
   - shortage counts, `materialsUnknown` (unknown stock coverage) and work-instruction counts
   - findings (`F*`), short, unknown or stale materials (`M*`) and changed BOM items (`B*`), with their rule and
     evidence references
   - the data-source label

   Never sent:
   - plant
   - case title or other free text entered by users
   - run or case UUIDs
   - user names
3. It refuses to send cases whose `sourceType` is not synthetic demo data (`SYNTHETIC_FIXTURE`, `DEMO_IMPORT`). The
   result is 409 `GENAI_DATA_NOT_APPROVED`, and no request is made.
4. It calls the Gemini API from the server (`generateContent`) with a JSON response schema. The answer has these
   fields:
   - `summary`, `verifiedImpact`, `shortageAnalysis`, `workInstructionImplications` (each must cite facts)
   - `nextActions[]` (proposals only, at most 4)
   - `warnings[]` (limitations)
   - `references[]`
5. It validates every section against the run (`validateSections`). The answer is withheld (`status: WITHHELD`, with
   no text and no sections) if any of these apply:
   - the output is empty or is not the agreed JSON structure
   - a citation is unknown
   - a number does not appear in the run evidence, or a number is written in words
   - the cost direction is inverted
   - the answer contradicts the shortages
   - an approve, reject or release recommendation appears anywhere, including in next actions
   - the run is incomplete, has unknown stock coverage or stale stock, or the evidence was truncated, but no
     limitation warning is given

The model never calculates, approves, rejects, changes a BOM, stock or price, or writes to HANA. The bound function is
read-only (no run, decision or record is created). The UI keeps the deterministic figures in a separate panel labelled
*Calculated by the CAP impact engine (deterministic, not AI)*.

## Configuration

| Profile | `cds.requires.genai` | Effect |
|---|---|---|
| `[production]` (BTP) | `provider: gemini`, `model: gemini-2.5-flash`, `apiKeyEnv: GEMINI_API_KEY`, `timeoutMs: 20000`, `thinkingBudget: 0` | Live only if the environment variable `GEMINI_API_KEY` is set on the `assemblyimpact-srv` app. Without it: 409 `GENAI_NOT_CONFIGURED`, "Live AI explanations are not configured." |
| `[test]` | `provider: fixture` | Canned answers in `test/fixtures/p2/genai/answers.json`, always labelled `FIXTURE_LLM_RESPONSE` ("Canned test answer (fixture), not a live model"). |
| `[development]` | none | "Live AI explanations are not configured." The deterministic calculation is unaffected. |

Error mapping (OData):

| Situation | Status and code |
|---|---|
| Not configured | 409 `GENAI_NOT_CONFIGURED` |
| Data not approved for the model | 409 `GENAI_DATA_NOT_APPROVED` |
| Rate limit or free-tier quota exceeded (HTTP 429, with retry-after when given) | 429 `GENAI_RATE_LIMITED` |
| Timeout | 504 `GENAI_TIMEOUT` |
| Other HTTP or network errors | 502 `GENAI_UNAVAILABLE` |

The UI shows these inline and offers **Retry** for 429, 502, 503 and 504. Error messages never contain the key or the
provider's response body.

## Enabling it (owner action, not done)

The key belongs to the account owner. It must never be committed, pasted into chat, put in `mta.yaml` or shown in
screenshots.

```sh
cf set-env assemblyimpact-srv GEMINI_API_KEY '<key from Google AI Studio>'   # do not echo, do not log
cf restart assemblyimpact-srv
```

Before doing this, check Google's terms. The Gemini API Additional Terms say only **Paid Services** may be used when
making API clients available to users in the EEA, Switzerland or the UK. They also say content sent to Unpaid
Services may be used to improve Google products and reviewed by humans, and must not be sensitive, confidential or
personal.

This application is demonstrated in Germany. A free-tier key is therefore acceptable at most for a private test by the
developer. Serving the deployed app to reviewers needs a billing-enabled (paid) project, which is the owner's
decision. Only synthetic demo data is sent (step 3 above).

## Tests

`test/p2-gemini-provider.test.js` (stubbed HTTP) and `test/p2-genai-explanation.test.js` (fixture provider and
Studio controller) cover:

- a valid structured explanation, including the request shape and that the key is sent only as the
  `x-goog-api-key` header (never in the URL, body or result)
- a missing run
- incomplete cost and unknown coverage without a warning (withheld)
- empty and blocked responses
- invalid JSON or a wrong structure
- contradicting output: shortages, cost direction, decision wording
- unknown references
- timeout (504), rate limit (429 with retry-after), other HTTP and network errors
- missing credentials or model ("Live AI explanations are not configured.")
- the wrong plant (404)
- data from a non-approved source (no request sent)
- the production profile, and that no key is committed

## Browser check (BAS, 2026-11-10)

I used an isolated checkout of this branch (`ai-pr21-review`), ran `cds serve` on port 4105 and opened it with the
UI5 1.149 CDN. Case EC-000485 was checked in the Investigation Studio's AI Explanation tab:

- **Test profile (fixture provider):** "Generate explanation" shows the deterministic panel, the label "Canned test
  answer (fixture), not a live model", all section headings, next actions, warnings, evidence references and the
  source line. Screenshot: `docs/evidence/p2-gemini-ui/01-structured-fixture-answer.jpg`.
- **Development profile (no provider):** "Live AI explanations are not configured. The deterministic impact
  calculation … is unaffected." No dialog appears and the calculated figures stay visible. Screenshot:
  `docs/evidence/p2-gemini-ui/02-not-configured.jpg`.

## Live test record

None. A real test needs a key from the owner, set in the CF environment as above. Until then the P2 provider status
is *implemented and locally tested only*.
