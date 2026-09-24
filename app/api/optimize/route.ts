import { z } from "zod";
import { IdeaSchema, jsonError, ndjsonResponse, SpecSchema } from "@/lib/api";
import { optimizeSpec } from "@/lib/pipeline";
import type { EvaluationResult } from "@/lib/rubric/types";

export const maxDuration = 300;

// The evaluation round-trips through the browser in Phase 1 (no database). Validate the fields the
// gap report reads; the rest is passed through.
const EvaluationSchema = z
  .object({
    forge_score: z.number(),
    forge_score_raw: z.number(),
    next_mode: z.enum(["major_rewrite", "targeted", "weak_categories_only", "stop"]),
    critical_failures: z.array(z.object({ id: z.string(), check: z.string().optional(), message: z.string() })),
    categories: z.array(z.object({ id: z.string(), weight: z.number(), applicable: z.boolean(), score: z.number().nullable() })),
    checks: z.array(
      z.object({ id: z.string(), category: z.string(), applicable: z.boolean(), points: z.number().nullable(), flags: z.array(z.string()) }).passthrough(),
    ),
    requirements: z.array(z.object({ id: z.string(), text: z.string(), noul: z.number(), status: z.enum(["covered", "uncertain", "missing"]) })),
  })
  .passthrough();

const Body = z.object({ idea: IdeaSchema, spec: SpecSchema, specVersion: z.number().int().min(1), evaluation: EvaluationSchema });

export async function POST(request: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch (err) {
    return jsonError(err);
  }
  return ndjsonResponse(async (send, signal) => {
    const result = await optimizeSpec({
      idea: body.idea,
      spec: body.spec,
      specVersion: body.specVersion,
      evaluation: body.evaluation as unknown as EvaluationResult,
      onGapReport: (gap_report) => send({ type: "gap_report", gap_report }),
      onDelta: (text) => send({ type: "delta", text }),
      signal,
    });
    send({ type: "done", finish_reason: result.finishReason, model: result.model, prompt_version: result.prompt_version });
  }, request.signal);
}
