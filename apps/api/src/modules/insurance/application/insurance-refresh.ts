// `POST /insurance-portal/auth/refresh` (openapi insuranceRefreshToken): mesma política de
// rotação/reutilização de `/auth/refresh`, em `insurance_sessions` — reutilização de um token já
// rodado revoga toda a cadeia e é auditada. Conta/seguradora suspensa ⇒ ACCOUNT_SUSPENDED (BR-INS-10).
import { DomainError, UnauthenticatedError } from "../../../platform/errors/index.js";
import { newId } from "../../../platform/ids/index.js";
import { auditContextFields } from "../../audit/index.js";
import { InsuranceAccountSuspendedError } from "../domain/insurance-account.js";
import { generateInsuranceOpaqueToken, hashInsuranceOpaqueToken } from "../domain/insurance-crypto.js";
import { signInsuranceAccessToken } from "../domain/insurance-jwt.js";
import type { InsuranceLoginResult } from "./insurance-login.js";
import type { InsuranceDeps, RequestContext } from "./ports.js";

const REFRESH_RATE_LIMIT = { max: 30, windowMs: 60 * 60 * 1000 };

export interface InsuranceRefreshInput {
  refreshToken: string;
}

export function createInsuranceRefreshUseCase<Trx>(deps: InsuranceDeps<Trx>) {
  return async function insuranceRefresh(input: InsuranceRefreshInput, context: RequestContext): Promise<InsuranceLoginResult> {
    const now = deps.clock.now();
    const session = await deps.insuranceSessionRepo.findByRefreshTokenHash(deps.db, hashInsuranceOpaqueToken(input.refreshToken));
    if (!session) {
      throw new UnauthenticatedError({ detail: "Sem sessão válida." });
    }

    if (session.revokedAt) {
      await deps.withTransaction(async (trx) => {
        await deps.insuranceSessionRepo.revokeChain(trx, session.tokenChainId, now);
        await deps.audit.record(trx, {
          occurredAt: now,
          actorType: "INSURANCE_ACCOUNT",
          actorInsuranceAccountId: session.insuranceAccountId,
          action: "INSURANCE_ACCOUNT_REFRESH_REUSE_DETECTED",
          resourceType: "InsuranceSession",
          resourceId: session.id,
          result: "FAILURE",
          requestId: context.requestId,
          ...auditContextFields(context),
        });
      });
      throw new UnauthenticatedError({ detail: "Sem sessão válida." });
    }
    if (session.expiresAt.getTime() <= now.getTime()) {
      throw new UnauthenticatedError({ detail: "Sem sessão válida." });
    }

    const rateDecision = deps.insuranceRateLimiter.consume(`insurance-refresh:session:${session.id}`, REFRESH_RATE_LIMIT);
    if (!rateDecision.allowed) {
      throw new DomainError("RATE_LIMITED", { retryAfterMs: rateDecision.retryAfterMs });
    }

    const account = await deps.insuranceAccountRepo.findById(deps.db, session.insuranceAccountId);
    if (!account) {
      throw new UnauthenticatedError({ detail: "Sem sessão válida." });
    }
    const insurer = await deps.insurersRepo.findById(deps.db, account.insurerId);
    if (account.status === "SUSPENDED" || insurer?.status !== "ACTIVE") {
      throw new InsuranceAccountSuspendedError();
    }

    const newSessionId = newId();
    const newRefreshToken = generateInsuranceOpaqueToken();
    const newRefreshExpiresAt = new Date(now.getTime() + deps.insuranceRefreshTtlMs);

    await deps.withTransaction(async (trx) => {
      await deps.insuranceSessionRepo.revoke(trx, session.id, now);
      await deps.insuranceSessionRepo.insert(trx, {
        id: newSessionId,
        insuranceAccountId: account.id,
        refreshTokenHash: hashInsuranceOpaqueToken(newRefreshToken),
        tokenChainId: session.tokenChainId,
        expiresAt: newRefreshExpiresAt,
        createdAt: now,
        ...(context.ip !== undefined ? { ip: context.ip } : {}),
        ...(context.userAgent !== undefined ? { userAgent: context.userAgent } : {}),
      });
    });

    const { token, expiresIn } = await signInsuranceAccessToken({
      subject: { insuranceAccountId: account.id, sessionId: newSessionId },
      now,
      ttlSeconds: deps.insuranceAccessTtlSeconds,
      signingKeys: deps.insuranceSigningKeys,
    });

    return { accessToken: token, expiresIn, refreshToken: newRefreshToken, refreshExpiresAt: newRefreshExpiresAt, insurerId: account.insurerId, role: account.role };
  };
}
