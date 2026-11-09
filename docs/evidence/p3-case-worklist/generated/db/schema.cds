using { sap.common.CodeList } from '@sap/cds/common';

namespace assemblyImpactCaseWorklist;

entity ReviewCasesSourceTypeCodeList : CodeList {
  @Common.Text : { $value: name, ![@UI.TextArrangement]: #TextOnly }
  key code : String(20);
}

entity ReviewCasesReviewStatusCodeList : CodeList {
  @Common.Text : { $value: name, ![@UI.TextArrangement]: #TextOnly }
  key code : String(20);
}

entity FindingsFindingTypeCodeList : CodeList {
  @Common.Text : { $value: name, ![@UI.TextArrangement]: #TextOnly }
  key code : String(50);
}

entity FindingsSeverityCodeList : CodeList {
  @Common.Text : { $value: name, ![@UI.TextArrangement]: #TextOnly }
  key code : String(20);
}

entity DecisionHistoriesFromStatusCodeList : CodeList {
  @Common.Text : { $value: name, ![@UI.TextArrangement]: #TextOnly }
  key code : String(20);
}

entity DecisionHistoriesToStatusCodeList : CodeList {
  @Common.Text : { $value: name, ![@UI.TextArrangement]: #TextOnly }
  key code : String(20);
}

entity ReviewCases {
  key ID: UUID;
  caseID: String(20) @assert.unique @mandatory;
  currentRevision: String(5);
  proposedRevision: String(5);
  numberOfInstructionFindings: Integer;
  numberOfMaterialsShort: Integer;
  estimatedCostDelta: Decimal;
  sourceType: Association to ReviewCasesSourceTypeCodeList;
  reviewStatus: Association to ReviewCasesReviewStatusCodeList;
  plant: String(10);
  title: String(100);
  reviewOwner: String(50);
  productionQuantity: Integer;
  Findings: Association to many Findings on Findings.reviewCases = $self;
  MaterialImpacts: Association to many MaterialImpacts on MaterialImpacts.reviewCases = $self;
  DecisionHistories: Association to many DecisionHistories on DecisionHistories.reviewCases = $self;
  Assembly: Association to Assemblies;
}

entity Assemblies {
  key ID: UUID;
  name: String(50) @assert.unique @mandatory;
}

entity Findings {
  key ID: UUID;
  findingType: Association to FindingsFindingTypeCodeList;
  material: String(50);
  description: String(255);
  severity: Association to FindingsSeverityCodeList;
  sourceType: String(50);
  sourceReference: String(100);
  reviewCases: Association to ReviewCases;
  MaterialImpacts: Composition of many MaterialImpacts on MaterialImpacts.findings = $self;
  DecisionHistories: Composition of many DecisionHistories on DecisionHistories.findings = $self;
}

entity MaterialImpacts {
  key ID: UUID;
  material: String(50);
  requiredQuantity: Decimal;
  availableQuantity: Decimal;
  gapQuantity: Decimal;
  unitOfMeasure: String(20);
  unit: String(20);
  reviewCases: Association to ReviewCases;
  findings: Association to Findings;
}

entity DecisionHistories {
  key ID: UUID;
  eventTime: DateTime;
  fromStatus: Association to DecisionHistoriesFromStatusCodeList;
  toStatus: Association to DecisionHistoriesToStatusCodeList;
  actor: String(50);
  comment: String(255);
  decisionDate: DateTime;
  decisionBy: String(100);
  decision: String(100);
  comments: String(255);
  reviewCases: Association to ReviewCases;
  findings: Association to Findings;
}
