import { policy } from "@/lib/rubric/load";
import type { EvaluationResult } from "@/lib/rubric/types";

// Pure loop-control helpers (§11). Safe to import from client components.

export type EvaluatedVersion = { version: number; evaluation: EvaluationResult };

/** Highest Forge Score, then higher raw score, then the later version. */
export function bestVersion<T extends EvaluatedVersion>(versions: T[]): T | undefined {
  if (policy.optimization.return_version === "latest") return versions.at(-1);
  return [...versions].sort(
    (a, b) =>
      b.evaluation.forge_score - a.evaluation.forge_score ||
      b.evaluation.forge_score_raw - a.evaluation.forge_score_raw ||
      b.version - a.version,
  )[0];
}

/** Returns why the loop should stop after the latest evaluated version, or null to keep optimizing. */
export function stopReason(versions: EvaluatedVersion[]): string | null {
  const opt = policy.optimization;
  const latest = versions.at(-1);
  if (!latest) return null;
  const e = latest.evaluation;
  const noCritical = e.critical_failures.length === 0;
  if (e.forge_score >= 95 && noCritical) return "Forge Score ≥ 95 with no critical failures.";
  if (
    e.next_mode === "weak_categories_only" &&
    noCritical &&
    e.categories.every((c) => !c.applicable || c.score! >= opt.refine_category_below)
  )
    return `Every category is at least ${opt.refine_category_below} and there are no critical failures.`;
  if (e.next_mode === "stop") return "The evaluator's next mode is stop.";
  const passes = versions.length - 1;
  if (passes >= opt.max_optimization_passes) return `Reached the maximum of ${opt.max_optimization_passes} optimization passes.`;
  const previous = versions.at(-2);
  if (previous) {
    const gain = e.forge_score - previous.evaluation.forge_score;
    if (gain < 0 && opt.on_regression === "stop_and_keep_best") return `Score went down (${gain.toFixed(2)}); keeping the best version.`;
    const resolvedCritical = previous.evaluation.critical_failures.some((c) => !e.critical_failures.find((x) => x.id === c.id));
    if (gain < opt.plateau_min_gain && !resolvedCritical) return `Improvement of ${gain.toFixed(2)} is below the ${opt.plateau_min_gain}-point plateau threshold.`;
  }
  return null;
}
