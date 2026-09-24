import OpenAI from "openai";
import type { z } from "zod";
import { getConfig, requireOpenRouterKey } from "@/lib/config";

// Thin wrapper over OpenRouter's OpenAI-compatible Chat Completions API.

export class LlmError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

let client: OpenAI | undefined;
function getClient(): OpenAI {
  if (!client) {
    const config = getConfig();
    client = new OpenAI({
      apiKey: requireOpenRouterKey(config),
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: { "X-Title": "SpecForge", ...(config.APP_URL ? { "HTTP-Referer": config.APP_URL } : {}) },
      timeout: 280_000,
      maxRetries: 1,
    });
  }
  return client;
}

/** Maps SDK errors to messages a user can act on. */
export function toLlmError(err: unknown): LlmError {
  if (err instanceof LlmError) return err;
  if (err instanceof OpenAI.APIConnectionTimeoutError) return new LlmError("The model took too long to respond. Try again.");
  if (err instanceof OpenAI.APIError) {
    const status = err.status;
    if (status === 429) return new LlmError("OpenRouter rate limit reached (free models: 20 requests/min, 50/day). Wait and try again.", 429);
    if (status === 402) return new LlmError("OpenRouter says the account needs credits for this request (402).", 402);
    if (status === 401) return new LlmError("OpenRouter rejected the API key (401). Check OPENROUTER_API_KEY.", 401);
    if (status === 404) return new LlmError(`OpenRouter could not find a provider for this model/request (404): ${err.message}`, 404);
    return new LlmError(`OpenRouter error ${status ?? ""}: ${err.message}`, status);
  }
  return new LlmError(err instanceof Error ? err.message : String(err));
}

type Messages = { system: string; user: string };

export type StreamResult = { finishReason: string | null; model: string };

/** Streams text deltas; resolves with the finish reason once the stream ends. */
export async function streamText(
  opts: Messages & { model: string; maxTokens: number; onDelta: (text: string) => void; signal?: AbortSignal },
): Promise<StreamResult> {
  const openrouter = getClient(); // outside try: configuration errors should not look like model errors
  try {
    const stream = await openrouter.chat.completions.create(
      {
        model: opts.model,
        max_tokens: opts.maxTokens,
        stream: true,
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
      },
      { signal: opts.signal },
    );
    let finishReason: string | null = null;
    let model = opts.model;
    for await (const chunk of stream) {
      model = chunk.model ?? model;
      const choice = chunk.choices[0];
      if (choice?.delta?.content) opts.onDelta(choice.delta.content);
      if (choice?.finish_reason) finishReason = choice.finish_reason;
    }
    return { finishReason, model };
  } catch (err) {
    throw toLlmError(err);
  }
}

/** Extracts a JSON object from model text, tolerating ```json fences. */
export function parseJsonText(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/);
  const candidate = fenced ? fenced[1] : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(candidate.slice(start, end + 1));
    throw new LlmError("The model did not return valid JSON.");
  }
}

/**
 * Requests JSON matching `jsonSchema` (OpenRouter structured outputs, only routed to providers that support it),
 * validates it with `schema`, and retries once. If the model has no structured-output provider, falls back to
 * plain JSON-in-text.
 */
export async function completeJson<T>(
  opts: Messages & { model: string; maxTokens: number; name: string; jsonSchema: Record<string, unknown>; schema: z.ZodType<T> },
): Promise<{ data: T; model: string }> {
  const openrouter = getClient();
  let structured = true;
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const body = {
        model: opts.model,
        max_tokens: opts.maxTokens,
        messages: [
          { role: "system" as const, content: opts.system },
          { role: "user" as const, content: opts.user },
        ],
        ...(structured
          ? {
              response_format: { type: "json_schema" as const, json_schema: { name: opts.name, strict: true, schema: opts.jsonSchema } },
              provider: { require_parameters: true },
            }
          : {}),
      };
      const res = await openrouter.chat.completions.create(body);
      const choice = res.choices[0];
      const text = choice?.message?.content ?? "";
      if (!text.trim()) throw new LlmError(`The model returned an empty response (finish reason: ${choice?.finish_reason ?? "unknown"}).`);
      if (choice?.finish_reason === "length") throw new LlmError("The model ran out of output tokens before finishing the JSON.");
      const parsed = opts.schema.safeParse(parseJsonText(text));
      if (!parsed.success) throw new LlmError(`The model's JSON did not match the expected shape: ${parsed.error.issues[0]?.message}`);
      return { data: parsed.data, model: res.model ?? opts.model };
    } catch (err) {
      lastError = err;
      const e = toLlmError(err);
      // No provider supports structured outputs for this model: retry once in plain-text JSON mode.
      if (structured && (e.status === 404 || e.status === 400)) {
        structured = false;
        continue;
      }
      if (e.status === 429 || e.status === 401 || e.status === 402) throw e;
    }
  }
  throw toLlmError(lastError);
}
