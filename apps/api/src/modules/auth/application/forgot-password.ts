// UC-ACC-03: pede recuperação de palavra-passe. Resposta sempre idêntica, exista ou não a conta
// (authentication.md §2); token de uso único válido 1 h.
import { DomainError } from "../../../platform/errors/index.js";
import { newId } from "../../../platform/ids/index.js";
import { generateOpaqueToken, hashOpaqueToken } from "../domain/token.js";
import type { AuthDeps, RequestContext } from "./ports.js";

const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
const PER_EMAIL_RULE = { max: 3, windowMs: 60 * 60 * 1000 };
const PER_IP_RULE = { max: 10, windowMs: 60 * 60 * 1000 };

export function createForgotPasswordUseCase<Trx>(deps: AuthDeps<Trx>) {
  return async function forgotPassword(email: string, context: RequestContext): Promise<void> {
    const normalizedEmail = email.trim().toLowerCase();

    const byEmail = deps.rateLimiter.consume(`forgot-password:email:${normalizedEmail}`, PER_EMAIL_RULE);
    const byIp = deps.rateLimiter.consume(`forgot-password:ip:${context.ip ?? "unknown"}`, PER_IP_RULE);
    if (!byEmail.allowed || !byIp.allowed) {
      throw new DomainError("RATE_LIMITED", {
        retryAfterMs: Math.max(byEmail.retryAfterMs, byIp.retryAfterMs),
      });
    }

    const now = deps.clock.now();
    await deps.withTransaction(async (trx) => {
      const user = await deps.usersPort.byEmail(trx, normalizedEmail);
      if (!user) {
        return;
      }

      await deps.authTokenRepo.invalidateAllForUser(trx, user.id, "PASSWORD_RESET", now);
      const rawToken = generateOpaqueToken();
      await deps.authTokenRepo.insert(trx, {
        id: newId(),
        userId: user.id,
        type: "PASSWORD_RESET",
        tokenHash: hashOpaqueToken(rawToken),
        expiresAt: new Date(now.getTime() + PASSWORD_RESET_TTL_MS),
        createdAt: now,
      });

      await deps.mailer.send({
        to: normalizedEmail,
        subject: "Recuperação de palavra-passe — Vita Family",
        text: `Para definir uma nova palavra-passe, use este código: ${rawToken} (válido 1 hora). Se não pediu esta recuperação, ignore este e-mail.`,
      });
    });
  };
}
