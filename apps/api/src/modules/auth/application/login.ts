// UC-ACC-02: login. Mensagem de erro genérica para credenciais inválidas (errors.md); conta
// SUSPENDED/PENDING_VERIFICATION recusadas; AC-ACC-07/ADR-007: nova cadeia de sessão por login.
import { newId } from "../../../platform/ids/index.js";
import { DomainError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import { AccountSuspendedError, EmailNotVerifiedError, InvalidCredentialsError } from "../domain/errors.js";
import { signAccessToken } from "../domain/jwt.js";
import { verifyPassword } from "../domain/password.js";
import { generateOpaqueToken, hashOpaqueToken } from "../domain/token.js";
import type { AuthDeps, RequestContext } from "./ports.js";

export interface LoginInput {
  email: string;
  password: string;
}

export interface LoginResult {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
}

const FAILURE_RULE = { max: 5, windowMs: 15 * 60 * 1000 };
const IP_RULE = { max: 20, windowMs: 15 * 60 * 1000 };

export function createLoginUseCase<Trx>(deps: AuthDeps<Trx>) {
  return async function login(input: LoginInput, context: RequestContext): Promise<LoginResult> {
    const email = input.email.trim().toLowerCase();
    const ip = context.ip ?? "unknown";
    const failureKey = `login:fail:${email}:${ip}`;
    const ipKey = `login:ip:${ip}`;

    const ipDecision = deps.rateLimiter.consume(ipKey, IP_RULE);
    if (!ipDecision.allowed) {
      throw new DomainError("RATE_LIMITED", { retryAfterMs: ipDecision.retryAfterMs });
    }
    // Falha fechada: se já atingiu o limite de falhas, recusa sem voltar a verificar a password
    // (authentication.md §3: "atraso crescente"; também evita reduzir o efeito do limite).
    const failurePeek = deps.rateLimiter.peek(failureKey, FAILURE_RULE);
    if (!failurePeek.allowed) {
      throw new DomainError("RATE_LIMITED", { retryAfterMs: failurePeek.retryAfterMs });
    }

    const now = deps.clock.now();

    async function fail(error: DomainError, userId?: string): Promise<never> {
      deps.rateLimiter.consume(failureKey, FAILURE_RULE);
      await deps.withTransaction(async (trx) => {
        await deps.audit.record(trx, {
          occurredAt: now,
          actorType: "USER",
          ...(userId !== undefined ? { actorUserId: userId } : {}),
          action: "AUTH_LOGIN_FAILED",
          resourceType: "User",
          ...(userId !== undefined ? { resourceId: userId } : {}),
          result: "FAILURE",
          requestId: context.requestId,
          ...auditContextFields(context),
        });
      });
      throw error;
    }

    const user = await deps.usersPort.byEmail(deps.db, email);
    if (!user) {
      return fail(new InvalidCredentialsError());
    }

    const passwordOk = await verifyPassword(user.passwordHash, input.password);
    if (!passwordOk) {
      return fail(new InvalidCredentialsError(), user.id);
    }
    if (user.status === "SUSPENDED") {
      return fail(new AccountSuspendedError(), user.id);
    }
    if (user.status === "PENDING_VERIFICATION") {
      return fail(new EmailNotVerifiedError(), user.id);
    }

    deps.rateLimiter.reset(failureKey);

    const sessionId = newId();
    const tokenChainId = newId();
    const refreshToken = generateOpaqueToken();
    const refreshExpiresAt = new Date(now.getTime() + deps.refreshTtlMs);

    await deps.withTransaction(async (trx) => {
      await deps.sessionRepo.insert(trx, {
        id: sessionId,
        userId: user.id,
        refreshTokenHash: hashOpaqueToken(refreshToken),
        tokenChainId,
        expiresAt: refreshExpiresAt,
        createdAt: now,
        ...(context.ip !== undefined ? { ip: context.ip } : {}),
        ...(context.userAgent !== undefined ? { userAgent: context.userAgent } : {}),
      });
      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "USER",
        actorUserId: user.id,
        action: "AUTH_LOGIN",
        resourceType: "User",
        resourceId: user.id,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });
    });

    const { token, expiresIn } = await signAccessToken({
      subject: { userId: user.id, sessionId },
      now,
      ttlSeconds: deps.accessTtlSeconds,
      signingKeys: deps.signingKeys,
    });

    return { accessToken: token, expiresIn, refreshToken, refreshExpiresAt };
  };
}
