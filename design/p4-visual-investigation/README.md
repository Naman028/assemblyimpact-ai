# P4 visual investigation — component diagram assets (preparation only)

Status: **assets and mapping only**. The interactive P4 interface (selection → findings, stock, prices,
work instructions) is implemented in its own milestone, not here.

| File | Purpose |
| --- | --- |
| `COOL-100.components.svg` | Component-addressable SVG. Each BOM item position is a `<g class="ai-component">` with a stable id (`ai-item-0010`, brackets per unit `ai-item-0020-u1..u3`), `data-item-no`, `data-material-rev-a`, `data-material-rev-b`, keyboard focus (`tabindex`) and an `aria-label`. |
| `COOL-100.component-map.json` | Mapping from BOM item numbers to SVG element ids and materials per revision, CSS state classes, and the backend entities a selection links to. |
| `preview.html` | Static, non-interactive preview that applies the DS-ORACLE-01 comparison states (for review only). |

Change states come from `ImpactComparisonLines.change` of an impact run, joined on `itemNo`:
`ADDED` (SEAL-01, bracket unit 3), `REPLACED` (FAN-A → FAN-B), `QUANTITY_CHANGED` (BRKT-01 2 → 3),
`UNCHANGED` (SENS-01). `REMOVED` is supported by a style class; COOL-100 has no removed item.

Source: `design/assets-src/cool-100/build_cool100_svgs.py` (hand-authored vector drawing; no image
generator was used). Synthetic data; not CAD or engineering documentation. The mapping is checked
against the fixture BOM by `test/assembly-visuals.test.js`.
