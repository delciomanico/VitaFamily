// Factory do servidor HTTP (Express): middleware de erro central (toProblem), parsing JSON com
// limite de corpo, e validação de pedidos contra o contrato (docs/05-api/openapi.yaml) via
// express-openapi-validator — pedidos que violem o contrato são rejeitados automaticamente, antes
// de chegarem a qualquer controller. Único ficheiro que `interface`/`main` usam para montar a app.
import * as OpenApiValidator from "express-openapi-validator";
import type { SecurityHandlers } from "express-openapi-validator/dist/framework/types.js";
import express, { Router, type Express, type RequestHandler } from "express";
import type { Logger } from "../logger/index.js";
import { createErrorMiddleware, notFoundHandler } from "./error-middleware.js";
import { requestIdMiddleware } from "./request-id.js";
import { denyAllSecurityHandler } from "./security.js";

export { asyncHandler } from "./async-handler.js";
export { REQUEST_ID_HEADER } from "./request-id.js";
export { buildRequestContext, type RequestContext } from "./request-context.js";
export { requireParam } from "./request-params.js";

/** Prefixo de todas as rotas de negócio do contrato (openapi.yaml: `servers[0].url`). */
export const API_BASE_PATH = "/api/v1";

export interface CreateAppOptions {
  /** Caminho absoluto para `docs/05-api/openapi.yaml`. */
  openApiSpecPath: string;
  logger: Logger;
  /** Limite do corpo JSON (sintaxe de `body-parser`); por defeito `"1mb"`. */
  jsonBodyLimit?: string;
  /**
   * Handlers de segurança do validador OpenAPI, por esquema (ex.: `bearerAuth`). Por defeito falha
   * fechado (`denyAllSecurityHandler`) até o módulo `auth` (M1) fornecer o handler real.
   */
  securityHandlers?: SecurityHandlers;
  /**
   * Middleware normal (não "security handler") montado logo depois da validação OpenAPI e antes
   * das rotas de negócio — é aqui que o módulo `auth` (M1) preenche `platform/actor` com
   * `runWithActor` e aplica o gate de termos (B6); sem isto, pedidos autenticados não têm ator.
   */
  actorContextMiddleware?: RequestHandler;
  /** Regista as rotas de operações (`/health`, `/health/ready`); sem validação OpenAPI. */
  registerHealthRoutes: (router: Router) => void;
  /** Regista as rotas de negócio dos módulos, já sob `API_BASE_PATH` e com o validador aplicado. */
  registerRoutes?: (router: Router) => void;
}

/** Monta a app Express completa (composition root chama isto uma vez). */
export function createApp(options: CreateAppOptions): Express {
  const app = express();
  app.disable("x-powered-by");

  app.use(requestIdMiddleware);
  app.use(express.json({ limit: options.jsonBodyLimit ?? "1mb" }));

  // /health e /health/ready são servidos na raiz (sondas do Caddy/uptime, monitoring.md) e também
  // sob API_BASE_PATH (o contrato declara-os sob o servidor /api/v1).
  const healthRouter = Router();
  options.registerHealthRoutes(healthRouter);
  app.use(healthRouter);

  const apiRouter = Router();
  apiRouter.use(healthRouter);
  apiRouter.use(
    OpenApiValidator.middleware({
      apiSpec: options.openApiSpecPath,
      validateRequests: true,
      validateResponses: false,
      validateSecurity: {
        handlers: options.securityHandlers ?? { bearerAuth: denyAllSecurityHandler },
      },
    }),
  );
  if (options.actorContextMiddleware) {
    apiRouter.use(options.actorContextMiddleware);
  }
  options.registerRoutes?.(apiRouter);
  app.use(API_BASE_PATH, apiRouter);

  app.use(notFoundHandler);
  app.use(createErrorMiddleware(options.logger));
  return app;
}
