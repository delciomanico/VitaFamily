// Porta `RateLimiter` (assíncrona, ADR-038). Único ponto de entrada de `platform/rate-limit`; os adaptadores
// (`in-memory`, `failing`, `infrastructure/`) importam-se diretamente só em testes e na composição.
export * from "./async.js";
