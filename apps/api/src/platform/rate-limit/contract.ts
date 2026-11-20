// Suite de contrato única da porta `RateLimiter` (ADR-038 §12a): corre contra o adaptador em memória e o Redis.
// Usa janelas curtas reais (o Redis usa o `TIME` do servidor).
import { describe, expect, it } from "vitest";
import type { RateLimiter } from "./port.js";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export function runRateLimiterContract(name: string, make: (namespace: string) => RateLimiter): void {
  describe(`contrato RateLimiter: ${name}`, () => {
    const key = (subject: string, rule = "login") => ({ rule, subject });

    it("permite até max e bloqueia depois com retryAfterMs dentro da janela", async () => {
      const limiter = make("contract-a");
      const rule = { max: 3, windowMs: 5_000 };
      for (let i = 0; i < 3; i++) {
        expect((await limiter.consume(key("u1"), rule)).allowed).toBe(true);
      }
      const blocked = await limiter.consume(key("u1"), rule);
      expect(blocked.allowed).toBe(false);
      expect(blocked.retryAfterMs).toBeGreaterThan(0);
      expect(blocked.retryAfterMs).toBeLessThanOrEqual(5_000);
    });

    it("desliza: liberta depois de a janela passar", async () => {
      const limiter = make("contract-b");
      const rule = { max: 1, windowMs: 300 };
      expect((await limiter.consume(key("u1"), rule)).allowed).toBe(true);
      expect((await limiter.consume(key("u1"), rule)).allowed).toBe(false);
      await sleep(400);
      expect((await limiter.consume(key("u1"), rule)).allowed).toBe(true);
    });

    it("peek não regista", async () => {
      const limiter = make("contract-c");
      const rule = { max: 1, windowMs: 5_000 };
      for (let i = 0; i < 3; i++) {
        expect((await limiter.peek(key("u1"), rule)).allowed).toBe(true);
      }
      expect((await limiter.consume(key("u1"), rule)).allowed).toBe(true);
      const peeked = await limiter.peek(key("u1"), rule);
      expect(peeked.allowed).toBe(false);
      expect(peeked.retryAfterMs).toBeGreaterThan(0);
    });

    it("reset apaga o contador e este recomeça", async () => {
      const limiter = make("contract-r");
      const rule = { max: 2, windowMs: 5_000 };
      await limiter.consume(key("u1"), rule);
      await limiter.consume(key("u1"), rule);
      expect((await limiter.peek(key("u1"), rule)).allowed).toBe(false);
      await limiter.reset(key("u1"));
      expect((await limiter.peek(key("u1"), rule)).allowed).toBe(true);
      expect((await limiter.consume(key("u1"), rule)).allowed).toBe(true);
      await limiter.reset(key("inexistente"));
    });

    it("reset só afeta o sujeito, a regra e o namespace indicados", async () => {
      const a = make("contract-r1");
      const b = make("contract-r2");
      const rule = { max: 1, windowMs: 5_000 };
      await a.consume(key("u1"), rule);
      await a.consume(key("u2"), rule);
      await b.consume(key("u1"), rule);
      await a.reset(key("u1"));
      expect((await a.peek(key("u1"), rule)).allowed).toBe(true);
      expect((await a.peek(key("u2"), rule)).allowed).toBe(false);
      expect((await b.peek(key("u1"), rule)).allowed).toBe(false);
    });

    it("isola por sujeito, por regra e por namespace", async () => {
      const a = make("contract-d1");
      const b = make("contract-d2");
      const rule = { max: 1, windowMs: 5_000 };
      expect((await a.consume(key("u1"), rule)).allowed).toBe(true);
      expect((await a.consume(key("u2"), rule)).allowed).toBe(true);
      expect((await a.consume(key("u1", "outra"), rule)).allowed).toBe(true);
      expect((await b.consume(key("u1"), rule)).allowed).toBe(true);
      expect((await a.consume(key("u1"), rule)).allowed).toBe(false);
    });

    it("sujeitos PII (e-mail/IP) contam como o mesmo sujeito", async () => {
      const limiter = make("contract-e");
      const rule = { max: 1, windowMs: 5_000 };
      const pii = { rule: "login", subject: "pessoa@exemplo.pt", pii: true };
      expect((await limiter.consume(pii, rule)).allowed).toBe(true);
      expect((await limiter.consume(pii, rule)).allowed).toBe(false);
    });
  });
}
