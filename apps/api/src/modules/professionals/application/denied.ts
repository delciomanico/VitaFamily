// Auditoria das negações do profissional (authorization.md §10.1 passo 5): uma escrita recusada por `PROFESSIONAL_LOCKED` regista
// `ACCESS_DENIED` (result `DENIED`) numa transação À PARTE (a da operação foi revertida pelo erro). Sem motivo nem dados do pedido.
import { auditContextFields } from "../../audit/index.js";
import { ProfessionalLockedError } from "../domain/errors.js";
import type { ProfessionalsDeps, RequestContext } from "./ports.js";

export async function auditDeniedOnLock<Trx, T>(
  deps: ProfessionalsDeps<Trx>,
  actor: { professionalAccountId: string; professionalId: string },
  context: RequestContext,
  operation: string,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ProfessionalLockedError) {
      const now = deps.clock.now();
      await deps.withTransaction(async (trx) => {
        await deps.audit.record(trx, {
          occurredAt: now,
          actorType: "PROFESSIONAL_ACCOUNT",
          actorProfessionalAccountId: actor.professionalAccountId,
          action: "ACCESS_DENIED",
          resourceType: "Professional",
          resourceId: actor.professionalId,
          result: "DENIED",
          requestId: context.requestId,
          metadata: { operation },
          ...auditContextFields(context),
        });
      });
    }
    throw error;
  }
}
