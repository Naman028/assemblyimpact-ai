sap.ui.define(["sap/ui/core/UIComponent", "sap/ui/model/json/JSONModel", "sap/f/library"], function (UIComponent, JSONModel, fLibrary) {
  "use strict";
  return UIComponent.extend("assemblyimpact.investigationstudio.Component", {
    metadata: { manifest: "json", interfaces: ["sap.ui.core.IAsyncContentCreation"] },
    init: function () {
      UIComponent.prototype.init.apply(this, arguments);
      // UI state only (layout, selection); business data stays in the OData V4 model.
      this.setModel(new JSONModel({ layout: fLibrary.LayoutType.OneColumn }), "ui");
      this.getRouter().attachBeforeRouteMatched(function (event) {
        var wide = window.matchMedia && window.matchMedia("(min-width: 1500px)").matches;
        this.getModel("ui").setProperty("/layout", event.getParameter("name") === "workspace"
          ? (wide ? fLibrary.LayoutType.TwoColumnsMidExpanded : fLibrary.LayoutType.MidColumnFullScreen)
          : fLibrary.LayoutType.OneColumn);
      }, this);
      this.getRouter().initialize();
    }
  });
});
