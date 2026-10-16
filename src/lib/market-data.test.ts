import { describe, expect, it } from "vitest";
import { parseOptions } from "./market-data";

describe("public option feed", () => {
  it("preserves quote date and never invents locked fields", () => {
    const row = ["PETRJ253_2026", "", "CALL", "A", "ITM", 39, 0, 0, 1.25, 12, 500, "2026-10-15", "<img>"];
    const parsed = parseOptions([row], "PETR4", "2026-10-16", "2026-10-16T03:00:00Z");
    expect(parsed[0]).toMatchObject({ ticker: "PETRJ253", strike: 39, ultimo: 1.25, iv: null, delta: null, bid: null, ask: null, data_coleta: "2026-10-15T03:00:00.000Z" });
  });
  it("rejects malformed rows and unavailable quote timestamps", () => {
    expect(parseOptions([null, [], ["CODE", "", "PUT", "E", "OTM", 30, 0, 0, 1, 1, 1, "—"]], "PETR4", "2026-10-16", "now")).toEqual([]);
  });
});