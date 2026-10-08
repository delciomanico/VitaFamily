// UC-MEM-03 (pré-visualização): ver dados mínimos de um convite pelo token (PUBLIC). Token sempre
// no corpo do pedido, nunca no URL (evita ficar em logs de acesso). Expira por marca lenta (lazy):
// se o `expiresAt` já passou, marca `EXPIRED` aqui mesmo (o job `families.expire-invitations`,
// modules.md §5, cobre o resto, incluindo convites nunca consultados).
import { DomainError } from "../../../platform/errors/index.js";
import { isExpired } from "../domain/invitation.js";
import { hashOpaqueToken } from "../domain/token.js";
import type { FamiliesDeps, RequestContext } from "./ports.js";

export interface InvitationPreview {
  familyName: string;
  invitedEmail: string;
  type: "MEMBER" | "DEPENDENT_ACCOUNT";
  expiresAt: Date;
}

const LOOKUP_RATE_LIMIT = { max: 20, windowMs: 60 * 1000 };

export function createLookupInvitationUseCase<Trx>(deps: FamiliesDeps<Trx>) {
  return async function lookupInvitation(token: string, context: RequestContext): Promise<InvitationPreview> {
    const decision = deps.invitationRateLimiter.consume(`lookup:ip:${context.ip ?? "unknown"}`, LOOKUP_RATE_LIMIT);
    if (!decision.allowed) {
      throw new DomainError("RATE_LIMITED", { retryAfterMs: decision.retryAfterMs });
    }

    return deps.withTransaction(async (trx) => {
      const invitation = await deps.invitationsRepo.findByTokenHash(trx, hashOpaqueToken(token));
      if (!invitation) {
        throw new DomainError("INVITATION_INVALID", { detail: "Convite inválido." });
      }
      if (invitation.status === "PENDING" && isExpired(invitation, deps.clock.now())) {
        await deps.invitationsRepo.updateStatus(trx, invitation.id, "EXPIRED");
        throw new DomainError("INVITATION_EXPIRED", { detail: "Convite expirado." });
      }
      if (invitation.status === "EXPIRED") {
        throw new DomainError("INVITATION_EXPIRED", { detail: "Convite expirado." });
      }
      if (invitation.status !== "PENDING") {
        throw new DomainError("INVITATION_INVALID", { detail: "Convite inválido." });
      }

      const family = await deps.familiesRepo.findById(trx, invitation.familyId);
      if (!family) {
        throw new DomainError("INVITATION_INVALID", { detail: "Convite inválido." });
      }

      return {
        familyName: family.name,
        invitedEmail: invitation.email,
        type: invitation.type,
        expiresAt: invitation.expiresAt,
      };
    });
  };
}
