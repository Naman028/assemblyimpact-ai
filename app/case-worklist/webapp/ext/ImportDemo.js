// M05: "Import Demo Data" action on the worklist toolbar. Validate -> preview -> explicit confirmation -> import.
// The server re-validates on import and writes all records or none; this dialog only shows its answers.
sap.ui.define([
  "sap/m/Dialog", "sap/m/Button", "sap/m/VBox", "sap/m/Text", "sap/m/MessageStrip", "sap/m/List", "sap/m/StandardListItem",
  "sap/m/Table", "sap/m/Column", "sap/m/ColumnListItem", "sap/m/Label", "sap/m/MessageToast", "sap/m/MessageBox",
  "sap/ui/unified/FileUploader"
], function (Dialog, Button, VBox, Text, MessageStrip, List, StandardListItem, Table, Column, ColumnListItem, Label, MessageToast, MessageBox, FileUploader) {
  "use strict";

  var MAX_BYTES = 64 * 1024;

  function call(model, name, params) {
    var op = model.bindContext("/" + name + "(...)", null, { $$groupId: "$direct" });
    Object.keys(params).forEach(function (k) { op.setParameter(k, params[k]); });
    return op.execute().then(function () { var r = op.getBoundContext().getObject(); op.destroy(); return r; },
      function (error) { op.destroy(); throw error; });
  }

  return {
    onImport: function () {
      var api = this, model = api.getModel(), file = { name: null, text: null }, validated = false;
      var status = new MessageStrip({ text: "Choose a JSON file in the AssemblyImpact demo-import format (synthetic data only, max 64 KB). Nothing is saved until you confirm.", type: "Information", showIcon: true });
      var errors = new List({ headerText: "Problems", visible: false });
      var preview = new Table({ headerText: "Preview", visible: false, columns: [
        new Column({ header: new Label({ text: "Record" }), width: "9rem" }), new Column({ header: new Label({ text: "Key" }), width: "12rem" }), new Column({ header: new Label({ text: "Details" }) })] });
      var importButton, dialog;
      var reset = function () { validated = false; importButton.setEnabled(false); errors.setVisible(false).removeAllItems(); preview.setVisible(false).removeAllItems(); };
      var show = function (result) {
        errors.removeAllItems(); preview.removeAllItems();
        (result.errors || []).forEach(function (e) { errors.addItem(new StandardListItem({ title: e.message, description: (e.path ? e.path + " · " : "") + e.code, highlight: "Error", wrapping: true })); });
        (result.records || []).forEach(function (r) { preview.addItem(new ColumnListItem({ cells: [new Text({ text: r.kind }), new Text({ text: r.recordKey }), new Text({ text: r.details })] })); });
        errors.setVisible(!!(result.errors || []).length); preview.setVisible(!!(result.records || []).length);
      };
      var uploader = new FileUploader({ width: "100%", fileType: ["json"], placeholder: "demo-import.json", sendXHR: false,
        change: function (event) {
          reset();
          var f = event.getParameter("files") && event.getParameter("files")[0];
          if (!f) { return; }
          if (f.size > MAX_BYTES) { status.setType("Error").setText("The file is larger than 64 KB."); return; }
          var reader = new FileReader();
          reader.onload = function () { file.name = f.name; file.text = String(reader.result); status.setType("Information").setText("File loaded: " + f.name + ". Select Validate."); };
          reader.readAsText(f);
        } });
      var validateButton = new Button({ text: "Validate", type: "Emphasized", press: function () {
        if (!file.text) { status.setType("Warning").setText("Choose a file first."); return; }
        dialog.setBusy(true);
        call(model, "validateDemoImport", { fileName: file.name, content: file.text }).then(function (result) {
          show(result);
          validated = result.ok;
          importButton.setEnabled(result.ok);
          status.setType(result.ok ? "Success" : "Error").setText(result.ok
            ? "Valid. Review the preview, then select Import to save case " + result.caseNumber + " in plant " + result.plant + "."
            : result.errors.length + " problem(s) found. Nothing was saved.");
        }).catch(function (error) {
          status.setType("Error").setText(error.status === 403 ? "You are not authorized to import demo data (role DemoDataManager)." : (error.message || "Validation failed."));
        }).finally(function () { dialog.setBusy(false); });
      } });
      importButton = new Button({ text: "Import", enabled: false, press: function () {
        if (!validated) { return; }
        dialog.setBusy(true);
        call(model, "commitDemoImport", { fileName: file.name, content: file.text, confirm: true }).then(function (result) {
          dialog.close();
          MessageToast.show("Imported synthetic case " + result.caseNumber + ".");
          api.refresh();
        }).catch(function (error) {
          status.setType("Error").setText("Import refused: " + (error.message || "unknown error") + " Nothing was saved.");
          importButton.setEnabled(false);
        }).finally(function () { dialog.setBusy(false); });
      } });
      dialog = new Dialog({ title: "Import Demo Data (synthetic)", contentWidth: "48rem", resizable: true, draggable: true,
        content: [new VBox({ items: [status, uploader, errors, preview] }).addStyleClass("sapUiSmallMargin")],
        buttons: [validateButton, importButton, new Button({ text: "Cancel", press: function () { dialog.close(); } })],
        afterClose: function () { dialog.destroy(); } });
      dialog.open();
    }
  };
});
