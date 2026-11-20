// UC-MKT-01 (continuação): troca o código de 6 dígitos (24 h, uso único) por `PENDING_VERIFICATION → ACTIVE`. O código só tem 10^6
// valores: procura sempre restrita à conta do e-mail e com rate limit por e-mail e por IP (falha fechada), contra força bruta.
import { DomainError, NotFoundError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import { hashOpaqueToken } from "../domain/token.js";
import type { ProfessionalsDeps, RequestContext } from "./ports.js";
import { normalizeEmail } from "./register.js";

const PER_EMAIL_RULE = { max: 5, windowMs: 15 * 60 * 1000 };
const PER_IP_RULE = { max: 20, windowMs: 60 * 60 * 1000 };

export function createVerifyEmailUseCase<Trx>(deps: ProfessionalsDeps<Trx>) {
  return async function verifyEmail(email: string, code: string, context: RequestContext): Promise<void> {
    const normalizedEmail = normalizeEmail(email);
    const byEmail = await deps.rateLimiter.consume({ rule: "verify-email-email", subject: normalizedEmail, pii: true }, PER_EMAIL_RULE);
    const byIp = await deps.rateLimiter.consume({ rule: "verify-email-ip", subject: context.ip ?? "unknown", pii: true }, PER_IP_RULE);
    if (!byEmail.allowed || !byIp.allowed) {
      throw new DomainError("RATE_LIMITED", { retryAfterMs: Math.max(byEmail.retryAfterMs, byIp.retryAfterMs) });
    }
    const now = deps.clock.now();
    const tokenHash = hashOpaqueToken(code.trim());
    const invalid = () => new NotFoundError({ detail: "Código de verificação inválido ou expirado." });

    await deps.withTransaction(async (trx) => {
      const account = await deps.accountRepo.findByEmail(trx, normalizedEmail);
      if (account?.status !== "PENDING_VERIFICATION") {
        throw invalid();
      }
      const token = await deps.authTokenRepo.findValidForAccount(trx, account.id, "EMAIL_VERIFICATION", tokenHash, now);
      if (!token) {
        throw invalid();
      }
      await deps.authTokenRepo.markUsed(trx, token.id, now);
      await deps.accountRepo.markEmailVerified(trx, account.id, now);
      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "PROFESSIONAL_ACCOUNT",
        actorProfessionalAccountId: account.id,
        action: "PROFESSIONAL_EMAIL_VERIFIED",
        resourceType: "ProfessionalAccount",
        resourceId: account.id,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });
    });
  };
}
