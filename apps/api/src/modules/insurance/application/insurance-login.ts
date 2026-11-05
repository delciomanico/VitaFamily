// `POST /insurance-portal/auth/login` (openapi insuranceLogin, ADR-021): erro genérico para
// credenciais inválidas; conta ou seguradora SUSPENDED recusada (BR-INS-10); nova cadeia de sessão
// por login; audita sucesso e falha. Mirror de `clinic-login.ts`.
import { DomainError } from "../../../platform/errors/index.js";
import { newId } from "../../../platform/ids/index.js";
import { auditContextFields } from "../../audit/index.js";
import { InsuranceAccountSuspendedError, InsuranceInvalidCredentialsError } from "../domain/insurance-account.js";
import { generateInsuranceOpaqueToken, hashInsuranceOpaqueToken, verifyInsurancePassword } from "../domain/insurance-crypto.js";
import { signInsuranceAccessToken } from "../domain/insurance-jwt.js";
import type { InsuranceAccountRole, InsuranceDeps, RequestContext } from "./ports.js";

export interface InsuranceLoginInput {
  email: string;
  password: string;
}

export interface InsuranceLoginResult {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
  insurerId: string;
  role: InsuranceAccountRole;
}

const FAILURE_RULE = { max: 5, windowMs: 15 * 60 * 1000 };
const IP_RULE = { max: 20, windowMs: 15 * 60 * 1000 };

export function createInsuranceLoginUseCase<Trx>(deps: InsuranceDeps<Trx>) {
  return async function insuranceLogin(input: InsuranceLoginInput, context: RequestContext): Promise<InsuranceLoginResult> {
    const email = input.email.trim().toLowerCase();
    const ip = context.ip ?? "unknown";
    const failureKey = `insurance-login:fail:${email}:${ip}`;

    const ipDecision = deps.insuranceRateLimiter.consume(`insurance-login:ip:${ip}`, IP_RULE);
    if (!ipDecision.allowed) {
      throw new DomainError("RATE_LIMITED", { retryAfterMs: ipDecision.retryAfterMs });
    }
    const failurePeek = deps.insuranceRateLimiter.peek(failureKey, FAILURE_RULE);
    if (!failurePeek.allowed) {
      throw new DomainError("RATE_LIMITED", { retryAfterMs: failurePeek.retryAfterMs });
    }

    const now = deps.clock.now();

    async function fail(error: DomainError, accountId?: string): Promise<never> {
      deps.insuranceRateLimiter.consume(failureKey, FAILURE_RULE);
      await deps.withTransaction(async (trx) => {
        await deps.audit.record(trx, {
          occurredAt: now,
          actorType: "INSURANCE_ACCOUNT",
          ...(accountId !== undefined ? { actorInsuranceAccountId: accountId, resourceId: accountId } : {}),
          action: "INSURANCE_ACCOUNT_LOGIN_FAILED",
          resourceType: "InsuranceAccount",
          result: "FAILURE",
          requestId: context.requestId,
          ...auditContextFields(context),
        });
      });
      throw error;
    }

    const account = await deps.insuranceAccountRepo.findByEmail(deps.db, email);
    if (!account) {
      return fail(new InsuranceInvalidCredentialsError());
    }
    if (!(await verifyInsurancePassword(account.passwordHash, input.password))) {
      return fail(new InsuranceInvalidCredentialsError(), account.id);
    }
    const insurer = await deps.insurersRepo.findById(deps.db, account.insurerId);
    if (account.status === "SUSPENDED" || insurer?.status !== "ACTIVE") {
      return fail(new InsuranceAccountSuspendedError(), account.id);
    }

    deps.insuranceRateLimiter.reset(failureKey);

    const sessionId = newId();
    const refreshToken = generateInsuranceOpaqueToken();
    const refreshExpiresAt = new Date(now.getTime() + deps.insuranceRefreshTtlMs);

    await deps.withTransaction(async (trx) => {
      await deps.insuranceSessionRepo.insert(trx, {
        id: sessionId,
        insuranceAccountId: account.id,
        refreshTokenHash: hashInsuranceOpaqueToken(refreshToken),
        tokenChainId: newId(),
        expiresAt: refreshExpiresAt,
        createdAt: now,
        ...(context.ip !== undefined ? { ip: context.ip } : {}),
        ...(context.userAgent !== undefined ? { userAgent: context.userAgent } : {}),
      });
      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "INSURANCE_ACCOUNT",
        actorInsuranceAccountId: account.id,
        action: "INSURANCE_ACCOUNT_LOGIN",
        resourceType: "InsuranceAccount",
        resourceId: account.id,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });
    });

    const { token, expiresIn } = await signInsuranceAccessToken({
      subject: { insuranceAccountId: account.id, sessionId },
      now,
      ttlSeconds: deps.insuranceAccessTtlSeconds,
      signingKeys: deps.insuranceSigningKeys,
    });

    return { accessToken: token, expiresIn, refreshToken, refreshExpiresAt, insurerId: account.insurerId, role: account.role };
  };
}
