import { policy } from "@/lib/rubric/load";
import type { Requirement } from "@/lib/rubric/types";

export type FilteredRequirements = { requirements: Requirement[]; dropped: { requirement: Requirement; reason: string }[] };

/**
 * Applies the extractor rules from docs/evaluation-system-v0.1.md §6: a requirement whose source_quote is not a
 * verbatim substring of the user's request is treated as hallucinated and dropped; at most max_extracted are kept.
 */
export function filterRequirements(userRequest: string, extracted: Requirement[]): FilteredRequirements {
  const requirements: Requirement[] = [];
  const dropped: FilteredRequirements["dropped"] = [];
  const seen = new Set<string>();
  for (const r of extracted) {
    if (seen.has(r.id)) {
      dropped.push({ requirement: r, reason: "duplicate id" });
    } else if (policy.requirements.require_source_quote_match && !userRequest.includes(r.source_quote)) {
      dropped.push({ requirement: r, reason: "source_quote is not a verbatim part of the request" });
    } else if (requirements.length >= policy.requirements.max_extracted) {
      dropped.push({ requirement: r, reason: `over the ${policy.requirements.max_extracted}-requirement limit` });
    } else {
      requirements.push(r);
      seen.add(r.id);
    }
  }
  return { requirements, dropped };
}

/** Requirements that are scored by Jev (explicit only in policy 0.1.0). */
export function evaluatedRequirements(requirements: Requirement[]): Requirement[] {
  return requirements.filter((r) => policy.requirements.evaluate_kinds.includes(r.kind));
}
