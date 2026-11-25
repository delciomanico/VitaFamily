// Controllers HTTP do assistente de IA (tag «AiAssistant»; UC-AI-01..05). Autorização e limites na `application`. Respostas `no-store`; este router
// nunca regista corpo nem query (podem trazer contexto) e nunca recebe sintomas, resposta nem chaves. Montado só com `AI_ASSISTANT_ENABLED=true`
// (senão as rotas nem existem ⇒ 404, BR-AI-14).
import { createHash } from "node:crypto";
import { Router, type Request } from "express";
import { getActor } from "../../../platform/actor/index.js";
import { UnauthenticatedError } from "../../../platform/errors/index.js";
import { asyncHandler, buildRequestContext, requireParam } from "../../../platform/http/index.js";
import type { AiConsents } from "../application/consents.js";
import type { AiSessions } from "../application/sessions.js";
import type { ActorIdentity } from "../application/ports.js";

const BASE = "/families/:familyId/members/:memberId/ai";

function requireActor(): ActorIdentity {
  const actor = getActor();
  if (!actor) throw new UnauthenticatedError({ detail: "Sem sessão válida." });
  return { userId: actor.userId, platformAdmin: actor.platformAdmin };
}

const body = (req: Request): Record<string, unknown> => (typeof req.body === "object" && req.body !== null ? (req.body as Record<string, unknown>) : {});

export function createAiAssistantRouter(consents: AiConsents, sessions: AiSessions): Router {
  const router = Router();
  const ids = (req: Request) => ({ familyId: requireParam(req, "familyId"), memberId: requireParam(req, "memberId") });

  router.get(
    "/ai/guardrails",
    asyncHandler(async (req, res) => {
      requireActor();
      const guardrails = await sessions.getGuardrails();
      const etag = `"${createHash("sha256").update(JSON.stringify(guardrails)).digest("hex").slice(0, 32)}"`;
      res.set("Cache-Control", "private, max-age=3600").set("ETag", etag);
      if (req.get("If-None-Match") === etag) {
        res.status(304).end();
        return;
      }
      res.json(guardrails);
    }),
  );

  router.get(
    `${BASE}/consents`,
    asyncHandler(async (req, res) => {
      const { familyId, memberId } = ids(req);
      res.set("Cache-Control", "no-store").json(await consents.list(requireActor(), familyId, memberId));
    }),
  );

  router.put(
    `${BASE}/consents/:provider`,
    asyncHandler(async (req, res) => {
      const { familyId, memberId } = ids(req);
      const view = await consents.grant(requireActor(), familyId, memberId, requireParam(req, "provider"), body(req), buildRequestContext(req));
      res.set("Cache-Control", "no-store").json(view);
    }),
  );

  router.delete(
    `${BASE}/consents/:provider`,
    asyncHandler(async (req, res) => {
      const { familyId, memberId } = ids(req);
      await consents.revoke(requireActor(), familyId, memberId, requireParam(req, "provider"), buildRequestContext(req));
      res.set("Cache-Control", "no-store").status(204).end();
    }),
  );

  router.post(
    `${BASE}/sessions`,
    asyncHandler(async (req, res) => {
      const { familyId, memberId } = ids(req);
      const view = await sessions.createSession(requireActor(), familyId, memberId, body(req), buildRequestContext(req));
      res.set("Cache-Control", "no-store").status(201).json(view);
    }),
  );

  router.post(
    `${BASE}/session-outcomes`,
    asyncHandler(async (req, res) => {
      const { familyId, memberId } = ids(req);
      await sessions.reportOutcome(requireActor(), familyId, memberId, body(req), buildRequestContext(req));
      res.set("Cache-Control", "no-store").status(204).end();
    }),
  );

  return router;
}
