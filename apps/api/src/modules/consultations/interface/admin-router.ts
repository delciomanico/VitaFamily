// Controllers HTTP do admin sobre disputas de pagamento (tag «Admin»; UC-MKT-38). O guard `PLATFORM_ADMIN` está nos casos de uso; um token de
// profissional não tem ator de User ⇒ 401. Respostas `no-store`; o ficheiro por rota própria (auditada).
import { Router } from "express";
import { asyncHandler, buildRequestContext, requireParam } from "../../../platform/http/index.js";
import type { AdminDisputes } from "../application/admin-disputes.js";
import { body, queryInt, queryString, requireActor } from "./http-helpers.js";
import { sendProof } from "./proofs-router.js";

export function createAdminDisputesRouter(useCases: AdminDisputes): Router {
  const router = Router();

  router.get(
    "/admin/payment-disputes",
    asyncHandler(async (req, res) => {
      const status = queryString(req, "status");
      const limit = queryInt(req, "limit");
      const cursor = queryString(req, "cursor");
      const page = await useCases.listDisputes(requireActor(), {
        ...(status === "DISPUTED" || status === "DECIDED" ? { status } : {}),
        ...(limit !== undefined ? { limit } : {}),
        ...(cursor !== undefined ? { cursor } : {}),
      });
      res.set("Cache-Control", "no-store").json(page);
    }),
  );

  router.get(
    "/admin/payment-disputes/:proofId",
    asyncHandler(async (req, res) => {
      res.set("Cache-Control", "no-store").json(await useCases.getDispute(requireActor(), requireParam(req, "proofId"), buildRequestContext(req)));
    }),
  );

  router.get(
    "/admin/payment-disputes/:proofId/file",
    asyncHandler(async (req, res) => {
      sendProof(res, await useCases.downloadProof(requireActor(), requireParam(req, "proofId"), buildRequestContext(req)));
    }),
  );

  router.post(
    "/admin/payment-disputes/:proofId/decisions",
    asyncHandler(async (req, res) => {
      res.set("Cache-Control", "no-store").json(await useCases.decide(requireActor(), requireParam(req, "proofId"), { decision: String(body(req).decision) }, buildRequestContext(req)));
    }),
  );

  return router;
}
