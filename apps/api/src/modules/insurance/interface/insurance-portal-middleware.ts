// Liga o portal da seguradora ao `createApp` (ADR-021, mirror de `clinic-portal-middleware.ts`):
// handler de segurança `insuranceBearerAuth` (só valida o token; claims distintas) + middleware que
// preenche o TERCEIRO ator (`runWithInsuranceActor`) e aplica a suspensão em tempo real
// (authorization.md §8.1 passo 1; conta ou seguradora suspensa, BR-INS-10).
import type { NextFunction, Request, RequestHandler } from "express";
import { runWithInsuranceActor, type InsuranceActorInfo } from "../../../platform/actor/index.js";
import type { Clock } from "../../../platform/clock/index.js";
import { DomainError } from "../../../platform/errors/index.js";
import type { InsuranceActorState } from "../application/resolve-insurance-actor-state.js";
import { verifyInsuranceAccessToken, type InsuranceSigningKey } from "../domain/insurance-jwt.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- augmentação padrão do Express.
  namespace Express {
    interface Request {
      /** Preenchido pelo security handler `insuranceBearerAuth`; lido pelo middleware a seguir. */
      insuranceAuthSubject?: { insuranceAccountId: string; sessionId: string };
    }
  }
}

function extractBearerToken(req: Request): string | undefined {
  const [scheme, token] = (req.header("authorization") ?? "").split(" ");
  return scheme?.toLowerCase() === "bearer" && token ? token : undefined;
}

export function createInsuranceBearerAuthSecurityHandler(deps: { signingKeys: InsuranceSigningKey[]; clock: Clock }): (req: Request) => Promise<boolean> {
  return async (req: Request): Promise<boolean> => {
    const token = extractBearerToken(req);
    if (!token) {
      throw new Error("Authorization header required");
    }
    req.insuranceAuthSubject = await verifyInsuranceAccessToken(token, deps.signingKeys, deps.clock.now());
    return true;
  };
}

export function createInsuranceActorContextMiddleware(deps: {
  resolveInsuranceActorState: (insuranceAccountId: string, sessionId: string) => Promise<InsuranceActorState>;
}): RequestHandler {
  return (req: Request, _res, next: NextFunction): void => {
    if (!req.insuranceAuthSubject) {
      next();
      return;
    }
    deps
      .resolveInsuranceActorState(req.insuranceAuthSubject.insuranceAccountId, req.insuranceAuthSubject.sessionId)
      .then((state) => {
        if (state.suspended) {
          next(new DomainError("ACCOUNT_SUSPENDED", { detail: "Conta suspensa." }));
          return;
        }
        const actor: InsuranceActorInfo = {
          insuranceAccountId: state.insuranceAccountId,
          sessionId: state.sessionId,
          insurerId: state.insurerId,
          role: state.role,
        };
        runWithInsuranceActor(actor, () => {
          next();
        });
      })
      .catch(next);
  };
}
