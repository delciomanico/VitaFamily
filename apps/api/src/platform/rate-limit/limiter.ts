// Núcleo comum dos adaptadores: namespace fixo, construção da chave, política de falha (`FailMode`) e fallback local.
import { buildRateLimitKey, assertNamespace } from "./keys.js";
import {
  FailMode,
  RateLimiterUnavailableError,
  RateLimitStoreError,
  type RateLimitCallOptions,
  type RateLimitDecision,
  type RateLimiter,
  type RateLimitKey,
  type RateLimitRule,
  type RateLimitStore,
} from "./port.js";

export interface RateLimitDegradedEvent {
  namespace: string;
  rule: string;
}

export interface NamespacedRateLimiterOptions {
  store: RateLimitStore;
  namespace: string;
  prefix: string;
  secret: string;
  /** Suporte local por processo, só usado com `FailMode.LOCAL_FALLBACK`. */
  fallbackStore: RateLimitStore;
  /** Chamado (já limitado a 1 por 5 s) quando se degrada para o suporte local (`RATE_LIMIT_BACKEND_DEGRADED`). */
  onDegraded?: (event: RateLimitDegradedEvent) => void;
}

export class NamespacedRateLimiter implements RateLimiter {
  constructor(private readonly options: NamespacedRateLimiterOptions) {
    assertNamespace(options.namespace);
  }

  consume(key: RateLimitKey, rule: RateLimitRule, options?: RateLimitCallOptions): Promise<RateLimitDecision> {
    return this.run(key, options, (store, fullKey) => store.consume(fullKey, rule));
  }

  peek(key: RateLimitKey, rule: RateLimitRule, options?: RateLimitCallOptions): Promise<RateLimitDecision> {
    return this.run(key, options, (store, fullKey) => store.peek(fullKey, rule));
  }

  private async run(
    key: RateLimitKey,
    options: RateLimitCallOptions | undefined,
    op: (store: RateLimitStore, fullKey: string) => Promise<RateLimitDecision>,
  ): Promise<RateLimitDecision> {
    const fullKey = buildRateLimitKey(this.options, key);
    try {
      return await op(this.options.store, fullKey);
    } catch (error) {
      if (!(error instanceof RateLimitStoreError)) {
        throw error;
      }
      if ((options?.failMode ?? FailMode.CLOSED) === FailMode.LOCAL_FALLBACK) {
        this.options.onDegraded?.({ namespace: this.options.namespace, rule: key.rule });
        return op(this.options.fallbackStore, fullKey);
      }
      throw new RateLimiterUnavailableError({ cause: error });
    }
  }
}
