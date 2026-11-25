import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseConfig, type MigrationConfig } from "../src/config.js";
import { toCsv } from "../src/csv.js";
import { createHubSpotClient, type HubSpotClient } from "../src/hubspot/client.js";
import { startMockHubSpot, type MockHubSpot } from "../src/hubspot/mock-server.js";

export async function withMock<T>(
  fn: (ctx: { mock: MockHubSpot; client: HubSpotClient; sleeps: number[] }) => Promise<T>,
): Promise<T> {
  const mock = await startMockHubSpot();
  const sleeps: number[] = [];
  const client = createHubSpotClient({
    token: "test-token",
    baseUrl: mock.url,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    random: () => 0,
    baseDelayMs: 100,
    maxDelayMs: 1_000,
    maxRetries: 4,
  });
  try {
    return await fn({ mock, client, sleeps });
  } finally {
    await mock.close();
  }
}

export function seedOwners(mock: MockHubSpot): void {
  mock.seedOwner({ id: "501", email: "avery.chen@northline.example", firstName: "Avery", lastName: "Chen" });
  mock.seedOwner({ id: "502", email: "jordan.hale@northline.example", firstName: "Jordan", lastName: "Hale" });
  mock.seedOwner({ id: "503", email: "riley.okonkwo@northline.example", firstName: "Riley", lastName: "Okonkwo" });
  mock.seedOwner({ id: "504", email: "samir.patel@northline.example", firstName: "Samir", lastName: "Patel" });
  mock.seedOwner({ id: "505", email: "quinn.alvarez@northline.example", firstName: "Quinn", lastName: "Alvarez" });
  mock.seedOwner({ id: "506", email: "morgan.ellis@northline.example", firstName: "Morgan", lastName: "Ellis" });
}

export function fixtureConfig(): MigrationConfig {
  return parseConfig({
    source: "fixture",
    title: "Fixture book",
    description: "Small in-memory book used by unit tests.",
    owners: [
      { name: "Avery Chen", email: "avery.chen@northline.example" },
      { name: "Jordan Hale", email: "jordan.hale@northline.example" },
    ],
    properties: [
      ["companies", "companyinformation"],
      ["contacts", "contactinformation"],
      ["deals", "dealinformation"],
    ].flatMap(([object, groupName]) => [
      {
        object,
        name: "legacy_external_id",
        label: "Legacy external ID",
        type: "string",
        fieldType: "text",
        groupName,
        hasUniqueValue: true,
      },
      { object, name: "legacy_source", label: "Legacy source", type: "string", fieldType: "text", groupName },
      { object, name: "legacy_owner", label: "Legacy owner", type: "string", fieldType: "text", groupName },
      ...(object === "deals"
        ? [{ object, name: "legacy_pipeline", label: "Legacy pipeline", type: "string", fieldType: "text", groupName }]
        : []),
    ]),
    pipelines: [
      {
        sourceName: "Sales",
        hubspotLabel: "Northline Sales",
        stages: [
          { source: "Qualified", label: "Qualified", probability: "0.2" },
          { source: "Closed Won", label: "Closed Won", probability: "1.0", closedWon: true },
          { source: "Closed Lost", label: "Closed Lost", probability: "0.0", closedLost: true },
        ],
      },
      {
        sourceName: "Renewals",
        hubspotLabel: "Northline Renewals",
        stages: [
          { source: "Renewed", label: "Renewed", probability: "1.0", closedWon: true },
          { source: "Churned", label: "Churned", probability: "0.0", closedLost: true },
        ],
      },
    ],
    objects: {
      companies: {
        file: "companies.csv",
        idColumn: "Id",
        dedupeProperty: "domain",
        ownerColumn: "Owner",
        fields: [
          { column: "Name", property: "name", required: true, transforms: ["trim"] },
          { column: "Website", property: "domain", transforms: ["domain"] },
          {
            column: "Industry",
            property: "industry",
            transforms: ["trim"],
            valueMap: { Software: "COMPUTER_SOFTWARE", Media: "ONLINE_MEDIA" },
          },
          { column: "Phone", property: "phone", transforms: ["phone"] },
        ],
      },
      contacts: {
        file: "contacts.csv",
        idColumn: "Id",
        dedupeProperty: "email",
        ownerColumn: "Owner",
        associations: [{ column: "Account", to: "companies" }],
        fields: [
          { column: "First", property: "firstname", required: true, transforms: ["trim"] },
          { column: "Last", property: "lastname", required: true, transforms: ["trim"] },
          { column: "Email", property: "email", required: true, transforms: ["email"] },
          { column: "Phone", property: "phone", transforms: ["phone"] },
        ],
      },
      deals: {
        file: "deals.csv",
        idColumn: "Id",
        ownerColumn: "Owner",
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
          {
            column: "Type",
            property: "dealtype",
            transforms: ["trim"],
            valueMap: { "New Business": "newbusiness", Renewal: "existingbusiness", Expansion: "existingbusiness" },
          },
        ],
      },
    },
  });
}

export async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "hcm-"));
}

export async function writeTables(
  dir: string,
  files: Record<string, { headers: string[]; rows: string[][] }>,
): Promise<void> {
  await mkdir(dir, { recursive: true });
  await Promise.all(
    Object.entries(files).map(([name, file]) => writeFile(join(dir, name), toCsv(file.headers, file.rows))),
  );
}

export const companyHeaders = ["Id", "Name", "Website", "Industry", "Phone", "Owner"];
export const contactHeaders = ["Id", "Account", "First", "Last", "Email", "Phone", "Owner"];
export const dealHeaders = ["Id", "Name", "Account", "Contact", "Stage", "Pipeline", "Amount", "Close", "Type", "Owner"];

export function standardBook(): Record<string, { headers: string[]; rows: string[][] }> {
  return {
    "companies.csv": {
      headers: companyHeaders,
      rows: [
        ["A1", "Northwind", "https://www.Northwind.example", "Software", "(512) 555-0100", "Avery Chen"],
        ["A2", "Cedar", "cedar.example", "Media", "512.555.0101", "Jordan Hale"],
        ["A3", "Northwind stale", "https://northwind.example/about", "Software", "5125550102", "Avery Chen"],
        ["A4", "", "noname.example", "Software", "5125550103", "Avery Chen"],
        ["A5", "Astrology Desk", "astrology.example", "Astrology", "5125550104", "Avery Chen"],
      ],
    },
    "contacts.csv": {
      headers: contactHeaders,
      rows: [
        ["C1", "A1", "Amina", "Shah", "  Amina.Shah@Northwind.EXAMPLE ", "(512) 555-0199 x9", "Avery Chen"],
        ["C2", "A2", "Bea", "Cole", "bea.cole@cedar.example", "call the desk", "Jordan Hale"],
        ["C3", "A1", "Amina", "Shah", "amina.shah@northwind.example", "5125550100", "Avery Chen"],
        ["C4", "A1", "Pat", "No", "not-an-email", "5125550100", "Former Rep"],
        ["C5", "A9", "Orphan", "Contact", "orphan.contact@missing.example", "5125550108", "Avery Chen"],
      ],
    },
    "deals.csv": {
      headers: dealHeaders,
      rows: [
        ["D1", "Northwind Platform", "A1", "C1", "Closed Won", "Sales", "$48,000", "2026-04-01", "New Business", "Avery Chen"],
        ["D2", "Cedar Renewal", "A2", "C2", "Renewed", "Renewals", "12000", "15-Mar-2026", "Renewal", "Jordan Hale"],
        ["D3", "Verbal", "A1", "C1", "Verbal Yes", "Sales", "1000", "2026-05-01", "New Business", "Avery Chen"],
        ["D4", "Orphan deal", "MISSING", "C1", "Qualified", "Sales", "1000", "4/2/2026", "New Business", "Former Rep"],
        ["D5", "Folded stage", "A3", "C1", "closed won", "sales", "72000.00", "2026-06-01", "Expansion", "Avery Chen"],
        ["D1", "Duplicate row", "A1", "C1", "Closed Won", "Sales", "1", "2026-01-01", "New Business", "Avery Chen"],
        ["D6", "Bad date", "A2", "C2", "Qualified", "Sales", "TBD", "yesterday", "New Business", "Avery Chen"],
      ],
    },
  };
}
