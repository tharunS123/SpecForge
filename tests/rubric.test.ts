import { describe, expect, it } from "vitest";
import { policy, rubric } from "@/lib/rubric/load";
import { readJson, schemaValidator } from "./helpers";

const validate = schemaValidator();

describe("rubric and policy data", () => {
  it.each([
    ["rubric.schema.json", "rubric/v0.1/rubric.json"],
    ["policy.schema.json", "rubric/v0.1/policy.json"],
    ["fixture-expected.schema.json", "fixtures/v0.1/expense-tracker-ios/expected.json"],
    ["fixture-expected.schema.json", "fixtures/v0.1/team-standup-web/expected.json"],
    ["jev-request.schema.json", "docs/examples/jev-request.example.json"],
    ["jev-response.schema.json", "docs/examples/jev-response.example.json"],
    ["evaluation-result.schema.json", "docs/examples/evaluation-result.example.json"],
    ["gap-report.schema.json", "docs/examples/gap-report.example.json"],
    ["extracted-requirements.schema.json", "docs/examples/extracted-requirements.example.json"],
  ])("%s validates %s", (schema, file) => {
    const result = validate(schema, readJson(file));
    expect(result.errors).toBe("No errors");
    expect(result.ok).toBe(true);
  });

  it("category weights sum to 100 and match the rubric categories", () => {
    expect(Object.values(policy.category_weights).reduce((a, b) => a + b, 0)).toBe(100);
    expect(Object.keys(policy.category_weights).sort()).toEqual(rubric.categories.map((c) => c.id).sort());
  });

  it("every critical rule points at an existing check and option", () => {
    for (const rule of policy.critical_rules) {
      if (!("check" in rule.source)) continue;
      const check = rubric.checks.find((c) => c.id === (rule.source as { check: string }).check);
      expect(check, rule.id).toBeDefined();
      if ("options" in rule.when && check && "criteria" in check && !Array.isArray(check.criteria)) {
        for (const o of rule.when.options) expect(Object.keys(check.criteria ?? {}), `${rule.id} → ${o}`).toContain(o);
      }
    }
  });
});

describe("run record export", () => {
  it("validates a record built from the worked example", async () => {
    const { buildRunRecord } = await import("@/lib/run-record");
    const record = buildRunRecord(
      {
        idea: "Build me an iPhone expense tracker.",
        requirements: readJson<{ requirements: never[] }>("docs/examples/extracted-requirements.example.json").requirements,
        dropped: [],
        extractor: { model: "m", prompt_version: "0.1.0" },
        versions: [
          {
            version: 1,
            content: "# Spec",
            created_at: new Date().toISOString(),
            finish_reason: "stop",
            evaluation: readJson("docs/examples/evaluation-result.example.json"),
            evaluator: { name: "llm", model: "m (llm stand-in)", isStandIn: true },
            gap_report: readJson("docs/examples/gap-report.example.json"),
          },
        ],
      },
      1,
      null,
    );
    const result = validate("run-record.schema.json", record);
    expect(result.errors).toBe("No errors");
  });
});
