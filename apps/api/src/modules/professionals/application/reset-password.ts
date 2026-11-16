// Nova palavra-passe com o código OTP (1 h, uso único); revoga TODAS as sessões da conta (BR-MKT-29). Procura restrita à conta do
// e-mail e com rate limit por e-mail e por IP (10^6 valores).
import { DomainError, NotFoundError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import { assertPasswordPolicy, hashPassword } from "../domain/password.js";
import { hashOpaqueToken } from "../domain/token.js";
import type { ProfessionalsDeps, RequestContext } from "./ports.js";
import { normalizeEmail } from "./register.js";

const PER_EMAIL_RULE = { max: 5, windowMs: 15 * 60 * 1000 };
const PER_IP_RULE = { max: 20, windowMs: 60 * 60 * 1000 };

export function createResetPasswordUseCase<Trx>(deps: ProfessionalsDeps<Trx>) {
  return async function resetPassword(email: string, code: string, newPassword: string, context: RequestContext): Promise<void> {
    const normalizedEmail = normalizeEmail(email);
    const byEmail = deps.rateLimiter.consume(`reset-password:email:${normalizedEmail}`, PER_EMAIL_RULE);
    const byIp = deps.rateLimiter.consume(`reset-password:ip:${context.ip ?? "unknown"}`, PER_IP_RULE);
    if (!byEmail.allowed || !byIp.allowed) {
      throw new DomainError("RATE_LIMITED", { retryAfterMs: Math.max(byEmail.retryAfterMs, byIp.retryAfterMs) });
    }
    assertPasswordPolicy(newPassword);
    const now = deps.clock.now();
    const tokenHash = hashOpaqueToken(code.trim());
    const passwordHash = await hashPassword(newPassword);

    await deps.withTransaction(async (trx) => {
      const invalid = () => new NotFoundError({ detail: "Código de recuperação inválido ou expirado." });
      const account = await deps.accountRepo.findByEmail(trx, normalizedEmail);
      if (!account) {
        throw invalid();
      }
      const token = await deps.authTokenRepo.findValidForAccount(trx, account.id, "PASSWORD_RESET", tokenHash, now);
      if (!token) {
        throw invalid();
      }
      await deps.authTokenRepo.markUsed(trx, token.id, now);
      await deps.accountRepo.setPasswordHash(trx, account.id, passwordHash, now);
      await deps.sessionRepo.revokeAllForAccount(trx, account.id, now);
      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "PROFESSIONAL_ACCOUNT",
        actorProfessionalAccountId: account.id,
        action: "PROFESSIONAL_PASSWORD_RESET",
        resourceType: "ProfessionalAccount",
        resourceId: account.id,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });
    });
  };
}
