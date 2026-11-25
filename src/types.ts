/** Portfolio demo types. This project is not client work. */

export const OBJECT_TYPES = ["companies", "contacts", "deals"] as const;
export type HubSpotObjectType = (typeof OBJECT_TYPES)[number];

export const ASSOCIATION_KEYS = ["contactCompany", "dealCompany", "dealContact"] as const;
export type AssociationKey = (typeof ASSOCIATION_KEYS)[number];

export type RowAction = "create" | "update" | "skip" | "fail";

export interface FieldIssue {
  field: string;
  message: string;
}

export interface ObjectTotals {
  sourceRows: number;
  valid: number;
  invalid: number;
  duplicates: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
}

export interface AssociationTotals {
  planned: number;
  created: number;
  skipped: number;
  failed: number;
}

export interface ValidationIssue {
  object: HubSpotObjectType;
  rowNumber: number;
  sourceId: string;
  field: string;
  message: string;
}

export interface ActionRecord {
  object: HubSpotObjectType;
  rowNumber: number;
  sourceId: string;
  action: RowAction;
  reason?: string;
  matchedBy?: "legacy_external_id" | "email" | "domain";
  label: string;
  properties: Record<string, string>;
  labels: Record<string, string>;
}

export interface AssociationRecord {
  key: AssociationKey;
  fromObject: HubSpotObjectType;
  fromSourceId: string;
  toObject: HubSpotObjectType;
  toSourceId: string;
  status: "create" | "skip" | "fail";
  reason?: string;
  fromHubspotId?: string;
  toHubspotId?: string;
}

export interface PipelineStageReport {
  source: string;
  label: string;
  probability: string;
  closedWon: boolean;
  closedLost: boolean;
  hubspotId?: string;
}

export interface PipelineReport {
  sourceName: string;
  hubspotLabel: string;
  hubspotId?: string;
  stages: PipelineStageReport[];
}

export interface MappingFieldPreview {
  column: string;
  property: string;
  required: boolean;
  transforms: string[];
  valueMap?: Record<string, string>;
}

export interface MappingObjectPreview {
  file: string;
  idColumn: string;
  upsertIdProperty: string;
  dedupeProperty?: string;
  ownerColumn?: string;
  dealPipelineColumn?: string;
  dealStageColumn?: string;
  associations: { column: string; to: HubSpotObjectType }[];
  fields: MappingFieldPreview[];
}

export interface MappingPreview {
  source: string;
  title: string;
  description: string;
  objects: Record<HubSpotObjectType, MappingObjectPreview>;
  pipelines: PipelineReport[];
  properties: {
    object: HubSpotObjectType;
    name: string;
    label: string;
    hasUniqueValue: boolean;
  }[];
}

export interface ObjectReconciliation {
  expected: number;
  readBack: number;
  missingIds: string[];
  match: boolean;
}

export interface AssociationReconciliation {
  expected: number;
  verified: number;
  missing: string[];
  match: boolean;
}

export interface Reconciliation {
  performed: boolean;
  reason?: string;
  objects?: Record<HubSpotObjectType, ObjectReconciliation>;
  associations?: Record<AssociationKey, AssociationReconciliation>;
  match: boolean;
}

export interface MigrationReport {
  portfolioDemo: true;
  disclaimer: string;
  meta: {
    tool: string;
    source: string;
    title: string;
    description: string;
    mode: "dry-run" | "live";
    target: string;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    writes: number;
    runId: string;
    command?: string;
  };
  totals: Record<HubSpotObjectType, ObjectTotals>;
  associations: Record<AssociationKey, AssociationTotals>;
  pipelines: PipelineReport[];
  validationErrors: ValidationIssue[];
  warnings: ValidationIssue[];
  actions: ActionRecord[];
  associationResults: AssociationRecord[];
  reconciliation: Reconciliation;
  notes: string[];
  mapping: MappingPreview;
}

export const DISCLAIMER =
  "Portfolio demo, not client work. Records are synthetic. Domains use the reserved .example TLD. No real personal data.";
