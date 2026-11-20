// Composição dos limitadores (ADR-038 §1/§7/§8): escolhe Redis ou memória a partir da config e devolve
// `createRateLimiter(namespace)`. Só a composição (`main`) e os testes a chamam.
import type { Clock } from "../clock/index.js";
import type { Config } from "../config/index.js";
import type { Logger } from "../logger/index.js";
import { InMemoryRateLimiter } from "./in-memory.js";
import { RedisRateLimitStore } from "./infrastructure/redis-store.js";
import { RedisRateLimiter } from "./infrastructure/redis-rate-limiter.js";
import type { RateLimiter } from "./port.js";

export type RateLimitingConfig = Pick<
  Config,
  | "NODE_ENV"
  | "REDIS_URL"
  | "REDIS_COMMAND_TIMEOUT_MS"
  | "REDIS_CONNECT_TIMEOUT_MS"
  | "RATE_LIMIT_KEY_PREFIX"
  | "RATE_LIMIT_KEY_SECRET"
  | "RATE_LIMIT_BACKEND"
>;

export interface RateLimiting {
  backend: "redis" | "memory";
  createRateLimiter(namespace: string): RateLimiter;
  /** `PING` ao Redis (readiness). Sem Redis configurado (memória), `true`. */
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

const DEGRADED_LOG_INTERVAL_MS = 5_000;

export function createRateLimiting(config: RateLimitingConfig, deps: { clock: Clock; logger: Logger }): RateLimiting {
  const { clock, logger } = deps;
  const common = { prefix: config.RATE_LIMIT_KEY_PREFIX, secret: config.RATE_LIMIT_KEY_SECRET };

  if (config.RATE_LIMIT_BACKEND === "memory" || config.REDIS_URL === undefined) {
    logger.warn(
      { backend: "memory" },
      "Limitadores de taxa em memória (por processo, perdem-se no reinício); proibido em produção (ADR-038)",
    );
    return {
      backend: "memory",
      createRateLimiter: (namespace) => new InMemoryRateLimiter(clock, { ...common, namespace }),
      ping: () => Promise.resolve(true),
      close: () => Promise.resolve(),
    };
  }

  let lastDegradedLog = Number.NEGATIVE_INFINITY;
  const onDegraded = (event: { namespace: string; rule: string }): void => {
    const now = performance.now();
    if (now - lastDegradedLog >= DEGRADED_LOG_INTERVAL_MS) {
      lastDegradedLog = now;
      logger.warn({ ...event, code: "RATE_LIMIT_BACKEND_DEGRADED" }, "RATE_LIMIT_BACKEND_DEGRADED");
    }
  };
  const store = new RedisRateLimitStore({
    url: config.REDIS_URL,
    commandTimeoutMs: config.REDIS_COMMAND_TIMEOUT_MS,
    connectTimeoutMs: config.REDIS_CONNECT_TIMEOUT_MS,
    onError: (message) => {
      logger.warn({ message }, "Erro de ligação ao Redis dos limitadores");
    },
  });
  return {
    backend: "redis",
    createRateLimiter: (namespace) => new RedisRateLimiter({ store, namespace, clock, onDegraded, ...common }),
    ping: () => store.ping(),
    close: () => store.close(),
  };
}
