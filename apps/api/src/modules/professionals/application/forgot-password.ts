// Recuperação de palavra-passe (UC-MKT-02): resposta neutra, exista ou não a conta; código OTP de 1 h. 3/h por e-mail, 10/h por IP.
// Contas por verificar também podem recuperar (o código prova a posse do e-mail, mas NÃO ativa a conta: só `verify-email` o faz).
import { DomainError } from "../../../platform/errors/index.js";
import { issuePasswordReset } from "./issue-code.js";
import type { ProfessionalsDeps, RequestContext } from "./ports.js";
import { normalizeEmail } from "./register.js";

const PER_EMAIL_RULE = { max: 3, windowMs: 60 * 60 * 1000 };
const PER_IP_RULE = { max: 10, windowMs: 60 * 60 * 1000 };

export function createForgotPasswordUseCase<Trx>(deps: ProfessionalsDeps<Trx>) {
  return async function forgotPassword(email: string, context: RequestContext): Promise<void> {
    const normalizedEmail = normalizeEmail(email);
    const byEmail = await deps.rateLimiter.consume({ rule: "forgot-password-email", subject: normalizedEmail, pii: true }, PER_EMAIL_RULE);
    const byIp = await deps.rateLimiter.consume({ rule: "forgot-password-ip", subject: context.ip ?? "unknown", pii: true }, PER_IP_RULE);
    if (!byEmail.allowed || !byIp.allowed) {
      throw new DomainError("RATE_LIMITED", { retryAfterMs: Math.max(byEmail.retryAfterMs, byIp.retryAfterMs) });
    }
    const now = deps.clock.now();
    await deps.withTransaction(async (trx) => {
      const account = await deps.accountRepo.findByEmail(trx, normalizedEmail);
      if (!account) {
        return;
      }
      await issuePasswordReset(deps, trx, { id: account.id, email: normalizedEmail }, now);
    });
  };
}
