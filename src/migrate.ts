import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { emptyCheckpoint, loadCheckpoint, saveCheckpoint, type Checkpoint } from "./checkpoint.js";
import { chunk } from "./chunk.js";
import type { MigrationConfig } from "./config.js";
import { parseCsv } from "./csv.js";
import {
  associationTypeId,
  isMissingPropertyError,
  type HubSpotClient,
  type OwnerRecord,
} from "./hubspot/client.js";
import { ensureSchema, type EnsuredSchema } from "./hubspot/schema.js";
import { buildLocalPlan, canonicalRecord, indexBySourceId, recordLabel, type PlannedRecord, type SourceTables } from "./plan.js";
import {
  DISCLAIMER,
  OBJECT_TYPES,
  type ActionRecord,
  type AssociationKey,
  type AssociationRecord,
  type AssociationTotals,
  type HubSpotObjectType,
  type MappingPreview,
  type MigrationReport,
  type ObjectTotals,
  type PipelineReport,
  type Reconciliation,
} from "./types.js";

export interface Logger {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };

export interface RunOptions {
  config: MigrationConfig;
  inputDir: string;
  mode: "dry-run" | "live";
  client?: HubSpotClient;
  batchSize?: number;
  checkpointPath?: string;
  resumePath?: string;
  logger?: Logger;
  command?: string;
  target?: string;
}

const BATCH_LIMIT = 100;

export async function runMigration(options: RunOptions): Promise<MigrationReport> {
  const started = Date.now();
  const logger = options.logger ?? silentLogger;
  const batchSize = options.batchSize ?? BATCH_LIMIT;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > BATCH_LIMIT) {
    throw new Error(`batch size must be an integer between 1 and ${BATCH_LIMIT}`);
  }
  if (options.mode === "live" && !options.client) {
    throw new Error("A live run needs a HubSpot client. Set HUBSPOT_TOKEN or pass --base-url with --token.");
  }

  const notes: string[] = [];
  const tables = loadTables(options.config, options.inputDir);
  const plan = buildLocalPlan(options.config, tables);
  const records = plan.records;

  let schema: EnsuredSchema | undefined;
  if (options.mode === "live" && options.client) {
    logger.info("Ensuring custom properties and deal pipelines");
    schema = await ensureSchema(options.client, options.config);
    applyStageIds(records.deals, schema);
  }

  if (options.client) {
    applyOwners(records, options.config, await options.client.listOwners(), notes);
    for (const type of OBJECT_TYPES) {
      await classify(options.client, type, options.config, records[type], notes);
    }
  } else {
    notes.push("HubSpot was not queried. Create versus update assumes the portal has none of these records yet.");
  }

  const checkpoint = prepareCheckpoint(options);
  if (options.mode === "live" && options.client) {
    for (const type of OBJECT_TYPES) {
      restoreCheckpoint(records[type], checkpoint, type);
      await writeRecords(options.client, type, options.config, records[type], checkpoint, batchSize, options.checkpointPath, logger);
    }
  }

  const associationResults = resolveAssociations(records, options.mode);
  if (options.mode === "live" && options.client) {
    await writeAssociations(options.client, associationResults, checkpoint, batchSize, options.checkpointPath, logger);
  }

  const reconciliation =
    options.mode === "live" && options.client
      ? await reconcile(options.client, options.config, records, associationResults)
      : {
          performed: false,
          match: true,
          reason: "Dry-run does not write, so there is nothing new to read back.",
        };

  const finished = Date.now();
  return {
    portfolioDemo: true,
    disclaimer: DISCLAIMER,
    meta: {
      tool: "hubspot-crm-migration-toolkit",
      source: options.config.source,
      title: options.config.title,
      description: options.config.description,
      mode: options.mode,
      target: options.target ?? options.client?.baseUrl ?? "unqueried",
      startedAt: new Date(started).toISOString(),
      finishedAt: new Date(finished).toISOString(),
      durationMs: finished - started,
      writes: options.client?.mutatingRequests ?? 0,
      runId: randomUUID(),
      ...(options.command ? { command: options.command } : {}),
    },
    totals: totalsFor(records),
    associations: associationTotals(associationResults),
    pipelines: pipelineReport(options.config, schema),
    validationErrors: issues(records, "errors"),
    warnings: issues(records, "warnings"),
    actions: actionsFor(records, options.mode),
    associationResults,
    reconciliation,
    notes,
    mapping: mappingPreview(options.config),
  };
}

function loadTables(config: MigrationConfig, inputDir: string): SourceTables {
  const load = (file: string) => parseCsv(readFileSync(join(inputDir, file), "utf8"));
  return {
    companies: load(config.objects.companies.file),
    contacts: load(config.objects.contacts.file),
    deals: load(config.objects.deals.file),
  };
}

function applyStageIds(deals: PlannedRecord[], schema: EnsuredSchema): void {
  for (const deal of deals) {
    if (deal.action === "fail" || deal.action === "skip") continue;
    const pipeline = schema.pipelines[deal.labels.pipeline ?? ""];
    const stageId = pipeline?.stages[(deal.labels.stage ?? "").toLowerCase()];
    if (!pipeline || !stageId) {
      throw new Error(`Stage "${deal.labels.stage}" on "${deal.labels.pipeline}" was not created in HubSpot`);
    }
    deal.properties.pipeline = pipeline.id;
    deal.properties.dealstage = stageId;
  }
}

function applyOwners(
  records: Record<HubSpotObjectType, PlannedRecord[]>,
  config: MigrationConfig,
  owners: OwnerRecord[],
  notes: string[],
): void {
  const byEmail = new Map(owners.filter((owner) => owner.email).map((owner) => [owner.email.toLowerCase(), owner.id]));
  const byName = new Map(
    owners.map((owner) => [`${owner.firstName} ${owner.lastName}`.trim().toLowerCase(), owner.id]),
  );
  let unresolved = 0;
  for (const type of OBJECT_TYPES) {
    for (const record of records[type]) {
      if (record.action === "fail" || record.action === "skip") continue;
      const name = record.properties.legacy_owner;
      if (!name) continue;
      const configured = (config.owners ?? []).find((owner) => owner.name.toLowerCase() === name.toLowerCase());
      const id = (configured && byEmail.get(configured.email.toLowerCase())) || byName.get(name.toLowerCase());
      if (id) record.properties.hubspot_owner_id = id;
      else {
        unresolved += 1;
        record.warnings.push({ field: "hubspot_owner_id", message: `no HubSpot owner matches "${name}"` });
      }
    }
  }
  if (unresolved > 0) {
    notes.push(`${unresolved} rows kept legacy_owner and did not set hubspot_owner_id because no owner matched.`);
  }
}

async function classify(
  client: HubSpotClient,
  type: HubSpotObjectType,
  config: MigrationConfig,
  records: PlannedRecord[],
  notes: string[],
): Promise<void> {
  const mapping = config.objects[type];
  const idProperty = mapping.upsertIdProperty ?? "legacy_external_id";
  const matchProperty = mapping.dedupeProperty;
  const pending = records.filter((record) => record.action === "create");
  if (pending.length === 0) return;

  const byLegacy = new Map<string, { id: string; properties: Record<string, string> }>();
  try {
    const found = await client.searchByValues(
      type,
      idProperty,
      pending.map((record) => record.properties[idProperty] ?? ""),
      [idProperty, matchProperty ?? idProperty],
    );
    for (const object of found) {
      const key = object.properties[idProperty];
      if (key) byLegacy.set(key.toLowerCase(), object);
    }
  } catch (error) {
    if (!isMissingPropertyError(error)) throw error;
    notes.push(`${type}: ${idProperty} is not in the portal yet, so id matching was skipped.`);
  }

  const byMatch = new Map<string, { id: string; properties: Record<string, string> }>();
  if (matchProperty && matchProperty !== idProperty) {
    const values = pending
      .filter((record) => !byLegacy.has((record.properties[idProperty] ?? "").toLowerCase()))
      .map((record) => record.properties[matchProperty] ?? "");
    if (values.some(Boolean)) {
      const found = await client.searchByValues(type, matchProperty, values, [idProperty, matchProperty]);
      for (const object of found) {
        const key = (object.properties[matchProperty] ?? "").toLowerCase();
        if (key && !byMatch.has(key)) byMatch.set(key, object);
      }
    }
  }

  for (const record of pending) {
    const legacy = byLegacy.get((record.properties[idProperty] ?? "").toLowerCase());
    if (legacy) {
      record.action = "update";
      record.hubspotId = legacy.id;
      record.matchedBy = "legacy_external_id";
      record.reason = `matched ${legacy.id} on ${idProperty}`;
      continue;
    }
    if (!matchProperty || matchProperty === idProperty) continue;
    const hit = byMatch.get((record.properties[matchProperty] ?? "").toLowerCase());
    if (!hit) continue;
    const existingLegacy = hit.properties[idProperty];
    if (existingLegacy && existingLegacy !== record.properties[idProperty]) {
      record.action = "skip";
      record.reason = `conflict: ${matchProperty} already belongs to ${idProperty} ${existingLegacy}`;
      continue;
    }
    record.action = "update";
    record.hubspotId = hit.id;
    record.matchedBy = matchProperty === "email" ? "email" : "domain";
    record.reason = `matched ${hit.id} on ${matchProperty}`;
  }
}

function prepareCheckpoint(options: RunOptions): Checkpoint {
  const checkpoint = options.resumePath ? loadCheckpoint(options.resumePath) : emptyCheckpoint(options.config.source);
  if (checkpoint.source !== options.config.source) {
    throw new Error(`Checkpoint source ${checkpoint.source} does not match ${options.config.source}`);
  }
  return checkpoint;
}

function restoreCheckpoint(records: PlannedRecord[], checkpoint: Checkpoint, type: HubSpotObjectType): void {
  for (const record of records) {
    const prior = checkpoint.records[type][record.sourceId];
    if (!prior) continue;
    if (record.action !== "create" && record.action !== "update") continue;
    record.hubspotId = prior.hubspotId;
    record.skipWrite = true;
    record.reason = record.reason ? `${record.reason}; resumed from checkpoint` : "resumed from checkpoint";
  }
}

async function writeRecords(
  client: HubSpotClient,
  type: HubSpotObjectType,
  config: MigrationConfig,
  records: PlannedRecord[],
  checkpoint: Checkpoint,
  batchSize: number,
  checkpointPath: string | undefined,
  logger: Logger,
): Promise<void> {
  const idProperty = config.objects[type].upsertIdProperty ?? "legacy_external_id";
  const creates = records.filter((record) => record.action === "create" && !record.skipWrite);
  const updates = records.filter((record) => record.action === "update" && !record.skipWrite && record.hubspotId);

  for (const batch of chunk(creates, batchSize)) {
    const results = await client.upsert(
      type,
      batch.map((record) => ({
        idProperty,
        id: record.properties[idProperty] ?? record.sourceId,
        properties: record.properties,
      })),
    );
    results.forEach((result, index) => {
      const record = batch[index];
      record.hubspotId = result.id;
      const action = result.created ? "create" : "update";
      if (action === "update") {
        record.action = "update";
        record.reason = "HubSpot upsert matched an existing record";
      }
      checkpoint.records[type][record.sourceId] = { hubspotId: result.id, action };
    });
    if (checkpointPath) saveCheckpoint(checkpointPath, checkpoint);
    logger.info(`${type}: wrote ${batch.length} create(s)`);
  }

  for (const batch of chunk(updates, batchSize)) {
    const results = await client.update(
      type,
      batch.map((record) => ({ id: record.hubspotId as string, properties: record.properties })),
    );
    results.forEach((result, index) => {
      const record = batch[index];
      record.hubspotId = result.id;
      checkpoint.records[type][record.sourceId] = { hubspotId: result.id, action: "update" };
    });
    if (checkpointPath) saveCheckpoint(checkpointPath, checkpoint);
    logger.info(`${type}: wrote ${batch.length} update(s)`);
  }
}

function resolveAssociations(records: Record<HubSpotObjectType, PlannedRecord[]>, mode: "dry-run" | "live"): AssociationRecord[] {
  const indexes = {
    companies: indexBySourceId(records.companies),
    contacts: indexBySourceId(records.contacts),
    deals: indexBySourceId(records.deals),
  };
  const seen = new Set<string>();
  const results: AssociationRecord[] = [];
  for (const type of OBJECT_TYPES) {
    for (const record of records[type]) {
      if (record.action === "fail" || record.action === "skip") continue;
      for (const link of record.links) {
        const pair = `${type}:${record.sourceId}:${link.to}:${link.sourceId}`;
        if (seen.has(pair)) continue;
        seen.add(pair);
        const key = associationKey(type, link.to);
        const target = canonicalRecord(indexes[link.to], link.sourceId);
        const base = {
          key,
          fromObject: type,
          fromSourceId: record.sourceId,
          toObject: link.to,
          toSourceId: link.sourceId,
        };
        if (!target || target.action === "fail" || target.action === "skip") {
          const reason = target
            ? `related ${link.to} ${link.sourceId} was not imported (${target.action})`
            : `orphan: no ${link.to} ${link.sourceId}`;
          results.push({ ...base, status: "skip", reason });
          continue;
        }
        if (mode === "dry-run" || (record.hubspotId && target.hubspotId)) {
          results.push({
            ...base,
            status: "create",
            ...(record.hubspotId ? { fromHubspotId: record.hubspotId } : {}),
            ...(target.hubspotId ? { toHubspotId: target.hubspotId } : {}),
          });
          continue;
        }
        results.push({ ...base, status: "fail", reason: "missing HubSpot id for an association endpoint" });
      }
    }
  }
  return results;
}

async function writeAssociations(
  client: HubSpotClient,
  results: AssociationRecord[],
  checkpoint: Checkpoint,
  batchSize: number,
  checkpointPath: string | undefined,
  logger: Logger,
): Promise<void> {
  const done = new Set(checkpoint.associations);
  const pending = results.filter((result) => result.status === "create" && result.fromHubspotId && result.toHubspotId);
  const groups = new Map<AssociationKey, AssociationRecord[]>();
  for (const result of pending) {
    const key = associationPairKey(result);
    if (done.has(key)) continue;
    const list = groups.get(result.key) ?? [];
    list.push(result);
    groups.set(result.key, list);
  }
  for (const [key, group] of groups) {
    const sample = group[0];
    for (const batch of chunk(group, batchSize)) {
      await client.createAssociations(
        sample.fromObject,
        sample.toObject,
        batch.map((result) => ({
          fromId: result.fromHubspotId as string,
          toId: result.toHubspotId as string,
          typeId: associationTypeId(sample.fromObject, sample.toObject),
        })),
      );
      for (const result of batch) checkpoint.associations.push(associationPairKey(result));
      if (checkpointPath) saveCheckpoint(checkpointPath, checkpoint);
      logger.info(`${key}: ensured ${batch.length} association(s)`);
    }
  }
}

async function reconcile(
  client: HubSpotClient,
  config: MigrationConfig,
  records: Record<HubSpotObjectType, PlannedRecord[]>,
  associations: AssociationRecord[],
): Promise<Reconciliation> {
  const objects = {
    companies: await reconcileObjects(client, "companies", records.companies, idProperty(config, "companies")),
    contacts: await reconcileObjects(client, "contacts", records.contacts, idProperty(config, "contacts")),
    deals: await reconcileObjects(client, "deals", records.deals, idProperty(config, "deals")),
  };
  const associationReport = {
    contactCompany: await reconcileAssociations(client, associations, "contactCompany"),
    dealCompany: await reconcileAssociations(client, associations, "dealCompany"),
    dealContact: await reconcileAssociations(client, associations, "dealContact"),
  };
  const match =
    objects.companies.match &&
    objects.contacts.match &&
    objects.deals.match &&
    associationReport.contactCompany.match &&
    associationReport.dealCompany.match &&
    associationReport.dealContact.match;
  return { performed: true, objects, associations: associationReport, match };
}

async function reconcileObjects(
  client: HubSpotClient,
  type: HubSpotObjectType,
  records: PlannedRecord[],
  property: string,
) {
  const expected = records.filter((record) => record.action === "create" || record.action === "update");
  const ids = expected.map((record) => record.properties[property] ?? "").filter(Boolean);
  if (ids.length === 0) return { expected: 0, readBack: 0, missingIds: [], match: true };
  const found = await client.searchByValues(type, property, ids, [property]);
  const foundIds = new Set(found.map((object) => object.properties[property]));
  const missingIds = ids.filter((id) => !foundIds.has(id));
  return {
    expected: ids.length,
    readBack: found.length,
    missingIds,
    match: missingIds.length === 0 && found.length === ids.length,
  };
}

async function reconcileAssociations(client: HubSpotClient, associations: AssociationRecord[], key: AssociationKey) {
  const expected = associations.filter(
    (association) => association.key === key && association.status === "create" && association.fromHubspotId && association.toHubspotId,
  );
  if (expected.length === 0) return { expected: 0, verified: 0, missing: [], match: true };
  const sample = expected[0];
  const read = await client.readAssociations(
    sample.fromObject,
    sample.toObject,
    expected.map((association) => association.fromHubspotId as string),
  );
  const byFrom = new Map(read.map((row) => [row.fromId, new Set(row.toIds)]));
  const missing: string[] = [];
  let verified = 0;
  for (const association of expected) {
    const targets = byFrom.get(association.fromHubspotId as string);
    if (targets?.has(association.toHubspotId as string)) verified += 1;
    else missing.push(`${association.fromSourceId}->${association.toSourceId}`);
  }
  return { expected: expected.length, verified, missing, match: missing.length === 0 };
}

function totalsFor(records: Record<HubSpotObjectType, PlannedRecord[]>): MigrationReport["totals"] {
  return {
    companies: objectTotals(records.companies),
    contacts: objectTotals(records.contacts),
    deals: objectTotals(records.deals),
  };
}

function objectTotals(records: PlannedRecord[]): ObjectTotals {
  const totals: ObjectTotals = {
    sourceRows: records.length,
    valid: 0,
    invalid: 0,
    duplicates: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
  };
  for (const record of records) {
    if (record.action === "create") totals.created += 1;
    else if (record.action === "update") totals.updated += 1;
    else if (record.action === "skip") {
      totals.skipped += 1;
      if (record.reason?.startsWith("duplicate")) totals.duplicates += 1;
    } else totals.failed += 1;
    if (record.errors.length > 0) totals.invalid += 1;
  }
  totals.valid = totals.sourceRows - totals.invalid;
  return totals;
}

function associationTotals(results: AssociationRecord[]): Record<AssociationKey, AssociationTotals> {
  const totals = {
    contactCompany: emptyAssociationTotals(),
    dealCompany: emptyAssociationTotals(),
    dealContact: emptyAssociationTotals(),
  };
  for (const result of results) {
    const bucket = totals[result.key];
    bucket.planned += 1;
    if (result.status === "create") bucket.created += 1;
    else if (result.status === "skip") bucket.skipped += 1;
    else bucket.failed += 1;
  }
  return totals;
}

function emptyAssociationTotals(): AssociationTotals {
  return { planned: 0, created: 0, skipped: 0, failed: 0 };
}

function issues(records: Record<HubSpotObjectType, PlannedRecord[]>, kind: "errors" | "warnings") {
  const list = [];
  for (const type of OBJECT_TYPES) {
    for (const record of records[type]) {
      for (const issue of record[kind]) {
        list.push({
          object: type,
          rowNumber: record.rowNumber,
          sourceId: record.sourceId,
          field: issue.field,
          message: issue.message,
        });
      }
    }
  }
  return list;
}

function actionsFor(records: Record<HubSpotObjectType, PlannedRecord[]>, mode: "dry-run" | "live"): ActionRecord[] {
  const actions: ActionRecord[] = [];
  for (const type of OBJECT_TYPES) {
    for (const record of records[type]) {
      actions.push({
        object: type,
        rowNumber: record.rowNumber,
        sourceId: record.sourceId,
        action: record.action,
        ...(record.reason ? { reason: record.reason } : {}),
        ...(record.matchedBy ? { matchedBy: record.matchedBy } : {}),
        label: recordLabel(record),
        properties: displayProperties(record, mode),
        labels: record.labels,
      });
    }
  }
  return actions;
}

function displayProperties(record: PlannedRecord, mode: "dry-run" | "live"): Record<string, string> {
  const properties = { ...record.properties };
  if (record.labels.pipeline) properties.pipeline = record.labels.pipeline;
  if (record.labels.stage) properties.dealstage = record.labels.stage;
  if (mode === "live" && record.properties.pipeline && record.labels.pipeline) {
    properties.pipelineId = record.properties.pipeline;
  }
  if (mode === "live" && record.properties.dealstage && record.labels.stage) {
    properties.dealstageId = record.properties.dealstage;
  }
  return properties;
}

function pipelineReport(config: MigrationConfig, schema: EnsuredSchema | undefined): PipelineReport[] {
  return config.pipelines.map((pipeline) => {
    const ensured = schema?.pipelines[pipeline.hubspotLabel];
    return {
      sourceName: pipeline.sourceName,
      hubspotLabel: pipeline.hubspotLabel,
      ...(ensured ? { hubspotId: ensured.id } : {}),
      stages: pipeline.stages.map((stage) => ({
        source: stage.source,
        label: stage.label,
        probability: stage.probability,
        closedWon: Boolean(stage.closedWon),
        closedLost: Boolean(stage.closedLost),
        ...(ensured ? { hubspotId: ensured.stages[stage.label.toLowerCase()] } : {}),
      })),
    };
  });
}

function mappingPreview(config: MigrationConfig): MappingPreview {
  const previewObject = (mapping: MigrationConfig["objects"]["companies"]) => ({
    file: mapping.file,
    idColumn: mapping.idColumn,
    upsertIdProperty: mapping.upsertIdProperty ?? "legacy_external_id",
    ...(mapping.dedupeProperty ? { dedupeProperty: mapping.dedupeProperty } : {}),
    ...(mapping.ownerColumn ? { ownerColumn: mapping.ownerColumn } : {}),
    ...(mapping.dealPipelineColumn ? { dealPipelineColumn: mapping.dealPipelineColumn } : {}),
    ...(mapping.dealStageColumn ? { dealStageColumn: mapping.dealStageColumn } : {}),
    associations: (mapping.associations ?? []).map((association) => ({ column: association.column, to: association.to })),
    fields: mapping.fields.map((field) => ({
      column: field.column,
      property: field.property,
      required: Boolean(field.required),
      transforms: field.transforms ?? [],
      ...(field.valueMap ? { valueMap: field.valueMap } : {}),
    })),
  });
  return {
    source: config.source,
    title: config.title,
    description: config.description,
    objects: {
      companies: previewObject(config.objects.companies),
      contacts: previewObject(config.objects.contacts),
      deals: previewObject(config.objects.deals),
    },
    pipelines: pipelineReport(config, undefined),
    properties: config.properties.map((property) => ({
      object: property.object,
      name: property.name,
      label: property.label,
      hasUniqueValue: Boolean(property.hasUniqueValue),
    })),
  };
}

function associationKey(from: HubSpotObjectType, to: HubSpotObjectType): AssociationKey {
  if (from === "contacts" && to === "companies") return "contactCompany";
  if (from === "deals" && to === "companies") return "dealCompany";
  if (from === "deals" && to === "contacts") return "dealContact";
  throw new Error(`Unsupported association ${from} -> ${to}`);
}

function associationPairKey(result: AssociationRecord): string {
  return `${result.fromObject}:${result.fromSourceId}:${result.toObject}:${result.toSourceId}`;
}

function idProperty(config: MigrationConfig, type: HubSpotObjectType): string {
  return config.objects[type].upsertIdProperty ?? "legacy_external_id";
}

export function assertTotalsIdentity(totals: ObjectTotals): boolean {
  return totals.created + totals.updated + totals.skipped + totals.failed === totals.sourceRows;
}
