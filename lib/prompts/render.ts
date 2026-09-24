import { readFileSync } from "node:fs";
import path from "node:path";
import type { Mode } from "@/lib/rubric/types";

// Loads prompts/v0.1/*.md. Format: front matter, then "# System" and "# User" sections; the optimizer also has a
// trailing "# Mode instructions" section with one "## <mode>" block per mode.

export type PromptName = "requirements-extractor" | "plan-generator" | "optimizer";
export type PromptTemplate = {
  id: string;
  version: string;
  system: string;
  user: string;
  modes: Partial<Record<Mode, string>>;
  placeholders: string[];
};

const PROMPT_DIR = path.join(process.cwd(), "prompts", "v0.1");
const cache = new Map<PromptName, PromptTemplate>();

export function parsePrompt(source: string): PromptTemplate {
  const fm = source.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fm) throw new Error("prompt is missing front matter");
  const meta = Object.fromEntries(
    fm[1].split("\n").map((line) => {
      const i = line.indexOf(":");
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    }),
  );
  const body = source.slice(fm[0].length);
  const sys = body.search(/^# System\s*$/m);
  const usr = body.search(/^# User\s*$/m);
  if (sys < 0 || usr < 0 || usr < sys) throw new Error(`prompt ${meta.prompt_id} needs "# System" then "# User"`);
  const modeStart = body.search(/^# Mode instructions/m);
  const userEnd = modeStart < 0 ? body.length : modeStart;
  const system = body.slice(sys, usr).replace(/^# System\s*\n/, "").trim();
  const user = body
    .slice(usr, userEnd)
    .replace(/^# User\s*\n/, "")
    .trim()
    .replace(/\n---$/, "")
    .trim();

  const modes: PromptTemplate["modes"] = {};
  if (modeStart >= 0) {
    const modeText = body.slice(modeStart);
    for (const m of modeText.matchAll(/^## (\w+)\s*\n([\s\S]*?)(?=^## |(?![\s\S]))/gm)) {
      modes[m[1] as Mode] = m[2].trim();
    }
  }
  const placeholders = [...new Set([...`${system}\n${user}`.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]))];
  return { id: meta.prompt_id, version: meta.version, system, user, modes, placeholders };
}

export function loadPrompt(name: PromptName): PromptTemplate {
  let t = cache.get(name);
  if (!t) {
    t = parsePrompt(readFileSync(path.join(PROMPT_DIR, `${name}.md`), "utf8"));
    cache.set(name, t);
  }
  return t;
}

/** Substitutes {{placeholders}} in one pass, so user-supplied values containing "{{" are never re-expanded. */
export function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    if (!(key in vars)) throw new Error(`missing prompt variable "${key}"`);
    return vars[key];
  });
}

export function renderPrompt(name: PromptName, vars: Record<string, string>): { system: string; user: string; version: string } {
  const t = loadPrompt(name);
  const missing = t.placeholders.filter((p) => !(p in vars));
  if (missing.length) throw new Error(`prompt ${t.id} is missing variables: ${missing.join(", ")}`);
  return { system: fill(t.system, vars), user: fill(t.user, vars), version: t.version };
}

export function promptVersions(): Record<PromptName, string> {
  return {
    "requirements-extractor": loadPrompt("requirements-extractor").version,
    "plan-generator": loadPrompt("plan-generator").version,
    optimizer: loadPrompt("optimizer").version,
  };
}
