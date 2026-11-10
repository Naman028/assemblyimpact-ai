# Faculty demo walkthrough — BAS browser evidence (2026-11-10)

Captured in SAP Business Application Studio (trial dev space, US10) on branch
`feat/faculty-demo-completion`, served with `cds-serve` on port 4020 and opened
through the BAS port preview in Chrome. The screenshots were taken by the
AI assistant (Claude) driving the browser, not edited afterwards.

| # | File | What it shows |
|---|------|---------------|
| 1 | 01-launchpad-home.jpg | Fiori launchpad sandbox: both apps as tiles (one entry point) |
| 2 | 02-studio-case-list.jpg | Investigation Studio case list |
| 3 | 03-create-scenario-form.jpg | Create Engineering Scenario form (PUMP-950, rev A→B, 6 components) |
| 4 | 04-import-validation-passed.jpg | Server-side validation: 1 case, 27 records, no errors |
| 5 | 05-new-case-EC-000495.jpg | Committed case opened; impact "Not calculated" |
| 6 | 06-run-impact-5340-EUR.jpg | Run Impact: +5,340.00 EUR (hand check: (195.10−150.60)×120) |
| 7 | 07-edit-input-seal-950-qty.jpg | Controlled demo edit: SEAL-950 proposed quantity 2→3 |
| 8 | 08-result-cleared-after-edit.jpg | Edit invalidates latest result; old run stays stored unchanged |
| 9 | 09-rerun-6720-EUR.jpg | Re-run: +6,720.00 EUR (expected after the edit) |
| 10 | 10-evidence-image-uploaded.jpg | PNG supporting image shown in the Evidence tab |
| 11 | 11-submit-for-review.jpg | Analyst submits for review |
| 12 | 12-approve-as-approver.jpg | Approver approves, naming the latest run |
| 13 | 13-approved-evidence-frozen.jpg | Approved; edits and uploads are blocked |
| 14 | 14-worklist-via-launchpad.jpg | Back to the worklist via launchpad intent; EC-000495 with 1 finding, 2 short, 6,720.00 |

## Limits of this evidence (stated honestly)

- Auth was a local check-only configuration (mocked users `analyst` / `approver`
  switched by cookie), not XSUAA. BTP deployment was not performed.
- The image upload ran the same OData calls the dialog makes (`POST` the
  attachment, `PUT` the content) from the page, because the browser tool could not
  drive the native file picker. Server checks were also verified: a PNG gave 201/204;
  an SVG renamed to `.png` was rejected with 415; the served image had
  `X-Content-Type-Options: nosniff`.
- PUMP-950 has no illustration in the worklist because it was created through the
  form; only seeded assemblies have SVG drawings.
- The GenAI explanation uses the labelled fixture provider, not a live model.
