# SpecForge

Turn a rough software idea into an implementation specification an AI coding agent can reliably build from.

```
idea → Claude writes spec V1 → Jev evaluates → code scores it → Claude rewrites → Jev re-evaluates → best spec
```

Claude plans and rewrites. Jev ([TypeSafe](https://docs.typesafe.ai)) acts only as a bounded critic: it answers atomic yes/no, multiple-choice, and rubric questions. All counting, scoring, and pass/fail logic lives in SpecForge's own code.

## Status

**Phase 0: the evaluator ("the brain") is defined.** There is no app code yet. See the [phase plan](documents/Phase%20Plan%20Build%20SpecForge.pdf).

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
| [`documents/`](documents) | Original idea, phase plan, and Jev research |

## Validate the data files

```bash
npx ajv-cli@5 validate --spec=draft2020 --strict=false -s schemas/rubric.schema.json -d rubric/v0.1/rubric.json
npx ajv-cli@5 validate --spec=draft2020 --strict=false -s schemas/policy.schema.json -d rubric/v0.1/policy.json
npx ajv-cli@5 validate --spec=draft2020 --strict=false -s schemas/fixture-expected.schema.json -d "fixtures/v0.1/*/expected.json"
```
