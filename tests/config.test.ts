import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig, parseConfig, resolveStage } from "../src/config.js";

describe("mapping config", () => {
  it("loads each source book and resolves stage names onto HubSpot labels", () => {
    const salesforce = loadConfig("mappings/salesforce.yaml");
    const pipedrive = loadConfig("mappings/pipedrive.yaml");
    const zoho = loadConfig("mappings/zoho.yaml");
    expect(salesforce.source).toBe("salesforce");
    expect(pipedrive.objects.deals.dealStageColumn).toBe("Deal - Stage");
    expect(zoho.pipelines.map((pipeline) => pipeline.hubspotLabel)).toContain("Northline Customer Success");

    expect(resolveStage(salesforce, "Sales", "Closed Won")).toMatchObject({
      ok: true,
      stage: { pipelineLabel: "Northline Sales", stageLabel: "Closed Won" },
    });
    expect(resolveStage(salesforce, "sales", "closed won")).toMatchObject({
      ok: true,
      stage: { pipelineLabel: "Northline Sales", stageLabel: "Closed Won" },
    });
    expect(resolveStage(pipedrive, "1", "6")).toMatchObject({
      ok: true,
      stage: { pipelineLabel: "Northline Sales", stageLabel: "Closed Won", probability: "1.0" },
    });
    expect(resolveStage(pipedrive, "2", "11")).toMatchObject({
      ok: true,
      stage: { pipelineLabel: "Northline Partnerships", stageLabel: "Active Partner" },
    });
    expect(resolveStage(zoho, "Sales", "Proposal/Price Quote")).toMatchObject({
      ok: true,
      stage: { pipelineLabel: "Northline Sales", stageLabel: "Proposal" },
    });
    expect(resolveStage(zoho, "Customer Success", "Onboarding")).toMatchObject({
      ok: true,
      stage: { pipelineLabel: "Northline Customer Success", stageLabel: "Onboarding" },
    });
  });

  it("rejects a source stage or pipeline that was never mapped", () => {
    const config = loadConfig("mappings/salesforce.yaml");
    expect(resolveStage(config, "Sales", "Verbal Yes")).toMatchObject({
      ok: false,
      field: "dealstage",
      message: 'unmapped stage "Verbal Yes" for pipeline "Sales"',
    });
    expect(resolveStage(config, "Partnerships", "Intro")).toMatchObject({
      ok: false,
      field: "pipeline",
    });
  });

  it("rejects duplicate stage keys and closed stages with the wrong probability", () => {
    const config = loadConfig("mappings/salesforce.yaml");
    const duplicated = structuredClone(config);
    duplicated.pipelines[0].stages.push({ ...duplicated.pipelines[0].stages[0] });
    expect(() => parseConfig(duplicated)).toThrow(ConfigError);

    const badWon = structuredClone(config);
    const won = badWon.pipelines[0].stages.find((stage) => stage.closedWon);
    if (!won) throw new Error("missing closed won stage");
    won.probability = "0.4";
    expect(() => parseConfig(badWon)).toThrow(/probability 1\.0/);
  });
});
