// Portas de `auth` para o módulo `admin` (BR-ADM-01/02, ADR-023): só emitir o token de recuperação
// (que nunca sai de `auth`) e ler estatísticas de sessões. A autorização (Platform Admin) e a
// auditoria pertencem a `admin`; aqui corre-se dentro da transação de quem chama.
import { DomainError, NotFoundError } from "../../../platform/errors/index.js";
import { issueEmailVerification, issuePasswordReset } from "./issue-recovery.js";
import type { AuthDeps, SessionStats } from "./ports.js";

const PER_USER_RULE = { max: 3, windowMs: 60 * 60 * 1000 };

export type AccessResetKind = "PASSWORD_RESET" | "EMAIL_VERIFICATION";

/**
 * BR-ADM-02: revoga todas as sessões e envia o e-mail de recuperação (ou nova verificação se a
 * conta ainda está `PENDING_VERIFICATION`). Devolve só o tipo enviado — nunca o token.
 */
export function createResetUserAccessUseCase<Trx>(deps: AuthDeps<Trx>) {
  return async function resetUserAccess(trx: Trx, userId: string): Promise<AccessResetKind> {
    const user = await deps.usersPort.byId(trx, userId);
    if (!user) {
      throw new NotFoundError();
    }
    const decision = deps.rateLimiter.consume(`admin-reset-access:user:${userId}`, PER_USER_RULE);
    if (!decision.allowed) {
      throw new DomainError("RATE_LIMITED", { retryAfterMs: decision.retryAfterMs });
    }
    const now = deps.clock.now();
    await deps.sessionRepo.revokeAllForUser(trx, userId, now);
    if (user.status === "PENDING_VERIFICATION") {
      await issueEmailVerification(deps, trx, user, now);
      return "EMAIL_VERIFICATION";
    }
    await issuePasswordReset(deps, trx, user, now);
    return "PASSWORD_RESET";
  };
}

export function createGetSessionStatsUseCase<Trx>(deps: AuthDeps<Trx>) {
  return function getSessionStats(trx: Trx, userId: string): Promise<SessionStats> {
    return deps.sessionRepo.stats(trx, userId, deps.clock.now());
  };
}
