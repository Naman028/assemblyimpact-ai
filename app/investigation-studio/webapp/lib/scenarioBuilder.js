/**
 * Faculty demo: turns the "Create Scenario" form into the import bundle that importScenario already validates
 * (the same format as samples/scenario-import-sample.json). No second data model and no client-side business
 * rules: the server validates everything again, previews it, and commits all records or none.
 * A component row goes into revision A when it has a current quantity and into revision B when it has a
 * proposed quantity; two rows with the same item number and different materials model a replacement.
 */
sap.ui.define([], function () {
  "use strict";

  var pad = function (n) { return String(n).padStart(4, "0"); };
  var trim = function (v) { return v === undefined || v === null ? "" : String(v).trim(); };
  var num = function (v) { var s = trim(v).replace(",", "."); return s === "" ? null : s; };
  var dayBefore = function (iso) { var d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };

  /** A ready-to-run original example (fictional) so a demo does not start from an empty form. */
  function example() {
    return {
      assemblyCode: "PUMP-950", description: "Coolant Circulation Pump", plant: "1000",
      caseNumber: "EC-000495", title: "High-efficiency motor and ceramic seal on PUMP-950", owner: "Engineering Reviewer 1",
      productionQuantity: 120, currentValidFrom: "2026-01-01", effectiveDate: "2027-01-01",
      stockAt: new Date().toISOString().slice(0, 16) + ":00Z", includeInstruction: true, instructionTitle: "Assemble coolant pump",
      components: [
        { itemNo: "0010", material: "HSG-950", description: "Pump housing", unit: "PC", currentQty: "1", proposedQty: "1", price: "42.00", currency: "EUR", stock: "200" },
        { itemNo: "0020", material: "MOT-950", description: "Standard motor 0.75 kW", unit: "PC", currentQty: "1", proposedQty: "", price: "95.00", currency: "EUR", stock: "150" },
        { itemNo: "0020", material: "MOT-950E", description: "IE4 motor 0.75 kW", unit: "PC", currentQty: "", proposedQty: "1", price: "128.00", currency: "EUR", stock: "60" },
        { itemNo: "0030", material: "SEAL-950", description: "Mechanical seal (ceramic)", unit: "PC", currentQty: "1", proposedQty: "2", price: "11.50", currency: "EUR", stock: "180" },
        { itemNo: "0040", material: "BLT-950", description: "Housing bolt M8", unit: "PC", currentQty: "6", proposedQty: "6", price: "0.35", currency: "EUR", stock: "900" }
      ]
    };
  }

  function emptyRow(rows) {
    var last = (rows || []).reduce(function (m, r) { return Math.max(m, Number(r.itemNo) || 0); }, 0);
    return { itemNo: pad(last + 10), material: "", description: "", unit: "PC", currentQty: "", proposedQty: "", price: "", currency: "EUR", stock: "" };
  }

  /** Obvious form gaps before calling the server (which remains the authority). */
  function check(form) {
    var problems = [];
    ["assemblyCode", "description", "plant", "caseNumber", "title", "currentValidFrom", "effectiveDate"].forEach(function (k) {
      if (!trim(form[k])) { problems.push(k + " is required"); }
    });
    if (!(Number(form.productionQuantity) > 0)) { problems.push("productionQuantity must be greater than zero"); }
    if (trim(form.effectiveDate) && trim(form.currentValidFrom) && form.effectiveDate <= form.currentValidFrom) {
      problems.push("the proposed revision must become effective after the current revision starts");
    }
    var rows = (form.components || []).filter(function (r) { return trim(r.material); });
    if (!rows.some(function (r) { return num(r.currentQty); })) { problems.push("revision A needs at least one component"); }
    if (!rows.some(function (r) { return num(r.proposedQty); })) { problems.push("revision B needs at least one component"); }
    return problems;
  }

  function build(form) {
    var code = trim(form.assemblyCode).toUpperCase(), plant = trim(form.plant), from = trim(form.currentValidFrom), eff = trim(form.effectiveDate);
    var caseNumber = trim(form.caseNumber).toUpperCase(), stateA = "BOM-" + code + "-A", stateB = "BOM-" + code + "-B";
    var rows = (form.components || []).filter(function (r) { return trim(r.material); }).map(function (r) {
      return { itemNo: pad(trim(r.itemNo) || "0"), material: trim(r.material).toUpperCase(), description: trim(r.description), unit: trim(r.unit).toUpperCase() || "PC",
        currentQty: num(r.currentQty), proposedQty: num(r.proposedQty), price: num(r.price), currency: trim(r.currency).toUpperCase() || "EUR", stock: num(r.stock) };
    });
    var bundle = {
      datasetId: ("DS-FORM-" + caseNumber).slice(0, 40), synthetic: true,
      description: "SYNTHETIC scenario created in the Investigation Studio form (fictional; not SAP data)",
      assemblies: [{ assemblyCode: code, plant: plant, description: trim(form.description) }],
      bomStates: [
        { stateKey: stateA, assemblyCode: code, plant: plant, bomUsage: "1", alternative: "01", revision: "A", validFrom: from, validTo: dayBefore(eff), status: "RELEASED" },
        { stateKey: stateB, assemblyCode: code, plant: plant, bomUsage: "1", alternative: "01", revision: "B", validFrom: eff, validTo: "9999-12-31", status: "PROPOSED", changeNumber: caseNumber }
      ],
      bomItems: [], costPrices: [], stockSnapshots: [], instructions: [], instructionReferences: [],
      reviewCases: [{ caseNumber: caseNumber, title: trim(form.title), assemblyCode: code, plant: plant, fromStateKey: stateA, toStateKey: stateB,
        productionQuantity: Number(form.productionQuantity), owner: trim(form.owner) || null }]
    };
    var seen = {};
    rows.forEach(function (r) {
      if (r.currentQty) { bundle.bomItems.push({ stateKey: stateA, itemNo: r.itemNo, material: r.material, quantity: r.currentQty, unit: r.unit }); }
      if (r.proposedQty) { bundle.bomItems.push({ stateKey: stateB, itemNo: r.itemNo, material: r.material, quantity: r.proposedQty, unit: r.unit }); }
      if (seen[r.material]) { return; }
      seen[r.material] = true;
      if (r.price) { bundle.costPrices.push({ material: r.material, plant: plant, price: r.price, currency: r.currency, priceUnit: 1, unit: r.unit, validFrom: from, validTo: "9999-12-31" }); }
      if (r.stock !== null) { bundle.stockSnapshots.push({ material: r.material, plant: plant, availableQuantity: r.stock, unit: r.unit, snapshotAt: trim(form.stockAt) || new Date().toISOString() }); }
    });
    if (form.includeInstruction) {
      var wi = "WI-" + code + "-ASM";
      bundle.instructions.push({ instructionId: wi, version: 1, assemblyCode: code, plant: plant, title: trim(form.instructionTitle) || "Assemble " + code, status: "RELEASED", validFrom: from });
      rows.filter(function (r) { return r.currentQty; }).forEach(function (r) {
        bundle.instructionReferences.push({ instructionId: wi, version: 1, step: r.itemNo, material: r.material, quantity: r.currentQty, unit: r.unit,
          text: "Fit " + r.currentQty + " " + r.unit + " " + r.material + (r.description ? " (" + r.description + ")" : "") });
      });
    }
    return bundle;
  }

  return { example: example, emptyRow: emptyRow, check: check, build: build };
});
