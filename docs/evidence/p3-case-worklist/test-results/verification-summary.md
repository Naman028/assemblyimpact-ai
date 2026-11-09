# P3 Case Worklist — verification summary

| Gate | Local | BAS (dev space ws-lecln) | GitHub Actions |
| --- | --- | --- | --- |
| `npm test` | 40 tests, 40 pass, 0 fail (head 18cacdb) | 40 tests, 40 pass, 0 fail at 377e46a and 18cacdb (`logs/npm-test.log`) | success |
| `npm run lint` | exit 0 | exit 0 | success |
| `npm audit --package-lock-only --audit-level=high` | 0 vulnerabilities | — | success |
| New dependencies | none (package-lock.json unchanged) | — | — |
| Browser preview | — | P3-08 to P3-22 | — |

GitHub Actions: workflow "M03 verification", job `verify`, run 42589847906 (pull_request) on 18cacdb: success
(npm ci, lint, test, audit). PR #5: open, draft, mergeable (clean), 4 commits, 86 files (P3-23).
The final evidence commit is verified by a new CI run reported on PR #5 (a file cannot record its own CI result).

Defects found in the running UI and fixed: UI5 1.120 startup error and zero-height container (af43aaf), unsorted section tables (377e46a).

Deep-link "Not Found": reproduced under controlled user switching (P3-21) and ruled out with a control trial (P3-22).
It is the previous user's correct 404 dialog left open after an in-app identity switch; not an application defect; no code change.

Artifact preservation (P3-24): sandbox still at 9910c02; its git tree hash equals the tree hash of `generated/`
(e6c3a4fa7e161aebde240ce3dbb6f1e64787f1b2); original archive differs in 0 files; the application model serves
AssemblyCatalog and EngineeringReview only, with no draft annotations.

Security checks: secret pattern scan of the PR diff found nothing; no new packages; authorization and plant isolation
unchanged and covered by tests.

Review performed by one AI system (Claude, Anthropic); no human or SAP reviewer.
