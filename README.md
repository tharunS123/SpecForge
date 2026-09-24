# SpecForge

Turn a rough software idea into an implementation specification an AI coding agent can reliably build from.

```
idea → Claude writes spec V1 → Jev evaluates → code scores it → Claude rewrites → Jev re-evaluates → best spec
```

A language model plans and rewrites (Claude long-term; a free OpenRouter model in Phase 1). Jev ([TypeSafe](https://docs.typesafe.ai)) acts only as a bounded critic: it answers atomic yes/no, multiple-choice, and rubric questions. All counting, scoring, and pass/fail logic lives in SpecForge's own code.

## Status

- **Phase 0 — done:** the evaluator ("the brain") is defined as versioned data.
- **Phase 1 — this branch:** an intentionally plain vertical slice: idea → spec V1 → evaluate → optimize → V2 → copy the best spec.

See the [phase plan](documents/Phase%20Plan%20Build%20SpecForge.pdf).

## Run it locally

```bash
npm install
cp .env.example .env.local   # then set OPENROUTER_API_KEY
npm run dev                  # http://localhost:3000
```

- **Generation** uses a free [OpenRouter](https://openrouter.ai) model (`OPENROUTER_MODEL`, default `nvidia/nemotron-3-super-120b-a12b:free`). Free models allow 20 requests/min and 50/day, and one full run uses about 9 requests. Free providers may log prompts, so don't paste secrets.
- **Evaluation** defaults to an **LLM stand-in** (`EVALUATOR=llm`): the same rubric questions answered by the free model, labelled "not Jev" in the UI. Set `EVALUATOR=jev` and `JEV_API_KEY` to use TypeSafe Jev. `JEV_BASE_URL` can point at a compatible self-hosted server such as Open-Jev (untested).
- **Password gate:** `proxy.ts` puts HTTP Basic auth in front of the app when `APP_PASSWORD` is set. In production the app refuses to serve without it.
- If `OPENROUTER_API_KEY` is already set in your shell environment, it takes precedence over `.env.local` (a Next.js rule).

```bash
npm test            # unit tests, including exact reproduction of the Phase 0 worked example
npm run typecheck && npm run lint && npm run build
npm run fixtures    # smoke test: evaluate the 6 fixture specs with the current evaluator (uses API quota)
```

## Repository map

| Path | What it is |
|---|---|
| [`docs/evaluation-system-v0.1.md`](docs/evaluation-system-v0.1.md) | Design of Evaluation System v0.1: categories, questions, scoring, critical failures, pass rules, optimization loop, worked example |
| [`rubric/v0.1/rubric.json`](rubric/v0.1/rubric.json) | The exact Jev questions, answer options, and points (source of truth) |
| [`rubric/v0.1/policy.json`](rubric/v0.1/policy.json) | Weights, thresholds, critical rules, bands, stop conditions |
| [`schemas/`](schemas) | JSON Schemas for every data file and API payload |
| [`prompts/v0.1/`](prompts/v0.1) | Claude prompts: requirements extractor, plan generator, optimizer |
| [`fixtures/v0.1/`](fixtures/v0.1) | Calibration fixtures: 2 ideas × weak/medium/strong specs with expected outcomes |
| [`docs/examples/`](docs/examples) | Example Jev request/response, evaluation result, and gap report |
| [`app/`](app), [`lib/`](lib), [`proxy.ts`](proxy.ts) | Phase 1 Next.js app: page, API routes, scoring engine, providers, password gate |
| [`tests/`](tests) | Vitest suite |
| [`scripts/evaluate-fixtures.mts`](scripts/evaluate-fixtures.mts) | Runs the fixtures through the configured evaluator |
| [`documents/`](documents) | Original idea, phase plan, and Jev research |

## Validate the data files

```bash
npx ajv-cli@5 validate --spec=draft2020 --strict=false -s schemas/rubric.schema.json -d rubric/v0.1/rubric.json
npx ajv-cli@5 validate --spec=draft2020 --strict=false -s schemas/policy.schema.json -d rubric/v0.1/policy.json
npx ajv-cli@5 validate --spec=draft2020 --strict=false -s schemas/fixture-expected.schema.json -d "fixtures/v0.1/*/expected.json"
```
