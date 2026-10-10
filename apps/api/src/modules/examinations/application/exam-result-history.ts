// openapi.yaml `examResultHistory`: "Autorização: READ(EXAMS). UC-EXM-04: devolve valores por
// data, sem gráficos nem interpretação." `parameter` é obrigatório na prática (sem ele não há o
// que agrupar) — VALIDATION_ERROR se ausente (errors.md lista VALIDATION_ERROR para esta rota).
import { ValidationError } from "../../../platform/errors/index.js";
import type { ActorIdentity, ExaminationsDeps, ExamResultHistoryItem, RequestContext } from "./ports.js";
import { auditViewIfNotSelf } from "./support.js";

export interface ExamResultHistoryQuery {
  parameter?: string;
}

export function createExamResultHistoryUseCase<Trx>(deps: ExaminationsDeps<Trx>) {
  return async function examResultHistory(actor: ActorIdentity, familyId: string, memberId: string, query: ExamResultHistoryQuery, context: RequestContext): Promise<ExamResultHistoryItem[]> {
    const parameter = query.parameter;
    if (!parameter || parameter.trim().length === 0) {
      throw new ValidationError([{ field: "parameter", message: "obrigatório" }], { detail: "Indique o parâmetro." });
    }

    return deps.withTransaction(async (trx) => {
      const ctx = await deps.policy.can(trx, {
        userId: actor.userId,
        platformAdmin: actor.platformAdmin,
        familyId,
        action: "READ",
        subjectMemberId: memberId,
        category: "EXAMS",
      });

      const history = await deps.examResultsRepo.historyByParameter(trx, familyId, memberId, parameter);
      await auditViewIfNotSelf(deps, trx, ctx, { userId: actor.userId, familyId, memberId, context });
      return history;
    });
  };
}
