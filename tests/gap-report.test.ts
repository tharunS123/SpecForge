import { describe, expect, it } from "vitest";
import { buildGapReport, optimizerVariables } from "@/lib/eval/gap-report";
import type { EvaluationResult, GapReport } from "@/lib/rubric/types";
import { readJson, readText } from "./helpers";

const idea = readText("fixtures/v0.1/expense-tracker-ios/idea.md").trim();
const spec = readText("fixtures/v0.1/expense-tracker-ios/spec-medium.md");
const evaluation = readJson<EvaluationResult>("docs/examples/evaluation-result.example.json");

describe("gap report", () => {
  it("reproduces docs/examples/gap-report.example.json", () => {
    expect(buildGapReport(idea, spec, 1, evaluation)).toEqual(readJson<GapReport>("docs/examples/gap-report.example.json"));
  });

  it("returns null when the next mode is stop", () => {
    expect(buildGapReport(idea, spec, 1, { ...evaluation, next_mode: "stop" })).toBeNull();
  });

  it("renders every optimizer list, with 'None.' for empty ones", () => {
    const vars = optimizerVariables(buildGapReport(idea, spec, 1, evaluation)!);
    expect(vars.critical_list).toBe("None.");
    expect(vars.weak_list).toMatch(/^- Edge cases & errors: 43.75\/100\n  - edge.error_handling/);
    expect(vars.uncovered_requirements_list).toBe("- R10 (uncertain): User can export a chosen month's expenses to a CSV file.");
  });
});
