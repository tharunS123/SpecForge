import type { JevRequest, JevResponse } from "@/lib/rubric/types";

/**
 * The evaluator seam from the phase plan (§Phase 2). Everything downstream of `evaluate` works on the
 * provider-neutral jev-response shape, so Jev, a self-hosted Open-Jev server, or an LLM stand-in are interchangeable.
 */
export interface EvaluationProvider {
  readonly name: string;
  /** Model identifier recorded on every evaluation. */
  readonly model: string;
  /** True when the provider is not a calibrated decision model (e.g. an LLM answering the rubric questions). */
  readonly isStandIn: boolean;
  evaluate(request: JevRequest, opts?: { signal?: AbortSignal }): Promise<JevResponse>;
}

export class EvaluationError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}
