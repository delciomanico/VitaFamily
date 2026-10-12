// Liga o portal da clínica ao `createApp` de `platform/http` (ADR-020): handler de segurança
// `clinicBearerAuth` (só valida o token; claims distintas das de `User` — nunca `userId`/`sessionId`
// de `auth`, authorization.md §1) + middleware que preenche `platform/actor`
// (`runWithClinicActor`, SEGUNDO `AsyncLocalStorage`, nunca o de `User`) e aplica a suspensão em
// tempo real (authorization.md §6.1 passo 1). Mesma nota de `auth/interface/middleware.ts` sobre a
// ordem: o security handler só valida claims; é o middleware normal a seguir que chama
// `runWithClinicActor` para o AsyncLocalStorage chegar aos handlers seguintes.
import type { NextFunction, Request, RequestHandler } from "express";
import { runWithClinicActor, type ClinicActorInfo } from "../../../platform/actor/index.js";
import { DomainError } from "../../../platform/errors/index.js";
import type { Clock } from "../../../platform/clock/index.js";
import { verifyClinicAccessToken, type ClinicSigningKey } from "../domain/clinic-jwt.js";
import type { ClinicActorState } from "../application/resolve-clinic-actor-state.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- augmentação padrão do Express.
  namespace Express {
    interface Request {
      /** Preenchido pelo security handler `clinicBearerAuth`; lido pelo middleware a seguir. */
      clinicAuthSubject?: { clinicAccountId: string; sessionId: string };
    }
  }
}

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

/** Handler de segurança `clinicBearerAuth` (só valida o token do portal). */
export function createClinicBearerAuthSecurityHandler(deps: {
  signingKeys: ClinicSigningKey[];
  clock: Clock;
}): (req: Request) => Promise<boolean> {
  return async (req: Request): Promise<boolean> => {
    const token = extractBearerToken(req);
    if (!token) {
      throw new Error("Authorization header required");
    }
    const subject = await verifyClinicAccessToken(token, deps.signingKeys, deps.clock.now());
    req.clinicAuthSubject = subject;
    return true;
  };
}

/**
 * Middleware normal: resolve o estado da conta (cache ≤60 s), aplica suspensão
 * (authorization.md §6.1 passo 1) e só então chama `next()` dentro de `runWithClinicActor`.
 * Passa adiante (sem preencher o ator de clínica) pedidos sem `clinicAuthSubject` — rotas fora de
 * `/clinic-portal/*` nunca têm este campo preenchido (security scheme diferente no contrato).
 */
export function createClinicActorContextMiddleware(deps: {
  resolveClinicActorState: (clinicAccountId: string, sessionId: string) => Promise<ClinicActorState>;
}): RequestHandler {
  return (req: Request, _res, next: NextFunction): void => {
    if (!req.clinicAuthSubject) {
      next();
      return;
    }

    deps
      .resolveClinicActorState(req.clinicAuthSubject.clinicAccountId, req.clinicAuthSubject.sessionId)
      .then((state) => {
        if (state.suspended) {
          next(new DomainError("ACCOUNT_SUSPENDED", { detail: "Conta suspensa." }));
          return;
        }

        const actor: ClinicActorInfo = {
          clinicAccountId: state.clinicAccountId,
          sessionId: state.sessionId,
          clinicId: state.clinicId,
          role: state.role,
        };
        runWithClinicActor(actor, () => {
          next();
        });
      })
      .catch(next);
  };
}
