sap.ui.define([
  "sap/ui/core/mvc/Controller", "sap/ui/model/json/JSONModel", "assemblyimpact/home/lib/overview"
], function (Controller, JSONModel, overview) {
  "use strict";

  return Controller.extend("assemblyimpact.home.controller.Home", {
    ov: overview,

    onInit: function () {
      this.getView().setModel(new JSONModel({ busy: true, error: "", counts: {}, sources: [], recent: [], status: {}, caps: {} }), "home");
      this._load();
    },

    onRefresh: function () { this._load(); },

    /** Service root from the manifest (works in the launchpad, standalone and behind the app router). */
    _url: function (path) {
      return this.getOwnerComponent().getManifestEntry("/sap.app/dataSources/mainService/uri") + path;
    },

    _get: function (path, asText) {
      return fetch(this._url(path), { credentials: "same-origin", headers: { Accept: asText ? "text/plain" : "application/json" } })
        .then(function (r) {
          if (!r.ok) { throw new Error("HTTP " + r.status + " for " + path.split("?")[0]); }
          return asText ? r.text().then(Number) : r.json();
        });
    },

    /** All figures are live CAP queries (plant-restricted by the service). Nothing is hard-coded. */
    _load: function () {
      var model = this.getView().getModel("home"), that = this;
      var countKeys = Object.keys(overview.COUNTS), sourceKeys = overview.SOURCES.map(function (s) { return s.key; });
      model.setProperty("/busy", true);
      model.setProperty("/error", "");
      return Promise.all([
        Promise.all(countKeys.map(function (k) { return that._get(overview.countPath(overview.COUNTS[k]), true); })),
        Promise.all(sourceKeys.map(function (k) { return that._get(overview.sourcePath(k), true); })),
        this._get(overview.RECENT_PATH),
        this._get("systemStatus()"),
        this._get("myCapabilities()").catch(function () { return { canImport: false }; })
      ]).then(function (res) {
        var counts = {}, bySource = {};
        countKeys.forEach(function (k, i) { counts[k] = res[0][i]; });
        sourceKeys.forEach(function (k, i) { bySource[k] = res[1][i]; });
        model.setData({
          busy: false, error: "", counts: counts, sources: overview.sources(bySource),
          realRecords: bySource.S4_IMPORT || 0,
          recent: res[2].value || [],
          status: {
            dataSource: overview.dataSource(res[3].dataSourceMode), genai: overview.genai(res[3].genaiMode),
            joule: overview.joule(res[3].jouleStatus), auth: overview.auth(res[3].authMode), demoImport: !!res[3].demoImport
          },
          caps: { canImport: !!(res[4] && res[4].canImport) }
        });
      }).catch(function (error) {
        model.setProperty("/busy", false);
        model.setProperty("/error", "The overview could not be loaded (" + error.message + "). The apps below still work.");
      });
    },

    /** Launchpad navigation by intent; outside the launchpad (standalone preview) via the launchpad page. */
    _go: function (hash) {
      var Container = sap.ui.require("sap/ushell/Container");
      if (Container && Container.getServiceAsync) {
        Container.getServiceAsync("Navigation").then(function (nav) { return nav.navigate({ target: { shellHash: hash } }); })
          .catch(function () { window.location.hash = "#" + hash; });
      } else {
        window.location.href = "../../launchpad.html#" + hash;
      }
    },

    onOpenWorklist: function () { this._go(overview.hash.worklist()); },
    onOpenStudio: function () { this._go(overview.hash.studio()); },
    onOpenCreate: function () { this._go(overview.hash.create()); },
    onOpenStatus: function (event) { this._go(overview.hash.studioStatus(event.getSource().data("status"))); },
    onOpenCase: function (event) {
      var item = event.getParameter("listItem") || event.getSource();
      this._go(overview.hash.studioCase(item.getBindingContext("home").getProperty("ID")));
    }
  });
});
