import { checkKey, policy, rubric } from "@/lib/rubric/load";
import type {
  CategoryResult,
  Check,
  CheckFlag,
  CheckResult,
  ChoiceAnswer,
  CriticalFailure,
  EvaluationResult,
  JevAnswer,
  JevResponse,
  Mode,
  Requirement,
  RequirementResult,
} from "@/lib/rubric/types";
import { requirementKey } from "./build-request";
import { evaluatedRequirements } from "./requirements";

// Deterministic scoring engine: turns a provider response plus rule checks into an EvaluationResult.
// Every threshold comes from policy.json; the arithmetic follows docs/evaluation-system-v0.1.md §8–11.

const round = (x: number, places: number) => Math.round(x * 10 ** places) / 10 ** places;
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function estimateTokens(spec: string): number {
  return Math.ceil(spec.length / 4);
}

export function missingSections(spec: string): string[] {
  return policy.preflight.required_sections.filter(
    (s) => !new RegExp(policy.preflight.section_heading_pattern.replace("{section}", escapeRegExp(s)), "mi").test(spec),
  );
}

function answerOf<T extends JevAnswer["type"]>(response: JevResponse, key: string, type: T): Extract<JevAnswer, { type: T }> {
  const answer = response.answers[key];
  if (!answer) throw new Error(`evaluator response is missing an answer for "${key}"`);
  if (answer.type !== type) throw new Error(`answer "${key}" has type ${answer.type}, expected ${type}`);
  return answer as Extract<JevAnswer, { type: T }>;
}

/** Noul thresholding: pass / fail / uncertain, never used as a degree (§8). */
function noulPoints(value: number, negative: boolean): [number, CheckFlag[]] {
  const x = negative ? 1 - value : value;
  if (x >= policy.noul.pass_at) return [policy.noul.pass_points, []];
  if (x <= policy.noul.fail_at) return [policy.noul.fail_points, []];
  return [policy.noul.uncertain_points, ["uncertain"]];
}

type Scored = { points: number | null; flags: CheckFlag[]; answer?: unknown };

function scoreRule(check: Extract<Check, { kind: "rule" }>, spec: string, missing: string[]): Scored {
  const rule = check.rule;
  if (rule.type === "sections_present") {
    const n = policy.preflight.required_sections.length;
    return { points: (n - missing.length) / n, flags: [], answer: { sections_missing: missing } };
  }
  if (rule.type === "count_pattern") {
    const matches = spec.match(new RegExp(rule.pattern, "g")) ?? [];
    const count = rule.unique ? new Set(matches).size : matches.length;
    return { points: Math.min(1, count / rule.full_points_at), flags: [], answer: { count } };
  }
  const matches = spec.match(new RegExp(rule.pattern, rule.case_insensitive ? "gi" : "g")) ?? [];
  return { points: matches.length ? 0 : 1, flags: [], answer: { matches } };
}

function scoreChoice(points: Record<string, number | null>, a: ChoiceAnswer): Scored {
  const escape = Object.entries(points).filter(([, v]) => v === null).map(([k]) => k);
  const pEscape = escape.reduce((s, k) => s + (a.probabilities[k] ?? 0), 0);
  if (escape.length && pEscape >= policy.choice.not_applicable_at) return { points: null, flags: ["not_applicable"], answer: a };
  const scored = Object.entries(points).filter((e): e is [string, number] => e[1] !== null);
  const total = scored.reduce((s, [k]) => s + (a.probabilities[k] ?? 0), 0);
  if (total <= 0) return { points: null, flags: ["not_applicable"], answer: a };
  const flags: CheckFlag[] = [];
  if (a.confidence < policy.choice.low_confidence_below) flags.push("low_confidence");
  if ((a.probabilities.insufficient_evidence ?? 0) >= 0.5) flags.push("insufficient_evidence");
  return { points: scored.reduce((s, [k, v]) => s + (a.probabilities[k] ?? 0) * v, 0) / total, flags, answer: a };
}

export function scoreEvaluation(args: {
  userRequest: string;
  spec: string;
  requirements: Requirement[];
  response: JevResponse;
  specVersion?: number;
  evaluatorModel?: string;
}): EvaluationResult {
  const { spec, response } = args;

  // Gates
  const gates: EvaluationResult["gates"] = {};
  for (const g of rubric.gates) {
    const v = answerOf(response, g.key, "noul").noul;
    gates[g.id] = { noul: v, applies: v >= policy.gates.applies_at };
  }

  // Preflight (deterministic)
  const tokens = estimateTokens(spec);
  const missing = missingSections(spec);

  // Per-requirement coverage (§6)
  const reqResults: (RequirementResult & { pts: number })[] = evaluatedRequirements(args.requirements).map((r) => {
    const v = answerOf(response, requirementKey(r.id), "noul").noul;
    const [pts] = noulPoints(v, false);
    const status = pts === policy.noul.pass_points ? "covered" : pts === policy.noul.fail_points ? "missing" : "uncertain";
    return { id: r.id, text: r.text, noul: v, status, pts };
  });
  const coverage = reqResults.length ? reqResults.reduce((s, r) => s + r.pts, 0) / reqResults.length : null;

  // Checks
  const checks: CheckResult[] = rubric.checks.map((c) => {
    const gatedOut = (c.applies_when ?? []).some((g) => !gates[g]?.applies);
    let scored: Scored;
    if (gatedOut) scored = { points: null, flags: ["gated_out"] };
    else if (c.kind === "rule") scored = scoreRule(c, spec, missing);
    else if (c.kind === "jev_dynamic")
      scored = coverage === null ? { points: null, flags: ["not_applicable"] } : { points: coverage, flags: [], answer: { coverage_ratio: coverage } };
    else if (c.type === "noul") {
      const a = answerOf(response, checkKey(c), "noul");
      const [points, flags] = noulPoints(a.noul, c.polarity === "negative");
      scored = { points, flags, answer: a };
    } else if (c.type === "score") {
      const a = answerOf(response, checkKey(c), "score");
      const flags: CheckFlag[] = a.confidence < policy.score.low_confidence_below ? ["low_confidence"] : [];
      scored = { points: a.score / (c.criteria.length - 1), flags, answer: a };
    } else scored = scoreChoice(c.points, answerOf(response, checkKey(c), "choice"));

    return {
      id: c.id,
      version: c.version,
      category: c.category,
      applicable: scored.points !== null,
      points: scored.points === null ? null : round(scored.points, 4),
      ...(scored.answer !== undefined ? { answer: scored.answer } : {}),
      flags: scored.flags,
    };
  });

  // Categories and Forge Score (§8)
  const weightOf = new Map(rubric.checks.map((c) => [c.id, c.weight]));
  const categories: CategoryResult[] = rubric.categories.map((cat) => {
    const cs = checks.filter((x) => x.category === cat.id && x.applicable);
    const tw = cs.reduce((s, x) => s + weightOf.get(x.id)!, 0);
    const score = tw ? round((100 * cs.reduce((s, x) => s + weightOf.get(x.id)! * x.points!, 0)) / tw, 2) : null;
    return { id: cat.id, weight: policy.category_weights[cat.id], applicable: score !== null, score };
  });
  const applicable = categories.filter((c) => c.applicable);
  const totalWeight = applicable.reduce((s, c) => s + c.weight, 0);
  const raw = totalWeight ? applicable.reduce((s, c) => s + c.weight * c.score!, 0) / totalWeight : 0;

  // Critical failures (§9)
  const critical: CriticalFailure[] = [];
  for (const rule of policy.critical_rules) {
    if ((rule.requires_gates ?? []).some((g) => !gates[g]?.applies)) continue;
    if ("preflight" in rule.source) {
      if ("above" in rule.when && tokens > rule.when.above) critical.push({ id: rule.id, message: rule.message });
      continue;
    }
    const check = checks.find((x) => x.id === (rule.source as { check: string }).check);
    if (!check?.applicable) continue;
    if ("ratio_below" in rule.when) {
      if (coverage !== null && coverage < rule.when.ratio_below) critical.push({ id: rule.id, check: check.id, message: rule.message });
      continue;
    }
    if ("options" in rule.when) {
      const probs = (check.answer as ChoiceAnswer | undefined)?.probabilities ?? {};
      const p = rule.when.options.reduce((s, o) => s + (probs[o] ?? 0), 0);
      if (p >= rule.when.min_probability) critical.push({ id: rule.id, check: check.id, message: rule.message });
    }
  }

  // Cap, band, pass, next mode (§9–11)
  const forge = critical.length ? Math.min(raw, policy.critical_cap) : raw;
  const band = [...policy.bands].sort((a, b) => b.min - a.min).find((b) => forge >= b.min)!.id;
  const pass =
    forge >= policy.pass.min_forge_score &&
    (policy.pass.allow_critical || critical.length === 0) &&
    applicable.every((c) => c.score! >= policy.pass.min_category_score);
  const modeScore = policy.optimization.mode_score === "forge_score_raw" ? raw : forge;
  let nextMode: Mode = policy.optimization.modes.find(
    (m) => modeScore >= m.min && (m.max_exclusive === null || modeScore < m.max_exclusive),
  )!.id;
  const order = policy.optimization.modes.map((m) => m.id);
  const floor = policy.optimization.critical_forces_mode_at_least;
  if (critical.length && order.indexOf(nextMode) > order.indexOf(floor)) nextMode = floor;

  return {
    rubric_version: rubric.rubric_version,
    policy_version: policy.policy_version,
    evaluator_model: args.evaluatorModel ?? response.model,
    ...(args.specVersion !== undefined ? { spec_version: args.specVersion } : {}),
    preflight: { spec_tokens_estimate: tokens, sections_missing: missing },
    gates,
    requirements: reqResults.map((r) => ({ id: r.id, text: r.text, noul: r.noul, status: r.status })),
    checks,
    categories,
    forge_score_raw: round(raw, 2),
    forge_score: round(forge, 2),
    critical_failures: critical,
    band,
    pass,
    next_mode: nextMode,
    ...(response.usage ? { usage: response.usage } : {}),
  };
}
