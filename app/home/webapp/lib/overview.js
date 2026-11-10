/* Landing page: queries and display helpers. Presentation only — every figure comes from CAP. */
sap.ui.define([], function () {
  "use strict";

  /** Case counters: OData $count queries, restricted by the service to the user's plants. */
  var COUNTS = {
    total: "",
    open: "status eq 'OPEN'",
    inReview: "status eq 'IN_REVIEW'",
    decided: "status eq 'APPROVED' or status eq 'REJECTED'",
    notCalculated: "status eq 'OPEN' and latestRun_ID eq null",
    withShortages: "latestRun/materialsShort gt 0"
  };
  /** Provenance of the case records (db SourceType). Only S4_IMPORT comes from a real SAP S/4HANA system. */
  var SOURCES = [
    { key: "SYNTHETIC_FIXTURE", text: "Synthetic fixture (fictional NovaMotion data)", icon: "sap-icon://lab", real: false },
    { key: "DEMO_IMPORT", text: "Demo import / mock ERP extract", icon: "sap-icon://upload", real: false },
    { key: "SANDBOX_IMPORT", text: "SAP API Hub sandbox (public demo data)", icon: "sap-icon://cloud", real: false },
    { key: "S4_IMPORT", text: "SAP S/4HANA import", icon: "sap-icon://connected", real: true },
    { key: "MANUAL", text: "Manual entry", icon: "sap-icon://edit", real: false },
    { key: "GENAI_PROPOSAL", text: "GenAI proposal", icon: "sap-icon://ai", real: false }
  ];
  var DATA_SOURCE = {
    MOCK: ["MOCK", "Mock ERP — labelled synthetic S/4-shaped data", "Information"],
    SANDBOX: ["SANDBOX", "SAP API Hub sandbox — public demo data, not your ERP", "Warning"],
    S4HANA: ["S/4HANA", "S/4HANA access configured (destination)", "Success"],
    NONE: ["NONE", "No ERP source configured", "None"]
  };
  var GENAI = {
    FIXTURE: ["Test answers", "Labelled fixture answers — not live AI output", "Information"],
    GENAI_HUB: ["Generative AI Hub", "Live provider configured; answers are validated against the run", "Success"],
    NOT_CONFIGURED: ["Not configured", "AI explanations are unavailable", "None"]
  };
  var JOULE = {
    NOT_CONNECTED: ["Not connected", "Needs the deployed backend, a destination and the released SAP Build Actions project", "Warning"],
    CONFIGURED: ["Configured", "Declared by the deployment; verify the skill in Joule", "Success"]
  };
  var AUTH = {
    DEVELOPMENT: ["Development login", "Local test users — not for productive use", "Warning"],
    PRODUCTION: ["XSUAA", "SAP BTP authentication", "Success"]
  };
  var pick = function (map, key) { var v = map[key] || ["Unknown", "Status not reported", "None"]; return { text: v[0], description: v[1], state: v[2] }; };

  return {
    COUNTS: COUNTS,
    SOURCES: SOURCES,
    countPath: function (filter) { return "ReviewCases/$count" + (filter ? "?$filter=" + encodeURIComponent(filter) : ""); },
    sourcePath: function (key) { return this.countPath("sourceType eq '" + key + "'"); },
    RECENT_PATH: "ReviewCases?$select=ID,caseNumber,title,status,statusText,sourceType,sourceTypeText,assemblyCode,modifiedAt" +
      "&$expand=latestRun($select=status,costDeltaTotal,currency,materialsShort,asOfDate)&$orderby=modifiedAt%20desc&$top=6",
    dataSource: function (key) { return pick(DATA_SOURCE, key); },
    genai: function (key) { return pick(GENAI, key); },
    joule: function (key) { return pick(JOULE, key); },
    auth: function (key) { return pick(AUTH, key); },

    /** Source rows with counts; S/4HANA is always listed so that "0 real ERP records" is visible. */
    sources: function (counts) {
      return SOURCES.filter(function (s) { return counts[s.key] > 0 || s.key === "S4_IMPORT"; })
        .map(function (s) { return { key: s.key, text: s.text, icon: s.icon, real: s.real, count: counts[s.key] || 0 }; });
    },

    /** Latest calculation of a case as text; no run is "Not calculated", never a zero. */
    latest: function (run) {
      if (!run || !run.status) { return "Not calculated"; }
      var n = run.costDeltaTotal === null || run.costDeltaTotal === undefined ? null : Number(run.costDeltaTotal);
      var money = n === null ? "cost not calculable" : (n > 0 ? "+" : n < 0 ? "−" : "") +
        Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " " + (run.currency || "EUR");
      return money + " · " + (run.materialsShort || 0) + " short · as of " + run.asOfDate;
    },
    latestState: function (run) {
      if (!run || !run.status) { return "None"; }
      return run.status === "INCOMPLETE" ? "Error" : run.status === "COMPLETE_WITH_WARNINGS" ? "Warning" : "Success";
    },

    /** Launchpad intents (unchanged app IDs); inner routes keep the case or list filter. */
    hash: {
      worklist: function () { return "EngineeringCase-manage"; },
      studio: function () { return "EngineeringCase-investigate"; },
      studioCase: function (id) { return "EngineeringCase-investigate&/cases/" + encodeURIComponent(id); },
      studioStatus: function (status) { return "EngineeringCase-investigate&/?status=" + encodeURIComponent(status); },
      create: function () { return "EngineeringCase-investigate&/?create=true"; }
    }
  };
});
