// AssemblyImpact AI - final project report (DOCX). Black/grey design, A4.
const fs = require('fs');
const path = require('path');
const { imageSize } = (() => { try { return require('image-size'); } catch { return { imageSize: null }; } })();
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell, WidthType, ShadingType,
  BorderStyle, ImageRun, PageBreak, Footer, Header, PageNumber, LevelFormat, TabStopType,
} = require('docx');

const FIG = '/home/claude/report/fig', IMG = '/home/claude/report/img';
const FONT = 'Arial';
const W = 9306; // content width in DXA (A4 11906 - 2 x 1300)
const GREY = 'D9D9D9', LIGHT = 'F2F2F2', DARK = '333333';
let figNo = 0, tabNo = 0;

// --- PNG/JPEG size without dependencies
function dims(file) {
  const b = fs.readFileSync(file);
  if (b[0] === 0x89) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), type: 'png' };
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xFF) { i++; continue; }
    const m = b[i + 1], len = b.readUInt16BE(i + 2);
    if (m >= 0xC0 && m <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(m)) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7), type: 'jpg' };
    i += 2 + len;
  }
  throw new Error('size ' + file);
}

const t = (text, o = {}) => new TextRun({ text, font: FONT, size: o.size ?? 21, bold: o.bold, italics: o.italics, color: o.color ?? '1A1A1A' });
// Inline **bold** support
function runs(s, o = {}) {
  return s.split(/(\*\*[^*]+\*\*)/).filter(Boolean).map(p => p.startsWith('**') ? t(p.slice(2, -2), { ...o, bold: true }) : t(p, o));
}
const P = (s, o = {}) => new Paragraph({ children: runs(s, o), spacing: { after: 120, line: 288 }, alignment: o.align ?? AlignmentType.JUSTIFIED });
const H1 = s => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: s, font: FONT })], pageBreakBefore: true });
const H2 = s => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: s, font: FONT })] });
const H3 = s => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun({ text: s, font: FONT })] });
const B = (s, level = 0) => new Paragraph({ numbering: { reference: 'bul', level }, children: runs(s), spacing: { after: 60, line: 276 } });
let numInst=0; const newList=()=>numInst++; const N = s => new Paragraph({ numbering: { reference: 'num', level: 0, instance: numInst }, children: runs(s), spacing: { after: 60, line: 276 } });
const caption = s => new Paragraph({ children: [t(s, { size: 18, italics: true, color: '4D4D4D' })], alignment: AlignmentType.CENTER, spacing: { before: 60, after: 200 } });

function figure(file, text, maxW = 600, maxH = 420) {
  const d = dims(file);
  let w = maxW, h = Math.round(d.h * w / d.w);
  if (h > maxH) { h = maxH; w = Math.round(d.w * h / d.h); }
  figNo++;
  return [
    new Paragraph({ alignment: AlignmentType.CENTER, keepNext: true, spacing: { before: 120, after: 40 },
      children: [new ImageRun({ type: d.type, data: fs.readFileSync(file), transformation: { width: w, height: h },
        altText: { title: `Figure ${figNo}`, description: text, name: path.basename(file) } })] }),
    caption(`Figure ${figNo}: ${text}`),
  ];
}

function table(head, rows, widths, title) {
  const total = widths.reduce((a, b) => a + b, 0);
  const scale = W / total; const cw = widths.map(x => Math.round(x * scale));
  cw[cw.length - 1] += W - cw.reduce((a, b) => a + b, 0);
  const border = { style: BorderStyle.SINGLE, size: 4, color: 'A6A6A6' };
  const borders = { top: border, bottom: border, left: border, right: border };
  const cell = (s, i, hdr) => new TableCell({ width: { size: cw[i], type: WidthType.DXA }, borders,
    shading: { fill: hdr ? GREY : 'FFFFFF', type: ShadingType.CLEAR, color: 'auto' },
    margins: { top: 50, bottom: 50, left: 90, right: 90 },
    children: String(s).split('\n').map(line => new Paragraph({ children: runs(line, { size: 17, bold: hdr }), spacing: { after: 0, line: 252 } })) });
  const out = [];
  if (title) { tabNo++; out.push(new Paragraph({ keepNext: true, spacing: { before: 160, after: 60 }, children: [t(`Table ${tabNo}: ${title}`, { size: 18, bold: true, color: DARK })] })); }
  out.push(new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: cw,
    rows: [new TableRow({ tableHeader: true, children: head.map((h, i) => cell(h, i, true)) }),
      ...rows.map(r => new TableRow({ cantSplit: true, children: r.map((c, i) => cell(c, i, false)) }))] }));
  out.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
  return out;
}
const box = (title, lines) => table([title], lines.map(l => [l]), [1]);

// ------------------------------------------------------------------ content
const body = [];
const add = (...xs) => xs.flat().forEach(x => body.push(x));

// Cover
add(
  new Paragraph({ spacing: { before: 2400, after: 200 }, children: [t('AssemblyImpact AI', { size: 60, bold: true })] }),
  new Paragraph({ spacing: { after: 120 }, children: [t('Engineering change impact analysis on SAP BTP', { size: 32, color: '4D4D4D' })] }),
  new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: '7F7F7F', space: 4 } }, spacing: { after: 400 }, children: [] }),
  P('Final Exam Projects P1-P4: SAP Joule Skills and AI Agents, Intelligent Business Process with SAP S/4HANA and Generative AI, SAP Fiori with SAP Business Application Studio and Generative AI, SAP Fiori on SAP BTP', { align: AlignmentType.LEFT }),
  new Paragraph({ spacing: { before: 600 }, children: [t('M.Sc. Applied Computer Science - SRH University Heidelberg, Campus Stuttgart', { size: 20 })] }),
  new Paragraph({ children: [t('Team members: ______________________________________________', { size: 20 })] }),
  new Paragraph({ children: [t('Submission: 12 November 2026', { size: 20 })] }),
  new Paragraph({ spacing: { before: 400 }, children: [t('Repository: github.com/Naman028/assemblyimpact-ai (main fa03c6d)', { size: 18, color: '4D4D4D' })] }),
  new Paragraph({ children: [t('Deployment: SAP BTP Cloud Foundry (US10 trial) with SAP HANA Cloud', { size: 18, color: '4D4D4D' })] }),
);

// Contents
add(new Paragraph({ pageBreakBefore: true, spacing: { after: 200 }, children: [t('Contents', { size: 32, bold: true })] }));
const toc = ['1  Executive summary', '2  Business problem and scenario', '3  Requirements and scope (P1-P4)', '4  Solution architecture and technology decisions',
  '5  Data model and impact calculation', '6  P4 - SAP Fiori application on SAP BTP', '7  P3 - Fiori app with BAS and Project Accelerator',
  '8  P2 - SAP S/4HANA integration and Generative AI', '9  P1 - Joule skills, AI agent and the in-app P1 Actions agent', '10  Review workflow and roles',
  '11  How Generative AI was used (mandatory documentation)', '12  Testing, evaluation and measurements', '13  Project execution and GitHub evidence',
  '14  Limitations and future work', '15  Conclusion', 'Appendix A  Evidence index', 'Appendix B  Demo script'];
toc.forEach(s => add(new Paragraph({ spacing: { after: 70 }, children: [t(s, { size: 21 })] })));

// 1
add(H1('1  Executive summary'),
  P('AssemblyImpact AI answers a question that manufacturing companies face every time an engineer proposes a change to an assembly: **what does this engineering change cost, which materials will run short, and which work instructions become wrong, before anyone approves it?** In practice this is answered with spreadsheets, copied bills of material (BOMs) and e-mail approvals. The result is slow, hard to audit and error-prone.'),
  P('The team designed and built one integrated application that covers all four exam projects with the same business scenario and the same data:'),
  B('**P4 - SAP Fiori on SAP BTP:** a launchpad with a Home page, a Case Worklist and an Investigation Studio, running on SAP BTP Cloud Foundry with SAP HANA Cloud, XSUAA sign-in and role-based access.'),
  B('**P3 - Fiori app with BAS and Generative AI:** the Case Worklist was generated with SAP Project Accelerator from the team\'s requirements and mockup, then connected to the real CAP service.'),
  B('**P2 - S/4HANA and Generative AI:** an ERP adapter with an S/4HANA OData contract (synthetic and sandbox modes) and a Google Gemini explanation of each impact run that is checked against the calculated figures before it is shown.'),
  B('**P1 - Joule skills and AI agent:** four Joule skills and an agent built in SAP Build Joule Studio (EU10), and an in-app "P1 Actions" agent with the same skills and SAP Build Actions that runs on the deployed application and can prepare changes that the user confirms.'),
  P('All impact figures are calculated by a deterministic CAP ruleset; Generative AI explains and assists but never calculates or decides. The final state was verified on the deployed system: 7 cases on SAP HANA Cloud, the reference case COOL-100 at **+1,200.00 EUR (+21.43 %), 2 materials short, 1 work instruction to update**, Gemini active, and 222 of 222 automated tests passing.'),
  ...table(['Area', 'Result', 'Evidence'], [
    ['P1', 'Joule skills + agent saved and validated (EU10); in-app agent live on BTP', 'Sections 9, 12'],
    ['P2', 'ERP adapter (S/4HANA contract, sandbox, synthetic); Gemini explanation with grounding check', 'Section 8'],
    ['P3', 'Project Accelerator generation + integrated Fiori elements worklist', 'Section 7'],
    ['P4', 'Deployed on BTP, HANA Cloud, XSUAA, three roles, review workflow', 'Sections 6, 10'],
    ['Quality', '222/222 tests, 0 mismatches against an independent oracle, API p50 about 134 ms', 'Section 12'],
    ['Open', 'EU10 destination for Joule, real S/4HANA system, second SAP account for approver on BTP', 'Section 14'],
  ], [1, 4, 1.6], 'Results at a glance'));

// 2
add(H1('2  Business problem and scenario'),
  P('The scenario is set in a fictional manufacturer, **NovaMotion Manufacturing**, plant 1000. All master data and cases are synthetic and labelled as such in the user interface; none of them comes from a real SAP S/4HANA system.'),
  H2('2.1 The problem'),
  P('An engineering change (EC) replaces revision A of an assembly with a proposed revision B: a component is replaced, a quantity changes, a part is added or removed. Before the change can be approved, three questions must be answered:'),
  N('**Cost:** how much more or less does one assembly cost, and what does this mean for the planned production quantity?'),
  N('**Material availability:** do we have enough stock of the new or increased components for the production quantity?'),
  N('**Work instructions:** which assembly or test instructions still refer to parts or quantities that revision B changes?'),
  P('A second person (the approver) must then decide, and the decision must be traceable. Typical problems are inconsistent spreadsheet calculations, stale stock figures, forgotten instruction updates and approvals by the same person who prepared the change.'),
  H2('2.2 Roles'),
  ...table(['Role', 'Tasks in the application', 'Restrictions'], [
    ['Change Analyst', 'Creates or imports a scenario, runs the impact calculation, edits demo inputs, plans consumption, submits for review', 'Cannot approve or reject; only own plant'],
    ['Change Approver', 'Reviews evidence and approves or rejects', 'Cannot approve a case they submitted; must acknowledge warnings'],
    ['Viewer', 'Reads cases, runs and decision history', 'No changes'],
  ], [1.2, 3, 2.2], 'Business roles'),
  H2('2.3 Reference cases'),
  P('The demo data set contains seven cases (COOL-100, GEAR-300, CTRL-400, VALVE-500, CONV-600, HYD-700, MOTOR-800). COOL-100 (EC-000473, "Replace cooling fan") is the reference case with an independently calculated expected result. For the live demonstration the team prepared an additional scenario, **PUMP-950 (EC-000501)**, which is imported during the exam (Appendix B).'));

// 3
add(H1('3  Requirements and scope (P1-P4)'),
  P('The exam asks for four projects. The team decided to implement them as **one end-to-end solution on one data model**, so that each project shows a different layer of the same process instead of four unrelated demos. Table 3 maps the exam requirements to the implementation.'),
  ...table(['Project', 'Exam requirement (summary)', 'How AssemblyImpact AI meets it', 'Status'], [
    ['P1', 'AI assistant with SAP Joule skills and agents; multi-step business task; connected to data or services', 'Four Joule skills + Engineering Assistant agent in SAP Build (EU10); same skills and Actions as an in-app agent with Gemini function calling; multi-step: look up, calculate, prepare change, confirm', 'Joule: built and validated; backend call needs EU10 destination. In-app agent: live on BTP'],
    ['P2', 'Intelligent process integrating S/4HANA with Joule or other GenAI; document GenAI use', 'ERP adapter with S/4HANA OData contract (synthetic, sandbox, s4 modes); Gemini explains impact runs with a grounding check', 'Adapter tested; no S/4HANA system available; Gemini live'],
    ['P3', 'Fiori app with BAS and Project Accelerator / GenAI; document generated parts', 'Case Worklist generated with Project Accelerator from team mockup; page structure reused; connected to CAP service', 'Done'],
    ['P4', 'Complete Fiori app on SAP BTP: requirements, UI design, backend, end-to-end demo', 'Launchpad, Worklist, Investigation Studio; CAP + HANA Cloud + XSUAA on BTP CF', 'Done, deployed'],
  ], [0.6, 2.2, 3.2, 1.6], 'Exam requirements and implementation'),
  H2('3.1 Non-functional requirements set by the team'),
  B('**Correct numbers:** exact decimal arithmetic, immutable calculation runs, independent oracle tests.'),
  B('**Security:** SAP BTP sign-in (XSUAA), role-based access, plant isolation (users only see their plants), separation of duties.'),
  B('**Honest AI:** AI never calculates or decides; AI answers are checked and withheld if they do not match the data.'),
  B('**Traceability:** every decision is stored with actor, time, comment and the run it was based on.'),
  B('**Usability:** works on desktop, tablet and 390 px phone width; clear status messages.'));

// 4
add(H1('4  Solution architecture and technology decisions'),
  ...figure(`${FIG}/arch.png`, 'System architecture: Fiori launchpad, app router with XSUAA, CAP service, SAP HANA Cloud and external AI/ERP services', 620, 400),
  P('The browser applications never talk to the database or to Gemini directly. Every request goes through the SAP BTP app router (sign-in with XSUAA) to one CAP service, **EngineeringReview**, which enforces roles and plant restrictions on every operation. SAP HANA Cloud stores all data. External services (Gemini, S/4HANA, SAP Build Joule) are only called from the backend.'),
  H2('4.1 Technology decisions and alternatives'),
  ...table(['Decision', 'Chosen', 'Alternatives considered', 'Why'], [
    ['Backend', 'SAP CAP (Node.js), OData V4', 'RAP on ABAP; plain Express', 'CAP is native to BTP, gives OData, @restrict authorization and HANA deployment with little code; ABAP environment not available in trial'],
    ['Database', 'SAP HANA Cloud (HDI)', 'PostgreSQL; SQLite only', 'Required SAP persistence on BTP; SQLite is used only for local development and tests'],
    ['UI', 'SAPUI5 1.149: Fiori elements (Worklist) + freestyle (Studio)', 'Only Fiori elements; React', 'Fiori elements for standard list/object pages (P3); freestyle for the interactive component diagram and AI chat (P4)'],
    ['Authentication', 'XSUAA + app router, role collections', 'SAP Cloud Identity only; mocked users', 'Standard BTP security; mocked users only in BAS for the three-role demo'],
    ['Generative AI (runtime)', 'Google Gemini API (gemini-3.5-flash-lite)', 'SAP Generative AI Hub; SAP Joule', 'Generative AI Hub is not available in the trial account; the exam allows external GenAI if SAP tools are unavailable; Flash-Lite is fast and inexpensive'],
    ['P1 agent', 'Joule Studio skills + in-app Node.js agent', 'Joule only', 'Joule cannot call the US10 backend without an EU10 destination (admin needed); the in-app agent keeps the same skills and Actions working end to end'],
    ['ERP', 'Adapter with S/4HANA OData contract; synthetic + API Hub sandbox', 'Direct S/4HANA system', 'No S/4HANA system or credentials available to the team'],
    ['Build/deploy', 'MTA (mbt build, cf deploy) from BAS', 'Manual cf push', 'One archive deploys services, HDI content and both apps consistently'],
  ], [1.2, 1.7, 1.7, 3.2], 'Technology decisions'),
  H2('4.2 Deployment'),
  ...figure(`${FIG}/deploy.png`, 'Delivery and deployment path: GitHub, BAS, MTA build and SAP BTP Cloud Foundry services', 620, 300),
  P('Code is reviewed in GitHub pull requests with automatic tests (GitHub Actions). The team builds the MTA archive in SAP Business Application Studio and deploys it with **cf deploy**. Deployments update the apps in place; services and HANA data are never deleted, and the Gemini key is kept across deployments (keep-existing environment).'));

// 5
add(H1('5  Data model and impact calculation'),
  ...figure(`${FIG}/model.png`, 'Core data model (CDS entities)', 620, 330),
  P('Assemblies have date-effective BOM states (revisions). A review case links the current and the proposed state and a production quantity. Prices and stock are stored per material and plant with validity dates. Every calculation creates a new **immutable ImpactRun** with its lines and findings; decisions are **insert-only** events. This makes every approval traceable to the exact evidence it was based on.'),
  H2('5.1 Impact ruleset'),
  ...figure(`${FIG}/calc.png`, 'Impact calculation pipeline (deterministic CAP ruleset 1.1.0)', 620, 220),
  B('**BOM comparison:** every item of revision A is matched with revision B and classified as added, removed, replaced, quantity changed or unchanged.'),
  B('**Cost:** per revision, quantity x standard price valid on the as-of date, summed per assembly. Delta total = (B - A) x production quantity. Exact decimal arithmetic, rounding half away from zero.'),
  B('**Stock:** required = quantity per assembly x production quantity, compared with the latest snapshot; a snapshot older than 7 days is marked stale.'),
  B('**Work instructions:** instruction steps that still reference a removed or changed part are reported as findings.'),
  B('**Status:** COMPLETE, COMPLETE_WITH_WARNINGS (e.g. stale stock) or INCOMPLETE (a missing price or stock record; the ruleset never guesses).'),
  H2('5.2 Worked example: COOL-100 (EC-000473)'),
  ...table(['Item', 'Revision A', 'Revision B', 'Change'], [
    ['0010 fan', 'FAN-A x 1', 'FAN-B x 1 (42.00 EUR)', 'Replaced'],
    ['0020 bracket', 'BRKT-01 x 2', 'BRKT-01 x 3', 'Quantity changed'],
    ['0030 seal', '-', 'SEAL-01 x 1', 'Added'],
    ['0040 sensor', 'SENS-01 x 1', 'SENS-01 x 1', 'Unchanged'],
    ['Cost per assembly', '56.00 EUR', '68.00 EUR', '+12.00 EUR'],
    ['Total for 100 assemblies', '', '', '**+1,200.00 EUR (+21.43 %)**'],
    ['Stock', '', 'BRKT-01 needs 300, has 250; FAN-B needs 100, has 80', '2 materials short'],
    ['Work instructions', '', 'WI-COOL-100-TST v2 step 0030 still runs FAN-A', '1 instruction to update'],
  ], [1.6, 1.4, 2.6, 1.6], 'COOL-100 impact (identical on the oracle, in BAS and on SAP HANA Cloud)'));

// 6
add(H1('6  P4 - SAP Fiori application on SAP BTP'),
  H2('6.1 UI design by the team'),
  P('The team started from its own concept mockups. Figure 5 shows the worklist concept the team drew for the case list: filters for assembly, plant, revision, status and source, and columns for findings, stock exposure, cost delta and review status. The same layout was later given to Project Accelerator (Section 7) and used as the acceptance reference for the implemented worklist.'),
  ...figure(`${IMG}/userImage.png`, 'Team concept mockup of the Engineering Change Worklist (design input)', 620, 160),
  H2('6.2 Applications in the launchpad'),
  ...table(['Application', 'Purpose', 'Main features'], [
    ['Home', 'Entry point and system status', 'Status of data source, database, P1 agent, AI and sign-in; KPIs; recent cases; switch user / sign out'],
    ['Engineering Change Worklist (P3)', 'Find and review cases', 'Fiori elements list report and object pages, Run Impact, plant-filtered'],
    ['Investigation Studio (P4)', 'Analyse one change', 'Component diagram, BOM comparison, materials, cost, consumption planning, P2 AI explanation, work instructions, findings, evidence images, review; floating P1 Actions agent'],
    ['Create / Import Scenario', 'Add synthetic cases', 'Form with assembly search, or JSON/CSV import with dry-run validation'],
  ], [1.6, 1.6, 3.6], 'Launchpad applications'),
  ...figure(`${IMG}/02-studio-bom-comparison.jpg`, 'Investigation Studio on BTP: BOM comparison of COOL-100', 560, 280),
  ...figure(`${IMG}/03-studio-materials-shortages.jpg`, 'Materials tab: required vs available stock, gaps and stale snapshots', 560, 280),
  ...figure(`${IMG}/UI-01-btp-cost-cards-not-clipped.jpg`, 'Cost tab on BTP (after the clipping fix found in user testing)', 480, 340),
  ...figure(`${IMG}/04-studio-consumption-planning.jpg`, 'Consumption Planning: projected stock per day with consumption rates', 560, 280),
  H2('6.3 Security'),
  B('XSUAA role templates: ChangeViewer, ChangeAnalyst, ChangeApprover, ImpactRunner, DemoDataImporter, ErpExtractor; role collections AssemblyImpact_Analyst / _Approver / _Viewer.'),
  B('Plant isolation by the XSUAA attribute **plants**: every entity has a CAP @restrict rule; foreign cases answer 404 so their existence is not revealed.'),
  B('Separation of duties in the backend: the submitter cannot approve; the approval must reference the latest run and acknowledge warnings.'),
  B('Secrets only in the BTP environment (Gemini key); never in the repository, logs or the browser.'),
  H2('6.4 Verified on the deployed system'),
  ...figure(`${IMG}/E10-01-worklist-hana-7-cases.jpg`, 'Deployed worklist on SAP HANA Cloud with seven cases', 520, 380));

// 7
add(H1('7  P3 - Fiori app with BAS and Project Accelerator'),
  P('P3 requires the use of Project Accelerator (Generative AI in SAP Business Application Studio) and a clear statement of which parts were generated. The team ran Project Accelerator in a separate sandbox so that its output could be preserved unchanged and compared.'),
  H2('7.1 Generation'), (newList(), []),
  N('Input: the team\'s requirements text for the Case Worklist and the concept mockup (Figure 5).'),
  N('Project Accelerator (SAP Fiori tools, CAP Accelerator flow) generated 44 files: a data model, a draft-enabled service, sample data and a List Report / Object Page app.'),
  N('The generated app was started and inspected in the browser.'),
  ...figure(`${IMG}/P3-02_pa-input-requirements-loaded.jpg`, 'Project Accelerator with the team requirements loaded', 520, 300),
  ...figure(`${IMG}/P3-08_generated-ui-list-report.jpg`, 'Generated list report running with its own invented sample data', 520, 300),
  H2('7.2 What was reused and what was changed'),
  ...table(['Generated part', 'Used?', 'Reason / team decision'], [
    ['Data model and service (own namespace, draft enabled)', 'No', 'Would duplicate the existing EngineeringReview service and bypass its role and plant checks; review data must not be editable as drafts'],
    ['Sample data (invented cases)', 'No', 'Figures must come from the calculation runs, not from generated rows'],
    ['List Report -> Object Page structure', '**Yes**', 'Reused as the page structure of app/case-worklist, bound to EngineeringReview'],
    ['Columns, filters, criticality', 'Adapted', 'Mapped to real fields (assembly, plant, revision, status, source; cost, shortages and findings from the latest run)'],
    ['Run Impact action', 'Added', 'Not generated; server-enforced bound action'],
  ], [2.4, 0.8, 3.6], 'Project Accelerator output and integration'),
  ...figure(`${IMG}/P3-12_runimpact-analyst-worklist-values.jpg`, 'Integrated worklist after Run Impact: +1,200.00 EUR, 2 short, 7 findings', 520, 300),
  P('Defects found only in the browser were fixed by the team: a UI5 startup error, a zero-height container and unsorted section tables. Plant isolation was verified with a plant-2000 user (cases of plant 1000 are invisible).'));

// 8
add(H1('8  P2 - SAP S/4HANA integration and Generative AI'),
  H2('8.1 ERP adapter'),
  P('P2 asks for interaction between Generative AI and SAP S/4HANA. The team had no access to an S/4HANA system. Instead of faking it, the team built a real **adapter with the S/4HANA OData contract** (material BOM, product valuation, stock) that maps ERP records into the same import validation as the demo scenarios. Three modes exist:'),
  ...table(['Mode', 'Source', 'Status'], [
    ['synthetic', 'Recorded S/4HANA-shaped OData responses (fixtures)', 'Tested, used in demo data'],
    ['sandbox', 'SAP Business Accelerator Hub sandbox (public demo data)', 'Implemented; labelled "not your ERP"'],
    ['s4', 'Customer S/4HANA via BTP destination', 'Implemented and tested against the contract; disabled in production (no system)'],
  ], [1, 3.4, 2.4], 'ERP adapter modes'),
  P('Imported records keep their source type (SYNTHETIC_FIXTURE, DEMO_IMPORT, SANDBOX_IMPORT, S4_IMPORT) and the Home page shows the provenance, so the application never presents demo data as ERP data.'),
  H2('8.2 Generative AI explanation (AI Explanation tab)'),
  P('For each impact run the backend sends **only the run\'s evidence** (figures, findings, shortages, BOM changes as numbered facts) to Gemini and asks for a structured explanation: summary, verified impact, shortage analysis, work-instruction implications, proposed next checks and warnings. The answer is then checked by CAP:'),
  B('Every number must occur in the evidence; every statement must cite a fact id (e.g. [RUN], [M1]).'),
  B('The direction of the cost change must match; a claim of "no shortages" when materials are short is rejected.'),
  B('No recommendation to approve or reject.'),
  P('If any check fails, the answer is **withheld** and the reason is shown (Table 9). This happened on the first live call (missing citation format) and led to a fix in PR #29. Only synthetic or demo data is sent to the external model.'),
  ...table(['Field', 'Recorded value (gemini-live-call-1.json)'], [
    ['Request', 'explainImpact() for EC-000473 (COOL-100) on the deployed BTP app (HANA Cloud, XSUAA)'],
    ['HTTP status / latency', '200 / 2.44 s'], ['Model', 'gemini-3.5-flash-lite (GOOGLE_GEMINI_API), 14 evidence facts'],
    ['Result', '**WITHHELD** - issue shortageAnalysis:NO_CITATIONS; other sections cited RUN and F1'],
    ['Effect', 'No AI text shown; CAP figures (+1,200.00 EUR, 2 short) unchanged'],
    ['Fix', 'PR #29: grouped citations such as [M1, M2] accepted, each id still checked'],
  ], [1.4, 4.6], 'First live Gemini call on BTP: the grounding check withheld the answer'),
  ...figure(`${IMG}/01-structured-fixture-answer.jpg`, 'Structured AI explanation sections in the Investigation Studio', 520, 280),
  H2('8.3 Why Gemini and not SAP Generative AI Hub'),
  P('SAP Generative AI Hub (SAP AI Core) is not included in the BTP trial. The provider interface therefore supports three modes: Gemini (used on BTP and optionally in BAS), Generative AI Hub (implemented, ready for a licensed account) and labelled fixture answers for tests. Switching provider is a configuration change.'));

// 9
add(H1('9  P1 - Joule skills, AI agent and the in-app P1 Actions agent'),
  H2('9.1 Joule skills and agent in SAP Build (EU10)'),
  P('The team modelled the assistant in SAP Build Joule Studio (classic edition) on the EU10 trial tenant. A SAP Build Actions project exposes the CAP operations as actions; four skills and one agent use them:'),
  ...table(['Joule skill', 'SAP Build Action(s)', 'Behaviour'], [
    ['Engineering Case Lookup', 'LookupEngineeringCases', 'Find cases by number, assembly or status (quoted inputs)'],
    ['Explain Case Impact', 'LookupEngineeringCases, GetEngineeringImpact', 'Status, cost delta (with "available" flag), shortages, findings'],
    ['Review Decision History', 'GetDecisionHistory', 'Recorded decisions of a case'],
    ['Run Engineering Impact', 'RunEngineeringImpact', 'Asks the user for confirmation before running'],
    ['Agent: Engineering Assistant', 'all four skills', 'Plans multi-step tasks, never approves or rejects'],
  ], [1.8, 2.2, 2.8], 'Joule skills and actions'),
  ...figure(`${IMG}/09-engineering-assistant-agent-saved.jpg`, 'Engineering Assistant agent in Joule Studio (saved, 0 errors)', 500, 320),
  ...figure(`${IMG}/10-agent-test-plans-lookup-then-impact.jpg`, 'Joule test: the agent plans "look up case, then fetch impact"', 500, 320),
  P('**Limitation:** Joule runs in the EU10 region, the backend in US10. Calling it requires a destination of type OAuth2SAMLBearerAssertion in the EU10 subaccount and a trust configuration in US10, which needs an EU10 subaccount administrator. The team prepared a step-by-step administrator handoff (p1/joule/ADMIN-HANDOFF-EU10-DESTINATION.md) but could not complete it in the trial. Other users\' destinations were deliberately not used.'),
  H2('9.2 In-app P1 Actions agent (alternative that works end to end)'),
  P('To demonstrate the multi-step agent on the real data, the team added the same skills inside the application: a floating **P1 Actions** button opens the agent. A Node.js agent in the CAP backend gives Gemini the skills as function declarations; Gemini decides which to call, the backend executes them **as the signed-in user**, and Gemini writes the answer.'),
  ...figure(`${FIG}/p1seq.png`, 'P1 agent flow: changes are prepared by the agent and executed only after the user confirms', 640, 300),
  ...table(['Request (example)', 'Skill -> Action', 'Executed on Confirm'], [
    ['"Run the impact for EC-000501"', 'Run Engineering Impact -> RunEngineeringImpact', 'runImpact'],
    ['"Set revision B quantity of item 0040 to 6"', 'Edit Input (extension)', 'reviseDemoInput'],
    ['"Add a consumption rate of 5 per week for IMP-950S ..."', 'Consumption rate (extension)', 'POST MaterialConsumptionRates'],
    ['Paste scenario file + "Import this scenario"', 'Import Scenario (extension)', 'importScenario (after dry run)'],
    ['"Submit EC-000501 for review ..."', 'Submit for Review (extension)', 'submitForReview'],
    ['Approver: "Approve EC-000501 ..."', 'Review Decision (extension)', 'approve / rejectCase'],
    ['"Show the decision history"', 'Review Decision History -> GetDecisionHistory', '(read only)'],
  ], [2.6, 2.4, 1.8], 'Agent requests and the CAP operations behind them'),
  P('**Safety design:** the model only chooses tools; every tool runs through the same @restrict rules as the UI; changes are proposals until Confirm; each answer is checked (numbers, case numbers, no decision advice, no "prepared" claim without a real proposal); at most 5 model requests and 8 tool calls per question; one retry on temporary Gemini errors.'),
  ...figure(`${IMG}/P1-02-node-agent-btp-live-cool100.jpg`, 'P1 agent live on BTP: COOL-100 explained from the HANA run, figures identical to the calculation', 480, 350),
  ...figure(`${IMG}/P1-05-analyst-flow-chat-scrolls.jpg`, 'Analyst flow in the agent: import, run, edit, rate, submit (only the conversation scrolls)', 520, 340),
  ...table(['#', 'Role', 'Result of the live run (BAS, Gemini)'], [
    ['1', 'Analyst', 'PUMP-950 imported as EC-000501'],
    ['2', 'Analyst', 'Run: 66.20 -> 84.10 EUR per pump, **+2,148.00 EUR (+27.04 %)**, IMP-950S short 30, SENS-950 short 20'],
    ['3-4', 'Analyst', 'Screws 8 -> 6, run again: **+2,100.00 EUR (+26.44 %)**'],
    ['5-6', 'Analyst', 'Consumption rate stored; case submitted (IN_REVIEW)'],
    ['7', 'Analyst', 'Approval attempt refused: only approvers decide'],
    ['8', 'Approver', 'Approved with comment'],
    ['9', 'Viewer', 'History: SUBMIT by analyst, APPROVE by approver, comments and times'],
  ], [0.4, 0.9, 5.4], 'End-to-end flow executed through the P1 agent (11 November 2026)'));

// 10
add(H1('10  Review workflow and roles'),
  ...figure(`${FIG}/review.png`, 'Review case states and who may change them', 600, 200),
  P('The workflow is enforced in the backend, not only by hiding buttons. Tests and the live run confirm: viewers and approvers cannot run calculations; analysts cannot approve; the submitter cannot approve their own case even with the approver role; approving a case that is not in review returns 409; a rejection needs a comment; an incomplete run can never be approved.'),
  P('**Multiple users:** in SAP Business Application Studio the team uses development users (Analyst, Approver, Viewer, Analyst of plant 2000) that can be switched on one page. On BTP every person signs in with their own SAP account; role collections are assigned in the BTP cockpit, and Home offers "Sign out / switch user".'),
  ...figure(`${IMG}/P1-06-viewer-history-after-approval.jpg`, 'Viewer reads the decision history after the approval', 520, 340));

// 11
add(H1('11  How Generative AI was used (mandatory documentation)'),
  P('The exam requires a step-by-step explanation of the Generative AI tools, stages, prompts, generated parts, integration, benefits and student corrections. The team distinguishes **AI used to build the solution** from **AI that is part of the solution**.'),
  ...table(['Tool', 'Type', 'Used for'], [
    ['SAP Project Accelerator (BAS)', 'SAP GenAI, development', 'P3: generated the worklist app structure from the team requirements and mockup'],
    ['Claude (Anthropic) as AI coding assistant', 'External GenAI, development', 'Drafted CAP code, UI5 views and controllers, tests, deployment configuration and documentation from the team\'s instructions; browser assistance in BAS, Joule Studio and the BTP cockpit under the team\'s supervision'],
    ['SAP Build Joule Studio', 'SAP GenAI, solution', 'P1: skills and agent definition (EU10)'],
    ['Google Gemini API', 'External GenAI, solution', 'P2 explanations and the P1 in-app agent at runtime'],
  ], [1.9, 1.5, 3.4], 'Generative AI tools'),
  H2('11.1 Division of work between team and AI'),
  P('**The team** chose the business scenario, wrote the requirements and acceptance criteria, drew the UI concept mockups and the component diagram idea, decided the architecture and the alternatives in Table 4, set up BTP, BAS, HANA Cloud, SAP Build and the Gemini key, operated the deployments, tested the application in the browser, reported defects, and approved and merged every pull request. **The AI coding assistant** turned these instructions and designs into code, tests and documents, ran the automated tests and proposed fixes. Nothing was merged without the team\'s approval in GitHub.'),
  H2('11.2 Stages and example instructions'),
  ...table(['Stage', 'Example instruction given by the team (abridged)', 'Output'], [
    ['Scenario and data', '"Build a synthetic manufacturing dataset for engineering changes with an independent oracle for the expected results."', 'Data sets DS-ORACLE-01, DS-SCENARIOS-01, oracle script, 16 negative cases'],
    ['P3 generation', 'Requirements text + team mockup given to Project Accelerator', '44 generated files (sandbox), page structure reused'],
    ['P4 UI', '"Unified landing page, Investigation Studio with component diagram, keep the case when switching apps."', 'Launchpad, Home, Studio'],
    ['P2', '"Explain the impact with Gemini but never let the AI calculate; withhold answers that do not match."', 'Grounded explanation with checks'],
    ['P1', '"Make an equivalent agent for the P1 Joule actions in Node.js with Gemini, connect it to the whole P2-P4 flow; it must be able to store changes like our Actions."', 'P1 Actions agent with confirm-before-save'],
    ['UI polish from testing', '"The cost values are clipped"; "only the chat should scroll, not the suggestions or the input"', 'CSS fixes, new dialog layout'],
  ], [1.2, 3.6, 2.0], 'Development stages and instructions'),
  H2('11.3 Corrections and validations by the team'),
  B('Browser testing found defects that the automated tests did not: clipped cost amounts, cached old UI after deploy, Gemini active on BTP but not in BAS, missing approver login, chat layout, an agent answer repeated from history without a real proposal.'),
  B('The team rejected generated parts that conflicted with the design (Project Accelerator draft service and invented data).'),
  B('The team verified every deployment on BTP and the figures against the oracle (Section 12).'),
  H2('11.4 Benefits and limitations'),
  ...table(['Benefits', 'Limitations'], [
    ['Fast delivery: 33 merged pull requests in four days (Section 13)', 'AI output still needs careful review; several defects were only visible in the browser'],
    ['Consistent tests and documentation for every change', 'Generated code can look correct but violate a design rule (e.g. generated draft service)'],
    ['Runtime GenAI makes the analysis understandable (P2) and the process conversational (P1)', 'Runtime models can be wrong or unavailable (HTTP 503); answers must be checked and the calculation must stay deterministic'],
  ], [1, 1], 'Benefits and limitations of Generative AI'));

// 12
add(H1('12  Testing, evaluation and measurements'),
  H2('12.1 Automated tests'),
  P('222 automated tests (Node.js test runner with CAP test server) pass in about 26 seconds; ESLint is clean; every pull request runs them in GitHub Actions (96 successful workflow runs). Tests cover the ruleset, services, authorization (403/404 by role and plant), review workflow, import validation, ERP adapter, Gemini provider (stubbed), the P1 agent, UI contracts and deployment configuration. No penetration test was performed.'),
  H2('12.2 Functional accuracy against an independent oracle'),
  ...table(['Check', 'Cases', 'Result'], [
    ['BOM classification', '17 lines', '17/17'], ['Quantities', '17 lines', '17/17'], ['Material shortages (status + gap)', '16 lines', '16/16'],
    ['Exact cost delta', '2 cases', '2/2 (COOL-100 +1,200.00; DS-DEMO-01 +2,902.50)'], ['Work-instruction findings', '2 cases', '2/2'],
    ['Incomplete data', '5 cases', '5/5 INCOMPLETE'], ['Warnings', '1 case', '1/1'], ['Invalid input rejected', '8 cases', '8/8'],
    ['Review authorization', '11 negative calls', '11/11 refused as designed'],
  ], [2.6, 1.4, 2.8], 'Accuracy (expected values from an independent oracle, not from the CAP code)'),
  H2('12.3 Performance on SAP BTP'),
  ...table(['Endpoint (30 sequential calls)', 'p50 ms', 'p95 ms'], [
    ['Case list (ReviewCases with count)', '133.5', '242.7'], ['Impact run read', '135.6', '145.7'], ['lookupCases (Joule contract)', '136.5', '158.2'], ['systemStatus', '121.7', '128.7'],
  ], [3.6, 1, 1], 'API latency measured from Germany to BTP US10 (includes network)'),
  P('Launchpad load: 1.76 s. Gemini explanation: 2.44 s for one call. P1 agent question: 2 model requests, about 2,900-5,600 tokens, typically 3-6 s.'),
  H2('12.4 Development effort estimate'),
  P('The team did not record its working hours, and no timed manual-versus-application comparison with users was carried out (marked **not measured**). To show the benefit of the AI-assisted approach, the team **estimated** the effort a team would need without AI assistance from the size of the delivered work in GitHub:'),
  ...table(['Input (from GitHub)', 'Value'], [
    ['Application code (srv, db, app, tools)', '10,462 lines in 78 files'], ['Automated tests', '7,505 lines in 75 files, 222 tests'],
    ['Delivered via', '33 merged pull requests, 31 commits on main'], ['Evidence', '218 files, 128 screenshots'],
    ['Assumed manual productivity (tested CAP/UI5 code incl. tests)', '150-300 lines per developer-day'],
    ['Estimated manual effort', '60-120 developer-days = 12-24 working days for 5 developers, 15-30 for 4'],
    ['Actual calendar time (first to last commit)', '4 days (8-11 November 2026)'],
  ], [3.4, 3.4], 'Effort estimate (an estimate, not a measurement)'),
  ...figure(`${FIG}/effort.png`, 'Estimated manual effort compared with the actual calendar time', 520, 200),
  P('The estimate does not include BTP, SAP Build and Joule configuration or the report, and the actual time includes the team\'s own work in parallel. It indicates a reduction of roughly **3-7x in calendar time**; it should be read as an order of magnitude, not as an exact saving.'));

// 13
add(H1('13  Project execution and GitHub evidence'),
  ...figure(`${FIG}/prs_per_day.png`, 'Merged pull requests per day', 520, 210),
  ...table(['Phase', 'Pull requests', 'Content'], [
    ['Foundation (8-9 Nov)', '#2-#9', 'CAP domain model, assembly catalog, impact engine, synthetic data, P3 worklist, P1 Actions spec, Run Impact UI, component diagrams'],
    ['Release candidate (9 Nov)', '#12-#17', 'Integrated workspace, scenarios and import, S/4HANA adapter, Joule design, BTP configuration (HANA, XSUAA, MTA)'],
    ['Demo and deployment (10 Nov)', '#18-#27', 'Launchpad, scenario form, controlled edits, BTP deployment, Gemini provider, phone layout, Joule skills and agent'],
    ['Final (11 Nov)', '#28-#36', 'Gemini key kept on deploy, grounding fix, evidence, P1 in-app agent with actions, UI polish, sign out / switch user'],
  ], [1.6, 1.0, 4.2], 'Delivery phases'),
  P('Every change went through a pull request with automated tests; the team merged after review. Deployments to BTP were run from BAS after the merge, and each was verified on the deployed system. The evidence folder (docs/evidence) contains screenshots, measurement data (CSV/JSON) and test results for every phase.'));

// 14
add(H1('14  Limitations and future work'),
  ...table(['Limitation', 'Impact', 'Next step'], [
    ['No SAP S/4HANA system', 'P2 shows the adapter with synthetic and sandbox data, not a live ERP', 'Connect a BTP destination to an S/4HANA system; the s4 mode is ready'],
    ['Joule (EU10) cannot call the US10 backend', 'Joule skills validated, but no backend response in Joule', 'EU10 admin creates the SAML bearer destination (handoff document); the in-app agent covers the same skills meanwhile'],
    ['One SAP account on the trial', 'Approver demo on BTP needs a second account', 'Assign AssemblyImpact_Approver to a team member\'s SAP account'],
    ['Manual vs application time not measured', 'Business benefit is argued, not measured', 'Timed study with 3 scenarios and real users'],
    ['Gemini free-tier quotas', 'Rate limits (HTTP 429) under heavy use', 'Paid tier or SAP Generative AI Hub'],
  ], [2, 2.4, 2.4], 'Limitations'));

// 15
add(H1('15  Conclusion'),
  P('AssemblyImpact AI shows one engineering-change process across all four projects: the team\'s designs became a Fiori application on SAP BTP with SAP HANA Cloud (P4), its worklist was generated with Project Accelerator and integrated (P3), the process is connected to an S/4HANA-shaped data source and explained by Generative AI under strict checks (P2), and a Joule-style agent with the same skills performs the multi-step task from question to confirmed change (P1).'),
  P('The most important design principle was to keep **calculations deterministic and decisions human**, and to use Generative AI where it helps: understanding results, guiding users and accelerating development. Open items (S/4HANA system, EU10 destination, second user, measured business study) are documented with concrete next steps.'));

// Appendix A
add(H1('Appendix A  Evidence index'),
  ...table(['Folder (docs/evidence)', 'Content'], [
    ['final-2026-11-11', 'HANA read-only check, three-role E2E, measurements (CSV/JSON), Gemini live call, P1 agent BAS and BTP runs, requirements reconciliation, demo checklist'],
    ['p1-eu10-2026-11-10', 'Joule Studio skills, agent, tests (13 screenshots)'],
    ['p2-gemini-ui', 'AI Explanation UI'],
    ['p3-case-worklist', 'Project Accelerator input, generation, generated files, integration and tests (24 screenshots)'],
    ['deployed-0c9c961', 'First BTP deployment: Studio tabs'],
    ['faculty-demo', 'Launchpad, scenario form, import, run, edit, approve'],
    ['m04-slice1b, m05, rc1-browser-check, ui-landing-startup, worklist-narrow-screen', 'Milestone reports and browser checks'],
  ], [2.2, 4.6], 'Evidence folders'),
  P('Other documents: docs/DEMO-RUNBOOK.md (start-up and demo), p1/joule/ADMIN-HANDOFF-EU10-DESTINATION.md, p1/node-agent/README.md, docs/p2/genai-provider.md, docs/btp/*.'));

// Appendix B
add(H1('Appendix B  Demo script (25 minutes)'),
  ...table(['Min', 'Step', 'Expected'], [
    ['0-2', 'BTP Home: status tiles', 'HANA Cloud, P1 agent ready, Google Gemini, SAP BTP sign-in'],
    ['2-6', 'Studio, EC-000473 COOL-100: BOM, materials, cost, planning, instructions', '+1,200.00 EUR, BRKT-01 short 50, FAN-B short 20, 1 instruction'],
    ['6-8', 'AI Explanation tab (P2)', 'Grounded sections or withheld with reason'],
    ['8-14', 'P1 Actions: import PUMP-950, run impact', '+2,148.00 EUR (+27.04 %), 2 short'],
    ['14-17', 'Edit item 0040 to 6, run again', '+2,100.00 EUR'],
    ['17-19', 'Add consumption rate IMP-950S 5/week', 'Rate in Consumption Planning'],
    ['19-21', 'Submit for review', 'IN_REVIEW; analyst cannot approve'],
    ['21-24', 'Approver approves (second account or BAS)', 'APPROVED'],
    ['24-25', 'Viewer: decision history', 'SUBMIT and APPROVE with comments'],
  ], [0.6, 3.2, 3.0], 'Demo script'),
  P('Start-up (12:15): HANA Cloud running, both CF apps started, sign in, check Home; BAS: npm run dev:gemini for the three-role part. The PUMP-950 import is done only once on BTP.'));

// ------------------------------------------------------------------ document
const doc = new Document({
  creator: 'AssemblyImpact AI team', title: 'AssemblyImpact AI - Final Project Report',
  styles: {
    default: { document: { run: { font: FONT, size: 21 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { font: FONT, size: 32, bold: true, color: '1A1A1A' }, paragraph: { spacing: { before: 0, after: 200 }, keepNext: true, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { font: FONT, size: 25, bold: true, color: '333333' }, paragraph: { spacing: { before: 240, after: 100 }, keepNext: true, outlineLevel: 1 } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { font: FONT, size: 22, bold: true, color: '4D4D4D' }, paragraph: { spacing: { before: 180, after: 80 }, keepNext: true, outlineLevel: 2 } },
    ],
  },
  numbering: { config: [
    { reference: 'bul', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 260 } } } },
      { level: 1, format: LevelFormat.BULLET, text: '–', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 260 } } } }] },
    { reference: 'num', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 300 } } } }] },
  ] },
  sections: [{
    properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1300, bottom: 1200, left: 1300, right: 1300 } } },
    headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [t('AssemblyImpact AI - Final Project Report', { size: 16, color: '7F7F7F' })] })] }) },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16, color: '7F7F7F' })] })] }) },
    children: body,
  }],
});
Packer.toBuffer(doc).then(b => { fs.writeFileSync('/home/claude/report/AssemblyImpact_AI_Final_Report.docx', b); console.log('ok', figNo, 'figures', tabNo, 'tables'); });
