// UC-FAM-07/UC-MEM-09/R4/Q5/P8: sair da família (adulto com conta, não dependente — P2).
// `dataChoice=TAKE`: o pacote de dados é gerado (por `lifecycle`, pela porta `memberData`) ANTES
// de os dados serem apagados; se a geração falhar, a saída é abortada e nada se perde.
import { ForbiddenError } from "../../../platform/errors/index.js";
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

      const dataExportId =
        input.dataChoice === "TAKE"
          ? await deps.memberData.exportBeforeRemoval({ userId, familyId, memberId: member.id, reason: "LEAVE_FAMILY", requestId: context.requestId })
          : null;

      // Ficheiros na outbox ANTES de apagar (schema.md §7): os documentos saem da BD por cascata.
      await deps.memberData.purgeMemberFiles(trx, familyId, member.id);
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

      return { dataExportId };
    });
  };
}
