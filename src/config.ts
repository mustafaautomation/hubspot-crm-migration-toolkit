import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { z } from "zod";
import { TRANSFORM_NAMES } from "./transforms.js";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const objectType = z.enum(["companies", "contacts", "deals"]);

const fieldSchema = z.object({
  column: z.string().min(1),
  property: z.string().min(1),
  required: z.boolean().optional(),
  transforms: z.array(z.enum(TRANSFORM_NAMES)).optional(),
  valueMap: z.record(z.string()).optional(),
});

const associationSchema = z.object({
  column: z.string().min(1),
  to: objectType,
});

const objectSchema = z.object({
  file: z.string().min(1),
  idColumn: z.string().min(1),
  upsertIdProperty: z.string().min(1).optional(),
  dedupeProperty: z.string().min(1).optional(),
  ownerColumn: z.string().min(1).optional(),
  dealPipelineColumn: z.string().min(1).optional(),
  dealStageColumn: z.string().min(1).optional(),
  associations: z.array(associationSchema).optional(),
  fields: z.array(fieldSchema).min(1),
});

const stageSchema = z.object({
  source: z.string().min(1),
  label: z.string().min(1),
  probability: z.string().regex(/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/, "probability must be between 0 and 1"),
  closedWon: z.boolean().optional(),
  closedLost: z.boolean().optional(),
});

const pipelineSchema = z.object({
  sourceName: z.string().min(1),
  hubspotLabel: z.string().min(1),
  stages: z.array(stageSchema).min(1),
});

const propertySchema = z.object({
  object: objectType,
  name: z.string().regex(/^[a-z][a-z0-9_]*$/, "property names are lowercase HubSpot identifiers"),
  label: z.string().min(1),
  type: z.enum(["string", "number", "date", "datetime", "enumeration"]),
  fieldType: z.string().min(1),
  groupName: z.string().min(1),
  hasUniqueValue: z.boolean().optional(),
  description: z.string().optional(),
});

export const migrationConfigSchema = z.object({
  source: z
    .string()
    .min(1)
    .regex(/^[a-z0-9_-]+$/, "source is a short slug such as salesforce"),
  title: z.string().min(1),
  description: z.string().min(1),
  owners: z
    .array(
      z.object({
        name: z.string().min(1),
        email: z.string().min(3),
      }),
    )
    .optional(),
  properties: z.array(propertySchema).min(1),
  pipelines: z.array(pipelineSchema).min(1),
  objects: z.object({
    companies: objectSchema,
    contacts: objectSchema,
    deals: objectSchema,
  }),
});

export type MigrationConfig = z.infer<typeof migrationConfigSchema>;
export type ObjectMapping = MigrationConfig["objects"]["companies"];
export type FieldMapping = ObjectMapping["fields"][number];
export type PipelineMapping = MigrationConfig["pipelines"][number];
export type PropertyMapping = MigrationConfig["properties"][number];

export function loadConfig(path: string): MigrationConfig {
  let raw: unknown;
  try {
    raw = parse(readFileSync(path, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ConfigError(`Could not read mapping config ${path}: ${message}`);
  }
  return parseConfig(raw);
}

export function parseConfig(data: unknown): MigrationConfig {
  const parsed = migrationConfigSchema.safeParse(data);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new ConfigError(`Invalid mapping config\n${details}`);
  }
  validateConfig(parsed.data);
  return parsed.data;
}

function validateConfig(config: MigrationConfig): void {
  const deals = config.objects.deals;
  if (!deals.dealPipelineColumn || !deals.dealStageColumn) {
    throw new ConfigError("objects.deals requires dealPipelineColumn and dealStageColumn");
  }

  for (const [name, mapping] of Object.entries(config.objects) as [keyof MigrationConfig["objects"], ObjectMapping][]) {
    const upsertId = mapping.upsertIdProperty ?? "legacy_external_id";
    const defined = config.properties.some(
      (property) => property.object === name && property.name === upsertId && property.hasUniqueValue,
    );
    if (!defined) {
      throw new ConfigError(`${name} upsert id "${upsertId}" must be declared with hasUniqueValue: true`);
    }
  }

  const pipelineNames = new Set<string>();
  for (const pipeline of config.pipelines) {
    const key = pipeline.sourceName.toLowerCase();
    if (pipelineNames.has(key)) {
      throw new ConfigError(`duplicate pipeline source name "${pipeline.sourceName}"`);
    }
    pipelineNames.add(key);
    const sources = new Set<string>();
    const labels = new Set<string>();
    for (const stage of pipeline.stages) {
      const sourceKey = stage.source.toLowerCase();
      const labelKey = stage.label.toLowerCase();
      if (sources.has(sourceKey)) {
        throw new ConfigError(`pipeline "${pipeline.sourceName}" repeats source stage "${stage.source}"`);
      }
      if (labels.has(labelKey)) {
        throw new ConfigError(`pipeline "${pipeline.sourceName}" repeats HubSpot stage "${stage.label}"`);
      }
      sources.add(sourceKey);
      labels.add(labelKey);
      if (stage.closedWon && stage.closedLost) {
        throw new ConfigError(`stage "${stage.source}" cannot be both closed won and closed lost`);
      }
      if (stage.closedWon && Number(stage.probability) !== 1) {
        throw new ConfigError(`closed-won stage "${stage.source}" must use probability 1.0`);
      }
      if (stage.closedLost && Number(stage.probability) !== 0) {
        throw new ConfigError(`closed-lost stage "${stage.source}" must use probability 0.0`);
      }
    }
  }

  for (const [name, mapping] of Object.entries(config.objects)) {
    for (const association of mapping.associations ?? []) {
      if (association.to === "deals") {
        throw new ConfigError(`${name} cannot associate to deals in this toolkit`);
      }
    }
  }
}

export interface StageResolution {
  sourcePipeline: string;
  sourceStage: string;
  pipelineLabel: string;
  stageLabel: string;
  probability: string;
}

export function resolveStage(
  config: MigrationConfig,
  pipelineValue: string,
  stageValue: string,
): { ok: true; stage: StageResolution } | { ok: false; message: string; field: string } {
  const pipelineRaw = pipelineValue.trim();
  const stageRaw = stageValue.trim();
  if (!pipelineRaw) {
    return { ok: false, field: "pipeline", message: "missing pipeline" };
  }
  if (!stageRaw) {
    return { ok: false, field: "dealstage", message: "missing stage" };
  }
  const pipeline = config.pipelines.find((item) => item.sourceName.toLowerCase() === pipelineRaw.toLowerCase());
  if (!pipeline) {
    return { ok: false, field: "pipeline", message: `unmapped pipeline "${pipelineRaw}"` };
  }
  const stage = pipeline.stages.find((item) => item.source.toLowerCase() === stageRaw.toLowerCase());
  if (!stage) {
    return {
      ok: false,
      field: "dealstage",
      message: `unmapped stage "${stageRaw}" for pipeline "${pipeline.sourceName}"`,
    };
  }
  return {
    ok: true,
    stage: {
      sourcePipeline: pipeline.sourceName,
      sourceStage: stage.source,
      pipelineLabel: pipeline.hubspotLabel,
      stageLabel: stage.label,
      probability: stage.probability,
    },
  };
}
