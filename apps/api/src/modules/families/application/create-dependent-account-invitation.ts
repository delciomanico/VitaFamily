// UC-MEM-05/P2/B3/N2: autorizar e convidar conta limitada para um dependente (ator: Tutor).
import { newId } from "../../../platform/ids/index.js";
import { DomainError, ForbiddenError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import { computeExpiresAt } from "../domain/invitation.js";
import { ageInYears, hasAccount, MIN_DEPENDENT_ACCOUNT_AGE } from "../domain/member.js";
import { generateOpaqueToken, hashOpaqueToken } from "../domain/token.js";
import type { FamiliesDeps, RequestContext } from "./ports.js";
import { requireMemberRecord, requireMembership } from "./membership.js";
import { toInvitationView, type InvitationView } from "./invitation-view.js";

export interface CreateDependentAccountInvitationInput {
  email: string;
}

export function createCreateDependentAccountInvitationUseCase<Trx>(deps: FamiliesDeps<Trx>) {
  return async function createDependentAccountInvitation(
    userId: string,
    familyId: string,
    memberId: string,
    input: CreateDependentAccountInvitationInput,
    context: RequestContext,
  ): Promise<InvitationView> {
    const email = input.email.trim().toLowerCase();

    return deps.withTransaction(async (trx) => {
      const actor = await requireMembership(deps, trx, familyId, userId);
      const target = await requireMemberRecord(deps, trx, familyId, memberId);

      const guardianship = await deps.guardianshipsRepo.find(trx, familyId, target.id, actor.id);
      if (!target.isDependent || !guardianship) {
        throw new ForbiddenError({ detail: "Requer ser tutor do dependente." });
      }
      if (hasAccount(target)) {
        throw new DomainError("CONFLICT", { detail: "O dependente já tem conta." });
      }

      const now = deps.clock.now();
      if (ageInYears(target.birthDate, now) < MIN_DEPENDENT_ACCOUNT_AGE) {
        throw new DomainError("DEPENDENT_ACCOUNT_AGE", {
          detail: `Conta de dependente exige ${String(MIN_DEPENDENT_ACCOUNT_AGE)} anos ou mais.`,
        });
      }

      const rawToken = generateOpaqueToken();
      const invitation = await deps.invitationsRepo.insert(trx, {
        id: newId(),
        familyId,
        email,
        type: "DEPENDENT_ACCOUNT",
        memberId: target.id,
        tokenHash: hashOpaqueToken(rawToken),
        expiresAt: computeExpiresAt(now),
        invitedBy: userId,
        createdAt: now,
      });

      await deps.mailer.send({
        to: email,
        subject: "Convite de conta na Vita Family",
        text: `Foi convidado a criar uma conta de acesso limitado na Vita Family. Use este código: ${rawToken} (válido 7 dias). Abra ${deps.appBaseUrl}/registo para continuar.`,
      });

      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "USER",
        actorUserId: userId,
        action: "DEPENDENT_ACCOUNT_INVITATION_CREATE",
        resourceType: "Invitation",
        resourceId: invitation.id,
        familyId,
        subjectMemberId: target.id,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });

      return toInvitationView(invitation);
    });
  };
}
