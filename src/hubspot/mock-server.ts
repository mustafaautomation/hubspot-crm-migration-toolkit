import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { HubSpotObjectType } from "../types.js";
import type { PipelineRecord, PipelineStage, PropertyDefinition } from "./client.js";

interface StoredObject {
  id: string;
  properties: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface MockAssociation {
  fromType: HubSpotObjectType;
  fromId: string;
  toType: HubSpotObjectType;
  toId: string;
  typeId: number;
}

interface FailRule {
  includes: string;
  n: number;
  seen: number;
  status: number;
}

export interface MockHubSpot {
  url: string;
  close: () => Promise<void>;
  seedOwner: (owner: { id?: string; email: string; firstName: string; lastName: string }) => void;
  seedObject: (type: HubSpotObjectType, properties: Record<string, string>) => string;
  count: (type: HubSpotObjectType) => number;
  objects: (type: HubSpotObjectType) => { id: string; properties: Record<string, string> }[];
  pipelines: () => PipelineRecord[];
  propertyNames: (type: HubSpotObjectType) => string[];
  associations: () => MockAssociation[];
  mutations: { method: string; path: string }[];
  writeCount: number;
  upsertIds: (type: HubSpotObjectType) => string[];
  failNext: (status: number, headers?: Record<string, string>) => void;
  failNth: (pathIncludes: string, n: number, status?: number) => void;
}

const STANDARD_PROPERTIES = [
  "email",
  "firstname",
  "lastname",
  "phone",
  "mobilephone",
  "company",
  "jobtitle",
  "lifecyclestage",
  "domain",
  "name",
  "industry",
  "city",
  "state",
  "country",
  "numberofemployees",
  "description",
  "dealname",
  "amount",
  "closedate",
  "pipeline",
  "dealstage",
  "dealtype",
  "hubspot_owner_id",
];

export async function startMockHubSpot(): Promise<MockHubSpot> {
  const state = createState();
  const server = createServer((request, response) => {
    void handle(request, response, state).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "mock error";
      send(response, 500, { message });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
    seedOwner: (owner) => {
      state.owners.push({
        id: owner.id ?? String(++state.sequence),
        email: owner.email,
        firstName: owner.firstName,
        lastName: owner.lastName,
      });
    },
    seedObject: (type, properties) => {
      const object = storeObject(state, type, properties);
      return object.id;
    },
    count: (type) => state.objects[type].size,
    objects: (type) =>
      [...state.objects[type].values()].map((object) => ({ id: object.id, properties: { ...object.properties } })),
    pipelines: () => state.pipelines.map(clonePipeline),
    propertyNames: (type) => [...state.properties[type].keys()],
    associations: () => state.associations.map((association) => ({ ...association })),
    get mutations() {
      return state.mutations.map((mutation) => ({ ...mutation }));
    },
    get writeCount() {
      return state.writeCount;
    },
    upsertIds: (type) => state.upsertLog.filter((entry) => entry.type === type).map((entry) => entry.idValue),
    failNext: (status, headers) => {
      state.immediateFailures.push({ status, headers });
    },
    failNth: (pathIncludes, n, status = 500) => {
      state.failRules.push({ includes: pathIncludes, n, seen: 0, status });
    },
  };
}

interface MockState {
  sequence: number;
  objects: Record<HubSpotObjectType, Map<string, StoredObject>>;
  properties: Record<HubSpotObjectType, Map<string, PropertyDefinition>>;
  pipelines: PipelineRecord[];
  associations: MockAssociation[];
  owners: { id: string; email: string; firstName: string; lastName: string }[];
  mutations: { method: string; path: string }[];
  upsertLog: { type: HubSpotObjectType; idValue: string }[];
  writeCount: number;
  immediateFailures: { status: number; headers?: Record<string, string> }[];
  failRules: FailRule[];
}

function createState(): MockState {
  const properties = {
    companies: new Map<string, PropertyDefinition>(),
    contacts: new Map<string, PropertyDefinition>(),
    deals: new Map<string, PropertyDefinition>(),
  };
  for (const type of ["companies", "contacts", "deals"] as const) {
    for (const name of STANDARD_PROPERTIES) {
      properties[type].set(name, {
        name,
        label: name,
        type: "string",
        fieldType: "text",
        groupName: "standard",
        hasUniqueValue: name === "email",
      });
    }
  }
  return {
    sequence: 1000,
    objects: { companies: new Map(), contacts: new Map(), deals: new Map() },
    properties,
    pipelines: [],
    associations: [],
    owners: [],
    mutations: [],
    upsertLog: [],
    writeCount: 0,
    immediateFailures: [],
    failRules: [],
  };
}

async function handle(request: IncomingMessage, response: ServerResponse, state: MockState): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const path = url.pathname.replace(/\/$/, "") || "/";
  if (request.headers.authorization !== "Bearer test-token") {
    send(response, 401, { message: "unauthorized" });
    return;
  }
  const body = await readBody(request);
  const immediate = state.immediateFailures.shift();
  if (immediate) {
    send(
      response,
      immediate.status,
      { status: "error", message: "rate limited", errorType: "RATE_LIMIT" },
      immediate.headers,
    );
    return;
  }
  if (isMutation(method, path)) {
    for (const rule of state.failRules) {
      if (!path.includes(rule.includes)) continue;
      rule.seen += 1;
      if (rule.seen === rule.n) {
        send(response, rule.status, { message: "injected failure" });
        return;
      }
    }
  }
  const parsed = body ? (JSON.parse(body) as unknown) : undefined;
  route(method, path, parsed, response, state);
}

function route(method: string, path: string, body: unknown, response: ServerResponse, state: MockState): void {
  const objectMatch = /^\/crm\/v3\/objects\/(companies|contacts|deals)\/(.+)$/.exec(path);
  if (objectMatch && method === "POST") {
    const type = objectMatch[1] as HubSpotObjectType;
    const action = objectMatch[2];
    if (action === "batch/upsert") return upsert(type, body, response, state, path);
    if (action === "batch/update") return update(type, body, response, state, path);
    if (action === "search") return search(type, body, response, state);
  }

  const propertyList = /^\/crm\/v3\/properties\/(companies|contacts|deals)$/.exec(path);
  if (propertyList && method === "POST") return createProperty(propertyList[1] as HubSpotObjectType, body, response, state, path);

  const propertyGet = /^\/crm\/v3\/properties\/(companies|contacts|deals)\/([^/]+)$/.exec(path);
  if (propertyGet && method === "GET") {
    const type = propertyGet[1] as HubSpotObjectType;
    const name = decodeURIComponent(propertyGet[2]);
    const property = state.properties[type].get(name);
    if (!property) return send(response, 404, { message: `Property "${name}" does not exist` });
    return send(response, 200, property);
  }

  if (path === "/crm/v3/pipelines/deals" && method === "GET") return send(response, 200, { results: state.pipelines });
  if (path === "/crm/v3/pipelines/deals" && method === "POST") return createPipeline(body, response, state, path);

  const stageCreate = /^\/crm\/v3\/pipelines\/deals\/([^/]+)\/stages$/.exec(path);
  if (stageCreate && method === "POST") return createStage(decodeURIComponent(stageCreate[1]), body, response, state, path);

  if (path === "/crm/v3/owners" && method === "GET") return send(response, 200, { results: state.owners });

  const association = /^\/crm\/v4\/associations\/(companies|contacts|deals)\/(companies|contacts|deals)\/batch\/(create|read)$/.exec(path);
  if (association && method === "POST") {
    const from = association[1] as HubSpotObjectType;
    const to = association[2] as HubSpotObjectType;
    if (association[3] === "create") return createAssociations(from, to, body, response, state, path);
    return readAssociations(from, to, body, response, state);
  }

  send(response, 404, { message: `no mock route for ${method} ${path}` });
}

function upsert(type: HubSpotObjectType, body: unknown, response: ServerResponse, state: MockState, path: string): void {
  const inputs = inputsOf<{ idProperty?: string; id?: string; properties?: Record<string, string> }>(body);
  if (!inputs || inputs.length > 100) return send(response, 400, { message: "invalid upsert batch" });
  const drafts = inputs.map((input) => {
    const idProperty = input.idProperty ?? "";
    const idValue = String(input.id ?? "");
    if (!idProperty || !idValue) return null;
    if (!state.properties[type].has(idProperty)) return { missing: idProperty };
    const properties = { ...(input.properties ?? {}), [idProperty]: idValue };
    return { idProperty, idValue, properties };
  });
  if (drafts.some((draft) => draft && "missing" in draft)) {
    const missing = drafts.find((draft) => draft && "missing" in draft) as { missing: string };
    return send(response, 400, { message: `Property "${missing.missing}" does not exist` });
  }
  const ready = drafts as { idProperty: string; idValue: string; properties: Record<string, string> }[];
  for (const draft of ready) {
    const conflict = findConflict(state, type, draft.properties, draft.idProperty, draft.idValue);
    if (conflict) return send(response, 409, { message: `property ${conflict} is not unique` });
  }
  for (const draft of ready) state.upsertLog.push({ type, idValue: draft.idValue });
  const results = ready.map((draft) => {
    const existing = findByProperty(state, type, draft.idProperty, draft.idValue);
    if (existing) {
      existing.properties = { ...existing.properties, ...draft.properties };
      existing.updatedAt = new Date().toISOString();
      return present(existing, false);
    }
    const created = storeObject(state, type, draft.properties);
    return present(created, true);
  });
  state.writeCount += 1;
  state.mutations.push({ method: "POST", path });
  send(response, 200, { status: "COMPLETE", results });
}

function update(type: HubSpotObjectType, body: unknown, response: ServerResponse, state: MockState, path: string): void {
  const inputs = inputsOf<{ id?: string; properties?: Record<string, string> }>(body);
  if (!inputs || inputs.length > 100) return send(response, 400, { message: "invalid update batch" });
  const objects = inputs.map((input) => state.objects[type].get(String(input.id ?? "")));
  if (objects.some((object) => !object)) return send(response, 404, { message: "object not found" });
  const results = objects.map((object, index) => {
    const current = object as StoredObject;
    current.properties = { ...current.properties, ...(inputs[index].properties ?? {}) };
    current.updatedAt = new Date().toISOString();
    return present(current, false);
  });
  state.writeCount += 1;
  state.mutations.push({ method: "POST", path });
  send(response, 200, { status: "COMPLETE", results });
}

function search(type: HubSpotObjectType, body: unknown, response: ServerResponse, state: MockState): void {
  const payload = (body ?? {}) as {
    filterGroups?: { filters?: { propertyName?: string; operator?: string; value?: string; values?: string[] }[] }[];
    properties?: string[];
    limit?: number;
    after?: string;
  };
  for (const group of payload.filterGroups ?? []) {
    for (const filter of group.filters ?? []) {
      if (filter.propertyName && !state.properties[type].has(filter.propertyName)) {
        return send(response, 400, { message: `Property "${filter.propertyName}" does not exist` });
      }
    }
  }
  const matched = [...state.objects[type].values()].filter((object) => matches(object, payload.filterGroups));
  const limit = Math.min(payload.limit ?? 100, 100);
  const offset = Number(payload.after ?? "0") || 0;
  const page = matched.slice(offset, offset + limit);
  const next = offset + limit < matched.length ? String(offset + limit) : undefined;
  send(response, 200, {
    total: matched.length,
    results: page.map((object) => ({
      id: object.id,
      properties: pick(object.properties, payload.properties),
    })),
    ...(next ? { paging: { next: { after: next } } } : {}),
  });
}

function createProperty(
  type: HubSpotObjectType,
  body: unknown,
  response: ServerResponse,
  state: MockState,
  path: string,
): void {
  const property = body as PropertyDefinition;
  if (!property?.name || !property.label || !property.type || !property.fieldType || !property.groupName) {
    return send(response, 400, { message: "invalid property" });
  }
  if (state.properties[type].has(property.name)) return send(response, 409, { message: "property exists" });
  state.properties[type].set(property.name, property);
  state.writeCount += 1;
  state.mutations.push({ method: "POST", path });
  send(response, 201, property);
}

function createPipeline(body: unknown, response: ServerResponse, state: MockState, path: string): void {
  const input = body as { label?: string; displayOrder?: number; stages?: { label?: string; displayOrder?: number; metadata?: { probability?: string } }[] };
  if (!input?.label || !input.stages?.length) return send(response, 400, { message: "invalid pipeline" });
  if (state.pipelines.some((pipeline) => pipeline.label.toLowerCase() === input.label?.toLowerCase())) {
    return send(response, 409, { message: "pipeline exists" });
  }
  const pipeline: PipelineRecord = {
    id: String(++state.sequence),
    label: input.label,
    displayOrder: input.displayOrder ?? 0,
    stages: input.stages.map((stage) => ({
      id: String(++state.sequence),
      label: stage.label ?? "",
      displayOrder: stage.displayOrder ?? 0,
      metadata: { probability: String(stage.metadata?.probability ?? "0") },
    })),
  };
  state.pipelines.push(pipeline);
  state.writeCount += 1;
  state.mutations.push({ method: "POST", path });
  send(response, 201, pipeline);
}

function createStage(pipelineId: string, body: unknown, response: ServerResponse, state: MockState, path: string): void {
  const pipeline = state.pipelines.find((item) => item.id === pipelineId);
  if (!pipeline) return send(response, 404, { message: "pipeline not found" });
  const stage = body as { label?: string; displayOrder?: number; metadata?: { probability?: string } };
  if (!stage?.label) return send(response, 400, { message: "invalid stage" });
  if (pipeline.stages.some((item) => item.label.toLowerCase() === stage.label?.toLowerCase())) {
    return send(response, 409, { message: "stage exists" });
  }
  const created: PipelineStage = {
    id: String(++state.sequence),
    label: stage.label,
    displayOrder: stage.displayOrder ?? pipeline.stages.length,
    metadata: { probability: String(stage.metadata?.probability ?? "0") },
  };
  pipeline.stages.push(created);
  state.writeCount += 1;
  state.mutations.push({ method: "POST", path });
  send(response, 201, created);
}

function createAssociations(
  from: HubSpotObjectType,
  to: HubSpotObjectType,
  body: unknown,
  response: ServerResponse,
  state: MockState,
  path: string,
): void {
  const inputs = inputsOf<{ from?: { id?: string }; to?: { id?: string }; types?: { associationTypeId?: number }[] }>(body);
  if (!inputs || inputs.length > 100) return send(response, 400, { message: "invalid association batch" });
  for (const input of inputs) {
    const fromId = String(input.from?.id ?? "");
    const toId = String(input.to?.id ?? "");
    if (!state.objects[from].has(fromId) || !state.objects[to].has(toId)) {
      return send(response, 404, { message: "association endpoint not found" });
    }
  }
  const results = inputs.map((input) => {
    const fromId = String(input.from?.id ?? "");
    const toId = String(input.to?.id ?? "");
    const typeId = input.types?.[0]?.associationTypeId ?? 0;
    const existing = state.associations.find(
      (association) =>
        association.fromType === from &&
        association.fromId === fromId &&
        association.toType === to &&
        association.toId === toId &&
        association.typeId === typeId,
    );
    if (!existing) state.associations.push({ fromType: from, fromId, toType: to, toId, typeId });
    return { from: { id: fromId }, to: { id: toId } };
  });
  state.writeCount += 1;
  state.mutations.push({ method: "POST", path });
  send(response, 200, { status: "COMPLETE", results });
}

function readAssociations(from: HubSpotObjectType, to: HubSpotObjectType, body: unknown, response: ServerResponse, state: MockState): void {
  const inputs = inputsOf<{ id?: string }>(body);
  if (!inputs) return send(response, 400, { message: "invalid association read" });
  const results = inputs.map((input) => {
    const fromId = String(input.id ?? "");
    const linked = state.associations.filter(
      (association) => association.fromType === from && association.fromId === fromId && association.toType === to,
    );
    return {
      from: { id: fromId },
      to: linked.map((association) => ({
        toObjectId: Number(association.toId),
        associationTypes: [{ associationTypeId: association.typeId }],
      })),
    };
  });
  send(response, 200, { status: "COMPLETE", results });
}

function matches(
  object: StoredObject,
  groups: { filters?: { propertyName?: string; operator?: string; value?: string; values?: string[] }[] }[] | undefined,
): boolean {
  if (!groups || groups.length === 0) return true;
  return groups.some((group) =>
    (group.filters ?? []).every((filter) => {
      const actual = (object.properties[filter.propertyName ?? ""] ?? "").toLowerCase();
      if (filter.operator === "EQ") return actual === String(filter.value ?? "").toLowerCase();
      if (filter.operator === "IN") return (filter.values ?? []).some((value) => actual === value.toLowerCase());
      return false;
    }),
  );
}

function findByProperty(state: MockState, type: HubSpotObjectType, property: string, value: string): StoredObject | undefined {
  const needle = value.toLowerCase();
  return [...state.objects[type].values()].find((object) => (object.properties[property] ?? "").toLowerCase() === needle);
}

function findConflict(
  state: MockState,
  type: HubSpotObjectType,
  properties: Record<string, string>,
  idProperty: string,
  idValue: string,
): string | null {
  for (const [name, definition] of state.properties[type]) {
    if (!definition.hasUniqueValue || !properties[name]) continue;
    const owner = findByProperty(state, type, name, properties[name]);
    if (!owner) continue;
    const ownerKey = owner.properties[idProperty];
    if (name === idProperty && ownerKey?.toLowerCase() === idValue.toLowerCase()) continue;
    if (ownerKey?.toLowerCase() === idValue.toLowerCase()) continue;
    return name;
  }
  return null;
}

function storeObject(state: MockState, type: HubSpotObjectType, properties: Record<string, string>): StoredObject {
  const now = new Date().toISOString();
  const object: StoredObject = {
    id: String(++state.sequence),
    properties: { ...properties },
    createdAt: now,
    updatedAt: now,
  };
  state.objects[type].set(object.id, object);
  return object;
}

function present(object: StoredObject, created: boolean) {
  return {
    id: object.id,
    new: created,
    properties: { ...object.properties, hs_object_id: object.id },
    createdAt: object.createdAt,
    updatedAt: object.updatedAt,
  };
}

function pick(properties: Record<string, string>, requested: string[] | undefined): Record<string, string> {
  const source = requested?.length ? requested : Object.keys(properties);
  const out: Record<string, string> = { hs_object_id: properties.hs_object_id ?? "" };
  for (const key of source) {
    if (properties[key]) out[key] = properties[key];
  }
  if (!out.hs_object_id) delete out.hs_object_id;
  return out;
}

function inputsOf<T>(body: unknown): T[] | null {
  if (!body || typeof body !== "object" || !("inputs" in body) || !Array.isArray((body as { inputs: unknown }).inputs)) {
    return null;
  }
  return (body as { inputs: T[] }).inputs;
}

function isMutation(method: string, path: string): boolean {
  if (method !== "POST") return false;
  if (path.endsWith("/search") || path.endsWith("/batch/read")) return false;
  return true;
}

function clonePipeline(pipeline: PipelineRecord): PipelineRecord {
  return { ...pipeline, stages: pipeline.stages.map((stage) => ({ ...stage, metadata: { ...stage.metadata } })) };
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function send(response: ServerResponse, status: number, body: unknown, headers?: Record<string, string>): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
    ...headers,
  });
  response.end(payload);
}
