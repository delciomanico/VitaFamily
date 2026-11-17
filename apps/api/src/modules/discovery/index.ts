// Raiz do módulo `discovery` (MK2, ADR-037, modules.md nota 36(a)): descoberta, comparação e ranking de profissionais. Sem tabelas, sem jobs,
// sem auditoria. Nesta fatia (S3) só existe o domínio puro; os casos de uso, a porta `ProfessionalCatalog` e as rotas `/marketplace/*`
// chegam na S4. Nenhum módulo importa `discovery` (só `main/`).
export { RANKING_V1, rankProfessionals } from "./domain/ranking.js";
export type { RankingInput, RankingResult } from "./domain/ranking.js";
