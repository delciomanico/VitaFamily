// UC-MEM-06: adicionar tutor a um dependente (FAM_ADMIN, ou o próprio se adulto com conta).
import { DomainError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import type { Guardianship } from "../domain/guardianship.js";
import type { FamiliesDeps, RequestContext } from "./ports.js";
import {
  assertCanManageGuardians,
  assertEligibleGuardian,
  requireMemberRecord,
  requireMembership,
} from "./membership.js";

export interface AddGuardianInput {
  guardianMemberId: string;
  isPrimary?: boolean | null;
}

export function createAddGuardianUseCase<Trx>(deps: FamiliesDeps<Trx>) {
  return async function addGuardian(
    userId: string,
    familyId: string,
    memberId: string,
    input: AddGuardianInput,
    context: RequestContext,
  ): Promise<Guardianship> {
    return deps.withTransaction(async (trx) => {
      const actor = await requireMembership(deps, trx, familyId, userId);
      const target = await requireMemberRecord(deps, trx, familyId, memberId);
      const now = deps.clock.now();
      assertCanManageGuardians(actor, target, now);

      const candidate = await deps.membersRepo.findById(trx, familyId, input.guardianMemberId);
      if (!candidate) {
        throw new DomainError("GUARDIAN_INVALID", { detail: "Tutor inválido." });
      }
      assertEligibleGuardian(candidate, target.id, now);

      const existing = await deps.guardianshipsRepo.find(trx, familyId, target.id, input.guardianMemberId);
      if (existing) {
        throw new DomainError("CONFLICT", { detail: "Já é tutor deste dependente." });
      }

      const currentGuardians = await deps.guardianshipsRepo.listByDependent(trx, familyId, target.id);
      const makePrimary = input.isPrimary === true || currentGuardians.length === 0;

      const guardianship = await deps.guardianshipsRepo.insert(trx, {
        familyId,
        dependentId: target.id,
        guardianId: input.guardianMemberId,
        isPrimary: makePrimary,
        createdAt: now,
      });
      if (makePrimary) {
        await deps.guardianshipsRepo.setPrimary(trx, familyId, target.id, input.guardianMemberId);
      }

      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "USER",
        actorUserId: userId,
        action: "GUARDIAN_ADD",
        resourceType: "Guardianship",
        familyId,
        subjectMemberId: target.id,
        result: "SUCCESS",
        requestId: context.requestId,
        metadata: { guardianId: input.guardianMemberId },
        ...auditContextFields(context),
      });

      return guardianship;
    });
  };
}
