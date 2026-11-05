// UC-ACC-01 (alternativo): reenvia o e-mail de verificação. Sempre neutro (authentication.md §2);
// invalida o token anterior.
import { DomainError } from "../../../platform/errors/index.js";
import type { AuthDeps, RequestContext } from "./ports.js";
import { issueEmailVerification } from "./issue-recovery.js";

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

      await issueEmailVerification(deps, trx, { id: user.id, email: normalizedEmail }, now);
    });
  };
}
