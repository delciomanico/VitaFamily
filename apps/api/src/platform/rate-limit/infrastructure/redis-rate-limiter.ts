import type { Clock } from "../../clock/index.js";
import { InMemoryRateLimitStore } from "../in-memory.js";
import { NamespacedRateLimiter, type RateLimitDegradedEvent } from "../limiter.js";
import { RedisRateLimitStore } from "./redis-store.js";

export interface RedisRateLimiterOptions {
  store: RedisRateLimitStore;
  namespace: string;
  prefix: string;
  secret: string;
  clock: Clock;
  onDegraded?: (event: RateLimitDegradedEvent) => void;
}

/** Limitador de um namespace sobre um `RedisRateLimitStore` partilhado (uma ligação por processo). */
export class RedisRateLimiter extends NamespacedRateLimiter {
  constructor(options: RedisRateLimiterOptions) {
    super({
      store: options.store,
      namespace: options.namespace,
      prefix: options.prefix,
      secret: options.secret,
      fallbackStore: new InMemoryRateLimitStore(options.clock),
      ...(options.onDegraded ? { onDegraded: options.onDegraded } : {}),
    });
  }
}
