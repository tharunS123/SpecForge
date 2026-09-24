import { describe, expect, it } from "vitest";
import { buildJevRequest } from "@/lib/eval/build-request";
import { toJevAnswers } from "@/lib/eval/llm-provider";
import { scoreEvaluation, missingSections } from "@/lib/eval/score";
import type { EvaluationResult, JevResponse, Requirement } from "@/lib/rubric/types";
import { readJson, readText } from "./helpers";

const idea = readText("fixtures/v0.1/expense-tracker-ios/idea.md").trim();
const spec = readText("fixtures/v0.1/expense-tracker-ios/spec-medium.md");
const { requirements } = readJson<{ requirements: Requirement[] }>("docs/examples/extracted-requirements.example.json");
const response = readJson<JevResponse>("docs/examples/jev-response.example.json");
const expected = readJson<EvaluationResult>("docs/examples/evaluation-result.example.json");

function score(r: JevResponse = response) {
  return scoreEvaluation({ userRequest: idea, spec, requirements, response: r, specVersion: 1 });
}

describe("scoring engine", () => {
  it("reproduces the worked example in docs/evaluation-system-v0.1.md §12 exactly", () => {
    const result = score();
    delete result.usage; // the example files predate usage reporting
    expect(result).toEqual(expected);
    expect(result.forge_score).toBe(70.39);
    expect(result.band).toBe("needs_work");
    expect(result.next_mode).toBe("targeted");
    expect(result.critical_failures).toEqual([]);
  });

  it("caps the score at 69 and forces at least targeted mode when a critical rule fires", () => {
    // A near-perfect spec (every answer at its best option) with a single critical failure.
    const request = buildJevRequest(idea, spec, requirements);
    const best = Object.fromEntries(
      Object.entries(request.questions).map(([k, q]) => [
        k,
        q.type === "noul" ? (k === "req_scope_creep_v1" || k === "dep_contradictions_v1" ? "no" : "yes") : q.type === "choice" ? Object.keys(q.criteria)[0] : q.criteria.length - 1,
      ]),
    );
    const r: JevResponse = { model: "test", answers: toJevAnswers(request.questions, best) };
    expect(score(r).forge_score).toBeGreaterThan(95);

    r.answers.ui_states_v1 = { type: "choice", choice: "missing", probabilities: { all_states: 0.1, some_states: 0.2, missing: 0.7 }, confidence: 0.5 };
    const result = score(r);
    expect(result.critical_failures.map((c) => c.id)).toEqual(["crit.ui_states_missing"]);
    expect(result.forge_score_raw).toBeGreaterThan(90);
    expect(result.forge_score).toBe(69);
    expect(result.band).toBe("weak");
    expect(result.next_mode).toBe("targeted");
    expect(result.pass).toBe(false);
  });

  it("drops gated checks and renormalizes when a gate does not apply", () => {
    const r = structuredClone(response);
    r.answers.gate_has_ui_v1 = { type: "noul", noul: 0.1 };
    const result = score(r);
    expect(result.categories.find((c) => c.id === "ui_ux")).toMatchObject({ applicable: false, score: null });
    expect(result.checks.find((c) => c.id === "ui.states")?.flags).toEqual(["gated_out"]);
  });

  it("fires requirement coverage below 80%", () => {
    const r = structuredClone(response);
    for (const k of ["req_r1_v1", "req_r2_v1", "req_r3_v1"]) r.answers[k] = { type: "noul", noul: 0.1 };
    expect(score(r).critical_failures.map((c) => c.id)).toContain("crit.requirement_coverage");
  });

  it("throws a clear error when an answer is missing", () => {
    const r = structuredClone(response);
    delete r.answers.dep_coherent_v1;
    expect(() => score(r)).toThrow(/dep_coherent_v1/);
  });

  it("detects template sections regardless of numbering", () => {
    expect(missingSections(spec)).toEqual([]);
    expect(missingSections("## Overview\n## 2. Scope")).toHaveLength(10);
  });
});
