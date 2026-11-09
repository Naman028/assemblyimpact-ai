// P4 Investigation Studio: case-centred component investigation inside the case Object Page.
// Reads the case's latest impact run through the existing OData V4 model (no separate backend calls,
// no client-side calculation). Component tiles are native buttons (keyboard + screen reader); the
// selected item shows BOM change, stock/price line, findings and evidence references side by side.
sap.ui.define([
  "sap/ui/core/Control",
  "./studioModel"
], function (Control, StudioModel) {
  "use strict";

  var EXPAND = "comparisonLines,materialLines,findings";

  return Control.extend("assemblyimpact.caseworklist.ext.control.InvestigationStudio", {
    metadata: {
      properties: {
        caseId: { type: "string" },
        latestRunId: { type: "string" },
        assemblyCode: { type: "string" },
        fromRevision: { type: "string" },
        toRevision: { type: "string" }
      }
    },

    init: function () {
      this._state = { loading: false, error: null, view: null, selected: null, revision: "B", loadedRun: undefined };
    },

    setLatestRunId: function (value) {
      this.setProperty("latestRunId", value, true);
      this._scheduleLoad();
      return this;
    },
    setCaseId: function (value) {
      this.setProperty("caseId", value, true);
      this._scheduleLoad();
      return this;
    },

    _scheduleLoad: function () {
      clearTimeout(this._timer);
      this._timer = setTimeout(this._load.bind(this), 0);
    },

    _load: function () {
      var that = this, caseId = this.getCaseId(), runId = this.getLatestRunId(), model = this.getModel();
      if (!caseId || !model) { return; }
      if (!runId) { this._state = Object.assign(this._state, { loading: false, error: null, view: null, loadedRun: null }); this.invalidate(); return; }
      if (this._state.loadedRun === runId && this._state.view) { return; }
      this._state.loading = true; this._state.error = null; this.invalidate();
      var binding = model.bindContext("/ImpactRuns(" + runId + ")", null, { $expand: EXPAND, $$groupId: "$direct" });
      binding.requestObject().then(function (run) {
        that._state = Object.assign(that._state, { loading: false, view: StudioModel.build(run), loadedRun: runId });
        var items = that._state.view.items, changed = items.filter(function (i) { return i.change !== "unchanged"; });
        if (!that._state.selected || !items.some(function (i) { return i.itemNo === that._state.selected; })) {
          that._state.selected = (changed[0] || items[0] || {}).itemNo || null;
        }
        that.invalidate();
      }).catch(function (error) {
        that._state = Object.assign(that._state, { loading: false, error: (error && error.message) || "The impact run could not be loaded." });
        that.invalidate();
      }).finally(function () { binding.destroy(); });
    },

    // Event delegation: tiles and revision buttons carry data attributes.
    onclick: function (event) {
      var target = event.target.closest && event.target.closest("[data-ai-item],[data-ai-rev]");
      if (!target || !this.getDomRef().contains(target)) { return; }
      if (target.getAttribute("data-ai-item")) { this._state.selected = target.getAttribute("data-ai-item"); }
      if (target.getAttribute("data-ai-rev")) { this._state.revision = target.getAttribute("data-ai-rev"); }
      var focusId = target.id;
      this.invalidate();
      setTimeout(function () { var el = document.getElementById(focusId); if (el) { el.focus(); } }, 0);
    },

    renderer: {
      apiVersion: 2,
      render: function (rm, control) {
        var s = control._state, code = control.getAssemblyCode(), id = control.getId();
        rm.openStart("div", control).class("aiStudio").attr("role", "region").attr("aria-label", "Investigation Studio").openEnd();

        // Header: legend and revision switch
        rm.openStart("div").class("aiStudioHeader").openEnd();
        rm.openStart("div").class("aiStudioLegend").attr("aria-label", "Legend").openEnd();
        ["added", "removed", "replaced", "quantity-changed", "unchanged"].forEach(function (k) {
          var label = { "added": "Added", "removed": "Removed", "replaced": "Replaced", "quantity-changed": "Quantity changed", "unchanged": "Unchanged" }[k];
          rm.openStart("span").class("aiChip").class("aiChange-" + k).openEnd().text(label).close("span");
        });
        rm.openStart("span").class("aiChip").class("aiShortChip").openEnd().text("Stock short").close("span");
        rm.close("div");
        rm.openStart("div").class("aiRevSwitch").attr("role", "group").attr("aria-label", "Illustration revision").openEnd();
        [["A", "Current (" + (control.getFromRevision() || "A") + ")"], ["B", "Proposed (" + (control.getToRevision() || "B") + ")"]].forEach(function (r) {
          rm.openStart("button", id + "-rev-" + r[0]).class("aiRevBtn").attr("type", "button").attr("data-ai-rev", r[0]).attr("aria-pressed", String(s.revision === r[0]));
          if (s.revision === r[0]) { rm.class("aiRevBtnOn"); }
          rm.openEnd().text(r[1]).close("button");
        });
        rm.close("div");
        rm.close("div");

        if (s.loading) { rm.openStart("div").class("aiStudioMsg").attr("role", "status").openEnd().text("Loading the latest impact run…").close("div"); }
        else if (s.error) { rm.openStart("div").class("aiStudioMsg").class("aiStudioErr").attr("role", "alert").openEnd().text("Could not load the impact run: " + s.error).close("div"); }
        else if (!s.view) {
          rm.openStart("div").class("aiStudioMsg").attr("role", "status").openEnd()
            .text("No impact run yet. Use Run Impact to calculate the component changes, stock and cost for this case; the studio then shows every affected component.").close("div");
        }

        rm.openStart("div").class("aiStudioBody").openEnd();
        // Left: illustration + component map
        rm.openStart("div").class("aiStudioMain").openEnd();
        var src = StudioModel.illustration(code, s.revision);
        if (src) {
          rm.voidStart("img").class("aiStudioImg").attr("src", src)
            .attr("alt", "Synthetic illustration of " + code + ", revision " + (s.revision === "A" ? control.getFromRevision() : control.getToRevision()) + ". Not CAD.").voidEnd();
        } else {
          rm.openStart("div").class("aiStudioMsg").openEnd().text("No illustration for this revision; the component map below is generated from the BOM comparison.").close("div");
        }
        if (s.view) {
          var sum = s.view.summary;
          rm.openStart("div").class("aiKpis").openEnd();
          [["Run status", sum.status + (sum.flags ? " (" + sum.flags + ")" : "")], ["Cost delta", StudioModel.money(sum.costDeltaTotal) + " " + sum.currency],
            ["Changed items", String(sum.changed)], ["Materials short", String(sum.materialsShort)], ["Instruction findings", String(sum.instructionFindings)], ["As of", sum.asOfDate]
          ].forEach(function (k) {
            rm.openStart("div").class("aiKpi").openEnd();
            rm.openStart("span").class("aiKpiLabel").openEnd().text(k[0]).close("span");
            rm.openStart("span").class("aiKpiValue").openEnd().text(k[1]).close("span");
            rm.close("div");
          });
          rm.close("div");
          rm.openStart("div").class("aiTiles").attr("role", "list").attr("aria-label", "Components by BOM item").openEnd();
          s.view.items.forEach(function (item) {
            rm.openStart("div").attr("role", "listitem").openEnd();
            rm.openStart("button", id + "-item-" + item.itemNo).class("aiTile").class("aiChange-" + item.change).attr("type", "button")
              .attr("data-ai-item", item.itemNo).attr("aria-pressed", String(s.selected === item.itemNo))
              .attr("aria-label", "Item " + item.itemNo + ", " + item.title + ", " + item.changeLabel + (item.short ? ", stock short" : "") + (item.findings.length ? ", " + item.findings.length + " finding(s)" : ""));
            if (s.selected === item.itemNo) { rm.class("aiTileOn"); }
            rm.openEnd();
            rm.openStart("span").class("aiTileNo").openEnd().text(item.itemNo).close("span");
            rm.openStart("span").class("aiTileMat").openEnd().text(item.title).close("span");
            rm.openStart("span").class("aiTileChange").openEnd().text(item.changeLabel).close("span");
            if (item.short) { rm.openStart("span").class("aiBadge").class("aiBadgeShort").openEnd().text("short").close("span"); }
            if (item.findings.length) { rm.openStart("span").class("aiBadge").openEnd().text(item.findings.length + " finding" + (item.findings.length > 1 ? "s" : "")).close("span"); }
            rm.close("button");
            rm.close("div");
          });
          rm.close("div");
        }
        rm.close("div");

        // Right: details of the selected component
        if (s.view) {
          var sel = s.view.items.filter(function (i) { return i.itemNo === s.selected; })[0];
          rm.openStart("div").class("aiStudioDetail").attr("aria-live", "polite").openEnd();
          if (!sel) { rm.text("Select a component."); }
          else {
            rm.openStart("h3").class("aiDetailTitle").openEnd().text("Item " + sel.itemNo + " · " + sel.changeLabel).close("h3");
            rm.openStart("table").class("aiDetailTable").openEnd();
            rm.openStart("caption").class("aiDetailCaption").openEnd().text("Bill of material").close("caption");
            rm.openStart("tr").openEnd();
            ["", "Material", "Quantity", "Unit"].forEach(function (h) { rm.openStart("th").attr("scope", "col").openEnd().text(h).close("th"); });
            rm.close("tr");
            [["Current", sel.fromMaterial, sel.fromQuantity], ["Proposed", sel.toMaterial, sel.toQuantity]].forEach(function (r) {
              rm.openStart("tr").openEnd();
              rm.openStart("th").attr("scope", "row").openEnd().text(r[0]).close("th");
              rm.openStart("td").openEnd().text(r[1] || "–").close("td");
              rm.openStart("td").openEnd().text(r[1] ? StudioModel.num(r[2]) : "–").close("td");
              rm.openStart("td").openEnd().text(r[1] ? (sel.unit || "–") : "–").close("td");
              rm.close("tr");
            });
            rm.close("table");
            if (sel.stock) {
              var st = sel.stock;
              rm.openStart("table").class("aiDetailTable").openEnd();
              rm.openStart("caption").class("aiDetailCaption").openEnd().text("Stock and price · " + sel.toMaterial).close("caption");
              [["Required", StudioModel.num(st.required) + " " + st.unit], ["Available", StudioModel.num(st.available) + " " + st.unit],
                ["Gap", StudioModel.num(st.gap) + " " + st.unit], ["Stock status", st.status + (st.stale ? " (stale snapshot)" : "")],
                ["Unit price", st.unitPrice === null || st.unitPrice === undefined ? "not maintained" : StudioModel.money(st.unitPrice) + " EUR"]
              ].forEach(function (r) {
                rm.openStart("tr").openEnd();
                rm.openStart("th").attr("scope", "row").openEnd().text(r[0]).close("th");
                rm.openStart("td").openEnd();
                if (r[0] === "Stock status" && st.status === "SHORT") { rm.openStart("span").class("aiBadge").class("aiBadgeShort").openEnd().text(r[1]).close("span"); } else { rm.text(r[1]); }
                rm.close("td").close("tr");
              });
              rm.close("table");
            } else if (sel.change === "removed") {
              rm.openStart("p").class("aiNote").openEnd().text("Removed in the proposed revision: no stock is required any more.").close("p");
            }
            rm.openStart("h4").class("aiDetailSub").openEnd().text("Findings (" + sel.findings.length + ")").close("h4");
            if (!sel.findings.length) { rm.openStart("p").class("aiNote").openEnd().text("No findings for this component.").close("p"); }
            sel.findings.forEach(function (f) {
              rm.openStart("div").class("aiFinding").class("aiSev-" + String(f.severity || "").toLowerCase()).openEnd();
              rm.openStart("strong").openEnd().text(f.type + " · " + f.severity).close("strong");
              rm.openStart("div").openEnd().text(f.details || "").close("div");
              if (f.evidenceRefs) { rm.openStart("div").class("aiEvidence").openEnd().text("Evidence: " + f.evidenceRefs).close("div"); }
              rm.close("div");
            });
          }
          if (s.view.summary.generalFindings.length) {
            rm.openStart("h4").class("aiDetailSub").openEnd().text("Case-level findings").close("h4");
            s.view.summary.generalFindings.forEach(function (f) {
              rm.openStart("div").class("aiFinding").openEnd().text(f.type + ": " + (f.details || "")).close("div");
            });
          }
          rm.openStart("p").class("aiNote").openEnd().text("All figures come from the server-side impact calculation (synthetic data, not SAP S/4HANA).").close("p");
          rm.close("div");
        }
        rm.close("div");
        rm.close("div");
      }
    }
  });
});
