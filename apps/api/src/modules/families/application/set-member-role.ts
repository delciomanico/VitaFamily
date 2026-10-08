// UC-FAM-04/FR-FAM-03: atribuir ou retirar o papel de Family Admin. Só adultos com conta podem
// ser Admin (M1); retirar o papel ao último Admin é recusado (BR-FAM-02).
import { DomainError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import { hasAccount, isMinor, type FamilyRole } from "../domain/member.js";
import type { FamiliesDeps, RequestContext } from "./ports.js";
import { assertNotLastAdmin, requireAdmin, requireMemberRecord, requireMembership } from "./membership.js";
import { toMemberView, type MemberView } from "./member-view.js";

export interface SetMemberRoleInput {
  role: FamilyRole;
}

export function createSetMemberRoleUseCase<Trx>(deps: FamiliesDeps<Trx>) {
  return async function setMemberRole(
    userId: string,
    familyId: string,
    memberId: string,
    input: SetMemberRoleInput,
    context: RequestContext,
  ): Promise<MemberView> {
    return deps.withTransaction(async (trx) => {
      const actor = await requireMembership(deps, trx, familyId, userId);
      requireAdmin(actor);
      const target = await requireMemberRecord(deps, trx, familyId, memberId);

      const now = deps.clock.now();
      if (!hasAccount(target) || isMinor(target.birthDate, now)) {
        throw new DomainError("VALIDATION_ERROR", {
          detail: "Só adultos com conta podem ter papel de família.",
          fields: [{ field: "role", message: "membro inválido para este papel" }],
        });
      }

      if (target.role === "FAMILY_ADMIN" && input.role !== "FAMILY_ADMIN") {
        await assertNotLastAdmin(deps, trx, familyId);
      }

      const updated = await deps.membersRepo.update(trx, familyId, memberId, { role: input.role });

      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "USER",
        actorUserId: userId,
        action: "MEMBER_ROLE_CHANGE",
        resourceType: "FamilyMember",
        resourceId: memberId,
        familyId,
        subjectMemberId: memberId,
        result: "SUCCESS",
        requestId: context.requestId,
        metadata: { newRole: input.role },
        ...auditContextFields(context),
      });

      return toMemberView(updated, now, actor.id, []);
    });
  };
}
