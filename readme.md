# AssemblyImpact AI

**Engineering Change, Material Availability & Cost Impact Intelligence**

AssemblyImpact AI is a SAP Fiori and Generative AI application designed to investigate the consequences of engineering changes in manufacturing assemblies.

The platform aims to compare Bill of Materials (BOM) revisions, identify inconsistent work instructions, assess potential material shortages, estimate material-cost changes, and support evidence-based engineering reviews.

## Four Integrated Examination Projects

| Project | Responsibility |
|---|---|
| P1 — Joule Skills & Agent | AI-assisted engineering change investigation using connected tools |
| P2 — S/4HANA + GenAI | Authorized SAP business-data integration and grounded AI analysis |
| P3 — AI-Assisted Fiori | Generated engineering case worklist using SAP development tools |
| P4 — Fiori on BTP | Complete engineering investigation and review application |

All four projects are designed around a shared manufacturing scenario and reusable backend services.

## Technology Stack

- **Backend:** SAP Cloud Application Programming Model (CAP), Node.js, CDS, OData V4
- **Frontend:** SAPUI5, SAP Fiori elements
- **Development database:** SQLite
- **Planned cloud database:** SAP HANA Cloud, subject to provisioning
- **AI:** SAP Joule Studio and an authorized Generative AI inference service
- **Development environment:** SAP Business Application Studio
- **Version control:** Git and GitHub

## Project Structure

- `db/` — CDS domain models and demonstration data
- `srv/` — Business services, validation, calculations, and integrations
- `app/` — SAP Fiori applications
- `test/` — Automated tests, to be added

## Current Implementation Status

**Foundation development — not yet deployed**

Completed and verified:

- CAP Node.js project initialized
- CAP and SQLite dependencies installed
- Assembly domain entity defined
- CDS model compilation successful
- SQLite SQL schema generation successful
- Assembly business-identifier uniqueness constraint generated in SQL

Not yet implemented or verified:

- Runtime database constraint tests
- OData services and API tests
- Synthetic BOM and inventory records
- Stock and cost calculation services
- Fiori applications
- Joule Agent and GenAI integration
- Actual S/4HANA connection
- Authentication, authorization, and BTP deployment

## Development Setup

Requirements: Node.js 24, npm, and SAP CAP development tools.

1. Install project dependencies: `npm ci`
2. Verify the CDS model: `cds compile db/schema.cds --to json`
3. Inspect SQLite SQL generation: `cds compile db/schema.cds --to sql --dialect sqlite`

Runtime execution instructions will be added once the first CAP service is implemented and tested.

## Engineering Principles

The project follows reusable domain modeling, separation of concerns, deterministic business calculations, secure API design, automated testing, and evidence-grounded Generative AI.

Synthetic manufacturing data will be distinguished from actual SAP S/4HANA data. AI-generated explanations will not replace authoritative calculation or human review.

## References

- [SAP CAP Documentation](https://cap.cloud.sap/docs/)
- [SAPUI5 Documentation](https://ui5.sap.com/)
- [SAP Developers](https://developers.sap.com/)