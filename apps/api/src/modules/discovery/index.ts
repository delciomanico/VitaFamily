// Raiz do módulo `discovery` (MK2, ADR-037, modules.md nota 36(a)): descoberta, comparação e ranking de profissionais `APPROVED`. Sem
// tabelas, sem jobs, sem auditoria. Lê profissionais SÓ pela porta `ProfessionalCatalog` (ligada em `main/api.ts` à raiz
// `ProfessionalDirectory`); nenhum módulo importa `discovery` (só `main/`).
import type { Router } from "express";
import type { Clock } from "../../platform/clock/index.js";
import { InMemoryRateLimiter } from "../../platform/rate-limit/index.js";
import { createDiscoveryUseCases, type DiscoveryUseCases } from "./application/discovery.js";
import type { ProfessionalCatalog, ReviewStats } from "./application/ports.js";
import { createDiscoveryRouter } from "./interface/router.js";

export { RANKING_V2, rankProfessionals } from "./domain/ranking.js";
export type { RankingInput, RankingResult } from "./domain/ranking.js";
export { PUBLIC_DATA_ROUTES } from "./interface/public-data-routes.js";
export type { ProfessionalCatalog, ProfessionalCatalogQuery, ReviewAggregate, ReviewStats } from "./application/ports.js";

export interface DiscoveryModuleDeps {
  catalog: ProfessionalCatalog;
  clock: Clock;
  /** Opcional até à S10 (`consultations` implementa a porta). */
  reviewStats?: ReviewStats;
}

export interface DiscoveryModule {
  /** `/marketplace/*` (User autenticado; sem `AccessPolicy`). */
  router: Router;
  useCases: DiscoveryUseCases;
}

export function createDiscoveryModule(deps: DiscoveryModuleDeps): DiscoveryModule {
  const useCases = createDiscoveryUseCases({ catalog: deps.catalog, clock: deps.clock, ...(deps.reviewStats ? { reviewStats: deps.reviewStats } : {}) });
  return { router: createDiscoveryRouter({ useCases, rateLimiter: new InMemoryRateLimiter(deps.clock) }), useCases };
}
