// Liga `auth` ao `createApp` de `platform/http` (CLAUDE.md M1 §4): substitui o
// `denyAllSecurityHandler` por um handler real (valida o Bearer JWT) e acrescenta um middleware
// que preenche `platform/actor` (via `runWithActor`) e aplica o gate de termos (B6) fora das rotas
// isentas.
//
// Nota sobre a ordem: o "security handler" do express-openapi-validator só pode devolver
// true/false (ou lançar, que o validador reduz a um 401 genérico — ver
// `platform/http/error-middleware.ts`). Por isso ele faz SÓ a validação do token (claims);
// suspensão de conta e termos (que exigem códigos `ACCOUNT_SUSPENDED`/`TERMS_REACCEPTANCE_REQUIRED`
// precisos) são decididos num middleware normal a seguir, que também é o único sítio onde é seguro
// chamar `runWithActor` — teria de envolver a chamada a `next()` de forma síncrona para o contexto
// (AsyncLocalStorage) chegar aos handlers seguintes; dentro do próprio security handler isso não
// seria garantido (a resolução da promise devolvida ao validador não corre dentro do `run()`).
import type { NextFunction, Request, RequestHandler } from "express";
import type { OpenApiRequestMetadata } from "express-openapi-validator/dist/framework/types.js";
import { runWithActor, type ActorInfo } from "../../../platform/actor/index.js";
import { DomainError } from "../../../platform/errors/index.js";
import type { Clock } from "../../../platform/clock/index.js";
import { verifyAccessToken, type SigningKey } from "../domain/jwt.js";
import { InMemoryRateLimiter } from "../domain/rate-limiter.js";
import type { ActorState } from "../application/resolve-actor-state.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- augmentação padrão do Express.
  namespace Express {
    interface Request {
      /** Preenchido pelo security handler `bearerAuth`; lido pelo `createActorContextMiddleware`. */
      authSubject?: { userId: string; sessionId: string };
      /** Preenchido pelo express-openapi-validator (metadados da operação do contrato). */
      openapi?: OpenApiRequestMetadata;
    }
  }
}

/** Operações isentas do gate de termos B6 (authentication.md §2): aceitar termos, exportar, eliminar. */
const TERMS_GATE_EXEMPT_OPERATIONS = new Set([
  "acceptTerms",
  "deleteMe",
  "requestMyExport",
  "getMyExport",
  "downloadMyExport",
]);

function extractBearerToken(req: Request): string | undefined {
  const header = req.header("authorization");
  if (!header) {
    return undefined;
  }
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return undefined;
  }
  return token;
}

/** Handler de segurança `bearerAuth` (só valida o token; não decide suspensão/termos). */
export function createBearerAuthSecurityHandler(deps: {
  signingKeys: SigningKey[];
  clock: Clock;
}): (req: Request) => Promise<boolean> {
  return async (req: Request): Promise<boolean> => {
    const token = extractBearerToken(req);
    if (!token) {
      throw new Error("Authorization header required");
    }
    const subject = await verifyAccessToken(token, deps.signingKeys, deps.clock.now());
    req.authSubject = subject;
    return true;
  };
}

/**
 * Middleware normal (não é "security handler"): resolve o estado da conta (cache ≤60 s), aplica
 * suspensão (BR-ACC-05) e o gate de termos (B6), e só então chama `next()` dentro de
 * `runWithActor` — ver nota no topo do ficheiro sobre porque tem de ser aqui e não no handler.
 */
export function createActorContextMiddleware(deps: {
  resolveActorState: (userId: string, sessionId: string) => Promise<ActorState>;
  generalRateLimiter: InMemoryRateLimiter;
}): RequestHandler {
  const GENERAL_RULE = { max: 300, windowMs: 60 * 1000 };

  return (req: Request, _res, next: NextFunction): void => {
    if (!req.authSubject) {
      // Rota pública (sem `bearerAuth` no contrato) — sem ator.
      next();
      return;
    }

    deps
      .resolveActorState(req.authSubject.userId, req.authSubject.sessionId)
      .then((state) => {
        if (state.suspended) {
          next(new DomainError("ACCOUNT_SUSPENDED", { detail: "Conta suspensa." }));
          return;
        }

        const operationId = req.openapi?.schema.operationId;
        const exempt = typeof operationId === "string" && TERMS_GATE_EXEMPT_OPERATIONS.has(operationId);
        if (state.termsReacceptanceRequired && !exempt) {
          next(new DomainError("TERMS_REACCEPTANCE_REQUIRED", { detail: "Novos termos por aceitar." }));
          return;
        }

        const decision = deps.generalRateLimiter.consume(`actor:${state.userId}`, GENERAL_RULE);
        if (!decision.allowed) {
          next(new DomainError("RATE_LIMITED", { retryAfterMs: decision.retryAfterMs }));
          return;
        }

        const actor: ActorInfo = {
          userId: state.userId,
          sessionId: state.sessionId,
          platformAdmin: state.platformAdmin,
        };
        // `next()` síncrono DENTRO do callback de `runWithActor`: é isto que garante que o
        // AsyncLocalStorage chega aos middlewares/handlers seguintes (ver nota no topo).
        runWithActor(actor, () => {
          next();
        });
      })
      .catch(next);
  };
}
