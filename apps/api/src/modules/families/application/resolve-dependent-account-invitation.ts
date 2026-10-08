// UC-MEM-05/BR-MEM-12/13/17: resolve e valida um convite `DEPENDENT_ACCOUNT` pelo token. Chamado
// por `auth` (modules.md §3.7) dentro da MESMA transação de `POST /auth/register`, ANTES de criar
// o `User` — para o `User` nascer já com a data de nascimento do perfil (BR-MEM-17: "a data de
// nascimento do User é a do perfil"), em vez de a validar depois por correspondência. Só lê (além
// da expiração lenta, igual a `lookup-invitation.ts`); a escrita (ligar a conta, marcar aceite)
// fica em `finalize-dependent-account-invitation.ts`, chamada depois do `User` existir (FK
// `family_members.user_id → users`).
import { DomainError } from "../../../platform/errors/index.js";
import { isExpired } from "../domain/invitation.js";
import { hasAccount } from "../domain/member.js";
import { hashOpaqueToken } from "../domain/token.js";
import type { FamiliesDeps } from "./ports.js";

export interface ResolvedDependentAccountInvitation {
  invitationId: string;
  familyId: string;
  memberId: string;
  /** BR-MEM-17 — o `auth` usa este valor, não o submetido no registo. */
  birthDate: string;
}

export function createResolveDependentAccountInvitationUseCase<Trx>(deps: FamiliesDeps<Trx>) {
  return async function resolveDependentAccountInvitation(
    trx: Trx,
    token: string,
    email: string,
  ): Promise<ResolvedDependentAccountInvitation> {
    const invitation = await deps.invitationsRepo.findByTokenHash(trx, hashOpaqueToken(token));
    if (invitation?.type !== "DEPENDENT_ACCOUNT") {
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

    if (email.toLowerCase() !== invitation.email.toLowerCase()) {
      throw new DomainError("INVITATION_EMAIL_MISMATCH", { detail: "O e-mail não coincide com o convite." });
    }

    if (!invitation.memberId) {
      // create-dependent-account-invitation.ts sempre define `memberId` — defensivo.
      throw new DomainError("INVITATION_INVALID", { detail: "Convite inválido." });
    }
    const profile = await deps.membersRepo.findById(trx, invitation.familyId, invitation.memberId);
    if (!profile) {
      throw new DomainError("INVITATION_INVALID", { detail: "Convite inválido." });
    }
    if (hasAccount(profile)) {
      throw new DomainError("CONFLICT", { detail: "Esse perfil já tem conta." });
    }

    return {
      invitationId: invitation.id,
      familyId: invitation.familyId,
      memberId: profile.id,
      birthDate: profile.birthDate,
    };
  };
}
