/* Investigation Studio: component schematic.
 * Builds an accessible, component-addressable SVG for any assembly from BOM comparison lines
 * (ImpactComparisonLines of the displayed run, or the BOM items when no run exists yet).
 * It is a generated schematic for orientation, NOT a drawing or CAD model: positions are a
 * layout grid, glyphs are generic by material family. Change states come only from the
 * server-side impact run; nothing is calculated here.
 * Plain function module: loaded by UI5 (sap.ui.define) and by Node tests (factory call). */
(function (factory) {
  "use strict";
  if (typeof sap !== "undefined" && sap.ui && sap.ui.define) {
    sap.ui.define([], factory);
  } else if (typeof globalThis !== "undefined") {
    globalThis.__aiSchematic = factory();
  }
})(function () {
  "use strict";

  var STATE_CLASS = {
    ADDED: "ai-state-added",
    REMOVED: "ai-state-removed",
    REPLACED: "ai-state-replaced",
    QUANTITY_CHANGED: "ai-state-quantity-changed",
    NON_COMPARABLE: "ai-state-non-comparable",
    UNCHANGED: "ai-state-unchanged"
  };
  var STATE_LABEL = {
    ADDED: "added", REMOVED: "removed", REPLACED: "replaced", QUANTITY_CHANGED: "qty changed",
    NON_COMPARABLE: "non-comparable unit", UNCHANGED: "unchanged"
  };

  function esc(value) {
    return String(value === null || value === undefined ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function qty(value) {
    if (value === null || value === undefined || value === "") { return ""; }
    var n = Number(value);
    return isFinite(n) ? String(Math.round(n * 1000) / 1000) : String(value);
  }

  /** Generic glyph family from the material code (illustrative only). */
  function family(material) {
    var m = String(material || "").toUpperCase();
    var rules = [
      [/^(FAN|IMP)/, "fan"], [/^(BRG|BEAR)/, "bearing"], [/^(BOLT|SCR|SCREW)/, "bolt"],
      [/^(SEAL|ORING|GSKT|GASK|DAMP)/, "seal"], [/^(PCB|BOARD|CTRL)/, "board"], [/^(MOTOR|MOT|STATOR|ROTOR)/, "motor"],
      [/^(SENS|PSENS)/, "sensor"], [/^(VALVE)/, "valve"], [/^(RELAY|CONN)/, "connector"],
      [/^(BRKT|SHIM|PLUG|FIT|STEM)/, "fitting"], [/^(BELT|PULLEY|GEAR)/, "drive"], [/^(HSG|ENCL|BODY|BLOCK|GUARD)/, "housing"],
      [/^(INS)/, "insulation"]
    ];
    for (var i = 0; i < rules.length; i++) { if (rules[i][0].test(m)) { return rules[i][1]; } }
    return "part";
  }

  /** SVG glyph centred at (cx, cy), roughly 44 x 44. */
  function glyph(kind, cx, cy) {
    var s = 'stroke="#32363a" stroke-width="1.5"';
    switch (kind) {
      case "fan": return '<circle cx="' + cx + '" cy="' + cy + '" r="20" fill="#dfe6ee" ' + s + '/>' +
        [0, 90, 180, 270].map(function (a) {
          return '<ellipse cx="' + cx + '" cy="' + (cy - 10) + '" rx="5" ry="10" fill="#9fb2c6" ' + s + ' transform="rotate(' + a + ' ' + cx + ' ' + cy + ')"/>';
        }).join("") + '<circle cx="' + cx + '" cy="' + cy + '" r="4" fill="#32363a"/>';
      case "bearing": return '<circle cx="' + cx + '" cy="' + cy + '" r="20" fill="#e6e9ec" ' + s + '/><circle cx="' + cx + '" cy="' + cy + '" r="10" fill="#fff" ' + s + '/>' +
        [0, 60, 120, 180, 240, 300].map(function (a) {
          var r = a * Math.PI / 180;
          return '<circle cx="' + (cx + 15 * Math.cos(r)).toFixed(1) + '" cy="' + (cy + 15 * Math.sin(r)).toFixed(1) + '" r="3" fill="#7a8a99"/>';
        }).join("");
      case "bolt": return '<polygon points="' + [[-9, -18], [9, -18], [14, -10], [-14, -10]].map(function (p) { return (cx + p[0]) + "," + (cy + p[1]); }).join(" ") + '" fill="#9fb2c6" ' + s + '/>' +
        '<rect x="' + (cx - 5) + '" y="' + (cy - 10) + '" width="10" height="28" fill="#c9d3dd" ' + s + '/>' +
        [-4, 2, 8, 14].map(function (d) { return '<line x1="' + (cx - 5) + '" y1="' + (cy + d) + '" x2="' + (cx + 5) + '" y2="' + (cy + d + 3) + '" stroke="#32363a"/>'; }).join("");
      case "seal": return '<circle cx="' + cx + '" cy="' + cy + '" r="19" fill="none" stroke="#32363a" stroke-width="7"/><circle cx="' + cx + '" cy="' + cy + '" r="19" fill="none" stroke="#5b738b" stroke-width="4"/>';
      case "board": return '<rect x="' + (cx - 22) + '" y="' + (cy - 15) + '" width="44" height="30" rx="2" fill="#4f8a5b" ' + s + '/>' +
        '<rect x="' + (cx - 14) + '" y="' + (cy - 8) + '" width="12" height="12" fill="#26323d"/><rect x="' + (cx + 4) + '" y="' + (cy - 8) + '" width="10" height="7" fill="#26323d"/>' +
        '<line x1="' + (cx - 18) + '" y1="' + (cy + 10) + '" x2="' + (cx + 18) + '" y2="' + (cy + 10) + '" stroke="#d6c36a" stroke-width="2"/>';
      case "motor": return '<rect x="' + (cx - 20) + '" y="' + (cy - 15) + '" width="34" height="30" rx="5" fill="#b8c4cf" ' + s + '/>' +
        [-9, -3, 3, 9].map(function (d) { return '<line x1="' + (cx - 16) + '" y1="' + (cy + d) + '" x2="' + (cx + 10) + '" y2="' + (cy + d) + '" stroke="#7a8a99"/>'; }).join("") +
        '<rect x="' + (cx + 14) + '" y="' + (cy - 3) + '" width="9" height="6" fill="#7a8a99" ' + s + '/>';
      case "sensor": return '<rect x="' + (cx - 8) + '" y="' + (cy - 20) + '" width="16" height="26" rx="3" fill="#e8c35c" ' + s + '/>' +
        '<rect x="' + (cx - 3) + '" y="' + (cy + 6) + '" width="6" height="14" fill="#9fb2c6" ' + s + '/>';
      case "valve": return '<polygon points="' + (cx - 20) + ',' + (cy - 12) + ' ' + cx + ',' + cy + ' ' + (cx - 20) + ',' + (cy + 12) + '" fill="#9fb2c6" ' + s + '/>' +
        '<polygon points="' + (cx + 20) + ',' + (cy - 12) + ' ' + cx + ',' + cy + ' ' + (cx + 20) + ',' + (cy + 12) + '" fill="#9fb2c6" ' + s + '/>' +
        '<line x1="' + cx + '" y1="' + cy + '" x2="' + cx + '" y2="' + (cy - 20) + '" stroke="#32363a" stroke-width="2"/><rect x="' + (cx - 8) + '" y="' + (cy - 24) + '" width="16" height="5" fill="#32363a"/>';
      case "connector": return '<rect x="' + (cx - 20) + '" y="' + (cy - 10) + '" width="40" height="20" rx="2" fill="#d8dee4" ' + s + '/>' +
        [-14, -7, 0, 7, 14].map(function (d) { return '<rect x="' + (cx + d - 2) + '" y="' + (cy - 5) + '" width="4" height="10" fill="#c9a227"/>'; }).join("");
      case "fitting": return '<rect x="' + (cx - 20) + '" y="' + (cy - 6) + '" width="40" height="12" rx="2" fill="#c9d3dd" ' + s + '/>' +
        '<circle cx="' + (cx - 12) + '" cy="' + cy + '" r="3" fill="#fff" ' + s + '/><circle cx="' + (cx + 12) + '" cy="' + cy + '" r="3" fill="#fff" ' + s + '/>';
      case "drive": return '<circle cx="' + (cx - 10) + '" cy="' + cy + '" r="10" fill="#c9d3dd" ' + s + '/><circle cx="' + (cx + 12) + '" cy="' + cy + '" r="7" fill="#c9d3dd" ' + s + '/>' +
        '<path d="M' + (cx - 10) + ' ' + (cy - 10) + ' L' + (cx + 12) + ' ' + (cy - 7) + ' M' + (cx - 10) + ' ' + (cy + 10) + ' L' + (cx + 12) + ' ' + (cy + 7) + '" stroke="#32363a" stroke-width="2"/>';
      case "housing": return '<rect x="' + (cx - 22) + '" y="' + (cy - 17) + '" width="44" height="34" rx="6" fill="#e3e8ee" ' + s + '/>' +
        '<rect x="' + (cx - 15) + '" y="' + (cy - 10) + '" width="30" height="20" rx="3" fill="none" stroke="#7a8a99"/>';
      case "insulation": return '<rect x="' + (cx - 20) + '" y="' + (cy - 14) + '" width="40" height="28" rx="4" fill="#f1d9a7" ' + s + '/>' +
        [-8, 0, 8].map(function (d) { return '<path d="M' + (cx - 16) + ' ' + (cy + d) + ' q8 -5 16 0 t16 0" fill="none" stroke="#a07a2c"/>'; }).join("");
      default: return '<rect x="' + (cx - 18) + '" y="' + (cy - 14) + '" width="36" height="28" rx="4" fill="#dfe3e8" ' + s + '/>';
    }
  }

  /**
   * @param {object} o
   * @param {string} o.assemblyCode
   * @param {"A"|"B"} o.view   which revision is drawn ("A" = current, "B" = proposed)
   * @param {string} o.fromRevision, o.toRevision  revision labels
   * @param {Array} o.lines   [{itemNo, change|null, fromMaterial, fromQuantity, toMaterial, toQuantity, unit}]
   * @param {string} [o.selected] itemNo
   * @returns {string} SVG markup
   */
  function build(o) {
    var lines = (o.lines || []).slice().sort(function (a, b) { return a.itemNo < b.itemNo ? -1 : a.itemNo > b.itemNo ? 1 : 0; });
    var proposed = o.view !== "A";
    var cols = lines.length <= 4 ? 2 : 3;
    var tileW = 210, tileH = 118, gap = 18, padX = 34, padTop = 64;
    var rows = Math.max(1, Math.ceil(lines.length / cols));
    var width = padX * 2 + cols * tileW + (cols - 1) * gap;
    var height = padTop + rows * tileH + (rows - 1) * gap + 56;
    var revision = proposed ? (o.toRevision || "B") : (o.fromRevision || "A");
    var title = o.assemblyCode + " revision " + revision + " component schematic (generated from the BOM, synthetic, not CAD)";
    var out = [];
    out.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + width + " " + height + '" width="100%" role="group" aria-labelledby="ai-sch-t" font-family="72, Arial, Helvetica, sans-serif" class="aiSchematic">');
    out.push('<title id="ai-sch-t">' + esc(title) + "</title>");
    out.push('<rect x="0" y="0" width="' + width + '" height="' + height + '" fill="#ffffff"/>');
    out.push('<rect x="12" y="40" width="' + (width - 24) + '" height="' + (height - 74) + '" rx="16" fill="#f5f7f9" stroke="#8396a8" stroke-width="1.5" stroke-dasharray="2 4"/>');
    out.push('<text x="16" y="26" font-size="15" font-weight="bold" fill="#1d2d3e">' + esc(o.assemblyCode) + " — Revision " + esc(revision) + "</text>");
    out.push('<text x="' + (width - 16) + '" y="26" font-size="11" text-anchor="end" fill="#556b82">' + (proposed ? "Proposed" : "Current") + " configuration</text>");
    lines.forEach(function (line, index) {
      var col = index % cols, row = Math.floor(index / cols);
      var x = padX + col * (tileW + gap), y = padTop + row * (tileH + gap);
      var present = proposed ? !!line.toMaterial : !!line.fromMaterial;
      var material = proposed ? (line.toMaterial || line.fromMaterial) : (line.fromMaterial || line.toMaterial);
      var quantity = proposed ? line.toQuantity : line.fromQuantity;
      var state = line.change || null;
      var cls = "ai-component" + (state ? " " + STATE_CLASS[state] : "") + (present ? "" : " ai-absent") + (o.selected === line.itemNo ? " ai-selected" : "");
      var label = "Item " + line.itemNo + ", " + (material || "") + (quantity ? ", quantity " + qty(quantity) + " " + (line.unit || "") : "") +
        (present ? "" : proposed ? ", not in the proposed revision" : ", not in the current revision") + (state ? ", " + STATE_LABEL[state] : "");
      out.push('<g class="' + cls + '" data-item-no="' + esc(line.itemNo) + '" data-material="' + esc(material) + '" tabindex="0" role="button" aria-pressed="' +
        (o.selected === line.itemNo) + '" aria-label="' + esc(label) + '">');
      out.push('<rect class="ai-tile" x="' + x + '" y="' + y + '" width="' + tileW + '" height="' + tileH + '" rx="10" fill="#ffffff" stroke="#a9b4be" stroke-width="1.5"/>');
      out.push('<text x="' + (x + 14) + '" y="' + (y + 22) + '" font-size="11" fill="#556b82">Item ' + esc(line.itemNo) + "</text>");
      if (state && state !== "UNCHANGED") {
        var badge = STATE_LABEL[state].toUpperCase(), bw = Math.round(badge.length * 6.6 + 16);
        out.push('<rect x="' + (x + tileW - bw - 8) + '" y="' + (y + 9) + '" width="' + bw + '" height="18" rx="9" class="ai-badge"/>');
        out.push('<text x="' + (x + tileW - 8 - bw / 2) + '" y="' + (y + 22) + '" font-size="10" text-anchor="middle" class="ai-badge-text">' + esc(badge) + "</text>");
      }
      out.push(glyph(family(material), x + 40, y + 70));
      out.push('<text x="' + (x + 76) + '" y="' + (y + 58) + '" font-size="14" font-weight="bold" fill="#1d2d3e">' + esc(material) + "</text>");
      if (state === "REPLACED") {
        out.push('<text x="' + (x + 76) + '" y="' + (y + 76) + '" font-size="11" fill="#aa0808">' + esc(proposed ? "was " + line.fromMaterial : "becomes " + line.toMaterial) + "</text>");
      }
      if (present && quantity) {
        var qtyText = "\u00d7 " + qty(quantity) + " " + esc(line.unit || "");
        if (state === "QUANTITY_CHANGED") { qtyText += proposed ? " (was " + qty(line.fromQuantity) + ")" : " (becomes " + qty(line.toQuantity) + ")"; }
        out.push('<text x="' + (x + 76) + '" y="' + (y + 98) + '" font-size="12" fill="#32363a">' + qtyText + "</text>");
      } else if (!present) {
        out.push('<text x="' + (x + 76) + '" y="' + (y + 98) + '" font-size="12" fill="#556b82">' + (proposed ? "removed" : "added in " + esc(o.toRevision || "B")) + "</text>");
      }
      out.push("</g>");
    });
    out.push('<text x="' + (width / 2) + '" y="' + (height - 12) + '" font-size="10.5" text-anchor="middle" fill="#556b82">SYNTHETIC — generated component schematic for orientation; positions and glyphs are illustrative, not CAD</text>');
    out.push("</svg>");
    return out.join("");
  }

  return { build: build, family: family, STATE_CLASS: STATE_CLASS, STATE_LABEL: STATE_LABEL };
});
