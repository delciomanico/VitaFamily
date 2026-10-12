// `POST /clinic-portal/auth/login` (endpoints.md "clinicLogin", ADR-020): mensagem de erro
// genérica para credenciais inválidas (errors.md); conta SUSPENDED recusada; nova cadeia de
// sessão por login (mesmo critério de AC-ACC-07 para `User`).
import { newId } from "../../../platform/ids/index.js";
import { DomainError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import { ClinicAccountSuspendedError, ClinicInvalidCredentialsError } from "../domain/clinic-account-errors.js";
import { verifyClinicPassword } from "../domain/clinic-account-password.js";
import { signClinicAccessToken } from "../domain/clinic-jwt.js";
import { generateClinicOpaqueToken, hashClinicOpaqueToken } from "../domain/clinic-token.js";
import type { ClinicAccountRole, ClinicsDeps, RequestContext } from "./ports.js";

export interface ClinicLoginInput {
  email: string;
  password: string;
}

export interface ClinicLoginResult {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
  clinicId: string;
  role: ClinicAccountRole;
}

const FAILURE_RULE = { max: 5, windowMs: 15 * 60 * 1000 };
const IP_RULE = { max: 20, windowMs: 15 * 60 * 1000 };

export function createClinicLoginUseCase<Trx>(deps: ClinicsDeps<Trx>) {
  return async function clinicLogin(input: ClinicLoginInput, context: RequestContext): Promise<ClinicLoginResult> {
    const email = input.email.trim().toLowerCase();
    const ip = context.ip ?? "unknown";
    const failureKey = `clinic-login:fail:${email}:${ip}`;
    const ipKey = `clinic-login:ip:${ip}`;

    const ipDecision = deps.clinicRateLimiter.consume(ipKey, IP_RULE);
    if (!ipDecision.allowed) {
      throw new DomainError("RATE_LIMITED", { retryAfterMs: ipDecision.retryAfterMs });
    }
    const failurePeek = deps.clinicRateLimiter.peek(failureKey, FAILURE_RULE);
    if (!failurePeek.allowed) {
      throw new DomainError("RATE_LIMITED", { retryAfterMs: failurePeek.retryAfterMs });
    }

    const now = deps.clock.now();

    async function fail(error: DomainError, accountId?: string): Promise<never> {
      deps.clinicRateLimiter.consume(failureKey, FAILURE_RULE);
      await deps.withTransaction(async (trx) => {
        await deps.audit.record(trx, {
          occurredAt: now,
          actorType: "CLINIC_ACCOUNT",
          ...(accountId !== undefined ? { actorClinicAccountId: accountId } : {}),
          action: "CLINIC_ACCOUNT_LOGIN_FAILED",
          resourceType: "ClinicAccount",
          ...(accountId !== undefined ? { resourceId: accountId } : {}),
          result: "FAILURE",
          requestId: context.requestId,
          ...auditContextFields(context),
        });
      });
      throw error;
    }

    const account = await deps.clinicAccountRepo.findByEmail(deps.db, email);
    if (!account) {
      return fail(new ClinicInvalidCredentialsError());
    }

    const passwordOk = await verifyClinicPassword(account.passwordHash, input.password);
    if (!passwordOk) {
      return fail(new ClinicInvalidCredentialsError(), account.id);
    }
    if (account.status === "SUSPENDED") {
      return fail(new ClinicAccountSuspendedError(), account.id);
    }

    deps.clinicRateLimiter.reset(failureKey);

    const sessionId = newId();
    const tokenChainId = newId();
    const refreshToken = generateClinicOpaqueToken();
    const refreshExpiresAt = new Date(now.getTime() + deps.clinicRefreshTtlMs);

    await deps.withTransaction(async (trx) => {
      await deps.clinicSessionRepo.insert(trx, {
        id: sessionId,
        clinicAccountId: account.id,
        refreshTokenHash: hashClinicOpaqueToken(refreshToken),
        tokenChainId,
        expiresAt: refreshExpiresAt,
        createdAt: now,
        ...(context.ip !== undefined ? { ip: context.ip } : {}),
        ...(context.userAgent !== undefined ? { userAgent: context.userAgent } : {}),
      });
      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "CLINIC_ACCOUNT",
        actorClinicAccountId: account.id,
        action: "CLINIC_ACCOUNT_LOGIN",
        resourceType: "ClinicAccount",
        resourceId: account.id,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });
    });

    const { token, expiresIn } = await signClinicAccessToken({
      subject: { clinicAccountId: account.id, sessionId },
      now,
      ttlSeconds: deps.clinicAccessTtlSeconds,
      signingKeys: deps.clinicSigningKeys,
    });

    return {
      accessToken: token,
      expiresIn,
      refreshToken,
      refreshExpiresAt,
      clinicId: account.clinicId,
      role: account.role,
    };
  };
}
