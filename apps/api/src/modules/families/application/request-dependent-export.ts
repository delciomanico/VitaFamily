// UC-ACC-06/P2: exportar os dados de um dependente (ator: Tutor). A geração do pacote
// (DataExport) é do módulo `lifecycle` (M9, ainda não implementado) — stub explícito
// (SERVICE_UNAVAILABLE), mesmo critério de `leave-family.ts`/`remove-member.ts`. As verificações
// de pertença/tutela já implementadas aqui não são desperdiçadas: continuam válidas quando M9
// vier substituir só a geração do ficheiro.
import { ForbiddenError, ServiceUnavailableError } from "../../../platform/errors/index.js";
import type { FamiliesDeps } from "./ports.js";
import { requireMemberRecord, requireMembership } from "./membership.js";

export function createRequestDependentExportUseCase<Trx>(deps: FamiliesDeps<Trx>) {
  return async function requestDependentExport(userId: string, familyId: string, memberId: string): Promise<never> {
    return deps.withTransaction(async (trx) => {
      const actor = await requireMembership(deps, trx, familyId, userId);
      const target = await requireMemberRecord(deps, trx, familyId, memberId);

      const guardianship = await deps.guardianshipsRepo.find(trx, familyId, target.id, actor.id);
      if (!guardianship) {
        throw new ForbiddenError({ detail: "Requer ser tutor do dependente." });
      }

      throw new ServiceUnavailableError({
        detail: "Exportação de dados ainda não disponível (ver plan.md M9).",
      });
    });
  };
}
