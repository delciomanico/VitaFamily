// Raiz do módulo `reports` (ADR-015/conventions.md §1). M9 (plan.md §4): vistas calculadas
// (FR-RPT) sobre as leituras públicas dos módulos de saúde, respeitando sempre `AccessPolicy`
// (modules.md §2). Sem tabelas próprias.
import type { Router } from "express";
import type { Clock } from "../../platform/clock/index.js";
import type { RateLimiter } from "../../platform/rate-limit/async.js";
import { createFamilyReportUseCase } from "./application/family-report.js";
import { createMemberReportUseCase } from "./application/member-report.js";
import { createFamilyHealthSummaryUseCase, createMemberHealthSummaryUseCase } from "./application/health-summary.js";
import type { HealthSummarySources, ReportSources } from "./application/ports.js";
import { createReportsRouter, type ReportsController } from "./interface/router.js";

export type { AlertsSummary, HealthSummarySources, ReportSources } from "./application/ports.js";

export interface ReportsModuleDeps {
  sources: ReportSources;
  /** M17: portas extra do Resumo de saúde (alertas, escrita, fuso, auditoria). */
  summary: HealthSummarySources;
  /** M17 (BR-RPT-18): 30 pedidos/min por utilizador (porta `RateLimiter`, ADR-038). */
  rateLimiter: RateLimiter;
  clock: Clock;
}

export interface ReportsModule {
  router: Router;
  /** Leituras públicas para outros módulos (ligadas em `main/api.ts`): o Resumo de saúde do membro (M18 `ai-assistant` minimiza-o; mesma `AccessPolicy`, limite e auditoria). */
  reads: { memberHealthSummary: ReturnType<typeof createMemberHealthSummaryUseCase> };
}

/** Composition root chama isto uma vez por processo (main/api.ts). */
export function createReportsModule(deps: ReportsModuleDeps): ReportsModule {
  const memberHealthSummary = createMemberHealthSummaryUseCase(deps);
  const controller: ReportsController = {
    memberReport: createMemberReportUseCase(deps),
    familyReport: createFamilyReportUseCase(deps),
    memberHealthSummary,
    familyHealthSummary: createFamilyHealthSummaryUseCase(deps),
  };
  return { router: createReportsRouter(controller), reads: { memberHealthSummary } };
}
