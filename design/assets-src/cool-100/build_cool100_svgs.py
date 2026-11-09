"""Source for the COOL-100 visual assets (hand-authored vector drawing, no image generator used).

Outputs (optimized, committed):
  app/case-worklist/webapp/assets/assemblies/COOL-100-B.svg      P3 case page illustration (proposed revision B)
  app/case-worklist/webapp/assets/assemblies/COOL-100-B-thumb.svg P3 worklist thumbnail
  design/p4-visual-investigation/COOL-100.components.svg         P4 component-addressable diagram (both revisions)

The drawing is a SYNTHETIC illustration of the fictional NovaMotion COOL-100 cooling module
(dataset DS-ORACLE-01). It is not CAD or engineering documentation. Item numbers, materials and
quantities come from test/fixtures/m04/DS-ORACLE-01/bom_items.csv and materials.csv.
Run from the repository root: python3 design/assets-src/cool-100/build_cool100_svgs.py
"""
import math, os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
P3_DIR = os.path.join(ROOT, 'app', 'case-worklist', 'webapp', 'assets', 'assemblies')
P4_DIR = os.path.join(ROOT, 'design', 'p4-visual-investigation')

# Palette (neutral, SAP Horizon-like greys and one accent per component type)
C = dict(line='#3c4a5a', housing='#e3e8ee', housing2='#cfd7e0', shroud='#bcc6d1', hub='#3c4a5a', blade='#6f8396',
         seal='#2e7d6b', sensor='#e3a53b', bracket='#8a96a3', text='#1d2d3e', muted='#556b82', banner='#fff4d6')
f = lambda x: ('%.1f' % x).rstrip('0').rstrip('.')

def blade_paths(cx, cy, r_hub, r_tip, n, sweep=28):
    out = []
    for i in range(n):
        a0 = math.radians(i * 360 / n)
        a1 = a0 + math.radians(sweep)
        w = math.radians(360 / n * 0.42)
        p = lambda a, r: (cx + r * math.cos(a), cy + r * math.sin(a))
        s1, s2 = p(a0, r_hub), p(a0 + w * 0.6, r_hub)
        t1, t2 = p(a1, r_tip), p(a1 + w, r_tip)
        c1, c2 = p(a0 + math.radians(sweep * 0.2), (r_hub + r_tip) / 2), p(a0 + w + math.radians(sweep * 0.9), (r_hub + r_tip) / 2)
        out.append(f'M{f(s1[0])} {f(s1[1])}Q{f(c1[0])} {f(c1[1])} {f(t1[0])} {f(t1[1])}L{f(t2[0])} {f(t2[1])}Q{f(c2[0])} {f(c2[1])} {f(s2[0])} {f(s2[1])}Z')
    return out

def fan(cx, cy, r, blades):
    return (f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{C["shroud"]}" stroke="{C["line"]}" stroke-width="2"/>'
            f'<circle cx="{cx}" cy="{cy}" r="{r - 8}" fill="#f4f6f8" stroke="{C["line"]}" stroke-width="1"/>'
            + ''.join(f'<path d="{d}" fill="{C["blade"]}" stroke="{C["line"]}" stroke-width="1"/>' for d in blade_paths(cx, cy, 20, r - 12, blades))
            + f'<circle cx="{cx}" cy="{cy}" r="20" fill="{C["hub"]}"/><circle cx="{cx}" cy="{cy}" r="6" fill="{C["shroud"]}"/>')

def bracket(x, y, flip=False):
    # L-shaped mounting bracket with two holes
    s = -1 if flip else 1
    pts = [(x, y), (x + 46 * s, y), (x + 46 * s, y + 12), (x + 12 * s, y + 12), (x + 12 * s, y + 40), (x, y + 40)]
    poly = ' '.join(f'{f(a)},{f(b)}' for a, b in pts)
    return (f'<polygon points="{poly}" fill="{C["bracket"]}" stroke="{C["line"]}" stroke-width="1.5"/>'
            f'<circle cx="{f(x + 32 * s)}" cy="{y + 6}" r="3" fill="#f4f6f8"/><circle cx="{f(x + 6 * s)}" cy="{y + 28}" r="3" fill="#f4f6f8"/>')

HOUSING = (f'<rect x="120" y="60" width="300" height="260" rx="14" fill="{C["housing"]}" stroke="{C["line"]}" stroke-width="2.5"/>'
           f'<rect x="120" y="292" width="300" height="28" rx="0" fill="{C["housing2"]}" stroke="none"/>'
           + ''.join(f'<circle cx="{x}" cy="{y}" r="4" fill="{C["housing2"]}" stroke="{C["line"]}"/>' for x, y in [(138, 78), (402, 78), (138, 302), (402, 302)]))
SEAL = f'<rect x="132" y="72" width="276" height="216" rx="10" fill="none" stroke="{C["seal"]}" stroke-width="6"/>'
SENSOR = (f'<rect x="352" y="88" width="40" height="24" rx="3" fill="{C["sensor"]}" stroke="{C["line"]}" stroke-width="1.5"/>'
          f'<path d="M392 100 C430 100 430 40 470 40" fill="none" stroke="{C["line"]}" stroke-width="2"/>')
BRACKETS = [(74, 96, False), (74, 236, False), (466, 236, True)]  # unit 1, 2 (rev A and B), unit 3 added in rev B

def label(x, y, item, mat, desc, qty, color):
    return (f'<g><rect x="{x}" y="{y - 13}" width="10" height="10" fill="{color}" stroke="{C["line"]}"/>'
            f'<text x="{x + 16}" y="{y - 4}" font-size="12" font-weight="700" fill="{C["text"]}">{item} · {mat} ×{qty}</text>'
            f'<text x="{x + 16}" y="{y + 10}" font-size="11" fill="{C["muted"]}">{desc}</text></g>')

FONT = 'font-family="Arial, Helvetica, sans-serif"'
BANNER = 'SYNTHETIC ILLUSTRATION — fictional NovaMotion COOL-100, not CAD or engineering documentation'

def illustration():
    body = (HOUSING + fan(270, 182, 98, 7) + SEAL + SENSOR + ''.join(bracket(*b) for b in BRACKETS)
            + label(520, 96, '0010', 'FAN-B', 'Cooling fan (high-flow)', 1, C['blade'])
            + label(520, 140, '0020', 'BRKT-01', 'Mounting bracket', 3, C['bracket'])
            + label(520, 184, '0030', 'SENS-01', 'Temperature sensor', 1, C['sensor'])
            + label(520, 228, '0040', 'SEAL-01', 'Housing seal', 1, C['seal'])
            + f'<text x="520" y="268" font-size="11" fill="{C["muted"]}">Proposed revision B (BOM-COOL-100-B)</text>'
            + f'<rect x="0" y="352" width="760" height="28" fill="{C["banner"]}"/>'
            + f'<text x="380" y="370" font-size="12" text-anchor="middle" fill="{C["text"]}">{BANNER}</text>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 380" role="img" aria-labelledby="t d" {FONT}>'
            '<title id="t">COOL-100 cooling module, proposed revision B (synthetic illustration)</title>'
            '<desc id="d">Housing with a seven-blade high-flow fan FAN-B, temperature sensor SENS-01 with cable, housing seal SEAL-01 and three mounting brackets BRKT-01. Synthetic illustration of fictional data, not CAD.</desc>'
            f'<rect width="760" height="380" fill="#ffffff"/>{body}</svg>\n')

def thumbnail():
    body = (HOUSING + fan(270, 182, 98, 7) + SEAL + SENSOR + ''.join(bracket(*b) for b in BRACKETS))
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="60 30 460 310" role="img" aria-labelledby="t">'
            '<title id="t">COOL-100 thumbnail (synthetic illustration)</title>'
            f'<rect x="60" y="30" width="460" height="310" fill="#ffffff"/>{body}</svg>\n')

def components():
    g = lambda id_, item, a, b, extra, inner, label_: (
        f'<g id="{id_}" class="ai-component" data-item-no="{item}" data-material-rev-a="{a}" data-material-rev-b="{b}"{extra} '
        f'tabindex="0" role="button" aria-label="{label_}">{inner}</g>')
    parts = [
        f'<g id="ai-housing" class="ai-context" aria-hidden="true">{HOUSING}</g>',
        g('ai-item-0010', '0010', 'FAN-A', 'FAN-B', '', fan(270, 182, 98, 7), 'Item 0010 cooling fan, FAN-A in revision A, FAN-B in revision B'),
        g('ai-item-0040', '0040', '', 'SEAL-01', '', SEAL, 'Item 0040 housing seal SEAL-01, revision B only'),
        g('ai-item-0030', '0030', 'SENS-01', 'SENS-01', '', SENSOR, 'Item 0030 temperature sensor SENS-01'),
    ]
    for i, b in enumerate(BRACKETS, start=1):
        parts.append(g(f'ai-item-0020-u{i}', '0020', 'BRKT-01' if i <= 2 else '', 'BRKT-01', f' data-unit="{i}"',
                       bracket(*b), f'Item 0020 mounting bracket BRKT-01, unit {i}' + (' (revision B only)' if i > 2 else '')))
    style = ('<style>.ai-component{cursor:pointer}.ai-component:focus{outline:none}'
             '.ai-component:focus>*,.ai-selected>*{filter:drop-shadow(0 0 3px #0a6ed1)}'
             '.ai-state-added>*{stroke:#256f3a;stroke-width:3}.ai-state-removed{opacity:.35}.ai-state-removed>*{stroke-dasharray:6 4}'
             '.ai-state-replaced>*{stroke:#aa0808;stroke-width:3}.ai-state-quantity-changed>*{stroke:#e76500;stroke-width:3}'
             '.ai-state-unchanged{opacity:.9}</style>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="60 30 460 340" role="group" aria-labelledby="t d" {FONT}>'
            '<title id="t">COOL-100 component diagram (synthetic, component-addressable)</title>'
            '<desc id="d">Each BOM item position is a group with a stable id (ai-item-NNNN, brackets per unit). '
            'data-material-rev-a / -b hold the material per revision. Change states are applied at runtime from ImpactComparisonLines. Synthetic, not CAD.</desc>'
            f'{style}<rect x="60" y="30" width="460" height="340" fill="#ffffff"/>' + ''.join(parts)
            + f'<text x="290" y="362" font-size="11" text-anchor="middle" fill="{C["muted"]}">SYNTHETIC — fictional COOL-100, not CAD</text></svg>\n')

os.makedirs(P3_DIR, exist_ok=True); os.makedirs(P4_DIR, exist_ok=True)
for path, content in [(os.path.join(P3_DIR, 'COOL-100-B.svg'), illustration()),
                      (os.path.join(P3_DIR, 'COOL-100-B-thumb.svg'), thumbnail()),
                      (os.path.join(P4_DIR, 'COOL-100.components.svg'), components())]:
    open(path, 'w', encoding='utf-8').write(content)
    print(os.path.relpath(path, ROOT), len(content.encode()), 'bytes')
