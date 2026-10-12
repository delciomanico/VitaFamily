// Raiz do módulo `reports` (ADR-015/conventions.md §1). M9 (plan.md §4): vistas calculadas
// (FR-RPT) sobre as leituras públicas dos módulos de saúde, respeitando sempre `AccessPolicy`
// (modules.md §2). Sem tabelas próprias.
import type { Router } from "express";
import type { Clock } from "../../platform/clock/index.js";
import { createFamilyReportUseCase } from "./application/family-report.js";
import { createMemberReportUseCase } from "./application/member-report.js";
import type { ReportSources } from "./application/ports.js";
import { createReportsRouter, type ReportsController } from "./interface/router.js";

export type { ReportSources } from "./application/ports.js";

export interface ReportsModuleDeps {
  sources: ReportSources;
  clock: Clock;
}

export interface ReportsModule {
  router: Router;
}

/** Composition root chama isto uma vez por processo (main/api.ts). */
export function createReportsModule(deps: ReportsModuleDeps): ReportsModule {
  const controller: ReportsController = {
    memberReport: createMemberReportUseCase(deps),
    familyReport: createFamilyReportUseCase(deps),
  };
  return { router: createReportsRouter(controller) };
}
