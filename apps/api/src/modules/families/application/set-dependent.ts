// UC-MEM-07/BR-MEM-04: marcar/desmarcar dependente. FAM_ADMIN para menor ou adulto sem conta;
// o próprio titular para adulto com conta (Q7: consentimento implícito ao agir sobre si mesmo).
import { DomainError, ForbiddenError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import { hasAccount, isMinor } from "../domain/member.js";
import type { FamiliesDeps, RequestContext } from "./ports.js";
import { requireAdmin, requireMemberRecord, requireMembership } from "./membership.js";
import { resolveGuardiansForDependent } from "./guardian-rules.js";
import { toMemberView, type MemberView } from "./member-view.js";

export interface SetDependentInput {
  isDependent: boolean;
  guardianMemberIds?: string[];
  primaryGuardianMemberId?: string | null;
}

export function createSetDependentUseCase<Trx>(deps: FamiliesDeps<Trx>) {
  return async function setDependent(
    userId: string,
    familyId: string,
    memberId: string,
    input: SetDependentInput,
    context: RequestContext,
  ): Promise<MemberView> {
    return deps.withTransaction(async (trx) => {
      const actor = await requireMembership(deps, trx, familyId, userId);
      const target = await requireMemberRecord(deps, trx, familyId, memberId);

      const now = deps.clock.now();
      const targetIsAdultWithAccount = !isMinor(target.birthDate, now) && hasAccount(target);

      if (targetIsAdultWithAccount) {
        if (actor.id !== target.id) {
          throw new ForbiddenError({ detail: "Só o próprio pode alterar o seu estado de dependente." });
        }
      } else {
        requireAdmin(actor);
      }

      if (isMinor(target.birthDate, now) && !input.isDependent) {
        throw new DomainError("MINOR_MUST_BE_DEPENDENT", { detail: "Menor tem de ser dependente." });
      }

      if (input.isDependent) {
        const wasDependent = target.isDependent;
        if (!wasDependent || input.guardianMemberIds !== undefined) {
          const resolved = await resolveGuardiansForDependent(
            deps,
            trx,
            familyId,
            target.id,
            input.guardianMemberIds,
            input.primaryGuardianMemberId,
            now,
          );
          await deps.guardianshipsRepo.deleteAllForDependent(trx, familyId, target.id);
          for (const guardianId of resolved.guardianIds) {
            await deps.guardianshipsRepo.insert(trx, {
              familyId,
              dependentId: target.id,
              guardianId,
              isPrimary: guardianId === resolved.primaryGuardianId,
              createdAt: now,
            });
          }
        }
      } else {
        await deps.guardianshipsRepo.deleteAllForDependent(trx, familyId, target.id);
      }

      const updated = await deps.membersRepo.update(trx, familyId, target.id, { isDependent: input.isDependent });

      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "USER",
        actorUserId: userId,
        action: "MEMBER_DEPENDENT_CHANGE",
        resourceType: "FamilyMember",
        resourceId: target.id,
        familyId,
        subjectMemberId: target.id,
        result: "SUCCESS",
        requestId: context.requestId,
        metadata: { isDependent: input.isDependent },
        ...auditContextFields(context),
      });

      const guardianships = input.isDependent
        ? await deps.guardianshipsRepo.listByDependent(trx, familyId, target.id)
        : [];
      return toMemberView(updated, now, actor.id, guardianships);
    });
  };
}
