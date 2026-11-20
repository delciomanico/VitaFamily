// UC-MKT-01: `POST /professional-portal/auth/register`. Resposta SEMPRE neutra (BR-MKT-14): e-mail já registado não cria nada nem envia
// código (audita-se como FAILURE interno). O hash da palavra-passe calcula-se antes de olhar para a BD para que o tempo de resposta não
// revele se o e-mail existe. A versão dos termos (OP-70, texto legal por fornecer) só se exige não vazia; guarda-se tal como veio.
import { DomainError, ValidationError } from "../../../platform/errors/index.js";
import { newId } from "../../../platform/ids/index.js";
import { auditContextFields } from "../../audit/index.js";
import { assertPasswordPolicy, hashPassword } from "../domain/password.js";
import { issueEmailVerification } from "./issue-code.js";
import type { ProfessionalsDeps, RequestContext } from "./ports.js";

export interface RegisterInput {
  email: string;
  password: string;
  termsVersion: string;
}

const REGISTER_RATE_LIMIT = { max: 5, windowMs: 5 * 60 * 1000 };
const MAX_EMAIL_LENGTH = 254;
const MAX_TERMS_VERSION_LENGTH = 50;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function createRegisterUseCase<Trx>(deps: ProfessionalsDeps<Trx>) {
  return async function register(input: RegisterInput, context: RequestContext): Promise<void> {
    const decision = await deps.rateLimiter.consume({ rule: "register-ip", subject: context.ip ?? "unknown", pii: true }, REGISTER_RATE_LIMIT);
    if (!decision.allowed) {
      throw new DomainError("RATE_LIMITED", { retryAfterMs: decision.retryAfterMs });
    }
    const email = normalizeEmail(input.email);
    if (email.length === 0 || email.length > MAX_EMAIL_LENGTH) {
      throw new ValidationError([{ field: "email", message: "e-mail inválido" }], { detail: "E-mail inválido." });
    }
    assertPasswordPolicy(input.password);
    const termsVersion = input.termsVersion.trim();
    if (termsVersion.length === 0 || termsVersion.length > MAX_TERMS_VERSION_LENGTH) {
      throw new ValidationError([{ field: "termsVersion", message: "versão dos termos inválida" }], { detail: "Versão dos termos inválida." });
    }

    const now = deps.clock.now();
    const passwordHash = await hashPassword(input.password);
    const accountId = newId();

    await deps.withTransaction(async (trx) => {
      const created = await deps.accountRepo.insertWithProfessional(trx, {
        id: accountId,
        professionalId: newId(),
        email,
        passwordHash,
        termsAcceptedVersion: termsVersion,
        createdAt: now,
      });
      if (!created) {
        const existing = await deps.accountRepo.findByEmail(trx, email);
        await deps.audit.record(trx, {
          occurredAt: now,
          actorType: "PROFESSIONAL_ACCOUNT",
          ...(existing ? { actorProfessionalAccountId: existing.id, resourceId: existing.id } : {}),
          action: "PROFESSIONAL_REGISTER",
          resourceType: "ProfessionalAccount",
          result: "FAILURE",
          requestId: context.requestId,
          ...auditContextFields(context),
        });
        return;
      }
      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "PROFESSIONAL_ACCOUNT",
        actorProfessionalAccountId: created.id,
        action: "PROFESSIONAL_REGISTER",
        resourceType: "ProfessionalAccount",
        resourceId: created.id,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });
      await issueEmailVerification(deps, trx, { id: created.id, email }, now);
    });
  };
}
