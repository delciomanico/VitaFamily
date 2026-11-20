// Adaptador de teste: o suporte falha sempre (simula o Redis em baixo).
import type { Clock } from "../clock/index.js";
import { InMemoryRateLimitStore } from "./in-memory.js";
import { NamespacedRateLimiter } from "./limiter.js";
import { RateLimitStoreError, type RateLimitDecision, type RateLimitStore } from "./port.js";

class FailingStore implements RateLimitStore {
  consume(): Promise<RateLimitDecision> {
    return Promise.reject(new RateLimitStoreError("falha simulada"));
  }
  peek(): Promise<RateLimitDecision> {
    return Promise.reject(new RateLimitStoreError("falha simulada"));
  }
}

export class FailingRateLimiter extends NamespacedRateLimiter {
  constructor(clock: Clock, namespace = "default") {
    super({
      store: new FailingStore(),
      namespace,
      prefix: "vita:test",
      secret: "failing-rate-limiter-secret-for-tests-only",
      fallbackStore: new InMemoryRateLimitStore(clock),
    });
  }
}
