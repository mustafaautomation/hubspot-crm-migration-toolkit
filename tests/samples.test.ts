import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { runMigration } from "../src/migrate.js";
import { seedOwners, withMock } from "./helpers.js";

const books = [
  { source: "salesforce", config: "mappings/salesforce.yaml", input: "samples/salesforce" },
  { source: "pipedrive", config: "mappings/pipedrive.yaml", input: "samples/pipedrive" },
  { source: "zoho", config: "mappings/zoho.yaml", input: "samples/zoho" },
] as const;

describe("sample books", () => {
  it("keeps the committed Salesforce artifact consistent with a reconciled run", () => {
    const bundle = JSON.parse(readFileSync("artifacts/bundles/salesforce.json", "utf8")) as {
      applied: { reconciliation: { match: boolean }; totals: { companies: { created: number } } };
      rerun: { totals: { companies: { created: number }; contacts: { created: number }; deals: { created: number } } };
    };
    expect(bundle.applied.reconciliation.match).toBe(true);
    expect(bundle.applied.totals.companies.created).toBeGreaterThan(0);
    expect(bundle.rerun.totals.companies.created).toBe(0);
    expect(bundle.rerun.totals.contacts.created).toBe(0);
    expect(bundle.rerun.totals.deals.created).toBe(0);
  });

  it("migrates each legacy export once, then again with no new records", async () => {
    await withMock(async ({ mock, client }) => {
      seedOwners(mock);
      for (const book of books) {
        const config = loadConfig(book.config);
        const first = await runMigration({ config, inputDir: book.input, mode: "live", client });
        expect(first.validationErrors.length).toBeGreaterThan(0);
        expect(first.totals.companies.duplicates + first.totals.contacts.duplicates + first.totals.deals.duplicates).toBeGreaterThan(0);
        expect(first.reconciliation.match).toBe(true);
        const before = {
          companies: mock.count("companies"),
          contacts: mock.count("contacts"),
          deals: mock.count("deals"),
          links: mock.associations().length,
        };
        const second = await runMigration({ config, inputDir: book.input, mode: "live", client });
        expect(second.totals.companies.created).toBe(0);
        expect(second.totals.contacts.created).toBe(0);
        expect(second.totals.deals.created).toBe(0);
        expect(mock.count("companies")).toBe(before.companies);
        expect(mock.count("contacts")).toBe(before.contacts);
        expect(mock.count("deals")).toBe(before.deals);
        expect(mock.associations().length).toBe(before.links);
        expect(second.reconciliation.match).toBe(true);
      }
    });
  });

  it("maps source stages onto ensured pipeline ids and adds only missing stages", async () => {
    await withMock(async ({ mock, client }) => {
      seedOwners(mock);
      const salesforce = await runMigration({
        config: loadConfig("mappings/salesforce.yaml"),
        inputDir: "samples/salesforce",
        mode: "live",
        client,
      });
      expect(salesforce.validationErrors.filter((error) => error.message.includes("unmapped stage")).map((error) => error.sourceId)).toEqual([
        "006NS000000OBAD",
      ]);
      expect(salesforce.actions.find((action) => action.sourceId === "006NS000000DLOW")?.labels.stage).toBe("Closed Won");
      expect(salesforce.actions.find((action) => action.sourceId === "001NS000000ADUP")?.action).toBe("skip");
      expect(salesforce.actions.find((action) => action.sourceId === "003NS000000CBAD")?.action).toBe("fail");
      expect(salesforce.associationResults.find((link) => link.toSourceId === "001NS000000AMISS")?.reason).toMatch(/orphan/);

      const sales = mock.pipelines().find((pipeline) => pipeline.label === "Northline Sales");
      const won = sales?.stages.find((stage) => stage.label === "Closed Won");
      expect(mock.pipelines().map((pipeline) => pipeline.label).sort()).toEqual(["Northline Renewals", "Northline Sales"]);
      const stageCount = sales?.stages.length ?? 0;
      const northwind = mock.objects("deals").find((deal) => deal.properties.legacy_external_id === "006NS000000D001");
      expect(northwind?.properties.pipeline).toBe(sales?.id);
      expect(northwind?.properties.dealstage).toBe(won?.id);

      await runMigration({
        config: loadConfig("mappings/pipedrive.yaml"),
        inputDir: "samples/pipedrive",
        mode: "live",
        client,
      });
      const afterPipedrive = mock.pipelines();
      expect(afterPipedrive.map((pipeline) => pipeline.label).sort()).toEqual([
        "Northline Partnerships",
        "Northline Renewals",
        "Northline Sales",
      ]);
      expect(afterPipedrive.find((pipeline) => pipeline.label === "Northline Sales")?.stages).toHaveLength(stageCount);
      const pipedriveWon = mock.objects("deals").find((deal) => deal.properties.legacy_external_id === "7001");
      expect(pipedriveWon?.properties.pipeline).toBe(sales?.id);
      expect(pipedriveWon?.properties.dealstage).toBe(won?.id);

      const zoho = await runMigration({
        config: loadConfig("mappings/zoho.yaml"),
        inputDir: "samples/zoho",
        mode: "live",
        client,
      });
      const shared = mock.pipelines().find((pipeline) => pipeline.label === "Northline Sales");
      expect(shared?.stages.some((stage) => stage.label === "Value Proposition")).toBe(true);
      expect(mock.pipelines().some((pipeline) => pipeline.label === "Northline Customer Success")).toBe(true);
      expect(zoho.validationErrors.some((error) => error.message.includes('unmapped stage "Verbal Commit"'))).toBe(true);
      expect(zoho.reconciliation.match).toBe(true);
    });
  });
});
