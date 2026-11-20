// UC-ACC-03: pede recuperação de palavra-passe. Resposta sempre idêntica, exista ou não a conta
// (authentication.md §2); token de uso único válido 1 h.
import { DomainError } from "../../../platform/errors/index.js";
import type { AuthDeps, RequestContext } from "./ports.js";
import { issuePasswordReset } from "./issue-recovery.js";

const PER_EMAIL_RULE = { max: 3, windowMs: 60 * 60 * 1000 };
const PER_IP_RULE = { max: 10, windowMs: 60 * 60 * 1000 };

export function createForgotPasswordUseCase<Trx>(deps: AuthDeps<Trx>) {
  return async function forgotPassword(email: string, context: RequestContext): Promise<void> {
    const normalizedEmail = email.trim().toLowerCase();

    const byEmail = await deps.rateLimiter.consume({ rule: "forgot-password-email", subject: normalizedEmail, pii: true }, PER_EMAIL_RULE);
    const byIp = await deps.rateLimiter.consume({ rule: "forgot-password-ip", subject: context.ip ?? "unknown", pii: true }, PER_IP_RULE);
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

      await issuePasswordReset(deps, trx, { id: user.id, email: normalizedEmail }, now);
    });
  };
}
