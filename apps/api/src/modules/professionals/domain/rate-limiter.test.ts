// Testes unitários do rate limiter em memória do portal do profissional (BR-MKT-13/30). Relógio fixo; sem I/O.
import { beforeEach, describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { ProfessionalInMemoryRateLimiter } from "./rate-limiter.js";

const START = new Date("2026-11-16T10:00:00.000Z");
const MINUTE = 60_000;

describe("ProfessionalInMemoryRateLimiter", () => {
  let clock: FixedClock;
  let limiter: ProfessionalInMemoryRateLimiter;

  beforeEach(() => {
    clock = new FixedClock(START);
    limiter = new ProfessionalInMemoryRateLimiter(clock);
  });

  describe("consume", () => {
    it("permite até ao máximo e bloqueia a seguinte", () => {
      const rule = { max: 3, windowMs: MINUTE };
      for (let i = 0; i < 3; i += 1) {
        expect(limiter.consume("ip-1", rule)).toEqual({ allowed: true, retryAfterMs: 0 });
      }
      expect(limiter.consume("ip-1", rule).allowed).toBe(false);
    });

    it("calcula retryAfterMs até a hit mais antiga sair da janela", () => {
      const rule = { max: 2, windowMs: MINUTE };
      limiter.consume("ip-1", rule);
      clock.advance(10_000);
      limiter.consume("ip-1", rule);
      clock.advance(10_000);
      expect(limiter.consume("ip-1", rule)).toEqual({ allowed: false, retryAfterMs: 40_000 });
    });

    it("a janela desliza: após avançar a janela, volta a permitir", () => {
      const rule = { max: 2, windowMs: MINUTE };
      limiter.consume("ip-1", rule);
      clock.advance(30_000);
      limiter.consume("ip-1", rule);
      clock.advance(30_000);
      expect(limiter.consume("ip-1", rule).allowed).toBe(true);
      expect(limiter.consume("ip-1", rule).allowed).toBe(false);
    });

    it("chaves diferentes têm contadores independentes", () => {
      const rule = { max: 1, windowMs: MINUTE };
      expect(limiter.consume("a", rule).allowed).toBe(true);
      expect(limiter.consume("a", rule).allowed).toBe(false);
      expect(limiter.consume("b", rule).allowed).toBe(true);
    });

    it("uma tentativa bloqueada não conta como nova hit", () => {
      const rule = { max: 1, windowMs: MINUTE };
      limiter.consume("k", rule);
      clock.advance(30_000);
      limiter.consume("k", rule);
      limiter.consume("k", rule);
      clock.advance(30_000);
      expect(limiter.consume("k", rule).allowed).toBe(true);
    });
  });

  describe("peek", () => {
    it("não consome: pode ser chamado várias vezes sem bloquear", () => {
      const rule = { max: 1, windowMs: MINUTE };
      for (let i = 0; i < 5; i += 1) {
        expect(limiter.peek("k", rule)).toEqual({ allowed: true, retryAfterMs: 0 });
      }
      expect(limiter.consume("k", rule).allowed).toBe(true);
    });

    it("reflete o bloqueio depois de consumir o máximo", () => {
      const rule = { max: 1, windowMs: MINUTE };
      limiter.consume("k", rule);
      expect(limiter.peek("k", rule)).toEqual({ allowed: false, retryAfterMs: MINUTE });
    });
  });

  describe("reset", () => {
    it("limpa o contador da chave", () => {
      const rule = { max: 1, windowMs: MINUTE };
      limiter.consume("k", rule);
      expect(limiter.consume("k", rule).allowed).toBe(false);
      limiter.reset("k");
      expect(limiter.consume("k", rule).allowed).toBe(true);
    });

    it("não afeta outras chaves", () => {
      const rule = { max: 1, windowMs: MINUTE };
      limiter.consume("a", rule);
      limiter.consume("b", rule);
      limiter.reset("a");
      expect(limiter.consume("a", rule).allowed).toBe(true);
      expect(limiter.consume("b", rule).allowed).toBe(false);
    });
  });

  describe("prune", () => {
    it("remove as hits mais antigas do que maxAgeMs", () => {
      const rule = { max: 1, windowMs: 60 * MINUTE };
      limiter.consume("k", rule);
      clock.advance(30 * MINUTE);
      expect(limiter.peek("k", rule).allowed).toBe(false);
      limiter.prune(10 * MINUTE);
      expect(limiter.peek("k", rule).allowed).toBe(true);
    });

    it("mantém as hits dentro de maxAgeMs", () => {
      const rule = { max: 1, windowMs: 60 * MINUTE };
      limiter.consume("k", rule);
      clock.advance(30 * MINUTE);
      limiter.prune(60 * MINUTE);
      expect(limiter.peek("k", rule).allowed).toBe(false);
    });

    it("não falha quando não há chaves", () => {
      expect(() => {
        limiter.prune(MINUTE);
      }).not.toThrow();
    });
  });
});
