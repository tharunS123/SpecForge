import { z } from "zod";
import { IdeaSchema, jsonError, ndjsonResponse, RequirementsSchema } from "@/lib/api";
import { generateSpec } from "@/lib/pipeline";

export const maxDuration = 300;

const Body = z.object({ idea: IdeaSchema, requirements: RequirementsSchema });

export async function POST(request: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch (err) {
    return jsonError(err);
  }
  return ndjsonResponse(async (send, signal) => {
    const result = await generateSpec(body.idea, body.requirements, (text) => send({ type: "delta", text }), signal);
    send({ type: "done", finish_reason: result.finishReason, model: result.model, prompt_version: result.prompt_version });
  }, request.signal);
}
