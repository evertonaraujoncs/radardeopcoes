import { describe, expect, it } from "vitest";
import { pauseMilliseconds, retryMilliseconds, retryAfterSeconds, providerBlocked, readSchedule, canRecalculateSignals, COLLECTION_POLICY } from "./collection-policy";

describe("uploaded scraper protections", () => {
  it("paces assets at 21–39 seconds around the script's 30-second pause", () => {
    expect(pauseMilliseconds(0)).toBe(21000);
    expect(pauseMilliseconds(1)).toBeCloseTo(39000);
  });
  it("uses four total attempts, four-hour successful collection interval and two exhausted assets", () => {
    expect(COLLECTION_POLICY.attempts).toBe(4);
    expect(COLLECTION_POLICY.minimumHours).toBe(4);
    expect(COLLECTION_POLICY.failedAssets).toBe(2);
  });
  it("backs off exponentially and never shortens Retry-After", () => {
    expect(retryMilliseconds(0, 0, 0)).toBe(48000);
    expect(retryMilliseconds(1, 0, 0)).toBe(96000);
    expect(retryMilliseconds(2, 0, 0)).toBe(192000);
    expect(retryMilliseconds(0, 1200, 0)).toBe(1200000);
  });
  it("accepts numeric and HTTP-date Retry-After", () => {
    expect(retryAfterSeconds("120")).toBe(120);
    expect(retryAfterSeconds("Tue, 20 Oct 2026 02:01:00 GMT", Date.parse("2026-10-20T02:00:00Z"))).toBe(60);
    expect(retryAfterSeconds("bad")).toBe(0);
  });
  it("detects HTTP refusals and refusals hidden in successful bodies", () => {
    for (const status of [403, 429, 503]) expect(providerBlocked(status, "")).toBe(true);
    expect(providerBlocked(200, "Limite de requisições excedido")).toBe(true);
    expect(providerBlocked(401, "Unauthorized")).toBe(false);
    expect(providerBlocked(200, '{"success":true}')).toBe(false);
  });
  it("fails closed when a server reservation is missing", () => {
    expect(() => readSchedule({ kind: "ready" })).toThrow();
    expect(readSchedule({ kind: "ready", token: "lease" }).token).toBe("lease");
  });
  it("never recalculates or closes signals from blocked or invalid grids", () => {
    expect(canRecalculateSignals(true, "success")).toBe(false);
    expect(canRecalculateSignals(false, "error")).toBe(false);
    expect(canRecalculateSignals(false, "success")).toBe(true);
  });
});