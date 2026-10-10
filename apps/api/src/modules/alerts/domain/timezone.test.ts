import { describe, expect, it } from "vitest";
import { localMidnightUtc } from "./timezone.js";

describe("localMidnightUtc (BR-EXM-03: exam.24h usa o fuso efetivo do sujeito, Q8)", () => {
  it("UTC: meia-noite local == meia-noite UTC", () => {
    expect(localMidnightUtc("2026-10-15", "UTC").toISOString()).toBe("2026-10-15T00:00:00.000Z");
  });

  it("Europe/Lisbon em horário de verão (UTC+1 em outubro antes da mudança)", () => {
    // 2026-10-15 ainda está em DST em Lisboa (muda no último domingo de outubro); meia-noite local
    // == 23:00 UTC do dia anterior.
    expect(localMidnightUtc("2026-10-15", "Europe/Lisbon").toISOString()).toBe("2026-10-14T23:00:00.000Z");
  });

  it("America/Sao_Paulo (UTC-3)", () => {
    expect(localMidnightUtc("2026-10-15", "America/Sao_Paulo").toISOString()).toBe("2026-10-15T03:00:00.000Z");
  });
});
