// ADR-007/AC-ACC-07: roda o refresh token. Reutilização de um token já rodado revoga toda a
// cadeia (`token_chain_id`) e é auditada (`AUTH_REFRESH_REUSE_DETECTED`).
import { newId } from "../../../platform/ids/index.js";
import { DomainError, UnauthenticatedError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import { AccountSuspendedError } from "../domain/errors.js";
import { signAccessToken } from "../domain/jwt.js";
import { generateOpaqueToken, hashOpaqueToken } from "../domain/token.js";
import type { AuthDeps, RequestContext } from "./ports.js";
import type { LoginResult } from "./login.js";

const REFRESH_RATE_LIMIT = { max: 30, windowMs: 60 * 60 * 1000 };

export interface RefreshInput {
  refreshToken: string;
  /** Cabeçalho `X-Requested-With` (authentication.md §1: mitigação CSRF do refresh). */
  xRequestedWith?: string;
}

export function createRefreshUseCase<Trx>(deps: AuthDeps<Trx>) {
  return async function refresh(input: RefreshInput, context: RequestContext): Promise<LoginResult> {
    if (input.xRequestedWith !== "vita") {
      throw new UnauthenticatedError({ detail: "Sem sessão válida." });
    }

    const now = deps.clock.now();
    const presentedHash = hashOpaqueToken(input.refreshToken);
    const session = await deps.sessionRepo.findByRefreshTokenHash(deps.db, presentedHash);
    if (!session) {
      throw new UnauthenticatedError({ detail: "Sem sessão válida." });
    }

    if (session.revokedAt) {
      // Token já rodado e reutilizado: revoga toda a cadeia e audita (AC-ACC-07).
      await deps.withTransaction(async (trx) => {
        await deps.sessionRepo.revokeChain(trx, session.tokenChainId, now);
        await deps.audit.record(trx, {
          occurredAt: now,
          actorType: "USER",
          actorUserId: session.userId,
          action: "AUTH_REFRESH_REUSE_DETECTED",
          resourceType: "Session",
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

    const rateDecision = deps.rateLimiter.consume(`refresh:session:${session.id}`, REFRESH_RATE_LIMIT);
    if (!rateDecision.allowed) {
      throw new DomainError("RATE_LIMITED", { retryAfterMs: rateDecision.retryAfterMs });
    }

    const user = await deps.usersPort.byId(deps.db, session.userId);
    if (!user || user.status === "SUSPENDED") {
      throw new AccountSuspendedError();
    }

    const newSessionId = newId();
    const newRefreshToken = generateOpaqueToken();
    const newRefreshExpiresAt = new Date(now.getTime() + deps.refreshTtlMs);

    await deps.withTransaction(async (trx) => {
      await deps.sessionRepo.revoke(trx, session.id, now);
      await deps.sessionRepo.insert(trx, {
        id: newSessionId,
        userId: user.id,
        refreshTokenHash: hashOpaqueToken(newRefreshToken),
        tokenChainId: session.tokenChainId,
        expiresAt: newRefreshExpiresAt,
        createdAt: now,
        ...(context.ip !== undefined ? { ip: context.ip } : {}),
        ...(context.userAgent !== undefined ? { userAgent: context.userAgent } : {}),
      });
    });

    const { token, expiresIn } = await signAccessToken({
      subject: { userId: user.id, sessionId: newSessionId },
      now,
      ttlSeconds: deps.accessTtlSeconds,
      signingKeys: deps.signingKeys,
    });

    return {
      accessToken: token,
      expiresIn,
      refreshToken: newRefreshToken,
      refreshExpiresAt: newRefreshExpiresAt,
    };
  };
}
