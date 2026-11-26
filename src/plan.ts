import type { MigrationConfig, ObjectMapping } from "./config.js";
import { resolveStage } from "./config.js";
import { applyTransform, lookupValueMap } from "./transforms.js";
import { OBJECT_TYPES, type FieldIssue, type HubSpotObjectType } from "./types.js";

export interface PlannedLink {
  to: HubSpotObjectType;
  sourceId: string;
}

export interface PlannedRecord {
  objectType: HubSpotObjectType;
  sourceId: string;
  rowNumber: number;
  canonicalSourceId: string;
  action: "create" | "update" | "skip" | "fail";
  reason?: string;
  matchedBy?: "legacy_external_id" | "email" | "domain";
  properties: Record<string, string>;
  labels: Record<string, string>;
  errors: FieldIssue[];
  warnings: FieldIssue[];
  links: PlannedLink[];
  hubspotId?: string;
  skipWrite?: boolean;
}

export interface LocalPlan {
  records: Record<HubSpotObjectType, PlannedRecord[]>;
}

export interface SourceTables {
  companies: Record<string, string>[];
  contacts: Record<string, string>[];
  deals: Record<string, string>[];
}

export function buildLocalPlan(config: MigrationConfig, tables: SourceTables): LocalPlan {
  const records = {
    companies: buildObject("companies", config, tables.companies),
    contacts: buildObject("contacts", config, tables.contacts),
    deals: buildObject("deals", config, tables.deals),
  } satisfies Record<HubSpotObjectType, PlannedRecord[]>;

  for (const type of OBJECT_TYPES) {
    dedupeRecords(records[type], config.objects[type]);
  }
  copyCompanyNames(records.companies, records.contacts);
  return { records };
}

function buildObject(type: HubSpotObjectType, config: MigrationConfig, rows: Record<string, string>[]): PlannedRecord[] {
  const mapping = config.objects[type];
  const idProperty = mapping.upsertIdProperty ?? "legacy_external_id";
  return rows.map((row, index) => {
    const rowNumber = index + 2;
    const sourceId = (row[mapping.idColumn] ?? "").trim();
    const errors: FieldIssue[] = [];
    const warnings: FieldIssue[] = [];
    const properties: Record<string, string> = {};
    const labels: Record<string, string> = {};

    if (!sourceId) errors.push({ field: mapping.idColumn, message: "missing source id" });

    for (const field of mapping.fields) {
      applyField(row, field, properties, errors, warnings);
    }

    if (type === "deals") {
      const resolved = resolveStage(
        config,
        row[mapping.dealPipelineColumn ?? ""] ?? "",
        row[mapping.dealStageColumn ?? ""] ?? "",
      );
      if (!resolved.ok) {
        errors.push({ field: resolved.field, message: resolved.message });
      } else {
        labels.pipeline = resolved.stage.pipelineLabel;
        labels.stage = resolved.stage.stageLabel;
        labels.sourcePipeline = resolved.stage.sourcePipeline;
        labels.sourceStage = resolved.stage.sourceStage;
        properties.legacy_pipeline = resolved.stage.sourcePipeline;
      }
    }

    const ownerRaw = mapping.ownerColumn ? (row[mapping.ownerColumn] ?? "").trim() : "";
    if (ownerRaw) {
      properties.legacy_owner = ownerRaw;
      labels.owner = ownerRaw;
    }

    if (sourceId) properties[idProperty] = sourceId;
    properties.legacy_source = config.source;

    const links: PlannedLink[] = [];
    for (const association of mapping.associations ?? []) {
      const related = (row[association.column] ?? "").trim();
      if (!related) continue;
      links.push({ to: association.to, sourceId: related });
    }

    const record: PlannedRecord = {
      objectType: type,
      sourceId: sourceId || `row-${rowNumber}`,
      rowNumber,
      canonicalSourceId: sourceId || `row-${rowNumber}`,
      action: errors.length > 0 ? "fail" : "create",
      properties,
      labels,
      errors,
      warnings,
      links,
    };
    if (errors.length > 0) record.reason = errors.map((error) => error.message).join("; ");
    return record;
  });
}

function applyField(
  row: Record<string, string>,
  field: ObjectMapping["fields"][number],
  properties: Record<string, string>,
  errors: FieldIssue[],
  warnings: FieldIssue[],
): void {
  let value = row[field.column] ?? "";
  for (const transform of field.transforms ?? []) {
    const result = applyTransform(transform, value);
    if (!result.ok) {
      const issue = { field: field.property, message: result.message };
      if (field.required || field.valueMap) errors.push(issue);
      else warnings.push(issue);
      return;
    }
    value = result.value;
  }
  if (field.valueMap && value) {
    const mapped = lookupValueMap(field.valueMap, value);
    if (mapped === undefined) {
      errors.push({ field: field.property, message: `invalid value "${value}"` });
      return;
    }
    value = mapped;
  }
  if (field.required && !value) {
    errors.push({ field: field.property, message: "required value is missing" });
    return;
  }
  if (value) properties[field.property] = value;
}

function dedupeRecords(records: PlannedRecord[], mapping: ObjectMapping): void {
  const bySourceId = new Map<string, PlannedRecord>();
  for (const record of records) {
    if (record.action === "fail") continue;
    const winner = bySourceId.get(record.sourceId);
    if (!winner) {
      bySourceId.set(record.sourceId, record);
      continue;
    }
    markDuplicate(record, winner, "source id");
  }

  if (!mapping.dedupeProperty) return;
  const property = mapping.dedupeProperty;
  const byKey = new Map<string, PlannedRecord>();
  for (const record of records) {
    if (record.action === "fail" || record.action === "skip") continue;
    const raw = record.properties[property];
    if (!raw) continue;
    const key = raw.toLowerCase();
    const winner = byKey.get(key);
    if (!winner) {
      byKey.set(key, record);
      continue;
    }
    markDuplicate(record, winner, property);
  }
}

function markDuplicate(record: PlannedRecord, winner: PlannedRecord, keyLabel: string): void {
  record.action = "skip";
  record.canonicalSourceId = winner.sourceId;
  record.reason = `duplicate ${keyLabel} in source; kept ${winner.sourceId}`;
}

function copyCompanyNames(companies: PlannedRecord[], contacts: PlannedRecord[]): void {
  const byId = indexBySourceId(companies);
  for (const contact of contacts) {
    if (contact.action === "fail") continue;
    const link = contact.links.find((item) => item.to === "companies");
    if (!link) continue;
    const company = canonicalRecord(byId, link.sourceId);
    if (company?.properties.name) contact.properties.company = company.properties.name;
  }
}

/**
 * Index records by source id. When an export repeats an id, the entry is the
 * row that dedupe kept (the first row that did not fail validation), not the
 * later duplicate, so links to that id resolve to the record that is written.
 */
export function indexBySourceId(records: PlannedRecord[]): Map<string, PlannedRecord> {
  const byId = new Map<string, PlannedRecord>();
  for (const record of records) {
    const existing = byId.get(record.sourceId);
    if (!existing || (existing.action === "fail" && record.action !== "fail")) {
      byId.set(record.sourceId, record);
    }
  }
  return byId;
}

export function canonicalRecord(
  byId: Map<string, PlannedRecord>,
  sourceId: string,
): PlannedRecord | undefined {
  const direct = byId.get(sourceId);
  if (!direct) return undefined;
  if (direct.canonicalSourceId !== direct.sourceId) return byId.get(direct.canonicalSourceId);
  return direct;
}

export function recordLabel(record: PlannedRecord): string {
  return (
    record.properties.dealname ||
    record.properties.name ||
    [record.properties.firstname, record.properties.lastname].filter(Boolean).join(" ") ||
    record.properties.email ||
    record.sourceId
  );
}
