using { assemblyimpact as db } from '../db/engineering';

// M04 Slice 1a: read-only engineering-change data plus one write action (runImpact).
// M04 Slice 2a: review decisions (submitForReview, approve, reject) with an insert-only history.
// Every exposed entity carries its own plant rule: CAP does not propagate a
// root entity's restriction to entities reached directly or via navigation.
@path: 'engineering-review'
// M05: room for a 512 KB import file (validated by the handler) plus JSON escaping.
@cds.server.body_parser.limit: '1mb'
@requires: 'authenticated-user'
service EngineeringReview {

    // Virtual availability flags are computed per user after READ: they cannot be filtered or sorted.
    @Capabilities.FilterRestrictions.NonFilterableProperties: [canRunImpact, canSubmit, canDecide, submittedBy]
    @Capabilities.SortRestrictions.NonSortableProperties: [canRunImpact, canSubmit, canDecide, submittedBy]
    @readonly
    @restrict: [
        { grant: 'READ', to: ['ChangeViewer', 'ChangeAnalyst', 'ChangeApprover'], where: 'plant = $user.plants' },
        // Instance check for the action is done in the handler (404 for foreign/missing cases, as in M03).
        { grant: 'runImpact', to: ['ChangeAnalyst', 'ImpactRunner'] },
        // P1: ImpactRunner = run the deterministic calculation only (Joule assistant); no submit/approve/reject,
        // no import. Combined with ChangeViewer for reading. Plant isolation applies unchanged.
        // M04 Slice 2a: review decisions. Plant, state and separation-of-duties checks are in the handler.
        // P2: evidence-grounded GenAI explanation of the latest run (read-only; plant check in the handler).
        { grant: 'explainImpact', to: ['ChangeViewer', 'ChangeAnalyst', 'ChangeApprover'] },
        { grant: 'submitForReview', to: 'ChangeAnalyst' },
        // Faculty demo: controlled edit of synthetic inputs (feature flag, OPEN synthetic cases only; checks in the handler).
        { grant: 'reviseDemoInput', to: 'DemoDataImporter' },
        { grant: ['approve', 'rejectCase'], to: 'ChangeApprover' },
        // Planning view (read-only; plant check in the handler, 404 for foreign cases).
        { grant: 'materialCoverage', to: ['ChangeViewer', 'ChangeAnalyst', 'ChangeApprover'] }
    ]
    entity ReviewCases as projection on db.ReviewCases {
        key ID, caseNumber, title,
        assembly.assemblyCode as assemblyCode,
        plant,
        fromState.revision as fromRevision,
        toState.revision as toRevision,
        productionQuantity, status, owner, sourceType, evidenceRef,
        // M05: display labels for code values (read-only, computed on read; codes stay the contract).
        case status when 'OPEN' then 'Open' when 'IN_REVIEW' then 'In Review'
            when 'APPROVED' then 'Approved' when 'REJECTED' then 'Rejected' else status end as statusText : String(20),
        case sourceType when 'SYNTHETIC_FIXTURE' then 'Synthetic Fixture' when 'MANUAL' then 'Manual'
            when 'GENAI_PROPOSAL' then 'GenAI Proposal' when 'S4_IMPORT' then 'S/4HANA Import'
            when 'DEMO_IMPORT' then 'Demo Import' when 'SANDBOX_IMPORT' then 'API Sandbox Import' else sourceType end as sourceTypeText : String(30),
        assembly.description as assemblyDescription : String(160),
        createdAt, modifiedAt,
        latestRun, runs, decisions, sourceImport, attachments,
        // M05: BOM states of the case for the Investigation Studio (plant-restricted entity below).
        fromState, toState,
        // M05: per-user action availability for the UI (role + plant + status + separation of duties).
        // Filled in srv/engineering-review.js after READ. Advisory only: every action re-checks on the server.
        virtual canRunImpact : Boolean,
        virtual canSubmit    : Boolean,
        virtual canDecide    : Boolean,
        virtual submittedBy  : String(255),
        // Why an action is not available to the signed-in user (role, status, separation of duties, missing
        // evidence); null when it is available. Advisory only, like the flags above.
        virtual runImpactHint : String(200),
        virtual submitHint    : String(200),
        virtual decideHint    : String(200)
    } actions {
        // Planning view, separate from the impact result: projects stock per day for the materials of the
        // proposed BOM under the stored consumption rates (lib/coverage.js). Read-only; nothing is persisted.
        function materialCoverage(startDate : Date @mandatory, horizonDays : Integer @mandatory) returns many MaterialCoverage;
        action runImpact(asOfDate : Date) returns ImpactRuns;
        // P2: explains the latest persisted run with SAP Generative AI Hub; answers are validated against the run's
        // evidence (citations, numbers) and withheld when ungrounded. 409 when no run exists or no provider is configured.
        function explainImpact() returns ImpactExplanation;
        // Faculty demo (development/test only, cds.env.features.demo_import): change one synthetic input of an OPEN
        // DEMO_IMPORT/SYNTHETIC_FIXTURE case. kind: PROPOSED_QUANTITY (itemNo of the proposed BOM), PRICE (material),
        // STOCK (material; appends a new snapshot). Earlier runs stay unchanged; latestRun is cleared so the next
        // decision needs a new calculation. Every edit is recorded in DataImports (format 'edit').
        action reviseDemoInput(kind : String(20) @mandatory, itemNo : String(4), material : String(40), value : Decimal(15, 4) @mandatory) returns ReviewCases;
        action submitForReview(comment : String(1000)) returns ReviewCases;
        // basedOnRun: the impact run the reviewer evaluated; must be the case's latest run (else 409 STALE_EVIDENCE).
        // acknowledgeWarnings (M05): required true when basedOnRun has status COMPLETE_WITH_WARNINGS; recorded on the event.
        // Runs with status INCOMPLETE can never be approved (409 EVIDENCE_INCOMPLETE).
        action approve(comment : String(1000), basedOnRun : UUID @mandatory, acknowledgeWarnings : Boolean) returns ReviewCases;
        // Named rejectCase, not reject: an action called reject shadows ApplicationService.reject() (CAP startup warning).
        action rejectCase(comment : String(1000) @mandatory, basedOnRun : UUID) returns ReviewCases;
    };

    // Supporting images per case. Read in the user's plants; analysts attach and remove them while the case is
    // undecided (plant, status, size and file signature are checked in the handler).
    @restrict: [
        { grant: 'READ', to: ['ChangeViewer', 'ChangeAnalyst', 'ChangeApprover'], where: 'reviewCase.plant = $user.plants' },
        { grant: ['CREATE', 'UPDATE', 'DELETE'], to: 'ChangeAnalyst' }
    ]
    entity CaseAttachments as projection on db.CaseAttachments;

    // M05: imports are visible to everyone in the plant (provenance); written only by importScenario.
    @readonly
    @restrict: [{ grant: 'READ', to: ['ChangeViewer', 'ChangeAnalyst', 'ChangeApprover', 'DemoDataImporter'], where: 'plant = $user.plants' }]
    entity DataImports as projection on db.DataImports;

    type ImportMessage { line : String(40); field : String(40); code : String(60); message : String(300); }
    type ImportPreviewCase { caseNumber : String(20); title : String(160); assemblyCode : String(40); plant : String(4);
        fromRevision : String(10); toRevision : String(10); productionQuantity : Integer; fromItems : Integer; toItems : Integer; }
    type ImportResult {
        importId : UUID; dryRun : Boolean; accepted : Boolean; plant : String(4); checksum : String(71);
        counts : String(500); errors : many ImportMessage; preview : many ImportPreviewCase; caseIds : many UUID;
    }
    // M05: controlled demo-data import. dryRun=true validates and previews without writing; dryRun=false
    // re-validates and commits all records in one transaction (all or nothing). Development/test only:
    // disabled unless cds.env.features.demo_import is set (never in production). Plant-checked per record.
    @(requires: 'DemoDataImporter')
    action importScenario(fileName : String(120), format : String(8) @mandatory, content : LargeString @mandatory, dryRun : Boolean) returns ImportResult;

    // P2: extract one engineering change (two date-effective BOM states, stock, standard prices) from an ERP
    // source and import it through the same validation as importScenario. mode: synthetic | sandbox | s4.
    // Unconfigured modes are refused (409 ERP_NOT_CONFIGURED); sandbox/synthetic data is never labelled S4_IMPORT.
    @(requires: 'ErpExtractor')
    action extractFromErp(mode : String(10) @mandatory, material : String(40) @mandatory, plant : String(4) @mandatory,
        bomUsage : String(1), alternative : String(2), fromDate : Date @mandatory, toDate : Date @mandatory,
        changeNumber : String(20), caseNumber : String(20) @mandatory, title : String(160) @mandatory,
        productionQuantity : Integer @mandatory, dryRun : Boolean) returns ImportResult;

    // Planning input: consumption rates per material and plant (rules in lib/coverage.js). Analysts maintain them;
    // validation (negative values, periods, overlapping validity) is done in the handler.
    @restrict: [
        { grant: 'READ', to: ['ChangeViewer', 'ChangeAnalyst', 'ChangeApprover'], where: 'plant = $user.plants' },
        { grant: ['CREATE', 'UPDATE', 'DELETE'], to: 'ChangeAnalyst', where: 'plant = $user.plants' }
    ]
    entity MaterialConsumptionRates as projection on db.MaterialConsumptionRates;

    type MaterialCoverage {
        material : String(40); unit : String(3); status : String(14); // COVERED | SHORTAGE | NO_STOCK | UNIT_MISMATCH
        startDate : Date; endDate : Date; effectiveDate : Date; caseRequirement : Decimal(17, 3); requirementInHorizon : Boolean;
        openingStock : Decimal(17, 3); stockSnapshotAt : Timestamp; dailyRateAtStart : Decimal(17, 3);
        expectedDemand : Decimal(17, 3); projectedEndStock : Decimal(17, 3); shortageAtEnd : Decimal(17, 3);
        coveredDays : Integer; exhaustionDate : Date; noRateDays : Integer;
    }

    // Case creation helpers: existing assemblies in the caller's plants (search by code or description) and the
    // next free case number. Read-only; the import still re-checks everything.
    type AssemblyHit { assemblyCode : String(40); plant : String(4); description : String(160); revisions : String(200); cases : Integer; }
    @(requires: ['ChangeViewer', 'ChangeAnalyst', 'ChangeApprover', 'DemoDataImporter'])
    function searchAssemblies(term : String(40)) returns many AssemblyHit;
    @(requires: 'DemoDataImporter')
    function nextCaseNumber() returns String(20);

    // M05: global UI capabilities of the signed-in user (no data access).
    type Capabilities { canImport : Boolean; canMaintainRates : Boolean; }
    function myCapabilities() returns Capabilities;

    // Landing page: configured integration modes of this deployment (no data, no secrets).
    // dataSourceMode: MOCK | SANDBOX | S4HANA | NONE; genaiMode: FIXTURE | GENAI_HUB | NOT_CONFIGURED;
    // jouleStatus: NOT_CONNECTED | CONFIGURED; authMode: DEVELOPMENT | PRODUCTION.
    type SystemStatus { dataSourceMode : String(10); genaiMode : String(16); jouleStatus : String(16); demoImport : Boolean; authMode : String(12); }
    @(requires: ['ChangeViewer', 'ChangeAnalyst', 'ChangeApprover'])
    function systemStatus() returns SystemStatus;

    // ---- P1: read-only case lookup for Joule (ported from PR #11, without its technical identity) ----
    // Named parameters, so a skill maps its inputs directly instead of building an OData $filter string.
    // Runs as the signed-in user (principal propagation): business read roles only, caller's plants only.
    type ImpactExplanation {
        runID        : UUID;
        caseNumber   : String(20);
        status       : String(12);   // GROUNDED | WITHHELD
        text         : LargeString;  // null when WITHHELD
        issues       : String(1000); // validation findings, ';'-separated
        citations    : String(500);  // fact ids cited by the answer
        generatedBy  : String(30);   // SAP_GENAI_HUB | FIXTURE_LLM_RESPONSE
        model        : String(100);
        promptSha256 : String(64);
        factCount    : Integer;
        generatedAt  : Timestamp;
    }
    type CaseSummary {
        ID                  : UUID;
        caseNumber          : String(20);
        title               : String(160);
        assemblyCode        : String(40);
        plant               : String(4);
        fromRevision        : String(10);
        toRevision          : String(10);
        status              : String(12);
        statusText          : String(20);
        sourceType          : String(20);
        latestRun_ID        : UUID;
        latestRunStatus     : String(24);
        latestRunAsOf       : Date;
        costDeltaTotal      : Decimal(17, 2);
        currency            : String(3);
        materialsShort      : Integer;
        instructionFindings : Integer;
    }
    @restrict: [{ to: ['ChangeViewer', 'ChangeAnalyst', 'ChangeApprover'] }]
    function lookupCases(caseNumber : String(20), status : String(12), assemblyCode : String(40)) returns many CaseSummary;

    // Decision history: read-only to every client, written only by the three review actions.
    @readonly
    @restrict: [{ grant: 'READ', to: ['ChangeViewer', 'ChangeAnalyst', 'ChangeApprover'], where: 'reviewCase.plant = $user.plants' }]
    entity DecisionEvents as projection on db.DecisionEvents;

    @readonly
    @restrict: [{ grant: 'READ', to: ['ChangeViewer', 'ChangeAnalyst', 'ChangeApprover'], where: 'reviewCase.plant = $user.plants' }]
    entity ImpactRuns as projection on db.ImpactRuns {
        *,
        // M05: readable run status (codes stay the contract).
        case status when 'COMPLETE' then 'Complete' when 'COMPLETE_WITH_WARNINGS' then 'Complete with warnings'
            when 'INCOMPLETE' then 'Incomplete' else status end as statusText : String(30)
    };

    @readonly
    @restrict: [{ grant: 'READ', to: ['ChangeViewer', 'ChangeAnalyst', 'ChangeApprover'], where: 'run.reviewCase.plant = $user.plants' }]
    entity ImpactComparisonLines as projection on db.ImpactComparisonLines;

    @readonly
    @restrict: [{ grant: 'READ', to: ['ChangeViewer', 'ChangeAnalyst', 'ChangeApprover'], where: 'run.reviewCase.plant = $user.plants' }]
    entity ImpactMaterialLines as projection on db.ImpactMaterialLines;

    @readonly
    @restrict: [{ grant: 'READ', to: ['ChangeViewer', 'ChangeAnalyst', 'ChangeApprover'], where: 'run.reviewCase.plant = $user.plants' }]
    entity Findings as projection on db.Findings;

    @readonly
    @restrict: [{ grant: 'READ', to: ['ChangeViewer', 'ChangeAnalyst', 'ChangeApprover'], where: 'plant = $user.plants' }]
    entity BOMStates as projection on db.BOMStates excluding { assembly };

    @readonly
    @restrict: [{ grant: 'READ', to: ['ChangeViewer', 'ChangeAnalyst', 'ChangeApprover'], where: 'bomState.plant = $user.plants' }]
    entity BOMItems as projection on db.BOMItems;

    @readonly
    @restrict: [{ grant: 'READ', to: ['ChangeViewer', 'ChangeAnalyst', 'ChangeApprover'], where: 'plant = $user.plants' }]
    entity CostPrices as projection on db.CostPrices;

    @readonly
    @restrict: [{ grant: 'READ', to: ['ChangeViewer', 'ChangeAnalyst', 'ChangeApprover'], where: 'plant = $user.plants' }]
    entity StockSnapshots as projection on db.StockSnapshots;

    @readonly
    @restrict: [{ grant: 'READ', to: ['ChangeViewer', 'ChangeAnalyst', 'ChangeApprover'], where: 'plant = $user.plants' }]
    entity Instructions as projection on db.Instructions { *, assembly.assemblyCode as assemblyCode } excluding { assembly };

    @readonly
    @restrict: [{ grant: 'READ', to: ['ChangeViewer', 'ChangeAnalyst', 'ChangeApprover'], where: 'instruction.plant = $user.plants' }]
    entity InstructionReferences as projection on db.InstructionReferences;
}
