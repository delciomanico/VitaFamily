// Raiz do módulo `consultations` (MK3, ADR-037, modules.md nota 37). Nesta fatia (S3) só existe o domínio puro; os casos de uso, as portas
// e as rotas chegam nas fatias S6..S10 (plan.md «MK3»). Nenhum módulo o importa (só `main/`).
export * from "./domain/index.js";
