// Original vector illustrations for the six M05 synthetic assemblies (revision A = current, B = proposed).
// Usage: node design/assets-src/m05/build-assembly-svgs.mjs [--check]
// Every component region is a <g id="ai-item-<itemNo>"> keyed to the BOM item number of that revision,
// with a change-state class computed from A vs B (added / removed / replaced / quantity-changed / unchanged).
// Schematic orientation drawings only: labelled SYNTHETIC, not CAD or engineering documentation.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { SCENARIOS } from '../../../tools/m05/scenarios.mjs';

const OUT = join(import.meta.dirname, '..', '..', '..', 'app', 'case-worklist', 'webapp', 'assets', 'assemblies');
const FONT = 'font-family="Arial, Helvetica, sans-serif"';
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Component glyph by material family (prefix). Pure geometry, no external references.
const GLYPHS = {
  BRG: (x, y) => `<circle cx="${x + 40}" cy="${y + 32}" r="26" class="body"/><circle cx="${x + 40}" cy="${y + 32}" r="11" class="cut"/>`,
  SEAL: (x, y) => `<circle cx="${x + 40}" cy="${y + 32}" r="24" class="body"/><circle cx="${x + 40}" cy="${y + 32}" r="17" class="cut"/>`,
  ORING: (x, y) => `<circle cx="${x + 40}" cy="${y + 32}" r="22" class="ring"/>`,
  SCR: (x, y) => `<rect x="${x + 30}" y="${y + 8}" width="20" height="10" rx="2" class="body"/><rect x="${x + 36}" y="${y + 18}" width="8" height="38" class="body"/>`,
  BOLT: (x, y) => `<polygon points="${x + 28},${y + 8} ${x + 52},${y + 8} ${x + 56},${y + 18} ${x + 24},${y + 18}" class="body"/><rect x="${x + 35}" y="${y + 18}" width="10" height="40" class="body"/>`,
  SHIM: (x, y) => `<rect x="${x + 12}" y="${y + 26}" width="56" height="6" rx="3" class="body"/>`,
  PLATE: (x, y) => `<rect x="${x + 8}" y="${y + 14}" width="64" height="36" rx="3" class="body"/><circle cx="${x + 18}" cy="${y + 24}" r="3" class="cut"/><circle cx="${x + 62}" cy="${y + 40}" r="3" class="cut"/>`,
  PCB: (x, y) => `<rect x="${x + 6}" y="${y + 10}" width="68" height="44" rx="3" class="board"/><path d="M${x + 14} ${y + 22}h20v10h16" class="trace"/>`,
  CAP: (x, y) => `<rect x="${x + 28}" y="${y + 10}" width="24" height="38" rx="10" class="body"/><line x1="${x + 34}" y1="${y + 48}" x2="${x + 34}" y2="${y + 58}" class="lead"/><line x1="${x + 46}" y1="${y + 48}" x2="${x + 46}" y2="${y + 58}" class="lead"/>`,
  CONN: (x, y) => `<rect x="${x + 10}" y="${y + 18}" width="60" height="26" rx="2" class="body"/>${[0, 1, 2, 3, 4, 5].map(i => `<rect x="${x + 15 + i * 9}" y="${y + 24}" width="5" height="14" class="cut"/>`).join('')}`,
  MCU: (x, y) => `<rect x="${x + 18}" y="${y + 12}" width="44" height="40" rx="2" class="chip"/>${[0, 1, 2, 3].map(i => `<line x1="${x + 24 + i * 10}" y1="${y + 6}" x2="${x + 24 + i * 10}" y2="${y + 12}" class="lead"/>`).join('')}`,
  COMP: (x, y) => `<rect x="${x + 14}" y="${y + 8}" width="52" height="50" rx="22" class="body"/><rect x="${x + 26}" y="${y + 18}" width="28" height="10" rx="3" class="cut"/>`,
  COIL: (x, y) => `<rect x="${x + 6}" y="${y + 10}" width="68" height="44" rx="4" class="body"/>${[0, 1, 2, 3, 4, 5].map(i => `<line x1="${x + 14 + i * 11}" y1="${y + 14}" x2="${x + 14 + i * 11}" y2="${y + 50}" class="fin"/>`).join('')}`,
  MOT: (x, y) => `<rect x="${x + 8}" y="${y + 14}" width="48" height="36" rx="6" class="body"/><rect x="${x + 56}" y="${y + 26}" width="16" height="12" class="cut"/>`,
  ENC: (x, y) => `<circle cx="${x + 40}" cy="${y + 32}" r="22" class="body"/>${[0, 1, 2, 3, 4, 5, 6, 7].map(i => { const a = i * Math.PI / 4; return `<line x1="${(x + 40 + 12 * Math.cos(a)).toFixed(1)}" y1="${(y + 32 + 12 * Math.sin(a)).toFixed(1)}" x2="${(x + 40 + 20 * Math.cos(a)).toFixed(1)}" y2="${(y + 32 + 20 * Math.sin(a)).toFixed(1)}" class="lead"/>`; }).join('')}`,
  DEFAULT: (x, y) => `<rect x="${x + 10}" y="${y + 10}" width="60" height="44" rx="6" class="body"/>`,
};
const glyphFor = material => {
  const key = Object.keys(GLYPHS).find(p => material.startsWith(p) && p !== 'DEFAULT');
  return GLYPHS[key ?? (/^(HSG|BLK|BEAM|FRAME)/.test(material) ? 'PLATE' : /^(SPOOL|PLUG|FOOT|CPL|CTRL)/.test(material) ? 'DEFAULT' : 'DEFAULT')];
};

/** Change state of every item number between revision A and B (same rules as the BOM comparison). */
export function changeStates(s) {
  const a = new Map(s.a.map(([no, m, q]) => [no, { m, q }])), b = new Map(s.b.map(([no, m, q]) => [no, { m, q }]));
  const states = {};
  for (const no of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(no), y = b.get(no);
    states[no] = !x ? 'added' : !y ? 'removed' : x.m !== y.m ? 'replaced' : x.q !== y.q ? 'quantity-changed' : 'unchanged';
  }
  return states;
}

export function svgFor(s, rev, { thumb = false } = {}) {
  const items = rev === 'A' ? s.a : s.b;
  const states = changeStates(s);
  const desc = m => s.materials.find(x => x[0] === m)[1];
  const cols = Math.min(items.length, 3), rows = Math.ceil(items.length / cols);
  const W = 120 + cols * 170, H = 150 + rows * 120;
  const title = `${s.assemblyCode} revision ${rev} (${rev === 'A' ? 'current' : 'proposed'}): ${s.description}. Synthetic illustration`;
  const tiles = items.map(([no, m, q], i) => {
    const x = 60 + (i % cols) * 170, y = 92 + Math.floor(i / cols) * 120;
    const state = rev === 'A' && states[no] === 'added' ? 'unchanged' : states[no];
    const shown = rev === 'A' && ['replaced', 'removed', 'quantity-changed'].includes(states[no]) ? `${states[no]}-from` : state;
    return thumb
      ? `<g class="ai-state-${shown}"><rect x="${x}" y="${y}" width="150" height="100" rx="10" class="tile"/>${glyphFor(m)(x + 35, y + 18)}</g>`
      : `<g id="ai-item-${no}" class="ai-component ai-state-${shown}" data-item-no="${no}" data-material="${esc(m)}" data-quantity="${q}" tabindex="0" role="button" aria-label="Item ${no}: ${esc(m)} ${esc(desc(m))}, quantity ${q}, ${shown.replace(/-/g, ' ')}">`
        + `<rect x="${x}" y="${y}" width="150" height="104" rx="10" class="tile"/>${glyphFor(m)(x + 35, y + 6)}`
        + `<text x="${x + 10}" y="${y + 82}" class="lbl" ${FONT}>${no} ${esc(m)}</text><text x="${x + 10}" y="${y + 97}" class="sub" ${FONT}>x${q} ${esc(desc(m).length > 22 ? desc(m).slice(0, 21) + '…' : desc(m))}</text></g>`;
  }).join('');
  const style = `<style>.frame{fill:#f6f8fb;stroke:#8396a8;stroke-width:2}.tile{fill:#fff;stroke:#5b738b;stroke-width:1.5}.body{fill:#c9d4de;stroke:#32475b;stroke-width:1.5}.cut{fill:#f6f8fb;stroke:#32475b}.ring{fill:none;stroke:#32475b;stroke-width:6}.board{fill:#cfe3cf;stroke:#2f5d34;stroke-width:1.5}.chip{fill:#3b4652}.trace{fill:none;stroke:#2f5d34;stroke-width:2}.lead,.fin{stroke:#32475b;stroke-width:2}`
    + `.ai-state-added .tile{fill:#e8f6ec;stroke:#1e7a3c;stroke-width:3}.ai-state-replaced .tile{fill:#eaf1fb;stroke:#0a6ed1;stroke-width:3}.ai-state-quantity-changed .tile{fill:#fff6e5;stroke:#b06d00;stroke-width:3}`
    + `.ai-state-replaced-from .tile,.ai-state-removed-from .tile{fill:#fdeeee;stroke:#bb0000;stroke-width:3;stroke-dasharray:6 4}.ai-state-quantity-changed-from .tile{fill:#fff6e5;stroke:#b06d00;stroke-width:3;stroke-dasharray:6 4}`
    + `.ai-component:focus .tile,.ai-component:hover .tile{stroke:#000;stroke-width:4}.lbl{font-size:12px;font-weight:bold;fill:#1d2d3e}.sub{font-size:10px;fill:#475e75}.hd{font-size:18px;font-weight:bold;fill:#1d2d3e}.note{font-size:11px;fill:#5b738b}.rev{font-size:13px;font-weight:bold;fill:#fff}</style>`;
  if (thumb) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t"><title id="t">${esc(title)}</title>${style}`
      + `<rect x="20" y="20" width="${W - 40}" height="${H - 40}" rx="16" class="frame"/>${tiles}</svg>\n`;
  }
  const badge = rev === 'A' ? '#5b738b' : '#0a6ed1';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="group" aria-labelledby="t d"><title id="t">${esc(title)}</title>`
    + `<desc id="d">Component regions are keyed to BOM item numbers of BOM-${esc(s.assemblyCode)}-${rev}. SYNTHETIC DEMO DATA, fictional NovaMotion Manufacturing; not CAD or engineering documentation.</desc>${style}`
    + `<rect x="20" y="20" width="${W - 40}" height="${H - 40}" rx="16" class="frame"/>`
    + `<text x="44" y="56" class="hd" ${FONT}>${esc(s.assemblyCode)} ${esc(s.description)}</text>`
    + `<rect x="${W - 170}" y="36" width="126" height="26" rx="13" fill="${badge}"/><text x="${W - 160}" y="54" class="rev" ${FONT}>Rev ${rev} ${rev === 'A' ? 'current' : 'proposed'}</text>`
    + `<text x="44" y="76" class="note" ${FONT}>SYNTHETIC ILLUSTRATION - not CAD</text>${tiles}</svg>\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const check = process.argv.includes('--check');
  let stale = 0;
  for (const s of SCENARIOS) {
    for (const [file, text] of [[`${s.assemblyCode}-A.svg`, svgFor(s, 'A')], [`${s.assemblyCode}-B.svg`, svgFor(s, 'B')], [`${s.assemblyCode}-B-thumb.svg`, svgFor(s, 'B', { thumb: true })]]) {
      const path = join(OUT, file);
      if (check) { if (!existsSync(path) || readFileSync(path, 'utf8') !== text) { stale++; console.log(`OUT OF DATE ${file}`); } }
      else { writeFileSync(path, text); console.log(`${file} ${text.length} B`); }
    }
  }
  if (check) process.exit(stale ? 1 : 0);
}
