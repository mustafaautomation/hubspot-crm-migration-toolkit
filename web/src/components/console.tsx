"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { BundleView, RunView } from "@/lib/runs";

const OBJECTS = ["companies", "contacts", "deals"] as const;
const LINKS = [
  ["contactCompany", "Contact → company"],
  ["dealCompany", "Deal → company"],
  ["dealContact", "Deal → contact"],
] as const;

export function Console({ bundles }: { bundles: BundleView[] }) {
  const [sourceId, setSourceId] = useState(bundles[0]?.id ?? "");
  const bundle = bundles.find((item) => item.id === sourceId) ?? bundles[0];
  const [phaseId, setPhaseId] = useState(bundle?.phases.find((phase) => phase.id === "applied")?.id ?? bundle?.phases[0]?.id ?? "");
  const phase = bundle?.phases.find((item) => item.id === phaseId) ?? bundle?.phases[0];

  if (!bundle || !phase) {
    return (
      <main className="mx-auto max-w-3xl px-5 py-16">
        <p className="font-mono text-xs tracking-wide uppercase">Portfolio demo, not client work</p>
        <h1 className="mt-3 text-3xl font-medium">No migration artifact yet</h1>
        <p className="mt-3 text-muted-foreground">
          Run <code className="font-mono">npm run demo:record</code> or copy a live report into{" "}
          <code className="font-mono">web/data/reports</code>.
        </p>
      </main>
    );
  }

  const run = phase.run;
  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
      <header className="flex flex-col gap-6 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[11px] tracking-[0.16em] uppercase text-muted-foreground">
            hubspot-crm-migration-toolkit · Mustafa
          </p>
          <h1 className="mt-2 text-3xl font-medium tracking-tight sm:text-4xl">Northline migration console</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            <span className="text-foreground">Portfolio demo, not client work.</span> Read-only view of three synthetic
            regional CRM books mapped into one HubSpot account. Domains use the reserved .example TLD. This page does not
            call HubSpot.
          </p>
        </div>
        <Badge variant="outline" className="h-auto px-2.5 py-1 font-mono text-[11px] tracking-wide uppercase">
          Portfolio demo, not client work
        </Badge>
      </header>

      <section className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          {bundles.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setSourceId(item.id);
                setPhaseId(item.phases.find((phaseItem) => phaseItem.id === "applied")?.id ?? item.phases[0]?.id ?? "");
              }}
              aria-pressed={item.id === bundle.id}
              className={`rounded-md border px-3 py-1.5 text-sm ${item.id === bundle.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-muted"}`}
            >
              {item.title}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {bundle.phases.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setPhaseId(item.id)}
              aria-pressed={item.id === phase.id}
              className={`rounded-md px-3 py-1.5 font-mono text-xs ${item.id === phase.id ? "bg-foreground text-background" : "bg-muted text-muted-foreground"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </section>

      <p className="mt-4 max-w-3xl text-sm leading-6">{bundle.scenario}</p>
      <p className="mt-2 font-mono text-xs text-muted-foreground">
        {run.mode} · {run.writes} mutating calls · {run.durationMs} ms · {run.target}
        {bundle.livePortal ? " · read back from HubSpot" : ""}
      </p>

      <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Source rows" value={sum(run, "sourceRows")} detail={`${run.validationErrors.length} validation errors`} />
        <Stat label={run.mode === "dry-run" ? "Would create" : "Created"} value={sum(run, "created")} detail={`${sum(run, "updated")} updated`} />
        <Stat label="Skipped" value={sum(run, "skipped")} detail={`${sum(run, "duplicates")} in-file duplicates`} />
        <Stat label="Failed" value={sum(run, "failed")} detail={`${run.warnings.length} warnings`} />
      </section>

      <Reconciliation run={run} livePortal={bundle.livePortal} />

      <section className="mt-8 grid gap-4 lg:grid-cols-2">
        {run.pipelines.map((pipeline) => (
          <Card key={`${pipeline.sourceName}-${pipeline.hubspotLabel}`} className="p-4">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-sm font-medium">
                {pipeline.sourceName} → {pipeline.hubspotLabel}
              </h2>
              <span className="font-mono text-[11px] text-muted-foreground">{pipeline.hubspotId ?? "id assigned on write"}</span>
            </div>
            <ol className="mt-3 space-y-1.5">
              {pipeline.stages.map((stage) => (
                <li key={stage.source} className="grid grid-cols-[1fr_1fr_auto] gap-2 border-t border-border py-1.5 font-mono text-xs">
                  <span>{stage.source}</span>
                  <span>{stage.label}</span>
                  <span className="text-muted-foreground">{stage.probability}</span>
                </li>
              ))}
            </ol>
          </Card>
        ))}
      </section>

      <IssueTable title="Validation errors" rows={run.validationErrors} empty="This phase has no blocking row errors." />
      <Actions run={run} />
      <Mapping bundle={bundle} />

      {run.notes.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-medium">Notes</h2>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            {run.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </section>
      )}

      <footer className="mt-10 border-t border-border pt-4 font-mono text-[11px] text-muted-foreground">
        {bundle.disclaimer} Author: Mustafa · github.com/mustafaautomation. {run.command ?? run.runId}
      </footer>
    </main>
  );
}

function Stat({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <Card className="p-4">
      <p className="font-mono text-[11px] tracking-wide uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-3xl">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </Card>
  );
}

function Reconciliation({ run, livePortal }: { run: RunView; livePortal: boolean }) {
  if (!run.reconciliation.performed) {
    return (
      <p className="mt-6 rounded-md border border-border bg-card px-4 py-3 text-sm">
        {run.reconciliation.reason ?? "Dry-run does not write, so nothing new is read back."} The counts above are the diff that a live run would apply.
      </p>
    );
  }
  return (
    <Card className="mt-6 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Reconciliation</h2>
        <Badge variant={run.reconciliation.match ? "secondary" : "destructive"}>
          {run.reconciliation.match ? "Read-back matched" : "Mismatch"}
        </Badge>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {livePortal
          ? "Counts were read back from the HubSpot developer sandbox after the write."
          : "Counts were read back through the same HubSpot client, pointed at the toolkit's in-memory API. A --live run with HUBSPOT_TOKEN replaces this artifact."}
      </p>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Object</TableHead>
              <TableHead>Expected</TableHead>
              <TableHead>Read back</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {OBJECTS.map((type) => {
              const row = run.reconciliation.objects?.[type];
              return (
                <TableRow key={type}>
                  <TableCell className="capitalize">{type}</TableCell>
                  <TableCell className="font-mono">{row?.expected ?? 0}</TableCell>
                  <TableCell className="font-mono">{row?.readBack ?? 0}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Association</TableHead>
              <TableHead>Expected</TableHead>
              <TableHead>Verified</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {LINKS.map(([key, label]) => {
              const row = run.reconciliation.associations?.[key];
              return (
                <TableRow key={key}>
                  <TableCell>{label}</TableCell>
                  <TableCell className="font-mono">{row?.expected ?? 0}</TableCell>
                  <TableCell className="font-mono">{row?.verified ?? 0}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

function IssueTable({ title, rows, empty }: { title: string; rows: RunView["validationErrors"]; empty: string }) {
  const [object, setObject] = useState("all");
  const visible = rows.filter((row) => object === "all" || row.object === object);
  return (
    <section className="mt-8">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">
          {title} <span className="font-mono text-muted-foreground">({rows.length})</span>
        </h2>
        <Filter label="Object" value={object} onChange={setObject} options={["all", ...OBJECTS]} />
      </div>
      {visible.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="max-h-80 overflow-auto rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Object</TableHead>
                <TableHead>Row</TableHead>
                <TableHead>Source id</TableHead>
                <TableHead>Field</TableHead>
                <TableHead>Message</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((row) => (
                <TableRow key={`${row.object}-${row.rowNumber}-${row.field}-${row.message}`}>
                  <TableCell>{row.object}</TableCell>
                  <TableCell className="font-mono">{row.rowNumber}</TableCell>
                  <TableCell className="font-mono">{row.sourceId}</TableCell>
                  <TableCell className="font-mono">{row.field}</TableCell>
                  <TableCell>{row.message}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}

function Actions({ run }: { run: RunView }) {
  const [object, setObject] = useState("all");
  const [action, setAction] = useState("all");
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return run.actions.filter((row) => {
      if (object !== "all" && row.object !== object) return false;
      if (action !== "all" && row.action !== action) return false;
      if (!needle) return true;
      return `${row.label} ${row.sourceId} ${row.reason ?? ""}`.toLowerCase().includes(needle);
    });
  }, [action, object, query, run.actions]);
  return (
    <section className="mt-8">
      <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-sm font-medium">
          {run.mode === "dry-run" ? "Dry-run diff" : "Writes"}{" "}
          <span className="font-mono text-muted-foreground">({visible.length})</span>
        </h2>
        <div className="flex flex-wrap gap-2">
          <Filter label="Object" value={object} onChange={setObject} options={["all", ...OBJECTS]} />
          <Filter label="Action" value={action} onChange={setAction} options={["all", "create", "update", "skip", "fail"]} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name or id"
            className="h-8 rounded-md border border-border bg-card px-2 font-mono text-xs"
            aria-label="Search actions"
          />
        </div>
      </div>
      {visible.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
          Nothing matches this filter.
        </p>
      ) : (
        <div className="max-h-96 overflow-auto rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Object</TableHead>
                <TableHead>Record</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((row) => (
                <TableRow key={`${row.object}-${row.sourceId}-${row.rowNumber}`}>
                  <TableCell>{row.object}</TableCell>
                  <TableCell>
                    <div>{row.label}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">{row.sourceId}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={row.action === "fail" ? "destructive" : row.action === "skip" ? "outline" : "secondary"}>
                      {run.mode === "dry-run" && (row.action === "create" || row.action === "update") ? `would ${row.action}` : row.action}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{row.stage ? `${row.pipeline ?? ""} / ${row.stage}` : "—"}</TableCell>
                  <TableCell className="max-w-xs text-xs text-muted-foreground">{row.reason ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}

function Mapping({ bundle }: { bundle: BundleView }) {
  return (
    <section className="mt-8">
      <h2 className="text-sm font-medium">Field mapping</h2>
      <div className="mt-3 grid gap-4 lg:grid-cols-3">
        {OBJECTS.map((type) => (
          <Card key={type} className="p-4">
            <h3 className="font-mono text-xs tracking-wide uppercase">{type}</h3>
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">{bundle.mapping.objects[type]?.file}</p>
            <ul className="mt-3 space-y-2">
              {(bundle.mapping.objects[type]?.fields ?? []).map((field) => (
                <li key={`${field.column}-${field.property}`} className="border-t border-border pt-2 text-xs">
                  <div className="flex items-baseline justify-between gap-2">
                    <span>{field.column}</span>
                    <span className="font-mono text-muted-foreground">{field.property}</span>
                  </div>
                  <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                    {(field.transforms.join(", ") || "as-is") + (field.required ? " · required" : "")}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </section>
  );
}

function Filter({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly string[];
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-8 rounded-md border border-border bg-card px-2 font-mono text-xs"
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

function sum(run: RunView, key: keyof RunView["totals"]["companies"]): number {
  return OBJECTS.reduce((total, type) => total + run.totals[type][key], 0);
}
