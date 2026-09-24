import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020";

export const root = path.resolve(__dirname, "..");
export const readJson = <T = unknown>(rel: string): T => JSON.parse(readFileSync(path.join(root, rel), "utf8")) as T;
export const readText = (rel: string) => readFileSync(path.join(root, rel), "utf8");

/** Ajv with every schema in schemas/ registered, so cross-file $refs resolve. */
export function schemaValidator() {
  const ajv = new Ajv2020({ strict: false, validateFormats: false, allErrors: true });
  for (const f of readdirSync(path.join(root, "schemas"))) ajv.addSchema(readJson(`schemas/${f}`));
  return (schemaFile: string, data: unknown) => {
    const validate = ajv.getSchema(`https://specforge.dev/schemas/${schemaFile}`);
    if (!validate) throw new Error(`schema not found: ${schemaFile}`);
    const ok = validate(data);
    return { ok, errors: ajv.errorsText(validate.errors) };
  };
}
