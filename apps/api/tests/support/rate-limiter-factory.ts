// Limitador dos harnesses de integração: em memória por omissão; com `VITA_TEST_REDIS_URL` usa o adaptador
// Redis REAL (RL8, ADR-038 §12) para correr as mesmas suites contra um Redis de verdade. Nota: o Redis usa o
// relógio do servidor, pelo que testes que avançam o `FixedClock` para «passar a janela» não são aplicáveis.
import type { Clock } from "../../src/platform/clock/index.js";
import { InMemoryRateLimiter } from "../../src/platform/rate-limit/in-memory.js";
import { RedisRateLimiter } from "../../src/platform/rate-limit/infrastructure/redis-rate-limiter.js";
import { RedisRateLimitStore } from "../../src/platform/rate-limit/infrastructure/redis-store.js";
import type { RateLimiter } from "../../src/platform/rate-limit/port.js";

let sharedStore: RedisRateLimitStore | undefined;

export const usingRealRedis = (): boolean => process.env.VITA_TEST_REDIS_URL !== undefined;

export function createTestRateLimiter(clock: Clock, namespace: string): RateLimiter {
  const url = process.env.VITA_TEST_REDIS_URL;
  if (url === undefined) {
    return new InMemoryRateLimiter(clock, { namespace });
  }
  sharedStore ??= new RedisRateLimitStore({ url, commandTimeoutMs: 3_000, connectTimeoutMs: 3_000 });
  return new RedisRateLimiter({ store: sharedStore, namespace, prefix: `vita:itest:${process.pid.toString()}`, secret: "harness-secret-0123456789abcdef0123456789", clock });
}
