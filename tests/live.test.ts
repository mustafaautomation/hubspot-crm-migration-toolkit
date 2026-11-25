import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config.js";
import { toCsv } from "../src/csv.js";
import { createHubSpotClient } from "../src/hubspot/client.js";
import { runMigration } from "../src/migrate.js";

/**
 * Opt-in check against a HubSpot developer test account.
 * Skipped unless HUBSPOT_TOKEN is set. Uses stable ids so a second run updates.
 */
const token = process.env.HUBSPOT_TOKEN;
const live = token ? describe : describe.skip;

live("HubSpot developer sandbox", () => {
  it(
    "ensures a pipeline and upserts a tiny book twice",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "hcm-live-"));
      const config = parseConfig({
        source: "toolkit-itest",
        title: "Toolkit integration",
        description: "Tiny idempotent write used to prove the live sandbox path. Synthetic records only.",
        properties: ["companies", "contacts", "deals"].flatMap((object) => {
          const groupName = object === "companies" ? "companyinformation" : object === "contacts" ? "contactinformation" : "dealinformation";
          return [
            {
              object,
              name: "legacy_external_id",
              label: "Legacy external ID",
              type: "string",
              fieldType: "text",
              groupName,
              hasUniqueValue: true,
              description: "Portfolio demo source id.",
            },
            { object, name: "legacy_source", label: "Legacy source", type: "string", fieldType: "text", groupName },
            ...(object === "deals"
              ? [{ object, name: "legacy_pipeline", label: "Legacy pipeline", type: "string", fieldType: "text", groupName }]
              : []),
          ];
        }),
        pipelines: [
          {
            sourceName: "Sales",
            hubspotLabel: "Toolkit ITest Sales",
            stages: [
              { source: "Qualified", label: "Qualified", probability: "0.2" },
              { source: "Closed Won", label: "Closed Won", probability: "1.0", closedWon: true },
            ],
          },
        ],
        objects: {
          companies: {
            file: "companies.csv",
            idColumn: "Id",
            dedupeProperty: "domain",
            fields: [
              { column: "Name", property: "name", required: true, transforms: ["trim"] },
              { column: "Website", property: "domain", required: true, transforms: ["domain"] },
            ],
          },
          contacts: {
            file: "contacts.csv",
            idColumn: "Id",
            dedupeProperty: "email",
            associations: [{ column: "Account", to: "companies" }],
            fields: [
              { column: "First", property: "firstname", required: true, transforms: ["trim"] },
              { column: "Last", property: "lastname", required: true, transforms: ["trim"] },
              { column: "Email", property: "email", required: true, transforms: ["email"] },
            ],
          },
          deals: {
            file: "deals.csv",
            idColumn: "Id",
            dealPipelineColumn: "Pipeline",
            dealStageColumn: "Stage",
            associations: [
              { column: "Account", to: "companies" },
              { column: "Contact", to: "contacts" },
            ],
            fields: [
              { column: "Name", property: "dealname", required: true, transforms: ["trim"] },
              { column: "Amount", property: "amount", transforms: ["number"] },
              { column: "Close", property: "closedate", required: true, transforms: ["date"] },
            ],
          },
        },
      });
      await writeFile(
        join(dir, "companies.csv"),
        toCsv(
          ["Id", "Name", "Website"],
          [["toolkit-itest-co-1", "Toolkit ITest Northwind", "toolkit-itest.example"]],
        ),
      );
      await writeFile(
        join(dir, "contacts.csv"),
        toCsv(
          ["Id", "Account", "First", "Last", "Email"],
          [["toolkit-itest-c-1", "toolkit-itest-co-1", "Ada", "Northwind", "ada.northwind@toolkit-itest.example"]],
        ),
      );
      await writeFile(
        join(dir, "deals.csv"),
        toCsv(
          ["Id", "Name", "Account", "Contact", "Stage", "Pipeline", "Amount", "Close"],
          [["toolkit-itest-d-1", "Toolkit ITest Platform", "toolkit-itest-co-1", "toolkit-itest-c-1", "Qualified", "Sales", "24000", "2026-06-01"]],
        ),
      );
      const client = createHubSpotClient({ token: token as string });
      const first = await runMigration({ config, inputDir: dir, mode: "live", client, target: client.baseUrl });
      const second = await runMigration({ config, inputDir: dir, mode: "live", client, target: client.baseUrl });
      expect(first.reconciliation.match).toBe(true);
      expect(second.totals.companies.created).toBe(0);
      expect(second.totals.contacts.created).toBe(0);
      expect(second.totals.deals.created).toBe(0);
      expect(second.reconciliation.match).toBe(true);
      expect(second.pipelines[0]?.hubspotId).toBeTruthy();
      expect(second.actions.find((action) => action.sourceId === "toolkit-itest-d-1")?.labels.stage).toBe("Qualified");
    },
    120_000,
  );
});
