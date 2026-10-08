// Controllers HTTP de `/users/me*` (openapi.yaml operationIds: getMe, updateMe, deleteMe,
// acceptTerms). Autenticação/ator já garantidos pelo middleware do módulo `auth` (M1); aqui só se
// lê `getActor()` (platform/actor) e se traduz pedido/resposta.
import { Router } from "express";
import { asyncHandler, buildRequestContext, type RequestContext } from "../../../platform/http/index.js";
import { getActor } from "../../../platform/actor/index.js";
import { UnauthenticatedError } from "../../../platform/errors/index.js";
import type { UserView } from "../application/get-me.js";
import type { UpdateMeInput } from "../application/update-me.js";
import { toUserResponse } from "./dto.js";

export interface UsersController {
  getMe: (userId: string) => Promise<UserView>;
  updateMe: (userId: string, input: UpdateMeInput, ctx: RequestContext) => Promise<UserView>;
  acceptTerms: (userId: string, termsVersion: string, ctx: RequestContext) => Promise<void>;
  deleteMe: (userId: string, password: string) => Promise<never>;
}

function requireActor(): { userId: string } {
  const actor = getActor();
  if (!actor) {
    throw new UnauthenticatedError({ detail: "Sem sessão válida." });
  }
  return actor;
}

export function createUsersRouter(controller: UsersController): Router {
  const router = Router();

  router.get(
    "/users/me",
    asyncHandler(async (_req, res) => {
      const actor = requireActor();
      const user = await controller.getMe(actor.userId);
      res.json(toUserResponse(user));
    }),
  );

  router.patch(
    "/users/me",
    asyncHandler(async (req, res) => {
      const actor = requireActor();
      const body = req.body as UpdateMeInput;
      const user = await controller.updateMe(actor.userId, body, buildRequestContext(req));
      res.json(toUserResponse(user));
    }),
  );

  router.post(
    "/users/me/terms-acceptance",
    asyncHandler(async (req, res) => {
      const actor = requireActor();
      const body = req.body as { termsVersion: string };
      await controller.acceptTerms(actor.userId, body.termsVersion, buildRequestContext(req));
      res.status(204).end();
    }),
  );

  router.delete(
    "/users/me",
    asyncHandler(async (req, res) => {
      const actor = requireActor();
      const body = req.body as { password: string };
      await controller.deleteMe(actor.userId, body.password);
      res.status(204).end();
    }),
  );

  return router;
}
