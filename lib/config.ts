import { z } from "zod";

const EnvSchema = z.object({
  OPENROUTER_API_KEY: z.string().min(1).optional(),
  OPENROUTER_MODEL: z.string().min(1).default("nvidia/nemotron-3-super-120b-a12b:free"),
  OPENROUTER_EVAL_MODEL: z.string().min(1).optional(),
  EVALUATOR: z.enum(["llm", "jev"]).default("llm"),
  JEV_BASE_URL: z.string().url().default("https://api.typesafe.ai"),
  JEV_API_KEY: z.string().min(1).optional(),
  JEV_MODEL: z.string().min(1).default("jev-1.13.0"),
  APP_URL: z.string().url().optional(),
});

export type AppConfig = z.infer<typeof EnvSchema> & { OPENROUTER_EVAL_MODEL: string };

/** Reads and validates server environment variables. Throws a readable error for misconfiguration. */
export function getConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(`Invalid configuration: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  const c = parsed.data;
  if (c.EVALUATOR === "jev" && !c.JEV_API_KEY) throw new ConfigError("EVALUATOR=jev requires JEV_API_KEY.");
  return { ...c, OPENROUTER_EVAL_MODEL: c.OPENROUTER_EVAL_MODEL ?? c.OPENROUTER_MODEL };
}

export function requireOpenRouterKey(config: AppConfig): string {
  if (!config.OPENROUTER_API_KEY) throw new ConfigError("OPENROUTER_API_KEY is not set. Add it to .env.local (or the Vercel project settings).");
  return config.OPENROUTER_API_KEY;
}

export class ConfigError extends Error {}
