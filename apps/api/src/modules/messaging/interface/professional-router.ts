// Controllers HTTP do lado do PROFISSIONAL (tag «Professional Portal»; UC-MKT-20/23). Ator: `ProfessionalAccount` do token
// (`professionalBearerAuth`); a conversa procura-se pelo `professionalId` do token. Privacidade (BR-MKT-46): `no-store`, sem corpo nem
// query string em logs; as vistas nunca têm ids de família, membro nem utilizador.
import { Router } from "express";
import { getProfessionalActor } from "../../../platform/actor/index.js";
import { UnauthenticatedError } from "../../../platform/errors/index.js";
import { asyncHandler, buildRequestContext, requireParam } from "../../../platform/http/index.js";
import type { ProfessionalActor } from "../application/ports.js";
import type { ProfessionalMessaging } from "../application/professional-conversations.js";
import { body, optionalString, queryInt, queryString } from "./http-helpers.js";

function requireProfessional(): ProfessionalActor {
  const actor = getProfessionalActor();
  if (!actor) throw new UnauthenticatedError({ detail: "Sem sessão válida." });
  return { professionalId: actor.professionalId, professionalAccountId: actor.professionalAccountId };
}

const BASE = "/professional-portal/conversations";

export function createProfessionalMessagingRouter(useCases: ProfessionalMessaging): Router {
  const router = Router();
  const noStore = (res: { set: (k: string, v: string) => unknown }) => res.set("Cache-Control", "no-store");

  router.get(
    BASE,
    asyncHandler(async (req, res) => {
      const status = queryString(req, "status");
      const limit = queryInt(req, "limit");
      const cursor = queryString(req, "cursor");
      const page = await useCases.listConversations(requireProfessional(), {
        ...(status === "OPEN" || status === "CLOSED" ? { status } : {}),
        ...(limit !== undefined ? { limit } : {}),
        ...(cursor !== undefined ? { cursor } : {}),
      });
      noStore(res);
      res.json(page);
    }),
  );

  router.get(
    `${BASE}/:conversationId`,
    asyncHandler(async (req, res) => {
      noStore(res);
      res.json(await useCases.getConversation(requireProfessional(), requireParam(req, "conversationId")));
    }),
  );

  router.get(
    `${BASE}/:conversationId/messages`,
    asyncHandler(async (req, res) => {
      const limit = queryInt(req, "limit");
      const cursor = queryString(req, "cursor");
      const page = await useCases.listMessages(requireProfessional(), requireParam(req, "conversationId"), { ...(limit !== undefined ? { limit } : {}), ...(cursor !== undefined ? { cursor } : {}) });
      noStore(res);
      res.json(page);
    }),
  );

  router.post(
    `${BASE}/:conversationId/messages`,
    asyncHandler(async (req, res) => {
      const b = body(req);
      const clientMessageId = optionalString(b.clientMessageId).v;
      const result = await useCases.sendMessage(requireProfessional(), requireParam(req, "conversationId"), { text: String(b.text), ...(clientMessageId !== undefined ? { clientMessageId } : {}) });
      noStore(res);
      res.status(result.created ? 201 : 200).json(result.message);
    }),
  );

  router.put(
    `${BASE}/:conversationId/read`,
    asyncHandler(async (req, res) => {
      const upToSeq = body(req).upToSeq;
      noStore(res);
      res.json(await useCases.markRead(requireProfessional(), requireParam(req, "conversationId"), typeof upToSeq === "number" ? upToSeq : undefined));
    }),
  );

  router.post(
    `${BASE}/:conversationId/close`,
    asyncHandler(async (req, res) => {
      noStore(res);
      res.json(await useCases.closeConversation(requireProfessional(), requireParam(req, "conversationId"), buildRequestContext(req)));
    }),
  );

  router.post(
    `${BASE}/:conversationId/reopen`,
    asyncHandler(async (req, res) => {
      noStore(res);
      res.json(await useCases.reopenConversation(requireProfessional(), requireParam(req, "conversationId"), buildRequestContext(req)));
    }),
  );

  router.post(
    `${BASE}/:conversationId/messages/:messageId/reports`,
    asyncHandler(async (req, res) => {
      const b = body(req);
      const note = optionalString(b.note).v;
      const result = await useCases.reportMessage(requireProfessional(), requireParam(req, "conversationId"), requireParam(req, "messageId"), { reason: String(b.reason), ...(note !== undefined ? { note } : {}) }, buildRequestContext(req));
      noStore(res);
      res.status(result.created ? 201 : 200).json(result.receipt);
    }),
  );

  return router;
}
