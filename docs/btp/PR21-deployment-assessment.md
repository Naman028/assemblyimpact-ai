# PR #21 — deployment, HANA migration and launchpad 404 assessment

Status: assessment only. Nothing was deployed, migrated or changed in Cloud Foundry or HANA. All checks were read-only (2026-11-10).

## 1. Current environment (read-only evidence)

| Item | Observed |
|---|---|
| CF API / org / space | `api.cf.us10-001.hana.ondemand.com` / `78485bd6trial` / `dev` (`cf target`) |
| Apps (`cf apps`) | `assemblyimpact-router` started 1/1; `assemblyimpact-srv` started 1/1; `assemblyimpact-db-deployer` stopped 0/1 (normal: the HDI deployer exits after deploying) |
| Deployed source | `main@ca75e77` (handover in PR #20) |
| Database | HANA Cloud `assemblyimpact-hana`, HDI container `assemblyimpact-db` bound to srv and db-deployer (mta.yaml) |
| Auth | XSUAA `assemblyimpact-auth`, role collections from `xs-security.json` (PR #20 guide) |

## 2. "Launchpad returns Not Found" — root cause

HTTP status checks from BAS (unauthenticated `curl`):

| URL | Result | Meaning |
|---|---|---|
| `https://78485bd6trial-dev-assemblyimpact-router.cfapps.us10-001.hana.ondemand.com/` | 302 → `/launchpad.html` | `welcomeFile` works |
| `…-router…/launchpad.html` | 200 | route exists (app router answers with its login redirect page until a user signs in) |
| `…-router…/home/webapp/manifest.json` | 200 | staged UI resources present |
| `…-router…/Launchpad.html`, `…/launchpad.htm` | 404 `Not Found` (plain text, app router) | paths are case-sensitive and exact |
| `https://78485bd6trial-dev-assemblyimpact-srv.cfapps.us10-001.hana.ondemand.com/launchpad.html` | 404 (`<title>Error</title>`, CAP) | **the CAP service does not serve the UI in production** |

Conclusion: the deployed router and its static content are correct. A `Not Found` comes from opening `launchpad.html` on the **srv** route (shown next to the router route in the BTP cockpit and in `cf apps`) or from a mistyped path. This is expected behaviour: production CAP serves only `/odata/...`, and the UI is staged into the app router by `tools/btp/stage-ui.mjs` (`app/router/resources`, gitignored, built by the MTA `before-all` step).

Correction: none in code. The only URL to use is
`https://78485bd6trial-dev-assemblyimpact-router.cfapps.us10-001.hana.ondemand.com/launchpad.html`.
This is documented in the README.

## 3. HDI schema delta of PR #21 (generated, compared with `main`)

Method: `cds.compile.to.hdi` for `db` + `srv` on `main@ca75e77` and on the PR head, and `cds build --production` (`@sap/cds-dk@10.2.1`, as in `mta.yaml`) on the PR head.

| | main | PR #21 |
|---|---|---|
| HDI artifacts | 36 | 38 |
| Added | — | `assemblyimpact.MaterialConsumptionRates.hdbtable`, `EngineeringReview.MaterialConsumptionRates.hdbview` |
| Changed | — | none |
| Removed | — | none |

New table: `ID NVARCHAR(36)` primary key, managed fields, `material NVARCHAR(40)`, `plant NVARCHAR(4)`, `period NVARCHAR(5)`, `quantity DECIMAL(13,3)`, `unit NVARCHAR(3)`, `validFrom/validTo DATE`, `sourceType` default `'MANUAL'`, `note`, `active BOOLEAN NOT NULL DEFAULT TRUE`, `deactivatedAt/By`, `deactivationReason`. No foreign keys to existing tables. The existing unique constraint on `ReviewCases.caseNumber` is unchanged.

Data loading: `cds build --production` produced **no `.hdbtabledata` and no CSV**. The production profile reads only `db/data` and `db/csv`, which do not exist in the repository; the synthetic seed is in `test/data` and is used only by development and tests. A deployment can therefore not reload or overwrite business records.

`gen/db/undeploy.json` (CAP default) allows removing generated views, indexes, constraints, draft tables and calculation views only — never business tables.

Preserved: assemblies, BOM states/items, cost prices, stock snapshots, instructions, review cases, impact runs (comparison/material lines), findings, decision events, data imports (audit), attachments. Role collections live in XSUAA and are not touched by an HDI deployment.

**HANA migration assessment: GO for an additive deployment, after approval.** Risk: low (two new artifacts, no changed or removed artifacts, no data files).

## 4. Proposed deployment procedure (requires explicit approval)

1. Gates: PR #21 reviewed and merged; CI green on the merge commit; `cds build --production` delta re-checked against this report.
2. Build in BAS: `mbt build -t mta_archives` (runs `npm ci`, `cds build --production`, `tools/btp/stage-ui.mjs`).
3. Deploy without deleting anything: `cf deploy mta_archives/assemblyimpact-ai_<version>.mtar` (no `--delete-services`, no `--delete-service-keys`).
4. Post-deployment checks: `cf apps` (router/srv started), router `/launchpad.html` sign-in with an SAP ID user, counts of `ReviewCases`, `ImpactRuns`, `DecisionEvents` unchanged in Database Explorer, `MaterialConsumptionRates` exists and is empty.
5. Recovery: the HDI deployment is additive. If the new application version misbehaves, redeploy the previous MTA archive (`main@ca75e77`); the new table stays (harmless, unused). Rolling back data is not needed because no existing table changes.

## 5. Not verified

- The deployment itself (not performed).
- Router logs for the original 404 report (only status checks were run; the recent log extract did not contain a 404 line).
