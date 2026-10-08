// Raiz do módulo `auth` (ADR-015/conventions.md §1): única API pública importável pelo composition
// root (`main/api.ts`) — regista as rotas de `/auth/*` e liga a autenticação ao `createApp` de
// `platform/http` (CLAUDE.md M1 §4).
import type { Router } from "express";
import type { SecurityHandlers } from "express-openapi-validator/dist/framework/types.js";
import type { Kysely } from "kysely";
import type { Clock } from "../../platform/clock/index.js";
import type { Database } from "../../platform/db/index.js";
import { withTransaction } from "../../platform/db/index.js";
import type { AuditModule } from "../audit/index.js";
import type { FamiliesModule } from "../families/index.js";
import type { UsersModule } from "../users/index.js";
import { createChangePasswordUseCase } from "./application/change-password.js";
import { createForgotPasswordUseCase } from "./application/forgot-password.js";
import { createLoginUseCase } from "./application/login.js";
import { createLogoutUseCase } from "./application/logout.js";
import type { AuthDeps, Mailer } from "./application/ports.js";
import { createRefreshUseCase } from "./application/refresh.js";
import { createRegisterUseCase } from "./application/register.js";
import { createResendVerificationUseCase } from "./application/resend-verification.js";
import { createResetPasswordUseCase } from "./application/reset-password.js";
import { createResolveActorStateUseCase } from "./application/resolve-actor-state.js";
import { createVerifyEmailUseCase } from "./application/verify-email.js";
import type { SigningKey } from "./domain/jwt.js";
import { InMemoryRateLimiter } from "./domain/rate-limiter.js";
import { TtlCache } from "./domain/ttl-cache.js";
import { KyselyAuthTokenRepository, KyselySessionRepository } from "./infrastructure/repo.js";
import {
  createActorContextMiddleware,
  createBearerAuthSecurityHandler,
} from "./interface/middleware.js";
import { createAuthRouter } from "./interface/router.js";

export type { Mailer, SentEmail } from "./application/ports.js";
export { parseSigningKeys, type SigningKey } from "./domain/jwt.js";
export { SmtpMailer } from "./infrastructure/mailer-smtp.js";
export { FakeMailer } from "./infrastructure/mailer-fake.js";

/** Cache do estado da conta/termos por pedido (authentication.md §1/ADR-007: "cache ≤60 s"). */
const ACCOUNT_STATE_CACHE_TTL_MS = 60_000;

export interface AuthModuleDeps {
  db: Kysely<Database>;
  audit: AuditModule;
  users: UsersModule;
  /** modules.md §3.7: só para consumir o convite de conta de dependente no registo (UC-MEM-05). */
  families: FamiliesModule;
  clock: Clock;
  mailer: Mailer;
  signingKeys: SigningKey[];
  accessTtlSeconds: number;
  refreshTtlMs: number;
  appBaseUrl: string;
  cookieDomain: string;
  /** `TERMS_VERSION` (config). */
  currentTermsVersion: string;
}

export interface AuthModule {
  router: Router;
  /** Handlers de segurança para `createApp({ securityHandlers })` (ex.: `bearerAuth`). */
  securityHandlers: SecurityHandlers;
  /** Middleware a montar logo após `OpenApiValidator` (preenche `platform/actor`, aplica B6). */
  actorContextMiddleware: ReturnType<typeof createActorContextMiddleware>;
}

/** Composition root chama isto uma vez por processo (main/api.ts). */
export function createAuthModule(deps: AuthModuleDeps): AuthModule {
  const authTokenRepo = new KyselyAuthTokenRepository();
  const sessionRepo = new KyselySessionRepository();
  const rateLimiter = new InMemoryRateLimiter(deps.clock);
  const generalRateLimiter = new InMemoryRateLimiter(deps.clock);
  const accountStateCache = new TtlCache<{
    platformAdmin: boolean;
    suspended: boolean;
    termsReacceptanceRequired: boolean;
  }>(deps.clock, ACCOUNT_STATE_CACHE_TTL_MS);

  const authDeps: AuthDeps<Kysely<Database>> = {
    usersPort: {
      createAccount: deps.users.createAccount,
      byEmail: deps.users.byEmail,
      byId: deps.users.byId,
      setEmailVerified: deps.users.setEmailVerified,
      setPasswordHash: deps.users.setPasswordHash,
    },
    families: {
      resolveDependentAccountInvitation: deps.families.resolveDependentAccountInvitation,
      finalizeDependentAccountInvitation: deps.families.finalizeDependentAccountInvitation,
    },
    authTokenRepo,
    sessionRepo,
    audit: deps.audit,
    db: deps.db,
    withTransaction: (fn) => withTransaction(deps.db, fn),
    clock: deps.clock,
    mailer: deps.mailer,
    rateLimiter,
    signingKeys: deps.signingKeys,
    accessTtlSeconds: deps.accessTtlSeconds,
    refreshTtlMs: deps.refreshTtlMs,
    appBaseUrl: deps.appBaseUrl,
    currentTermsVersion: deps.currentTermsVersion,
  };

  const resolveActorState = createResolveActorStateUseCase(authDeps, accountStateCache);

  const router = createAuthRouter(
    {
      register: createRegisterUseCase(authDeps),
      verifyEmail: createVerifyEmailUseCase(authDeps),
      resendVerification: createResendVerificationUseCase(authDeps),
      login: createLoginUseCase(authDeps),
      refresh: createRefreshUseCase(authDeps),
      logout: createLogoutUseCase(authDeps),
      forgotPassword: createForgotPasswordUseCase(authDeps),
      resetPassword: createResetPasswordUseCase(authDeps),
      changePassword: createChangePasswordUseCase(authDeps),
    },
    deps.cookieDomain,
  );

  return {
    router,
    securityHandlers: {
      bearerAuth: createBearerAuthSecurityHandler({
        signingKeys: deps.signingKeys,
        clock: deps.clock,
      }),
    },
    actorContextMiddleware: createActorContextMiddleware({ resolveActorState, generalRateLimiter }),
  };
}
