// UC-MKT-02: `POST /professional-portal/auth/login`. Erro genérico para credenciais inválidas (inclui e-mail inexistente, com o mesmo
// custo de argon2: sem enumeração por mensagem nem por tempo); `EMAIL_NOT_VERIFIED` só DEPOIS da palavra-passe certa; `SUSPENDED`/
// `REJECTED` (estado de validação) entram em só leitura (OP-59); nova cadeia de sessão por login. 5 falhas/15 min por (e-mail+IP), 20/15 min por IP.
import { DomainError } from "../../../platform/errors/index.js";
import { newId } from "../../../platform/ids/index.js";
import { auditContextFields } from "../../audit/index.js";
import { ProfessionalEmailNotVerifiedError, ProfessionalInvalidCredentialsError } from "../domain/errors.js";
import { signProfessionalAccessToken } from "../domain/jwt.js";
import { verifyAgainstDummy, verifyPassword } from "../domain/password.js";
import { generateOpaqueToken, hashOpaqueToken } from "../domain/token.js";
import type { ProfessionalsDeps, RequestContext } from "./ports.js";
import { normalizeEmail } from "./register.js";
import type { ProfessionalLoginResult } from "./session-result.js";

const FAILURE_RULE = { max: 5, windowMs: 15 * 60 * 1000 };
const IP_RULE = { max: 20, windowMs: 15 * 60 * 1000 };

export function createLoginUseCase<Trx>(deps: ProfessionalsDeps<Trx>) {
  return async function login(input: { email: string; password: string }, context: RequestContext): Promise<ProfessionalLoginResult> {
    const email = normalizeEmail(input.email);
    const ip = context.ip ?? "unknown";
    // Sujeitos com e-mail/IP em PII (HMAC no suporte). Todas as chamadas são FECHADAS (ADR-038 §5).
    const failureKey = { rule: "login-fail", subject: `${email}:${ip}`, pii: true };
    const ipKey = { rule: "login-ip", subject: ip, pii: true };

    const ipDecision = await deps.rateLimiter.consume(ipKey, IP_RULE);
    if (!ipDecision.allowed) {
      throw new DomainError("RATE_LIMITED", { retryAfterMs: ipDecision.retryAfterMs });
    }
    const failurePeek = await deps.rateLimiter.peek(failureKey, FAILURE_RULE);
    if (!failurePeek.allowed) {
      throw new DomainError("RATE_LIMITED", { retryAfterMs: failurePeek.retryAfterMs });
    }

    const now = deps.clock.now();

    async function fail(error: DomainError, accountId?: string): Promise<never> {
      await deps.rateLimiter.consume(failureKey, FAILURE_RULE);
      await deps.withTransaction(async (trx) => {
        await deps.audit.record(trx, {
          occurredAt: now,
          actorType: "PROFESSIONAL_ACCOUNT",
          ...(accountId !== undefined ? { actorProfessionalAccountId: accountId, resourceId: accountId } : {}),
          action: "PROFESSIONAL_LOGIN_FAILED",
          resourceType: "ProfessionalAccount",
          result: "FAILURE",
          requestId: context.requestId,
          ...auditContextFields(context),
        });
      });
      throw error;
    }

    const account = await deps.accountRepo.findByEmail(deps.db, email);
    if (!account) {
      await verifyAgainstDummy(input.password);
      return fail(new ProfessionalInvalidCredentialsError());
    }
    if (!(await verifyPassword(account.passwordHash, input.password))) {
      return fail(new ProfessionalInvalidCredentialsError(), account.id);
    }
    if (account.status !== "ACTIVE") {
      return fail(new ProfessionalEmailNotVerifiedError(), account.id);
    }
    const professional = await deps.accountRepo.findProfessionalByAccountId(deps.db, account.id);
    if (!professional) {
      return fail(new ProfessionalInvalidCredentialsError(), account.id);
    }

    // O `consume`/`peek` anteriores já passaram fechados; um `reset` que falhe (Redis) não deve impedir
    // um login legítimo: regista e segue (o contador expira sozinho pela janela).
    try {
      await deps.rateLimiter.reset(failureKey);
    } catch (error) {
      deps.logger.warn({ err: error, code: "RATE_LIMIT_RESET_FAILED" }, "Falha ao repor o contador de falhas de login");
    }

    const sessionId = newId();
    const refreshToken = generateOpaqueToken();
    const refreshExpiresAt = new Date(now.getTime() + deps.refreshTtlMs);
    await deps.withTransaction(async (trx) => {
      await deps.sessionRepo.insert(trx, {
        id: sessionId,
        accountId: account.id,
        refreshTokenHash: hashOpaqueToken(refreshToken),
        tokenChainId: newId(),
        expiresAt: refreshExpiresAt,
        createdAt: now,
        ...(context.ip !== undefined ? { ip: context.ip } : {}),
        ...(context.userAgent !== undefined ? { userAgent: context.userAgent } : {}),
      });
      await deps.accountRepo.touchLastLogin(trx, account.id, now);
      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "PROFESSIONAL_ACCOUNT",
        actorProfessionalAccountId: account.id,
        action: "PROFESSIONAL_LOGIN",
        resourceType: "ProfessionalAccount",
        resourceId: account.id,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });
    });

    const { token, expiresIn } = await signProfessionalAccessToken({
      subject: { professionalAccountId: account.id, professionalId: professional.id, sessionId },
      now,
      ttlSeconds: deps.accessTtlSeconds,
      signingKeys: deps.signingKeys,
    });
    return { accessToken: token, expiresIn, refreshToken, refreshExpiresAt, professionalId: professional.id, validationStatus: professional.validationStatus };
  };
}
