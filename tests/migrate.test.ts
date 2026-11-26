import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCheckpoint } from "../src/checkpoint.js";
import { assertTotalsIdentity, runMigration } from "../src/migrate.js";
import { buildLocalPlan } from "../src/plan.js";
import { renderHtml, renderMarkdown } from "../src/report.js";
import { parseCsv } from "../src/csv.js";
import { readFileSync } from "node:fs";
import {
  companyHeaders,
  contactHeaders,
  dealHeaders,
  fixtureConfig,
  seedOwners,
  standardBook,
  tempDir,
  withMock,
  writeTables,
} from "./helpers.js";

describe("migration", () => {
  it("flags bad emails, missing fields, invalid enums, and unmapped stages before any write", async () => {
    const dir = await tempDir();
    await writeTables(dir, standardBook());
    const plan = buildLocalPlan(fixtureConfig(), {
      companies: parseCsv(readFileSync(join(dir, "companies.csv"), "utf8")),
      contacts: parseCsv(readFileSync(join(dir, "contacts.csv"), "utf8")),
      deals: parseCsv(readFileSync(join(dir, "deals.csv"), "utf8")),
    });
    const failed = (id: string) => plan.records.companies.concat(plan.records.contacts, plan.records.deals).find((row) => row.sourceId === id);
    expect(failed("A4")?.action).toBe("fail");
    expect(failed("A5")?.errors.some((error) => error.message.includes("invalid value"))).toBe(true);
    expect(failed("C4")?.errors.some((error) => error.field === "email")).toBe(true);
    expect(failed("D3")?.errors.some((error) => error.message.includes("unmapped stage"))).toBe(true);
    expect(failed("D6")?.action).toBe("fail");
    expect(failed("A3")?.action).toBe("skip");
    expect(failed("A3")?.canonicalSourceId).toBe("A1");
    expect(failed("C3")?.reason).toMatch(/duplicate email/);
    expect(failed("C1")?.properties.email).toBe("amina.shah@northwind.example");
    expect(failed("C1")?.properties.phone).toBe("+15125550199");
    expect(failed("D5")?.labels).toMatchObject({ pipeline: "Northline Sales", stage: "Closed Won" });
    expect(failed("D1")?.properties.amount).toBe("48000");
  });

  it("dry-run reads HubSpot and writes nothing", async () => {
    await withMock(async ({ mock, client }) => {
      seedOwners(mock);
      mock.seedObject("contacts", { email: "amina.shah@northwind.example", firstname: "Existing" });
      const dir = await tempDir();
      await writeTables(dir, standardBook());
      const report = await runMigration({ config: fixtureConfig(), inputDir: dir, mode: "dry-run", client });
      expect(report.meta.mode).toBe("dry-run");
      expect(report.meta.writes).toBe(0);
      expect(mock.writeCount).toBe(0);
      expect(report.reconciliation.performed).toBe(false);
      const contact = report.actions.find((action) => action.sourceId === "C1");
      expect(contact?.action).toBe("update");
      expect(contact?.matchedBy).toBe("email");
      expect(report.actions.find((action) => action.sourceId === "A1")?.action).toBe("create");
      expect(renderMarkdown(report)).toContain("Portfolio demo, not client work");
      expect(renderHtml(report)).toContain("Portfolio demo, not client work");
      for (const totals of Object.values(report.totals)) expect(assertTotalsIdentity(totals)).toBe(true);
    });
  });

  it("creates, associates, reconciles, and does not duplicate on a second run", async () => {
    await withMock(async ({ mock, client }) => {
      seedOwners(mock);
      const dir = await tempDir();
      await writeTables(dir, standardBook());
      const first = await runMigration({ config: fixtureConfig(), inputDir: dir, mode: "live", client });
      expect(first.reconciliation.match).toBe(true);
      expect(first.totals.companies).toMatchObject({ created: 2, failed: 2, duplicates: 1 });
      expect(first.totals.contacts).toMatchObject({ created: 3, failed: 1, duplicates: 1 });
      expect(first.totals.deals).toMatchObject({ created: 4, failed: 2, duplicates: 1 });
      expect(first.associations.contactCompany).toMatchObject({ created: 2, skipped: 1 });
      expect(first.associations.dealCompany.skipped).toBe(1);
      expect(first.associations.dealContact.created).toBe(4);

      const sales = mock.pipelines().find((pipeline) => pipeline.label === "Northline Sales");
      const won = sales?.stages.find((stage) => stage.label === "Closed Won");
      const northwindDeal = mock.objects("deals").find((deal) => deal.properties.legacy_external_id === "D1");
      const folded = mock.objects("deals").find((deal) => deal.properties.legacy_external_id === "D5");
      expect(northwindDeal?.properties.pipeline).toBe(sales?.id);
      expect(northwindDeal?.properties.dealstage).toBe(won?.id);
      expect(folded?.properties.dealstage).toBe(won?.id);
      expect(northwindDeal?.properties.amount).toBe("48000");
      expect(northwindDeal?.properties.closedate).toBe(String(Date.UTC(2026, 3, 1)));

      const amina = mock.objects("contacts").find((contact) => contact.properties.email === "amina.shah@northwind.example");
      expect(amina?.properties.hubspot_owner_id).toBe("501");
      expect(mock.objects("companies").some((company) => company.properties.legacy_external_id === "A3")).toBe(false);
      const northwind = mock.objects("companies").find((company) => company.properties.legacy_external_id === "A1");
      const foldedLink = first.associationResults.find(
        (link) => link.fromSourceId === "D5" && link.toObject === "companies",
      );
      expect(foldedLink).toMatchObject({ status: "create", toHubspotId: northwind?.id });
      expect(first.associationResults.find((link) => link.toSourceId === "MISSING")?.reason).toMatch(/orphan/);
      expect(first.warnings.some((warning) => warning.message.includes("invalid phone"))).toBe(true);
      expect(first.warnings.some((warning) => warning.field === "hubspot_owner_id")).toBe(true);

      const companies = mock.count("companies");
      const contacts = mock.count("contacts");
      const deals = mock.count("deals");
      const links = mock.associations().length;
      const second = await runMigration({ config: fixtureConfig(), inputDir: dir, mode: "live", client });
      expect(second.totals.companies.created).toBe(0);
      expect(second.totals.contacts.created).toBe(0);
      expect(second.totals.deals.created).toBe(0);
      expect(second.totals.companies.updated).toBe(first.totals.companies.created);
      expect(mock.count("companies")).toBe(companies);
      expect(mock.count("contacts")).toBe(contacts);
      expect(mock.count("deals")).toBe(deals);
      expect(mock.associations().length).toBe(links);
      expect(second.reconciliation.match).toBe(true);
    });
  });

  it("updates a pre-existing company by domain and refuses to steal a contact", async () => {
    await withMock(async ({ mock, client }) => {
      seedOwners(mock);
      mock.seedObject("companies", { domain: "northwind.example", name: "Old Northwind" });
      mock.seedObject("contacts", {
        email: "bea.cole@cedar.example",
        legacy_external_id: "OTHER",
        firstname: "Bea",
        lastname: "Cole",
      });
      const dir = await tempDir();
      await writeTables(dir, standardBook());
      const report = await runMigration({ config: fixtureConfig(), inputDir: dir, mode: "live", client });
      expect(mock.count("companies")).toBe(2);
      const northwind = mock.objects("companies").find((company) => company.properties.domain === "northwind.example");
      expect(northwind?.properties.legacy_external_id).toBe("A1");
      expect(northwind?.properties.name).toBe("Northwind");
      expect(report.actions.find((action) => action.sourceId === "A1")?.matchedBy).toBe("domain");
      expect(report.actions.find((action) => action.sourceId === "C2")).toMatchObject({
        action: "skip",
        reason: expect.stringMatching(/conflict/),
      });
      expect(mock.objects("contacts").filter((contact) => contact.properties.email === "bea.cole@cedar.example")).toHaveLength(1);
      expect(report.reconciliation.match).toBe(true);
    });
  });

  it("keeps associations to a company or contact whose source id is repeated in the export", async () => {
    await withMock(async ({ mock, client }) => {
      const dir = await tempDir();
      await writeTables(dir, {
        "companies.csv": {
          headers: companyHeaders,
          rows: [
            ["A1", "Northwind", "northwind.example", "Software", "", ""],
            ["A1", "Northwind (re-export)", "northwind.example", "Software", "", ""],
          ],
        },
        "contacts.csv": {
          headers: contactHeaders,
          rows: [
            ["C1", "A1", "Amina", "Shah", "amina.shah@northwind.example", "", ""],
            ["C1", "A1", "Amina", "Shah", "amina.shah@northwind.example", "", ""],
          ],
        },
        "deals.csv": {
          headers: dealHeaders,
          rows: [["D1", "Northwind Platform", "A1", "C1", "Closed Won", "Sales", "1000", "2026-04-01", "New Business", ""]],
        },
      });

      const dry = await runMigration({ config: fixtureConfig(), inputDir: dir, mode: "dry-run" });
      expect(dry.totals.companies).toMatchObject({ created: 1, duplicates: 1 });
      expect(dry.totals.contacts).toMatchObject({ created: 1, duplicates: 1 });
      expect(dry.associations.contactCompany).toMatchObject({ planned: 1, created: 1, skipped: 0 });
      expect(dry.associations.dealCompany).toMatchObject({ planned: 1, created: 1, skipped: 0 });
      expect(dry.associations.dealContact).toMatchObject({ planned: 1, created: 1, skipped: 0 });
      const contact = dry.actions.find((action) => action.object === "contacts" && action.action === "create");
      expect(contact?.properties.company).toBe("Northwind");

      const live = await runMigration({ config: fixtureConfig(), inputDir: dir, mode: "live", client });
      expect(live.associations.dealCompany).toMatchObject({ created: 1, skipped: 0, failed: 0 });
      expect(live.reconciliation.match).toBe(true);
      expect(mock.associations()).toHaveLength(3);
    });
  });

  it("retries a 429 and still lands a single record", async () => {
    await withMock(async ({ mock, client, sleeps }) => {
      mock.failNext(429, { "retry-after": "2" });
      const dir = await tempDir();
      await writeTables(dir, {
        "companies.csv": { headers: companyHeaders, rows: [["A1", "Northwind", "northwind.example", "Software", "", "Avery Chen"]] },
        "contacts.csv": { headers: contactHeaders, rows: [] },
        "deals.csv": { headers: dealHeaders, rows: [] },
      });
      const report = await runMigration({ config: fixtureConfig(), inputDir: dir, mode: "live", client });
      expect(sleeps).toContain(2_000);
      expect(mock.count("companies")).toBe(1);
      expect(report.reconciliation.match).toBe(true);
    });
  });

  it("resumes after a failed batch without upserting the checkpointed id again", async () => {
    await withMock(async ({ mock, client }) => {
      mock.failNth("/companies/batch/upsert", 2, 500);
      const dir = await tempDir();
      const checkpoint = join(dir, "run.checkpoint.json");
      await writeTables(dir, {
        "companies.csv": {
          headers: companyHeaders,
          rows: [
            ["A1", "Northwind", "northwind.example", "Software", "", ""],
            ["A2", "Cedar", "cedar.example", "Media", "", ""],
            ["A3", "Harbor", "harbor.example", "Software", "", ""],
          ],
        },
        "contacts.csv": { headers: contactHeaders, rows: [] },
        "deals.csv": { headers: dealHeaders, rows: [] },
      });
      await expect(
        runMigration({
          config: fixtureConfig(),
          inputDir: dir,
          mode: "live",
          client,
          batchSize: 1,
          checkpointPath: checkpoint,
        }),
      ).rejects.toThrow(/injected failure/);
      const saved = loadCheckpoint(checkpoint);
      const done = Object.keys(saved.records.companies);
      expect(done).toHaveLength(1);
      const report = await runMigration({
        config: fixtureConfig(),
        inputDir: dir,
        mode: "live",
        client,
        batchSize: 1,
        checkpointPath: checkpoint,
        resumePath: checkpoint,
      });
      expect(mock.count("companies")).toBe(3);
      expect(mock.upsertIds("companies").filter((id) => id === done[0])).toHaveLength(1);
      expect(new Set(mock.upsertIds("companies")).size).toBe(3);
      expect(report.reconciliation.match).toBe(true);
    });
  });
});
