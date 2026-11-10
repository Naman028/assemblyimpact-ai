# UI correction, landing page and startup — browser evidence (2026-11-10)

Captured by the AI assistant (Claude) in Chrome against the BAS dev space (port preview of port 4004,
`npm run dev`), branch `feat/ui-landing-startup`. Narrow widths (360/768/1024/1440 px) were rendered in a
same-origin iframe of exactly that width, because the browser window could not be resized; each width was
also measured with a script that lists elements overflowing the viewport or clipping their text.

| File | Shows |
|---|---|
| before-01 | Launchpad home: two small tiles, empty page |
| before-02 | Studio letterboxed to 1280 px by the shell on a 1875 px screen |
| before-03 | 1024 px: fixed-width KPIs wrap, "Impact run" alone on a second row |
| before-04 | Cost tab before the first run: "as-of date ()", "ruleset .", "Not calculable" everywhere |
| before-05 | 360 px (legend hint and step-list header clipped — found by the measurement script) |
| after-01 | Landing page: live counts, provenance, data-source/Joule/AI/sign-in status, entry points |
| after-02 | Landing page at 360 px (taken before the tile subheaders were shortened) |
| after-03 | Create Scenario tile opens the Studio with the form (authorised user) |
| after-04 | Studio at full width, master and detail side by side, "Not calculated" before the first run |
| after-05 | Deterministic run +5,340.00 EUR for EC-000495 |
| after-06/07/08 | Studio at 360 / 1024 (cost cards 2×2) / 1440 px (master 470 + detail 954 px) |
| after-09 | Worklist at full width |

Measured result after the fixes: 0 overflowing or clipped elements on all 9 Studio tabs at 360, 768, 1024
and 1440 px, and on the landing page at the same widths.

Limits: authentication was a local check-only cookie login (`/tmp`, not in the repository) because the
development basic-auth dialog cannot be driven by the browser tool; the in-memory database is reset on each
`cds watch` restart. No BTP deployment was involved.
