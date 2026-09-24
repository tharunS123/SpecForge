import { z } from "zod";
import { IdeaSchema, jsonError } from "@/lib/api";
import { extractRequirements } from "@/lib/pipeline";

export const maxDuration = 300;

const Body = z.object({ idea: IdeaSchema });

export async function POST(request: Request) {
  try {
    const { idea } = Body.parse(await request.json());
    return Response.json(await extractRequirements(idea));
  } catch (err) {
    return jsonError(err);
  }
}
