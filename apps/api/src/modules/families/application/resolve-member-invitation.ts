// UC-MEM-03 (change control, decisão do proprietário — ver docs/03-use-cases/member.md): quando
// o registo (`POST /auth/register`) inclui um `invitationToken` que resolve para um convite tipo
// `MEMBER`, a conta é criada E o convite é aceite automaticamente no mesmo pedido, sem exigir um
// login + `POST /invitations/accept` manuais em separado. Chamado por `auth` (modules.md §3.7)
// dentro da MESMA transação de `register`, ANTES de criar o `User` — mesmo padrão de
// `resolve-dependent-account-invitation.ts`. Só lê (além da expiração lenta); a escrita (ligar a
// conta, marcar aceite) fica em `finalize-member-invitation.ts`, chamada depois do `User` existir.
import { DomainError } from "../../../platform/errors/index.js";
import { hasAccount } from "../domain/member.js";
import { hashOpaqueToken } from "../domain/token.js";
import { assertInvitationPending } from "./invitation-validation.js";
import type { FamiliesDeps } from "./ports.js";

export interface ResolvedMemberInvitation {
  invitationId: string;
  familyId: string;
  /** Presente quando o convite já estava ligado a um perfil sem conta (BR-MEM-13); ausente quando
   * o convite vai criar um `FamilyMember` novo (mesmo critério de `accept-invitation.ts`). */
  memberId?: string;
}

export function createResolveMemberInvitationUseCase<Trx>(deps: FamiliesDeps<Trx>) {
  return async function resolveMemberInvitation(
    trx: Trx,
    token: string,
    email: string,
  ): Promise<ResolvedMemberInvitation> {
    const invitation = await deps.invitationsRepo.findByTokenHash(trx, hashOpaqueToken(token));
    if (invitation?.type !== "MEMBER") {
      throw new DomainError("INVITATION_INVALID", { detail: "Convite inválido." });
    }

    const now = deps.clock.now();
    await assertInvitationPending(deps, trx, invitation, now);

    // AC-MEM-03/BR-MEM-12: e-mail da conta a criar tem de coincidir com o do convite.
    if (email.toLowerCase() !== invitation.email.toLowerCase()) {
      throw new DomainError("INVITATION_EMAIL_MISMATCH", { detail: "O e-mail não coincide com o convite." });
    }

    if (invitation.memberId) {
      const profile = await deps.membersRepo.findById(trx, invitation.familyId, invitation.memberId);
      if (!profile) {
        throw new DomainError("INVITATION_INVALID", { detail: "Convite inválido." });
      }
      if (hasAccount(profile)) {
        throw new DomainError("CONFLICT", { detail: "Esse perfil já tem conta." });
      }
    }

    return {
      invitationId: invitation.id,
      familyId: invitation.familyId,
      ...(invitation.memberId !== undefined ? { memberId: invitation.memberId } : {}),
    };
  };
}
