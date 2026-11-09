// P4 Investigation Studio: pure view-model logic (no UI5 controls, unit-tested in Node).
// Builds one entry per BOM item number from a persisted impact run (comparison lines, material lines,
// findings). All figures come from the CAP calculation; nothing is recalculated here.
sap.ui.define([], function () {
  "use strict";

  // Illustrations that exist as validated synthetic assets (see design/assets-src).
  var ILLUSTRATIONS = {
    "COOL-100": ["B"], "GEAR-210": ["A", "B"], "VALV-320": ["A", "B"], "CTRL-400": ["A", "B"],
    "FRAME-500": ["A", "B"], "HVAC-610": ["A", "B"], "DRIV-700": ["A", "B"]
  };
  var CHANGE = {
    ADDED: { key: "added", label: "Added" }, REMOVED: { key: "removed", label: "Removed" },
    REPLACED: { key: "replaced", label: "Replaced" }, QUANTITY_CHANGED: { key: "quantity-changed", label: "Quantity changed" },
    UNCHANGED: { key: "unchanged", label: "Unchanged" }, NON_COMPARABLE: { key: "non-comparable", label: "Not comparable" }
  };

  function num(v, maxDecimals) {
    if (v === null || v === undefined || v === "") { return "–"; }
    var n = Number(v);
    if (!isFinite(n)) { return String(v); }
    return n.toLocaleString("en-US", { maximumFractionDigits: maxDecimals === undefined ? 3 : maxDecimals, minimumFractionDigits: 0 });
  }
  function money(v) {
    if (v === null || v === undefined || v === "") { return "–"; }
    return Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  /** @returns {{items: object[], summary: object}} */
  function build(run) {
    var comparison = (run && run.comparisonLines) || [], materials = (run && run.materialLines) || [], findings = (run && run.findings) || [];
    var byMaterial = {};
    materials.forEach(function (m) { byMaterial[m.material] = m; });
    var items = comparison.slice().sort(function (a, b) { return a.itemNo < b.itemNo ? -1 : a.itemNo > b.itemNo ? 1 : 0; }).map(function (c) {
      var change = CHANGE[c.change] || { key: "unknown", label: c.change || "Unknown" };
      var related = [c.fromMaterial, c.toMaterial].filter(Boolean);
      var itemFindings = findings.filter(function (f) { return f.material && related.indexOf(f.material) >= 0; });
      var stock = c.toMaterial ? byMaterial[c.toMaterial] : null;
      return {
        itemNo: c.itemNo, change: change.key, changeLabel: change.label,
        fromMaterial: c.fromMaterial || null, toMaterial: c.toMaterial || null,
        fromQuantity: c.fromQuantity, toQuantity: c.toQuantity, unit: c.unit,
        title: c.toMaterial || c.fromMaterial,
        stock: stock || null, short: !!(stock && stock.status === "SHORT"),
        findings: itemFindings,
        evidenceRefs: itemFindings.map(function (f) { return f.evidenceRefs; }).filter(Boolean)
      };
    });
    var counts = {};
    items.forEach(function (i) { counts[i.change] = (counts[i.change] || 0) + 1; });
    return {
      items: items,
      summary: run ? {
        status: run.status, flags: run.flags || "", asOfDate: run.asOfDate, costDeltaTotal: run.costDeltaTotal, currency: run.currency || "EUR",
        costDeltaPercent: run.costDeltaPercent, materialsShort: run.materialsShort, instructionFindings: run.instructionFindings,
        changed: items.length - (counts.unchanged || 0), counts: counts,
        generalFindings: findings.filter(function (f) { return !f.material; })
      } : null
    };
  }

  function illustration(assemblyCode, revision) {
    var revs = ILLUSTRATIONS[assemblyCode] || [];
    return revs.indexOf(revision) >= 0 ? "assets/assemblies/" + assemblyCode + "-" + revision + ".svg" : null;
  }

  return { build: build, illustration: illustration, num: num, money: money, CHANGE: CHANGE, ILLUSTRATIONS: ILLUSTRATIONS };
});
