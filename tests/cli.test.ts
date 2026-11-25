import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { startMockHubSpot } from "../src/hubspot/mock-server.js";

const execFileAsync = promisify(execFile);

// Async on purpose: execFileSync would block the mock server's event loop.
async function runCli(args: string[]): Promise<string> {
  const result = await execFileAsync(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, HUBSPOT_TOKEN: "", HUBSPOT_BASE_URL: "" },
  });
  return result.stdout;
}

describe("CLI", () => {
  it("dry-runs the Salesforce sample and writes a report without calling HubSpot", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hcm-cli-"));
    const output = await runCli([
      "run",
      "--config",
      "mappings/salesforce.yaml",
      "--input",
      "samples/salesforce",
      "--dry-run",
      "--out",
      join(dir, "dry"),
      "--quiet",
    ]);
    expect(output).toContain("Portfolio demo, not client work");
    expect(output).toContain("dry-run");
    const report = JSON.parse(readFileSync(join(dir, "dry.json"), "utf8")) as {
      meta: { mode: string; writes: number };
      validationErrors: unknown[];
    };
    expect(report.meta).toMatchObject({ mode: "dry-run", writes: 0 });
    expect(report.validationErrors.length).toBeGreaterThan(0);
    expect(readFileSync(join(dir, "dry.md"), "utf8")).toContain("Northline East");
    expect(readFileSync(join(dir, "dry.html"), "utf8")).toContain("Portfolio demo, not client work");
  });

  it("refuses a live run when no token is configured", async () => {
    await expect(
      runCli(["run", "--config", "mappings/salesforce.yaml", "--input", "samples/salesforce", "--live", "--quiet"]),
    ).rejects.toThrow(/HUBSPOT_TOKEN/);
  });

  it("runs live against the mock server and is idempotent", async () => {
    const mock = await startMockHubSpot();
    const dir = mkdtempSync(join(tmpdir(), "hcm-cli-live-"));
    try {
      const args = [
        "run",
        "--config",
        "mappings/pipedrive.yaml",
        "--input",
        "samples/pipedrive",
        "--live",
        "--token",
        "test-token",
        "--base-url",
        mock.url,
        "--quiet",
        "--out",
        join(dir, "live"),
      ];
      await runCli(args);
      const deals = mock.count("deals");
      await runCli(args);
      expect(mock.count("deals")).toBe(deals);
      const report = JSON.parse(readFileSync(join(dir, "live.json"), "utf8")) as {
        reconciliation: { match: boolean };
        totals: { deals: { created: number } };
      };
      expect(report.reconciliation.match).toBe(true);
      expect(report.totals.deals.created).toBe(0);
    } finally {
      await mock.close();
    }
  });
});
