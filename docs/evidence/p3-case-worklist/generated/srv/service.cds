using { assemblyImpactCaseWorklist } from '../db/schema.cds';

service assemblyImpactCaseWorklistSrv {
  @odata.draft.enabled
  entity ReviewCases as projection on assemblyImpactCaseWorklist.ReviewCases;
  entity Assemblies as projection on assemblyImpactCaseWorklist.Assemblies;
  entity Findings as projection on assemblyImpactCaseWorklist.Findings;
}