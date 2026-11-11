// UC-ACC-03 (continuação): define nova palavra-passe a partir do código OTP de recuperação
// (6 dígitos, 1 h, uso único); revoga todas as sessões (authentication.md §2). O código só tem
// 10^6 valores: a procura é restrita ao utilizador do `email` e as tentativas têm rate limit
// por e-mail e por IP.
import { DomainError, NotFoundError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import { assertPasswordPolicy, hashPassword } from "../domain/password.js";
import { hashOpaqueToken } from "../domain/token.js";
import type { AuthDeps, RequestContext } from "./ports.js";

const PER_EMAIL_RULE = { max: 5, windowMs: 15 * 60 * 1000 };
const PER_IP_RULE = { max: 20, windowMs: 60 * 60 * 1000 };

export function createResetPasswordUseCase<Trx>(deps: AuthDeps<Trx>) {
  return async function resetPassword(
    email: string,
    code: string,
    newPassword: string,
    context: RequestContext,
  ): Promise<void> {
    const normalizedEmail = email.trim().toLowerCase();

    const byEmail = deps.rateLimiter.consume(`reset-password:email:${normalizedEmail}`, PER_EMAIL_RULE);
    const byIp = deps.rateLimiter.consume(`reset-password:ip:${context.ip ?? "unknown"}`, PER_IP_RULE);
    if (!byEmail.allowed || !byIp.allowed) {
      throw new DomainError("RATE_LIMITED", {
        retryAfterMs: Math.max(byEmail.retryAfterMs, byIp.retryAfterMs),
      });
    }

    assertPasswordPolicy(newPassword);

    const now = deps.clock.now();
    const tokenHash = hashOpaqueToken(code.trim());

    await deps.withTransaction(async (trx) => {
      const invalid = () => new NotFoundError({ detail: "Código de recuperação inválido ou expirado." });
      const user = await deps.usersPort.byEmail(trx, normalizedEmail);
      if (!user) {
        throw invalid();
      }
      const authToken = await deps.authTokenRepo.findValidForUser(trx, user.id, "PASSWORD_RESET", tokenHash, now);
      if (!authToken) {
        throw invalid();
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
