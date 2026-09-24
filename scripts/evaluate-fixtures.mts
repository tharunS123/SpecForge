// Runs every fixture spec through the configured evaluator and compares the outcome with expected.json.
// With EVALUATOR=llm this is a smoke test of the loop, not a Jev calibration (docs/evaluation-system-v0.1.md §15).
//
//   npm run fixtures                # all fixtures
//   npm run fixtures -- expense-tracker-ios
//
// Costs: 1 extraction + 3 evaluations per fixture against your OpenRouter quota.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const { evaluateSpec, extractRequirements } = await import("@/lib/pipeline");

type Expected = {
  fixture_id: string;
  expected_gates: Record<string, boolean>;
  ordering: string[];
  specs: Record<string, { file: string; band: string; forge_range: [number, number]; pass: boolean; expected_critical: string[] }>;
};

const root = path.join(process.cwd(), "fixtures", "v0.1");
const only = process.argv.slice(2);
const fixtures = readdirSync(root).filter((f) => !only.length || only.includes(f));
const results: unknown[] = [];

for (const fixture of fixtures) {
  const dir = path.join(root, fixture);
  const expected = JSON.parse(readFileSync(path.join(dir, "expected.json"), "utf8")) as Expected;
  const idea = readFileSync(path.join(dir, "idea.md"), "utf8").trim();
  console.log(`\n=== ${fixture} ===`);
  const extracted = await extractRequirements(idea);
  console.log(`requirements: ${extracted.requirements.length} kept, ${extracted.dropped.length} dropped (${extracted.model})`);

  const scores: Record<string, number> = {};
  for (const label of expected.ordering) {
    const exp = expected.specs[label];
    const spec = readFileSync(path.join(dir, exp.file), "utf8");
    const { evaluation, provider } = await evaluateSpec({ idea, spec, requirements: extracted.requirements, specVersion: 1 });
    scores[label] = evaluation.forge_score;
    const crit = evaluation.critical_failures.map((c) => c.id);
    const inRange = evaluation.forge_score >= exp.forge_range[0] && evaluation.forge_score <= exp.forge_range[1];
    const gateMismatches = Object.entries(expected.expected_gates).filter(([g, v]) => evaluation.gates[g]?.applies !== v).map(([g]) => g);
    console.log(
      `${label.padEnd(7)} forge ${evaluation.forge_score.toFixed(2).padStart(6)} (expected ${exp.forge_range.join("–")}) ${inRange ? "✓" : "✗"}` +
        ` | band ${evaluation.band}${evaluation.band === exp.band ? " ✓" : ` ✗ (expected ${exp.band})`}` +
        ` | pass ${evaluation.pass}${evaluation.pass === exp.pass ? " ✓" : " ✗"}` +
        ` | critical [${crit.join(", ")}] expected [${exp.expected_critical.join(", ")}]` +
        (gateMismatches.length ? ` | gate mismatches: ${gateMismatches.join(", ")}` : ""),
    );
    results.push({ fixture, label, provider, expected: exp, evaluation });
  }
  const ordered = expected.ordering.every((l, i, arr) => i === 0 || scores[arr[i - 1]] < scores[l]);
  console.log(`ordering ${expected.ordering.join(" < ")}: ${ordered ? "✓" : "✗"}`);
}

const outDir = path.join(process.cwd(), "calibration", "runs");
mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(out, JSON.stringify(results, null, 2));
console.log(`\nfull results: ${path.relative(process.cwd(), out)}`);
