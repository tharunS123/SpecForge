import { describe, expect, it } from "vitest";
import { buildGapReport, optimizerVariables } from "@/lib/eval/gap-report";
import { fill, loadPrompt, renderPrompt } from "@/lib/prompts/render";
import type { EvaluationResult } from "@/lib/rubric/types";
import { readJson } from "./helpers";

describe("prompt templates", () => {
  it("parses system/user sections and the declared placeholders", () => {
    const t = loadPrompt("plan-generator");
    expect(t.system).toMatch(/^You are the planning stage of SpecForge/);
    expect(t.user).toContain("{{user_request}}");
    expect(t.placeholders.sort()).toEqual(["requirements_json", "user_request"]);
  });

  it("parses the three optimizer mode blocks and keeps them out of the user message", () => {
    const t = loadPrompt("optimizer");
    expect(Object.keys(t.modes).sort()).toEqual(["major_rewrite", "targeted", "weak_categories_only"]);
    expect(t.user).not.toContain("# Mode instructions");
    expect(t.user.endsWith("Return the complete replacement specification.")).toBe(true);
  });

  it("renders the optimizer prompt with no leftover placeholders", () => {
    const evaluation = readJson<EvaluationResult>("docs/examples/evaluation-result.example.json");
    const gap = buildGapReport("idea text", "spec with {{literal braces}}", 1, evaluation)!;
    const out = renderPrompt("optimizer", { ...optimizerVariables(gap), mode_instructions: loadPrompt("optimizer").modes.targeted! });
    expect(out.user).not.toMatch(/\{\{(?!literal braces)\w+\}\}/);
    expect(out.user).toContain("spec with {{literal braces}}"); // user text is not re-expanded
    expect(out.user).toContain("The structure is mostly sound.");
  });

  it("fails loudly when a variable is missing", () => {
    expect(() => renderPrompt("requirements-extractor", {})).toThrow(/user_request/);
    expect(() => fill("{{a}}", {})).toThrow(/"a"/);
  });
});
