# P4 — Engineering Investigation Studio (freestyle SAPUI5)

Case-centred workspace for one engineering change, on the same OData V4 service as the P3 worklist
(`/odata/v4/engineering-review/`). Hand-built (not generated); the M04 UI contract §3 is the functional target.

| Area | Source (all server-side) |
| --- | --- |
| Case list (begin column), search, status filter | `ReviewCases` + `latestRun` |
| Header KPIs: cost delta, materials short, instruction findings, run status | latest `ImpactRuns` snapshot |
| **Assembly** tab: component diagram + synchronized detail panel | `ImpactComparisonLines` (states), `ImpactMaterialLines` (stock, unit price), `Findings`, `Instructions/references` |
| BOM Comparison, Materials & Stock (shortages toggle), Cost, Work Instructions, Findings | same run |
| Evidence: run ID, ruleset, fingerprint, as-of, provenance, import checksum, run history | `ImpactRuns`, `DataImports` |
| Review: Run Impact, Submit, Approve (names the evaluated run; warnings acknowledgement), Reject (reason), decision history | bound actions; availability from `canRunImpact/canSubmit/canDecide` |
| Import Scenario dialog: file → server validation → preview / errors → confirm → commit | unbound action `importScenario` (dry run, then commit) |

Visuals:
- **COOL-100**: the hand-authored, component-addressable diagram from `design/p4-visual-investigation` (copied to `assets/`).
- **Other assemblies**: `lib/schematic.js` generates a component schematic from the BOM lines (generic glyph per material
  family, layout grid). It is labelled "generated, synthetic, not CAD" and carries no engineering geometry.
- Change state is shown by outline/halo colour **and** a text badge, the legend, and the detail panel; each component is
  keyboard-focusable (`tabindex`, `role="button"`, `aria-label`, Enter/Space selects).

No business logic in the browser: change classification, cost, stock gaps, instruction checks and every review rule
are computed or enforced by CAP; the UI only displays results and collects input.

Run locally (development profile, mocked users `analyst` / `approver` / `cviewer`, password `development-only`):
`npm start`, then open `http://localhost:4004/investigation-studio/webapp/index.html`. Deep link: `#/cases/<ReviewCases.ID>`.
The P3 Object Page links here ("Open in Investigation Studio").

Evidence: `docs/evidence/m05/` (screenshots rendered with OpenUI5 1.149.0 from npm, headless Chromium). Tests:
`test/m05-investigation-studio.test.js`.

AI assistance: implemented with Claude (Anthropic) under the owner's instruction; review by the students pending.
