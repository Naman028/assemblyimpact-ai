# P2 S/4HANA contract fixtures (synthetic)

OData V2 JSON responses **authored by hand** in the shape of the SAP S/4HANA Cloud APIs
`API_BILL_OF_MATERIAL_SRV` (A_BillOfMaterial, A_BillOfMaterialItem), `API_MATERIAL_STOCK_SRV`
(A_MatlStkInAcctMod) and `API_PRODUCT_SRV` (A_ProductValuation). Property names and Edm types were taken from
the SAP Cloud SDK VDM 2.1.0 packages (`@sap/cloud-sdk-vdm-bill-of-material-service`, `-material-stock-service`,
`-product-service`), which are generated from the published API metadata.

They are **not captured from any SAP system** and contain no business data (fictional material PMP-4711,
engineering change 500000000012 effective 2027-01-01). They exercise: date-effective items (Edm.DateTime
`/Date(ms)/`), a replaced component, a quantity change, an added and a removed item, internal unit `ST`,
stock across storage locations with quality-inspection and special stock to exclude, price units, another
valuation area and split valuation to ignore.

Used by `test/p2-erp-adapter.test.js` and by the `synthetic` ERP mode. Before connecting a real system, compare
these shapes with the target system's `$metadata` (API version and release).
