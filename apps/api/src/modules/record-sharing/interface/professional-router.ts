// Controllers HTTP do lado do PROFISSIONAL (tag «Record Sharing»; UC-MKT-53..55). Ator: `ProfessionalAccount` do token
// (`professionalBearerAuth`); a partilha procura-se pelo `professionalId` do token. Respostas `no-store` (a abertura também sem ETag:
// o conteúdo é dado de saúde e nunca pode ser reutilizado por caches). Nunca se regista corpo, query nem resposta (BR-MKT-75).
import { Router } from "express";
import { asyncHandler, buildRequestContext, requireParam } from "../../../platform/http/index.js";
import type { ProfessionalShares } from "../application/professional-shares.js";
import { queryInt, queryString, requireProfessional } from "./http-helpers.js";

const BASE = "/professional-portal/shares";

export function createProfessionalSharesRouter(useCases: ProfessionalShares): Router {
  const router = Router();

  router.get(
    BASE,
    asyncHandler(async (req, res) => {
      const bookingId = queryString(req, "bookingId");
      const status = queryString(req, "status");
      const limit = queryInt(req, "limit");
      const cursor = queryString(req, "cursor");
      const page = await useCases.listShares(requireProfessional(), {
        ...(bookingId !== undefined ? { bookingId } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(limit !== undefined ? { limit } : {}),
        ...(cursor !== undefined ? { cursor } : {}),
      });
      res.set("Cache-Control", "no-store").json(page);
    }),
  );

  router.get(
    `${BASE}/:shareId`,
    asyncHandler(async (req, res) => {
      res.set("Cache-Control", "no-store").json(await useCases.getShare(requireProfessional(), requireParam(req, "shareId")));
    }),
  );

  router.post(
    `${BASE}/:shareId/open`,
    asyncHandler(async (req, res) => {
      const view = await useCases.openShare(requireProfessional(), requireParam(req, "shareId"), buildRequestContext(req));
      // `no-store` e SEM ETag (BR-MKT-72): `res.json` regenera o ETag no envio, por isso escreve-se o corpo diretamente.
      res.set("Cache-Control", "no-store").type("application/json").end(JSON.stringify(view));
    }),
  );

  return router;
}
