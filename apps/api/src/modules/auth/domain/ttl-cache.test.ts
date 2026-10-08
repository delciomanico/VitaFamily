import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { TtlCache } from "./ttl-cache.js";

describe("TtlCache", () => {
  it("devolve undefined quando a chave não existe", () => {
    const cache = new TtlCache<number>(new FixedClock(new Date()), 1000);
    expect(cache.get("k")).toBeUndefined();
  });

  it("devolve o valor dentro do TTL e undefined depois de expirar", () => {
    const clock = new FixedClock(new Date("2026-10-08T10:00:00Z"));
    const cache = new TtlCache<number>(clock, 60_000);
    cache.set("k", 42);
    expect(cache.get("k")).toBe(42);
    clock.advance(59_000);
    expect(cache.get("k")).toBe(42);
    clock.advance(2_000);
    expect(cache.get("k")).toBeUndefined();
  });

  it("invalidate remove a entrada imediatamente", () => {
    const clock = new FixedClock(new Date("2026-10-08T10:00:00Z"));
    const cache = new TtlCache<number>(clock, 60_000);
    cache.set("k", 1);
    cache.invalidate("k");
    expect(cache.get("k")).toBeUndefined();
  });
});
