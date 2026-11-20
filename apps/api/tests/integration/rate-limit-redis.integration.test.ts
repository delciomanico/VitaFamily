// Integração real (testcontainers Redis, ADR-038 §12): contrato, atomicidade, TTL, sem PII, partilha entre
// instâncias, falha fechada, degradação local e disjuntor.
import { createServer } from "node:net";
import { Redis } from "ioredis";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SystemClock } from "../../src/platform/clock/index.js";
import { runRateLimiterContract } from "../../src/platform/rate-limit/contract.js";
import { RedisRateLimitStore } from "../../src/platform/rate-limit/infrastructure/redis-store.js";
import { RedisRateLimiter } from "../../src/platform/rate-limit/infrastructure/redis-rate-limiter.js";
import { FailMode, RateLimiterUnavailableError } from "../../src/platform/rate-limit/port.js";

const clock = new SystemClock();
const PREFIX = "vita:itest";
const SECRET = "integration-test-secret-0123456789abcdef";
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => {
        resolve(port);
      });
    });
    server.on("error", reject);
  });
}

async function waitReady(target: RedisRateLimitStore): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if (await target.ping(500)) {
      return;
    }
    await sleep(100);
  }
  throw new Error("Redis não ficou pronto");
}

async function startRedis(hostPort: number): Promise<StartedTestContainer> {
  return new GenericContainer("redis:7-alpine")
    .withExposedPorts({ container: 6379, host: hostPort })
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .start();
}

describe("integração: limitadores sobre um Redis real", () => {
  let port: number;
  let container: StartedTestContainer;
  let url: string;
  let store: RedisRateLimitStore;
  let admin: Redis;

  const make = (namespace: string, s: RedisRateLimitStore = store): RedisRateLimiter =>
    new RedisRateLimiter({ store: s, namespace, prefix: PREFIX, secret: SECRET, clock });

  beforeAll(async () => {
    port = await freePort();
    container = await startRedis(port);
    url = `redis://127.0.0.1:${String(port)}/0`;
    store = new RedisRateLimitStore({ url, commandTimeoutMs: 500, connectTimeoutMs: 1000 });
    admin = new Redis(url);
    admin.on("error", () => undefined);
    await waitReady(store);
  }, 120_000);

  afterAll(async () => {
    await store.close();
    admin.disconnect();
    await container.stop().catch(() => undefined);
  });

  runRateLimiterContract("RedisRateLimiter", (namespace) => make(namespace));

  it("atomicidade: N chamadas concorrentes permitem exatamente max", async () => {
    const limiter = make("atomic");
    const rule = { max: 10, windowMs: 10_000 };
    const results = await Promise.all(Array.from({ length: 60 }, () => limiter.consume({ rule: "r", subject: "s" }, rule)));
    expect(results.filter((r) => r.allowed)).toHaveLength(10);
  });

  it("duas instâncias (ligações distintas) partilham o contador", async () => {
    const other = new RedisRateLimitStore({ url, commandTimeoutMs: 500, connectTimeoutMs: 1000 });
    try {
      await waitReady(other);
      const rule = { max: 4, windowMs: 10_000 };
      const a = make("shared");
      const b = make("shared", other);
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? a : b).consume({ rule: "r", subject: "s" }, rule)),
      );
      expect(results.filter((r) => r.allowed)).toHaveLength(4);
    } finally {
      await other.close();
    }
  });

  it("todas as chaves têm TTL e nenhuma contém e-mail/IP em claro", async () => {
    const limiter = make("pii");
    const rule = { max: 5, windowMs: 20_000 };
    await limiter.consume({ rule: "login", subject: "canario@exemplo.pt", pii: true }, rule);
    await limiter.consume({ rule: "login", subject: "203.0.113.77", pii: true }, rule);
    await limiter.consume({ rule: "user", subject: "6f1c1b3a-0000-4000-8000-000000000001" }, rule);
    const keys = await admin.keys(`${PREFIX}:rl:v1:*`);
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) {
      expect(await admin.pttl(k)).toBeGreaterThan(0);
      expect(k).not.toContain("canario");
      expect(k).not.toContain("203.0.113.77");
    }
    expect(keys.some((k) => k.startsWith(`${PREFIX}:rl:v1:pii:login:`))).toBe(true);
  });

  describe("falha do Redis", () => {
    it("parado: fechado => 503; LOCAL_FALLBACK degrada; disjuntor abre e recupera", async () => {
      const local = new RedisRateLimitStore({
        url,
        commandTimeoutMs: 200,
        connectTimeoutMs: 500,
        breakerThreshold: 5,
        breakerOpenMs: 600,
      });
      await waitReady(local);
      const limiter = make("falha", local);
      const rule = { max: 1, windowMs: 10_000 };
      const key = { rule: "r", subject: "s" };
      expect((await limiter.consume(key, rule)).allowed).toBe(true);

      await container.stop();

      for (let i = 0; i < 6; i++) {
        await expect(limiter.consume(key, rule)).rejects.toBeInstanceOf(RateLimiterUnavailableError);
      }
      // Disjuntor aberto: falha imediata (sem esperar pelo timeout).
      const started = performance.now();
      await expect(limiter.consume(key, rule)).rejects.toBeInstanceOf(RateLimiterUnavailableError);
      expect(performance.now() - started).toBeLessThan(50);

      // Degradação local (mesma regra, por processo).
      const opts = { failMode: FailMode.LOCAL_FALLBACK };
      expect((await limiter.consume({ rule: "geral", subject: "x" }, rule, opts)).allowed).toBe(true);
      expect((await limiter.consume({ rule: "geral", subject: "x" }, rule, opts)).allowed).toBe(false);

      expect(await local.ping(500)).toBe(false);

      // Recuperação: Redis volta na mesma porta; a sonda fecha o disjuntor.
      container = await startRedis(port);
      let recovered = false;
      for (let i = 0; i < 40 && !recovered; i++) {
        await sleep(300);
        recovered = await limiter
          .consume({ rule: "r", subject: "novo" }, rule)
          .then((d) => d.allowed)
          .catch(() => false);
      }
      expect(recovered).toBe(true);
      expect(await local.ping()).toBe(true);
      await local.close();
    }, 90_000);
  });
});
