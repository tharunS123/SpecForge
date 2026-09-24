import type { JevRequest, JevResponse } from "@/lib/rubric/types";
import { EvaluationError, type EvaluationProvider } from "./provider";

// Client for TypeSafe's POST /v1/systemone (https://docs.typesafe.ai/api). The base URL is configurable so a
// self-hosted, API-compatible server (e.g. Open-Jev) can be tried later; Open-Jev's compatibility is unverified.

const STATE_PLUS_QUESTION_LIMIT_TOKENS = 32_000;

export class JevEvaluationProvider implements EvaluationProvider {
  readonly name = "jev";
  readonly isStandIn = false;

  constructor(
    private readonly opts: { baseUrl: string; apiKey: string; model: string; timeoutMs?: number; fetchImpl?: typeof fetch },
  ) {}

  get model() {
    return this.opts.model;
  }

  async evaluate(request: JevRequest, { signal }: { signal?: AbortSignal } = {}): Promise<JevResponse> {
    const stateTokens = Math.ceil(JSON.stringify(request.state).length / 4);
    const longestQuestion = Math.max(...Object.values(request.questions).map((q) => Math.ceil(JSON.stringify(q).length / 4)));
    if (stateTokens + longestQuestion > STATE_PLUS_QUESTION_LIMIT_TOKENS) {
      throw new EvaluationError(`Specification is too long for Jev (~${stateTokens + longestQuestion} tokens; limit ${STATE_PLUS_QUESTION_LIMIT_TOKENS}).`);
    }
    const body = JSON.stringify({ ...request, model: this.opts.model });
    const doFetch = this.opts.fetchImpl ?? fetch;

    for (let attempt = 0; ; attempt++) {
      const timeout = AbortSignal.timeout(this.opts.timeoutMs ?? 30_000);
      const res = await doFetch(`${this.opts.baseUrl.replace(/\/$/, "")}/v1/systemone`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.opts.apiKey}`, "Content-Type": "application/json" },
        body,
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      }).catch((err: unknown) => {
        throw new EvaluationError(`Could not reach the Jev API: ${err instanceof Error ? err.message : String(err)}`);
      });
      if (res.ok) {
        const json = (await res.json()) as JevResponse;
        const missing = Object.keys(request.questions).filter((k) => !json.answers?.[k]);
        if (missing.length) throw new EvaluationError(`Jev response is missing answers for: ${missing.join(", ")}`);
        return json;
      }
      if ((res.status === 429 || res.status === 502) && attempt === 0) {
        await new Promise((r) => setTimeout(r, 1_000));
        continue;
      }
      const detail = await res.text().catch(() => "");
      throw new EvaluationError(`Jev API error ${res.status}: ${detail.slice(0, 300)}`, res.status);
    }
  }
}
