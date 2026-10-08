// UC-ACC-01 (continuação): troca o token de verificação de e-mail (24 h, uso único) por
// PENDING_VERIFICATION -> ACTIVE (state-machines.md "User").
import { NotFoundError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import { hashOpaqueToken } from "../domain/token.js";
import type { AuthDeps, RequestContext } from "./ports.js";

export function createVerifyEmailUseCase<Trx>(deps: AuthDeps<Trx>) {
  return async function verifyEmail(token: string, context: RequestContext): Promise<void> {
    const now = deps.clock.now();
    const tokenHash = hashOpaqueToken(token);

    await deps.withTransaction(async (trx) => {
      const authToken = await deps.authTokenRepo.findValidByHash(
        trx,
        "EMAIL_VERIFICATION",
        tokenHash,
        now,
      );
      if (!authToken) {
        throw new NotFoundError({ detail: "Token de verificação inválido ou expirado." });
      }

      await deps.authTokenRepo.markUsed(trx, authToken.id, now);
      await deps.usersPort.setEmailVerified(trx, authToken.userId, now);
      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "USER",
        actorUserId: authToken.userId,
        action: "AUTH_EMAIL_VERIFIED",
        resourceType: "User",
        resourceId: authToken.userId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });
    });
  };
}
