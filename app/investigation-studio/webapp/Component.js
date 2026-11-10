sap.ui.define(["sap/ui/core/UIComponent", "sap/ui/model/json/JSONModel", "sap/f/library"], function (UIComponent, JSONModel, fLibrary) {
  "use strict";
  return UIComponent.extend("assemblyimpact.investigationstudio.Component", {
    metadata: { manifest: "json", interfaces: ["sap.ui.core.IAsyncContentCreation"] },
    init: function () {
      UIComponent.prototype.init.apply(this, arguments);
      // UI state only (layout, selection); business data stays in the OData V4 model.
      this.setModel(new JSONModel({ layout: fLibrary.LayoutType.OneColumn }), "ui");
      this.getRouter().attachBeforeRouteMatched(function (event) {
        // Master and detail side by side only when the layout itself is wide enough (its own width, not the
        // window: inside the launchpad the app can be narrower than the browser). Otherwise the case uses the full width.
        var root = this.getRootControl(), fcl = root && root.byId("fcl"), dom = fcl && fcl.getDomRef();
        var wide = (dom ? dom.offsetWidth : window.innerWidth) >= 1200;
        this.getModel("ui").setProperty("/layout", event.getParameter("name") === "workspace"
          ? (wide ? fLibrary.LayoutType.TwoColumnsMidExpanded : fLibrary.LayoutType.MidColumnFullScreen)
          : fLibrary.LayoutType.OneColumn);
      }, this);
      this.getRouter().initialize();
    }
  });
});
