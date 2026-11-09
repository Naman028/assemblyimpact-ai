# P2 — SAP S/4HANA adapter (status 2026-11-09)

## Architecture

```
ERP source (mode)            mapping (pure)                 same path as file imports
synthetic | sandbox | s4 ──► s4-mapping.toImportBundle ──► validateBundle ──► commitBundle ──► runImpact (unchanged engine)
srv/integration/erp/erp-source.js   srv/integration/erp/s4-mapping.js   srv/lib/scenario-import.js
```

- CAP action `EngineeringReview.extractFromErp` (role `ErpExtractor`, plant-checked): dry run returns the preview and
  validation errors; commit writes everything in one transaction with a `DataImports` provenance row
  (format `odata`, checksum of the mapped bundle, source `erp-adapter:<mode>`, user, timestamp).
- The engine never sees the transport. Provenance per mode: `synthetic` → `DEMO_IMPORT`, `sandbox` → `SANDBOX_IMPORT`,
  `s4` → `S4_IMPORT`. Sandbox or synthetic data is never labelled as S/4HANA business data.
- An engineering change is read as **two date-effective states of one material BOM**: items valid on `fromDate`
  (current) and on `toDate` (after the ECN). Item validity (`ValidityStartDate`/`ValidityEndDate`) and the change
  number decide the states, as in S/4HANA engineering change management.

## Verified API contract

Entity sets, properties and Edm types were checked against the SAP Cloud SDK VDM 2.1.0 packages
(generated from the published API metadata):

| API | Entity set | Properties used |
| --- | --- | --- |
| API_BILL_OF_MATERIAL_SRV | A_BillOfMaterial | BillOfMaterial, BillOfMaterialCategory, BillOfMaterialVariant, BillOfMaterialVariantUsage, Material, Plant, HeaderValidityEndDate, EngineeringChangeDocument |
| | A_BillOfMaterialItem | BillOfMaterialItemNumber, BillOfMaterialComponent, BillOfMaterialItemQuantity (Edm.Decimal), BillOfMaterialItemUnit, ValidityStartDate / ValidityEndDate (Edm.DateTime) |
| API_MATERIAL_STOCK_SRV | A_MatlStkInAcctMod | Material, Plant, StorageLocation, InventoryStockType (`01` unrestricted), InventorySpecialStockType (empty), MaterialBaseUnit, MatlWrhsStkQtyInMatlBaseUnit |
| API_PRODUCT_SRV | A_ProductValuation | Product, ValuationArea (= plant), ValuationType (empty, no split valuation), StandardPrice, PriceUnitQty, Currency, BaseUnit |

**Before connecting a real system** compare with that system's `$metadata`: newer S/4HANA releases also offer
`API_BILL_OF_MATERIAL_SRV;v=0002` (entity sets `MaterialBOM` / `MaterialBOMItem`); only the entity-set names in
`queries()` would change. Work instructions are not available through these APIs, so ERP cases carry none.

## Tests actually executed (`test/p2-erp-adapter.test.js`, 7 tests)

- Mapping of V2 payload shapes, `/Date(ms)/` and zone-less Edm.DateTime, decimals.
- BOM state slicing by validity, unit mapping `ST → PC`, stock aggregation (excludes quality-inspection and special
  stock), price units, other valuation areas and split valuation ignored.
- HTTP round trip against a **local mock** of the three OData V2 services (exact `$filter` contract, quote escaping,
  `APIKey` header, 401 handling) and a hand-calculated impact (76.04 → 83.02 EUR per assembly, +698.00 EUR for 100,
  2 shortages; replaced, quantity-changed, added and removed items).
- Mode guards (sandbox without API key, S/4 not enabled) and the CAP action end to end in `synthetic` mode.

Contract fixtures: `test/fixtures/p2/s4-contract` (hand-authored, synthetic; see its README).

## External blockers (not worked around)

1. **SAP Business Accelerator Hub sandbox**: needs a personal API key (`SAP_API_HUB_KEY`, never committed), and
   `sandbox.api.sap.com` is not reachable from this build environment (HTTPS proxy 403). Run from BAS with the key:
   `SAP_API_HUB_KEY=... npm start`, then call `extractFromErp` with `mode: "sandbox"` and a material/plant that
   exists in the sandbox (e.g. read `A_BillOfMaterial?$top=5` first). Result is labelled `SANDBOX_IMPORT`.
2. **Real S/4HANA**: no authorized system or destination exists. Required: a BTP destination to the system
   (Principal Propagation or OAuth2SAMLBearer; Cloud Connector for on-premise), communication arrangement
   SAP_COM_0105 / 0164 / 0009 (BOM, stock, product) or the on-premise equivalents, `erp-source.s4.enabled: true`,
   and `@sap-cloud-sdk/http-client` + `@sap-cloud-sdk/connectivity` as runtime dependencies for CAP remote services.
   Not provisioned without separate authorization.

AI assistance: designed and implemented with Claude (Anthropic) under the owner's instruction; review pending.
