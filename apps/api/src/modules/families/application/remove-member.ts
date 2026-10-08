// UC-MEM-08/R4/BR-MEM-16: remover membro (FAM_ADMIN). Adulto com conta exige o pacote de dados de
// BR-MEM-16 antes de apagar — depende de `lifecycle` (M9, ainda não implementado); stub explícito
// (SERVICE_UNAVAILABLE), mesmo critério de `leave-family.ts`/`modules/users/application/delete-me.ts`.
// Perfil sem conta (dependente ou adulto) é removido de imediato (UC-MEM-08).
import { ServiceUnavailableError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import { hasAccount } from "../domain/member.js";
import type { FamiliesDeps, RequestContext } from "./ports.js";
import { assertNotLastAdmin, assertNotLastGuardian, requireAdmin, requireMemberRecord, requireMembership } from "./membership.js";
import type { LeaveFamilyResult } from "./leave-family.js";

export function createRemoveMemberUseCase<Trx>(deps: FamiliesDeps<Trx>) {
  return async function removeMember(
    userId: string,
    familyId: string,
    memberId: string,
    context: RequestContext,
  ): Promise<LeaveFamilyResult> {
    return deps.withTransaction(async (trx) => {
      const actor = await requireMembership(deps, trx, familyId, userId);
      requireAdmin(actor);
      const target = await requireMemberRecord(deps, trx, familyId, memberId);

      if (target.role === "FAMILY_ADMIN") {
        await assertNotLastAdmin(deps, trx, familyId);
      }
      await assertNotLastGuardian(deps, trx, familyId, target.id);

      if (hasAccount(target)) {
        throw new ServiceUnavailableError({
          detail: "Remoção de membro com conta ainda não disponível (ver plan.md M9, BR-MEM-16).",
        });
      }

      if (target.isDependent) {
        await deps.guardianshipsRepo.deleteAllForDependent(trx, familyId, target.id);
      }
      await deps.membersRepo.delete(trx, familyId, target.id);

      await deps.audit.record(trx, {
        occurredAt: deps.clock.now(),
        actorType: "USER",
        actorUserId: userId,
        action: "MEMBER_REMOVE",
        resourceType: "FamilyMember",
        resourceId: target.id,
        familyId,
        subjectMemberId: target.id,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });

      return { dataExportId: null };
    });
  };
}
