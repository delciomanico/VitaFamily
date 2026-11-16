// Testes unitários do cache com expiração do portal do profissional (BR-MKT-29). Sem I/O.
import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { ProfessionalTtlCache } from "./ttl-cache.js";

const START = new Date("2026-11-16T10:00:00.000Z");

describe("ProfessionalTtlCache", () => {
  it("devolve undefined para uma chave inexistente", () => {
    const cache = new ProfessionalTtlCache<string>(new FixedClock(START), 60_000);
    expect(cache.get("nao-existe")).toBeUndefined();
  });

  it("devolve o valor guardado dentro do TTL", () => {
    const clock = new FixedClock(START);
    const cache = new ProfessionalTtlCache<string>(clock, 60_000);
    cache.set("conta-1", "ativa");
    clock.advance(59_999);
    expect(cache.get("conta-1")).toBe("ativa");
  });

  it("expira exatamente no instante do TTL", () => {
    const clock = new FixedClock(START);
    const cache = new ProfessionalTtlCache<string>(clock, 60_000);
    cache.set("conta-1", "ativa");
    clock.advance(60_000);
    expect(cache.get("conta-1")).toBeUndefined();
  });

  it("remove a entrada expirada (não volta a aparecer ao recuar o relógio)", () => {
    const clock = new FixedClock(START);
    const cache = new ProfessionalTtlCache<string>(clock, 1_000);
    cache.set("k", "v");
    clock.advance(2_000);
    expect(cache.get("k")).toBeUndefined();
    clock.set(START);
    expect(cache.get("k")).toBeUndefined();
  });

  it("set de uma chave existente renova o prazo", () => {
    const clock = new FixedClock(START);
    const cache = new ProfessionalTtlCache<number>(clock, 60_000);
    cache.set("k", 1);
    clock.advance(50_000);
    cache.set("k", 2);
    clock.advance(50_000);
    expect(cache.get("k")).toBe(2);
  });

  it("invalidate remove a entrada imediatamente", () => {
    const cache = new ProfessionalTtlCache<string>(new FixedClock(START), 60_000);
    cache.set("k", "v");
    cache.invalidate("k");
    expect(cache.get("k")).toBeUndefined();
  });

  it("invalidate de uma chave inexistente não falha", () => {
    const cache = new ProfessionalTtlCache<string>(new FixedClock(START), 60_000);
    expect(() => {
      cache.invalidate("nao-existe");
    }).not.toThrow();
  });
});
