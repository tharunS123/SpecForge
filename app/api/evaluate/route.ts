import { z } from "zod";
import { IdeaSchema, jsonError, RequirementsSchema, SpecSchema } from "@/lib/api";
import { evaluateSpec } from "@/lib/pipeline";

export const maxDuration = 300;

const Body = z.object({
  idea: IdeaSchema,
  spec: SpecSchema,
  requirements: RequirementsSchema,
  specVersion: z.number().int().min(1),
});

export async function POST(request: Request) {
  try {
    const body = Body.parse(await request.json());
    return Response.json(await evaluateSpec({ ...body, signal: request.signal }));
  } catch (err) {
    return jsonError(err);
  }
}
