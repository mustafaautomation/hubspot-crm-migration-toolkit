import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { HubSpotObjectType, RowAction } from "./types.js";

export interface CheckpointRecord {
  hubspotId: string;
  action: Extract<RowAction, "create" | "update">;
}

export interface Checkpoint {
  version: 1;
  source: string;
  updatedAt: string;
  records: Record<HubSpotObjectType, Record<string, CheckpointRecord>>;
  associations: string[];
}

export function emptyCheckpoint(source: string): Checkpoint {
  return {
    version: 1,
    source,
    updatedAt: new Date().toISOString(),
    records: { companies: {}, contacts: {}, deals: {} },
    associations: [],
  };
}

export function loadCheckpoint(path: string): Checkpoint {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read checkpoint ${path}: ${message}`);
  }
  if (!raw || typeof raw !== "object") throw new Error(`Checkpoint ${path} is not an object`);
  const value = raw as Partial<Checkpoint>;
  if (value.version !== 1 || !value.source || !value.records) {
    throw new Error(`Checkpoint ${path} is not a version 1 migration checkpoint`);
  }
  return {
    version: 1,
    source: value.source,
    updatedAt: value.updatedAt ?? new Date().toISOString(),
    records: {
      companies: value.records.companies ?? {},
      contacts: value.records.contacts ?? {},
      deals: value.records.deals ?? {},
    },
    associations: value.associations ?? [],
  };
}

export function saveCheckpoint(path: string, checkpoint: Checkpoint): void {
  checkpoint.updatedAt = new Date().toISOString();
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, JSON.stringify(checkpoint, null, 2));
  renameSync(temporary, path);
}
