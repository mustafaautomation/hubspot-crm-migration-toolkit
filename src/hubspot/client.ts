import { chunk } from "../chunk.js";
import type { HubSpotObjectType } from "../types.js";
import { computeDelay } from "./retry.js";

export class HubSpotError extends Error {
  readonly status: number;
  readonly body: string;
  readonly retryAfter: string | null;

  constructor(status: number, body: string, retryAfter: string | null) {
    super(`HubSpot API ${status}: ${body.slice(0, 500)}`);
    this.name = "HubSpotError";
    this.status = status;
    this.body = body;
    this.retryAfter = retryAfter;
  }
}

export interface HubSpotObject {
  id: string;
  properties: Record<string, string>;
}

export interface UpsertInput {
  idProperty: string;
  id: string;
  properties: Record<string, string>;
}

export interface UpsertResult extends HubSpotObject {
  created: boolean;
}

export interface OwnerRecord {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

export interface PropertyDefinition {
  name: string;
  label: string;
  type: string;
  fieldType: string;
  groupName: string;
  hasUniqueValue?: boolean;
  description?: string;
}

export interface PipelineStageDraft {
  label: string;
  displayOrder: number;
  metadata: { probability: string };
}

export interface PipelineStage extends PipelineStageDraft {
  id: string;
}

export interface PipelineRecord {
  id: string;
  label: string;
  displayOrder: number;
  stages: PipelineStage[];
}

export interface AssociationWrite {
  fromId: string;
  toId: string;
  typeId: number;
}

export interface ClientOptions {
  token: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

const BATCH_LIMIT = 100;

export class HubSpotClient {
  readonly baseUrl: string;
  mutatingRequests = 0;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;

  constructor(options: ClientOptions) {
    if (!options.token) throw new Error("A HubSpot token is required");
    this.token = options.token;
    this.baseUrl = (options.baseUrl ?? "https://api.hubapi.com").replace(/\/$/, "");
    this.fetchImpl = options.fetch ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.random = options.random ?? Math.random;
    this.maxRetries = options.maxRetries ?? 6;
    this.baseDelayMs = options.baseDelayMs ?? 500;
    this.maxDelayMs = options.maxDelayMs ?? 30_000;
  }

  async getProperty(type: HubSpotObjectType, name: string): Promise<PropertyDefinition | null> {
    try {
      return (await this.request("GET", `/crm/v3/properties/${type}/${encodeURIComponent(name)}`)) as PropertyDefinition;
    } catch (error) {
      if (error instanceof HubSpotError && error.status === 404) return null;
      throw error;
    }
  }

  async createProperty(type: HubSpotObjectType, property: PropertyDefinition): Promise<PropertyDefinition> {
    const created = (await this.request("POST", `/crm/v3/properties/${type}`, {
      name: property.name,
      label: property.label,
      type: property.type,
      fieldType: property.fieldType,
      groupName: property.groupName,
      hasUniqueValue: Boolean(property.hasUniqueValue),
      formField: false,
      ...(property.description ? { description: property.description } : {}),
    })) as PropertyDefinition;
    this.mutatingRequests += 1;
    return created;
  }

  async listPipelines(): Promise<PipelineRecord[]> {
    const payload = (await this.request("GET", "/crm/v3/pipelines/deals")) as { results?: PipelineRecord[] };
    return (payload.results ?? []).map(normalizePipeline);
  }

  async createPipeline(input: {
    label: string;
    displayOrder: number;
    stages: PipelineStageDraft[];
  }): Promise<PipelineRecord> {
    const created = (await this.request("POST", "/crm/v3/pipelines/deals", input)) as PipelineRecord;
    this.mutatingRequests += 1;
    return normalizePipeline(created);
  }

  async createStage(pipelineId: string, stage: PipelineStageDraft): Promise<PipelineStage> {
    const created = (await this.request(
      "POST",
      `/crm/v3/pipelines/deals/${encodeURIComponent(pipelineId)}/stages`,
      stage,
    )) as PipelineStage;
    this.mutatingRequests += 1;
    return created;
  }

  async listOwners(): Promise<OwnerRecord[]> {
    const owners: OwnerRecord[] = [];
    let after: string | undefined;
    do {
      const query = new URLSearchParams({ limit: "100" });
      if (after) query.set("after", after);
      const page = (await this.request("GET", `/crm/v3/owners?${query.toString()}`)) as {
        results?: { id: string | number; email?: string; firstName?: string; lastName?: string }[];
        paging?: { next?: { after?: string } };
      };
      for (const owner of page.results ?? []) {
        owners.push({
          id: String(owner.id),
          email: owner.email ?? "",
          firstName: owner.firstName ?? "",
          lastName: owner.lastName ?? "",
        });
      }
      after = page.paging?.next?.after;
    } while (after);
    return owners;
  }

  async searchByValues(
    type: HubSpotObjectType,
    property: string,
    values: string[],
    returnProperties: string[],
  ): Promise<HubSpotObject[]> {
    const unique = [...new Set(values.filter(Boolean))];
    const found: HubSpotObject[] = [];
    for (const valuesChunk of chunk(unique, BATCH_LIMIT)) {
      let after: string | undefined;
      do {
        const page = (await this.request("POST", `/crm/v3/objects/${type}/search`, {
          filterGroups: [
            {
              filters: [{ propertyName: property, operator: "IN", values: valuesChunk }],
            },
          ],
          properties: returnProperties,
          limit: BATCH_LIMIT,
          ...(after ? { after } : {}),
        })) as {
          results?: { id: string | number; properties?: Record<string, string | null> }[];
          paging?: { next?: { after?: string } };
        };
        for (const row of page.results ?? []) {
          found.push({ id: String(row.id), properties: stringifyProperties(row.properties) });
        }
        after = page.paging?.next?.after;
      } while (after);
    }
    return found;
  }

  async upsert(type: HubSpotObjectType, inputs: UpsertInput[]): Promise<UpsertResult[]> {
    if (inputs.length === 0) return [];
    assertBatch(inputs.length);
    const payload = (await this.request("POST", `/crm/v3/objects/${type}/batch/upsert`, {
      inputs: inputs.map((input) => ({
        idProperty: input.idProperty,
        id: input.id,
        properties: input.properties,
      })),
    })) as { results?: { id: string | number; new?: boolean; properties?: Record<string, string | null> }[] };
    this.mutatingRequests += 1;
    return mapResults(payload.results, inputs.length);
  }

  async update(
    type: HubSpotObjectType,
    inputs: { id: string; properties: Record<string, string> }[],
  ): Promise<HubSpotObject[]> {
    if (inputs.length === 0) return [];
    assertBatch(inputs.length);
    const payload = (await this.request("POST", `/crm/v3/objects/${type}/batch/update`, {
      inputs,
    })) as { results?: { id: string | number; properties?: Record<string, string | null> }[] };
    this.mutatingRequests += 1;
    const results = payload.results ?? [];
    if (results.length !== inputs.length) {
      throw new HubSpotError(502, `batch update returned ${results.length} of ${inputs.length}`, null);
    }
    return results.map((row) => ({ id: String(row.id), properties: stringifyProperties(row.properties) }));
  }

  async createAssociations(from: HubSpotObjectType, to: HubSpotObjectType, inputs: AssociationWrite[]): Promise<void> {
    if (inputs.length === 0) return;
    assertBatch(inputs.length);
    await this.request("POST", `/crm/v4/associations/${from}/${to}/batch/create`, {
      inputs: inputs.map((input) => ({
        from: { id: input.fromId },
        to: { id: input.toId },
        types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: input.typeId }],
      })),
    });
    this.mutatingRequests += 1;
  }

  async readAssociations(
    from: HubSpotObjectType,
    to: HubSpotObjectType,
    ids: string[],
  ): Promise<{ fromId: string; toIds: string[] }[]> {
    const rows: { fromId: string; toIds: string[] }[] = [];
    for (const group of chunk(ids, BATCH_LIMIT)) {
      const payload = (await this.request("POST", `/crm/v4/associations/${from}/${to}/batch/read`, {
        inputs: group.map((id) => ({ id })),
      })) as {
        results?: { from?: { id?: string | number }; to?: { toObjectId?: string | number }[] }[];
      };
      for (const row of payload.results ?? []) {
        rows.push({
          fromId: String(row.from?.id ?? ""),
          toIds: (row.to ?? []).map((item) => String(item.toObjectId)),
        });
      }
    }
    return rows;
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    let attempt = 0;
    for (;;) {
      const response = await this.fetchImpl(new URL(path, `${this.baseUrl}/`), {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/json",
          "User-Agent": "hubspot-crm-migration-toolkit",
          ...(payload ? { "Content-Type": "application/json" } : {}),
        },
        body: payload,
      });
      const text = await response.text();
      if (response.status === 429) {
        const retryAfter = response.headers.get("retry-after");
        if (attempt >= this.maxRetries) throw new HubSpotError(429, text, retryAfter);
        const delay = computeDelay({
          attempt,
          retryAfter,
          random: this.random,
          baseDelayMs: this.baseDelayMs,
          maxDelayMs: this.maxDelayMs,
        });
        await this.sleep(delay);
        attempt += 1;
        continue;
      }
      if (!response.ok) throw new HubSpotError(response.status, text, response.headers.get("retry-after"));
      if (!text) return {};
      return JSON.parse(text) as unknown;
    }
  }
}

export function createHubSpotClient(options: ClientOptions): HubSpotClient {
  return new HubSpotClient(options);
}

/**
 * Default HubSpot-defined association type ids (unlabeled):
 * contact→company 1, deal→contact 3, deal→company 5.
 */
export function associationTypeId(from: HubSpotObjectType, to: HubSpotObjectType): number {
  if (from === "contacts" && to === "companies") return 1;
  if (from === "deals" && to === "contacts") return 3;
  if (from === "deals" && to === "companies") return 5;
  throw new Error(`Unsupported association ${from} -> ${to}`);
}

export function isMissingPropertyError(error: unknown): boolean {
  return error instanceof HubSpotError && error.status === 400 && /property/i.test(error.body);
}

function assertBatch(length: number): void {
  if (length > BATCH_LIMIT) throw new Error(`HubSpot batch limit is ${BATCH_LIMIT}`);
}

function stringifyProperties(properties: Record<string, string | null> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(properties ?? {})) {
    if (value != null && value !== "") out[key] = String(value);
  }
  return out;
}

function mapResults(
  results: { id: string | number; new?: boolean; properties?: Record<string, string | null> }[] | undefined,
  expected: number,
): UpsertResult[] {
  const rows = results ?? [];
  if (rows.length !== expected) {
    throw new HubSpotError(502, `batch upsert returned ${rows.length} of ${expected}`, null);
  }
  return rows.map((row) => ({
    id: String(row.id),
    created: Boolean(row.new),
    properties: stringifyProperties(row.properties),
  }));
}

function normalizePipeline(pipeline: PipelineRecord): PipelineRecord {
  return {
    id: String(pipeline.id),
    label: pipeline.label,
    displayOrder: pipeline.displayOrder,
    stages: (pipeline.stages ?? []).map((stage) => ({
      id: String(stage.id),
      label: stage.label,
      displayOrder: stage.displayOrder,
      metadata: { probability: String(stage.metadata?.probability ?? "0") },
    })),
  };
}
