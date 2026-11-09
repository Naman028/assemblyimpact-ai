/* Investigation Studio: display formatters. Presentation only — figures come from CAP. */
sap.ui.define([], function () {
  "use strict";
  var STATUS = { OPEN: ["Open", "None"], IN_REVIEW: ["In Review", "Warning"], APPROVED: ["Approved", "Success"], REJECTED: ["Rejected", "Error"] };
  var RUN = { COMPLETE: ["Complete", "Success"], COMPLETE_WITH_WARNINGS: ["Complete with warnings", "Warning"], INCOMPLETE: ["Incomplete", "Error"] };
  var CHANGE = { ADDED: ["Added", "Success"], REMOVED: ["Removed", "Error"], REPLACED: ["Replaced", "Error"],
    QUANTITY_CHANGED: ["Quantity changed", "Warning"], NON_COMPARABLE: ["Non-comparable unit", "Error"], UNCHANGED: ["Unchanged", "None"] };
  var STOCK = { SHORT: ["Short", "Error"], SUFFICIENT: ["Sufficient", "Success"], UNKNOWN: ["Unknown", "Warning"], NON_COMPARABLE: ["Non-comparable", "Warning"] };
  var SEVERITY = { HIGH: ["High", "Error"], MEDIUM: ["Medium", "Warning"], LOW: ["Low", "None"] };
  var FINDING = { STOCK_GAP: "Stock gap", OUTDATED_INSTRUCTION_REFERENCE: "Outdated instruction", COMPONENT_REPLACED: "Component replaced",
    COMPONENT_REMOVED: "Component removed", COMPONENT_ADDED: "Component added", QUANTITY_CHANGED: "Quantity changed",
    NON_COMPARABLE_UNIT: "Non-comparable unit", COST_CHANGE: "Cost change" };
  var ACTION = { SUBMIT: "Submitted", APPROVE: "Approved", REJECT: "Rejected" };
  var FLAG = { STOCK_STALE: "stock snapshot older than 7 days", STOCK_UNKNOWN: "stock unknown for at least one material",
    STOCK_NON_COMPARABLE: "stock unit differs from BOM unit", COST_INCOMPLETE: "price missing or not comparable", NON_COMPARABLE_UNIT: "BOM units differ between revisions" };
  var num = function (v) { return v === null || v === undefined || v === "" ? null : Number(v); };
  var pick = function (map, v, i) { return map[v] ? map[v][i] : (i === 0 ? (v || "") : "None"); };

  return {
    caseStatus: function (v) { return pick(STATUS, v, 0); },
    caseState: function (v) { return pick(STATUS, v, 1); },
    runStatus: function (v) { return v ? pick(RUN, v, 0) : "Not calculated"; },
    runState: function (v) { return v ? pick(RUN, v, 1) : "None"; },
    change: function (v) { return pick(CHANGE, v, 0); },
    changeState: function (v) { return pick(CHANGE, v, 1); },
    stock: function (v) { return pick(STOCK, v, 0); },
    stockState: function (v) { return pick(STOCK, v, 1); },
    severity: function (v) { return pick(SEVERITY, v, 0); },
    severityState: function (v) { return pick(SEVERITY, v, 1); },
    findingType: function (v) { return FINDING[v] || v || ""; },
    decision: function (v) { return ACTION[v] || v || ""; },
    flags: function (v) {
      if (!v) { return ""; }
      return String(v).split(",").map(function (f) { return FLAG[f] || f; }).join("; ");
    },
    /** Money with 2 decimals and sign; null -> "Not calculable". */
    money: function (v, currency) {
      var n = num(v);
      if (n === null) { return "Not calculable"; }
      var s = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return (n < 0 ? "−" : n > 0 ? "+" : "") + s + " " + (currency || "EUR");
    },
    plainMoney: function (v, currency) {
      var n = num(v);
      return n === null ? "Not calculable" : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " " + (currency || "EUR");
    },
    unitPrice: function (v) {
      var n = num(v);
      return n === null ? "—" : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 }) + " EUR";
    },
    percent: function (v) {
      var n = num(v);
      return n === null ? "" : (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n).toFixed(2) + " %";
    },
    quantity: function (v) {
      var n = num(v);
      return n === null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 3 });
    },
    deltaState: function (v) {
      var n = num(v);
      return n === null ? "None" : n > 0 ? "Error" : n < 0 ? "Success" : "None";
    },
    countState: function (v) { return num(v) > 0 ? "Error" : "Success"; },
    dateTime: function (v) {
      if (!v) { return ""; }
      var d = new Date(v);
      return isNaN(d) ? String(v) : d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
    },
    revisionPath: function (a, b) { return a && b ? "Revision " + a + " → " + b : ""; },
    sourceIcon: function (v) { return v === "DEMO_IMPORT" ? "sap-icon://upload" : v === "S4_IMPORT" || v === "SANDBOX_IMPORT" ? "sap-icon://connected" : "sap-icon://lab"; },
    yesNo: function (v) { return v === true ? "Yes" : v === false ? "No" : "—"; }
  };
});
