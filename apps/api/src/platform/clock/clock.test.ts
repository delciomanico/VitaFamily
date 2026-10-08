import { describe, expect, it } from "vitest";
import { FixedClock, SystemClock } from "./index.js";

describe("SystemClock", () => {
  it("devolve o instante real (próximo de agora)", () => {
    const before = Date.now();
    const now = new SystemClock().now().getTime();
    const after = Date.now();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(after);
  });
});

describe("FixedClock", () => {
  it("devolve sempre o valor inicial até avançar", () => {
    const clock = new FixedClock(new Date("2026-01-01T00:00:00.000Z"));
    expect(clock.now().toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(clock.now().toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("avança pelo delta indicado", () => {
    const clock = new FixedClock(new Date("2026-01-01T00:00:00.000Z"));
    clock.advance(60_000);
    expect(clock.now().toISOString()).toBe("2026-01-01T00:01:00.000Z");
  });

  it("fixa um novo instante com set", () => {
    const clock = new FixedClock(new Date("2026-01-01T00:00:00.000Z"));
    clock.set(new Date("2030-05-01T12:00:00.000Z"));
    expect(clock.now().toISOString()).toBe("2030-05-01T12:00:00.000Z");
  });

  it("devolve cópias independentes (mutar o resultado não afeta o relógio)", () => {
    const clock = new FixedClock(new Date("2026-01-01T00:00:00.000Z"));
    const first = clock.now();
    first.setUTCFullYear(1999);
    expect(clock.now().getUTCFullYear()).toBe(2026);
  });
});
