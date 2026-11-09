# M04 Slice 1b — verification summary

| Gate | Environment | Command / check | Exit | Result | Evidence |
| --- | --- | --- | --- | --- | --- |
| Unit + integration + regression | BAS (Node v24.21.0) | `npm test` | 0 | 35 tests, 35 pass, 0 fail | E-07, logs/E-07-npm-test.log |
| Lint | BAS | `npm run lint` | 0 | 0 problems (max-warnings 0) | E-07 |
| Dependency audit | BAS | `npm audit --package-lock-only --audit-level=high` | 0 | 0 vulnerabilities | E-07 |
| Clean install | BAS | `npm ci` | 0 | 0 vulnerabilities | E-07 |
| Seed drift | BAS | `node tools/m04/build-seed.mjs --check` | 0 | up to date | E-02, E-07 |
| Seed loading | BAS (development) | `npm start` | - | 8 CSVs loaded, both services served | E-03 |
| OData seeded data | BAS (development) | curl as cviewer / analyst2000 / developer | - | per-plant records as specified | E-04 |
| Oracle (DS-ORACLE-01) | BAS (development) | POST runImpact EC-000473 | - | 56.00 -> 68.00, +1200.00 (21.43 %), 2 short, 7 findings; stable fingerprint | E-05 |
| Authorization / negatives | BAS (development) | 13 HTTP checks | - | 12 pass + 1 harness error corrected (E-06b) | E-06a, E-06b |
| Same suite locally | Node 24.22.2 | `npm test`, lint, audit | 0 | 35/35, clean | implementation commit message |
| Mutation check | local | FAN-B price 42.00 -> 43.00 | - | drift, oracle and price tests failed as intended; restored | decisions.md |
| GitHub Actions | GitHub | workflow on push / PR | - | pending at the time this file was committed | PR |
