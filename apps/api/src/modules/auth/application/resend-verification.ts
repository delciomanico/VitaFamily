// UC-ACC-01 (alternativo): reenvia o e-mail de verificação. Sempre neutro (authentication.md §2);
// invalida o token anterior.
import { DomainError } from "../../../platform/errors/index.js";
import { newId } from "../../../platform/ids/index.js";
import { generateOpaqueToken, hashOpaqueToken } from "../domain/token.js";
import type { AuthDeps, RequestContext } from "./ports.js";

const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const PER_EMAIL_RULE = { max: 3, windowMs: 60 * 60 * 1000 };
const PER_IP_RULE = { max: 10, windowMs: 60 * 60 * 1000 };

export function createResendVerificationUseCase<Trx>(deps: AuthDeps<Trx>) {
  return async function resendVerification(email: string, context: RequestContext): Promise<void> {
    const normalizedEmail = email.trim().toLowerCase();

    const byEmail = deps.rateLimiter.consume(`resend-verification:email:${normalizedEmail}`, PER_EMAIL_RULE);
    const byIp = deps.rateLimiter.consume(`resend-verification:ip:${context.ip ?? "unknown"}`, PER_IP_RULE);
    if (!byEmail.allowed || !byIp.allowed) {
      throw new DomainError("RATE_LIMITED", {
        retryAfterMs: Math.max(byEmail.retryAfterMs, byIp.retryAfterMs),
      });
    }

    const now = deps.clock.now();
    await deps.withTransaction(async (trx) => {
      const user = await deps.usersPort.byEmail(trx, normalizedEmail);
      if (user?.status !== "PENDING_VERIFICATION") {
        // Resposta neutra: não revela se a conta existe nem o seu estado.
        return;
      }

      await deps.authTokenRepo.invalidateAllForUser(trx, user.id, "EMAIL_VERIFICATION", now);
      const rawToken = generateOpaqueToken();
      await deps.authTokenRepo.insert(trx, {
        id: newId(),
        userId: user.id,
        type: "EMAIL_VERIFICATION",
        tokenHash: hashOpaqueToken(rawToken),
        expiresAt: new Date(now.getTime() + EMAIL_VERIFICATION_TTL_MS),
        createdAt: now,
      });

      await deps.mailer.send({
        to: normalizedEmail,
        subject: "Verifique a sua conta Vita Family",
        text: `Para confirmar o seu e-mail, use este código: ${rawToken} (válido 24 horas).`,
      });
    });
  };
}
