import { checkKey, rubric } from "@/lib/rubric/load";
import type { DynamicCheck, JevQuestion, JevRequest, Requirement } from "@/lib/rubric/types";
import { evaluatedRequirements } from "./requirements";

const dynamicCheck = rubric.checks.find((c): c is DynamicCheck => c.kind === "jev_dynamic");

export function requirementKey(requirementId: string): string {
  if (!dynamicCheck) throw new Error("rubric has no dynamic requirement check");
  return dynamicCheck.key_template.replace("{requirement_id}", requirementId.toLowerCase());
}

function fillTemplate(value: unknown, text: string): unknown {
  if (typeof value === "string") return value.replaceAll("{requirement_text}", text);
  if (Array.isArray(value)) return value.map((v) => fillTemplate(v, text));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillTemplate(v, text)]));
  }
  return value;
}

/**
 * One request per evaluation (§3): every gate, one Noul per explicit requirement, and every Jev rubric check.
 * Gated-out checks are still asked; the scoring engine discards their answers.
 */
export function buildJevRequest(userRequest: string, specification: string, requirements: Requirement[], model = rubric.evaluator_model): JevRequest {
  const questions: Record<string, JevQuestion> = {};
  for (const g of rubric.gates) {
    questions[g.key] = { type: "noul", instructions: g.instructions, ...(g.criteria ? { criteria: g.criteria } : {}) };
  }
  if (dynamicCheck) {
    for (const r of evaluatedRequirements(requirements)) {
      questions[requirementKey(r.id)] = {
        type: "noul",
        instructions: fillTemplate(dynamicCheck.instructions_template, r.text) as JevQuestion["instructions"],
        ...(dynamicCheck.criteria ? { criteria: dynamicCheck.criteria } : {}),
      };
    }
  }
  for (const c of rubric.checks) {
    if (c.kind !== "jev") continue;
    if (c.type === "noul") {
      questions[checkKey(c)] = { type: "noul", instructions: c.instructions, ...(c.criteria ? { criteria: c.criteria } : {}) };
    } else if (c.type === "choice") {
      questions[checkKey(c)] = { type: "choice", instructions: c.instructions, criteria: c.criteria };
    } else {
      questions[checkKey(c)] = { type: "score", instructions: c.instructions, criteria: c.criteria };
    }
  }
  return { state: { user_request: userRequest, specification }, model, questions };
}
