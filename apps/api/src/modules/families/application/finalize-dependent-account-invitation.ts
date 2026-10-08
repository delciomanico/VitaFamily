// UC-MEM-05/BR-MEM-12/13: liga o `User` — já criado por `auth/register.ts`, na MESMA transação —
// ao `FamilyMember` do convite e marca o convite aceite. Chamada depois de
// `resolve-dependent-account-invitation.ts` (que forneceu a data de nascimento do perfil para a
// criação do `User`); reconfirma aqui o estado do convite e do perfil em vez de confiar só na
// resolução anterior, para cobrir uma escrita concorrente (ex.: revogação do convite) entre os dois
// passos — ambos correm na mesma transação de `register`, mas sem lock explícito entre eles.
import { DomainError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import { isExpired } from "../domain/invitation.js";
import { hasAccount } from "../domain/member.js";
import type { FamiliesDeps, RequestContext } from "./ports.js";

export interface FinalizeDependentAccountInvitationInput {
  invitationId: string;
  familyId: string;
  memberId: string;
  userId: string;
}

export function createFinalizeDependentAccountInvitationUseCase<Trx>(deps: FamiliesDeps<Trx>) {
  return async function finalizeDependentAccountInvitation(
    trx: Trx,
    input: FinalizeDependentAccountInvitationInput,
    context: RequestContext,
  ): Promise<void> {
    const invitation = await deps.invitationsRepo.findById(trx, input.familyId, input.invitationId);
    if (invitation?.type !== "DEPENDENT_ACCOUNT" || invitation.memberId !== input.memberId) {
      throw new DomainError("INVITATION_INVALID", { detail: "Convite inválido." });
    }

    const now = deps.clock.now();
    if (invitation.status === "PENDING" && isExpired(invitation, now)) {
      await deps.invitationsRepo.updateStatus(trx, invitation.id, "EXPIRED");
      throw new DomainError("INVITATION_EXPIRED", { detail: "Convite expirado." });
    }
    if (invitation.status !== "PENDING") {
      throw new DomainError(
        invitation.status === "EXPIRED" ? "INVITATION_EXPIRED" : "INVITATION_INVALID",
        { detail: invitation.status === "EXPIRED" ? "Convite expirado." : "Convite inválido." },
      );
    }

    const profile = await deps.membersRepo.findById(trx, input.familyId, input.memberId);
    if (!profile) {
      throw new DomainError("INVITATION_INVALID", { detail: "Convite inválido." });
    }
    if (hasAccount(profile)) {
      throw new DomainError("CONFLICT", { detail: "Esse perfil já tem conta." });
    }

    // BR-MEM-13: os dados do perfil (nome, saúde) permanecem — só liga a conta. Sem `role`
    // estrutural: schema.md permite `role IS NULL` com `user_id` presente; o dependente com conta
    // tem acesso limitado por `DEPENDENT_SELF` (authorization.md §3), não por um papel de família.
    const member = await deps.membersRepo.update(trx, input.familyId, input.memberId, {
      userId: input.userId,
    });

    await deps.invitationsRepo.markAccepted(trx, invitation.id, input.userId, now);

    await deps.audit.record(trx, {
      occurredAt: now,
      actorType: "USER",
      actorUserId: input.userId,
      action: "INVITATION_ACCEPT",
      resourceType: "Invitation",
      resourceId: invitation.id,
      familyId: input.familyId,
      subjectMemberId: member.id,
      result: "SUCCESS",
      requestId: context.requestId,
      ...auditContextFields(context),
    });
  };
}
