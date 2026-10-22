import { describe, expect, it, vi } from "vitest";
import { isChunkLoadError, recoverChunkLoad } from "./chunk-recovery";

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

describe("chunk recovery", () => {
  const error = new TypeError("Failed to fetch dynamically imported module: https://example.com/assets/route-old.js");
  it("reloads a stale route module once and blocks a reload loop", () => {
    const store = storage();
    const reload = vi.fn();
    expect(recoverChunkLoad(error, store, reload, 100_000)).toBe(true);
    expect(recoverChunkLoad(error, store, reload, 100_001)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it("does not reload for ordinary network or application errors", () => {
    const reload = vi.fn();
    expect(recoverChunkLoad(new Error("Failed to fetch"), storage(), reload)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(isChunkLoadError(new Error("Importing a module script failed."))).toBe(true);
  });
  it("does not auto-reload when storage is blocked", () => {
    const reload = vi.fn();
    const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: vi.fn() };
    expect(recoverChunkLoad(error, blocked, reload)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});