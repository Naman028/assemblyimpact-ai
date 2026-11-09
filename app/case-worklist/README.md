# P3 Engineering Change Case Worklist

SAP Fiori elements (OData V4) List Report / Object Page app on the existing
`EngineeringReview` service (`/odata/v4/engineering-review/`).

- Pages: Review Cases (list) -> Review Case -> Impact Run -> Finding.
- Read-only. The only operation is the bound action `runImpact`, which the
  server allows for `ChangeAnalyst` only and restricts to the user's plants.
- Origin: page structure from SAP Project Accelerator output (generated
  2026-11-09 in a separate sandbox). The generated draft-enabled service and
  data model were not imported; see `docs/evidence/p3-case-worklist/`.
- Data shown is SYNTHETIC development data (`test/data`), never S/4HANA data.

Run locally: `npm start`, then open
`http://localhost:4004/case-worklist/webapp/index.html` and sign in with a
development user (`cviewer`, `analyst`, `analyst2000`; password
`development-only`).
