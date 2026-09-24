import { describe, expect, it } from "vitest";
import { buildJevRequest } from "@/lib/eval/build-request";
import type { JevRequest, Requirement } from "@/lib/rubric/types";
import { readJson, readText } from "./helpers";

describe("buildJevRequest", () => {
  it("reproduces docs/examples/jev-request.example.json (5 gates + 10 requirements + 27 checks)", () => {
    const idea = readText("fixtures/v0.1/expense-tracker-ios/idea.md").trim();
    const spec = readText("fixtures/v0.1/expense-tracker-ios/spec-medium.md");
    const { requirements } = readJson<{ requirements: Requirement[] }>("docs/examples/extracted-requirements.example.json");
    const expected = readJson<JevRequest>("docs/examples/jev-request.example.json");
    const request = buildJevRequest(idea, spec, requirements);
    expect(request).toEqual(expected);
    expect(Object.keys(request.questions)).toHaveLength(42);
    expect(request.questions).not.toHaveProperty("req_r11_v1"); // implied requirements are not scored
  });
});
