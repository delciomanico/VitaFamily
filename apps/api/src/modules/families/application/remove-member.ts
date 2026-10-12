// UC-MEM-08/R4/BR-MEM-16: remover membro (FAM_ADMIN). Membro com conta recebe o pacote de dados
// (gerado por `lifecycle` ANTES de apagar, pela porta `memberData`) e só depois é removido.
// Perfil sem conta (dependente ou adulto) é removido de imediato (UC-MEM-08).
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

      const dataExportId =
        hasAccount(target) && target.userId
          ? await deps.memberData.exportBeforeRemoval({
              userId: target.userId,
              familyId,
              memberId: target.id,
              reason: "REMOVED_BY_ADMIN",
              requestId: context.requestId,
            })
          : null;

      await deps.memberData.purgeMemberFiles(trx, familyId, target.id);
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

      return { dataExportId };
    });
  };
}
