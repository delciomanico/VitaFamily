// Valores dos limites de `clinic-patients` (ADR-038: o contador vive na porta `RateLimiter` de `platform`). Sem I/O.
import type { RateLimitRule } from "../../../platform/rate-limit/async.js";

/** BR-CLN-22: pesquisa/listagem — 60 pedidos/min por conta. */
export const SEARCH_ACCOUNT_RULE: RateLimitRule = { max: 60, windowMs: 60 * 1000 };
/** BR-CLN-29 (PROPOSTO): indicadores — 30 pedidos/min por conta. */
export const REPORT_ACCOUNT_RULE: RateLimitRule = { max: 30, windowMs: 60 * 1000 };
/** BR-CLN-20: partilhado com BR-CLN-10 (30/h por conta, 10 respostas 404/15 min, 60/h por IP); mesmas chaves do walk-in. */
export const LINK_ACCOUNT_RULE: RateLimitRule = { max: 30, windowMs: 60 * 60 * 1000 };
export const LINK_NOT_FOUND_RULE: RateLimitRule = { max: 10, windowMs: 15 * 60 * 1000 };
export const LINK_IP_RULE: RateLimitRule = { max: 60, windowMs: 60 * 60 * 1000 };
