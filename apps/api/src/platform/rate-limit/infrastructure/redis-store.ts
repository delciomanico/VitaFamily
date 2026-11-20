// Adaptador Redis (ioredis) — único sítio do código que importa o cliente (teste de arquitetura, ADR-038 §1).
// Janela deslizante exata num único script Lua (um round-trip, atómico, relógio `TIME` do Redis).
import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { CircuitBreaker } from "./circuit-breaker.js";
import { RateLimitStoreError, type RateLimitDecision, type RateLimitRule, type RateLimitStore } from "../port.js";

/**
 * KEYS[1] = chave; ARGV = max, windowMs, nonce, modo ("consume"|"peek").
 * Devolve {permitido(1/0), retryAfterMs}. Toda a chave com ZADD recebe PEXPIRE = janela (TTL).
 */
export const SLIDING_WINDOW_LUA = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local max = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
local count = redis.call('ZCARD', KEYS[1])
if count < max then
  if ARGV[4] == 'consume' then
    redis.call('ZADD', KEYS[1], now, now .. ':' .. ARGV[3])
    redis.call('PEXPIRE', KEYS[1], window)
  end
  return {1, 0}
end
local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
local retry = tonumber(oldest[2]) + window - now
if retry < 0 then retry = 0 end
return {0, retry}
`;

export interface RedisRateLimitStoreOptions {
  url: string;
  commandTimeoutMs: number;
  connectTimeoutMs: number;
  /** Notificação de erros de ligação (já sem credenciais). */
  onError?: (message: string) => void;
  nowMs?: () => number;
  breakerThreshold?: number;
  breakerOpenMs?: number;
}

type ScriptRunner = (key: string, max: number, windowMs: number, nonce: string, mode: string) => Promise<[number, number]>;

export class RedisRateLimitStore implements RateLimitStore {
  private readonly redis: Redis;
  private readonly run: ScriptRunner;
  private readonly breaker: CircuitBreaker;

  constructor(options: RedisRateLimitStoreOptions) {
    this.redis = new Redis(options.url, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
      commandTimeout: options.commandTimeoutMs,
      connectTimeout: options.connectTimeoutMs,
      retryStrategy: (times) => Math.min(times * 200, 2_000),
    });
    this.redis.on("error", (error: Error) => {
      options.onError?.(error.message.replaceAll(/redis(s)?:\/\/\S+/g, "redis://***"));
    });
    this.redis.defineCommand("vitaSlidingWindow", { numberOfKeys: 1, lua: SLIDING_WINDOW_LUA });
    this.run = (this.redis as unknown as { vitaSlidingWindow: ScriptRunner }).vitaSlidingWindow.bind(this.redis);
    this.breaker = new CircuitBreaker({
      threshold: options.breakerThreshold ?? 5,
      openMs: options.breakerOpenMs ?? 5_000,
      nowMs: options.nowMs ?? (() => performance.now()),
    });
    // Arranque tolerante: a API sobe e falha fechada até o Redis ligar (ADR-038 §8).
    this.redis.connect().catch(() => undefined);
  }

  consume(fullKey: string, rule: RateLimitRule): Promise<RateLimitDecision> {
    return this.execute(fullKey, rule, "consume");
  }

  peek(fullKey: string, rule: RateLimitRule): Promise<RateLimitDecision> {
    return this.execute(fullKey, rule, "peek");
  }

  async reset(fullKey: string): Promise<void> {
    if (!this.breaker.tryAcquire()) {
      throw new RateLimitStoreError("disjuntor aberto");
    }
    try {
      await this.redis.del(fullKey);
      this.breaker.onSuccess();
    } catch (error) {
      this.breaker.onFailure();
      throw new RateLimitStoreError("falha do suporte de contadores", { cause: error });
    }
  }

  /** `PING` com timeout próprio (readiness, ADR-038 §9). */
  async ping(timeoutMs = 1_000): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.redis.ping(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error("timeout"));
          }, timeoutMs);
        }),
      ]);
      return true;
    } catch {
      return false;
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  async close(): Promise<void> {
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }

  private async execute(fullKey: string, rule: RateLimitRule, mode: "consume" | "peek"): Promise<RateLimitDecision> {
    if (!this.breaker.tryAcquire()) {
      throw new RateLimitStoreError("disjuntor aberto");
    }
    try {
      const [allowed, retryAfterMs] = await this.run(fullKey, rule.max, rule.windowMs, randomUUID(), mode);
      this.breaker.onSuccess();
      return { allowed: allowed === 1, retryAfterMs };
    } catch (error) {
      this.breaker.onFailure();
      throw new RateLimitStoreError("falha do suporte de contadores", { cause: error });
    }
  }
}
