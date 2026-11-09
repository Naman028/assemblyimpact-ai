using { assemblyImpactCaseWorklistSrv } from '../../srv/service.cds';

annotate assemblyImpactCaseWorklistSrv.ReviewCases with {
  Assembly @Common.ValueList: {
    CollectionPath: 'Assemblies',
    Parameters    : [
      {
        $Type            : 'Common.ValueListParameterInOut',
        LocalDataProperty: Assembly_ID,
        ValueListProperty: 'ID'
      },
      {
        $Type            : 'Common.ValueListParameterDisplayOnly',
        ValueListProperty: 'name'
      },
    ],
  }
};
annotate assemblyImpactCaseWorklistSrv.ReviewCases with @UI.HeaderInfo: {
  TypeName: 'Review Case',
  TypeNamePlural: 'Review Cases',
  Title: { Value: caseID }
};
annotate assemblyImpactCaseWorklistSrv.ReviewCases with {
  ID @UI.Hidden
};
annotate assemblyImpactCaseWorklistSrv.ReviewCases with @UI.Identification: [{ Value: caseID }];
annotate assemblyImpactCaseWorklistSrv.ReviewCases with {
  caseID @Common.Label: 'Change ID';
  currentRevision @Common.Label: 'Current revision';
  proposedRevision @Common.Label: 'Proposed revision';
  numberOfInstructionFindings @Common.Label: 'Number of instruction findings';
  numberOfMaterialsShort @Common.Label: 'Number of materials short';
  estimatedCostDelta @Common.Label: 'Estimated cost delta';
  sourceType @Common.Label: 'Source type';
  reviewStatus @Common.Label: 'Review status';
  plant @Common.Label: 'Plant';
  title @Common.Label: 'Title';
  reviewOwner @Common.Label: 'Review owner';
  productionQuantity @Common.Label: 'Production quantity';
  Findings @Common.Label: 'Findings';
  MaterialImpacts @Common.Label: 'Material Impacts';
  DecisionHistories @Common.Label: 'Decision Histories';
  Assembly @Common.Label: 'Assembly'
};
annotate assemblyImpactCaseWorklistSrv.ReviewCases with {
  ID @Common.Text: { $value: caseID, ![@UI.TextArrangement]: #TextOnly };
  Assembly @Common.Text: { $value: Assembly.name, ![@UI.TextArrangement]: #TextOnly };
  sourceType @Common.Text : { $value: sourceType.name, ![@UI.TextArrangement]: #TextOnly };
  reviewStatus @Common.Text : { $value: reviewStatus.name, ![@UI.TextArrangement]: #TextOnly };
};
annotate assemblyImpactCaseWorklistSrv.ReviewCases with {
  sourceType @Common.ValueListWithFixedValues;
  reviewStatus @Common.ValueListWithFixedValues;
};
annotate assemblyImpactCaseWorklistSrv.ReviewCases with @UI.SelectionFields : [
 plant,
 proposedRevision,
 reviewStatus_code,
 sourceType_code
];
annotate assemblyImpactCaseWorklistSrv.ReviewCases with @UI.LineItem : [
    { $Type: 'UI.DataField', Value: caseID },
    { $Type: 'UI.DataField', Value: currentRevision },
    { $Type: 'UI.DataField', Value: proposedRevision },
    { $Type: 'UI.DataField', Value: numberOfInstructionFindings },
    { $Type: 'UI.DataField', Value: numberOfMaterialsShort },
    { $Type: 'UI.DataField', Value: estimatedCostDelta },
    { $Type: 'UI.DataField', Value: sourceType_code },
    { $Type: 'UI.DataField', Value: reviewStatus_code }
];
annotate assemblyImpactCaseWorklistSrv.ReviewCases with @UI.FieldGroup #formSectionGeneralInformation: {
  $Type: 'UI.FieldGroupType', Data: [
    { $Type: 'UI.DataField', Value: productionQuantity },
    { $Type: 'UI.DataField', Value: reviewStatus_code },
    { $Type: 'UI.DataField', Value: reviewOwner },
    { $Type: 'UI.DataField', Value: sourceType_code }

  ]
};


annotate assemblyImpactCaseWorklistSrv.Findings with @UI.LineItem #tableSectionFindings: [
    { $Type: 'UI.DataField', Value: findingType_code },
    { $Type: 'UI.DataField', Value: material },
    { $Type: 'UI.DataField', Value: description },
    { $Type: 'UI.DataField', Value: severity_code },
    { $Type: 'UI.DataField', Value: sourceType },
    { $Type: 'UI.DataField', Value: sourceReference }

  ];


annotate assemblyImpactCaseWorklistSrv.MaterialImpacts with @UI.LineItem #tableSectionMaterialImpacts: [
    { $Type: 'UI.DataField', Value: material },
    { $Type: 'UI.DataField', Value: requiredQuantity },
    { $Type: 'UI.DataField', Value: availableQuantity },
    { $Type: 'UI.DataField', Value: gapQuantity },
    { $Type: 'UI.DataField', Value: unitOfMeasure }

  ];


annotate assemblyImpactCaseWorklistSrv.DecisionHistories with @UI.LineItem #tableSectionDecisionHistories: [
    { $Type: 'UI.DataField', Value: eventTime },
    { $Type: 'UI.DataField', Value: fromStatus_code },
    { $Type: 'UI.DataField', Value: toStatus_code },
    { $Type: 'UI.DataField', Value: actor },
    { $Type: 'UI.DataField', Value: comment }

  ];


annotate assemblyImpactCaseWorklistSrv.ReviewCases with @UI.FieldGroup #headerSectionReviewCase: {
  $Type: 'UI.FieldGroupType', Data: [
    { $Type: 'UI.DataField', Value: caseID },
    { $Type: 'UI.DataField', Value: title },
    { $Type: 'UI.DataField', Value: plant },
    { $Type: 'UI.DataField', Value: currentRevision },
    { $Type: 'UI.DataField', Value: proposedRevision }

  ]
};


annotate assemblyImpactCaseWorklistSrv.ReviewCases with @UI.Facets: [
  {
    $Type: 'UI.CollectionFacet',
    ID: 'tabGeneralInformation',
    Label: 'General Information',
    Facets: [
      { $Type: 'UI.ReferenceFacet', ID: 'formSectionGeneralInformation', Label: 'General Information', Target: '@UI.FieldGroup#formSectionGeneralInformation' } ]
  },
  {
    $Type: 'UI.CollectionFacet',
    ID: 'tabFindings',
    Label: 'Findings',
    Facets: [
      { $Type: 'UI.ReferenceFacet', ID: 'tableSectionFindings', Label: 'Findings', Target: 'Findings/@UI.LineItem#tableSectionFindings' } ]
  },
  {
    $Type: 'UI.CollectionFacet',
    ID: 'tabMaterialImpact',
    Label: 'Material Impact',
    Facets: [
      { $Type: 'UI.ReferenceFacet', ID: 'tableSectionMaterialImpacts', Label: 'Material Impact', Target: 'MaterialImpacts/@UI.LineItem#tableSectionMaterialImpacts' } ]
  },
  {
    $Type: 'UI.CollectionFacet',
    ID: 'tabDecisionHistory',
    Label: 'Decision History',
    Facets: [
      { $Type: 'UI.ReferenceFacet', ID: 'tableSectionDecisionHistories', Label: 'Decision History', Target: 'DecisionHistories/@UI.LineItem#tableSectionDecisionHistories' } ]
  }
];
annotate assemblyImpactCaseWorklistSrv.ReviewCases with @UI.HeaderFacets: [
{ $Type: 'UI.ReferenceFacet', ID: 'headerSectionReviewCase', Label: 'Review Case Header', Target: '@UI.FieldGroup#headerSectionReviewCase' }
];
annotate assemblyImpactCaseWorklistSrv.Assemblies with @UI.HeaderInfo: {
  TypeName: 'Assembly',
  TypeNamePlural: 'Assemblies',
  Title: { Value: name }
};
annotate assemblyImpactCaseWorklistSrv.Assemblies with {
  ID @UI.Hidden
};
annotate assemblyImpactCaseWorklistSrv.Assemblies with @UI.Identification: [{ Value: name }];
annotate assemblyImpactCaseWorklistSrv.Assemblies with {
  name @Common.Label: 'Name'
};
annotate assemblyImpactCaseWorklistSrv.Assemblies with {
  ID @Common.Text: { $value: name, ![@UI.TextArrangement]: #TextOnly };
};
annotate assemblyImpactCaseWorklistSrv.Assemblies with @UI.SelectionFields: [
  name
];
annotate assemblyImpactCaseWorklistSrv.Assemblies with @UI.LineItem: [
    { $Type: 'UI.DataField', Value: ID },
    { $Type: 'UI.DataField', Value: name }
];
annotate assemblyImpactCaseWorklistSrv.Assemblies with @UI.FieldGroup #Main: {
  $Type: 'UI.FieldGroupType', Data: [
    { $Type: 'UI.DataField', Value: ID },
    { $Type: 'UI.DataField', Value: name }
]};
annotate assemblyImpactCaseWorklistSrv.Assemblies with @UI.Facets: [
  { $Type: 'UI.ReferenceFacet', ID: 'Main', Label: 'General Information', Target: '@UI.FieldGroup#Main' }
];
annotate assemblyImpactCaseWorklistSrv.Findings with {
  reviewCases @Common.ValueList: {
    CollectionPath: 'ReviewCases',
    Parameters    : [
      {
        $Type            : 'Common.ValueListParameterInOut',
        LocalDataProperty: reviewCases_ID,
        ValueListProperty: 'ID'
      },
      {
        $Type            : 'Common.ValueListParameterDisplayOnly',
        ValueListProperty: 'caseID'
      },
      {
        $Type            : 'Common.ValueListParameterDisplayOnly',
        ValueListProperty: 'currentRevision'
      },
      {
        $Type            : 'Common.ValueListParameterDisplayOnly',
        ValueListProperty: 'proposedRevision'
      },
      {
        $Type            : 'Common.ValueListParameterDisplayOnly',
        ValueListProperty: 'numberOfInstructionFindings'
      },
      {
        $Type            : 'Common.ValueListParameterDisplayOnly',
        ValueListProperty: 'numberOfMaterialsShort'
      },
      {
        $Type            : 'Common.ValueListParameterDisplayOnly',
        ValueListProperty: 'estimatedCostDelta'
      },
      {
        $Type            : 'Common.ValueListParameterDisplayOnly',
        ValueListProperty: 'sourceType_code'
      },
      {
        $Type            : 'Common.ValueListParameterDisplayOnly',
        ValueListProperty: 'reviewStatus_code'
      },
      {
        $Type            : 'Common.ValueListParameterDisplayOnly',
        ValueListProperty: 'plant'
      },
      {
        $Type            : 'Common.ValueListParameterDisplayOnly',
        ValueListProperty: 'title'
      },
      {
        $Type            : 'Common.ValueListParameterDisplayOnly',
        ValueListProperty: 'reviewOwner'
      },
      {
        $Type            : 'Common.ValueListParameterDisplayOnly',
        ValueListProperty: 'productionQuantity'
      },
    ],
  }
};
annotate assemblyImpactCaseWorklistSrv.Findings with @UI.HeaderInfo: {
  TypeName: 'Finding',
  TypeNamePlural: 'Findings'
};
annotate assemblyImpactCaseWorklistSrv.Findings with {
  findingType @Common.Label: 'Finding Type';
  material @Common.Label: 'Material';
  description @Common.Label: 'Description';
  severity @Common.Label: 'Severity';
  sourceType @Common.Label: 'Source Type';
  sourceReference @Common.Label: 'Source Reference';
  reviewCases @Common.Label: 'Review Case';
  MaterialImpacts @Common.Label: 'Material Impacts';
  DecisionHistories @Common.Label: 'Decision Histories'
};
annotate assemblyImpactCaseWorklistSrv.Findings with {
  reviewCases @Common.Text: { $value: reviewCases.caseID, ![@UI.TextArrangement]: #TextOnly };
  findingType @Common.Text : { $value: findingType.name, ![@UI.TextArrangement]: #TextOnly };
  severity @Common.Text : { $value: severity.name, ![@UI.TextArrangement]: #TextOnly };
};
annotate assemblyImpactCaseWorklistSrv.Findings with {
  findingType @Common.ValueListWithFixedValues;
  severity @Common.ValueListWithFixedValues;
};
annotate assemblyImpactCaseWorklistSrv.Findings with @UI.SelectionFields: [
  reviewCases_ID,
  findingType_code,
  severity_code
];
annotate assemblyImpactCaseWorklistSrv.Findings with @UI.LineItem: [
    { $Type: 'UI.DataField', Value: findingType_code },
    { $Type: 'UI.DataField', Value: material },
    { $Type: 'UI.DataField', Value: description },
    { $Type: 'UI.DataField', Value: severity_code },
    { $Type: 'UI.DataField', Value: sourceType },
    { $Type: 'UI.DataField', Value: sourceReference },
    { $Type: 'UI.DataField', Label: 'Review Case', Value: reviewCases_ID }
];
annotate assemblyImpactCaseWorklistSrv.Findings with @UI.FieldGroup #formFindingDetails: {
  $Type: 'UI.FieldGroupType', Data: [
    { $Type: 'UI.DataField', Value: description }

  ]
};


annotate assemblyImpactCaseWorklistSrv.MaterialImpacts with @UI.LineItem #tableMaterialImpacts: [
    { $Type: 'UI.DataField', Value: material },
    { $Type: 'UI.DataField', Value: requiredQuantity },
    { $Type: 'UI.DataField', Value: availableQuantity },
    { $Type: 'UI.DataField', Value: gapQuantity },
    { $Type: 'UI.DataField', Value: unit }

  ];


annotate assemblyImpactCaseWorklistSrv.DecisionHistories with @UI.LineItem #tableDecisionHistories: [
    { $Type: 'UI.DataField', Value: decisionDate },
    { $Type: 'UI.DataField', Value: decisionBy },
    { $Type: 'UI.DataField', Value: decision },
    { $Type: 'UI.DataField', Value: comments }

  ];


annotate assemblyImpactCaseWorklistSrv.Findings with @UI.FieldGroup #headerFindingOverview: {
  $Type: 'UI.FieldGroupType', Data: [
    { $Type: 'UI.DataField', Value: findingType_code },
    { $Type: 'UI.DataField', Value: material },
    { $Type: 'UI.DataField', Value: severity_code },
    { $Type: 'UI.DataField', Value: sourceType },
    { $Type: 'UI.DataField', Value: sourceReference }

  ]
};


annotate assemblyImpactCaseWorklistSrv.Findings with @UI.Facets: [
  {
    $Type: 'UI.CollectionFacet',
    ID: 'tabGeneral',
    Label: 'General',
    Facets: [
      { $Type: 'UI.ReferenceFacet', ID: 'formFindingDetails', Label: 'Finding Details', Target: '@UI.FieldGroup#formFindingDetails' } ]
  },
  {
    $Type: 'UI.CollectionFacet',
    ID: 'tabMaterialImpacts',
    Label: 'Material Impacts',
    Facets: [
      { $Type: 'UI.ReferenceFacet', ID: 'tableMaterialImpacts', Label: 'Material Impacts', Target: 'MaterialImpacts/@UI.LineItem#tableMaterialImpacts' } ]
  },
  {
    $Type: 'UI.CollectionFacet',
    ID: 'tabDecisionHistories',
    Label: 'Decision Histories',
    Facets: [
      { $Type: 'UI.ReferenceFacet', ID: 'tableDecisionHistories', Label: 'Decision Histories', Target: 'DecisionHistories/@UI.LineItem#tableDecisionHistories' } ]
  }
];
annotate assemblyImpactCaseWorklistSrv.Findings with @UI.HeaderFacets: [
{ $Type: 'UI.ReferenceFacet', ID: 'headerFindingOverview', Label: 'Finding Overview', Target: '@UI.FieldGroup#headerFindingOverview' }
];
annotate assemblyImpactCaseWorklistSrv.MaterialImpacts with {
  reviewCases @Common.ValueList: {
    CollectionPath: 'ReviewCases',
    Parameters    : [
      {
        $Type            : 'Common.ValueListParameterInOut',
        LocalDataProperty: reviewCases_ID,
        ValueListProperty: 'ID'
      },
      {
        $Type            : 'Common.ValueListParameterDisplayOnly',
        ValueListProperty: 'caseID'
      },
      {
        $Type            : 'Common.ValueListParameterDisplayOnly',
        ValueListProperty: 'currentRevision'
      },
      {
        $Type            : 'Common.ValueListParameterDisplayOnly',
        ValueListProperty: 'proposedRevision'
      },
      {
        $Type            : 'Common.ValueListParameterDisplayOnly',
        ValueListProperty: 'numberOfInstructionFindings'
      },
      {
        $Type            : 'Common.ValueListParameterDisplayOnly',
        ValueListProperty: 'numberOfMaterialsShort'
      },
      {
        $Type            : 'Common.ValueListParameterDisplayOnly',
        ValueListProperty: 'estimatedCostDelta'
      },
      {
        $Type            : 'Common.ValueListParameterDisplayOnly',
        ValueListProperty: 'sourceType_code'
      },
      {
        $Type            : 'Common.ValueListParameterDisplayOnly',
        ValueListProperty: 'reviewStatus_code'
      },
      {
        $Type            : 'Common.ValueListParameterDisplayOnly',
        ValueListProperty: 'plant'
      },
      {
        $Type            : 'Common.ValueListParameterDisplayOnly',
        ValueListProperty: 'title'
      },
      {
        $Type            : 'Common.ValueListParameterDisplayOnly',
        ValueListProperty: 'reviewOwner'
      },
      {
        $Type            : 'Common.ValueListParameterDisplayOnly',
        ValueListProperty: 'productionQuantity'
      },
    ],
  }
};
annotate assemblyImpactCaseWorklistSrv.MaterialImpacts with {
  findings @Common.ValueList: {
    CollectionPath: 'Findings',
    Parameters    : [
      {
        $Type            : 'Common.ValueListParameterInOut',
        LocalDataProperty: findings_ID,
        ValueListProperty: 'ID'
      },
      {
        $Type            : 'Common.ValueListParameterDisplayOnly',
        ValueListProperty: 'findingType_code'
      },
      {
        $Type            : 'Common.ValueListParameterDisplayOnly',
        ValueListProperty: 'material'
      },
      {
        $Type            : 'Common.ValueListParameterDisplayOnly',
        ValueListProperty: 'description'
      },
      {
        $Type            : 'Common.ValueListParameterDisplayOnly',
        ValueListProperty: 'severity_code'
      },
      {
        $Type            : 'Common.ValueListParameterDisplayOnly',
        ValueListProperty: 'sourceType'
      },
      {
        $Type            : 'Common.ValueListParameterDisplayOnly',
        ValueListProperty: 'sourceReference'
      },
    ],
  }
};
annotate assemblyImpactCaseWorklistSrv.MaterialImpacts with @UI.HeaderInfo: {
  TypeName: 'Material Impact',
  TypeNamePlural: 'Material Impacts'
};
annotate assemblyImpactCaseWorklistSrv.MaterialImpacts with {
  material @Common.Label: 'Material';
  requiredQuantity @Common.Label: 'Required Quantity';
  availableQuantity @Common.Label: 'Available Quantity';
  gapQuantity @Common.Label: 'Gap Quantity';
  unitOfMeasure @Common.Label: 'Unit of Measure';
  unit @Common.Label: 'Unit';
  reviewCases @Common.Label: 'Review Case';
  findings @Common.Label: 'Finding'
};
annotate assemblyImpactCaseWorklistSrv.MaterialImpacts with {
  reviewCases @Common.Text: { $value: reviewCases.caseID, ![@UI.TextArrangement]: #TextOnly };
};
annotate assemblyImpactCaseWorklistSrv.MaterialImpacts with @UI.SelectionFields: [
  reviewCases_ID,
  findings_ID
];
annotate assemblyImpactCaseWorklistSrv.MaterialImpacts with @UI.LineItem: [
    { $Type: 'UI.DataField', Value: material },
    { $Type: 'UI.DataField', Value: requiredQuantity },
    { $Type: 'UI.DataField', Value: availableQuantity },
    { $Type: 'UI.DataField', Value: gapQuantity },
    { $Type: 'UI.DataField', Value: unitOfMeasure },
    { $Type: 'UI.DataField', Value: unit },
    { $Type: 'UI.DataField', Label: 'Review Case', Value: reviewCases_ID }
];
annotate assemblyImpactCaseWorklistSrv.MaterialImpacts with @UI.FieldGroup #Main: {
  $Type: 'UI.FieldGroupType', Data: [
    { $Type: 'UI.DataField', Value: material },
    { $Type: 'UI.DataField', Value: requiredQuantity },
    { $Type: 'UI.DataField', Value: availableQuantity },
    { $Type: 'UI.DataField', Value: gapQuantity },
    { $Type: 'UI.DataField', Value: unitOfMeasure },
    { $Type: 'UI.DataField', Value: unit },
    { $Type: 'UI.DataField', Label: 'Review Case', Value: reviewCases_ID }
]};
annotate assemblyImpactCaseWorklistSrv.MaterialImpacts with @UI.Facets: [
  { $Type: 'UI.ReferenceFacet', ID: 'Main', Label: 'General Information', Target: '@UI.FieldGroup#Main' }
];
annotate assemblyImpactCaseWorklistSrv.DecisionHistories with {
  reviewCases @Common.ValueList: {
    CollectionPath: 'ReviewCases',
    Parameters    : [
      {
        $Type            : 'Common.ValueListParameterInOut',
        LocalDataProperty: reviewCases_ID,
        ValueListProperty: 'ID'
      },
      {
        $Type            : 'Common.ValueListParameterDisplayOnly',
        ValueListProperty: 'caseID'
      },
      {
        $Type            : 'Common.ValueListParameterDisplayOnly',
        ValueListProperty: 'currentRevision'
      },
      {
        $Type            : 'Common.ValueListParameterDisplayOnly',
        ValueListProperty: 'proposedRevision'
      },
      {
        $Type            : 'Common.ValueListParameterDisplayOnly',
        ValueListProperty: 'numberOfInstructionFindings'
      },
      {
        $Type            : 'Common.ValueListParameterDisplayOnly',
        ValueListProperty: 'numberOfMaterialsShort'
      },
      {
        $Type            : 'Common.ValueListParameterDisplayOnly',
        ValueListProperty: 'estimatedCostDelta'
      },
      {
        $Type            : 'Common.ValueListParameterDisplayOnly',
        ValueListProperty: 'sourceType_code'
      },
      {
        $Type            : 'Common.ValueListParameterDisplayOnly',
        ValueListProperty: 'reviewStatus_code'
      },
      {
        $Type            : 'Common.ValueListParameterDisplayOnly',
        ValueListProperty: 'plant'
      },
      {
        $Type            : 'Common.ValueListParameterDisplayOnly',
        ValueListProperty: 'title'
      },
      {
        $Type            : 'Common.ValueListParameterDisplayOnly',
        ValueListProperty: 'reviewOwner'
      },
      {
        $Type            : 'Common.ValueListParameterDisplayOnly',
        ValueListProperty: 'productionQuantity'
      },
    ],
  }
};
annotate assemblyImpactCaseWorklistSrv.DecisionHistories with {
  findings @Common.ValueList: {
    CollectionPath: 'Findings',
    Parameters    : [
      {
        $Type            : 'Common.ValueListParameterInOut',
        LocalDataProperty: findings_ID,
        ValueListProperty: 'ID'
      },
      {
        $Type            : 'Common.ValueListParameterDisplayOnly',
        ValueListProperty: 'findingType_code'
      },
      {
        $Type            : 'Common.ValueListParameterDisplayOnly',
        ValueListProperty: 'material'
      },
      {
        $Type            : 'Common.ValueListParameterDisplayOnly',
        ValueListProperty: 'description'
      },
      {
        $Type            : 'Common.ValueListParameterDisplayOnly',
        ValueListProperty: 'severity_code'
      },
      {
        $Type            : 'Common.ValueListParameterDisplayOnly',
        ValueListProperty: 'sourceType'
      },
      {
        $Type            : 'Common.ValueListParameterDisplayOnly',
        ValueListProperty: 'sourceReference'
      },
    ],
  }
};
annotate assemblyImpactCaseWorklistSrv.DecisionHistories with @UI.HeaderInfo: {
  TypeName: 'Decision History',
  TypeNamePlural: 'Decision Histories'
};
annotate assemblyImpactCaseWorklistSrv.DecisionHistories with {
  eventTime @Common.Label: 'Event Time';
  fromStatus @Common.Label: 'From Status';
  toStatus @Common.Label: 'To Status';
  actor @Common.Label: 'Actor';
  comment @Common.Label: 'Comment';
  decisionDate @Common.Label: 'Decision Date';
  decisionBy @Common.Label: 'Decision By';
  decision @Common.Label: 'Decision';
  comments @Common.Label: 'Comments';
  reviewCases @Common.Label: 'Review Case';
  findings @Common.Label: 'Finding'
};
annotate assemblyImpactCaseWorklistSrv.DecisionHistories with {
  reviewCases @Common.Text: { $value: reviewCases.caseID, ![@UI.TextArrangement]: #TextOnly };
  fromStatus @Common.Text : { $value: fromStatus.name, ![@UI.TextArrangement]: #TextOnly };
  toStatus @Common.Text : { $value: toStatus.name, ![@UI.TextArrangement]: #TextOnly };
};
annotate assemblyImpactCaseWorklistSrv.DecisionHistories with {
  fromStatus @Common.ValueListWithFixedValues;
  toStatus @Common.ValueListWithFixedValues;
};
annotate assemblyImpactCaseWorklistSrv.DecisionHistories with @UI.SelectionFields: [
  reviewCases_ID,
  findings_ID,
  fromStatus_code,
  toStatus_code
];
annotate assemblyImpactCaseWorklistSrv.DecisionHistories with @UI.LineItem: [
    { $Type: 'UI.DataField', Value: eventTime },
    { $Type: 'UI.DataField', Value: fromStatus_code },
    { $Type: 'UI.DataField', Value: toStatus_code },
    { $Type: 'UI.DataField', Value: actor },
    { $Type: 'UI.DataField', Value: comment },
    { $Type: 'UI.DataField', Value: decisionDate },
    { $Type: 'UI.DataField', Value: decisionBy },
    { $Type: 'UI.DataField', Value: decision },
    { $Type: 'UI.DataField', Value: comments },
    { $Type: 'UI.DataField', Label: 'Review Case', Value: reviewCases_ID }
];
annotate assemblyImpactCaseWorklistSrv.DecisionHistories with @UI.FieldGroup #Main: {
  $Type: 'UI.FieldGroupType', Data: [
    { $Type: 'UI.DataField', Value: eventTime },
    { $Type: 'UI.DataField', Value: fromStatus_code },
    { $Type: 'UI.DataField', Value: toStatus_code },
    { $Type: 'UI.DataField', Value: actor },
    { $Type: 'UI.DataField', Value: comment },
    { $Type: 'UI.DataField', Value: decisionDate },
    { $Type: 'UI.DataField', Value: decisionBy },
    { $Type: 'UI.DataField', Value: decision },
    { $Type: 'UI.DataField', Value: comments },
    { $Type: 'UI.DataField', Label: 'Review Case', Value: reviewCases_ID }
]};
annotate assemblyImpactCaseWorklistSrv.DecisionHistories with @UI.Facets: [
  { $Type: 'UI.ReferenceFacet', ID: 'Main', Label: 'General Information', Target: '@UI.FieldGroup#Main' }
];