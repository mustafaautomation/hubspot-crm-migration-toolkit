import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface Totals {
  sourceRows: number;
  valid: number;
  invalid: number;
  duplicates: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
}

export interface AssocTotals {
  planned: number;
  created: number;
  skipped: number;
  failed: number;
}

export interface Issue {
  object: string;
  rowNumber: number;
  sourceId: string;
  field: string;
  message: string;
}

export interface ActionRow {
  object: string;
  rowNumber: number;
  sourceId: string;
  action: string;
  reason?: string;
  label: string;
  pipeline?: string;
  stage?: string;
}

export interface StageView {
  source: string;
  label: string;
  probability: string;
  hubspotId?: string;
}

export interface PipelineView {
  sourceName: string;
  hubspotLabel: string;
  hubspotId?: string;
  stages: StageView[];
}

export interface FieldView {
  column: string;
  property: string;
  required: boolean;
  transforms: string[];
}

export interface RunView {
  mode: "dry-run" | "live";
  target: string;
  startedAt: string;
  durationMs: number;
  writes: number;
  runId: string;
  command?: string;
  description: string;
  totals: Record<"companies" | "contacts" | "deals", Totals>;
  associations: Record<"contactCompany" | "dealCompany" | "dealContact", AssocTotals>;
  pipelines: PipelineView[];
  validationErrors: Issue[];
  warnings: Issue[];
  notes: string[];
  reconciliation: {
    performed: boolean;
    match: boolean;
    reason?: string;
    objects?: Record<string, { expected: number; readBack: number; match: boolean }>;
    associations?: Record<string, { expected: number; verified: number; match: boolean }>;
  };
  actions: ActionRow[];
}

export interface PhaseView {
  id: string;
  label: string;
  run: RunView;
}

export interface BundleView {
  id: string;
  title: string;
  scenario: string;
  disclaimer: string;
  livePortal: boolean;
  phases: PhaseView[];
  mapping: {
    objects: Record<string, { file: string; fields: FieldView[] }>;
    pipelines: PipelineView[];
  };
}

const OBJECTS = ["companies", "contacts", "deals"] as const;

export function loadBundles(): BundleView[] {
  const bundled = ["salesforce", "pipedrive", "zoho"].flatMap((source) => {
    const path = join(process.cwd(), "data", "bundles", `${source}.json`);
    if (!existsSync(path)) return [];
    return [toBundle(JSON.parse(readFileSync(path, "utf8")) as unknown, source)];
  });
  const reportsDir = join(process.cwd(), "data", "reports");
  const extras = existsSync(reportsDir)
    ? readdirSync(reportsDir)
        .filter((name) => name.endsWith(".json"))
        .map((name) => {
          const raw = JSON.parse(readFileSync(join(reportsDir, name), "utf8")) as unknown;
          return toBundle(raw, name.replace(/\.json$/, ""));
        })
    : [];
  return [...bundled, ...extras];
}

function toBundle(raw: unknown, id: string): BundleView {
  if (isRecord(raw) && isRecord(raw.applied) && isRecord(raw.dryRun)) {
    const applied = presentRun(raw.applied);
    const phases: PhaseView[] = [
      { id: "dryRun", label: "Dry run", run: presentRun(raw.dryRun) },
      { id: "applied", label: "First apply", run: applied },
    ];
    if (isRecord(raw.rerun)) phases.push({ id: "rerun", label: "Second apply", run: presentRun(raw.rerun) });
    return {
      id,
      title: stringField(raw.title, applied.description),
      scenario: stringField(raw.scenario, applied.description),
      disclaimer: stringField(raw.disclaimer, "Portfolio demo, not client work."),
      livePortal: applied.target.includes("api.hubapi.com"),
      phases,
      mapping: presentMapping(raw.applied),
    };
  }
  const run = presentRun(raw);
  return {
    id,
    title: run.description,
    scenario: "Report produced by hubspot-migrate. If this file came from --live, the counts were read back from HubSpot.",
    disclaimer: "Portfolio demo, not client work.",
    livePortal: run.target.includes("api.hubapi.com"),
    phases: [{ id: "recorded", label: "Recorded run", run }],
    mapping: presentMapping(raw),
  };
}

function presentRun(raw: unknown): RunView {
  const report = asRecord(raw, "run");
  const meta = asRecord(report.meta, "meta");
  const totals = asRecord(report.totals, "totals");
  const associations = asRecord(report.associations, "associations");
  return {
    mode: meta.mode === "live" ? "live" : "dry-run",
    target: stringField(meta.target, "unknown"),
    startedAt: stringField(meta.startedAt, ""),
    durationMs: numberField(meta.durationMs),
    writes: numberField(meta.writes),
    runId: stringField(meta.runId, ""),
    ...(typeof meta.command === "string" ? { command: meta.command } : {}),
    description: stringField(meta.description, ""),
    totals: {
      companies: presentTotals(totals.companies),
      contacts: presentTotals(totals.contacts),
      deals: presentTotals(totals.deals),
    },
    associations: {
      contactCompany: presentAssoc(associations.contactCompany),
      dealCompany: presentAssoc(associations.dealCompany),
      dealContact: presentAssoc(associations.dealContact),
    },
    pipelines: Array.isArray(report.pipelines) ? report.pipelines.map(presentPipeline) : [],
    validationErrors: Array.isArray(report.validationErrors) ? report.validationErrors.map(presentIssue) : [],
    warnings: Array.isArray(report.warnings) ? report.warnings.map(presentIssue) : [],
    notes: Array.isArray(report.notes) ? report.notes.filter((note): note is string => typeof note === "string") : [],
    reconciliation: presentReconciliation(report.reconciliation),
    actions: Array.isArray(report.actions) ? report.actions.map(presentAction) : [],
  };
}

function presentMapping(raw: unknown): BundleView["mapping"] {
  const report = asRecord(raw, "run");
  const mapping = asRecord(report.mapping, "mapping");
  const objects = asRecord(mapping.objects, "objects");
  return {
    objects: Object.fromEntries(
      OBJECTS.map((type) => {
        const object = asRecord(objects[type], type);
        const fields = Array.isArray(object.fields) ? object.fields.map(presentField) : [];
        return [type, { file: stringField(object.file, ""), fields }];
      }),
    ),
    pipelines: Array.isArray(mapping.pipelines) ? mapping.pipelines.map(presentPipeline) : [],
  };
}

function presentTotals(raw: unknown): Totals {
  const row = asRecord(raw, "totals");
  return {
    sourceRows: numberField(row.sourceRows),
    valid: numberField(row.valid),
    invalid: numberField(row.invalid),
    duplicates: numberField(row.duplicates),
    created: numberField(row.created),
    updated: numberField(row.updated),
    skipped: numberField(row.skipped),
    failed: numberField(row.failed),
  };
}

function presentAssoc(raw: unknown): AssocTotals {
  const row = asRecord(raw, "associations");
  return {
    planned: numberField(row.planned),
    created: numberField(row.created),
    skipped: numberField(row.skipped),
    failed: numberField(row.failed),
  };
}

function presentPipeline(raw: unknown): PipelineView {
  const row = asRecord(raw, "pipeline");
  return {
    sourceName: stringField(row.sourceName, ""),
    hubspotLabel: stringField(row.hubspotLabel, ""),
    ...(typeof row.hubspotId === "string" ? { hubspotId: row.hubspotId } : {}),
    stages: Array.isArray(row.stages)
      ? row.stages.map((stage) => {
          const item = asRecord(stage, "stage");
          return {
            source: stringField(item.source, ""),
            label: stringField(item.label, ""),
            probability: stringField(item.probability, ""),
            ...(typeof item.hubspotId === "string" ? { hubspotId: item.hubspotId } : {}),
          };
        })
      : [],
  };
}

function presentIssue(raw: unknown): Issue {
  const row = asRecord(raw, "issue");
  return {
    object: stringField(row.object, ""),
    rowNumber: numberField(row.rowNumber),
    sourceId: stringField(row.sourceId, ""),
    field: stringField(row.field, ""),
    message: stringField(row.message, ""),
  };
}

function presentAction(raw: unknown): ActionRow {
  const row = asRecord(raw, "action");
  const labels = isRecord(row.labels) ? row.labels : {};
  return {
    object: stringField(row.object, ""),
    rowNumber: numberField(row.rowNumber),
    sourceId: stringField(row.sourceId, ""),
    action: stringField(row.action, ""),
    ...(typeof row.reason === "string" ? { reason: row.reason } : {}),
    label: stringField(row.label, ""),
    ...(typeof labels.pipeline === "string" ? { pipeline: labels.pipeline } : {}),
    ...(typeof labels.stage === "string" ? { stage: labels.stage } : {}),
  };
}

function presentField(raw: unknown): FieldView {
  const row = asRecord(raw, "field");
  return {
    column: stringField(row.column, ""),
    property: stringField(row.property, ""),
    required: row.required === true,
    transforms: Array.isArray(row.transforms) ? row.transforms.filter((item): item is string => typeof item === "string") : [],
  };
}

function presentReconciliation(raw: unknown): RunView["reconciliation"] {
  const row = asRecord(raw, "reconciliation");
  const objects = isRecord(row.objects)
    ? Object.fromEntries(
        Object.entries(row.objects).map(([key, value]) => {
          const item = asRecord(value, key);
          return [key, { expected: numberField(item.expected), readBack: numberField(item.readBack), match: item.match === true }];
        }),
      )
    : undefined;
  const associations = isRecord(row.associations)
    ? Object.fromEntries(
        Object.entries(row.associations).map(([key, value]) => {
          const item = asRecord(value, key);
          return [key, { expected: numberField(item.expected), verified: numberField(item.verified), match: item.match === true }];
        }),
      )
    : undefined;
  return {
    performed: row.performed === true,
    match: row.match === true,
    ...(typeof row.reason === "string" ? { reason: row.reason } : {}),
    ...(objects ? { objects } : {}),
    ...(associations ? { associations } : {}),
  };
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`Dashboard data is missing ${label}`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringField(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function numberField(value: unknown): number {
  return typeof value === "number" ? value : 0;
}
