// P3 Engineering Change Case Worklist (SAP Fiori elements, OData V4).
// UI annotations for the EXISTING read-only EngineeringReview service. The
// Project Accelerator output (draft-enabled service with its own data model) was
// not imported; only its page structure was kept (see docs/evidence/p3-case-worklist).
// No business logic here: all figures come from runImpact snapshots on the server.
using EngineeringReview as service from '../../srv/engineering-review';

// ------------------------------------------------------------ Review cases
annotate service.ReviewCases with {
    ID                 @UI.Hidden;
    caseNumber         @title: 'Case ID';
    title              @title: 'Title';
    assemblyCode       @title: 'Assembly';
    plant              @title: 'Plant';
    fromRevision       @title: 'Current Revision';
    toRevision         @title: 'Proposed Revision';
    productionQuantity @title: 'Production Quantity';
    status             @title: 'Review Status'  @Common.Text: statusText  @Common.TextArrangement: #TextOnly;
    statusText         @title: 'Review Status' @UI.Hidden;
    sourceTypeText     @title: 'Source Type' @UI.Hidden;
    owner              @title: 'Review Owner';
    sourceType         @title: 'Source Type'  @Common.Text: sourceTypeText  @Common.TextArrangement: #TextOnly;
    evidenceRef        @title: 'Evidence Reference';
    latestRun          @title: 'Latest Impact Run';
    assemblyDescription @title: 'Assembly Description';
    canRunImpact       @UI.Hidden;
    canSubmit          @UI.Hidden;
    canDecide          @UI.Hidden;
    submittedBy        @title: 'Submitted By';
    runImpactHint      @title: 'Run Impact';
    submitHint         @title: 'Submit for Review';
    decideHint         @title: 'Approve / Reject';
};

annotate service.ReviewCases with @(
    UI.HeaderInfo         : {
        TypeName      : 'Review Case',
        TypeNamePlural: 'Review Cases',
        Title         : {Value: caseNumber},
        Description   : {Value: title}
    },
    UI.SelectionFields    : [
        assemblyCode,
        plant,
        toRevision,
        status,
        sourceType
    ],
    UI.LineItem           : [
        {Value: assemblyCode},
        {Value: caseNumber},
        {Value: fromRevision},
        {Value: toRevision},
        {Value: latestRun.instructionFindings, Label: 'Instruction Findings'},
        {Value: latestRun.materialsShort, Label: 'Materials Short'},
        {Value: latestRun.costDeltaTotal, Label: 'Estimated Cost Delta (EUR)'},
        {Value: sourceType},
        {
            Value      : status,
            // Open neutral, In Review warning, Approved positive, Rejected negative.
            Criticality: {$edmJson: {$If: [
                {$Eq: [{$Path: 'status'}, 'APPROVED']}, 3,
                {$If: [
                    {$Eq: [{$Path: 'status'}, 'REJECTED']}, 1,
                    {$If: [{$Eq: [{$Path: 'status'}, 'IN_REVIEW']}, 2, 0]}
                ]}
            ]}}
        },
        {
            $Type : 'UI.DataFieldForAction',
            Action: 'EngineeringReview.runImpact',
            Label : 'Run Impact'
        }
    ],
    // M05: review workflow in the Object Page header; availability comes from the server
    // (role, status, separation of duties) and every action re-checks it.
    UI.Identification     : [
        {
            $Type : 'UI.DataFieldForAction',
            Action: 'EngineeringReview.runImpact',
            Label : 'Run Impact'
        },
        {
            $Type : 'UI.DataFieldForAction',
            Action: 'EngineeringReview.submitForReview',
            Label : 'Submit for Review'
        },
        {
            $Type      : 'UI.DataFieldForAction',
            Action     : 'EngineeringReview.approve',
            Label      : 'Approve',
            Criticality: #Positive
        },
        {
            $Type      : 'UI.DataFieldForAction',
            Action     : 'EngineeringReview.rejectCase',
            Label      : 'Reject',
            Criticality: #Negative
        }
    ],
    UI.FieldGroup #General: {Data: [
        {Value: caseNumber},
        {Value: title},
        {Value: assemblyCode},
        {Value: plant},
        {Value: fromRevision},
        {Value: toRevision},
        {Value: productionQuantity},
        {Value: status},
        {Value: owner},
        {Value: sourceType},
        {Value: evidenceRef},
        {Value: submittedBy},
        {
            $Type : 'UI.DataFieldWithUrl',
            Label : 'Investigation Studio',
            Value : 'Open in Investigation Studio',
            // M05: the unified workspace for this case (same OData service, same key).
            Url   : {$edmJson: {$Apply: [
                '../../launchpad.html#EngineeringCase-investigate&/cases/',
                {$Path: 'ID'}
            ], $Function: 'odata.concat'}}
        }
    ]},
    // Why a greyed-out action is not available to the signed-in user (computed by the server; empty = available).
    UI.FieldGroup #Actions: {Data: [
        {Value: decideHint},
        {Value: submitHint},
        {Value: runImpactHint}
    ]},
    UI.FieldGroup #Impact : {Data: [
        {Value: latestRun.asOfDate, Label: 'As-of Date'},
        {Value: latestRun.statusText, Label: 'Run Status'},
        {Value: latestRun.flags, Label: 'Run Flags'},
        {Value: latestRun.fromCostPerAssembly, Label: 'Cost per Assembly, Current (EUR)'},
        {Value: latestRun.toCostPerAssembly, Label: 'Cost per Assembly, Proposed (EUR)'},
        {Value: latestRun.costDeltaTotal, Label: 'Estimated Cost Delta (EUR)'},
        {Value: latestRun.costDeltaPercent, Label: 'Cost Delta (%)'},
        {Value: latestRun.instructionFindings, Label: 'Instruction Findings'},
        {Value: latestRun.materialsShort, Label: 'Materials Short'},
        {Value: latestRun.computedAt, Label: 'Computed At'}
    ]},
    UI.Facets             : [
        {
            $Type : 'UI.ReferenceFacet',
            ID    : 'General',
            Label : 'General Information',
            Target: '@UI.FieldGroup#General'
        },
        {
            $Type : 'UI.ReferenceFacet',
            ID    : 'Actions',
            Label : 'Review Actions',
            Target: '@UI.FieldGroup#Actions'
        },
        {
            $Type : 'UI.ReferenceFacet',
            ID    : 'Impact',
            Label : 'Latest Impact',
            Target: '@UI.FieldGroup#Impact'
        },
        {
            $Type : 'UI.ReferenceFacet',
            ID    : 'Runs',
            Label : 'Impact Runs',
            Target: 'runs/@UI.PresentationVariant'
        },
        {
            $Type : 'UI.ReferenceFacet',
            ID    : 'Decisions',
            Label : 'Decision History',
            Target: 'decisions/@UI.PresentationVariant'
        }
    ]
);

annotate service.ReviewCases actions {
    // M05: refresh the latest-impact figures and the run list after the action (it was silent before).
    @Common.SideEffects: {
        TargetProperties: ['in/latestRun_ID', 'in/canSubmit', 'in/canDecide', 'in/canRunImpact', 'in/runImpactHint', 'in/submitHint', 'in/decideHint'],
        TargetEntities  : ['in/latestRun', 'in/runs']
    }
    @Core.OperationAvailable: {$edmJson: {$Path: 'in/canRunImpact'}}
    runImpact(asOfDate @title: 'As-of Date' @Common.QuickInfo: 'Leave empty to calculate as of today');

    @Common.SideEffects: {
        TargetProperties: ['in/status', 'in/statusText', 'in/canSubmit', 'in/canDecide', 'in/canRunImpact', 'in/runImpactHint', 'in/submitHint', 'in/decideHint', 'in/submittedBy'],
        TargetEntities  : ['in/decisions']
    }
    @Core.OperationAvailable: {$edmJson: {$Path: 'in/canSubmit'}}
    submitForReview(comment @title: 'Comment' @UI.MultiLineText);

    // basedOnRun defaults to the run shown on the page; the server refuses it if a newer run exists.
    @Common.SideEffects: {
        TargetProperties: ['in/status', 'in/statusText', 'in/canSubmit', 'in/canDecide', 'in/canRunImpact', 'in/runImpactHint', 'in/submitHint', 'in/decideHint'],
        TargetEntities  : ['in/decisions']
    }
    @Core.OperationAvailable: {$edmJson: {$Path: 'in/canDecide'}}
    approve(comment @title: 'Comment' @UI.MultiLineText,
            basedOnRun @title: 'Evaluated Impact Run' @UI.ParameterDefaultValue: {$edmJson: {$Path: 'in/latestRun_ID'}},
            acknowledgeWarnings @title: 'I acknowledge the impact-run warnings (e.g. stale stock)');

    @Common.SideEffects: {
        TargetProperties: ['in/status', 'in/statusText', 'in/canSubmit', 'in/canDecide', 'in/canRunImpact', 'in/runImpactHint', 'in/submitHint', 'in/decideHint'],
        TargetEntities  : ['in/decisions']
    }
    @Core.OperationAvailable: {$edmJson: {$Path: 'in/canDecide'}}
    rejectCase(comment @title: 'Reason for Rejection' @UI.MultiLineText,
           basedOnRun @title: 'Evaluated Impact Run' @UI.ParameterDefaultValue: {$edmJson: {$Path: 'in/latestRun_ID'}})
};

// ------------------------------------------------------------ Decision history (M05)
annotate service.DecisionEvents with {
    ID                   @UI.Hidden;
    at                   @title: 'Decided At';
    action               @title: 'Action';
    fromStatus           @title: 'From Status';
    toStatus             @title: 'To Status';
    actor                @title: 'By';
    comment              @title: 'Comment';
    basedOnRun           @title: 'Evaluated Impact Run';
    evidenceStatus       @title: 'Evidence Status';
    warningsAcknowledged @title: 'Warnings Acknowledged';
};

annotate service.DecisionEvents with @(
    UI.LineItem           : [
        {Value: at},
        {Value: action},
        {Value: fromStatus},
        {Value: toStatus},
        {Value: actor},
        {Value: comment},
        {Value: basedOnRun.asOfDate, Label: 'Evidence As-of Date'},
        {Value: evidenceStatus},
        {Value: warningsAcknowledged}
    ],
    UI.PresentationVariant: {
        SortOrder     : [{Property: at, Descending: true}],
        Visualizations: ['@UI.LineItem']
    }
);

// ------------------------------------------------------------ Impact runs
annotate service.ImpactRuns with {
    ID                  @UI.Hidden;
    computedAt          @title: 'Computed At';
    computedBy          @title: 'Computed By';
    asOfDate            @title: 'As-of Date';
    status              @title: 'Run Status' @Common.Text: statusText @Common.TextArrangement: #TextOnly;
    statusText          @title: 'Run Status' @UI.Hidden;
    flags               @title: 'Run Flags';
    ruleset             @title: 'Ruleset';
    fromRevision        @title: 'Current Revision';
    toRevision          @title: 'Proposed Revision';
    fromCostPerAssembly @title: 'Cost per Assembly, Current (EUR)';
    toCostPerAssembly   @title: 'Cost per Assembly, Proposed (EUR)';
    deltaPerAssembly    @title: 'Delta per Assembly (EUR)';
    costDeltaTotal      @title: 'Estimated Cost Delta (EUR)';
    costDeltaPercent    @title: 'Cost Delta (%)';
    materialsShort      @title: 'Materials Short';
    materialsUnknown    @title: 'Materials Unknown';
    instructionFindings @title: 'Instruction Findings';
    inputFingerprint    @title: 'Input Fingerprint';
};

annotate service.ImpactRuns with @(
    UI.HeaderInfo         : {
        TypeName      : 'Impact Run',
        TypeNamePlural: 'Impact Runs',
        Title         : {Value: asOfDate},
        Description   : {Value: statusText}
    },
    UI.LineItem           : [
        {Value: computedAt},
        {Value: asOfDate},
        {Value: statusText, Label: 'Run Status'},
        {Value: costDeltaTotal},
        {Value: materialsShort},
        {Value: instructionFindings},
        {Value: computedBy}
    ],
    UI.PresentationVariant: {
        SortOrder     : [{Property: computedAt, Descending: true}],
        Visualizations: ['@UI.LineItem']
    },
    UI.FieldGroup #Summary: {Data: [
        {Value: ruleset},
        {Value: asOfDate},
        {Value: fromRevision},
        {Value: toRevision},
        {Value: fromCostPerAssembly},
        {Value: toCostPerAssembly},
        {Value: deltaPerAssembly},
        {Value: costDeltaTotal},
        {Value: costDeltaPercent},
        {Value: materialsShort},
        {Value: materialsUnknown},
        {Value: instructionFindings},
        {Value: inputFingerprint},
        {Value: computedAt},
        {Value: computedBy}
    ]},
    UI.Facets             : [
        {
            $Type : 'UI.ReferenceFacet',
            ID    : 'Summary',
            Label : 'Run Summary',
            Target: '@UI.FieldGroup#Summary'
        },
        {
            $Type : 'UI.ReferenceFacet',
            ID    : 'Findings',
            Label : 'Findings',
            Target: 'findings/@UI.PresentationVariant'
        },
        {
            $Type : 'UI.ReferenceFacet',
            ID    : 'Materials',
            Label : 'Material Impact',
            Target: 'materialLines/@UI.PresentationVariant'
        },
        {
            $Type : 'UI.ReferenceFacet',
            ID    : 'Comparison',
            Label : 'BOM Comparison',
            Target: 'comparisonLines/@UI.PresentationVariant'
        }
    ]
);

// ------------------------------------------------------------ Findings
annotate service.Findings with {
    ID           @UI.Hidden;
    type         @title: 'Finding Type';
    severity     @title: 'Severity';
    material     @title: 'Material';
    details      @title: 'Description';
    evidenceRefs @title: 'Source References';
};

annotate service.Findings with @(
    UI.HeaderInfo         : {
        TypeName      : 'Finding',
        TypeNamePlural: 'Findings',
        Title         : {Value: type},
        Description   : {Value: material}
    },
    UI.LineItem           : [
        {Value: type},
        {
            Value      : severity,
            // High negative, Medium warning, Low neutral.
            Criticality: {$edmJson: {$If: [
                {$Eq: [{$Path: 'severity'}, 'HIGH']}, 1,
                {$If: [{$Eq: [{$Path: 'severity'}, 'MEDIUM']}, 2, 0]}
            ]}}
        },
        {Value: material},
        {Value: details},
        {Value: evidenceRefs}
    ],
    UI.PresentationVariant: {
        SortOrder     : [{Property: type}, {Property: material}], // alphabetical severity (HIGH, LOW, MEDIUM) would mislead; criticality icons mark HIGH
        Visualizations: ['@UI.LineItem']
    },
    UI.FieldGroup #Details: {Data: [
        {Value: type},
        {Value: severity},
        {Value: material},
        {Value: details},
        {Value: evidenceRefs}
    ]},
    UI.Facets             : [{
        $Type : 'UI.ReferenceFacet',
        ID    : 'Details',
        Label : 'Finding Details',
        Target: '@UI.FieldGroup#Details'
    }]
);

// ------------------------------------------------------------ Material impact
annotate service.ImpactMaterialLines with {
    ID        @UI.Hidden;
    material  @title: 'Material';
    required  @title: 'Required Quantity';
    available @title: 'Available Quantity';
    gap       @title: 'Gap Quantity';
    unit      @title: 'Unit';
    status    @title: 'Stock Status';
    stale     @title: 'Stale Snapshot';
    unitPrice @title: 'Unit Price' @Measures.ISOCurrency: run.currency; // M05: currency format instead of 9 decimals
};

annotate service.ImpactMaterialLines with @(UI.PresentationVariant: {
    SortOrder     : [{Property: material}],
    Visualizations: ['@UI.LineItem']
}, UI.LineItem: [
    {Value: material},
    {Value: required},
    {Value: available},
    {Value: gap},
    {Value: unit},
    {
        Value      : status,
        Criticality: {$edmJson: {$If: [
            {$Eq: [{$Path: 'status'}, 'SHORT']}, 1,
            {$If: [{$Eq: [{$Path: 'status'}, 'SUFFICIENT']}, 3, 2]}
        ]}}
    },
    {Value: stale},
    {Value: unitPrice}
]);

// ------------------------------------------------------------ BOM comparison
annotate service.ImpactComparisonLines with {
    ID           @UI.Hidden;
    itemNo       @title: 'Item';
    fromMaterial @title: 'Current Material';
    fromQuantity @title: 'Current Quantity';
    toMaterial   @title: 'Proposed Material';
    toQuantity   @title: 'Proposed Quantity';
    unit         @title: 'Unit';
    change       @title: 'Change';
};

annotate service.ImpactComparisonLines with @(UI.PresentationVariant: {
    SortOrder     : [{Property: itemNo}],
    Visualizations: ['@UI.LineItem']
}, UI.LineItem: [
    {Value: itemNo},
    {Value: fromMaterial},
    {Value: fromQuantity},
    {Value: toMaterial},
    {Value: toQuantity},
    {Value: unit},
    {Value: change}
]);
