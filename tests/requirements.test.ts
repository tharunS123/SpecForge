import { describe, expect, it } from "vitest";
import { filterRequirements } from "@/lib/eval/requirements";
import type { Requirement } from "@/lib/rubric/types";

const idea = "Build a todo app. Users can add tasks and mark them done.";
const req = (id: string, source_quote: string, kind: Requirement["kind"] = "explicit"): Requirement => ({ id, kind, text: `text ${id}`, source_quote });

describe("filterRequirements", () => {
  it("drops requirements whose quote is not verbatim in the request, and duplicates", () => {
    const { requirements, dropped } = filterRequirements(idea, [
      req("R1", "add tasks"),
      req("R2", "sync to the cloud"),
      req("R1", "mark them done"),
      req("R3", "mark them done"),
    ]);
    expect(requirements.map((r) => r.id)).toEqual(["R1", "R3"]);
    expect(dropped.map((d) => d.reason)).toEqual(["source_quote is not a verbatim part of the request", "duplicate id"]);
  });

  it("keeps at most 25 requirements", () => {
    const many = Array.from({ length: 30 }, (_, i) => req(`R${i + 1}`, "add tasks"));
    expect(filterRequirements(idea, many).requirements).toHaveLength(25);
  });
});
