// Types mirroring schemas/*.schema.json. The JSON Schemas are authoritative;
// tests validate the rubric, policy, and example payloads against them.

export type Instructions = string | Record<string, unknown> | unknown[];

// ---------- Jev wire format (schemas/jev-request, schemas/jev-response) ----------

export type NoulQuestion = { type: "noul"; instructions: Instructions; criteria?: { true: string; false: string } };
export type ChoiceQuestion = { type: "choice"; instructions: Instructions; criteria: Record<string, string> };
export type ScoreQuestion = { type: "score"; instructions: Instructions; criteria: string[] };
export type JevQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export type JevState = { user_request: string; specification: string };
export type JevRequest = { state: JevState; model: string; questions: Record<string, JevQuestion> };

export type NoulAnswer = { type: "noul"; noul: number };
export type ChoiceAnswer = { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number };
export type ScoreAnswer = {
  type: "score";
  score: number;
  legend?: Record<string, unknown> | null;
  probabilities: Record<string, number>;
  confidence: number;
};
export type JevAnswer = NoulAnswer | ChoiceAnswer | ScoreAnswer;
export type JevResponse = {
  model: string;
  answers: Record<string, JevAnswer>;
  usage?: { input_tokens?: number; output_tokens?: number };
};

// ---------- Rubric (schemas/rubric.schema.json) ----------

export type Category = { id: string; name: string; description: string };
export type Gate = {
  id: string;
  version: number;
  key: string;
  type: "noul";
  instructions: string;
  criteria?: { true: string; false: string };
};

type CheckBase = {
  id: string;
  version: number;
  category: string;
  weight: number;
  applies_when?: string[];
  fix_hint: string;
};
export type NoulCheck = CheckBase & {
  kind: "jev";
  type: "noul";
  instructions: Instructions;
  criteria?: { true: string; false: string };
  polarity?: "positive" | "negative";
};
export type ChoiceCheck = CheckBase & {
  kind: "jev";
  type: "choice";
  instructions: Instructions;
  criteria: Record<string, string>;
  points: Record<string, number | null>;
};
export type ScoreCheck = CheckBase & {
  kind: "jev";
  type: "score";
  instructions: Instructions;
  criteria: string[];
  points: "linear";
};
export type DynamicCheck = CheckBase & {
  kind: "jev_dynamic";
  type: "noul";
  source: "extracted_requirements";
  key_template: string;
  instructions_template: Instructions;
  criteria?: { true: string; false: string };
  aggregation: "coverage_ratio";
};
export type Rule =
  | { type: "sections_present"; sections_from: string }
  | { type: "count_pattern"; pattern: string; unique?: boolean; full_points_at: number }
  | { type: "absent_pattern"; pattern: string; case_insensitive?: boolean };
export type RuleCheck = CheckBase & { kind: "rule"; rule: Rule };
export type JevCheck = NoulCheck | ChoiceCheck | ScoreCheck;
export type Check = JevCheck | DynamicCheck | RuleCheck;

export type Rubric = {
  rubric_version: string;
  evaluator_model: string;
  description?: string;
  state_contract: { format: "json"; fields: Record<string, string> };
  categories: Category[];
  gates: Gate[];
  checks: Check[];
};

// ---------- Policy (schemas/policy.schema.json) ----------

export type Mode = "major_rewrite" | "targeted" | "weak_categories_only" | "stop";
export type CriticalRule = {
  id: string;
  source: { check: string } | { preflight: "spec_tokens" };
  when: { above: number } | { ratio_below: number } | { options: string[]; min_probability: number };
  requires_gates?: string[];
  message: string;
};
export type Band = { id: "excellent" | "pass" | "needs_work" | "weak"; min: number; label: string };
export type Policy = {
  policy_version: string;
  rubric_version: string;
  category_weights: Record<string, number>;
  gates: { applies_at: number };
  noul: { pass_at: number; fail_at: number; pass_points: number; fail_points: number; uncertain_points: number };
  choice: { scoring: "expected_value"; not_applicable_at: number; low_confidence_below: number };
  score: { scoring: "linear"; low_confidence_below: number };
  requirements: { max_extracted: number; evaluate_kinds: ("explicit" | "implied")[]; require_source_quote_match: boolean };
  preflight: {
    max_spec_tokens: number;
    token_estimate: "chars_div_4";
    required_sections: string[];
    section_heading_pattern: string;
  };
  critical_rules: CriticalRule[];
  critical_cap: number;
  pass: { min_forge_score: number; min_category_score: number; allow_critical: boolean };
  bands: Band[];
  optimization: {
    mode_score: "forge_score_raw" | "forge_score";
    modes: { id: Mode; min: number; max_exclusive: number | null }[];
    critical_forces_mode_at_least: Mode;
    weak_category_below: number;
    strong_category_at: number;
    refine_category_below: number;
    failing_check_below: number;
    max_optimization_passes: number;
    plateau_min_gain: number;
    on_regression: "stop_and_keep_best" | "continue";
    return_version: "best_forge_score" | "latest";
    stop_conditions: string[];
  };
};

// ---------- Requirements (schemas/extracted-requirements.schema.json) ----------

export type Requirement = { id: string; kind: "explicit" | "implied"; text: string; source_quote: string };

// ---------- Evaluation result (schemas/evaluation-result.schema.json) ----------

export type CheckFlag = "uncertain" | "low_confidence" | "not_applicable" | "gated_out" | "insufficient_evidence";
export type CheckResult = {
  id: string;
  version: number;
  category: string;
  applicable: boolean;
  points: number | null;
  answer?: unknown;
  flags: CheckFlag[];
};
export type RequirementResult = { id: string; text: string; noul: number; status: "covered" | "uncertain" | "missing" };
export type CategoryResult = { id: string; weight: number; applicable: boolean; score: number | null };
export type CriticalFailure = { id: string; check?: string; message: string };
export type EvaluationResult = {
  rubric_version: string;
  policy_version: string;
  evaluator_model: string;
  spec_version?: number;
  preflight: { spec_tokens_estimate: number; sections_missing: string[] };
  gates: Record<string, { noul: number; applies: boolean }>;
  requirements: RequirementResult[];
  checks: CheckResult[];
  categories: CategoryResult[];
  forge_score_raw: number;
  forge_score: number;
  critical_failures: CriticalFailure[];
  band: Band["id"];
  pass: boolean;
  next_mode: Mode;
  usage?: Record<string, unknown>;
};

// ---------- Gap report (schemas/gap-report.schema.json) ----------

export type GapReport = {
  original_request: string;
  current_spec: string;
  spec_version: number;
  forge_score: number;
  forge_score_raw: number;
  mode: Exclude<Mode, "stop">;
  critical: { id: string; message: string; fix_hint: string }[];
  weak: {
    category: string;
    name: string;
    score: number;
    failing_checks: { id: string; points: number; answer_summary?: string; fix_hint: string }[];
  }[];
  strong: { category: string; name: string; score: number }[];
  uncovered_requirements: { id: string; text: string; status?: "uncertain" | "missing" }[];
};
