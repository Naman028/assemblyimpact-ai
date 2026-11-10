sap.ui.define([
  "sap/ui/core/mvc/Controller", "sap/ui/model/json/JSONModel", "sap/ui/model/Filter", "sap/ui/model/FilterOperator",
  "sap/m/MessageBox", "sap/m/MessageToast", "sap/m/Dialog", "sap/m/Button", "sap/m/TextArea", "sap/m/CheckBox", "sap/m/Label",
  "sap/m/MessageStrip", "sap/m/DatePicker", "sap/m/VBox", "sap/m/Text", "sap/f/library",
  "assemblyimpact/investigationstudio/lib/format", "assemblyimpact/investigationstudio/lib/schematic",
  "sap/ui/core/InvisibleMessage", "sap/ui/core/library", "sap/m/Select", "sap/m/Input", "sap/ui/core/Item"
], function (Controller, JSONModel, Filter, FilterOperator, MessageBox, MessageToast, Dialog, Button, TextArea, CheckBox, Label,
  MessageStrip, DatePicker, VBox, Text, fLibrary, format, schematic, InvisibleMessage, coreLibrary, Select, Input, Item) {
  "use strict";
  var InvisibleMessageMode = coreLibrary.InvisibleMessageMode;

  // Curated, hand-authored component diagrams (design/p4-visual-investigation). Other assemblies
  // get the generated schematic. Both are labelled synthetic and are not CAD.
  var CURATED = { "COOL-100": "assets/COOL-100.components.svg" };
  var CASE_EXPAND = "latestRun($expand=comparisonLines,materialLines,findings)," +
    "decisions($orderby=at desc;$expand=basedOnRun($select=ID,asOfDate,status))," +
    "runs($select=ID,computedAt,asOfDate,status,costDeltaTotal,currency,computedBy;$orderby=computedAt desc)," +
    "sourceImport,fromState($expand=items),toState($expand=items)," +
    "attachments($select=ID,fileName,description,mediaType,size,uploadedBy,uploadedAt;$orderby=uploadedAt desc)";
  var MAX_IMAGE_BYTES = 2 * 1024 * 1024;

  function empty() {
    return { busy: false, tab: "assembly", view: "B", selected: null, detail: null, case: {}, run: null, lines: [], allMaterials: [],
      materials: [], findings: [], decisions: [], runs: [], instructions: [], visualNote: "", explanation: null };
  }

  return Controller.extend("assemblyimpact.investigationstudio.controller.Workspace", {
    fmt: format,

    onInit: function () {
      this.getView().setModel(new JSONModel(empty()), "ws");
      this._svgCache = {};
      this.getOwnerComponent().getRouter().getRoute("workspace").attachPatternMatched(this._onMatched, this);
    },

    _onMatched: function (event) {
      var caseId = event.getParameter("arguments").caseId;
      if (caseId !== this._caseId) {
        this.getView().getModel("ws").setData(empty());
      }
      this._caseId = caseId;
      this._load();
    },

    /** Reads the case with its latest run and history in one request; instructions in a second one. */
    _load: function (keepSelection) {
      var ws = this.getView().getModel("ws"), model = this.getView().getModel(), that = this;
      // Each load gets a token; results of an earlier load (another case, or superseded) are discarded.
      var token = this._loadToken = (this._loadToken || 0) + 1;
      var current = function () { return token === that._loadToken; };
      if (this._binding) { this._binding.destroy(); }
      this._binding = model.bindContext("/ReviewCases(" + this._caseId + ")", null, { $expand: CASE_EXPAND });
      ws.setProperty("/busy", true);
      return this._binding.requestObject().then(function (data) {
        if (!current()) { return null; }
        if (!data) { throw new Error("not found"); }
        var run = data.latestRun || null;
        var lines = run ? run.comparisonLines.slice() : that._linesWithoutRun(data);
        lines.sort(function (a, b) { return a.itemNo < b.itemNo ? -1 : 1; });
        var materials = run ? run.materialLines.slice().sort(function (a, b) { return a.material < b.material ? -1 : 1; }) : [];
        ws.setProperty("/case", data);
        ws.setProperty("/run", run);
        // An explanation belongs to one run; drop it when the latest run changes.
        if (ws.getProperty("/explanation") && (!run || ws.getProperty("/explanation/runID") !== run.ID)) { ws.setProperty("/explanation", null); }
        ws.setProperty("/lines", lines);
        ws.setProperty("/allMaterials", materials);
        ws.setProperty("/materials", that.byId("shortOnly") && that.byId("shortOnly").getPressed() ? materials.filter(function (m) { return m.status === "SHORT"; }) : materials);
        ws.setProperty("/findings", run ? run.findings : []);
        ws.setProperty("/decisions", data.decisions || []);
        ws.setProperty("/runs", data.runs || []);
        return that._loadInstructions(data, current);
      }).then(function () {
        if (!current()) { return null; }
        var selected = keepSelection ? ws.getProperty("/selected") : null;
        if (!selected) {
          var first = ws.getProperty("/lines").filter(function (l) { return l.change && l.change !== "UNCHANGED"; })[0] || ws.getProperty("/lines")[0];
          selected = first ? first.itemNo : null;
        }
        that._select(selected);
        return that._renderVisual();
      }).catch(function (error) {
        if (!current() || error.canceled) { return; }
        ws.setProperty("/case", {});
        MessageBox.error(error.status === 404 || error.message === "not found"
          ? "This review case does not exist or is not in one of your plants." : (error.message || "The case could not be loaded."));
      }).finally(function () { if (current()) { ws.setProperty("/busy", false); } });
    },

    /** Before the first run: show the BOM items of both revisions without change states (none computed yet). */
    _linesWithoutRun: function (data) {
      var byItem = {};
      (data.fromState && data.fromState.items || []).forEach(function (i) { byItem[i.itemNo] = { itemNo: i.itemNo, fromMaterial: i.material, fromQuantity: i.quantity, unit: i.unit, change: null }; });
      (data.toState && data.toState.items || []).forEach(function (i) {
        var l = byItem[i.itemNo] || (byItem[i.itemNo] = { itemNo: i.itemNo, unit: i.unit, change: null });
        l.toMaterial = i.material; l.toQuantity = i.quantity;
      });
      return Object.keys(byItem).map(function (k) { return byItem[k]; });
    },

    _loadInstructions: function (data, current) {
      var ws = this.getView().getModel("ws"), model = this.getView().getModel();
      var list = model.bindList("/Instructions", null, null, [new Filter("assemblyCode", FilterOperator.EQ, data.assemblyCode), new Filter("plant", FilterOperator.EQ, data.plant)],
        { $expand: "references($orderby=step)", $orderby: "instructionId,version desc" });
      var outdated = {};
      (ws.getProperty("/findings") || []).filter(function (f) { return f.type === "OUTDATED_INSTRUCTION_REFERENCE"; }).forEach(function (f) {
        var key = this._outdatedKey(f.details);
        if (key) { outdated[key] = true; }
      }, this);
      var toRevision = data.toRevision;
      return list.requestContexts(0, 200).then(function (contexts) {
        if (!current()) { list.destroy(); return; }
        var instructions = contexts.map(function (c) {
          var i = c.getObject();
          var refs = (i.references || []).map(function (r) { return Object.assign({}, r, { instructionId: i.instructionId, version: i.version, outdated: !!outdated[i.instructionId + "/" + i.version + "/" + r.step] }); });
          return Object.assign({}, i, { references: refs, outdatedCount: refs.filter(function (r) { return r.outdated; }).length,
            applies: i.status === "RELEASED" && (!i.appliesToRevision || i.appliesToRevision === toRevision) });
        });
        ws.setProperty("/instructions", instructions);
        list.destroy();
      });
    },

    // ------------------------------------------------------------ selection and visual
    _select: function (itemNo) {
      var ws = this.getView().getModel("ws");
      ws.setProperty("/selected", itemNo);
      var line = (ws.getProperty("/lines") || []).filter(function (l) { return l.itemNo === itemNo; })[0];
      if (!line) { ws.setProperty("/detail", null); this._markSelection(); return; }
      var mats = [line.fromMaterial, line.toMaterial].filter(Boolean);
      var stock = (ws.getProperty("/allMaterials") || []).filter(function (m) { return m.material === line.toMaterial; })[0] || null;
      var findings = (ws.getProperty("/findings") || []).filter(function (f) { return mats.indexOf(f.material) >= 0 && (f.type !== "COST_CHANGE"); });
      var steps = [];
      (ws.getProperty("/instructions") || []).filter(function (i) { return i.applies; }).forEach(function (i) {
        i.references.forEach(function (r) { if (mats.indexOf(r.material) >= 0) { steps.push(r); } });
      });
      var evidence = [];
      findings.forEach(function (f) { String(f.evidenceRefs || "").split(" ").forEach(function (e) { if (e && evidence.indexOf(e) < 0) { evidence.push(e); } }); });
      if (stock && stock.stockEvidenceRef && evidence.indexOf(stock.stockEvidenceRef) < 0) { evidence.push(stock.stockEvidenceRef); }
      if (stock && stock.priceEvidenceRef && evidence.indexOf(stock.priceEvidenceRef) < 0) { evidence.push(stock.priceEvidenceRef); }
      ws.setProperty("/detail", {
        line: line, title: line.fromMaterial && line.toMaterial && line.fromMaterial !== line.toMaterial ? line.fromMaterial + " → " + line.toMaterial : (line.toMaterial || line.fromMaterial),
        fromQty: format.quantity(line.fromQuantity), toQty: format.quantity(line.toQuantity),
        stock: stock, findings: findings, steps: steps, evidence: evidence.length ? evidence.join(", ") : "—"
      });
      this._markSelection();
    },

    _renderVisual: function () {
      var ws = this.getView().getModel("ws"), data = ws.getProperty("/case"), html = this.byId("visual"), that = this;
      if (!data || !data.assemblyCode) { html.setContent("<div></div>"); return Promise.resolve(); }
      var lines = ws.getProperty("/lines"), view = ws.getProperty("/view");
      var curatedUrl = CURATED[data.assemblyCode];
      if (curatedUrl && (data.toRevision === "B")) {
        return this._fetchSvg(curatedUrl).then(function (svg) {
          ws.setProperty("/visualNote", "Hand-authored synthetic component diagram (not CAD). Revision shown: " + (view === "A" ? data.fromRevision : data.toRevision) + ".");
          html.setContent('<div class="aiVisual aiCurated" data-view="' + view + '">' + svg + "</div>");
          that._pendingStates = lines;
        });
      }
      ws.setProperty("/visualNote", "Generated component schematic from the BOM (synthetic, illustrative layout, not CAD).");
      html.setContent('<div class="aiVisual aiGenerated">' + schematic.build({ assemblyCode: data.assemblyCode, view: view, fromRevision: data.fromRevision,
        toRevision: data.toRevision, lines: lines, selected: ws.getProperty("/selected") }) + "</div>");
      this._pendingStates = null;
      return Promise.resolve();
    },

    _fetchSvg: function (url) {
      if (!this._svgCache[url]) {
        this._svgCache[url] = fetch(sap.ui.require.toUrl("assemblyimpact/investigationstudio/" + url)).then(function (r) {
          if (!r.ok) { throw new Error("Illustration could not be loaded."); }
          return r.text();
        });
      }
      return this._svgCache[url];
    },

    /** Parses "<instructionId> v<version> step <step> ..." from OUTDATED_INSTRUCTION_REFERENCE details (contract tested). */
    _outdatedKey: function (details) {
      var m = /^(\S+) v(\d+) step (\d+)/.exec(details || "");
      return m ? m[1] + "/" + m[2] + "/" + m[3] : null;
    },

    /** Wires click/keyboard on component groups and applies run states to the curated diagram. */
    onVisualRendered: function () {
      var dom = this.byId("visual").getDomRef(), that = this, ws = this.getView().getModel("ws");
      if (!dom) { return; }
      var root = dom.querySelector(".aiVisual") || dom;
      if (root.classList.contains("aiCurated")) {
        var view = root.getAttribute("data-view"), byItem = {};
        (ws.getProperty("/lines") || []).forEach(function (l) { byItem[l.itemNo] = l; });
        root.querySelectorAll(".ai-component").forEach(function (g) {
          var line = byItem[g.getAttribute("data-item-no")];
          var inRevision = view === "A" ? g.getAttribute("data-material-rev-a") : g.getAttribute("data-material-rev-b");
          g.classList.toggle("ai-absent", !inRevision);
          ["ADDED", "REMOVED", "REPLACED", "QUANTITY_CHANGED", "UNCHANGED", "NON_COMPARABLE"].forEach(function (s) { g.classList.remove(schematic.STATE_CLASS[s]); });
          var state = null;
          if (line && line.change) {
            var unitAdded = g.getAttribute("data-unit") && !g.getAttribute("data-material-rev-a");
            state = unitAdded ? "ADDED" : line.change;
            g.classList.add(schematic.STATE_CLASS[state]);
          }
          // State is announced in text, not only by the coloured halo (WCAG 1.4.1 / 4.1.2).
          var base = g.getAttribute("data-base-label") || g.getAttribute("aria-label") || "";
          g.setAttribute("data-base-label", base);
          g.setAttribute("aria-label", base + (state ? ", " + schematic.STATE_LABEL[state] : ""));
          var title = g.querySelector("title") || g.insertBefore(document.createElementNS("http://www.w3.org/2000/svg", "title"), g.firstChild);
          title.textContent = state ? schematic.STATE_LABEL[state].toUpperCase() : "";
        });
      }
      if (!root.__aiWired) {
        root.__aiWired = true;
        var activate = function (event) {
          var g = event.target.closest && event.target.closest(".ai-component");
          if (!g) { return; }
          if (event.type === "keydown" && event.key !== "Enter" && event.key !== " ") { return; }
          event.preventDefault();
          that._select(g.getAttribute("data-item-no"));
        };
        root.addEventListener("click", activate);
        root.addEventListener("keydown", activate);
      }
      this._markSelection();
    },

    _markSelection: function () {
      var dom = this.byId("visual") && this.byId("visual").getDomRef(), selected = this.getView().getModel("ws").getProperty("/selected");
      if (!dom) { return; }
      dom.querySelectorAll(".ai-component").forEach(function (g) {
        var on = g.getAttribute("data-item-no") === selected;
        g.classList.toggle("ai-selected", on);
        g.setAttribute("aria-pressed", String(on));
      });
    },

    onRevisionToggle: function () { this._renderVisual(); },

    onBomSelect: function (event) {
      var item = event.getParameter("listItem");
      this._select(item.getBindingContext("ws").getProperty("itemNo"));
      this.getView().getModel("ws").setProperty("/tab", "assembly");
    },

    onMaterialPress: function (event) { this._selectMaterial(event.getSource().getBindingContext("ws").getProperty("material")); },
    onFindingPress: function (event) { this._selectMaterial(event.getSource().getBindingContext("ws").getProperty("material")); },

    _selectMaterial: function (material) {
      if (!material) { return; }
      var line = this.getView().getModel("ws").getProperty("/lines").filter(function (l) { return l.toMaterial === material || l.fromMaterial === material; })[0];
      if (line) { this._select(line.itemNo); this.getView().getModel("ws").setProperty("/tab", "assembly"); }
    },

    onShortOnly: function (event) {
      var ws = this.getView().getModel("ws"), all = ws.getProperty("/allMaterials");
      ws.setProperty("/materials", event.getParameter("pressed") ? all.filter(function (m) { return m.status === "SHORT"; }) : all);
    },

    onToggleFullScreen: function () {
      var ui = this.getOwnerComponent().getModel("ui"), L = fLibrary.LayoutType;
      ui.setProperty("/layout", ui.getProperty("/layout") === L.MidColumnFullScreen ? L.TwoColumnsMidExpanded : L.MidColumnFullScreen);
    },

    onClose: function () { this.getOwnerComponent().getRouter().navTo("cases"); },

    /** P4 -> P3: the same case on the Fiori elements object page (keeps the case context across both apps). */
    onOpenInWorklist: function () {
      if (this._caseId) { window.open("../../launchpad.html#EngineeringCase-manage&/ReviewCases(" + encodeURIComponent(this._caseId) + ")", "_self"); }
    },

    // ------------------------------------------------------------ CAP actions (server decides; UI only collects input)
    _execute: function (action, params, successText) {
      var ws = this.getView().getModel("ws"), that = this;
      var operation = this.getView().getModel().bindContext("EngineeringReview." + action + "(...)", this._binding.getBoundContext());
      Object.keys(params).forEach(function (k) { if (params[k] !== undefined) { operation.setParameter(k, params[k]); } });
      ws.setProperty("/busy", true);
      return operation.execute().then(function () {
        MessageToast.show(successText);
        that._refreshList();
        return that._load(true);
      }).catch(function (error) {
        ws.setProperty("/busy", false);
        MessageBox.error(error.message || "The action failed.", { title: "Not saved" });
        return that._load(true);
      }).finally(function () { operation.destroy(); });
    },

    /** P2: GenAI explanation of the latest run (bound function explainImpact; validated on the server).
     *  A slow answer is discarded if the user has moved to another case, and triggers a reload if the
     *  server explained a newer run than the one on screen (review findings). */
    onExplain: function () {
      var ws = this.getView().getModel("ws"), that = this;
      var caseId = this._caseId, runId = ws.getProperty("/run/ID");
      var operation = this.getView().getModel().bindContext("EngineeringReview.explainImpact(...)", this._binding.getBoundContext());
      ws.setProperty("/busy", true);
      return operation.execute().then(function () {
        if (caseId !== that._caseId) { return; }
        var result = operation.getBoundContext().getObject();
        if (result.runID !== runId) {
          MessageToast.show("A newer impact run exists. The workspace was reloaded; request the explanation again.");
          return that._load(true);
        }
        ws.setProperty("/explanation", result);
        InvisibleMessage.getInstance().announce(result.status === "GROUNDED"
          ? "AI explanation generated." : "AI explanation withheld because it did not match the run evidence.", InvisibleMessageMode.Polite);
      }).catch(function (error) {
        if (caseId === that._caseId) { MessageBox.error(error.message || "The explanation is not available.", { title: "AI explanation" }); }
      }).finally(function () {
        operation.destroy();
        if (caseId === that._caseId) { ws.setProperty("/busy", false); that.byId("btnExplain").focus(); }
      });
    },

    // ------------------------------------------------------------ supporting images (faculty demo)
    attachmentUrl: function (id) { return id ? this.getView().getModel().getServiceUrl() + "CaseAttachments(" + id + ")/content" : ""; },

    _csrf: function () {
      var url = this.getView().getModel().getServiceUrl();
      return fetch(url, { method: "HEAD", headers: { "X-CSRF-Token": "Fetch" }, credentials: "same-origin" })
        .then(function (r) { return r.headers.get("X-CSRF-Token") || ""; });
    },

    _failure: function (response, fallback) {
      return response.json().then(function (body) { return (body && body.error && body.error.message) || fallback; }, function () { return fallback; })
        .then(function (message) { throw new Error(message); });
    },

    onAttachFileChange: function (event) {
      this._attachFile = event.getParameter("files") && event.getParameter("files")[0] || null;
    },

    /** Two steps, as CAP media entities expect: create the metadata, then PUT the binary (validated by the server). */
    onAttachUpload: function () {
      var file = this._attachFile, that = this, ws = this.getView().getModel("ws"), base = this.getView().getModel().getServiceUrl();
      var description = this.byId("attachDescription").getValue();
      if (!file) { MessageBox.warning("Choose a PNG or JPEG image first."); return; }
      if (!/^image\/(png|jpeg)$/.test(file.type)) { MessageBox.error("Only PNG and JPEG images are accepted."); return; }
      if (file.size > MAX_IMAGE_BYTES) { MessageBox.error("The image exceeds 2 MB."); return; }
      var token, createdId;
      ws.setProperty("/busy", true);
      this._csrf().then(function (t) {
        token = t;
        return fetch(base + "CaseAttachments", { method: "POST", credentials: "same-origin",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
          body: JSON.stringify({ reviewCase_ID: that._caseId, fileName: file.name, mediaType: file.type, description: description || null }) });
      }).then(function (r) {
        return r.ok ? r.json() : that._failure(r, "The attachment could not be created.");
      }).then(function (created) {
        createdId = created.ID;
        return fetch(base + "CaseAttachments(" + createdId + ")/content", { method: "PUT", credentials: "same-origin",
          headers: { "Content-Type": file.type, "X-CSRF-Token": token }, body: file });
      }).then(function (r) {
        if (r.ok) { return null; }
        // Do not leave metadata without an image behind.
        return that._failure(r, "The image was refused.").catch(function (error) {
          return fetch(base + "CaseAttachments(" + createdId + ")", { method: "DELETE", credentials: "same-origin", headers: { "X-CSRF-Token": token } })
            .then(function () { throw error; });
        });
      }).then(function () {
        MessageToast.show("Image attached as supporting evidence.");
        that.byId("attachFile").clear(); that.byId("attachDescription").setValue(""); that._attachFile = null;
        return that._load(true);
      }).catch(function (error) {
        ws.setProperty("/busy", false);
        MessageBox.error(error.message, { title: "Attachment not saved" });
      });
    },

    onAttachDelete: function (event) {
      var item = event.getSource().getBindingContext("ws").getObject(), that = this, base = this.getView().getModel().getServiceUrl();
      MessageBox.confirm("Remove the image " + item.fileName + "?", { onClose: function (action) {
        if (action !== MessageBox.Action.OK) { return; }
        that._csrf().then(function (token) {
          return fetch(base + "CaseAttachments(" + item.ID + ")", { method: "DELETE", credentials: "same-origin", headers: { "X-CSRF-Token": token } });
        }).then(function (r) { return r.ok ? that._load(true) : that._failure(r, "The image could not be removed."); })
          .catch(function (error) { MessageBox.error(error.message); });
      } });
    },

    // ------------------------------------------------------------ synthetic input edit (faculty demo, Scenario C)
    onEditInput: function () {
      var ws = this.getView().getModel("ws"), lines = ws.getProperty("/lines") || [];
      var proposed = lines.filter(function (l) { return l.toMaterial; });
      var materials = [];
      lines.forEach(function (l) { [l.fromMaterial, l.toMaterial].forEach(function (m) { if (m && materials.indexOf(m) < 0) { materials.push(m); } }); });
      // selectedKey set explicitly: before rendering, getSelectedKey() is "" and the first fill() would list materials
      // instead of revision B items (found in the BAS walkthrough: "SEAL-950 is not a valid String(4)").
      var kind = new Select({ width: "100%", selectedKey: "PROPOSED_QUANTITY", items: [
        new Item({ key: "PROPOSED_QUANTITY", text: "Proposed quantity of a revision B item" }),
        new Item({ key: "PRICE", text: "Unit price of a material" }),
        new Item({ key: "STOCK", text: "Available stock of a material (new snapshot)" })] });
      var target = new Select({ width: "100%" }), value = new Input({ type: "Number", width: "100%" });
      var fill = function () {
        target.destroyItems();
        if (kind.getSelectedKey() === "PROPOSED_QUANTITY") {
          proposed.forEach(function (l) { target.addItem(new Item({ key: l.itemNo, text: l.itemNo + " " + l.toMaterial + " (now " + l.toQuantity + " " + (l.unit || "") + ")" })); });
        } else {
          materials.forEach(function (m) { target.addItem(new Item({ key: m, text: m })); });
        }
      };
      kind.attachChange(fill); fill();
      this._dialog("Edit synthetic input", [
        new MessageStrip({ type: "Information", showIcon: true, text: "Demonstration data only (never SAP S/4HANA). Earlier impact runs stay unchanged; the case needs a new calculation before it can be submitted or approved. The change is recorded in the data provenance." }),
        new Label({ text: "What to change", labelFor: kind }).addStyleClass("sapUiSmallMarginTop"), kind,
        new Label({ text: "Item or material", labelFor: target }).addStyleClass("sapUiSmallMarginTop"), target,
        new Label({ text: "New value", labelFor: value, required: true }).addStyleClass("sapUiSmallMarginTop"), value
      ], "Save", "Emphasized", function () {
        if (!value.getValue() || !target.getSelectedKey()) { MessageBox.warning("Choose the item or material and enter a value."); return false; }
        var k = kind.getSelectedKey();
        this._execute("reviseDemoInput", { kind: k, itemNo: k === "PROPOSED_QUANTITY" ? target.getSelectedKey() : undefined,
          material: k === "PROPOSED_QUANTITY" ? undefined : target.getSelectedKey(), value: value.getValue() }, "Input changed. Run the impact calculation again.");
      }.bind(this));
    },

    /** Refreshes only the case list so status and figures match the server (the workspace reloads itself). */
    _refreshList: function () {
      this.getOwnerComponent().getEventBus().publish("studio", "casesChanged");
    },

    _dialog: function (title, content, buttonText, buttonType, onOk) {
      var dialog = new Dialog({ title: title, contentWidth: "32rem", content: new VBox({ items: content }).addStyleClass("sapUiSmallMargin"),
        beginButton: new Button({ text: buttonText, type: buttonType, press: function () { if (onOk() !== false) { dialog.close(); } } }),
        endButton: new Button({ text: "Cancel", press: function () { dialog.close(); } }),
        afterClose: function () { dialog.destroy(); } });
      this.getView().addDependent(dialog);
      dialog.open();
      return dialog;
    },

    onRunImpact: function () {
      var picker = new DatePicker({ valueFormat: "yyyy-MM-dd", displayFormat: "yyyy-MM-dd", placeholder: "Today", width: "100%" });
      this._dialog("Run impact calculation", [
        new Text({ text: "The CAP ruleset compares both revisions, checks stock and prices valid on the as-of date and validates work instructions. A new immutable run replaces the latest evidence; earlier runs stay in the history." }),
        new Label({ text: "As-of date (empty = today)", labelFor: picker }).addStyleClass("sapUiSmallMarginTop"), picker
      ], "Run", "Emphasized", function () {
        this._execute("runImpact", { asOfDate: picker.getValue() || undefined }, "Impact calculated.");
      }.bind(this));
    },

    onSubmit: function () {
      var comment = new TextArea({ width: "100%", rows: 3, maxLength: 1000, placeholder: "Optional comment for the reviewer" });
      var run = this.getView().getModel("ws").getProperty("/run");
      this._dialog("Submit for review", [
        new MessageStrip({ type: run ? "Information" : "Warning", showIcon: true, text: run ? "The reviewer will evaluate the latest impact run (as of " + run.asOfDate + ", " + format.runStatus(run.status) + ")." : "No impact run exists yet. The reviewer cannot approve without one." }),
        new Label({ text: "Comment", labelFor: comment }).addStyleClass("sapUiSmallMarginTop"), comment
      ], "Submit", "Emphasized", function () {
        this._execute("submitForReview", { comment: comment.getValue() || undefined }, "Submitted for review.");
      }.bind(this));
    },

    onApprove: function () {
      var run = this.getView().getModel("ws").getProperty("/run");
      if (!run) { MessageBox.warning("There is no impact run to approve. Run the impact calculation first."); return; }
      if (run.status === "INCOMPLETE") {
        MessageBox.error("The latest impact run is incomplete (" + format.flags(run.flags) + "). It cannot be approved. Resolve the missing inputs and run the impact calculation again, or reject the case.", { title: "Approval not possible" });
        return;
      }
      var comment = new TextArea({ width: "100%", rows: 3, maxLength: 1000, placeholder: "Optional comment" });
      var warn = run.status === "COMPLETE_WITH_WARNINGS";
      var ack = new CheckBox({ text: "I acknowledge the warnings of this impact run (" + format.flags(run.flags) + ")", wrapping: true, visible: warn });
      this._dialog("Approve case", [
        new MessageStrip({ type: warn ? "Warning" : "Success", showIcon: true, text: "Evaluated evidence: run as of " + run.asOfDate + ", computed " + format.dateTime(run.computedAt) +
          ", " + format.runStatus(run.status) + ". Cost delta " + format.money(run.costDeltaTotal, run.currency) + ", " + run.materialsShort + " material(s) short, " + run.instructionFindings + " instruction finding(s)." }),
        ack, new Label({ text: "Comment", labelFor: comment }).addStyleClass("sapUiSmallMarginTop"), comment
      ], "Approve", "Accept", function () {
        if (warn && !ack.getSelected()) { ack.setValueState("Error"); return false; }
        this._execute("approve", { basedOnRun: run.ID, acknowledgeWarnings: warn ? true : undefined, comment: comment.getValue() || undefined }, "Case approved.");
      }.bind(this));
    },

    onReject: function () {
      var run = this.getView().getModel("ws").getProperty("/run");
      var reason = new TextArea({ width: "100%", rows: 4, maxLength: 1000, placeholder: "Required: why is the change rejected?", required: true });
      this._dialog("Reject case", [
        new Label({ text: "Reason for rejection", labelFor: reason, required: true }), reason
      ], "Reject", "Reject", function () {
        if (!reason.getValue().trim()) { reason.setValueState("Error"); reason.setValueStateText("A reason is required."); return false; }
        this._execute("rejectCase", { comment: reason.getValue(), basedOnRun: run ? run.ID : undefined }, "Case rejected.");
      }.bind(this));
    }
  });
});
