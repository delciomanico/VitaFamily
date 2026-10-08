// UC-MEM-01/MEM-02/MEM-05/MEM-06: criar perfil de membro sem conta (FAM_ADMIN). Q7: adulto sem
// conta é permitido sem tutor; menor tem de ser dependente (BR-MEM-03) e dependente exige ≥1 tutor.
import { newId } from "../../../platform/ids/index.js";
import { DomainError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import { assertValidBirthDate, isMinor, MAX_MEMBERS_PER_FAMILY } from "../domain/member.js";
import type { FamiliesDeps, RequestContext } from "./ports.js";
import { requireAdmin, requireMembership } from "./membership.js";
import { resolveGuardiansForDependent } from "./guardian-rules.js";
import { toMemberView, type MemberView } from "./member-view.js";

export interface CreateMemberInput {
  name: string;
  birthDate: string;
  isDependent: boolean;
  guardianMemberIds?: string[];
  primaryGuardianMemberId?: string | null;
}

export function createCreateMemberUseCase<Trx>(deps: FamiliesDeps<Trx>) {
  return async function createMember(
    userId: string,
    familyId: string,
    input: CreateMemberInput,
    context: RequestContext,
  ): Promise<MemberView> {
    const name = input.name.trim();
    if (name.length === 0) {
      throw new DomainError("VALIDATION_ERROR", {
        detail: "Nome inválido.",
        fields: [{ field: "name", message: "não pode ser vazio" }],
      });
    }

    return deps.withTransaction(async (trx) => {
      const actor = await requireMembership(deps, trx, familyId, userId);
      requireAdmin(actor);

      const now = deps.clock.now();
      assertValidBirthDate(input.birthDate, now);

      const minor = isMinor(input.birthDate, now);
      if (minor && !input.isDependent) {
        throw new DomainError("MINOR_MUST_BE_DEPENDENT", { detail: "Menor tem de ser dependente." });
      }

      const total = await deps.membersRepo.countByFamily(trx, familyId);
      if (total >= MAX_MEMBERS_PER_FAMILY) {
        throw new DomainError("LIMIT_EXCEEDED", { detail: "Limite de membros da família atingido." });
      }

      const memberId = newId();
      const member = await deps.membersRepo.insert(trx, {
        id: memberId,
        familyId,
        name,
        birthDate: input.birthDate,
        isDependent: input.isDependent,
        createdAt: now,
      });

      if (input.isDependent) {
        const resolved = await resolveGuardiansForDependent(
          deps,
          trx,
          familyId,
          memberId,
          input.guardianMemberIds,
          input.primaryGuardianMemberId,
          now,
        );
        for (const guardianId of resolved.guardianIds) {
          await deps.guardianshipsRepo.insert(trx, {
            familyId,
            dependentId: memberId,
            guardianId,
            isPrimary: guardianId === resolved.primaryGuardianId,
            createdAt: now,
          });
        }
      }

      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "USER",
        actorUserId: userId,
        action: "MEMBER_CREATE",
        resourceType: "FamilyMember",
        resourceId: memberId,
        familyId,
        subjectMemberId: memberId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });

      const guardianships = input.isDependent
        ? await deps.guardianshipsRepo.listByDependent(trx, familyId, memberId)
        : [];
      return toMemberView(member, now, actor.id, guardianships);
    });
  };
}
