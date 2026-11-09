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
        { grant: 'READ', to: ['ChangeViewer', 'ChangeAnalyst', 'ChangeApprover'], where: 'plant = $user.plants' },
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
            when 'GENAI_PROPOSAL' then 'GenAI Proposal' when 'S4_IMPORT' then 'Imported' else sourceType end as sourceTypeText : String(30),
        assembly.description as assemblyDescription : String(160),
        createdAt, modifiedAt,
        latestRun, runs, decisions,
        // M05: per-user action availability for the UI (role + plant + status + separation of duties).
        // Filled in srv/engineering-review.js after READ. Advisory only: every action re-checks on the server.
        virtual canRunImpact : Boolean,
        virtual canSubmit    : Boolean,
        virtual canDecide    : Boolean,
        virtual submittedBy  : String(255)
    } actions {
        action runImpact(asOfDate : Date) returns ImpactRuns;
        action submitForReview(comment : String(1000)) returns ReviewCases;
        // basedOnRun: the impact run the reviewer evaluated; must be the case's latest run (else 409 STALE_EVIDENCE).
        // acknowledgeWarnings (M05): required true when basedOnRun has status COMPLETE_WITH_WARNINGS; recorded on the event.
        // Runs with status INCOMPLETE can never be approved (409 EVIDENCE_INCOMPLETE).
        action approve(comment : String(1000), basedOnRun : UUID @mandatory, acknowledgeWarnings : Boolean) returns ReviewCases;
        action reject(comment : String(1000) @mandatory, basedOnRun : UUID) returns ReviewCases;
    };

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
    entity Instructions as projection on db.Instructions excluding { assembly };

    @readonly
    @restrict: [{ grant: 'READ', to: ['ChangeViewer', 'ChangeAnalyst', 'ChangeApprover'], where: 'instruction.plant = $user.plants' }]
    entity InstructionReferences as projection on db.InstructionReferences;
}
