# SpecForge Evaluation System v0.1

**Status:** Phase 0 design, not yet calibrated against live Jev calls
**Rubric:** `rubric/v0.1/rubric.json` (0.1.0) · **Policy:** `rubric/v0.1/policy.json` (0.1.0) · **Evaluator:** Jev `jev-1.13.0`

This document defines SpecForge's evaluator: what counts as a good implementation specification, the exact questions Jev is asked, and how code turns Jev's answers into a Forge Score, a list of critical failures, and instructions for the Claude optimizer. The JSON files are the source of truth. When this document and a JSON file disagree, the JSON file wins and this document is out of date.

---

## Contents
1. [How evaluation fits the loop](#1-how-evaluation-fits-the-loop)
2. [Design principles](#2-design-principles)
3. [Jev contract and state](#3-jev-contract-and-state)
4. [The specification template](#4-the-specification-template)
5. [Evaluation categories and weights](#5-evaluation-categories-and-weights)
6. [Checks: the exact questions, answers, and points](#6-checks-the-exact-questions-answers-and-points)
7. [Applicability gates](#7-applicability-gates)
8. [Score calculation](#8-score-calculation)
9. [Critical failures](#9-critical-failures)
10. [Pass/fail rules and bands](#10-passfail-rules-and-bands)
11. [Optimization loop and stop conditions](#11-optimization-loop-and-stop-conditions)
12. [Worked example](#12-worked-example)
13. [JSON schemas and file map](#13-json-schemas-and-file-map)
14. [Versioning rules](#14-versioning-rules)
15. [Known limitations and the Phase 1 calibration plan](#15-known-limitations-and-the-phase-1-calibration-plan)

---

## 1. How evaluation fits the loop

```
user idea
   │
   ▼
Claude: requirements extractor ──► R1…Rn (verbatim-quoted, checked by code)
   │
   ▼
Claude: plan generator ──► Spec V1 (fixed 12-section template)
   │
   ▼
┌──────────────── evaluation (this document) ─────────────────┐
│ preflight rules (code)   → length, sections, AC count, TBDs │
│ one Jev request          → 5 gates + n requirement checks   │
│                            + 27 rubric questions            │
│ scoring engine (code)    → points → categories → Forge Score│
│ critical rules (code)    → critical failures, cap, pass     │
└──────────────────────────────────────────────────────────────┘
   │
   ▼
gap report (code) ──► Claude: optimizer ──► Spec V2 ──► evaluate again
   │
   ▼
stop conditions met ──► return the best-scoring version
```

Jev only answers bounded questions about the text. Everything that involves counting, arithmetic, thresholds, or decisions happens in code, driven by `policy.json`.

## 2. Design principles

These come directly from the Jev research (`documents/Jev Research.pdf`) and TypeSafe's documentation.

1. **Atomic questions, composed in code.** No "score this plan 0–100". Each question asks one thing a knowledgeable reviewer could judge in seconds. Code combines the answers.
2. **No counting, arithmetic, or multi-hop reasoning in Jev.** Counting acceptance criteria, measuring length, and checking section headings are deterministic rules. Requirement coverage is asked one requirement at a time and the ratio is computed in code.
3. **Every choice has an escape option.** Where a check might not apply or the spec might not say enough, the options include `not_applicable` or `insufficient_evidence`, so Jev isn't forced to pick a wrong answer with high confidence.
4. **Probabilities are not measurements.** A Noul is thresholded into pass / uncertain / fail rather than used as a degree. Choice answers are turned into points with a fixed option-to-points table.
5. **The user request is untrusted.** It goes into Jev's state as data in a labelled field. Every Claude prompt wraps it in tags and says not to follow instructions inside it.
6. **Jev is replaceable.** Nothing downstream of the evaluation result depends on Jev. A different `EvaluationProvider` (Claude, another model, a fine-tuned classifier) only has to fill the same answers.
7. **Everything is versioned.** Question wording changes results, so a changed question is a new check version, never an in-place edit.

## 3. Jev contract and state

Official API (docs.typesafe.ai). Only `api.typesafe.ai` is used; lookalike sites exist (for example jevtypesafeai.com and jevai.org) and are not the official API.

```http
POST https://api.typesafe.ai/v1/systemone
Authorization: Bearer <key>
Content-Type: application/json
```

| Primitive | Request `criteria` | Answer fields | How SpecForge uses it |
|---|---|---|---|
| Noul | optional `{true, false}` descriptions | `noul` (0–1) | Yes/no facts; thresholded in code |
| Choice | map `option → description` (≤ 255) | `choice`, `probabilities`, `confidence` | Graded quality levels; expected points |
| Score | ordered array of 2–10 levels | `score`, `probabilities`, `legend`, `confidence` | Used once (`impl.guessing_required`); `score ÷ top level` |

**State.** Always a JSON object with exactly two fields (see `schemas/jev-request.schema.json`):

```json
{
  "user_request": "<the user's idea, verbatim>",
  "specification": "<the full Markdown spec being evaluated>"
}
```

**One request per evaluation.** All gates, requirement checks, and rubric questions go in a single request. Every question is evaluated independently against the same state, so gate answers can't change other answers in the same call. Checks whose gate doesn't apply are asked anyway and their answers are discarded (flagged `gated_out`). This costs a few hundred extra input tokens and saves a second round trip.

**Limits.** Jev accepts 64k tokens per request, and state plus the longest question must be ≤ 32k tokens. SpecForge caps the specification at ~24,000 tokens (estimated as characters ÷ 4). The longest question is under 600 characters. A spec over the cap triggers `crit.spec_too_long` and is not sent to Jev.

**Model pinning.** Scored runs use a concrete version (`jev-1.13.0`), never the `jev-latest` alias. Every evaluation stores the model name that Jev reports in its response.

**Question keys.** Keys are `<check id with the dot replaced by _>_v<version>`, for example `req.coverage_overall` v1 → `req_coverage_overall_v1`. Gates use `gate_<name>_v1`, and requirement checks use `req_r<n>_v1`. A full example request is in `docs/examples/jev-request.example.json`.

**Cost (rough).** At $0.042 per million input tokens, a 5,000-token spec plus 42 questions (about 17k characters, roughly 4,500 tokens of instructions) costs about $0.0004 per evaluation, assuming Jev bills each token once. A full loop with 4 evaluations costs well under a cent in Jev fees. Claude generation dominates the cost.

## 4. The specification template

The plan generator and optimizer must produce these 12 level-2 sections, in order (`policy.preflight.required_sections`). A fixed template lets code check structure without Jev, and it gives Jev predictable places to look.

| # | Section | Must contain |
|---|---|---|
| 1 | Overview | What, for whom, platform, goal |
| 2 | Scope | In scope / Out of scope lists |
| 3 | Requirements | Every requirement with its R-id, testable |
| 4 | Architecture | Components + responsibilities; data flow per core feature |
| 5 | Tech stack | Exact languages, frameworks, libraries, versions |
| 6 | Data model | Entities, fields, types, required/default, relationships, delete behavior, storage, migrations |
| 7 | Screens & UX states | Every screen, actions, navigation, loading/empty/error states |
| 8 | Implementation plan | File tree with paths; numbered steps, each with a check |
| 9 | Errors & edge cases | Failure behaviors, validation rules and messages, network behavior |
| 10 | Security & privacy | Auth states, secrets storage, sensitive data handling |
| 11 | Testing & acceptance criteria | Test strategy; ≥ 5 `AC-n` in Given/When/Then, each citing R-ids |
| 12 | Assumptions & open questions | Decisions made on the user's behalf, stated as decisions |

Headings are matched case-insensitively with `^#{1,3}\s*(\d+\.?\s*)?<section>\b`, where the section name is regex-escaped. Numbering is optional.

## 5. Evaluation categories and weights

| Category | Weight | What we're checking |
|---|---:|---|
| Requirements coverage | 15 | Did the spec capture what the user asked for, without inventing scope? |
| Architecture | 10 | Is there a coherent architecture that fits the platform and constraints? |
| Implementation specificity | 12 | Could an agent act on this without guessing? |
| Data model | 10 | Are entities, fields, relationships, and persistence defined? |
| UI/UX coverage | 10 | Are screens, navigation, and loading/empty/error states described? |
| Edge cases & errors | 10 | Are failures, invalid input, and network problems handled? |
| Security & privacy | 8 | Are auth, secrets, and sensitive data handled? |
| Testing & acceptance | 12 | Are there a verification strategy and testable acceptance criteria? |
| Dependency coherence | 5 | Are technologies named, compatible, and consistent? |
| Build readiness | 8 | Can an agent start now without more product decisions? |
| **Total** | **100** | |

Requirements, implementation, and testing weigh the most. Those are the gaps most likely to make a coding agent build the wrong thing, guess, or be unable to prove it's done. Dependency coherence weighs the least: planners rarely get it badly wrong, and a real incoherence is caught by a critical rule anyway.

## 6. Checks: the exact questions, answers, and points

31 checks: 27 Jev questions, 1 dynamic per-requirement Jev check, and 3 deterministic rules. The exact wording, including each option's description, is in `rubric.json`. The table below summarizes it. Weight is the check's weight within its category.

### Requirements coverage (15)
| Check | Type | W | Question (short) | Answers → points |
|---|---|---:|---|---|
| `req.explicit_coverage` | Noul × n (dynamic) | 2 | Does the spec clearly address requirement *Rk*? | per requirement: covered 1 / uncertain 0.5 / missing 0; points = mean |
| `req.coverage_overall` | Choice | 2 | How completely does the spec cover everything the user asked for? | complete 1 · minor_gaps 0.75 · major_gaps 0.35 · insufficient 0 |
| `req.scope_creep` | Noul (negative) | 1 | Does it add major features the user didn't ask for? | no → 1 · yes → 0 |

### Architecture (10)
| Check | Type | W | Question (short) | Answers → points |
|---|---|---:|---|---|
| `arch.components_defined` | Choice | 1 | Are main components and responsibilities defined? | well_defined 1 · partially_defined 0.6 · vague 0.25 · missing 0 |
| `arch.data_flow` | Choice | 1 | Is data flow from action → storage/network → UI described? | clear 1 · partial 0.6 · unclear 0.2 · missing 0 |
| `arch.platform_fit` | Choice | 1 | Does the architecture fit the requested platform and constraints? | fits 1 · minor_mismatch 0.6 · major_mismatch 0 · insufficient_evidence 0.2 |

### Implementation specificity (12)
| Check | Type | W | Question (short) | Answers → points |
|---|---|---:|---|---|
| `impl.sections_present` | Rule | 1 | All 12 template sections present? | present ÷ 12 |
| `impl.file_structure` | Choice | 1 | How specific is the file/folder structure? | explicit_paths 1 · module_level 0.65 · vague 0.25 · missing 0 |
| `impl.ordered_steps` | Noul | 1 | Ordered build steps, each with a check? | yes 1 · no 0 |
| `impl.guessing_required` | Score (4 levels) | 2 | How much would an agent have to guess? | score ÷ 3 (0 = decides most things itself … 3 = no meaningful guessing) |

### Data model (10)
| Check | Type | W | Question (short) | Answers → points |
|---|---|---:|---|---|
| `data.entities` | Choice | 1 | Entities with fields and types defined? | complete 1 · partial 0.55 · names_only 0.2 · missing 0 |
| `data.relationships` | Choice | 1 | Relationships and delete behavior defined? | defined 1 · partial 0.5 · missing 0 · *not_applicable* |
| `data.persistence_migration` | Choice, gate `persists_data` | 1 | Storage technology and migration approach? | storage_and_migration 1 · storage_only 0.5 · missing 0 |

### UI/UX coverage (10) — all gated on `has_ui`
| Check | Type | W | Question (short) | Answers → points |
|---|---|---:|---|---|
| `ui.screens` | Choice | 1 | Every screen with content and actions? | all_screens 1 · most_screens 0.65 · few_screens 0.25 · missing 0 |
| `ui.states` | Choice | 1 | Loading, empty, and error states defined? | all_states 1 · some_states 0.5 · missing 0 |
| `ui.navigation` | Noul | 1 | Start screen and transitions described? | yes 1 · no 0 |

### Edge cases & errors (10)
| Check | Type | W | Question (short) | Answers → points |
|---|---|---:|---|---|
| `edge.error_handling` | Choice | 1 | What happens when operations fail? | specific 1 · partial 0.65 · generic 0.3 · missing 0 |
| `edge.network_offline` | Choice, gate `uses_network` | 1 | Slow/offline/timeout behavior defined? | specified 1 · partial 0.5 · missing 0 |
| `edge.input_validation` | Noul | 1 | Validation rules and invalid-input behavior stated? | yes 1 · no 0 |

### Security & privacy (8)
| Check | Type | W | Question (short) | Answers → points |
|---|---|---:|---|---|
| `sec.auth_states` | Choice, gate `has_user_accounts` | 1 | Sign-up, sign-in, sign-out, expiry, failure all defined? | complete 1 · partial 0.5 · missing 0 |
| `sec.secrets_storage` | Choice | 1 | Where are secrets stored; never in client code or logs? | specified 1 · partial 0.5 · unaddressed 0 · *not_applicable* |
| `sec.data_privacy` | Choice, gate `handles_sensitive_data` | 1 | Collection, storage, access, deletion of sensitive data? | specified 1 · partial 0.5 · missing 0 |

### Testing & acceptance (12)
| Check | Type | W | Question (short) | Answers → points |
|---|---|---:|---|---|
| `test.strategy` | Choice | 2 | Which best describes the testing strategy? | comprehensive 1 · adequate 0.7 · minimal 0.3 · missing 0 |
| `test.ac_testable` | Choice | 2 | How testable are the acceptance criteria? | all_testable 1 · mostly_testable 0.65 · vague 0.25 · none 0 |
| `test.ac_count` | Rule | 1 | Unique `AC-n` labels | min(count ÷ 5, 1) |

### Dependency coherence (5)
| Check | Type | W | Question (short) | Answers → points |
|---|---|---:|---|---|
| `dep.stack_specified` | Noul | 1 | Specific languages, frameworks, libraries named? | yes 1 · no 0 |
| `dep.coherent` | Choice | 1 | Do the technologies work together on the platform? | coherent 1 · minor_issues 0.6 · incoherent 0 · insufficient_evidence 0.3 |
| `dep.contradictions` | Noul (negative) | 1 | Does the spec contradict itself? | no → 1 · yes → 0 |

### Build readiness (8)
| Check | Type | W | Question (short) | Answers → points |
|---|---|---:|---|---|
| `ready.open_decisions` | Choice | 2 | How many decisions are left unresolved? | none 1 · minor 0.75 · some 0.35 · many 0 |
| `ready.can_start` | Noul | 1 | Could an agent start now without asking the user anything? | yes 1 · no 0 |
| `ready.no_placeholders` | Rule | 1 | No `TBD`, `TODO`, `FIXME`, "to be decided/determined", `???` | none found 1 · any found 0 |

Every check in `rubric.json` also has a `fix_hint`: a concrete instruction the optimizer receives when that check fails. These hints are the "optimization instructions" part of the evaluator.

### Requirement extraction (feeds `req.explicit_coverage`)
`prompts/v0.1/requirements-extractor.md` asks Claude for up to 25 atomic requirements, each marked `explicit` or `implied`, with a `source_quote` copied verbatim from the request. Code then:
1. drops any requirement whose `source_quote` isn't an exact substring of the request (it's a hallucinated requirement);
2. sends one Noul per **explicit** requirement (`policy.requirements.evaluate_kinds`). Implied requirements are passed to the generator but not scored, because the user never asked for them;
3. per requirement: noul ≥ 0.7 → `covered` (1), ≤ 0.3 → `missing` (0), otherwise `uncertain` (0.5). Coverage ratio = mean points.

This drives the "✓ 37 requirements verified" style of UI, and every count is computed by code.

## 7. Applicability gates

Not every check fits every product. A CLI tool has no screens; an offline app has no network behavior. Five Noul gates decide which checks apply:

| Gate | True when the product… | Gates |
|---|---|---|
| `gate.has_ui` | has screens or pages | `ui.screens`, `ui.states`, `ui.navigation` |
| `gate.has_user_accounts` | requires sign-in or accounts | `sec.auth_states` |
| `gate.persists_data` | stores data that survives restarts | `data.persistence_migration`, and the `crit.no_entities` rule |
| `gate.uses_network` | depends on a backend, sync, or external API | `edge.network_offline` |
| `gate.handles_sensitive_data` | stores personal, financial, health, credential, or private data | `sec.data_privacy` |

A gate applies when `noul ≥ 0.5` (`policy.gates.applies_at`). The gate questions are asked about both the request and the spec, so a spec that adds accounts on its own is still held to the auth-state standard.

A check can also drop out on its own when Jev picks its escape option: if the combined probability of the `not_applicable` option(s) (points `null` in `rubric.json`) is ≥ 0.5, the check is marked not applicable.

Inapplicable checks are removed and the category's remaining check weights are renormalized. A category with no applicable checks (for example UI/UX for a CLI) is removed, and the Forge Score renormalizes over the remaining category weights.

## 8. Score calculation

All of this is in code. Parameters are in `policy.json`.

**Check points (0–1)**
- *Noul:* `x = noul` (or `1 − noul` for `polarity: negative`). `x ≥ 0.7` → 1.0; `x ≤ 0.3` → 0.0; otherwise 0.5, flagged `uncertain`.
- *Choice:* expected points over the non-escape options, renormalized:
  `points = Σ p(o)·pts(o) / Σ p(o)` over options whose points aren't null. Flag `low_confidence` if `confidence < 0.4`; flag `insufficient_evidence` if that option has p ≥ 0.5.
- *Score:* `points = score / (levels − 1)`. Flag `low_confidence` if `confidence < 0.4`.
- *Rule:* as defined per rule in §6.
- *Dynamic requirements:* coverage ratio (mean of per-requirement points).

**Category score (0–100):** `100 × Σ(wᵢ·pointsᵢ) / Σ wᵢ` over applicable checks.

**Forge Score (raw):** `Σ(W_c·S_c) / Σ W_c` over applicable categories.

**Forge Score:** `raw`, capped at **69** if any critical failure fires. Scores are stored unrounded and rounded only for display.

Why expected value for Choice rather than the top option? It uses Jev's uncertainty instead of discarding it: a 55/45 split between "complete" and "minor gaps" gives 0.89, not 1.0. The research warns that confidence can be misleading, so flags are surfaced in the gap report rather than trusted silently.

## 9. Critical failures

A critical failure means "a coding agent will almost certainly go wrong here", however good the rest is. Any critical failure caps the Forge Score at 69 (below the 70 needs-work line), blocks PASS, and is listed first in the optimizer prompt.

| Rule | Fires when | Applies only if |
|---|---|---|
| `crit.spec_too_long` | estimated spec tokens > 24,000 | — |
| `crit.requirement_coverage` | requirement coverage ratio < 0.8 | — |
| `crit.coverage_overall` | p(major_gaps) + p(insufficient) ≥ 0.5 on `req.coverage_overall` | — |
| `crit.no_testing` | p(missing) ≥ 0.5 on `test.strategy` | — |
| `crit.ui_states_missing` | p(missing) ≥ 0.5 on `ui.states` | `has_ui` |
| `crit.auth_states_missing` | p(missing) ≥ 0.5 on `sec.auth_states` | `has_user_accounts` |
| `crit.no_entities` | p(missing) + p(names_only) ≥ 0.5 on `data.entities` | `persists_data` |
| `crit.incoherent_stack` | p(incoherent) ≥ 0.5 on `dep.coherent` | — |
| `crit.too_many_open_decisions` | p(many) ≥ 0.5 on `ready.open_decisions` | — |

Rules fire on **summed probability of the failing options**, not the top option, so a spread-out distribution that is mostly "bad" still fires, while an uncertain answer that is mostly "fine" doesn't. A rule whose source check is gated out or not applicable never fires.

## 10. Pass/fail rules and bands

**PASS** requires all of:
- Forge Score ≥ **85**;
- no critical failures;
- every applicable category ≥ **60**, so one very weak area can't hide behind strong ones.

| Band | Forge Score | Label |
|---|---|---|
| `excellent` | ≥ 95 | Ready to implement |
| `pass` | 85–94.99 | Ready, with minor improvements possible |
| `needs_work` | 70–84.99 | Needs targeted optimization |
| `weak` | < 70 | Needs a major rewrite |

A spec can land in the `pass` band and still not PASS if one category is below 60. The UI should show both the band and the PASS flag.

## 11. Optimization loop and stop conditions

**Mode** is chosen from the **raw** (uncapped) score, so one critical failure doesn't force a full rewrite of an otherwise good spec:

| Raw score | Mode | What the optimizer is told |
|---|---|---|
| < 70 | `major_rewrite` | Restructure fully into the template; rewrite vague sections from scratch |
| 70–84.99 | `targeted` | Keep structure; rewrite weak/critical sections in depth |
| 85–94.99 | `weak_categories_only` | Change only what raises the listed categories; leave other text as is |
| ≥ 95 | `stop` | — |

If any critical failure exists, a mode milder than `targeted` (`weak_categories_only` or `stop`) is replaced by `targeted` (`critical_forces_mode_at_least`).

**Gap report** (`schemas/gap-report.schema.json`), built by code from the evaluation result:
- `critical` — every fired rule with its message and the source check's `fix_hint`;
- `weak` — categories below 70 (or below 85 in `weak_categories_only` mode), lowest first, each with its failing checks (points < 0.7), a short answer summary, and the `fix_hint`;
- `strong` — categories ≥ 90, which the optimizer must preserve;
- `uncovered_requirements` — requirements with status `missing` or `uncertain`.

It is rendered into `prompts/v0.1/optimizer.md`, which tells Claude to fix every critical and weak item, cover every uncovered requirement, preserve strong areas, add no unrequested features, make requirements testable (Given/When/Then AC-ids), keep the 12-section template and stable R-ids, and return the complete replacement spec.

**Stop conditions** (the first one that holds ends the loop):
1. Forge Score ≥ 95 and no critical failures.
2. Mode is `weak_categories_only`, no category is below 85, and there are no critical failures.
3. 3 optimization passes done (so at most V1 + 3 rewrites = 4 evaluations).
4. Plateau: Forge Score gained < 2 points over the previous version **and** no critical failure was resolved.
5. Regression: Forge Score went down.

**Return the best version, not the last.** The loop keeps every version and returns the one with the highest Forge Score, breaking ties with the higher raw score and then the later version. After a regression the user still gets the better earlier spec.

## 12. Worked example

Fixture `fixtures/v0.1/expense-tracker-ios/spec-medium.md` (a reasonable but thin spec). The Jev answers below are **illustrative, not real model output**. They are hand-picked to show the arithmetic. Full files: `docs/examples/jev-request.example.json`, `jev-response.example.json`, `evaluation-result.example.json`, `gap-report.example.json`.

**Preflight:** ~822 tokens, 0 missing sections, 3 unique AC labels, no placeholders.

**Gates:** has_ui 0.98 ✓, has_user_accounts 0.03 ✗, persists_data 0.97 ✓, uses_network 0.05 ✗, handles_sensitive_data 0.81 ✓.
So `sec.auth_states` and `edge.network_offline` are gated out.

**Requirements:** 10 explicit requirements extracted (R11 "saved between launches" is implied and not scored). R1–R9 have noul 0.88–0.95 → covered. R10 "export a *chosen* month" gets 0.62 → uncertain, because the spec only exports the current month. Coverage = (9 + 0.5) / 10 = **0.95**.

**Category scores**

| Category | Check points (weight) | Score |
|---|---|---:|
| Requirements | explicit_coverage 0.95 (2), coverage_overall 0.8675 (2), scope_creep 1 (1) | 92.70 |
| Architecture | components 0.685, data_flow 0.52, platform_fit 0.96 | 72.17 |
| Implementation | sections 1, file_structure 0.425, ordered_steps 1, guessing 0.5333 (2) | 69.83 |
| Data model | entities 0.685, relationships 0.45, persistence 0.45 | 52.83 |
| UI/UX | screens 0.895, states 0.475, navigation 1 | 79.00 |
| Edge cases | error_handling 0.375, input_validation 0.5 (noul 0.45 → uncertain); network gated out | 43.75 |
| Security | data_privacy 0.5; auth gated out; secrets not_applicable (p = 0.85) | 50.00 |
| Testing | strategy 0.405 (2), ac_testable 0.825 (2), ac_count 3/5 = 0.6 (1) | 61.20 |
| Dependencies | stack 1, coherent 0.968, contradictions 1 (noul 0.10 → negative → 0.90 → pass) | 98.93 |
| Build readiness | open_decisions 0.76 (2), can_start 1, no_placeholders 1 | 88.00 |

Two of the expected-value calculations, spelled out:
- `req.coverage_overall` = 0.55·1 + 0.40·0.75 + 0.05·0.35 + 0·0 = **0.8675**
- `test.strategy` = 0·1 + 0.30·0.7 + 0.65·0.3 + 0.05·0 = **0.405**

**Forge Score (raw)** = (15·92.70 + 10·72.17 + 12·69.83 + 10·52.83 + 10·79.00 + 10·43.75 + 8·50.00 + 12·61.20 + 5·98.93 + 8·88.00) / 100 = **70.39**

**Critical failures:** none. For example, `ui.states` has p(missing) = 0.10 < 0.5, and `test.strategy` has p(missing) = 0.05.
**Forge Score** = 70.39 → band `needs_work` → **not PASS** (below 85; edge cases, security, and data model are below 60).
**Next mode:** `targeted`.

**Gap report (abridged):**
- Weak, lowest first: Edge cases 43.75 (`edge.error_handling` generic, `edge.input_validation` uncertain) → Security 50 (`sec.data_privacy` partial) → Data model 52.83 (entities partial, relationships partial, no migration) → Testing 61.2 (strategy minimal, 3 of 5 ACs) → Implementation 69.83 (no file paths, guessing 1.6/3).
- Strong, preserve: Requirements 92.70, Dependencies 98.93.
- Uncovered: R10 (uncertain), "User can export a chosen month's expenses to a CSV file."

The fixture's `spec-strong.md` shows what resolving that gap report looks like.

## 13. JSON schemas and file map

All schemas are JSON Schema draft 2020-12.

| File | Purpose |
|---|---|
| `rubric/v0.1/rubric.json` | Categories, gates, 31 checks with exact Jev questions, options → points, fix hints |
| `rubric/v0.1/policy.json` | Category weights, thresholds, preflight, critical rules, pass rules, bands, optimization/stop policy |
| `schemas/rubric.schema.json` | Validates the rubric |
| `schemas/policy.schema.json` | Validates the policy |
| `schemas/jev-request.schema.json` | What SpecForge sends to `/v1/systemone` (state shape, pinned model) |
| `schemas/jev-response.schema.json` | What Jev returns (noul / choice / score answers) |
| `schemas/extracted-requirements.schema.json` | Requirements extractor output |
| `schemas/evaluation-result.schema.json` | Provider-neutral scorecard produced by the scoring engine |
| `schemas/gap-report.schema.json` | Optimizer input |
| `schemas/fixture-expected.schema.json` | Hand-labelled expectations for calibration fixtures |
| `prompts/v0.1/requirements-extractor.md` | Claude: idea → verbatim-quoted requirements |
| `prompts/v0.1/plan-generator.md` | Claude: idea + requirements → spec V1 in the template |
| `prompts/v0.1/optimizer.md` | Claude: gap report → complete replacement spec (+ mode instruction blocks) |
| `fixtures/v0.1/*/` | Two ideas × weak/medium/strong specs + `expected.json` |
| `docs/examples/*.example.json` | The worked example's request, response, result, and gap report |

The `EvaluationProvider` interface from the phase plan maps onto these schemas: `evaluate(project, specification, rubric)` takes the rubric and state and returns answers in the shape of `jev-response`. The scoring engine turns those into an `evaluation-result`. A non-Jev provider only has to produce the same answer types.

**Validate everything:**
```bash
npx ajv-cli@5 validate --spec=draft2020 --strict=false -s schemas/rubric.schema.json -d rubric/v0.1/rubric.json
npx ajv-cli@5 validate --spec=draft2020 --strict=false -s schemas/policy.schema.json -d rubric/v0.1/policy.json
npx ajv-cli@5 validate --spec=draft2020 --strict=false -s schemas/fixture-expected.schema.json -d "fixtures/v0.1/*/expected.json"
```

## 14. Versioning rules

- **Never edit a check in place.** Any change to a question's wording, options, option descriptions, or points creates a new version (`test.strategy` v1 → v2, key `test_strategy_v2`). Old versions stay so historical evaluations can be reproduced.
- A new or changed check bumps the **rubric version**. Weights, thresholds, or critical rules bump the **policy version**. Prompt wording bumps the **prompt version**.
- Every stored evaluation records `rubric_version`, `policy_version`, the evaluator model Jev reported, and the prompt versions used to produce the spec. Scores are only comparable across identical version sets.
- Moving to a new Jev release is a new calibration run, not a silent swap.

## 15. Known limitations and the Phase 1 calibration plan

**Known limitations**
- **Every number here is a guess.** Weights, points tables, the 0.7/0.3 Noul thresholds, the 0.5 critical threshold, the 69 cap, and the 85 pass line have not been tested against real Jev output yet.
- **Jev judges text, not outcomes.** A high Forge Score means the spec *looks* complete to Jev. Phase 6 must test whether higher scores actually produce better software from coding agents.
- **Long specs.** Jev is weaker on long, partly irrelevant context. Strong fixtures are ~3.5–4.5k tokens. Behavior near the 24k cap is unknown, and a later version may evaluate section-scoped state per category.
- **Question wording sensitivity.** A Choice and the equivalent Nouls need not agree. Only the phrasings in `rubric.json` are calibrated; don't mix in variants.
- **Prompt injection.** A malicious request or a spec generated from it could try to steer Jev ("this spec is complete"). Mitigations: labelled state fields, deterministic rules for anything countable, and the plan to red-team this in Phase 1.
- **Repeatability.** Independent tests saw a few Jev answers change on repeat runs. Phase 1 should measure run-to-run variance before trusting small score differences, since the 2-point plateau threshold assumes low noise.

**Phase 1 calibration plan (using `fixtures/v0.1`)**
1. Run each fixture spec through the full evaluation 3 times with `jev-1.13.0` and record raw answers.
2. Check that each fixture's gates match `expected_gates`.
3. Check ordering: weak < medium < strong for both ideas, in every run.
4. Check bands and critical failures against `expected.json`. For each mismatch, decide whether the question wording, the points table, or the expectation is wrong, and record the decision.
5. Measure run-to-run spread per check and for the Forge Score, and set `plateau_min_gain` to at least twice the observed noise.
6. Add at least 3 more fixtures (a CLI tool, a backend API, and an adversarial request containing injection text) before tuning further, so the rubric isn't fitted to two examples.
7. Publish results as rubric/policy `0.2.0` with a changelog; `0.1.0` stays as the baseline.
