"use client";

import { useEffect, useMemo, useState } from "react";
import { bestVersion, stopReason, type EvaluatedVersion } from "@/lib/eval/loop";
import { categoryNames, policy } from "@/lib/rubric/load";
import type { EvaluationResult, GapReport, Requirement } from "@/lib/rubric/types";
import { buildRunRecord, type Run, type SpecVersion } from "@/lib/run-record";

type Busy = null | "extract" | "generate" | "evaluate" | "optimize";
type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "gap_report"; gap_report: GapReport }
  | { type: "done"; finish_reason: string | null; model: string; prompt_version: string }
  | { type: "error"; message: string };

const STORAGE_KEY = "specforge.run.v1";
const emptyRun = (idea = ""): Run => ({ idea, requirements: [], dropped: [], versions: [] });

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({ error: `Request failed (${res.status})` }));
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json as T;
}

async function postStream(url: string, body: unknown, onEvent: (e: StreamEvent) => void): Promise<void> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok || !res.body) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error ?? `Request failed (${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) onEvent(JSON.parse(line) as StreamEvent);
    if (done) break;
  }
}

export default function Home() {
  const [run, setRun] = useState<Run>(emptyRun());
  const [idea, setIdea] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [streaming, setStreaming] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  // Restore the last run (per-browser convenience only; export is the durable record).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const r = JSON.parse(saved) as Run;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration from localStorage
        setRun(r);
        setIdea(r.idea);
      }
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(run));
    } catch {}
  }, [run]);

  const evaluated = useMemo(
    () => run.versions.filter((v): v is SpecVersion & EvaluatedVersion => !!v.evaluation),
    [run.versions],
  );
  const latest = run.versions.at(-1);
  const best = bestVersion(evaluated);
  const stop = latest?.evaluation ? stopReason(evaluated) : null;
  const shown = run.versions.find((v) => v.version === selected) ?? latest;
  const standIn = run.versions.some((v) => v.evaluator?.isStandIn);

  function patchVersion(n: number, patch: Partial<SpecVersion>) {
    setRun((r) => ({ ...r, versions: r.versions.map((v) => (v.version === n ? { ...v, ...patch } : v)) }));
  }

  async function streamVersion(url: string, body: unknown, n: number, onGap?: (g: GapReport) => void): Promise<SpecVersion> {
    let content = "";
    let done: Extract<StreamEvent, { type: "done" }> | undefined;
    setStreaming("");
    await postStream(url, body, (e) => {
      if (e.type === "delta") {
        content += e.text;
        setStreaming(content);
      } else if (e.type === "gap_report") onGap?.(e.gap_report);
      else if (e.type === "done") done = e;
      else if (e.type === "error") throw new Error(e.message);
    });
    if (!content.trim()) throw new Error("The model returned an empty specification.");
    const version: SpecVersion = {
      version: n,
      content,
      created_at: new Date().toISOString(),
      finish_reason: done?.finish_reason ?? null,
      model: done?.model,
      prompt_version: done?.prompt_version,
    };
    setRun((r) => ({ ...r, versions: [...r.versions, version] }));
    setSelected(n);
    return version;
  }

  async function evaluate(r: Run, v: SpecVersion) {
    setBusy("evaluate");
    const res = await postJson<{ evaluation: EvaluationResult; provider: SpecVersion["evaluator"] }>("/api/evaluate", {
      idea: r.idea,
      spec: v.content,
      requirements: r.requirements,
      specVersion: v.version,
    });
    patchVersion(v.version, { evaluation: res.evaluation, evaluator: res.provider });
  }

  async function withBusy(fn: () => Promise<void>) {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      setStreaming("");
    }
  }

  const generatePlan = () =>
    withBusy(async () => {
      setBusy("extract");
      const fresh = emptyRun(idea.trim());
      setRun(fresh);
      setSelected(null);
      const extracted = await postJson<{ requirements: Requirement[]; dropped: Run["dropped"]; model: string; prompt_version: string }>(
        "/api/requirements",
        { idea: fresh.idea },
      );
      const withReqs: Run = {
        ...fresh,
        requirements: extracted.requirements,
        dropped: extracted.dropped,
        extractor: { model: extracted.model, prompt_version: extracted.prompt_version },
      };
      setRun(withReqs);
      setBusy("generate");
      await streamVersion("/api/generate", { idea: withReqs.idea, requirements: withReqs.requirements }, 1);
    });

  const evaluateLatest = () => withBusy(async () => latest && (await evaluate(run, latest)));

  const optimize = () =>
    withBusy(async () => {
      if (!latest?.evaluation) return;
      setBusy("optimize");
      const next = await streamVersion(
        "/api/optimize",
        { idea: run.idea, spec: latest.content, specVersion: latest.version, evaluation: latest.evaluation },
        latest.version + 1,
        (gap) => patchVersion(latest.version, { gap_report: gap }),
      );
      await evaluate(run, next);
    });

  async function copyBest() {
    if (!best) return;
    await navigator.clipboard.writeText(best.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function exportRun() {
    const record = buildRunRecord(run, best?.version ?? null, stop);
    const blob = new Blob([JSON.stringify(record, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `specforge-run-${record.exported_at.replace(/[:.]/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const canOptimize = !busy && !!latest?.evaluation && !stop;

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-8">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold">SpecForge</h1>
        <span className="text-xs text-neutral-500">
          rubric {policy.rubric_version} · policy {policy.policy_version} · Phase 1 slice
        </span>
      </header>

      <section className="space-y-2">
        <label htmlFor="idea" className="block font-medium">
          What do you want to build?
        </label>
        <textarea
          id="idea"
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          rows={5}
          maxLength={5000}
          placeholder="Build me an iPhone expense tracker…"
          className="w-full rounded border border-neutral-400 bg-transparent p-2 font-mono text-sm"
        />
        <p className="text-xs text-neutral-500">
          Free OpenRouter models may log prompts — don&apos;t paste secrets or private data.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={generatePlan} disabled={!!busy || idea.trim().length < 10}>
            Generate Plan
          </Button>
          <Button onClick={evaluateLatest} disabled={!!busy || !latest || !!latest.evaluation}>
            Evaluate
          </Button>
          <Button onClick={optimize} disabled={!canOptimize}>
            Optimize
          </Button>
          <Button onClick={copyBest} disabled={!best}>
            {copied ? "Copied!" : best ? `Copy Final Spec (V${best.version})` : "Copy Final Spec"}
          </Button>
          <Button onClick={exportRun} disabled={!run.versions.length}>
            Export run
          </Button>
          <Button
            onClick={() => {
              setRun(emptyRun());
              setIdea("");
              setSelected(null);
              setError(null);
            }}
            disabled={!!busy}
          >
            New run
          </Button>
        </div>
      </section>

      {busy && <Notice tone="info">{busyLabel(busy)}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      {standIn && (
        <Notice tone="warn">
          Evaluator: LLM stand-in, not Jev. Scores come from a free model answering the rubric questions, not calibrated
          probabilities.
        </Notice>
      )}

      {run.versions.length > 0 && (
        <section className="space-y-1">
          <h2 className="font-semibold">Versions</h2>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {run.versions.map((v, i) => (
              <span key={v.version} className="flex items-center gap-2">
                {i > 0 && <span className="text-neutral-400">→</span>}
                <button
                  onClick={() => setSelected(v.version)}
                  className={`rounded border px-2 py-1 ${shown?.version === v.version ? "border-blue-600 font-semibold" : "border-neutral-400"}`}
                >
                  V{v.version} {v.evaluation ? Math.round(v.evaluation.forge_score) : "–"}
                  {best?.version === v.version ? " ★" : ""}
                </button>
              </span>
            ))}
          </div>
          {stop && <p className="text-sm text-neutral-600 dark:text-neutral-400">Stopped: {stop}</p>}
        </section>
      )}

      {run.requirements.length > 0 && (
        <details className="rounded border border-neutral-300 p-3 dark:border-neutral-700">
          <summary className="cursor-pointer font-semibold">
            Extracted requirements ({run.requirements.length}
            {run.dropped.length ? `, ${run.dropped.length} dropped` : ""})
          </summary>
          <ul className="mt-2 space-y-1 text-sm">
            {run.requirements.map((r) => (
              <li key={r.id}>
                <b>{r.id}</b> <span className="text-neutral-500">[{r.kind}]</span> {r.text}
              </li>
            ))}
            {run.dropped.map((d, i) => (
              <li key={`d${i}`} className="text-neutral-500 line-through" title={d.reason}>
                {d.requirement.id} {d.requirement.text} ({d.reason})
              </li>
            ))}
          </ul>
        </details>
      )}

      {shown?.evaluation && (
        <Scorecard
          evaluation={shown.evaluation}
          previous={run.versions.find((v) => v.version === shown.version - 1)?.evaluation}
        />
      )}

      {(streaming || shown) && (
        <section className="space-y-2">
          <h2 className="font-semibold">
            {streaming ? "Writing…" : `Specification V${shown!.version}`}
            {!streaming && shown?.model && <span className="ml-2 text-xs font-normal text-neutral-500">{shown.model}</span>}
          </h2>
          {!streaming && shown?.finish_reason === "length" && (
            <Notice tone="warn">This version hit the model&apos;s output limit and may be cut off.</Notice>
          )}
          <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap rounded border border-neutral-300 p-3 font-mono text-xs dark:border-neutral-700">
            {streaming || shown!.content}
          </pre>
        </section>
      )}
    </main>
  );
}

function busyLabel(b: Exclude<Busy, null>) {
  return {
    extract: "Extracting requirements…",
    generate: "Writing specification V1…",
    evaluate: "Evaluating against the rubric…",
    optimize: "Optimizing from the gap report…",
  }[b];
}

function Button(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className="rounded border border-neutral-500 px-3 py-1.5 text-sm font-medium hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-neutral-800"
    />
  );
}

function Notice({ tone, children }: { tone: "info" | "warn" | "error"; children: React.ReactNode }) {
  const cls = {
    info: "border-blue-400 bg-blue-50 text-blue-900 dark:bg-blue-950 dark:text-blue-100",
    warn: "border-yellow-500 bg-yellow-50 text-yellow-900 dark:bg-yellow-950 dark:text-yellow-100",
    error: "border-red-500 bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-100",
  }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded border p-3 text-sm ${cls}`}>
      {children}
    </div>
  );
}

function Scorecard({ evaluation: e, previous }: { evaluation: EvaluationResult; previous?: EvaluationResult }) {
  const delta = previous ? e.forge_score - previous.forge_score : null;
  const flagged = e.checks.filter((c) => c.flags.some((f) => f === "uncertain" || f === "low_confidence" || f === "insufficient_evidence"));
  return (
    <section className="space-y-4 rounded border border-neutral-300 p-4 dark:border-neutral-700">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="text-sm font-semibold uppercase tracking-wide">Build readiness</h2>
        <span className="text-4xl font-bold">{Math.round(e.forge_score)}</span>
        <span className="text-neutral-500">/ 100</span>
        {delta !== null && (
          <span className={delta >= 0 ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}>
            {delta >= 0 ? "+" : ""}
            {delta.toFixed(1)} vs V{(e.spec_version ?? 2) - 1}
          </span>
        )}
        <span className="rounded border px-2 text-sm">{e.band.replace("_", " ")}</span>
        <span className={`rounded px-2 text-sm text-white ${e.pass ? "bg-green-700" : "bg-neutral-500"}`}>{e.pass ? "PASS" : "NOT PASS"}</span>
        <span className="text-xs text-neutral-500">
          raw {e.forge_score_raw} · next: {e.next_mode.replaceAll("_", " ")} · {e.evaluator_model}
        </span>
      </div>

      <div className="grid gap-1 text-sm">
        {e.categories.map((c) => (
          <div key={c.id} className="grid grid-cols-[10rem_1fr_3rem] items-center gap-2">
            <span>{categoryNames[c.id]}</span>
            <div className="h-3 rounded bg-neutral-200 dark:bg-neutral-800">
              {c.applicable && (
                <div
                  className={`h-3 rounded ${c.score! < policy.pass.min_category_score ? "bg-red-500" : c.score! < 85 ? "bg-yellow-500" : "bg-green-600"}`}
                  style={{ width: `${c.score}%` }}
                />
              )}
            </div>
            <span className="text-right tabular-nums">{c.applicable ? Math.round(c.score!) : "n/a"}</span>
          </div>
        ))}
      </div>

      {e.critical_failures.length > 0 && (
        <div>
          <h3 className="font-semibold text-red-700 dark:text-red-400">Critical failures (score capped at {policy.critical_cap})</h3>
          <ul className="list-inside list-disc text-sm">
            {e.critical_failures.map((c) => (
              <li key={c.id}>{c.message}</li>
            ))}
          </ul>
        </div>
      )}

      {e.requirements.length > 0 && (
        <div>
          <h3 className="font-semibold">
            Requirements: {e.requirements.filter((r) => r.status === "covered").length}/{e.requirements.length} verified
          </h3>
          <ul className="text-sm">
            {e.requirements.map((r) => (
              <li key={r.id}>
                {r.status === "covered" ? "✓" : r.status === "uncertain" ? "?" : "✗"} <b>{r.id}</b> {r.text}
              </li>
            ))}
          </ul>
        </div>
      )}

      {(flagged.length > 0 || e.preflight.sections_missing.length > 0) && (
        <details className="text-sm">
          <summary className="cursor-pointer">Details</summary>
          {e.preflight.sections_missing.length > 0 && <p>Missing sections: {e.preflight.sections_missing.join(", ")}</p>}
          {flagged.length > 0 && <p>Uncertain or low-confidence checks: {flagged.map((c) => c.id).join(", ")}</p>}
          <p>Spec size: ~{e.preflight.spec_tokens_estimate.toLocaleString()} tokens</p>
        </details>
      )}
    </section>
  );
}
