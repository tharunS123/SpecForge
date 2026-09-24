import { z } from "zod";
import { ConfigError } from "@/lib/config";
import { EvaluationError } from "@/lib/eval/provider";
import { LlmError } from "@/lib/llm/openrouter";
import { RequirementSchema } from "@/lib/pipeline";

// Shared request validation and error/stream helpers for the API routes.

export const IdeaSchema = z.string().trim().min(10, "Describe the idea in at least 10 characters.").max(5_000, "Keep the idea under 5,000 characters.");
export const SpecSchema = z.string().min(1).max(200_000, "Specification is too long (max 200,000 characters).");
export const RequirementsSchema = z.array(RequirementSchema).max(40);

export function errorMessage(err: unknown): { message: string; status: number } {
  if (err instanceof z.ZodError) return { message: err.issues.map((i) => i.message).join("; "), status: 400 };
  if (err instanceof ConfigError) return { message: err.message, status: 500 };
  if (err instanceof LlmError || err instanceof EvaluationError) {
    return { message: err.message, status: err.status && err.status >= 400 && err.status < 600 ? err.status : 502 };
  }
  return { message: err instanceof Error ? err.message : "Unexpected error", status: 500 };
}

export function jsonError(err: unknown): Response {
  const { message, status } = errorMessage(err);
  if (status >= 500) console.error(err);
  return Response.json({ error: message }, { status });
}

export type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "gap_report"; gap_report: unknown }
  | { type: "done"; finish_reason: string | null; model: string; prompt_version: string }
  | { type: "error"; message: string };

/** Streams newline-delimited JSON events; errors after the stream starts become an "error" event. */
export function ndjsonResponse(run: (send: (e: StreamEvent) => void, signal: AbortSignal) => Promise<void>, signal: AbortSignal): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: StreamEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      try {
        await run(send, signal);
      } catch (err) {
        const { message, status } = errorMessage(err);
        if (status >= 500) console.error(err);
        send({ type: "error", message });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(body, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
