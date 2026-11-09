namespace assemblyimpact;

using { cuid, managed } from '@sap/cds/common';
using { assemblyimpact.Assemblies } from './schema';

// M04 engineering-change domain. Source rows (BOMs, prices, stock, instructions)
// carry provenance; impact runs are immutable snapshots written only by the
// EngineeringReview.runImpact action (ruleset 1.1.0, docs/m04/M04_Data_Contract.md).

type Plant       : String(4);
type MaterialId  : String(40);
type UnitCode    : String(3);
type Quantity    : Decimal(13, 3);
type EvidenceRef : String(200);

type SourceType  : String(20) enum { SYNTHETIC_FIXTURE; MANUAL; GENAI_PROPOSAL; S4_IMPORT; DEMO_IMPORT; };
type CaseStatus  : String(12) enum { OPEN; IN_REVIEW; APPROVED; REJECTED; };

entity BOMStates : cuid {
    stateKey     : String(40) not null;
    assembly     : Association to Assemblies not null;
    plant        : Plant not null;
    bomUsage     : String(1) not null;
    alternative  : String(2) not null;
    revision     : String(10) not null;
    validFrom    : Date not null;
    validTo      : Date not null;
    status       : String(12) not null;
    changeNumber : String(20);
    sourceType   : SourceType not null;
    evidenceRef  : EvidenceRef not null;
    items        : Composition of many BOMItems on items.bomState = $self;
}

entity BOMItems : cuid {
    bomState    : Association to BOMStates not null;
    itemNo      : String(4) not null;
    material    : MaterialId not null;
    quantity    : Quantity not null;
    unit        : UnitCode not null;
    evidenceRef : EvidenceRef not null;
}

entity CostPrices : cuid {
    material    : MaterialId not null;
    plant       : Plant not null;
    price       : Decimal(15, 4) not null;
    currency    : String(3) not null;
    priceUnit   : Integer not null;
    unit        : UnitCode not null;
    priceBasis  : String(30) not null;
    validFrom   : Date not null;
    validTo     : Date not null;
    sourceType  : SourceType not null;
    evidenceRef : EvidenceRef not null;
}

entity StockSnapshots : cuid {
    material          : MaterialId not null;
    plant             : Plant not null;
    availableQuantity : Quantity not null;
    unit              : UnitCode not null;
    snapshotAt        : Timestamp not null;
    sourceType        : SourceType not null;
    evidenceRef       : EvidenceRef not null;
}

entity Instructions : cuid {
    instructionId     : String(40) not null;
    version           : Integer not null;
    assembly          : Association to Assemblies not null;
    plant             : Plant not null;
    title             : String(160) not null;
    appliesToRevision : String(10); // null = all revisions
    status            : String(12) not null;
    validFrom         : Date not null;
    sourceType        : SourceType not null;
    evidenceRef       : EvidenceRef not null;
    references        : Composition of many InstructionReferences on references.instruction = $self;
}

entity InstructionReferences : cuid {
    instruction : Association to Instructions not null;
    step        : String(4) not null;
    material    : MaterialId not null;
    quantity    : Quantity;
    unit        : UnitCode;
    text        : String(200);
}

entity ReviewCases : cuid, managed {
    caseNumber         : String(20) not null;
    title              : String(160) not null;
    assembly           : Association to Assemblies not null;
    plant              : Plant not null;
    fromState          : Association to BOMStates not null;
    toState            : Association to BOMStates not null;
    productionQuantity : Integer not null;
    status             : CaseStatus not null default 'OPEN';
    owner              : String(80);
    sourceType         : SourceType not null;
    evidenceRef        : EvidenceRef;
    // Compare-and-set token: every accepted impact run or review decision replaces it.
    version            : UUID;
    latestRun          : Association to ImpactRuns;
    runs               : Association to many ImpactRuns on runs.reviewCase = $self;
    decisions          : Association to many DecisionEvents on decisions.reviewCase = $self;
}

entity ImpactRuns : cuid {
    reviewCase           : Association to ReviewCases not null;
    ruleset              : String(10) not null;
    asOfDate             : Date not null;
    inputFingerprint     : String(71) not null; // "sha256:" + 64 hex
    status               : String(24) not null;  // COMPLETE | COMPLETE_WITH_WARNINGS | INCOMPLETE
    flags                : String(200);
    currency             : String(3) not null;
    productionQuantity   : Integer not null;
    fromRevision         : String(10) not null;
    toRevision           : String(10) not null;
    fromCostPerAssembly  : Decimal(15, 2);
    toCostPerAssembly    : Decimal(15, 2);
    deltaPerAssembly     : Decimal(15, 2);
    fromCostTotal        : Decimal(17, 2);
    toCostTotal          : Decimal(17, 2);
    costDeltaTotal       : Decimal(17, 2);
    costDeltaPercent     : Decimal(9, 2);
    instructionFindings  : Integer not null;
    instructionsToUpdate : Integer not null;
    materialsShort       : Integer not null;
    materialsUnknown     : Integer not null;
    computedAt           : Timestamp not null;
    computedBy           : String(255) not null;
    comparisonLines      : Composition of many ImpactComparisonLines on comparisonLines.run = $self;
    materialLines        : Composition of many ImpactMaterialLines on materialLines.run = $self;
    findings             : Composition of many Findings on findings.run = $self;
}

entity ImpactComparisonLines : cuid {
    run          : Association to ImpactRuns not null;
    itemNo       : String(4) not null;
    fromMaterial : MaterialId;
    fromQuantity : Quantity;
    toMaterial   : MaterialId;
    toQuantity   : Quantity;
    unit         : UnitCode;
    change       : String(20) not null;
}

entity ImpactMaterialLines : cuid {
    run              : Association to ImpactRuns not null;
    material         : MaterialId not null;
    unit             : UnitCode not null;
    required         : Quantity not null;
    available        : Quantity;
    gap              : Quantity;
    status           : String(16) not null;
    stale            : Boolean not null;
    snapshotAt       : Timestamp;
    unitPrice        : Decimal(21, 9);
    priceEvidenceRef : EvidenceRef;
    stockEvidenceRef : EvidenceRef;
}

entity Findings : cuid {
    run          : Association to ImpactRuns not null;
    type         : String(40) not null;
    severity     : String(8) not null;
    material     : MaterialId;
    details      : String(500) not null;
    evidenceRefs : String(1000) not null;
}

// M04 Slice 2a: review decision history. Insert-only; rows are written only by the
// EngineeringReview submitForReview/approve/reject actions together with the status change.
entity DecisionEvents : cuid {
    reviewCase : Association to ReviewCases not null;
    action     : String(16) not null;      // SUBMIT | APPROVE | REJECT
    fromStatus : CaseStatus not null;
    toStatus   : CaseStatus not null;
    actor      : String(255) not null;
    comment    : String(1000);
    at         : Timestamp not null;
    // M04 Slice 2a.1: the impact run the decision was based on (required for APPROVE).
    basedOnRun : Association to ImpactRuns;
    // Slice 2b: run warnings the approver explicitly acknowledged (COMPLETE_WITH_WARNINGS only).
    acknowledgedWarnings : String(200);
}

annotate BOMItems with @assert.unique.itemPerState: [bomState, itemNo];
annotate ReviewCases with @assert.unique.caseNumber: [caseNumber];
annotate Instructions with @assert.unique.instructionVersion: [instructionId, version, plant];

// M05: one row per controlled demo import (srv/lib/demo-import.js). Records created by the batch carry
// sourceType DEMO_IMPORT and evidenceRef "DEMO-IMPORT/<ID>/...", so a batch can be traced and purged.
entity ImportBatches : cuid {
    fileName     : String(120) not null;
    sha256       : String(64) not null;
    plant        : Plant not null;
    caseNumber   : String(20) not null;
    label        : String(120) not null;
    importedBy   : String(255) not null;
    importedAt   : Timestamp not null;
    recordCounts : String(300);
}
