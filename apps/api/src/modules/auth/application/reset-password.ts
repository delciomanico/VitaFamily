// UC-ACC-03 (continuação): define nova palavra-passe a partir do token de recuperação; revoga
// todas as sessões (authentication.md §2).
import { NotFoundError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import { assertPasswordPolicy, hashPassword } from "../domain/password.js";
import { hashOpaqueToken } from "../domain/token.js";
import type { AuthDeps, RequestContext } from "./ports.js";

export function createResetPasswordUseCase<Trx>(deps: AuthDeps<Trx>) {
  return async function resetPassword(
    token: string,
    newPassword: string,
    context: RequestContext,
  ): Promise<void> {
    assertPasswordPolicy(newPassword);

    const now = deps.clock.now();
    const tokenHash = hashOpaqueToken(token);

    await deps.withTransaction(async (trx) => {
      const authToken = await deps.authTokenRepo.findValidByHash(trx, "PASSWORD_RESET", tokenHash, now);
      if (!authToken) {
        throw new NotFoundError({ detail: "Token de recuperação inválido ou expirado." });
      }

      const passwordHash = await hashPassword(newPassword);
      await deps.authTokenRepo.markUsed(trx, authToken.id, now);
      await deps.usersPort.setPasswordHash(trx, authToken.userId, passwordHash);
      await deps.sessionRepo.revokeAllForUser(trx, authToken.userId, now);
      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "USER",
        actorUserId: authToken.userId,
        action: "AUTH_PASSWORD_RESET",
        resourceType: "User",
        resourceId: authToken.userId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });
    });
  };
}
