import { z } from "zod";
import { getConfig } from "@/lib/config";
import { buildJevRequest } from "@/lib/eval/build-request";
import { buildGapReport, optimizerVariables } from "@/lib/eval/gap-report";
import { JevEvaluationProvider } from "@/lib/eval/jev-provider";
import { LlmEvaluationProvider } from "@/lib/eval/llm-provider";
import type { EvaluationProvider } from "@/lib/eval/provider";
import { filterRequirements } from "@/lib/eval/requirements";
import { scoreEvaluation } from "@/lib/eval/score";
import { completeJson, streamText, type StreamResult } from "@/lib/llm/openrouter";
import { loadPrompt, renderPrompt } from "@/lib/prompts/render";
import type { EvaluationResult, GapReport, Requirement } from "@/lib/rubric/types";

// Server-side orchestration of the Phase 1 loop: extract → generate → evaluate → optimize.

const SPEC_MAX_TOKENS = 32_000;

export const RequirementSchema = z.object({
  id: z.string().regex(/^R\d+$/),
  kind: z.enum(["explicit", "implied"]),
  text: z.string().min(1).max(300),
  source_quote: z.string().min(1),
});
const ExtractedSchema = z.object({ requirements: z.array(RequirementSchema).max(40) });

// JSON Schema sent to the model (mirrors schemas/extracted-requirements.schema.json, minus limits strict mode rejects).
const EXTRACTED_JSON_SCHEMA = {
  type: "object",
  properties: {
    requirements: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          kind: { type: "string", enum: ["explicit", "implied"] },
          text: { type: "string" },
          source_quote: { type: "string" },
        },
        required: ["id", "kind", "text", "source_quote"],
        additionalProperties: false,
      },
    },
  },
  required: ["requirements"],
  additionalProperties: false,
};

export function getEvaluationProvider(): EvaluationProvider {
  const config = getConfig();
  if (config.EVALUATOR === "jev") {
    return new JevEvaluationProvider({ baseUrl: config.JEV_BASE_URL, apiKey: config.JEV_API_KEY!, model: config.JEV_MODEL });
  }
  return new LlmEvaluationProvider(config.OPENROUTER_EVAL_MODEL);
}

export async function extractRequirements(idea: string) {
  const config = getConfig();
  const prompt = renderPrompt("requirements-extractor", { user_request: idea });
  const { data, model } = await completeJson({
    model: config.OPENROUTER_MODEL,
    maxTokens: 16_000,
    name: "extracted_requirements",
    system: prompt.system,
    user: prompt.user,
    jsonSchema: EXTRACTED_JSON_SCHEMA,
    schema: ExtractedSchema,
  });
  return { ...filterRequirements(idea, data.requirements), model, prompt_version: prompt.version };
}

export async function generateSpec(
  idea: string,
  requirements: Requirement[],
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<StreamResult & { prompt_version: string }> {
  const config = getConfig();
  const prompt = renderPrompt("plan-generator", {
    user_request: idea,
    requirements_json: JSON.stringify({ requirements }, null, 2),
  });
  const result = await streamText({ model: config.OPENROUTER_MODEL, maxTokens: SPEC_MAX_TOKENS, ...prompt, onDelta, signal });
  return { ...result, prompt_version: prompt.version };
}

export async function evaluateSpec(args: {
  idea: string;
  spec: string;
  requirements: Requirement[];
  specVersion: number;
  signal?: AbortSignal;
}): Promise<{ evaluation: EvaluationResult; provider: { name: string; model: string; isStandIn: boolean } }> {
  const provider = getEvaluationProvider();
  const request = buildJevRequest(args.idea, args.spec, args.requirements, provider.model);
  const response = await provider.evaluate(request, { signal: args.signal });
  const evaluation = scoreEvaluation({
    userRequest: args.idea,
    spec: args.spec,
    requirements: args.requirements,
    response,
    specVersion: args.specVersion,
  });
  return { evaluation, provider: { name: provider.name, model: response.model, isStandIn: provider.isStandIn } };
}

export async function optimizeSpec(args: {
  idea: string;
  spec: string;
  specVersion: number;
  evaluation: EvaluationResult;
  onGapReport: (gap: GapReport) => void;
  onDelta: (text: string) => void;
  signal?: AbortSignal;
}): Promise<StreamResult & { prompt_version: string }> {
  const config = getConfig();
  const gap = buildGapReport(args.idea, args.spec, args.specVersion, args.evaluation);
  if (!gap) throw new Error("This version already meets the stop condition; there is nothing to optimize.");
  args.onGapReport(gap);
  const modeInstructions = loadPrompt("optimizer").modes[gap.mode];
  if (!modeInstructions) throw new Error(`optimizer prompt has no instructions for mode ${gap.mode}`);
  const prompt = renderPrompt("optimizer", { ...optimizerVariables(gap), mode_instructions: modeInstructions });
  const result = await streamText({
    model: config.OPENROUTER_MODEL,
    maxTokens: SPEC_MAX_TOKENS,
    ...prompt,
    onDelta: args.onDelta,
    signal: args.signal,
  });
  return { ...result, prompt_version: prompt.version };
}
