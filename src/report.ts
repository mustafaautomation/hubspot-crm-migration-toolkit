import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  ASSOCIATION_KEYS,
  OBJECT_TYPES,
  type AssociationKey,
  type MigrationReport,
  type ObjectTotals,
} from "./types.js";

const ASSOCIATION_LABELS: Record<AssociationKey, string> = {
  contactCompany: "contact → company",
  dealCompany: "deal → company",
  dealContact: "deal → contact",
};

export function renderSummary(report: MigrationReport): string {
  const verb = report.meta.mode === "dry-run" ? "would write" : "writes";
  const lines = [
    "hubspot-crm-migration-toolkit",
    report.disclaimer,
    "",
    `${report.meta.title} (${report.meta.source}) · ${report.meta.mode} · ${verb} ${report.meta.writes}`,
    `target ${report.meta.target}`,
    "",
    table([
      ["object", "source", "valid", "invalid", "dupes", "created", "updated", "skipped", "failed"],
      ...OBJECT_TYPES.map((type) => {
        const totals = report.totals[type];
        return [
          type,
          totals.sourceRows,
          totals.valid,
          totals.invalid,
          totals.duplicates,
          totals.created,
          totals.updated,
          totals.skipped,
          totals.failed,
        ].map(String);
      }),
    ]),
    "",
    "associations",
    ...ASSOCIATION_KEYS.map((key) => {
      const totals = report.associations[key];
      return `  ${ASSOCIATION_LABELS[key].padEnd(20)} planned ${totals.planned}  create ${totals.created}  skip ${totals.skipped}  fail ${totals.failed}`;
    }),
  ];
  if (report.reconciliation.performed) {
    const objects = report.reconciliation.objects;
    lines.push(
      "",
      `reconciliation ${report.reconciliation.match ? "matched" : "MISMATCH"}`,
      ...OBJECT_TYPES.map((type) => {
        const row = objects?.[type];
        return `  ${type.padEnd(12)} expected ${row?.expected ?? 0}  read back ${row?.readBack ?? 0}`;
      }),
    );
  } else if (report.reconciliation.reason) {
    lines.push("", report.reconciliation.reason);
  }
  if (report.validationErrors.length > 0) {
    lines.push("", `validation errors: ${report.validationErrors.length}`);
    for (const error of report.validationErrors.slice(0, 12)) {
      lines.push(`  ${error.object} row ${error.rowNumber} ${error.sourceId}: ${error.field} — ${error.message}`);
    }
    if (report.validationErrors.length > 12) {
      lines.push(`  … ${report.validationErrors.length - 12} more in the report file`);
    }
  }
  if (report.notes.length > 0) {
    lines.push("", ...report.notes.map((note) => `note: ${note}`));
  }
  return lines.join("\n");
}

export function renderMarkdown(report: MigrationReport): string {
  const lines = [
    `# ${report.meta.title} → HubSpot`,
    "",
    `> ${report.disclaimer}`,
    "",
    `- Mode: \`${report.meta.mode}\``,
    `- Source: \`${report.meta.source}\``,
    `- Target: \`${report.meta.target}\``,
    `- Run: \`${report.meta.runId}\``,
    `- Started: ${report.meta.startedAt}`,
    `- Duration: ${report.meta.durationMs} ms`,
    `- Mutating API calls: ${report.meta.writes}`,
  ];
  if (report.meta.command) lines.push(`- Command: \`${report.meta.command}\``);
  lines.push(
    "",
    "## Totals",
    "",
    "| Object | Source | Valid | Invalid | Duplicates | Created | Updated | Skipped | Failed |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...OBJECT_TYPES.map((type) => {
      const totals = report.totals[type];
      return `| ${type} | ${row(totals)} |`;
    }),
    "",
    "## Associations",
    "",
    "| Link | Planned | Created | Skipped | Failed |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...ASSOCIATION_KEYS.map((key) => {
      const totals = report.associations[key];
      return `| ${ASSOCIATION_LABELS[key]} | ${totals.planned} | ${totals.created} | ${totals.skipped} | ${totals.failed} |`;
    }),
    "",
    "## Reconciliation",
    "",
  );
  if (!report.reconciliation.performed) {
    lines.push(report.reconciliation.reason ?? "Not performed.");
  } else {
    lines.push(
      report.reconciliation.match ? "Read-back matched the records this run intended to land." : "Read-back did not match.",
      "",
      "| Object | Expected | Read back | Missing |",
      "| --- | ---: | ---: | --- |",
      ...OBJECT_TYPES.map((type) => {
        const rowData = report.reconciliation.objects?.[type];
        const missing = rowData?.missingIds.length ? rowData.missingIds.join(", ") : "—";
        return `| ${type} | ${rowData?.expected ?? 0} | ${rowData?.readBack ?? 0} | ${missing} |`;
      }),
      "",
      "| Link | Expected | Verified | Missing |",
      "| --- | ---: | ---: | --- |",
      ...ASSOCIATION_KEYS.map((key) => {
        const rowData = report.reconciliation.associations?.[key];
        const missing = rowData?.missing.length ? rowData.missing.slice(0, 8).join(", ") : "—";
        return `| ${ASSOCIATION_LABELS[key]} | ${rowData?.expected ?? 0} | ${rowData?.verified ?? 0} | ${missing} |`;
      }),
    );
  }
  lines.push("", "## Pipelines", "");
  for (const pipeline of report.pipelines) {
    lines.push(`### ${pipeline.sourceName} → ${pipeline.hubspotLabel}${pipeline.hubspotId ? ` (\`${pipeline.hubspotId}\`)` : ""}`, "");
    lines.push("| Source stage | HubSpot stage | Probability | Stage id |", "| --- | --- | ---: | --- |");
    for (const stage of pipeline.stages) {
      lines.push(`| ${stage.source} | ${stage.label} | ${stage.probability} | ${stage.hubspotId ?? "—"} |`);
    }
    lines.push("");
  }
  lines.push("## Validation errors", "");
  if (report.validationErrors.length === 0) lines.push("None.");
  else {
    lines.push("| Object | Row | Source id | Field | Message |", "| --- | ---: | --- | --- | --- |");
    for (const error of report.validationErrors) {
      lines.push(`| ${error.object} | ${error.rowNumber} | ${error.sourceId} | ${error.field} | ${escapePipes(error.message)} |`);
    }
  }
  if (report.warnings.length > 0) {
    lines.push("", "## Warnings", "", "| Object | Row | Source id | Field | Message |", "| --- | ---: | --- | --- | --- |");
    for (const warning of report.warnings) {
      lines.push(`| ${warning.object} | ${warning.rowNumber} | ${warning.sourceId} | ${warning.field} | ${escapePipes(warning.message)} |`);
    }
  }
  lines.push("", "## Actions", "");
  for (const type of OBJECT_TYPES) {
    const actions = report.actions.filter((action) => action.object === type);
    lines.push(`### ${type}`, "", "| Row | Source id | Action | Record | Reason |", "| ---: | --- | --- | --- | --- |");
    for (const action of actions) {
      lines.push(
        `| ${action.rowNumber} | ${action.sourceId} | ${actionLabel(report, action.action)} | ${escapePipes(action.label)} | ${escapePipes(action.reason ?? "")} |`,
      );
    }
    lines.push("");
  }
  if (report.notes.length > 0) {
    lines.push("## Notes", "", ...report.notes.map((note) => `- ${note}`), "");
  }
  return `${lines.join("\n").trim()}\n`;
}

export function renderHtml(report: MigrationReport): string {
  const errorRows = report.validationErrors
    .map(
      (error) =>
        `<tr><td>${escapeHtml(error.object)}</td><td>${error.rowNumber}</td><td><code>${escapeHtml(error.sourceId)}</code></td><td>${escapeHtml(error.field)}</td><td>${escapeHtml(error.message)}</td></tr>`,
    )
    .join("");
  const pipelineBlocks = report.pipelines
    .map((pipeline) => {
      const stages = pipeline.stages
        .map(
          (stage) =>
            `<li><span>${escapeHtml(stage.source)}</span><b>${escapeHtml(stage.label)}</b><em>${stage.probability}</em></li>`,
        )
        .join("");
      return `<section><h3>${escapeHtml(pipeline.sourceName)} → ${escapeHtml(pipeline.hubspotLabel)}</h3><ol>${stages}</ol></section>`;
    })
    .join("");
  const totals = OBJECT_TYPES.map((type) => {
    const row = report.totals[type];
    return `<article><h3>${type}</h3><p>${row.created} created · ${row.updated} updated</p><span>${row.failed} failed · ${row.skipped} skipped · ${row.sourceRows} source</span></article>`;
  }).join("");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(report.meta.title)} migration report</title>
<style>
  :root { color-scheme: light; --ink: #1c1917; --muted: #57534e; --line: #e7e5e4; --paper: #faf7f2; --good: #166534; --bad: #9f1239; }
  body { margin: 0; font: 15px/1.5 "Iowan Old Style", Palatino, Georgia, serif; color: var(--ink); background: var(--paper); }
  main { max-width: 980px; margin: 0 auto; padding: 40px 20px 72px; }
  header p { color: var(--muted); max-width: 62ch; }
  .banner { display: inline-block; border: 1px solid var(--ink); padding: 2px 8px; font: 12px/1.4 ui-monospace, monospace; letter-spacing: 0.02em; }
  .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 24px 0; }
  article, section { background: white; border: 1px solid var(--line); padding: 14px 16px; }
  article h3, section h3 { margin: 0 0 6px; font: 13px/1.3 ui-monospace, monospace; text-transform: uppercase; letter-spacing: 0.04em; }
  article p { margin: 0; font-size: 22px; }
  article span, .meta { color: var(--muted); font: 13px/1.4 ui-monospace, monospace; }
  table { width: 100%; border-collapse: collapse; background: white; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: top; font: 13px/1.4 ui-monospace, monospace; }
  ol { list-style: none; padding: 0; margin: 0; }
  li { display: grid; grid-template-columns: 1.2fr 1.2fr auto; gap: 8px; padding: 6px 0; border-top: 1px solid var(--line); }
  .ok { color: var(--good); } .bad { color: var(--bad); }
  @media (max-width: 720px) { .stats { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<main>
  <p class="banner">Portfolio demo, not client work</p>
  <header>
    <h1>${escapeHtml(report.meta.title)}</h1>
    <p>${escapeHtml(report.meta.description)}</p>
    <p class="meta">${escapeHtml(report.meta.mode)} · ${escapeHtml(report.meta.source)} · ${escapeHtml(report.meta.target)} · ${report.meta.writes} mutating calls · ${escapeHtml(report.meta.runId)}</p>
  </header>
  <div class="stats">${totals}</div>
  <p class="${report.reconciliation.match ? "ok" : "bad"}">${report.reconciliation.performed ? (report.reconciliation.match ? "Reconciliation matched HubSpot." : "Reconciliation found a mismatch.") : escapeHtml(report.reconciliation.reason ?? "")}</p>
  <h2>Pipelines</h2>
  ${pipelineBlocks}
  <h2>Validation errors (${report.validationErrors.length})</h2>
  <table><thead><tr><th>Object</th><th>Row</th><th>Source id</th><th>Field</th><th>Message</th></tr></thead><tbody>${errorRows || `<tr><td colspan="5">None</td></tr>`}</tbody></table>
</main>
</body>
</html>
`;
}

export function writeReportFiles(report: MigrationReport, basename: string): { json: string; markdown: string; html: string } {
  const stem = basename.replace(/\.(json|md|html)$/i, "");
  mkdirSync(dirname(stem), { recursive: true });
  const json = `${stem}.json`;
  const markdown = `${stem}.md`;
  const html = `${stem}.html`;
  writeFileSync(json, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(markdown, renderMarkdown(report));
  writeFileSync(html, renderHtml(report));
  return { json, markdown, html };
}

function row(totals: ObjectTotals): string {
  return [
    totals.sourceRows,
    totals.valid,
    totals.invalid,
    totals.duplicates,
    totals.created,
    totals.updated,
    totals.skipped,
    totals.failed,
  ].join(" | ");
}

function actionLabel(report: MigrationReport, action: string): string {
  if (report.meta.mode !== "dry-run") return action;
  if (action === "create") return "would create";
  if (action === "update") return "would update";
  return action;
}

function table(rows: string[][]): string {
  const widths = rows[0].map((_, column) => Math.max(...rows.map((rowData) => rowData[column]?.length ?? 0)));
  return rows
    .map((rowData) => rowData.map((cell, index) => cell.padEnd(widths[index])).join("  "))
    .join("\n");
}

function escapePipes(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
