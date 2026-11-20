// `POST /professional-portal/auth/refresh`: refresh rotativo; reutilização de um token já rodado revoga a cadeia inteira e audita
// (ADR-020, como AC-ACC-07). Exige `X-Requested-With: vita` (mitigação CSRF, authentication.md §5) — o cookie é SameSite=Strict mas
// o cabeçalho é a segunda barreira. 30/hora por sessão. Conta tem de estar `ACTIVE`.
import { DomainError, UnauthenticatedError } from "../../../platform/errors/index.js";
import { newId } from "../../../platform/ids/index.js";
import { auditContextFields } from "../../audit/index.js";
import { signProfessionalAccessToken } from "../domain/jwt.js";
import { generateOpaqueToken, hashOpaqueToken } from "../domain/token.js";
import type { ProfessionalsDeps, RequestContext } from "./ports.js";
import type { ProfessionalLoginResult } from "./session-result.js";

const REFRESH_RATE_LIMIT = { max: 30, windowMs: 60 * 60 * 1000 };

export interface RefreshInput {
  refreshToken: string;
  xRequestedWith?: string;
}

export function createRefreshUseCase<Trx>(deps: ProfessionalsDeps<Trx>) {
  return async function refresh(input: RefreshInput, context: RequestContext): Promise<ProfessionalLoginResult> {
    if (input.xRequestedWith !== "vita") {
      throw new UnauthenticatedError({ detail: "Sem sessão válida." });
    }
    const now = deps.clock.now();
    const session = await deps.sessionRepo.findByRefreshTokenHash(deps.db, hashOpaqueToken(input.refreshToken));
    if (!session) {
      throw new UnauthenticatedError({ detail: "Sem sessão válida." });
    }
    const handleReuse = async (): Promise<never> => {
      await deps.withTransaction(async (trx) => {
        await deps.sessionRepo.revokeChain(trx, session.tokenChainId, now);
        await deps.audit.record(trx, {
          occurredAt: now,
          actorType: "PROFESSIONAL_ACCOUNT",
          actorProfessionalAccountId: session.accountId,
          action: "PROFESSIONAL_REFRESH_REUSE_DETECTED",
          resourceType: "ProfessionalSession",
          resourceId: session.id,
          result: "FAILURE",
          requestId: context.requestId,
          ...auditContextFields(context),
        });
      });
      throw new UnauthenticatedError({ detail: "Sem sessão válida." });
    };
    if (session.revokedAt) {
      return handleReuse();
    }
    if (session.expiresAt.getTime() <= now.getTime()) {
      throw new UnauthenticatedError({ detail: "Sem sessão válida." });
    }
    const rate = await deps.rateLimiter.consume({ rule: "refresh-session", subject: session.id }, REFRESH_RATE_LIMIT);
    if (!rate.allowed) {
      throw new DomainError("RATE_LIMITED", { retryAfterMs: rate.retryAfterMs });
    }
    const account = await deps.accountRepo.findById(deps.db, session.accountId);
    const professional = account ? await deps.accountRepo.findProfessionalByAccountId(deps.db, account.id) : null;
    if (account?.status !== "ACTIVE" || !professional) {
      throw new UnauthenticatedError({ detail: "Sem sessão válida." });
    }

    const newSessionId = newId();
    const newRefreshToken = generateOpaqueToken();
    const newRefreshExpiresAt = new Date(now.getTime() + deps.refreshTtlMs);
    // `revoke` é atómico (`WHERE revoked_at IS NULL`): de dois refresh concorrentes com o mesmo token só um roda; o outro é tratado como reutilização.
    const rotated = await deps.withTransaction(async (trx) => {
      if (!(await deps.sessionRepo.revoke(trx, session.id, now))) {
        return false;
      }
      await deps.sessionRepo.insert(trx, {
        id: newSessionId,
        accountId: account.id,
        refreshTokenHash: hashOpaqueToken(newRefreshToken),
        tokenChainId: session.tokenChainId,
        expiresAt: newRefreshExpiresAt,
        createdAt: now,
        ...(context.ip !== undefined ? { ip: context.ip } : {}),
        ...(context.userAgent !== undefined ? { userAgent: context.userAgent } : {}),
      });
      return true;
    });
    if (!rotated) {
      return handleReuse();
    }
    const { token, expiresIn } = await signProfessionalAccessToken({
      subject: { professionalAccountId: account.id, professionalId: professional.id, sessionId: newSessionId },
      now,
      ttlSeconds: deps.accessTtlSeconds,
      signingKeys: deps.signingKeys,
    });
    return { accessToken: token, expiresIn, refreshToken: newRefreshToken, refreshExpiresAt: newRefreshExpiresAt, professionalId: professional.id, validationStatus: professional.validationStatus };
  };
}
