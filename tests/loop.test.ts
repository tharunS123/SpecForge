import { describe, expect, it } from "vitest";
import { bestVersion, stopReason } from "@/lib/eval/loop";
import type { EvaluationResult } from "@/lib/rubric/types";
import { readJson } from "./helpers";

const base = readJson<EvaluationResult>("docs/examples/evaluation-result.example.json");
const ev = (forge: number, patch: Partial<EvaluationResult> = {}): EvaluationResult => ({ ...base, forge_score: forge, forge_score_raw: forge, ...patch });
const v = (version: number, evaluation: EvaluationResult) => ({ version, evaluation });

describe("loop control", () => {
  it("keeps optimizing after a real improvement", () => {
    expect(stopReason([v(1, ev(61)), v(2, ev(75))])).toBeNull();
  });
  it("stops on a plateau, a regression, and the pass limit", () => {
    expect(stopReason([v(1, ev(70)), v(2, ev(71))])).toMatch(/plateau/);
    expect(stopReason([v(1, ev(80)), v(2, ev(74))])).toMatch(/went down/);
    expect(stopReason([v(1, ev(50)), v(2, ev(60)), v(3, ev(70)), v(4, ev(80))])).toMatch(/maximum of 3/);
  });
  it("does not call it a plateau when a critical failure was resolved", () => {
    const withCrit = ev(69, { critical_failures: [{ id: "crit.no_testing", message: "x" }] });
    expect(stopReason([v(1, withCrit), v(2, ev(70))])).toBeNull();
  });
  it("stops at 95+ with no critical failures", () => {
    expect(stopReason([v(1, ev(96))])).toMatch(/95/);
  });
  it("returns the best version, breaking ties by raw score then recency", () => {
    expect(bestVersion([v(1, ev(80)), v(2, ev(74))])?.version).toBe(1);
    expect(bestVersion([v(1, ev(80)), v(2, ev(80))])?.version).toBe(2);
  });
});
