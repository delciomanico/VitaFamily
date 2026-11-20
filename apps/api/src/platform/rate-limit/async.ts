// Barrel da porta assíncrona (ADR-038). Convive com `index.ts` (limitador síncrono histórico) até RL3..RL7;
// em RL8 `index.ts` passa a reexportar isto e o síncrono é removido.
export * from "./port.js";
export { createRateLimiting, type RateLimiting, type RateLimitingConfig } from "./factory.js";
