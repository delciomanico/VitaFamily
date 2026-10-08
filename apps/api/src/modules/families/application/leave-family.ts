// UC-FAM-07/UC-MEM-09/R4/Q5/P8: sair da família (adulto com conta, não dependente — P2).
// `dataChoice=TAKE` depende da geração do pacote de exportação, que é do módulo `lifecycle`
// (M9, ainda não implementado) — stub explícito (SERVICE_UNAVAILABLE), mesmo critério de
// `modules/users/application/delete-me.ts`: não fingir um fluxo que não existe. `DELETE` não
// depende de M9 e está implementado por inteiro.
import { ForbiddenError, ServiceUnavailableError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import type { FamiliesDeps, RequestContext } from "./ports.js";
import { assertNotLastAdmin, assertNotLastGuardian, requireMembership } from "./membership.js";

export type DataChoice = "TAKE" | "DELETE";

export interface LeaveFamilyInput {
  dataChoice: DataChoice;
}

export interface LeaveFamilyResult {
  dataExportId: string | null;
}

export function createLeaveFamilyUseCase<Trx>(deps: FamiliesDeps<Trx>) {
  return async function leaveFamily(
    userId: string,
    familyId: string,
    input: LeaveFamilyInput,
    context: RequestContext,
  ): Promise<LeaveFamilyResult> {
    return deps.withTransaction(async (trx) => {
      const member = await requireMembership(deps, trx, familyId, userId);

      // P2: dependente com conta não sai sozinho (menor ou adulto dependente, N3) — age via tutor/Admin.
      if (member.isDependent) {
        throw new ForbiddenError({ detail: "Dependente não pode sair sozinho." });
      }
      if (member.role === "FAMILY_ADMIN") {
        await assertNotLastAdmin(deps, trx, familyId); // BR-FAM-05/Q5
      }
      await assertNotLastGuardian(deps, trx, familyId, member.id); // P8

      if (input.dataChoice === "TAKE") {
        throw new ServiceUnavailableError({
          detail: "Exportação de dados ainda não disponível (ver plan.md M9).",
        });
      }

      await deps.membersRepo.delete(trx, familyId, member.id);

      await deps.audit.record(trx, {
        occurredAt: deps.clock.now(),
        actorType: "USER",
        actorUserId: userId,
        action: "FAMILY_LEAVE",
        resourceType: "FamilyMember",
        resourceId: member.id,
        familyId,
        subjectMemberId: member.id,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });

      return { dataExportId: null };
    });
  };
}
