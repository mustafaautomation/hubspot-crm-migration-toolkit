#!/usr/bin/env node
import { Command } from "commander";
import { loadConfig } from "./config.js";
import { createHubSpotClient } from "./hubspot/client.js";
import { runMigration, silentLogger, type Logger } from "./migrate.js";
import { renderSummary, writeReportFiles } from "./report.js";

const program = new Command();

program
  .name("hubspot-migrate")
  .description("Migrate legacy CRM CSV exports into a HubSpot sandbox. Portfolio demo, not client work.")
  .showHelpAfterError();

program
  .command("run")
  .description("Validate, dedupe, and upsert companies, contacts, and deals")
  .requiredOption("-c, --config <path>", "mapping YAML or JSON")
  .requiredOption("-i, --input <dir>", "directory of source CSV exports")
  .option("--dry-run", "report creates, updates, and skips without writing")
  .option("--live", "ensure schema and write to HubSpot")
  .option("-o, --out <basename>", "write report .json, .md, and .html using this path stem")
  .option("--token <token>", "private app token (defaults to HUBSPOT_TOKEN)")
  .option("--base-url <url>", "API base URL (defaults to HUBSPOT_BASE_URL or https://api.hubapi.com)")
  .option("--resume <checkpoint>", "continue a live run from a checkpoint file")
  .option("--checkpoint <path>", "where to save live-run progress")
  .option("--batch-size <n>", "records per HubSpot batch (1-100)", (value) => Number(value))
  .option("--quiet", "suppress progress logs")
  .action(async (options: CliOptions) => {
    if (options.live && options.dryRun) {
      throw new Error("Choose either --dry-run or --live");
    }
    const mode = options.live ? "live" : "dry-run";
    const token = options.token || process.env.HUBSPOT_TOKEN || "";
    const baseUrl = options.baseUrl || process.env.HUBSPOT_BASE_URL || undefined;
    if (mode === "live" && !token) {
      throw new Error("A live run needs HUBSPOT_TOKEN or --token. Nothing was written.");
    }
    const config = loadConfig(options.config);
    const client = token
      ? createHubSpotClient({
          token,
          ...(baseUrl ? { baseUrl } : {}),
        })
      : undefined;
    const command = [
      "hubspot-migrate run",
      `--config ${options.config}`,
      `--input ${options.input}`,
      mode === "live" ? "--live" : "--dry-run",
    ].join(" ");
    const report = await runMigration({
      config,
      inputDir: options.input,
      mode,
      ...(client ? { client } : {}),
      ...(options.batchSize ? { batchSize: options.batchSize } : {}),
      ...(mode === "live" && options.resume ? { resumePath: options.resume } : {}),
      ...(mode === "live" && (options.checkpoint || options.resume)
        ? { checkpointPath: options.checkpoint ?? options.resume }
        : {}),
      logger: options.quiet ? silentLogger : stderrLogger,
      command,
      ...(client ? { target: client.baseUrl } : { target: "not queried" }),
    });
    process.stdout.write(`${renderSummary(report)}\n`);
    if (options.out) {
      const files = writeReportFiles(report, options.out);
      process.stderr.write(`wrote ${files.json}\nwrote ${files.markdown}\nwrote ${files.html}\n`);
    }
    if (report.reconciliation.performed && !report.reconciliation.match) {
      process.exitCode = 2;
    }
  });

interface CliOptions {
  config: string;
  input: string;
  dryRun?: boolean;
  live?: boolean;
  out?: string;
  token?: string;
  baseUrl?: string;
  resume?: string;
  checkpoint?: string;
  batchSize?: number;
  quiet?: boolean;
}

const stderrLogger: Logger = {
  info: (message) => process.stderr.write(`${message}\n`),
  warn: (message) => process.stderr.write(`${message}\n`),
  error: (message) => process.stderr.write(`${message}\n`),
};

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
