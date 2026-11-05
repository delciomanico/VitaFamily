// `GET /families/{f}/members/{m}/recommendations` (UC-REC-03, BR-CLN-09, authorization.md §3):
// a recomendação herda a categoria da origem — consulta ⇒ READ(APPOINTMENTS), exame ⇒ READ(EXAMS).
// "Listas filtram, não anulam": as categorias não permitidas são omitidas; só se nenhuma for
// permitida é que o pedido falha (FORBIDDEN, tal como `listExaminations`). Dependente com conta
// só lê as de consulta (N2) por efeito da matriz da `AccessPolicy` (EXAMS negado).
import { ForbiddenError } from "../../../platform/errors/index.js";
import { parsePageParams } from "../../../platform/page/index.js";
import { auditContextFields } from "../../audit/index.js";
import type { AccessContext } from "../../access/index.js";
import type { ActorIdentity, CursorPage, RecommendationsDeps, RequestContext } from "./ports.js";

export interface RecommendationView {
  id: string;
  memberId: string;
  appointmentId?: string;
  examinationId?: string;
  clinicName: string;
  text: string;
  createdAt: string;
}

export interface ListRecommendationsQuery {
  appointmentId?: string;
  examinationId?: string;
  limit?: string;
  cursor?: string;
}

export function createListRecommendationsUseCase<Trx>(deps: RecommendationsDeps<Trx>) {
  return async function listRecommendations(actor: ActorIdentity, familyId: string, memberId: string, query: ListRecommendationsQuery, context: RequestContext): Promise<CursorPage<RecommendationView>> {
    const { limit, cursor } = parsePageParams(query.limit, query.cursor);

    return deps.withTransaction(async (trx) => {
      const allowed: ("APPOINTMENTS" | "EXAMS")[] = [];
      let accessContext: AccessContext | undefined;
      let denied: ForbiddenError | undefined;
      for (const category of ["APPOINTMENTS", "EXAMS"] as const) {
        try {
          accessContext = await deps.policy.can(trx, { userId: actor.userId, platformAdmin: actor.platformAdmin, familyId, action: "READ", subjectMemberId: memberId, category });
          allowed.push(category);
        } catch (error) {
          // Só a negação por categoria filtra; NOT_FOUND/MEMBER_BLOCKED/platform admin propagam.
          if (error instanceof ForbiddenError && !actor.platformAdmin) {
            denied = error;
            continue;
          }
          throw error;
        }
      }
      if (allowed.length === 0 || !accessContext) {
        throw denied ?? new ForbiddenError({ detail: "Sem permissão sobre esta categoria." });
      }

      const page = await deps.recommendationsRepo.listByMember(
        trx,
        familyId,
        memberId,
        { categories: allowed, ...(query.appointmentId ? { appointmentId: query.appointmentId } : {}), ...(query.examinationId ? { examinationId: query.examinationId } : {}) },
        limit,
        cursor,
      );

      // audit.md §3: leitura por quem não é o titular é auditada (sem o texto).
      if (accessContext.relation !== "SELF") {
        await deps.audit.record(trx, {
          occurredAt: deps.clock.now(),
          actorType: "USER",
          actorUserId: actor.userId,
          action: "RECOMMENDATION_VIEW",
          resourceType: "Recommendation",
          resourceId: memberId,
          familyId,
          subjectMemberId: memberId,
          result: "SUCCESS",
          requestId: context.requestId,
          ...auditContextFields(context),
        });
      }

      return {
        items: page.items.map((item) => ({
          id: item.id,
          memberId: item.memberId,
          clinicName: item.clinicName,
          text: item.text,
          createdAt: item.createdAt.toISOString(),
          ...(item.appointmentId ? { appointmentId: item.appointmentId } : {}),
          ...(item.examinationId ? { examinationId: item.examinationId } : {}),
        })),
        nextCursor: page.nextCursor,
      };
    });
  };
}
