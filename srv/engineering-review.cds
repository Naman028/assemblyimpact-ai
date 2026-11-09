using { assemblyimpact as db } from '../db/engineering';

// M04 Slice 1a: read-only engineering-change data plus one write action (runImpact).
// M04 Slice 2a: review decisions (submitForReview, approve, reject) with an insert-only history.
// Every exposed entity carries its own plant rule: CAP does not propagate a
// root entity's restriction to entities reached directly or via navigation.
@path: 'engineering-review'
@requires: 'authenticated-user'
service EngineeringReview {

    @readonly
    @restrict: [
        { grant: 'READ', to: ['ChangeViewer', 'ChangeAnalyst', 'ChangeApprover', 'JouleReader'], where: 'plant = $user.plants' },
        // Instance check for the action is done in the handler (404 for foreign/missing cases, as in M03).
        { grant: 'runImpact', to: 'ChangeAnalyst' },
        // M04 Slice 2a: review decisions. Plant, state and separation-of-duties checks are in the handler.
        { grant: 'submitForReview', to: 'ChangeAnalyst' },
        { grant: ['approve', 'reject'], to: 'ChangeApprover' }
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
            when 'GENAI_PROPOSAL' then 'GenAI Proposal' when 'S4_IMPORT' then 'Imported' when 'DEMO_IMPORT' then 'Demo Import (synthetic)' else sourceType end as sourceTypeText : String(30),
        createdAt, modifiedAt,
        // Slice 2b: what the CURRENT user may do now (role + status), computed on read for the UI.
        // Display hints only; every action re-checks role, plant, status and evidence on the server.
        virtual null as canSubmit    : Boolean,
        virtual null as canDecide    : Boolean,
        virtual null as canRunImpact : Boolean,
        latestRun, runs, decisions
    } actions {
        action runImpact(asOfDate : Date) returns ImpactRuns;
        action submitForReview(comment : String(1000)) returns ReviewCases;
        // basedOnRun: the impact run the reviewer evaluated; must be the case's latest run (else 409 STALE_EVIDENCE).
        action approve(comment : String(1000), basedOnRun : UUID @mandatory, acknowledgeWarnings : Boolean) returns ReviewCases;
        action reject(comment : String(1000) @mandatory, basedOnRun : UUID) returns ReviewCases;
    };

    // Decision history: read-only to every client, written only by the three review actions.
    @readonly
    @restrict: [{ grant: 'READ', to: ['ChangeViewer', 'ChangeAnalyst', 'ChangeApprover', 'JouleReader'], where: 'reviewCase.plant = $user.plants' }]
    entity DecisionEvents as projection on db.DecisionEvents {
        *,
        case action when 'SUBMIT' then 'Submitted for review' when 'APPROVE' then 'Approved'
            when 'REJECT' then 'Rejected' else action end as actionText : String(30)
    };

    @readonly
    @restrict: [{ grant: 'READ', to: ['ChangeViewer', 'ChangeAnalyst', 'ChangeApprover', 'JouleReader'], where: 'reviewCase.plant = $user.plants' }]
    entity ImpactRuns as projection on db.ImpactRuns;

    @readonly
    @restrict: [{ grant: 'READ', to: ['ChangeViewer', 'ChangeAnalyst', 'ChangeApprover', 'JouleReader'], where: 'run.reviewCase.plant = $user.plants' }]
    entity ImpactComparisonLines as projection on db.ImpactComparisonLines;

    @readonly
    @restrict: [{ grant: 'READ', to: ['ChangeViewer', 'ChangeAnalyst', 'ChangeApprover', 'JouleReader'], where: 'run.reviewCase.plant = $user.plants' }]
    entity ImpactMaterialLines as projection on db.ImpactMaterialLines;

    @readonly
    @restrict: [{ grant: 'READ', to: ['ChangeViewer', 'ChangeAnalyst', 'ChangeApprover', 'JouleReader'], where: 'run.reviewCase.plant = $user.plants' }]
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
    entity Instructions as projection on db.Instructions excluding { assembly };

    @readonly
    @restrict: [{ grant: 'READ', to: ['ChangeViewer', 'ChangeAnalyst', 'ChangeApprover'], where: 'instruction.plant = $user.plants' }]
    entity InstructionReferences as projection on db.InstructionReferences;

    // ---- P1: read-only lookup for Joule (named parameters instead of an OData $filter string) ----
    // JouleReader is a TECHNICAL client role: read-only on the review data above, no actions, plants from
    // server configuration (cds.requires.joule.plants), never combined with business roles (see the handler).
    type CaseSummary {
        caseNumber          : String(20);
        title               : String(160);
        assemblyCode        : String(40);
        plant               : String(4);
        fromRevision        : String(10);
        toRevision          : String(10);
        status              : String(12);
        statusText          : String(20);
        latestRunStatus     : String(24);
        latestRunAsOf       : Date;
        costDeltaTotal      : Decimal(15, 2);
        currency            : String(3);
        materialsShort      : Integer;
        instructionFindings : Integer;
    }
    @restrict: [{ to: ['ChangeViewer', 'ChangeAnalyst', 'ChangeApprover', 'JouleReader'] }]
    function lookupCases(caseNumber : String(20), status : String(12), assemblyCode : String(40)) returns many CaseSummary;

    // ---- M05: controlled import of SYNTHETIC demonstration scenarios ----------------------------
    // Enabled only where cds.requires['demo-import'].enabled is set (development/test profiles);
    // restricted to DemoDataManager and to the user's plants. Not an ERP integration.
    type ImportIssue  { path : String(200); code : String(40); message : String(300); }
    type ImportRecord { kind : String(30); recordKey : String(80); details : String(300); }
    type ImportResult {
        ok         : Boolean;
        committed  : Boolean;
        batchID    : UUID;
        plant      : String(4);
        caseNumber : String(20);
        sha256     : String(64);
        errors     : many ImportIssue;
        records    : many ImportRecord;
    }
    @requires: 'DemoDataManager'
    action validateDemoImport(fileName : String(120), content : LargeString @mandatory) returns ImportResult;
    @requires: 'DemoDataManager'
    action commitDemoImport(fileName : String(120), content : LargeString @mandatory, confirm : Boolean) returns ImportResult;
    @requires: 'DemoDataManager'
    action purgeDemoImport(batchID : UUID @mandatory) returns Boolean;

    @readonly
    @restrict: [{ grant: 'READ', to: 'DemoDataManager', where: 'plant = $user.plants' }]
    entity ImportBatches as projection on db.ImportBatches;
}
