import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";
import { createHubSpotClient } from "../src/hubspot/client.js";
import { startMockHubSpot } from "../src/hubspot/mock-server.js";
import { runMigration } from "../src/migrate.js";
import { writeReportFiles } from "../src/report.js";
import type { MigrationReport } from "../src/types.js";

/**
 * Records dry-run, first apply, and second apply for each sample book
 * against the in-memory HubSpot server. The dashboard reads these artifacts.
 * A later `migrate run --live` can replace them with a developer-sandbox run.
 */

const books = [
  {
    source: "salesforce",
    configPath: "mappings/salesforce.yaml",
    input: "samples/salesforce",
    scenario:
      "Northline East kept its new-business and renewal book in Salesforce. This run maps that export onto the Northline Sales and Northline Renewals pipelines.",
  },
  {
    source: "pipedrive",
    configPath: "mappings/pipedrive.yaml",
    input: "samples/pipedrive",
    scenario:
      "The West SMB team worked in Pipedrive, where stages are numeric ids. Pipeline 1 joins the shared Northline Sales pipeline. Pipeline 2 becomes Northline Partnerships.",
  },
  {
    source: "zoho",
    configPath: "mappings/zoho.yaml",
    input: "samples/zoho",
    scenario:
      "The partner desk exported Zoho. Zoho stage names land on the shared sales pipeline, and a Value Proposition stage is added beside the stages the other books already created. Customer Success is a separate pipeline.",
  },
];

async function main(): Promise<void> {
  mkdirSync("artifacts/bundles", { recursive: true });
  const manifest = [];
  for (const book of books) {
    const config = loadConfig(book.configPath);
    const mock = await startMockHubSpot();
    try {
      for (const owner of config.owners ?? []) {
        const [firstName, ...rest] = owner.name.split(" ");
        mock.seedOwner({ email: owner.email, firstName, lastName: rest.join(" ") || firstName });
      }
      const client = createHubSpotClient({
        token: "test-token",
        baseUrl: mock.url,
        sleep: async () => {},
        random: () => 0,
      });
      const target = "in-memory HubSpot API (same client as a developer sandbox)";
      const command = `hubspot-migrate run --config ${book.configPath} --input ${book.input}`;
      const dryRun = await runMigration({
        config,
        inputDir: book.input,
        mode: "dry-run",
        client,
        command: `${command} --dry-run`,
        target,
      });
      const applied = await runMigration({
        config,
        inputDir: book.input,
        mode: "live",
        client,
        command: `${command} --live`,
        target,
      });
      const rerun = await runMigration({
        config,
        inputDir: book.input,
        mode: "live",
        client,
        command: `${command} --live`,
        target,
      });
      const bundle = {
        portfolioDemo: true as const,
        disclaimer: applied.disclaimer,
        scenario: book.scenario,
        source: book.source,
        title: config.title,
        dryRun,
        applied,
        rerun,
      };
      writeFileSync(join("artifacts/bundles", `${book.source}.json`), `${JSON.stringify(bundle, null, 2)}\n`);
      if (book.source === "salesforce") {
        writeReportFiles(dryRun, "artifacts/northline-salesforce-dry-run");
        writeReportFiles(applied, "artifacts/northline-salesforce-applied");
      }
      manifest.push(summary(book.source, dryRun, applied, rerun));
      process.stdout.write(
        `${book.source}: dry-run creates ${dryRun.totals.companies.created}/${dryRun.totals.contacts.created}/${dryRun.totals.deals.created}, applied reconciliation ${applied.reconciliation.match ? "matched" : "MISMATCH"}\n`,
      );
    } finally {
      await mock.close();
    }
  }
  writeFileSync("artifacts/bundles/manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
  if (existsSync("web")) {
    mkdirSync("web/data/bundles", { recursive: true });
    for (const book of books) {
      cpSync(join("artifacts/bundles", `${book.source}.json`), join("web/data/bundles", `${book.source}.json`));
    }
  }
}

function summary(source: string, dryRun: MigrationReport, applied: MigrationReport, rerun: MigrationReport) {
  return {
    source,
    title: applied.meta.title,
    dryRun: count(dryRun),
    applied: count(applied),
    rerun: count(rerun),
    reconciliation: applied.reconciliation.match,
  };
}

function count(report: MigrationReport) {
  return {
    companies: report.totals.companies,
    contacts: report.totals.contacts,
    deals: report.totals.deals,
    validationErrors: report.validationErrors.length,
    writes: report.meta.writes,
  };
}

main();
