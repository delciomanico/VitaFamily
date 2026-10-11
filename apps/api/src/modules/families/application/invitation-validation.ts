// Helper partilhado (BR-MEM-12/state-machines.md "Invitation"): garante que um convite já
// encontrado está `PENDING` e não expirado, marcando `EXPIRED` por marca lenta quando aplicável.
// Extraído de `accept-invitation.ts`/`resolve-dependent-account-invitation.ts`/
// `finalize-dependent-account-invitation.ts`/`lookup-invitation.ts` (todos repetiam exatamente a
// mesma regra) para não a duplicar outra vez em `resolve-member-invitation.ts`/
// `finalize-member-invitation.ts`.
import { DomainError } from "../../../platform/errors/index.js";
import { isExpired, type Invitation } from "../domain/invitation.js";
import type { FamiliesDeps } from "./ports.js";

export async function assertInvitationPending<Trx>(
  deps: Pick<FamiliesDeps<Trx>, "invitationsRepo">,
  trx: Trx,
  invitation: Invitation,
  now: Date,
): Promise<void> {
  if (invitation.status === "PENDING" && isExpired(invitation, now)) {
    await deps.invitationsRepo.updateStatus(trx, invitation.id, "EXPIRED");
    throw new DomainError("INVITATION_EXPIRED", { detail: "Convite expirado." });
  }
  if (invitation.status !== "PENDING") {
    throw new DomainError(invitation.status === "EXPIRED" ? "INVITATION_EXPIRED" : "INVITATION_INVALID", {
      detail: invitation.status === "EXPIRED" ? "Convite expirado." : "Convite inválido.",
    });
  }
}
