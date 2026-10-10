// UC-ACC-01 (continuação): troca o código de verificação de e-mail (24 h, uso único, 6 dígitos —
// decisão do proprietário, apps/web VerifyPage) por PENDING_VERIFICATION -> ACTIVE
// (state-machines.md "User"). O código só tem 10^6 valores, por isso a procura é sempre
// restrita ao utilizador do `email` (`findValidForUser`), nunca global por hash.
import { NotFoundError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import { hashOpaqueToken } from "../domain/token.js";
import type { AuthDeps, RequestContext } from "./ports.js";

export function createVerifyEmailUseCase<Trx>(deps: AuthDeps<Trx>) {
  return async function verifyEmail(email: string, code: string, context: RequestContext): Promise<void> {
    const now = deps.clock.now();
    const normalizedEmail = email.trim().toLowerCase();
    const tokenHash = hashOpaqueToken(code);

    await deps.withTransaction(async (trx) => {
      const user = await deps.usersPort.byEmail(trx, normalizedEmail);
      if (!user) {
        throw new NotFoundError({ detail: "Código de verificação inválido ou expirado." });
      }

      const authToken = await deps.authTokenRepo.findValidForUser(
        trx,
        user.id,
        "EMAIL_VERIFICATION",
        tokenHash,
        now,
      );
      if (!authToken) {
        throw new NotFoundError({ detail: "Código de verificação inválido ou expirado." });
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
