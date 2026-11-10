# AssemblyImpact AI — Access and Database Guide (BTP trial deployment)

Status: 2026-11-10. Deployed from `main` @ `ca75e77` (PR #19). No passwords, secrets or service keys appear in this guide.

## 1. Where the application runs

| Item | Value |
| --- | --- |
| Launchpad (sign in here) | https://78485bd6trial-dev-assemblyimpact-router.cfapps.us10-001.hana.ondemand.com/launchpad.html |
| Backend (OData, never opened directly; 401 without a token) | https://78485bd6trial-dev-assemblyimpact-srv.cfapps.us10-001.hana.ondemand.com/odata/v4/engineering-review/ |
| Global account / subaccount | `78485bd6trial` / AssemblyImpact AI (Trial), US10 |
| Cloud Foundry | org `78485bd6trial`, space `dev` |
| MTA | `assemblyimpact-ai` 0.5.0 — apps `assemblyimpact-srv`, `assemblyimpact-router`, `assemblyimpact-db-deployer` (task, stopped after deploy) |
| Services created by the MTA | `assemblyimpact-db` (HDI container, `hdi-shared`), `assemblyimpact-auth` (XSUAA `application`), `assemblyimpact-destination` (Destination `lite`) |
| Database | existing SAP HANA Cloud instance `assemblyimpact-hana` (`hana-free`), reused, not replaced |

All plans are trial/free entitlements of the subaccount; nothing paid was created.

## 2. Two separate authentication worlds

| | Development (BAS, `npm start` / `npm run demo`) | Deployed (BTP) |
| --- | --- | --- |
| Mechanism | CAP mocked authentication (HTTP basic, browser login dialog) | XSUAA + SAP ID service (your SAP account login) |
| Users | fixed list in `package.json` → `cds.requires["[development]"].auth.users` | real SAP ID users you assign to role collections |
| Passwords | development-only value defined in that profile; never valid in BTP | managed by SAP ID service (accounts.sap.com); the application never sees them |
| Plants | `attr.plants` in the mocked user | static `plants` value on the role (`*_P1000` roles) |

The mocked users are rejected in the deployed system (the `[production]` profile uses `auth.kind = xsuaa`).

### 2.1 Development accounts (BAS only)

| User | Roles | Plants | Use it for |
| --- | --- | --- | --- |
| `developer` | AssemblyMaintainer | 1000 | assembly catalogue maintenance (no change-case actions) |
| `analyst` | ChangeAnalyst, DemoDataImporter, ErpExtractor | 1000 | create/import scenarios, run impact, submit for review |
| `approver` | ChangeApprover | 1000 | approve / reject cases that are *In Review* |
| `cviewer` | ChangeViewer | 1000 | read-only |
| `analyst2000` | ChangeAnalyst | 2000 | plant-isolation test (sees only plant 2000) |

Switching accounts: the browser caches basic-auth credentials per origin. Use a private window per user, or close all windows of the preview origin, then reload and sign in as the other user. To change the development password, edit the value in your local profile only — preferably in a git-ignored `.cdsrc-private.json` under `requires.[development].auth.users.<user>.password` — and restart CAP. Never reuse a real password there.

### 2.2 Deployed accounts (XSUAA)

Roles created in the cockpit (Security → Roles), each with static attribute `plants = 1000`:
`ChangeAnalyst_P1000`, `ChangeApprover_P1000`, `ChangeViewer_P1000`, `DemoDataImporter_P1000`, `ImpactRunner_P1000`.
The template default roles have no plant value and therefore see nothing (fail-closed by design).

| Role collection | Roles (current) | Assigned users |
| --- | --- | --- |
| `AssemblyImpact_Analyst` | ChangeAnalyst_P1000, ChangeViewer_P1000, DemoDataImporter_P1000 | owner account (Naman) |
| `AssemblyImpact_Approver` | ChangeApprover_P1000 | none yet |
| `AssemblyImpact_Viewer` | ChangeViewer_P1000 | none yet |
| `AssemblyImpact_JouleImpactRunner` | none yet | none |

Deviation from `docs/btp/role-collections.json`: the AssemblyViewer roles (assembly catalogue app) and the JouleReader/ErpExtractor collections are not created yet; add them the same way when needed.

**Assigning a user** (subaccount administrator): Security → Role Collections → collection → Edit → Users → ID and e-mail = the person's SAP ID e-mail, identity provider *Default identity provider* → + → Save. The user signs out (`/do/logout`) and in again to receive the new token.

**Separation of duties**: the person who submitted a case cannot approve it. A faculty demonstration of approval therefore needs a **second SAP ID user** (e.g. a team member) in `AssemblyImpact_Approver`. Creating SAP ID accounts for other people is their own registration at accounts.sap.com; passwords are never set or shared by us.

**Switching users**: open the launchpad in a separate browser profile/private window per person, or log out via `…/do/logout`.

## 3. Demonstration roles

| Step | Account / collection |
| --- | --- |
| Create or import a synthetic scenario | Analyst (DemoDataImporter) |
| Run impact, submit for review | Analyst |
| Approve / reject | a *different* user in Approver |
| Browse only | Viewer |

## 4. HANA database inventory

* HDI container: service instance `assemblyimpact-db` (plan `hdi-shared`) on `assemblyimpact-hana`. Tables are named `ASSEMBLYIMPACT_<ENTITY>`.

| Entity (table) | Purpose |
| --- | --- |
| Assemblies | assembly master (code, plant, description) |
| BOMStates / BOMItems | date-effective BOM revisions and their items |
| CostPrices | standard prices per material/plant with validity |
| StockSnapshots | available quantity per material/plant at a timestamp |
| Instructions / InstructionReferences | work instructions and the materials each step references |
| ReviewCases | engineering change cases (from/to BOM state, quantity, status) |
| CaseAttachments, DataImports | evidence files and import audit records |
| ImpactRuns, ImpactComparisonLines, ImpactMaterialLines, Findings | immutable results of the deterministic impact calculation |
| DecisionEvents | append-only submit/approve/reject history |

Record counts (live, via the authorized OData service, 2026-11-10 after the demo import and one impact run):
ReviewCases 7 · BOMStates 14 · BOMItems 54 · CostPrices 36 · StockSnapshots 36 · ImpactRuns 1 · Findings 7 · DecisionEvents 0
(plus 7 assemblies, 13 instructions, 38 instruction references from the import).

**Synthetic vs. imported SAP data**: every record here comes from the synthetic NovaMotion dataset (`sourceType = DEMO_IMPORT`, labelled "imported demo data" in the UI). Records extracted from a real S/4HANA system would carry `S4_IMPORT`; the ERP connection is disabled in this deployment (`Data source mode: NONE`).

**Inspecting safely**: BTP cockpit → Instances → `assemblyimpact-hana` → *Open SAP HANA Database Explorer* → add the HDI container `assemblyimpact-db` → Catalog → Tables (`ASSEMBLYIMPACT_*`). Use SELECT only. Do not run INSERT/UPDATE/DELETE/DROP; business changes go through the application so authorization, plant isolation and audit events apply. Trial HANA stops every night: start it in HANA Cloud Central before use.

**Persistence**: verified 2026-11-10 — `cf restart assemblyimpact-srv` at 12:13:38 UTC; all counts and impact run `76c59610…` (1,200.00 EUR, 2 short) unchanged afterwards.

## 5. Deployment-specific settings applied

* `CDS_CONFIG={"features":{"demo_import":true}}` on `assemblyimpact-srv` (trial demo only) so the synthetic dataset could be imported through the validated import. Remove with `cf unset-env assemblyimpact-srv CDS_CONFIG && cf restart assemblyimpact-srv` for a production-like setup.
* `assemblyimpact-srv` memory raised to 512 MB (was at 251 of 256 MB); `mta.yaml` updated accordingly.

## 6. Administrator-only actions

* Assigning role collections, creating roles (subaccount administrator — you).
* Destinations for SAP Build Actions: must be created in the BTP subaccount that hosts your SAP Build tenant. The current Actions/Joule projects are in the shared SAP-managed tenant `sap-build-eu10-trial-2`, where you have no destination administration (see P1 report).
* Starting the HANA trial instance after the nightly stop.
