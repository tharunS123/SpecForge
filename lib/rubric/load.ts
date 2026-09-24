import rubricJson from "@/rubric/v0.1/rubric.json";
import policyJson from "@/rubric/v0.1/policy.json";
import type { Policy, Rubric } from "./types";

// The JSON files are validated against schemas/*.schema.json in tests/rubric.test.ts;
// these casts only narrow the JSON literal types to the schema-shaped types.
export const rubric = rubricJson as unknown as Rubric;
export const policy = policyJson as unknown as Policy;

if (policy.rubric_version !== rubric.rubric_version) {
  throw new Error(`policy ${policy.policy_version} targets rubric ${policy.rubric_version}, found ${rubric.rubric_version}`);
}

export const categoryNames: Record<string, string> = Object.fromEntries(rubric.categories.map((c) => [c.id, c.name]));

/** Jev question key for a rubric check, e.g. req.coverage_overall v1 -> req_coverage_overall_v1. */
export function checkKey(check: { id: string; version: number }): string {
  return `${check.id.replace(".", "_")}_v${check.version}`;
}
