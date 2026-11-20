// Reenvio do código de verificação: sempre neutro; invalida o anterior; só para contas `PENDING_VERIFICATION`. 3/h por e-mail, 10/h por IP.
import { DomainError } from "../../../platform/errors/index.js";
import { issueEmailVerification } from "./issue-code.js";
import type { ProfessionalsDeps, RequestContext } from "./ports.js";
import { normalizeEmail } from "./register.js";

const PER_EMAIL_RULE = { max: 3, windowMs: 60 * 60 * 1000 };
const PER_IP_RULE = { max: 10, windowMs: 60 * 60 * 1000 };

export function createResendVerificationUseCase<Trx>(deps: ProfessionalsDeps<Trx>) {
  return async function resendVerification(email: string, context: RequestContext): Promise<void> {
    const normalizedEmail = normalizeEmail(email);
    const byEmail = await deps.rateLimiter.consume({ rule: "resend-verification-email", subject: normalizedEmail, pii: true }, PER_EMAIL_RULE);
    const byIp = await deps.rateLimiter.consume({ rule: "resend-verification-ip", subject: context.ip ?? "unknown", pii: true }, PER_IP_RULE);
    if (!byEmail.allowed || !byIp.allowed) {
      throw new DomainError("RATE_LIMITED", { retryAfterMs: Math.max(byEmail.retryAfterMs, byIp.retryAfterMs) });
    }
    const now = deps.clock.now();
    await deps.withTransaction(async (trx) => {
      const account = await deps.accountRepo.findByEmail(trx, normalizedEmail);
      if (account?.status !== "PENDING_VERIFICATION") {
        return;
      }
      await issueEmailVerification(deps, trx, { id: account.id, email: normalizedEmail }, now);
    });
  };
}
