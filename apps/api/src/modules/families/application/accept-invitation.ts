// UC-MEM-03/BR-MEM-12/13/17: aceitar convite (AUTH — utilizador já autenticado). Convites
// `DEPENDENT_ACCOUNT` destinam-se a quem ainda não tem conta (passam por `/auth/register`, que
// valida o token nesse fluxo); aqui só se aceitam convites `MEMBER`.
import { newId } from "../../../platform/ids/index.js";
import { DomainError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import { isExpired } from "../domain/invitation.js";
import { hasAccount, MAX_MEMBERS_PER_FAMILY } from "../domain/member.js";
import { hashOpaqueToken } from "../domain/token.js";
import type { FamiliesDeps, RequestContext } from "./ports.js";
import { toMemberView, type MemberView } from "./member-view.js";

export function createAcceptInvitationUseCase<Trx>(deps: FamiliesDeps<Trx>) {
  return async function acceptInvitation(userId: string, token: string, context: RequestContext): Promise<MemberView> {
    return deps.withTransaction(async (trx) => {
      const invitation = await deps.invitationsRepo.findByTokenHash(trx, hashOpaqueToken(token));
      if (invitation?.type !== "MEMBER") {
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

      const user = await deps.usersPort.byId(trx, userId);
      if (!user) {
        throw new DomainError("NOT_FOUND", { detail: "Utilizador não encontrado." });
      }
      if (user.email.toLowerCase() !== invitation.email.toLowerCase()) {
        throw new DomainError("INVITATION_EMAIL_MISMATCH", { detail: "O e-mail não coincide com o convite." });
      }

      const alreadyMember = await deps.membersRepo.findByUserId(trx, invitation.familyId, userId);
      if (alreadyMember) {
        throw new DomainError("CONFLICT", { detail: "Já é membro desta família." });
      }

      const total = await deps.membersRepo.countByFamily(trx, invitation.familyId);
      if (total >= MAX_MEMBERS_PER_FAMILY) {
        throw new DomainError("LIMIT_EXCEEDED", { detail: "Limite de membros da família atingido." });
      }

      let member;
      if (invitation.memberId) {
        const profile = await deps.membersRepo.findById(trx, invitation.familyId, invitation.memberId);
        if (!profile) {
          throw new DomainError("INVITATION_INVALID", { detail: "Convite inválido." });
        }
        if (hasAccount(profile)) {
          throw new DomainError("CONFLICT", { detail: "Esse perfil já tem conta." });
        }
        if (profile.birthDate !== user.birthDate) {
          throw new DomainError("BIRTHDATE_MISMATCH", { detail: "Data de nascimento não coincide com o perfil." });
        }
        // BR-MEM-13: os dados do perfil (nome, saúde) permanecem — só liga a conta e o papel.
        member = await deps.membersRepo.update(trx, invitation.familyId, profile.id, {
          userId,
          role: "FAMILY_MEMBER",
        });
      } else {
        member = await deps.membersRepo.insert(trx, {
          id: newId(),
          familyId: invitation.familyId,
          userId,
          name: user.name,
          birthDate: user.birthDate,
          role: "FAMILY_MEMBER",
          isDependent: false,
          createdAt: now,
        });
      }

      await deps.invitationsRepo.markAccepted(trx, invitation.id, userId, now);

      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "USER",
        actorUserId: userId,
        action: "INVITATION_ACCEPT",
        resourceType: "Invitation",
        resourceId: invitation.id,
        familyId: invitation.familyId,
        subjectMemberId: member.id,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });

      const guardianships = member.isDependent
        ? await deps.guardianshipsRepo.listByDependent(trx, invitation.familyId, member.id)
        : [];
      return toMemberView(member, now, member.id, guardianships);
    });
  };
}
