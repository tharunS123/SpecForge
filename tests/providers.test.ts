import { describe, expect, it, vi } from "vitest";
import { buildJevRequest } from "@/lib/eval/build-request";
import { JevEvaluationProvider } from "@/lib/eval/jev-provider";
import { answerJsonSchema, toJevAnswers } from "@/lib/eval/llm-provider";
import { scoreEvaluation } from "@/lib/eval/score";
import type { JevResponse, Requirement } from "@/lib/rubric/types";
import { readJson, readText } from "./helpers";

const idea = readText("fixtures/v0.1/expense-tracker-ios/idea.md").trim();
const spec = readText("fixtures/v0.1/expense-tracker-ios/spec-medium.md");
const { requirements } = readJson<{ requirements: Requirement[] }>("docs/examples/extracted-requirements.example.json");
const request = buildJevRequest(idea, spec, requirements);

describe("LLM stand-in answer mapping", () => {
  it("builds a strict JSON schema with one enum/int field per question", () => {
    const schema = answerJsonSchema(request.questions) as { properties: Record<string, { enum?: string[]; maximum?: number }>; required: string[] };
    expect(schema.required).toHaveLength(42);
    expect(schema.properties.gate_has_ui_v1.enum).toEqual(["yes", "no", "unsure"]);
    expect(schema.properties.test_strategy_v1.enum).toEqual(["comprehensive", "adequate", "minimal", "missing"]);
    expect(schema.properties.impl_guessing_required_v1.maximum).toBe(3);
  });

  it("maps point answers to one-hot jev answers that the scoring engine accepts", () => {
    const answers = Object.fromEntries(
      Object.entries(request.questions).map(([k, q]) => [k, q.type === "noul" ? "yes" : q.type === "choice" ? Object.keys(q.criteria)[0] : q.criteria.length - 1]),
    );
    const jev = toJevAnswers(request.questions, answers);
    expect(jev.gate_has_ui_v1).toEqual({ type: "noul", noul: 1 });
    expect(jev.test_strategy_v1).toMatchObject({ choice: "comprehensive", probabilities: { comprehensive: 1, missing: 0 }, confidence: 1 });
    expect(jev.impl_guessing_required_v1).toMatchObject({ type: "score", score: 3 });
    const result = scoreEvaluation({ userRequest: idea, spec, requirements, response: { model: "x (llm stand-in)", answers: jev } });
    expect(result.categories.every((c) => c.applicable === false || c.score! >= 0)).toBe(true);
    // "yes" to scope creep and contradictions (negative polarity) must cost points.
    expect(result.checks.find((c) => c.id === "req.scope_creep")?.points).toBe(0);
  });
});

describe("JevEvaluationProvider", () => {
  const ok = readJson<JevResponse>("docs/examples/jev-response.example.json");

  it("posts to /v1/systemone with the pinned model and bearer key", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(ok), { status: 200 }));
    const provider = new JevEvaluationProvider({ baseUrl: "https://api.typesafe.ai/", apiKey: "k", model: "jev-1.13.0", fetchImpl });
    await expect(provider.evaluate(request)).resolves.toEqual(ok);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer k");
    expect(JSON.parse(init.body as string).model).toBe("jev-1.13.0");
  });

  it("retries once on 429 and then reports the error", async () => {
    const fetchImpl = vi.fn(async () => new Response("slow down", { status: 429 }));
    const provider = new JevEvaluationProvider({ baseUrl: "https://x", apiKey: "k", model: "jev-1.13.0", fetchImpl });
    await expect(provider.evaluate(request)).rejects.toThrow(/429/);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("rejects responses that are missing answers", async () => {
    const partial = { ...ok, answers: { gate_has_ui_v1: ok.answers.gate_has_ui_v1 } };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(partial), { status: 200 }));
    const provider = new JevEvaluationProvider({ baseUrl: "https://x", apiKey: "k", model: "jev-1.13.0", fetchImpl });
    await expect(provider.evaluate(request)).rejects.toThrow(/missing answers/);
  });
});
