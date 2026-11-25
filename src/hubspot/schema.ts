import type { MigrationConfig } from "../config.js";
import type { HubSpotClient, OwnerRecord, PipelineRecord } from "./client.js";

export interface EnsuredPipeline {
  id: string;
  label: string;
  stages: Record<string, string>;
}

export interface EnsuredSchema {
  pipelines: Record<string, EnsuredPipeline>;
  owners: OwnerRecord[];
}

export async function ensureSchema(client: HubSpotClient, config: MigrationConfig): Promise<EnsuredSchema> {
  for (const property of config.properties) {
    const existing = await client.getProperty(property.object, property.name);
    if (existing) continue;
    await client.createProperty(property.object, {
      name: property.name,
      label: property.label,
      type: property.type,
      fieldType: property.fieldType,
      groupName: property.groupName,
      hasUniqueValue: property.hasUniqueValue,
      description: property.description,
    });
  }

  const pipelines = await ensurePipelines(client, config);
  const owners = await client.listOwners();
  return { pipelines, owners };
}

async function ensurePipelines(client: HubSpotClient, config: MigrationConfig): Promise<Record<string, EnsuredPipeline>> {
  const existing = await client.listPipelines();
  const byLabel = new Map(existing.map((pipeline) => [pipeline.label.toLowerCase(), pipeline]));
  const ensured: Record<string, EnsuredPipeline> = {};

  for (const [index, pipeline] of config.pipelines.entries()) {
    let current = byLabel.get(pipeline.hubspotLabel.toLowerCase());
    if (!current) {
      current = await client.createPipeline({
        label: pipeline.hubspotLabel,
        displayOrder: index,
        stages: pipeline.stages.map((stage, stageIndex) => ({
          label: stage.label,
          displayOrder: stageIndex,
          metadata: { probability: stage.probability },
        })),
      });
      byLabel.set(current.label.toLowerCase(), current);
    } else {
      current = await addMissingStages(client, current, pipeline.stages);
      byLabel.set(current.label.toLowerCase(), current);
    }
    ensured[pipeline.hubspotLabel] = {
      id: current.id,
      label: current.label,
      stages: Object.fromEntries(current.stages.map((stage) => [stage.label.toLowerCase(), stage.id])),
    };
  }
  return ensured;
}

async function addMissingStages(
  client: HubSpotClient,
  pipeline: PipelineRecord,
  stages: MigrationConfig["pipelines"][number]["stages"],
): Promise<PipelineRecord> {
  const present = new Set(pipeline.stages.map((stage) => stage.label.toLowerCase()));
  for (const [index, stage] of stages.entries()) {
    if (present.has(stage.label.toLowerCase())) continue;
    const created = await client.createStage(pipeline.id, {
      label: stage.label,
      displayOrder: pipeline.stages.length + index,
      metadata: { probability: stage.probability },
    });
    pipeline.stages.push(created);
    present.add(stage.label.toLowerCase());
  }
  return pipeline;
}
