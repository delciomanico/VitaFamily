// `POST /clinic-portal/auth/refresh` (endpoints.md "clinicRefreshToken"): "Mesma política de
// rotação/reutilização de /auth/refresh, em clinic_sessions (ADR-020)" — reutilização de um token
// já rodado revoga toda a cadeia (`token_chain_id`) e é auditada.
import { newId } from "../../../platform/ids/index.js";
import { DomainError, UnauthenticatedError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import { ClinicAccountSuspendedError } from "../domain/clinic-account-errors.js";
import { signClinicAccessToken } from "../domain/clinic-jwt.js";
import { generateClinicOpaqueToken, hashClinicOpaqueToken } from "../domain/clinic-token.js";
import type { ClinicsDeps, RequestContext } from "./ports.js";
import type { ClinicLoginResult } from "./clinic-login.js";

const REFRESH_RATE_LIMIT = { max: 30, windowMs: 60 * 60 * 1000 };

export interface ClinicRefreshInput {
  refreshToken: string;
}

export function createClinicRefreshUseCase<Trx>(deps: ClinicsDeps<Trx>) {
  return async function clinicRefresh(input: ClinicRefreshInput, context: RequestContext): Promise<ClinicLoginResult> {
    const now = deps.clock.now();
    const presentedHash = hashClinicOpaqueToken(input.refreshToken);
    const session = await deps.clinicSessionRepo.findByRefreshTokenHash(deps.db, presentedHash);
    if (!session) {
      throw new UnauthenticatedError({ detail: "Sem sessão válida." });
    }

    if (session.revokedAt) {
      // Token já rodado e reutilizado: revoga toda a cadeia e audita (mesmo critério de AC-ACC-07).
      await deps.withTransaction(async (trx) => {
        await deps.clinicSessionRepo.revokeChain(trx, session.tokenChainId, now);
        await deps.audit.record(trx, {
          occurredAt: now,
          actorType: "CLINIC_ACCOUNT",
          actorClinicAccountId: session.clinicAccountId,
          action: "CLINIC_ACCOUNT_REFRESH_REUSE_DETECTED",
          resourceType: "ClinicSession",
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

    const rateDecision = deps.clinicRateLimiter.consume(`clinic-refresh:session:${session.id}`, REFRESH_RATE_LIMIT);
    if (!rateDecision.allowed) {
      throw new DomainError("RATE_LIMITED", { retryAfterMs: rateDecision.retryAfterMs });
    }

    const account = await deps.clinicAccountRepo.findById(deps.db, session.clinicAccountId);
    if (!account || account.status === "SUSPENDED") {
      throw new ClinicAccountSuspendedError();
    }

    const newSessionId = newId();
    const newRefreshToken = generateClinicOpaqueToken();
    const newRefreshExpiresAt = new Date(now.getTime() + deps.clinicRefreshTtlMs);

    await deps.withTransaction(async (trx) => {
      await deps.clinicSessionRepo.revoke(trx, session.id, now);
      await deps.clinicSessionRepo.insert(trx, {
        id: newSessionId,
        clinicAccountId: account.id,
        refreshTokenHash: hashClinicOpaqueToken(newRefreshToken),
        tokenChainId: session.tokenChainId,
        expiresAt: newRefreshExpiresAt,
        createdAt: now,
        ...(context.ip !== undefined ? { ip: context.ip } : {}),
        ...(context.userAgent !== undefined ? { userAgent: context.userAgent } : {}),
      });
    });

    const { token, expiresIn } = await signClinicAccessToken({
      subject: { clinicAccountId: account.id, sessionId: newSessionId },
      now,
      ttlSeconds: deps.clinicAccessTtlSeconds,
      signingKeys: deps.clinicSigningKeys,
    });

    return {
      accessToken: token,
      expiresIn,
      refreshToken: newRefreshToken,
      refreshExpiresAt: newRefreshExpiresAt,
      clinicId: account.clinicId,
      role: account.role,
    };
  };
}
