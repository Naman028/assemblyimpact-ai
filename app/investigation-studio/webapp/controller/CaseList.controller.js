sap.ui.define([
  "sap/ui/core/mvc/Controller", "sap/ui/model/Filter", "sap/ui/model/FilterOperator", "sap/ui/model/json/JSONModel",
  "sap/ui/core/Fragment", "sap/m/MessageBox", "sap/m/MessageToast", "assemblyimpact/investigationstudio/lib/format"
], function (Controller, Filter, FilterOperator, JSONModel, Fragment, MessageBox, MessageToast, format) {
  "use strict";

  return Controller.extend("assemblyimpact.investigationstudio.controller.CaseList", {
    fmt: format,

    onInit: function () {
      var router = this.getOwnerComponent().getRouter();
      router.getRoute("workspace").attachPatternMatched(function (event) { this._selectedId = event.getParameter("arguments").caseId; this._syncSelection(); }, this);
      router.getRoute("cases").attachPatternMatched(function () { this._selectedId = null; this._syncSelection(); }, this);
      this.getOwnerComponent().getEventBus().subscribe("studio", "casesChanged", function () {
        this.byId("caseList").getBinding("items").refresh();
      }, this);
      this.getView().setModel(new JSONModel(this._emptyImport()), "import");
      this.getView().setModel(new JSONModel({ canImport: false }), "caps");
      this._loadCapabilities();
    },

    /** The import button is offered only to users the server allows to import (feature flag + role). */
    _loadCapabilities: function () {
      var fn = this.getView().getModel().bindContext("/myCapabilities()"), model = this.getView().getModel("caps");
      fn.requestObject().then(function (caps) { model.setProperty("/canImport", !!(caps && caps.canImport)); })
        .catch(function () { model.setProperty("/canImport", false); })
        .finally(function () { fn.destroy(); });
    },

    /** Highlights the open case (also after a deep link, once the items have arrived). */
    _syncSelection: function () {
      var id = this._selectedId, list = this.byId("caseList");
      list.getItems().forEach(function (item) { item.setSelected(!!id && item.getBindingContext().getProperty("ID") === id); });
    },

    onUpdateFinished: function () { this._syncSelection(); },

    /** itemPress (not selectionChange) so that the same case can be reopened after closing it. */
    onSelect: function (event) {
      var ctx = event.getParameter("listItem").getBindingContext();
      this.getOwnerComponent().getRouter().navTo("workspace", { caseId: ctx.getProperty("ID") });
    },

    onSearch: function () { this._applyFilters(); },
    onStatusFilter: function () { this._applyFilters(); },

    _applyFilters: function () {
      var query = (this.byId("caseSearch").getValue() || "").trim(), status = this.byId("statusFilter").getSelectedKey(), filters = [];
      if (query) {
        filters.push(new Filter({ filters: ["caseNumber", "title", "assemblyCode"].map(function (p) {
          return new Filter({ path: p, operator: FilterOperator.Contains, value1: query, caseSensitive: false });
        }), and: false }));
      }
      if (status === "DECIDED") {
        filters.push(new Filter({ filters: [new Filter("status", FilterOperator.EQ, "APPROVED"), new Filter("status", FilterOperator.EQ, "REJECTED")], and: false }));
      } else if (status !== "ALL") {
        filters.push(new Filter("status", FilterOperator.EQ, status));
      }
      this.byId("caseList").getBinding("items").filter(filters.length ? new Filter({ filters: filters, and: true }) : []);
    },

    onOpenWorklist: function () {
      window.open("../../case-worklist/webapp/index.html", "_self");
    },

    // ------------------------------------------------------------ import (M05)
    _emptyImport: function () {
      return { fileName: null, format: null, content: null, validated: false, accepted: false, errors: [], preview: [], summary: "" };
    },

    onOpenImport: function () {
      var view = this.getView();
      if (!this._importDialog) {
        this._importDialog = Fragment.load({ id: view.getId(), name: "assemblyimpact.investigationstudio.view.ImportDialog", controller: this })
          .then(function (dialog) { view.addDependent(dialog); return dialog; });
      }
      this._importDialog.then(function (dialog) { dialog.open(); });
    },

    onImportTypeMismatch: function () { MessageBox.error("Only .json and .csv files are supported."); },
    onImportTooLarge: function () { MessageBox.error("The file exceeds 512 KB."); },

    onImportFileChange: function (event) {
      var file = event.getParameter("files") && event.getParameter("files")[0], model = this.getView().getModel("import");
      model.setData(this._emptyImport());
      if (!file) { return; }
      var format = /\.csv$/i.test(file.name) ? "csv" : "json", reader = new FileReader(), that = this;
      reader.onload = function () {
        model.setData(Object.assign(that._emptyImport(), { fileName: file.name, format: format, content: String(reader.result) }));
        that._callImport(true);
      };
      reader.onerror = function () { MessageBox.error("The file could not be read."); };
      reader.readAsText(file);
    },

    /** Calls the unbound CAP action; dry run first (preview), commit after explicit confirmation. */
    _callImport: function (dryRun) {
      var model = this.getView().getModel("import"), data = model.getData(), dialog = this.byId("importDialog");
      var action = this.getView().getModel().bindContext("/importScenario(...)");
      action.setParameter("fileName", data.fileName).setParameter("format", data.format)
        .setParameter("content", data.content).setParameter("dryRun", dryRun);
      if (dialog) { dialog.setBusy(true); }
      return action.execute().then(function () {
        var result = action.getBoundContext().getObject();
        var counts = result.counts ? JSON.parse(result.counts) : {};
        if (!dryRun) { model.setProperty("/accepted", false); }
        model.setProperty("/validated", true);
        model.setProperty("/accepted", dryRun && result.accepted);
        model.setProperty("/errors", result.errors || []);
        model.setProperty("/preview", result.preview || []);
        model.setProperty("/summary", (counts.reviewCases || 0) + " case(s), " +
          Object.keys(counts).reduce(function (n, k) { return n + counts[k]; }, 0) + " records, plant " + (result.plant || "?"));
        if (!dryRun) {
          MessageToast.show("Imported " + (result.caseIds || []).length + " case(s). They are now in the worklist.");
          this.byId("caseList").getBinding("items").refresh();
          this.byId("importDialog").close();
        }
      }.bind(this)).catch(function (error) {
        MessageBox.error(error.message || "The import failed; nothing was saved.");
      }).finally(function () { if (dialog) { dialog.setBusy(false); } action.destroy(); });
    },

    onImportConfirm: function () {
      var data = this.getView().getModel("import").getData();
      MessageBox.confirm("Import " + data.summary + " from " + data.fileName + "? The server validates the file again and saves all records or none.", {
        title: "Confirm import",
        onClose: function (action) { if (action === MessageBox.Action.OK) { this._callImport(false); } }.bind(this)
      });
    },

    onImportCancel: function () { this.byId("importDialog").close(); },

    onImportClosed: function () {
      this.getView().getModel("import").setData(this._emptyImport());
      var uploader = this.byId("importFile");
      if (uploader) { uploader.clear(); }
    }
  });
});
