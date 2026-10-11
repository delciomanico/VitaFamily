// UC-MEM-03 (change control — ver resolve-member-invitation.ts): liga o `User` — já criado por
// `auth/register.ts`, na MESMA transação — ao `FamilyMember` do convite `MEMBER` (perfil existente
// ou um novo) e marca o convite aceite. Reconfirma aqui o estado do convite e do perfil em vez de
// confiar só na resolução anterior (mesma razão de `finalize-dependent-account-invitation.ts`:
// cobrir uma escrita concorrente, ex. revogação, entre os dois passos). Mesmas regras de
// `accept-invitation.ts` (fluxo autenticado), reutilizadas aqui em vez de duplicadas.
import { newId } from "../../../platform/ids/index.js";
import { DomainError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import { hasAccount, MAX_MEMBERS_PER_FAMILY } from "../domain/member.js";
import { assertInvitationPending } from "./invitation-validation.js";
import type { FamiliesDeps, RequestContext } from "./ports.js";

export interface FinalizeMemberInvitationInput {
  invitationId: string;
  familyId: string;
  memberId?: string;
  userId: string;
  /** Nome/data de nascimento da conta recém-criada — usados só quando o convite cria um
   * `FamilyMember` novo (sem perfil prévio); quando `memberId` já existe, os dados do perfil
   * permanecem (BR-MEM-13) e `userBirthDate` só serve para confirmar a correspondência. */
  userName: string;
  userBirthDate: string;
}

export function createFinalizeMemberInvitationUseCase<Trx>(deps: FamiliesDeps<Trx>) {
  return async function finalizeMemberInvitation(
    trx: Trx,
    input: FinalizeMemberInvitationInput,
    context: RequestContext,
  ): Promise<void> {
    const invitation = await deps.invitationsRepo.findById(trx, input.familyId, input.invitationId);
    if (invitation?.type !== "MEMBER" || invitation.memberId !== input.memberId) {
      throw new DomainError("INVITATION_INVALID", { detail: "Convite inválido." });
    }

    const now = deps.clock.now();
    await assertInvitationPending(deps, trx, invitation, now);

    const alreadyMember = await deps.membersRepo.findByUserId(trx, input.familyId, input.userId);
    if (alreadyMember) {
      throw new DomainError("CONFLICT", { detail: "Já é membro desta família." });
    }

    const total = await deps.membersRepo.countByFamily(trx, input.familyId);
    if (total >= MAX_MEMBERS_PER_FAMILY) {
      throw new DomainError("LIMIT_EXCEEDED", { detail: "Limite de membros da família atingido." });
    }

    let member;
    if (invitation.memberId) {
      const profile = await deps.membersRepo.findById(trx, input.familyId, invitation.memberId);
      if (!profile) {
        throw new DomainError("INVITATION_INVALID", { detail: "Convite inválido." });
      }
      if (hasAccount(profile)) {
        throw new DomainError("CONFLICT", { detail: "Esse perfil já tem conta." });
      }
      if (profile.birthDate !== input.userBirthDate) {
        throw new DomainError("BIRTHDATE_MISMATCH", { detail: "Data de nascimento não coincide com o perfil." });
      }
      // BR-MEM-13: os dados do perfil (nome, saúde) permanecem — só liga a conta e o papel.
      member = await deps.membersRepo.update(trx, input.familyId, profile.id, {
        userId: input.userId,
        role: "FAMILY_MEMBER",
      });
    } else {
      member = await deps.membersRepo.insert(trx, {
        id: newId(),
        familyId: input.familyId,
        userId: input.userId,
        name: input.userName,
        birthDate: input.userBirthDate,
        role: "FAMILY_MEMBER",
        isDependent: false,
        createdAt: now,
      });
    }

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
