"""Builds implementation-report.md and the PDF report for the P3 Case Worklist from one source.
Inputs: ../screenshots/, times.txt, github.json (PR/CI facts, filled after publication).
Usage: python3 build_report.py <output dir>   (the evidence folder in the repository)
"""
import hashlib, json, os, sys, html
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Table, TableStyle,
                                Image, PageBreak, KeepTogether, Preformatted)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from PIL import Image as PILImage

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'out')
os.makedirs(OUT, exist_ok=True)
GH = json.load(open(os.path.join(HERE, 'github.json')))
TIMES = dict(l.split() for l in open(os.path.join(HERE, 'times.txt')) if l.strip())
SHOTS = os.path.join(HERE, '..', 'screenshots')
sha = lambda p: hashlib.sha256(open(p, 'rb').read()).hexdigest()

TITLE = 'AssemblyImpact AI — P3 Engineering Change Case Worklist: Implementation, Testing & Evidence Report'
PDF_NAME = 'P3_Case_Worklist_Report.pdf'
FOOTER = 'AssemblyImpact AI — P3 Case Worklist report · synthetic data · AI-generated, student review pending'
BASE = 'a0068c6050ca09efae12deb3eacc26a6a4d2539d'
COMMITS = [('77730307a1ab', 'feat(p3): add Engineering Change Case Worklist Fiori elements app'),
           ('af43aafe863e', 'fix(p3): correct standalone UI rendering found in BAS preview'),
           ('377e46aa5b71', 'fix(p3): apply table sort orders on Object Page sections')]
HEAD = '377e46aa5b712487fa63777f9c0ebe38e00271bf'
M = lambda t: f"<font face='Mono'>{t}</font>"

SCREENSHOTS = [
    ('P3-01', 'P3-01_bas-synced-main-regression.jpg', 'BAS synchronized to main and baseline regression',
     'Repository in BAS fast-forwarded to main a0068c6 (M04 Slice 1b merge); baseline npm test 35/35 and lint pass before any P3 work.'),
    ('P3-02', 'P3-02_pa-input-requirements-loaded.jpg', 'Project Accelerator input in the separate sandbox',
     'Project Accelerator opened in pa-sandbox/case-worklist with the requirements document and the approved layout image as input. Not the AssemblyImpact repository.'),
    ('P3-03', 'P3-03_pa-generation-step1.jpg', 'Project Accelerator generation running',
     'First generation step of the CAP Accelerator flow.'),
    ('P3-04', 'P3-04_pa-generation-complete.jpg', 'Generation completed',
     'Project Accelerator reports the generated application assemblyImpactCaseWorklist.'),
    ('P3-05', 'P3-05_pa-page-map.jpg', 'Generated Page Map (design-time view, not a running UI)',
     'Page Map of the generated app: ReviewCases List Report -> ReviewCases Object Page -> Findings Object Page. A configuration view only; the running UI is shown in P3-08/P3-09.'),
    ('P3-06', 'P3-06_pa-generated-files.jpg', 'Generated files',
     '44 generated files: own CDS namespace, draft-enabled service, code lists, sample CSV data and a Fiori elements app.'),
    ('P3-07', 'P3-07_pa-baseline-and-draft-service.jpg', 'Sandbox baseline commit and generated draft service',
     'Original output committed in the sandbox as 9910c02 and archived (sha256 e3af883a…); generated service assemblyImpactCaseWorklistSrv is @odata.draft.enabled.'),
    ('P3-08', 'P3-08_generated-ui-list-report.jpg', 'Generated UI running with its own mock data — List Report',
     'Browser-rendered generated app (sandbox cds watch). Shows 10 review cases invented by the generator, an Editing Status filter and Create/Delete buttons from draft handling. Not AssemblyImpact data.'),
    ('P3-09', 'P3-09_generated-ui-object-page.jpg', 'Generated UI running with its own mock data — Object Page',
     'Generated Object Page with Edit/Delete and invented findings for EC-000473. Values do not match the backend oracle; this is why the generated data and service were not imported.'),
    ('P3-10', 'P3-10_integrated-worklist-cviewer.jpg', 'Implemented worklist on EngineeringReview — viewer (plant 1000)',
     'User cviewer sees one case, EC-000473 / COOL-100, IN_REVIEW. Impact columns are empty because no impact run exists yet.'),
    ('P3-11', 'P3-11_runimpact-forbidden-viewer.jpg', 'Run Impact refused for a viewer',
     'cviewer presses Run Impact; the server returns 403 Forbidden and the app shows the message. Authorization is enforced by the service.'),
    ('P3-12', 'P3-12_runimpact-analyst-worklist-values.jpg', 'Run Impact by an analyst fills the worklist',
     'User analyst runs the impact for 2026-11-08: instruction findings 1, materials short 2, estimated cost delta 1,200.00 EUR (oracle values).'),
    ('P3-13', 'P3-13_case-object-page.jpg', 'Review Case Object Page',
     'General section and Latest Impact (56.00 -> 68.00 EUR per assembly, +1,200.00 EUR, 21.43 %) and the list of impact runs.'),
    ('P3-14', 'P3-14_impact-run-findings.jpg', 'Impact Run page — findings',
     '7 findings with severity criticality and evidence references. Captured before the sort-order fix (rows in backend order).'),
    ('P3-15', 'P3-15_impact-run-materials-bom.jpg', 'Impact Run page — material impact and BOM comparison',
     'FAN-B gap 20 and BRKT-01 gap 50 marked SHORT; BOM comparison REPLACED / QUANTITY_CHANGED / UNCHANGED / ADDED. Captured before the sort-order fix.'),
    ('P3-16', 'P3-16_plant2000-user-isolation.jpg', 'Plant isolation in the UI',
     'User analyst2000 (plant 2000) sees only the labelled mirror case EC-200473.'),
    ('P3-17', 'P3-17_cross-plant-deeplink-not-found.jpg', 'Cross-plant deep link refused',
     'analyst2000 opens the plant-1000 case URL directly; the service answers 404 and the app shows Not Found.'),
    ('P3-18', 'P3-18_before-fix-unsorted.jpg', 'Defect found in the browser: section tables not sorted',
     'After commit af43aaf the Material Impact and BOM Comparison rows were still in insertion order (SENS-01 first, item 0030 first).'),
    ('P3-19', 'P3-19_run-material-bom-sorted.jpg', 'After fix 377e46a: material and BOM tables sorted',
     'Material Impact sorted by material (BRKT-01, FAN-B, SEAL-01, SENS-01) and BOM Comparison by item (0010-0040); sort indicators shown in the column headers.'),
    ('P3-20', 'P3-20_run-findings-sorted.jpg', 'After fix 377e46a: findings sorted by type and material',
     'Findings sorted by finding type, then material; severity is shown with criticality icons.'),
]
for eid, f, title, desc in GH.get('extra_shots', []):
    SCREENSHOTS.append((eid, f, title, desc))

S = []
def h1(t): S.append(('h1', t))
def h2(t): S.append(('h2', t))
def p(t): S.append(('p', t))
def bullets(*items): S.append(('bullets', items))
def table(rows, widths=None): S.append(('table', (rows, widths)))
def code(t): S.append(('code', t))
def pb(): S.append(('pb', None))

ci_line = (f"GitHub Actions on {GH['ci_sha'][:7]}: {GH['ci_conclusion']} ({GH['ci_name']}, run {GH['ci_run_id']})"
           if GH.get('ci_conclusion') else 'GitHub Actions: not yet available when this report was generated')

h1('1. Executive summary')
p('<b>Objective.</b> Begin P3: generate a Fiori elements Case Worklist with SAP Project Accelerator in an isolated sandbox, '
  'run the generated UI, and connect a corrected version to the existing read-only EngineeringReview OData V4 service.')
p(f"<b>Status.</b> Implemented and verified in a running browser session in SAP Business Application Studio (BAS). "
  f"Branch {M('feat/p3-case-worklist')} (3 commits on main {BASE[:7]}). {ci_line}. "
  f"Draft pull request: {GH.get('pr_url') or 'not yet created'}. Not merged, not deployed.")
bullets(
    'Project Accelerator ran in the separate sandbox <font face="Mono">pa-sandbox/case-worklist</font>; its original 44 files are preserved unchanged (sandbox commit 9910c02, copy in <font face="Mono">generated/</font>).',
    'The generated app was run in the browser with its own mock data (P3-08, P3-09). It showed invented values and draft editing, so only its page structure was reused.',
    'The implemented app <font face="Mono">app/case-worklist</font> shows Review Cases -> Review Case -> Impact Run -> Finding from EngineeringReview, with the Run Impact action.',
    'Browser checks: plant isolation, 403 for viewers on Run Impact, analyst run reproducing the oracle (+1,200.00 EUR, 2 short, 7 findings), cross-plant deep link 404.',
    'Three defects found only in the browser were fixed: UI5 1.120 startup error, zero-height app container, unsorted section tables.',
    'npm test 40/40 and lint pass locally and in BAS; no new dependencies.')
p('<b>Not claimed.</b> The Project Accelerator Page Map (P3-05) is a design-time view, not a working UI; the working UI is the browser-rendered '
  'application in P3-08 to P3-20. No BTP deployment, no S/4HANA data, no Joule, no P4 work. All records are synthetic.')

h1('2. Starting state and inputs')
table([
    ['Item', 'Value'],
    ['GitHub baseline', f'main = {BASE[:12]} (M04 Slice 1b, PR #4). BAS fast-forwarded; 35/35 tests (P3-01).'],
    ['Backend', 'CAP OData V4 EngineeringReview: ReviewCases, ImpactRuns, Findings, ImpactMaterialLines, ImpactComparisonLines; read-only plus bound action runImpact (ChangeAnalyst, plant-restricted).'],
    ['Seed data', 'SEED-M04-01 (synthetic): EC-000473 / COOL-100 plant 1000 and mirror EC-200473 plant 2000. No impact runs are seeded.'],
    ['Design input', 'Approved layout mockup (illustrative values) and requirements AssemblyImpact_Case_Worklist_requirements.md (sha256 021aa8e1…).'],
    ['Runtime (BAS)', 'Node v24.21.0, @sap/cds 10.2.2, cds-compiler 7.2.1, @cap-js/sqlite 3.1.2, @sap/cds-fiori 2.3.0; SAPUI5 1.149.0 (CDN).'],
], [36*mm, 134*mm])

h1('3. Project Accelerator generation (sandbox)')
p('Project Accelerator (SAP Fiori tools, CAP Accelerator flow) was given the requirements text and the layout image '
  '(P3-02 to P3-04). The output was committed in the sandbox as 9910c02 and archived '
  f"({M('pa-original-output.tgz')}, sha256 e3af883acbae…). The original files are copied unchanged to "
  f"{M('docs/evidence/p3-case-worklist/generated/')}; the archive itself is not committed.")
table([
    ['Generated part', 'Content', 'Used?'],
    ['Data model', 'Own namespace assemblyImpactCaseWorklist: ReviewCases, Assemblies, Findings, MaterialImpacts, DecisionHistories + 6 code lists', 'No (D-P3-2)'],
    ['Service', 'assemblyImpactCaseWorklistSrv at /odata/v4/assembly-impact-case-worklist-srv/, @odata.draft.enabled', 'No'],
    ['Sample data', 'CSV rows invented by the generator (10 cases, findings, materials)', 'No'],
    ['Fiori app', 'List Report -> Object Page -> Findings Object Page; minUI5Version 1.149.0', 'Page structure only'],
    ['Metadata', '.fiori-ai: log.txt, model.json, user-input.txt, userImage.png', 'Evidence only'],
], [30*mm, 110*mm, 30*mm])

h1('4. Generated UI preview and design comparison')
p('The generated application was started in the sandbox and opened in the browser (P3-08, P3-09). It renders, but with the '
  'generator\'s own invented records and draft editing (Create, Edit, Delete, Editing Status), which conflicts with the read-only, '
  'role- and plant-checked EngineeringReview service.')
table([
    ['Mockup / requirement', 'Project Accelerator output', 'Implemented', 'Reason'],
    ['Filters: Assembly, Plant, Revision, Status, Source', 'Filters on generated entity + Editing Status', 'assemblyCode, plant, toRevision, status, sourceType', 'same intent on existing service'],
    ['Columns up to Review Status', 'Columns on generated entity', '9 columns; findings / short / cost delta from latestRun', 'figures come from immutable runImpact snapshots'],
    ['Status colours', 'Code-list criticality', '$edmJson If/Eq criticality on status', 'no new backend field'],
    ['Create Change, Export', 'Create/Delete (draft)', 'Not implemented', 'read-only service (D-P3-5)'],
    ['Case: General information', 'Object Page section', 'FieldGroup General + Latest Impact', '-'],
    ['Findings tab on the case', '/ReviewCases/Findings', 'Impact Run page -> Findings -> Finding page', 'findings stored per run (D-P3-3)'],
    ['Material Impact tab', 'MaterialImpacts table', 'Impact Run page: Material Impact + BOM Comparison', 'per run'],
    ['Decision History tab', 'DecisionHistories entity', 'Not shown', 'no backend entity yet'],
    ['Run impact', 'Not generated', 'runImpact action on list and case', 'server-enforced (D-P3-4)'],
    ['Draft editing', '@odata.draft.enabled', 'None', 'service read-only by design'],
], [36*mm, 38*mm, 52*mm, 44*mm])

h1('5. Implementation record')
units = [
    ('U1 App descriptor', 'app/case-worklist/webapp/manifest.json, Component.js, index.html, i18n', 'dataSource /odata/v4/engineering-review/; routes ReviewCasesList, ReviewCasesObjectPage, ImpactRunsObjectPage, FindingsObjectPage; no draft; UI5 1.149.0 bootstrap.', 'D-P3-2, D-P3-3, D-P3-6'),
    ('U2 Annotations', 'app/case-worklist/annotations.cds', 'SelectionFields, LineItem with criticality and runImpact, HeaderInfo, FieldGroups, Facets, PresentationVariants on EngineeringReview entities.', 'D-P3-4, D-P3-7'),
    ('U3 Tests', 'test/case-worklist-app.test.js, package.json', '5 tests: manifest-model consistency, annotation contract, static serving, list/action authorization, navigation paths and plant isolation.', 'quality gate'),
    ('U4 Documentation', 'app/case-worklist/README.md, readme.md', 'Origin, read-only scope, how to run with development users; synthetic-data notice.', 'traceability'),
]
table([['Unit', 'Files', 'What', 'Decision']] + [list(u) for u in units], [26*mm, 46*mm, 74*mm, 24*mm])
table([['Commit', 'Message']] + [list(c) for c in COMMITS], [30*mm, 140*mm])
p('All three commits: author and committer Naman Patel &lt;108478447+Naman028@users.noreply.github.com&gt;, no co-author trailer. '
  'The decision log is in <font face="Mono">decisions.md</font>.')

h1('6. Corrections found in the running UI')
table([
    ['#', 'Observed in the browser', 'Cause', 'Fix', 'Evidence'],
    ['1', 'Blank page; console: storeInnerAppStateAsync is not a function', 'UI5 1.120.0 too old for the generated app pattern', 'Bootstrap SAPUI5 1.149.0 (af43aaf)', 'P3-10 onward'],
    ['2', 'Still blank, no error', 'Component container had height 0', 'Full height for #container-uiarea (af43aaf)', 'P3-10 onward'],
    ['3', 'Material Impact and BOM rows unsorted', 'Section facets targeted @UI.LineItem, so the PresentationVariant added in af43aaf was ignored', 'Facets target nav/@UI.PresentationVariant; test forbids LineItem facet targets (377e46a)', 'P3-18 -> P3-19, P3-20'],
], [6*mm, 44*mm, 46*mm, 50*mm, 24*mm])
p('<b>Note on defect 3.</b> The browser had cached the older $metadata, so screenshots P3-14/P3-15 (taken after af43aaf) show the '
  'unsorted state as well. After forcing a metadata reload, the table bindings were checked in the page: findings sorted by '
  '[type, material], material lines by [material], comparison lines by [itemNo]. Commit af43aaf\'s message overstated its effect '
  'on sorting; 377e46a is the effective fix.')
p('<b>Other observation.</b> One cold deep-link load right after switching development users showed a transient "Not Found" '
  'dialog; it did not recur on reload or in-app navigation. Logged as an open observation.')

h1('7. Testing and verification')
table([
    ['Command', 'Local', 'BAS'],
    ['npm test', 'tests 40, pass 40, fail 0', 'tests 40, pass 40, fail 0 (after 377e46a)'],
    ['npm run lint (eslint srv test --max-warnings=0)', 'exit 0', 'exit 0'],
    ['Dependencies', 'package-lock.json unchanged', '-'],
], [70*mm, 50*mm, 50*mm])
table([
    ['New test (test/case-worklist-app.test.js)', 'Checks', 'Result'],
    ['manifest targets EngineeringReview', 'dataSource, entity sets and navigation paths resolve against the CDS model; no draft', 'pass'],
    ['annotation contract', 'exact columns and filters, facets, criticality, sort orders, no LineItem facet targets, $metadata carries UI annotations', 'pass'],
    ['static serving', 'index.html, manifest, Component, i18n served; full-height container; UI5 1.149.0 bootstrap', 'pass'],
    ['list and action', 'plant-1000 user sees 1 case, plant-2000 user only EC-200473; runImpact 200 analyst / 403 viewer / 404 other plant; columns 1 / 2 / 1200', 'pass'],
    ['navigation paths', 'case -> runs -> 7 findings / SHORT BRKT-01 50, FAN-B 20; cross-plant paths 404 or empty; anonymous 401', 'pass'],
], [44*mm, 108*mm, 18*mm])
table([
    ['Browser check (BAS preview, development profile)', 'Expected', 'Observed', 'Evidence'],
    ['Viewer opens worklist', '1 case, no impact figures yet', 'as expected', 'P3-10'],
    ['Viewer presses Run Impact', '403 message', '403 Forbidden shown', 'P3-11'],
    ['Analyst runs impact 2026-11-08', '1 / 2 / 1,200.00', '1 / 2 / 1,200.00', 'P3-12'],
    ['Case and run pages', '56.00 -> 68.00, 21.43 %, 7 findings, 2 SHORT', 'as expected', 'P3-13 to P3-15'],
    ['Plant-2000 user', 'only EC-200473', 'as expected', 'P3-16'],
    ['Cross-plant deep link', 'Not Found', 'Not Found', 'P3-17'],
    ['Section sorting', 'material / item / type order', 'unsorted before, sorted after 377e46a', 'P3-18 to P3-20'],
], [52*mm, 42*mm, 46*mm, 30*mm])

h1('8. Screenshot evidence')
p('Original, unedited captures of the browser in the BAS session, taken with Claude in Chrome. Times are UTC. '
  'No secrets are visible; development passwords are public mock values and are not shown.')
for eid, f, title, desc in SCREENSHOTS:
    S.append(('shot', (eid, f, title, desc)))

h1('9. Security review')
table([
    ['Area', 'Result', 'Evidence'],
    ['Authorization stays in the service', 'The UI adds no access logic; runImpact 403 for viewers and 404 across plants come from the backend', 'P3-11, P3-17, tests'],
    ['Plant isolation', 'List, deep links and navigation paths respect the plant attribute', 'P3-16, P3-17, tests'],
    ['Authentication', 'Anonymous OData request 401; the static app files are public but contain no data or secrets', 'tests'],
    ['No write surface', 'No draft, create, update or delete; only the existing bound action', 'annotation test (no Draft)'],
    ['Generated code', 'Generated service, data and draft handling not imported; sandbox kept separate', 'D-P3-1, D-P3-2'],
    ['External resources', 'SAPUI5 loaded from sapui5.hana.ondemand.com 1.149.0 (SAP CDN); no other third-party script', 'index.html'],
    ['Dependencies / secrets', 'No new packages; diff contains no keys or tokens', 'review'],
], [38*mm, 102*mm, 30*mm])
p('<b>Unresolved risks.</b> No xs-security.json or role templates (blocks BTP deployment); the Run Impact button is visible to viewers '
  '(server refuses); development mock passwords are public by design; the CDN dependency needs a CSP/approuter decision before deployment.')
p('<b>Review disclosure.</b> Code review, security review and quality assessment were performed by one AI system (Claude, Anthropic). '
  'No human or SAP reviewer took part.')

h1('10. Limitations')
bullets(
    'Unit price shows 9 decimals (backend Decimal scale); cosmetic, not fixed.',
    'Decision History, Create Change and Export from the mockup are not implemented (no backend support yet).',
    'Findings are not ordered by severity rank (string field); criticality icons mark severity.',
    'Run Impact uses a free date parameter dialog; no value help.',
    'Preview only in BAS with mocked authentication; no BTP deployment, approuter or launchpad tile.',
    'All data synthetic (NovaMotion Manufacturing); no S/4HANA connection; no Joule.')

h1('11. GitHub traceability')
table([
    ['Item', 'Value', 'Status'],
    ['Branch', f'feat/p3-case-worklist (from main {BASE[:7]})', 'verified'],
    ['Code commits', '; '.join(c[0] for c in COMMITS) + f' (head {HEAD[:12]})', 'verified in BAS (same hashes)'],
    ['Changed files (code)', '10 files: app/case-worklist (6), test/case-worklist-app.test.js, package.json, readme.md', 'verified'],
    ['Evidence commit', GH.get('evidence_commit') or 'docs(p3): add Case Worklist evidence (this folder); a file cannot contain its own commit hash', 'see PR'],
    ['Pull request', GH.get('pr_url') or 'not created', GH.get('pr_status', 'pending')],
    ['CI', ci_line, 'verified' if GH.get('ci_conclusion') == 'success' else 'pending'],
    ['main', f'unchanged at {BASE[:12]}', GH.get('main_status', 'verified before push')],
], [34*mm, 106*mm, 30*mm])

h1('12. Four-project relevance and next steps')
table([
    ['Project', 'Contribution', 'Not claimed'],
    ['P1 Joule', 'Same authorized service a skill could call.', 'No Joule skill.'],
    ['P2 S/4HANA + GenAI', 'UI ready to show S4_IMPORT cases later.', 'No S/4HANA data.'],
    ['P3 Project Accelerator', 'Generated, run, compared and adapted; evidence of every correction.', 'Page Map is not a UI.'],
    ['P4 custom investigation UI', 'None (kept separate).', 'Not started.'],
], [38*mm, 82*mm, 50*mm])
bullets(
    'Owner review of D-P3-1 to D-P3-8 and of this PR; merge only with separate approval.',
    'Approval-workflow slice: decision history entity and actions, then the Decision History section.',
    'BTP readiness: xs-security.json, approuter, CSP for the UI5 CDN, HANA; deployment needs separate authorization.')

pb()
h1('Appendix A — Evidence manifest (screenshots)')
rows = [['ID', 'File', 'Captured (UTC)', 'SHA-256']]
for eid, f, *_ in SCREENSHOTS:
    rows.append([eid, f, TIMES.get(eid, ''), sha(os.path.join(SHOTS, f))])
table(rows, [12*mm, 62*mm, 34*mm, 62*mm])
p('All files in this folder, including generated/ and logs/, are hashed in evidence-manifest.json, produced in BAS when the evidence was committed.')
h1('Appendix B — References')
bullets(
    'SAP Fiori elements for OData V4: table sections and presentation variants — https://ui5.sap.com/#/topic/7f844f1021cd4791b8f7408eac7c1cec',
    'SAP CAP: serving Fiori UIs — https://cap.cloud.sap/docs/advanced/fiori',
    'Project artifacts: srv/engineering-review.cds, test/data (SEED-M04-01), docs/evidence/m04-slice1b.',
    'AI assistance: implementation, tests, evidence capture and this report by Claude (Anthropic, Claude Opus 5.5) under owner authorization; student review pending.')
# ---------------------------------------------------------------- markdown
def md_inline(t):
    import re
    t = re.sub(r"<font face='Mono'>(.*?)</font>|<font face=\"Mono\">(.*?)</font>", lambda m: '`' + (m.group(1) or m.group(2)) + '`', t)
    return t.replace('<b>', '**').replace('</b>', '**')
md = [f'# {TITLE}', '', f'Generated from `report-source/build_report.py`; PDF: `P3_Case_Worklist_Report.pdf`.', '']
for kind, x in S:
    if kind == 'h1': md += [f'## {x}', '']
    elif kind == 'h2': md += [f'### {x}', '']
    elif kind == 'p': md += [md_inline(x), '']
    elif kind == 'bullets': md += [f'- {md_inline(i)}' for i in x] + ['']
    elif kind == 'table':
        rows = x[0]
        md += ['| ' + ' | '.join(md_inline(c).replace('|', '/') for c in rows[0]) + ' |', '|' + ' --- |' * len(rows[0])]
        md += ['| ' + ' | '.join(md_inline(c).replace('|', '/') for c in r) + ' |' for r in rows[1:]] + ['']
    elif kind == 'code': md += ['```', x, '```', '']
    elif kind == 'shot':
        eid, f, title, desc = x
        md += [f'**{eid} — {title}** ({TIMES.get(eid, "")} UTC)', '', f'![{eid}](screenshots/{f})', '', desc, '']
open(os.path.join(OUT, 'implementation-report.md'), 'w').write('\n'.join(md))

# ---------------------------------------------------------------- pdf
pdfmetrics.registerFont(TTFont('Sans', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'))
pdfmetrics.registerFont(TTFont('Sans-Bold', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'))
pdfmetrics.registerFont(TTFont('Mono', '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf'))
from reportlab.pdfbase.pdfmetrics import registerFontFamily
registerFontFamily('Sans', normal='Sans', bold='Sans-Bold', italic='Sans', boldItalic='Sans-Bold')
ss = getSampleStyleSheet()
st = {
    'title': ParagraphStyle('t', fontName='Sans-Bold', fontSize=18, leading=23, spaceAfter=6, textColor=colors.HexColor('#0a2540')),
    'sub': ParagraphStyle('s', fontName='Sans', fontSize=10, leading=14, textColor=colors.HexColor('#444444')),
    'h1': ParagraphStyle('h1', fontName='Sans-Bold', fontSize=13.5, leading=17, spaceBefore=12, spaceAfter=6, keepWithNext=1, textColor=colors.HexColor('#0a2540')),
    'h2': ParagraphStyle('h2', fontName='Sans-Bold', fontSize=11, leading=14, spaceBefore=8, spaceAfter=4),
    'p': ParagraphStyle('p', fontName='Sans', fontSize=9.2, leading=13, spaceAfter=5),
    'cell': ParagraphStyle('c', fontName='Sans', fontSize=7.8, leading=10),
    'cellb': ParagraphStyle('cb', fontName='Sans-Bold', fontSize=7.8, leading=10, textColor=colors.white),
    'cap': ParagraphStyle('cap', fontName='Sans', fontSize=8.3, leading=11, textColor=colors.HexColor('#333333'), spaceAfter=10),
    'code': ParagraphStyle('code', fontName='Mono', fontSize=7.2, leading=9.5, backColor=colors.HexColor('#f3f4f6'), borderPadding=5),
}
def para(t, s='p'): return Paragraph(t, st[s])
flow = []
flow += [Spacer(1, 30*mm), para(TITLE, 'title'), Spacer(1, 4*mm),
         para('SAP Fiori elements List Report / Object Page on the EngineeringReview CAP service, generated with SAP Project Accelerator and adapted', 'sub'), Spacer(1, 8*mm)]
cover = [['Repository', 'Naman028/assemblyimpact-ai'], ['Branch', 'feat/p3-case-worklist'], ['Code head commit', HEAD],
         ['Base (main)', BASE], ['Environment', 'SAP BTP trial — SAP Business Application Studio (dev space ws-lecln)'],
         ['Pull request', GH.get('pr_url') or 'not yet created'], ['CI', ci_line], ['Report date', GH.get('report_date', '2026-11-09')],
         ['Prepared by', 'Claude (Anthropic) for Naman Patel — AI-generated; student review pending']]
t = Table([[para(a, 'cell'), para(b, 'cell')] for a, b in cover], colWidths=[40*mm, 130*mm])
t.setStyle(TableStyle([('GRID', (0, 0), (-1, -1), 0.4, colors.HexColor('#c8ccd2')), ('BACKGROUND', (0, 0), (0, -1), colors.HexColor('#eef2f7')),
                       ('VALIGN', (0, 0), (-1, -1), 'TOP'), ('TOPPADDING', (0, 0), (-1, -1), 4), ('BOTTOMPADDING', (0, 0), (-1, -1), 4)]))
flow += [t, Spacer(1, 8*mm), para('<b>All demonstration records in this report are synthetic</b> (fictional NovaMotion Manufacturing). '
                                  'They are not SAP S/4HANA data. Screenshots are unedited captures of the actual BAS session.', 'p'), PageBreak()]
for kind, x in S:
    if kind == 'h1': flow.append(para(x, 'h1'))
    elif kind == 'h2': flow.append(para(x, 'h2'))
    elif kind == 'p': flow.append(para(x))
    elif kind == 'bullets':
        for i in x: flow.append(Paragraph(i, st['p'], bulletText='•'))
    elif kind == 'table':
        rows, widths = x
        data = [[para(html.escape(c) if '<' not in c else c, 'cellb') for c in rows[0]]] + \
               [[para(c if '<font' in c else html.escape(c), 'cell') for c in r] for r in rows[1:]]
        tb = Table(data, colWidths=widths, repeatRows=1)
        tb.setStyle(TableStyle([('GRID', (0, 0), (-1, -1), 0.4, colors.HexColor('#c8ccd2')),
                                ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#0a2540')),
                                ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f6f8fb')]),
                                ('VALIGN', (0, 0), (-1, -1), 'TOP'), ('TOPPADDING', (0, 0), (-1, -1), 3), ('BOTTOMPADDING', (0, 0), (-1, -1), 3)]))
        flow += [tb, Spacer(1, 4*mm)]
    elif kind == 'code': flow.append(Preformatted(x, st['code']))
    elif kind == 'pb': flow.append(PageBreak())
    elif kind == 'shot':
        eid, f, title, desc = x
        path = os.path.join(SHOTS, f)
        w, h = PILImage.open(path).size
        width = 170*mm; height = width * h / w
        flow.append(KeepTogether([para(f'<b>{eid} — {html.escape(title)}</b>', 'h2'), Image(path, width=width, height=height),
                                  para(f'{html.escape(desc)}<br/>Captured {TIMES.get(eid, "")} UTC · file screenshots/{f} · '
                                       f'SHA-256 {sha(path)[:16]}…', 'cap')]))

def decorate(c, doc):
    c.saveState(); c.setFont('Sans', 7.5); c.setFillColor(colors.HexColor('#666666'))
    c.drawString(20*mm, 10*mm, FOOTER)
    c.drawRightString(190*mm, 10*mm, f'Page {doc.page}'); c.restoreState()
doc = BaseDocTemplate(os.path.join(OUT, PDF_NAME), pagesize=A4, leftMargin=20*mm, rightMargin=20*mm,
                      topMargin=18*mm, bottomMargin=18*mm, title=TITLE, author='Claude (Anthropic) for Naman Patel',
                      subject='P3 Case Worklist evidence')
doc.addPageTemplates([PageTemplate(id='p', frames=[Frame(20*mm, 16*mm, 170*mm, 263*mm, id='f')], onPage=decorate)])
doc.build(flow)
print('ok', OUT)
