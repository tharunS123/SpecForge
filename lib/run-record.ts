import type { EvaluationResult, GapReport, Requirement } from "@/lib/rubric/types";

// The "Export run" format (schemas/run-record.schema.json). Phase 3 can import these into the database.

export type SpecVersion = {
  version: number;
  content: string;
  created_at: string;
  finish_reason: string | null;
  model?: string;
  prompt_version?: string;
  evaluation?: EvaluationResult;
  evaluator?: { name: string; model: string; isStandIn: boolean };
  /** The gap report built from this version's evaluation that produced the next version. */
  gap_report?: GapReport;
};

export type Run = {
  idea: string;
  requirements: Requirement[];
  dropped: { requirement: Requirement; reason: string }[];
  extractor?: { model: string; prompt_version: string };
  versions: SpecVersion[];
};

export type RunRecord = {
  run_record_version: "0.1.0";
  exported_at: string;
  idea: string;
  requirements: Requirement[];
  dropped_requirements: { requirement: Requirement; reason: string }[];
  extractor?: { model: string; prompt_version: string };
  spec_versions: SpecVersion[];
  best_version: number | null;
  stop_reason: string | null;
};

export function buildRunRecord(run: Run, best: number | null, stopReason: string | null, now = new Date()): RunRecord {
  return {
    run_record_version: "0.1.0",
    exported_at: now.toISOString(),
    idea: run.idea,
    requirements: run.requirements,
    dropped_requirements: run.dropped,
    ...(run.extractor ? { extractor: run.extractor } : {}),
    spec_versions: run.versions,
    best_version: best,
    stop_reason: stopReason,
  };
}
