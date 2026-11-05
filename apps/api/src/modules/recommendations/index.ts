// Raiz do módulo `recommendations` (ADR-015/conventions.md §1; ADR-023, D19; plan.md M7c):
// Recommendation — nota clínica (texto) da clínica parceira sobre uma consulta ou um exame da própria
// clínica (BR-CLN-09). Depende de `access`, `appointments`, `examinations` e `audit` (modules.md §2);
// o alerta `recommendation.added` entra por uma porta ligada no composition root (`alerts` não é
// importado aqui — `alerts` é construído antes, sem ciclo).
import type { Router } from "express";
import type { Kysely } from "kysely";
import type { Clock } from "../../platform/clock/index.js";
import type { Database } from "../../platform/db/index.js";
import { withTransaction } from "../../platform/db/index.js";
import type { AccessModule } from "../access/index.js";
import type { AppointmentsModule } from "../appointments/index.js";
import type { AuditModule } from "../audit/index.js";
import type { ExaminationsModule } from "../examinations/index.js";
import { createCreateClinicRecommendationUseCase, createListClinicRecommendationsUseCase } from "./application/clinic-recommendations.js";
import { createListRecommendationsUseCase } from "./application/list-recommendations.js";
import type { RecommendationAlertsPort, RecommendationsDeps } from "./application/ports.js";
import { KyselyRecommendationsRepository } from "./infrastructure/repo.js";
import { createRecommendationsClinicPortalRouter } from "./interface/clinic-portal-router.js";
import { createRecommendationsRouter } from "./interface/router.js";

export type { Recommendation, RecommendationOriginKind } from "./domain/recommendation.js";

export interface RecommendationsModuleDeps {
  db: Kysely<Database>;
  audit: AuditModule;
  access: AccessModule;
  appointments: Pick<AppointmentsModule, "findClinicOrigin">;
  examinations: Pick<ExaminationsModule, "findClinicOrigin">;
  /** Ligado no composition root à API pública de `alerts` (`raiseRecommendationEvent`). */
  alerts: RecommendationAlertsPort<Kysely<Database>>;
  clock: Clock;
}

export interface RecommendationsModule {
  /** `GET /families/{f}/members/{m}/recommendations`. */
  router: Router;
  /** `/clinic-portal/recommendations` (ADR-020/023). */
  clinicPortalRouter: Router;
}

/** Composition root chama isto uma vez por processo (main/api.ts). */
export function createRecommendationsModule(deps: RecommendationsModuleDeps): RecommendationsModule {
  const recommendationsDeps: RecommendationsDeps<Kysely<Database>> = {
    recommendationsRepo: new KyselyRecommendationsRepository(),
    policy: deps.access.policy,
    memberNames: { getMemberName: deps.access.getMemberName },
    origins: {
      findAppointmentOfClinic: deps.appointments.findClinicOrigin,
      findExaminationOfClinic: deps.examinations.findClinicOrigin,
    },
    alerts: deps.alerts,
    audit: deps.audit,
    withTransaction: (fn) => withTransaction(deps.db, fn),
    clock: deps.clock,
  };

  return {
    router: createRecommendationsRouter({ listRecommendations: createListRecommendationsUseCase(recommendationsDeps) }),
    clinicPortalRouter: createRecommendationsClinicPortalRouter({
      createClinicRecommendation: createCreateClinicRecommendationUseCase(recommendationsDeps),
      listClinicRecommendations: createListClinicRecommendationsUseCase(recommendationsDeps),
    }),
  };
}
