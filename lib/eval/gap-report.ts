import { categoryNames, policy, rubric } from "@/lib/rubric/load";
import type { CheckResult, EvaluationResult, GapReport } from "@/lib/rubric/types";

const fixHint = new Map(rubric.checks.map((c) => [c.id, c.fix_hint]));

function summarize(check: CheckResult): string {
  const a = check.answer as { type?: string; choice?: string; confidence?: number; noul?: number; score?: number } | undefined;
  if (a?.type === "choice") return `${a.choice} (confidence ${a.confidence})`;
  if (a?.type === "noul") return `noul ${a.noul}`;
  if (a?.type === "score") return `score ${a.score}`;
  return JSON.stringify(check.answer);
}

/** Builds the optimizer input (§11) from an evaluation. Returns null when the loop should not optimize. */
export function buildGapReport(originalRequest: string, currentSpec: string, specVersion: number, evaluation: EvaluationResult): GapReport | null {
  const mode = evaluation.next_mode;
  if (mode === "stop") return null;
  const opt = policy.optimization;
  const threshold = mode === "weak_categories_only" ? opt.refine_category_below : opt.weak_category_below;
  const applicable = evaluation.categories.filter((c) => c.applicable && c.score !== null);

  return {
    original_request: originalRequest,
    current_spec: currentSpec,
    spec_version: specVersion,
    forge_score: evaluation.forge_score,
    forge_score_raw: evaluation.forge_score_raw,
    mode,
    critical: evaluation.critical_failures.map((c) => ({
      id: c.id,
      message: c.message,
      fix_hint: c.check ? fixHint.get(c.check)! : "Shorten the specification.",
    })),
    weak: applicable
      .filter((c) => c.score! < threshold)
      .sort((a, b) => a.score! - b.score!)
      .map((c) => ({
        category: c.id,
        name: categoryNames[c.id],
        score: c.score!,
        failing_checks: evaluation.checks
          .filter((x) => x.category === c.id && x.applicable && x.points! < opt.failing_check_below)
          .map((x) => ({ id: x.id, points: x.points!, answer_summary: summarize(x), fix_hint: fixHint.get(x.id)! })),
      })),
    strong: applicable
      .filter((c) => c.score! >= opt.strong_category_at)
      .map((c) => ({ category: c.id, name: categoryNames[c.id], score: c.score! })),
    uncovered_requirements: evaluation.requirements
      .filter((r) => r.status !== "covered")
      .map((r) => ({ id: r.id, text: r.text, status: r.status as "uncertain" | "missing" })),
  };
}

const bullet = (lines: string[]) => (lines.length ? lines.join("\n") : "None.");

/** Placeholder values for prompts/v0.1/optimizer.md (everything except mode_instructions). */
export function optimizerVariables(gap: GapReport): Record<string, string> {
  return {
    original_request: gap.original_request,
    current_spec: gap.current_spec,
    spec_version: String(gap.spec_version),
    forge_score: String(gap.forge_score),
    forge_score_raw: String(gap.forge_score_raw),
    mode: gap.mode,
    critical_list: bullet(gap.critical.map((c) => `- [${c.id}] ${c.message}\n  Fix: ${c.fix_hint}`)),
    weak_list: bullet(
      gap.weak.map(
        (w) =>
          `- ${w.name}: ${w.score}/100\n` +
          w.failing_checks.map((f) => `  - ${f.id} (points ${f.points}; evaluator said: ${f.answer_summary}). Fix: ${f.fix_hint}`).join("\n"),
      ),
    ),
    strong_list: bullet(gap.strong.map((s) => `- ${s.name}: ${s.score}/100`)),
    uncovered_requirements_list: bullet(gap.uncovered_requirements.map((r) => `- ${r.id} (${r.status}): ${r.text}`)),
  };
}
