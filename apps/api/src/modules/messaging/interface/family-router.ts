// Controllers HTTP do lado da FAMÍLIA (tag «Messaging»; UC-MKT-17/18/22/23). Autorização na `application` (`MESSAGE_PROFESSIONALS`).
// Privacidade (BR-MKT-46): respostas `no-store`; este router nunca regista corpo, texto nem query string (só a métrica por rota).
import { Router, type Request } from "express";
import { getActor } from "../../../platform/actor/index.js";
import { UnauthenticatedError } from "../../../platform/errors/index.js";
import { asyncHandler, buildRequestContext, requireParam } from "../../../platform/http/index.js";
import type { FamilyMessaging } from "../application/family-conversations.js";
import type { ActorIdentity } from "../application/ports.js";

function requireActor(): ActorIdentity {
  const actor = getActor();
  if (!actor) throw new UnauthenticatedError({ detail: "Sem sessão válida." });
  return { userId: actor.userId, platformAdmin: actor.platformAdmin };
}

function queryInt(req: Request, name: string): number | undefined {
  const value = req.query[name];
  if (typeof value === "number") return value;
  return typeof value === "string" && /^\d+$/.test(value) ? Number(value) : undefined;
}

function queryString(req: Request, name: string): string | undefined {
  const value = req.query[name];
  return typeof value === "string" ? value : undefined;
}

function body(req: Request): Record<string, unknown> {
  return typeof req.body === "object" && req.body !== null ? (req.body as Record<string, unknown>) : {};
}

function optionalString(value: unknown): { v?: string } {
  return typeof value === "string" ? { v: value } : {};
}

const BASE = "/families/:familyId/members/:memberId/conversations";

export function createFamilyMessagingRouter(useCases: FamilyMessaging): Router {
  const router = Router();
  const ids = (req: Request) => ({ familyId: requireParam(req, "familyId"), memberId: requireParam(req, "memberId") });

  router.get(
    BASE,
    asyncHandler(async (req, res) => {
      const { familyId, memberId } = ids(req);
      const status = queryString(req, "status");
      const limit = queryInt(req, "limit");
      const cursor = queryString(req, "cursor");
      const page = await useCases.listConversations(requireActor(), familyId, memberId, {
        ...(status === "OPEN" || status === "CLOSED" ? { status } : {}),
        ...(limit !== undefined ? { limit } : {}),
        ...(cursor !== undefined ? { cursor } : {}),
      });
      res.set("Cache-Control", "no-store").json(page);
    }),
  );

  router.post(
    BASE,
    asyncHandler(async (req, res) => {
      const { familyId, memberId } = ids(req);
      const b = body(req);
      const clientMessageId = optionalString(b.clientMessageId).v;
      const result = await useCases.startConversation(
        requireActor(),
        familyId,
        memberId,
        { professionalId: String(b.professionalId), participantLabel: String(b.participantLabel), text: String(b.text), ...(clientMessageId !== undefined ? { clientMessageId } : {}) },
        buildRequestContext(req),
      );
      res.set("Cache-Control", "no-store").status(result.created ? 201 : 200).json({ conversation: result.conversation, message: result.message });
    }),
  );

  router.get(
    `${BASE}/:conversationId`,
    asyncHandler(async (req, res) => {
      const { familyId, memberId } = ids(req);
      res.set("Cache-Control", "no-store").json(await useCases.getConversation(requireActor(), familyId, memberId, requireParam(req, "conversationId")));
    }),
  );

  router.get(
    `${BASE}/:conversationId/messages`,
    asyncHandler(async (req, res) => {
      const { familyId, memberId } = ids(req);
      const limit = queryInt(req, "limit");
      const cursor = queryString(req, "cursor");
      const page = await useCases.listMessages(requireActor(), familyId, memberId, requireParam(req, "conversationId"), { ...(limit !== undefined ? { limit } : {}), ...(cursor !== undefined ? { cursor } : {}) });
      res.set("Cache-Control", "no-store").json(page);
    }),
  );

  router.post(
    `${BASE}/:conversationId/messages`,
    asyncHandler(async (req, res) => {
      const { familyId, memberId } = ids(req);
      const b = body(req);
      const clientMessageId = optionalString(b.clientMessageId).v;
      const result = await useCases.sendMessage(requireActor(), familyId, memberId, requireParam(req, "conversationId"), { text: String(b.text), ...(clientMessageId !== undefined ? { clientMessageId } : {}) });
      res.set("Cache-Control", "no-store").status(result.created ? 201 : 200).json(result.message);
    }),
  );

  router.put(
    `${BASE}/:conversationId/read`,
    asyncHandler(async (req, res) => {
      const { familyId, memberId } = ids(req);
      const upToSeq = body(req).upToSeq;
      res.set("Cache-Control", "no-store").json(await useCases.markRead(requireActor(), familyId, memberId, requireParam(req, "conversationId"), typeof upToSeq === "number" ? upToSeq : undefined));
    }),
  );

  router.post(
    `${BASE}/:conversationId/close`,
    asyncHandler(async (req, res) => {
      const { familyId, memberId } = ids(req);
      res.set("Cache-Control", "no-store").json(await useCases.closeConversation(requireActor(), familyId, memberId, requireParam(req, "conversationId"), buildRequestContext(req)));
    }),
  );

  router.post(
    `${BASE}/:conversationId/reopen`,
    asyncHandler(async (req, res) => {
      const { familyId, memberId } = ids(req);
      res.set("Cache-Control", "no-store").json(await useCases.reopenConversation(requireActor(), familyId, memberId, requireParam(req, "conversationId"), buildRequestContext(req)));
    }),
  );

  router.post(
    `${BASE}/:conversationId/messages/:messageId/reports`,
    asyncHandler(async (req, res) => {
      const { familyId, memberId } = ids(req);
      const b = body(req);
      const note = optionalString(b.note).v;
      const result = await useCases.reportMessage(
        requireActor(),
        familyId,
        memberId,
        requireParam(req, "conversationId"),
        requireParam(req, "messageId"),
        { reason: String(b.reason), ...(note !== undefined ? { note } : {}) },
        buildRequestContext(req),
      );
      res.set("Cache-Control", "no-store").status(result.created ? 201 : 200).json(result.receipt);
    }),
  );

  return router;
}
