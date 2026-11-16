// Liga o portal do profissional ao `createApp` (BR-MKT-13): handler de segurança `professionalBearerAuth` (só valida o token; claims e
// `aud` próprios) + middleware que preenche o TERCEIRO ator (`runWithProfessionalActor`, nunca o de `User` nem o de clínica) depois de
// verificar que a conta está `ACTIVE`. O estado de validação não é decidido aqui (authorization.md §10.1/§10.2).
import type { NextFunction, Request, RequestHandler } from "express";
import { runWithProfessionalActor } from "../../../platform/actor/index.js";
import type { Clock } from "../../../platform/clock/index.js";
import type { ProfessionalActorState } from "../application/resolve-actor-state.js";
import { verifyProfessionalAccessToken, type ProfessionalSigningKey, type ProfessionalTokenSubject } from "../domain/jwt.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- augmentação padrão do Express.
  namespace Express {
    interface Request {
      /** Preenchido pelo security handler `professionalBearerAuth`; lido pelo middleware a seguir. */
      professionalAuthSubject?: ProfessionalTokenSubject;
    }
  }
}

function extractBearerToken(req: Request): string | undefined {
  const header = req.header("authorization");
  if (!header) return undefined;
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return undefined;
  return token;
}

export function createProfessionalBearerAuthSecurityHandler(deps: { signingKeys: ProfessionalSigningKey[]; clock: Clock }): (req: Request) => Promise<boolean> {
  return async (req: Request): Promise<boolean> => {
    const token = extractBearerToken(req);
    if (!token) {
      throw new Error("Authorization header required");
    }
    req.professionalAuthSubject = await verifyProfessionalAccessToken(token, deps.signingKeys, deps.clock.now());
    return true;
  };
}

/** Pedidos sem `professionalAuthSubject` (rotas fora de `/professional-portal/*`) passam sem ator de profissional. */
export function createProfessionalActorContextMiddleware(deps: {
  resolveActorState: (subject: ProfessionalTokenSubject) => Promise<ProfessionalActorState>;
}): RequestHandler {
  return (req: Request, _res, next: NextFunction): void => {
    const subject = req.professionalAuthSubject;
    if (!subject) {
      next();
      return;
    }
    deps
      .resolveActorState(subject)
      .then((state) => {
        runWithProfessionalActor(state, () => {
          next();
        });
      })
      .catch(next);
  };
}
