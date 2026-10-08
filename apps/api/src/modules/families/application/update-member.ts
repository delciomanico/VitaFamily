// UC-FAM/MEM: alterar nome ou data de nascimento (FAM_ADMIN, titular, ou tutor). Alterar a data de
// nascimento revalida menor ⇒ dependente (BR-MEM-03).
import { DomainError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import { assertValidBirthDate, isMinor } from "../domain/member.js";
import type { FamiliesDeps, RequestContext } from "./ports.js";
import { assertCanActOnMember, requireMemberRecord, requireMembership } from "./membership.js";
import { toMemberView, type MemberView } from "./member-view.js";

export interface UpdateMemberInput {
  name?: string;
  birthDate?: string;
}

export function createUpdateMemberUseCase<Trx>(deps: FamiliesDeps<Trx>) {
  return async function updateMember(
    userId: string,
    familyId: string,
    memberId: string,
    input: UpdateMemberInput,
    context: RequestContext,
  ): Promise<MemberView> {
    return deps.withTransaction(async (trx) => {
      const actor = await requireMembership(deps, trx, familyId, userId);
      const target = await requireMemberRecord(deps, trx, familyId, memberId);
      await assertCanActOnMember(deps, trx, actor, target);

      const now = deps.clock.now();
      const changes: { name?: string; birthDate?: string } = {};

      if (input.name !== undefined) {
        const name = input.name.trim();
        if (name.length === 0) {
          throw new DomainError("VALIDATION_ERROR", {
            detail: "Nome inválido.",
            fields: [{ field: "name", message: "não pode ser vazio" }],
          });
        }
        changes.name = name;
      }

      if (input.birthDate !== undefined) {
        assertValidBirthDate(input.birthDate, now);
        if (isMinor(input.birthDate, now) && !target.isDependent) {
          throw new DomainError("MINOR_MUST_BE_DEPENDENT", { detail: "Menor tem de ser dependente." });
        }
        changes.birthDate = input.birthDate;
      }

      const updated = await deps.membersRepo.update(trx, familyId, memberId, changes);

      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "USER",
        actorUserId: userId,
        action: "MEMBER_UPDATE",
        resourceType: "FamilyMember",
        resourceId: memberId,
        familyId,
        subjectMemberId: memberId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });

      const guardianships = updated.isDependent
        ? await deps.guardianshipsRepo.listByDependent(trx, familyId, memberId)
        : [];
      return toMemberView(updated, now, actor.id, guardianships);
    });
  };
}
