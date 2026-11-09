"""Builds implementation-report.md and the PDF report for M04 Slice 1b from one source.
Inputs: screenshots/, times.txt, github.json (PR/CI facts, filled after publication).
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
SHOTS = os.path.join(HERE, 'screenshots')
sha = lambda p: hashlib.sha256(open(p, 'rb').read()).hexdigest()

TITLE = 'AssemblyImpact AI — M04 Slice 1b Implementation, Testing & Evidence Report'
IMPL = '68d6501126a1dafcb9f35e0b65a226f11cfc9efb'
BASE = 'eaf97f2780d3d66b6bd636aee00d873b29377fdf'

SCREENSHOTS = [
    ('E-01', 'E-01_bas-environment.jpg', 'BAS repository, branch and environment identification',
     'Dev space ws-lecln, branch feat/m04-slice1b at 68d6501 on base eaf97f2; Node v24.21.0, @sap/cds 10.2.2, cds-compiler 7.2.1, @cap-js/sqlite 3.1.2; clean tree.'),
    ('E-02', 'E-02_dataset-files-and-config.jpg', 'CAP development/test dataset files and data-loading configuration',
     'Eight CSVs in test/data with row counts; drift check up to date; resolved db.data: development includes test/data, test and production do not.'),
    ('E-03', 'E-03_cap-server-startup-seed-loaded.jpg', 'Successful CAP server startup (npm start, development profile)',
     'In-memory SQLite, all eight test/data CSVs loaded ("init from"), AssemblyCatalog and EngineeringReview served on :4004, health 200.'),
    ('E-04', 'E-04_odata-seeded-records.jpg', 'OData responses showing seeded engineering data',
     'cviewer (plant 1000) sees EC-000473 only; analyst2000 (plant 2000) sees EC-200473 only; BOM B items, prices, $count per set (ImpactRuns 0 before any run); M03 Assemblies shows the labelled COOL-100.'),
    ('E-05', 'E-05_runimpact-oracle-result.jpg', 'Deterministic impact calculation for the approved oracle scenario',
     'runImpact on persisted EC-000473: 56.00 -> 68.00 EUR per assembly, +1200.00 EUR total (21.43 %), 2 materials short, 7 findings; second run has the same fingerprint.'),
    ('E-06a', 'E-06a_authorization-negative-checks.jpg', 'Authorization and negative tests (first pass)',
     '10 of 11 checks PASS. The DELETE ImpactRuns check shows FAIL (400) because of a harness error (empty run ID); kept unedited as evidence.'),
    ('E-06b', 'E-06b_authorization-recheck.jpg', 'Corrected re-check of the immutable-snapshot checks',
     'With the real run ID: DELETE 405 and PATCH 405 on ImpactRuns, run still present (200); development server stopped.'),
    ('E-07', 'E-07_bas-regression-gate.jpg', 'Final BAS regression results',
     'npm ci 0, lint 0, npm test 35/35 (0 fail), npm audit 0 vulnerabilities, build-seed --check up to date, no tracked changes after tests.'),
]
if GH.get('pr_screenshot'):
    SCREENSHOTS.append(('E-08', GH['pr_screenshot'], 'GitHub feature branch and draft pull request with CI status', GH['pr_screenshot_desc']))

# ---------------------------------------------------------------- content
S = []  # list of blocks: ('h1'|'h2'|'p'|'bullets'|'table'|'code'|'shot'|'pb', payload)
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
p('<b>Objective.</b> Complete a reproducible synthetic manufacturing dataset and make it available through the existing '
  'SAP CAP services (M04 Slice 1b), without starting P3 Project Accelerator generation or P4 UI work.')
p(f"<b>Status.</b> Implemented and verified in SAP Business Application Studio (BAS). Implementation commit "
  f"<font face='Mono'>{IMPL[:12]}</font> on <font face='Mono'>feat/m04-slice1b</font>. {ci_line}. "
  f"Draft pull request: {GH.get('pr_url') or 'not yet created'}. Not merged.")
bullets(
    'CAP development seed SEED-M04-01 in <font face="Mono">test/data</font>: COOL-100 / EC-000473 (DS-ORACLE-01, plant 1000) and a labelled plant-2000 mirror (EC-200473). 66 rows in 8 entities, all synthetic and traceable to versioned fixtures.',
    'Generator with deterministic keys and a drift test; the committed CSVs are byte-identical to generator output.',
    'Seed loads with <font face="Mono">npm start</font> (development); excluded from the test profile by configuration and never resolved in production (verified).',
    'runImpact on the persisted seed reproduces the independent DS-ORACLE-01 oracle; DS-DEMO-01 is verified through a persisted run in tests only (Decision A).',
    'Plant isolation, roles, authentication, read-only and malformed-input behaviour re-verified on seeded records.',
    'BAS: npm ci, lint, 35/35 tests and npm audit (0 vulnerabilities) all exit 0.')
p('<b>Remaining limitations.</b> No Fiori UI; no live S/4HANA data; no Joule; no BTP deployment, HANA persistence or '
  'xs-security role definitions; development credentials are public mock values. Synthetic data is not SAP data.')

h1('2. Starting state')
table([
    ['Item', 'Value'],
    ['GitHub baseline', f'main = {BASE[:12]} (M04 Slice 1a squash-merge, PR #3); CI passed (owner-reported, PR #3 CI run on ea53c4d verified earlier)'],
    ['BAS environment', 'SAP BTP trial, dev space ws-lecln, /home/user/projects/assemblyimpact-ai, synchronized to main (fast-forward)'],
    ['Runtime (BAS)', 'Node v24.21.0, npm 11.19.0, @sap/cds 10.2.2, @sap/cds-compiler 7.2.1, @cap-js/sqlite 3.1.2, eslint 9.39.5'],
    ['Architecture', 'CAP OData V4: AssemblyCatalog (M03) and EngineeringReview (M04 Slice 1a, read-only + runImpact action, ruleset 1.1.0)'],
    ['Original problem', 'Services started empty: the synthetic fixtures were usable by tests only; the development profile had no EngineeringReview users; nothing guarded production against test data.'],
], [40*mm, 130*mm])

h1('3. Implementation record')
units = [
    ('U1 Seed builder', 'test/m04-seed.js', 'Builds CAP rows from test/fixtures/m04 for each seed scenario; name-based UUID keys; mirror logic with evidence-reference prefix; CSV serialiser.', 'Single source of truth; reproducibility (D-1b-2, D-1b-5, D-1b-7).', 'E-02, drift test'),
    ('U2 Generator CLI', 'tools/m04/build-seed.mjs, tools/m04/README.md', 'Writes test/data/*.csv; --check exits 1 when out of date.', 'Regeneration without hand edits (D-1b-5).', 'E-02, E-07'),
    ('U3 Seed CSVs', 'test/data/assemblyimpact-*.csv (8), test/data/README.md', '66 synthetic rows with provenance; README documents origin and loading rules.', 'Requirement 2, 3, 5, 7 (D-1b-1, D-1b-3, D-1b-9).', 'E-02, E-03, E-04'),
    ('U4 Profile configuration', 'package.json', '[test] requires.db.data = db/data, db/csv; development users analyst, cviewer, analyst2000; npm test includes the new suite.', 'Keep existing suites isolated; demonstrable dev profile (D-1b-4, D-1b-8).', 'E-02, E-04'),
    ('U5 Verification suite', 'test/seed-data.test.js', '7 tests: drift, integrity, CAP loading and per-plant OData, oracle via persisted runImpact, auth/plant/input negatives, DS-DEMO-01 persisted run, production exclusion.', 'Requirements 6-12; quality gates.', 'E-07'),
    ('U6 Documentation', 'readme.md', 'Slice 1b section, development accounts, evidence statement with AI-assistance disclosure.', 'Traceability and truthful AI records.', '-'),
]
table([['Unit', 'Files', 'What', 'Why / decision', 'Evidence']] + [list(u) for u in units],
      [26*mm, 36*mm, 52*mm, 34*mm, 22*mm])
p('<b>Technical explanation.</b> CAP 10.2.2 resolves seed folders from <font face="Mono">cds.requires.db.data</font> '
  '(see <font face="Mono">lib/dbs/cds-deploy.js</font> in the installed package). The installed defaults are '
  '<font face="Mono">db/data, db/csv, test/data</font> for development and test, and <font face="Mono">db/data, db/csv</font> '
  'for production (HANA). The project overrides only the test profile, so the existing M03 and Slice 1a suites keep inserting '
  'their own rows into an empty in-memory database, while <font face="Mono">test/seed-data.test.js</font> opts in through '
  '<font face="Mono">CDS_CONFIG</font>. Impact runs are never seeded; they are produced by <font face="Mono">runImpact</font>, '
  'which needs the seeded <font face="Mono">ReviewCases.version</font> compare-and-set token.')
p('The full decision log (D-1b-1 to D-1b-9) is in <font face="Mono">docs/evidence/m04-slice1b/decisions.md</font>.')

h1('4. Dataset specification')
p('Dataset <b>SEED-M04-01</b> — fictional company NovaMotion Manufacturing. <b>Synthetic; not SAP S/4HANA data.</b> '
  'Source: <font face="Mono">test/fixtures/m04/DS-ORACLE-01</font> (v1.0.0, reference date 2026-11-08). Values marked '
  'PROPOSED in the data contract still need owner confirmation.')
table([
    ['Entity (CSV)', 'Plant 1000', 'Plant 2000 mirror', 'Total', 'Keys / relationships'],
    ['Assemblies', '1', '1', '2', 'COOL-100 per plant; description carries [SYNTHETIC ...]'],
    ['BOMStates', '2', '2', '4', 'BOM-COOL-100-A (rev A, 2026-01-01..2026-11-30, RELEASED), -B (rev B, from 2026-12-01, PROPOSED, EC-000473)'],
    ['BOMItems', '7', '7', '14', 'A: FAN-A 1, BRKT-01 2, SENS-01 1; B: FAN-B 1, BRKT-01 3, SENS-01 1, SEAL-01 1 (PC)'],
    ['CostPrices', '5', '5', '10', 'EUR, price unit 1 PC, SYNTHETIC_STANDARD_PRICE, valid 2026-01-01..9999-12-31'],
    ['StockSnapshots', '5', '5', '10', 'snapshot 2026-11-08T08:00:00Z; FAN-A 40, FAN-B 80, BRKT-01 250, SENS-01 120, SEAL-01 150'],
    ['Instructions', '3', '3', '6', 'WI-COOL-100-ASM v2 (rev A), v3 (rev B), WI-COOL-100-TST v2 (all revisions)'],
    ['InstructionReferences', '9', '9', '18', 'step -> material/quantity per instruction version'],
    ['ReviewCases', '1', '1', '2', 'EC-000473 / EC-200473: A -> B, production quantity 100, IN_REVIEW'],
    ['Total', '33', '33', '66', ''],
], [34*mm, 18*mm, 22*mm, 14*mm, 82*mm])
p('<b>Prices (EUR/PC):</b> FAN-A 35.00, FAN-B 42.00, BRKT-01 3.00, SENS-01 15.00, SEAL-01 2.00. '
  '<b>Expected result (oracle, ruleset 1.1.0, as of 2026-11-08):</b> cost per assembly 56.00 -> 68.00 (+12.00), total for 100 '
  'assemblies 5600.00 -> 6800.00 (+1200.00, +21.43 %); stock gaps BRKT-01 50 and FAN-B 20; comparison REPLACED / '
  'QUANTITY_CHANGED / UNCHANGED / ADDED; one outdated instruction reference (WI-COOL-100-TST step 0030 -> FAN-A); 7 findings (HIGH 3, MEDIUM 2, LOW 2).')
p('<b>Provenance:</b> every row with a sourceType is SYNTHETIC_FIXTURE and carries an evidence reference to its fixture row; '
  'mirror references start with <font face="Mono">PLANT-2000-MIRROR:</font>. <b>Not seeded:</b> PUMP-200 / DS-DEMO-01 '
  '(test-only, Decision A) and impact runs (always computed). <b>Limitations:</b> one scenario only; no historical revisions beyond A/B; '
  'no S/4HANA identifiers; data contract values marked PROPOSED await owner confirmation.')

h1('5. Testing and verification')
table([
    ['Command (BAS, E-07)', 'Exit', 'Observed'],
    ['npm ci', '0', 'found 0 vulnerabilities'],
    ['npm run lint', '0', 'eslint srv test --max-warnings=0'],
    ['npm test', '0', 'tests 35, pass 35, fail 0, cancelled 0, skipped 0'],
    ['npm audit --package-lock-only --audit-level=high', '0', 'found 0 vulnerabilities'],
    ['node tools/m04/build-seed.mjs --check', '0', 'test/data is up to date'],
    ['git status (after tests)', '-', '0 tracked changes; no untracked files outside the evidence folder'],
], [80*mm, 12*mm, 78*mm])
p('<b>New tests (test/seed-data.test.js), all passing locally (Node 24.22.2) and in BAS (Node 24.21.0):</b>')
table([
    ['Test', 'Expected', 'Observed'],
    ['CSVs equal generator output; generator deterministic', 'byte-identical', 'pass'],
    ['Referential and semantic integrity', 'unique keys, FKs, plant/assembly agreement, A ends before B, priced and stocked materials, EUR, labels, no PUMP-200', 'pass'],
    ['CAP loads test/data; per-plant OData', 'counts 1/2/7/5/5/3/9 per plant; plant 2000 sees EC-200473 only; M03 shows labelled COOL-100', 'pass'],
    ['runImpact on persisted seed vs DS-ORACLE-01', 'all oracle figures, lines and findings; same fingerprint on repeat', 'pass'],
    ['Auth/plant/input negatives on seed', '401, 404 cross-plant, 403 viewer/wildcard/malformed/M03 role, 400 bad date, 405 writes', 'pass'],
    ['DS-DEMO-01 via persisted runImpact (test-only)', 'DS-DEMO-01 expected results', 'pass'],
    ['Production never loads test/data', 'production db.data and resources exclude test/data; development includes 8 files', 'pass'],
], [56*mm, 84*mm, 30*mm])
p('<b>Failures and corrections.</b> (1) Mutation check: changing the seeded FAN-B price from 42.00 to 43.00 made the drift, oracle '
  'and price tests fail as intended; restored, all pass. (2) E-06a evidence harness reported 400 for DELETE ImpactRuns because the run '
  'ID variable was empty (subshell); re-run in E-06b returned 405 for DELETE and PATCH. No application code was changed for either.')
p('<b>Live checks in BAS (development profile, E-03 to E-06b):</b> 13 HTTP checks plus the oracle comparison; all pass after the E-06b correction.')

h1('6. Screenshot evidence')
p('Original, unedited screenshots of the BAS browser tab captured with Claude in Chrome. Times are UTC from the terminal clock. '
  'No secrets are visible (no credentials are printed; development passwords are public mock values).')
for eid, f, title, desc in SCREENSHOTS:
    S.append(('shot', (eid, f, title, desc)))

h1('7. Security and quality')
table([
    ['Area', 'Result', 'Evidence'],
    ['Authentication', 'Anonymous and wrong password -> 401; production profile still requires JWT (existing test)', 'E-06a, tests'],
    ['Role-based authorization', 'ChangeViewer cannot run (403); M03-only role has no M04 access (403); writes 405', 'E-06a/b, tests'],
    ['Plant isolation', 'Plant-2000 user sees only EC-200473 and 0 plant-1000 runs; cross-plant key and runImpact -> 404', 'E-04, E-06a, tests'],
    ['Malformed input', 'asOfDate "not-a-date" -> 400; unknown case -> 404; malformed/wildcard plant attributes -> 403', 'E-06a, tests'],
    ['Synthetic data containment', 'Production resolves only db/data and db/csv; automated test', 'E-02, tests'],
    ['Dependencies', 'No new packages; package-lock.json unchanged; npm audit 0 vulnerabilities', 'E-07'],
    ['Secrets', 'Diff scan: no keys/tokens/private keys; only public mock passwords in profile config', 'review'],
], [36*mm, 104*mm, 30*mm])
p('<b>Unresolved risks.</b> No xs-security.json / role templates (blocks BTP deployment, carried over from M03/Slice 1a); development '
  'mock passwords are public by design and must never be used in production; GitHub web squash-merges record "GitHub" as committer '
  '(owner rule: committer Naman Patel); the GitHub SSH key needs a passphrase or agent for non-interactive fetch/push.')
p('<b>Review disclosure.</b> Code review and quality assessment were performed by one AI system (Claude, Anthropic). No human or SAP reviewer took part.')

h1('8. GitHub traceability')
table([
    ['Item', 'Value', 'Status'],
    ['Branch', 'feat/m04-slice1b (from main eaf97f2)', 'verified'],
    ['Implementation commit', f'{IMPL} — feat(m04): seed synthetic development dataset (Slice 1b); author and committer Naman Patel <108478447+Naman028@users.noreply.github.com>; no co-author trailer', 'verified (BAS, E-01)'],
    ['Evidence commit', 'Adds docs/evidence/m04-slice1b (this report). Its SHA is recorded in the PR; a file cannot contain its own commit hash.', 'see PR'],
    ['Changed files (implementation)', '15 files, +518 / -9: package.json, readme.md, test/data/* (9), test/m04-seed.js, test/seed-data.test.js, tools/m04/build-seed.mjs, tools/m04/README.md', 'verified'],
    ['Pull request', GH.get('pr_url') or 'not created', GH.get('pr_status', 'pending')],
    ['CI', ci_line, 'verified' if GH.get('ci_conclusion') == 'success' else 'pending'],
    ['main', f'unchanged at {BASE[:12]}', GH.get('main_status', 'verified before push')],
], [34*mm, 106*mm, 30*mm])

h1('9. Four-project relevance')
table([
    ['Project', 'What this milestone contributes', 'Not claimed'],
    ['P1 Joule Skill & Agent', 'A seeded, authorized OData backend a future skill could call (read cases, run impact).', 'No Joule access or skill exists.'],
    ['P2 S/4HANA + GenAI', 'A clearly labelled synthetic baseline to compare against real S/4HANA data later; SourceType S4_IMPORT reserved.', 'No S/4HANA connection; synthetic data cannot replace it.'],
    ['P3 AI-assisted Fiori (Project Accelerator)', 'Real persisted records for the planned Case Worklist to display.', 'No Project Accelerator generation was run.'],
    ['P4 Fiori on BTP', 'Backend data and verified impact engine for the investigation app.', 'No UI and no BTP deployment.'],
], [38*mm, 82*mm, 50*mm])

h1('10. Remaining work')
bullets(
    'Owner review of D-1b-1 to D-1b-9 and confirmation of PROPOSED fixture values.',
    'Merge of the draft PR after review (separate approval).',
    'Next milestone (proposed): P3 Case Worklist via Project Accelerator in an isolated sandbox. Acceptance criteria: generation in pa-sandbox only; generated files identified; worklist lists the seeded review case(s) from EngineeringReview with plant isolation intact; every manual correction documented; existing 35 tests still pass.',
    'BTP readiness: xs-security.json with ChangeViewer/ChangeAnalyst role templates and plants attribute, HANA persistence, approuter/IdP, deployment approval.',
    'P2 blocker: authorized S/4HANA access. P1 blocker: Joule Studio entitlement.',
    'Tooling: SSH agent or key configuration in BAS for non-interactive Git; ESLint 9 follow-up from M03.')

pb()
h1('Appendix A — Traceability matrix')
table([
    ['Req.', 'Requirement (milestone brief)', 'Implementation', 'Test / evidence'],
    ['1', 'Inspect model, services, fixtures, config', 'Inspection (section 2)', 'E-01, E-02'],
    ['2-3', 'Consistent dataset reusing DS-ORACLE-01 / DS-DEMO-01', 'U1, U3; DS-DEMO-01 test-only (D-1b-1)', 'integrity + DS-DEMO-01 tests'],
    ['4', 'Preserve DS-NEG-01 coverage', 'Unchanged calculator tests', 'E-07 (35/35)'],
    ['5-6', 'test/data; verify data loading vs installed CAP', 'U3, U4 (D-1b-3, D-1b-4)', 'E-02, production test'],
    ['7', 'Mutually consistent keys, dates, units, currency', 'U1', 'integrity test'],
    ['8-9', 'Load into CAP; OData returns seeded records', 'U3, U4', 'E-03, E-04, loading test'],
    ['10', 'Deterministic runImpact from persisted data', 'existing engine on seed', 'E-05, oracle test'],
    ['11', 'M03 works; plant authorization preserved', 'mirror (D-1b-2)', 'E-04, E-06a/b, tests'],
    ['12', 'Production free of synthetic records', 'D-1b-3', 'E-02, production test'],
], [12*mm, 62*mm, 52*mm, 44*mm])
h1('Appendix B — Evidence manifest (screenshots)')
rows = [['ID', 'File', 'Captured (UTC)', 'SHA-256']]
for eid, f, *_ in SCREENSHOTS:
    rows.append([eid, f, TIMES.get(eid, GH.get('pr_screenshot_time', '')), sha(os.path.join(SHOTS, f))])
table(rows, [12*mm, 62*mm, 34*mm, 62*mm])
p('Logs captured in BAS (docs/evidence/m04-slice1b/logs, E-01 to E-07) are hashed in evidence-manifest.json, generated in BAS when the evidence was committed.')
h1('Appendix C — Key log excerpt (BAS, E-07)')
code('# E-07 BAS regression gate 2026-11-09T02:46:06Z  HEAD=68d6501 node=v24.21.0\n'
     'npm ci                         exit 0  (found 0 vulnerabilities)\n'
     'npm run lint                   exit 0\n'
     'npm test                       exit 0   tests 35  pass 35  fail 0  cancelled 0  skipped 0\n'
     'npm audit (high)               exit 0  (found 0 vulnerabilities)\n'
     'build-seed --check             exit 0  (test/data is up to date)\n'
     'tracked changes after tests: 0  untracked outside evidence: 0')
h1('Appendix D — References')
bullets(
    'SAP CAP (capire): Providing initial data — https://cap.cloud.sap/docs/guides/databases#providing-initial-data',
    'Installed source used for verification: node_modules/@sap/cds/lib/dbs/cds-deploy.js (deploy.resources), @sap/cds 10.2.2',
    'Project artifacts: docs/m04/M04_Data_Contract.md, test/fixtures/m04 (DS-ORACLE-01 v1.0.0, DS-DEMO-01 v1.0.1, DS-NEG-01 v1.1.0), M04 v1.2 decisions (Decision A)',
    'AI assistance: implementation, tests, evidence capture and this report were produced by Claude (Anthropic, model Claude Opus 5.5) under owner authorization; student review pending.')

# ---------------------------------------------------------------- markdown
def md_inline(t):
    import re
    t = re.sub(r"<font face='Mono'>(.*?)</font>|<font face=\"Mono\">(.*?)</font>", lambda m: '`' + (m.group(1) or m.group(2)) + '`', t)
    return t.replace('<b>', '**').replace('</b>', '**')
md = [f'# {TITLE}', '', f'Generated from `build_report.py`; PDF: `M04_Slice1b_Report.pdf`.', '']
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
        md += [f'**{eid} — {title}** ({TIMES.get(eid, GH.get("pr_screenshot_time", ""))} UTC)', '', f'![{eid}](screenshots/{f})', '', desc, '']
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
    'h1': ParagraphStyle('h1', fontName='Sans-Bold', fontSize=13.5, leading=17, spaceBefore=12, spaceAfter=6, textColor=colors.HexColor('#0a2540')),
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
         para('Synthetic dataset integration for the EngineeringReview CAP service', 'sub'), Spacer(1, 8*mm)]
cover = [['Repository', 'Naman028/assemblyimpact-ai'], ['Branch', 'feat/m04-slice1b'], ['Implementation commit', IMPL],
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
                                  para(f'{html.escape(desc)}<br/>Captured {TIMES.get(eid, GH.get("pr_screenshot_time", ""))} UTC · file screenshots/{f} · '
                                       f'SHA-256 {sha(path)[:16]}…', 'cap')]))

def decorate(c, doc):
    c.saveState(); c.setFont('Sans', 7.5); c.setFillColor(colors.HexColor('#666666'))
    c.drawString(20*mm, 10*mm, 'AssemblyImpact AI — M04 Slice 1b report · synthetic data · AI-generated, student review pending')
    c.drawRightString(190*mm, 10*mm, f'Page {doc.page}'); c.restoreState()
doc = BaseDocTemplate(os.path.join(OUT, 'M04_Slice1b_Report.pdf'), pagesize=A4, leftMargin=20*mm, rightMargin=20*mm,
                      topMargin=18*mm, bottomMargin=18*mm, title=TITLE, author='Claude (Anthropic) for Naman Patel',
                      subject='M04 Slice 1b evidence')
doc.addPageTemplates([PageTemplate(id='p', frames=[Frame(20*mm, 16*mm, 170*mm, 263*mm, id='f')], onPage=decorate)])
doc.build(flow)
print('ok', OUT)
