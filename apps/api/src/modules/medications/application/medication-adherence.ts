// openapi.yaml `medicationAdherence`: "Autorização: READ(MEDICATION). UC-RPT-03: só contagens por
// estado, sem interpretação (BR-MED-07/BR-HLT-02/03: nunca interpretar clinicamente)."
import { ValidationError } from "../../../platform/errors/index.js";
import { auditViewIfNotSelf } from "./support.js";
import type { ActorIdentity, AdherenceItem, MedicationsDeps, RequestContext } from "./ports.js";

export interface MedicationAdherenceQuery {
  from?: string;
  to?: string;
}

const DEFAULT_WINDOW_DAYS = 30;

export function createMedicationAdherenceUseCase<Trx>(deps: MedicationsDeps<Trx>) {
  return async function medicationAdherence(
    actor: ActorIdentity,
    familyId: string,
    memberId: string,
    query: MedicationAdherenceQuery,
    context: RequestContext,
  ): Promise<AdherenceItem[]> {
    return deps.withTransaction(async (trx) => {
      const ctx = await deps.policy.can(trx, {
        userId: actor.userId,
        platformAdmin: actor.platformAdmin,
        familyId,
        action: "READ",
        subjectMemberId: memberId,
        category: "MEDICATION",
      });

      const now = deps.clock.now();
      const to = query.to ? new Date(`${query.to}T23:59:59.999Z`) : now;
      const from = query.from ? new Date(`${query.from}T00:00:00.000Z`) : new Date(to.getTime() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from.getTime() > to.getTime()) {
        throw new ValidationError([{ field: "from", message: "período inválido" }], { detail: "Período inválido." });
      }

      const items = await deps.dosesRepo.adherenceByMember(trx, familyId, memberId, from, to);
      await auditViewIfNotSelf(deps, trx, ctx, { userId: actor.userId, familyId, memberId, resourceType: "DoseOccurrence", context });
      return items;
    });
  };
}
