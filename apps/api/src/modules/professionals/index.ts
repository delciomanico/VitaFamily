// Raiz do módulo `professionals` (MK1, ADR-037, ADR-015): única API pública importável por outros módulos e composition root do módulo.
// Identidade PRÓPRIA (BR-MKT-13): não importa `auth`, `access`, `families`, `users` nem módulos de saúde (BR-MKT-27); só `audit`.
import type { Router } from "express";
import type { Kysely } from "kysely";
import type { Clock } from "../../platform/clock/index.js";
import { withTransaction, type Database } from "../../platform/db/index.js";
import type { Logger } from "../../platform/logger/index.js";
import type { AuditModule } from "../audit/index.js";
import { createForgotPasswordUseCase } from "./application/forgot-password.js";
import { createLoginUseCase } from "./application/login.js";
import { createLogoutUseCase } from "./application/logout.js";
import type { ProfessionalMailer, ProfessionalsDeps } from "./application/ports.js";
import { createRefreshUseCase } from "./application/refresh.js";
import { createRegisterUseCase } from "./application/register.js";
import { createResendVerificationUseCase } from "./application/resend-verification.js";
import { createResetPasswordUseCase } from "./application/reset-password.js";
import { createResolveActorStateUseCase } from "./application/resolve-actor-state.js";
import { createVerifyEmailUseCase } from "./application/verify-email.js";
import type { ProfessionalSigningKey } from "./domain/jwt.js";
import { ProfessionalInMemoryRateLimiter } from "./domain/rate-limiter.js";
import { ProfessionalTtlCache } from "./domain/ttl-cache.js";
import { KyselyProfessionalAccountRepository, KyselyProfessionalAuthTokenRepository, KyselyProfessionalSessionRepository } from "./infrastructure/account-repo.js";
import { createProfessionalActorContextMiddleware, createProfessionalBearerAuthSecurityHandler } from "./interface/middleware.js";
import { createProfessionalAuthRouter } from "./interface/router.js";

export { parseProfessionalSigningKeys, type ProfessionalSigningKey } from "./domain/jwt.js";
export { ProfessionalSmtpMailer } from "./infrastructure/mailer-smtp.js";
export { ProfessionalFakeMailer } from "./infrastructure/mailer-fake.js";
export type { ProfessionalMailer } from "./application/ports.js";

/** Estado da conta do portal por pedido, cache ≤60 s (BR-MKT-29). */
const ACCOUNT_STATE_CACHE_TTL_MS = 60_000;

export interface ProfessionalsModuleDeps {
  db: Kysely<Database>;
  audit: AuditModule;
  clock: Clock;
  logger: Logger;
  mailer: ProfessionalMailer;
  signingKeys: ProfessionalSigningKey[];
  accessTtlSeconds: number;
  refreshTtlMs: number;
  cookieDomain: string;
  appBaseUrl: string;
}

export interface ProfessionalsModule {
  /** `/professional-portal/auth/*` (e, nas fatias seguintes, as restantes rotas do portal). */
  router: Router;
  /** Handler de segurança `professionalBearerAuth` (`createApp({ securityHandlers })`). */
  securityHandlers: { professionalBearerAuth: ReturnType<typeof createProfessionalBearerAuthSecurityHandler> };
  /** Middleware a compor com os de `auth` e `clinics` (preenche o TERCEIRO ator, `platform/actor`). */
  actorContextMiddleware: ReturnType<typeof createProfessionalActorContextMiddleware>;
}

/** Composition root chama isto uma vez por processo (main/api.ts). */
export function createProfessionalsModule(deps: ProfessionalsModuleDeps): ProfessionalsModule {
  const stateCache = new ProfessionalTtlCache<{ professionalId: string }>(deps.clock, ACCOUNT_STATE_CACHE_TTL_MS);
  const rateLimiter = new ProfessionalInMemoryRateLimiter(deps.clock);
  // Sem isto o mapa de janelas cresceria com cada chave distinta (e-mail/IP); `unref` para não segurar o processo.
  setInterval(() => {
    rateLimiter.prune(2 * 60 * 60 * 1000);
  }, 10 * 60 * 1000).unref();
  const useCaseDeps: ProfessionalsDeps<Kysely<Database>> = {
    db: deps.db,
    withTransaction: (fn) => withTransaction(deps.db, fn),
    clock: deps.clock,
    logger: deps.logger,
    audit: deps.audit,
    mailer: deps.mailer,
    accountRepo: new KyselyProfessionalAccountRepository(),
    authTokenRepo: new KyselyProfessionalAuthTokenRepository(),
    sessionRepo: new KyselyProfessionalSessionRepository(),
    rateLimiter,
    signingKeys: deps.signingKeys,
    accessTtlSeconds: deps.accessTtlSeconds,
    refreshTtlMs: deps.refreshTtlMs,
    appBaseUrl: deps.appBaseUrl,
  };
  const resolveActorState = createResolveActorStateUseCase(useCaseDeps, stateCache);

  return {
    router: createProfessionalAuthRouter(
      {
        register: createRegisterUseCase(useCaseDeps),
        verifyEmail: createVerifyEmailUseCase(useCaseDeps),
        resendVerification: createResendVerificationUseCase(useCaseDeps),
        login: createLoginUseCase(useCaseDeps),
        refresh: createRefreshUseCase(useCaseDeps),
        logout: createLogoutUseCase(useCaseDeps),
        forgotPassword: createForgotPasswordUseCase(useCaseDeps),
        resetPassword: createResetPasswordUseCase(useCaseDeps),
      },
      deps.cookieDomain,
    ),
    securityHandlers: { professionalBearerAuth: createProfessionalBearerAuthSecurityHandler({ signingKeys: deps.signingKeys, clock: deps.clock }) },
    actorContextMiddleware: createProfessionalActorContextMiddleware({ resolveActorState }),
  };
}
