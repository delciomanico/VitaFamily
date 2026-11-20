// Barrel da porta assíncrona (ADR-038); `index.ts` reexporta-o. O limitador síncrono histórico foi removido (RL8).
export * from "./port.js";
export { createRateLimiting, type RateLimiting, type RateLimitingConfig } from "./factory.js";
export { ClosedRateLimiter } from "./closed.js";
