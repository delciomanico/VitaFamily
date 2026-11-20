// Limitador sem suporte configurado (composições sem HTTP: worker, scripts): todas as chamadas falham fechadas
// (ADR-038 §5). Nunca deixa passar nem inventa contadores locais.
import { RateLimiterUnavailableError, type RateLimiter } from "./port.js";

export class ClosedRateLimiter implements RateLimiter {
  consume(): Promise<never> {
    return Promise.reject(new RateLimiterUnavailableError());
  }
  peek(): Promise<never> {
    return Promise.reject(new RateLimiterUnavailableError());
  }
  reset(): Promise<never> {
    return Promise.reject(new RateLimiterUnavailableError());
  }
}
