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
          if (!r.ok) { var e = new Error("HTTP " + r.status + " for " + path.split("?")[0]); e.status = r.status; throw e; }
          return asText ? r.text().then(Number) : r.json();
        });
    },

    /** All figures are live CAP queries (plant-restricted by the service). Nothing is hard-coded. */
    _load: function () {
      var model = this.getView().getModel("home"), that = this;
      var countKeys = Object.keys(overview.COUNTS), sourceKeys = overview.SOURCES.map(function (s) { return s.key; });
      model.setProperty("/busy", true);
      model.setProperty("/error", "");
      // One request first: without a valid sign-in it is the only one that can trigger the browser's login dialog.
      // Firing all queries at once made a cancelled dialog reappear once per request.
      return this._get("systemStatus()").then(function (status) {
        return Promise.all([
          Promise.all(countKeys.map(function (k) { return that._get(overview.countPath(overview.COUNTS[k]), true); })),
          Promise.all(sourceKeys.map(function (k) { return that._get(overview.sourcePath(k), true); })),
          that._get(overview.RECENT_PATH),
          status,
          that._get("myCapabilities()").catch(function () { return { canImport: false }; }),
          that._get("whoAmI()").catch(function () { return null; })
        ]);
      }).then(function (res) {
        var counts = {}, bySource = {};
        countKeys.forEach(function (k, i) { counts[k] = res[0][i]; });
        sourceKeys.forEach(function (k, i) { bySource[k] = res[1][i]; });
        model.setData({
          busy: false, error: "", counts: counts, sources: overview.sources(bySource),
          realRecords: bySource.S4_IMPORT || 0,
          recent: res[2].value || [],
          status: {
            dataSource: overview.dataSource(res[3].dataSourceMode), database: overview.database(res[3].databaseKind), genai: overview.genai(res[3].genaiMode),
            joule: overview.p1(res[3].genaiMode, res[3].jouleStatus), auth: overview.auth(res[3].authMode), demoImport: !!res[3].demoImport
          },
          caps: { canImport: !!(res[4] && res[4].canImport) },
          // Who is acting (server view). In development the user can be switched on /dev-users.html.
          me: res[5] ? { text: res[5].id + " · " + (res[5].roles || "no application role") + (res[5].plants ? " · plant " + res[5].plants : ""),
            dev: res[5].authMode === "DEVELOPMENT" } : { text: "", dev: false }
        });
      }).catch(function (error) {
        model.setProperty("/busy", false);
        model.setProperty("/error", overview.loadError(error));
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
