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
    status             @title: 'Review Status';
    owner              @title: 'Review Owner';
    sourceType         @title: 'Source Type';
    evidenceRef        @title: 'Evidence Reference';
    latestRun          @title: 'Latest Impact Run';
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
    UI.Identification     : [{
        $Type : 'UI.DataFieldForAction',
        Action: 'EngineeringReview.runImpact',
        Label : 'Run Impact'
    }],
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
        {Value: evidenceRef}
    ]},
    UI.FieldGroup #Impact : {Data: [
        {Value: latestRun.asOfDate, Label: 'As-of Date'},
        {Value: latestRun.status, Label: 'Run Status'},
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
            ID    : 'Impact',
            Label : 'Latest Impact',
            Target: '@UI.FieldGroup#Impact'
        },
        {
            $Type : 'UI.ReferenceFacet',
            ID    : 'Runs',
            Label : 'Impact Runs',
            Target: 'runs/@UI.PresentationVariant'
        }
    ]
);

annotate service.ReviewCases actions {
    runImpact(asOfDate @title: 'As-of Date')
};

// ------------------------------------------------------------ Impact runs
annotate service.ImpactRuns with {
    ID                  @UI.Hidden;
    computedAt          @title: 'Computed At';
    computedBy          @title: 'Computed By';
    asOfDate            @title: 'As-of Date';
    status              @title: 'Run Status';
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
        Description   : {Value: status}
    },
    UI.LineItem           : [
        {Value: computedAt},
        {Value: asOfDate},
        {Value: status},
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
    unitPrice @title: 'Unit Price (EUR)';
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
