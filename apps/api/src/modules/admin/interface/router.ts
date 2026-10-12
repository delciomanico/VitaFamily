// Controllers HTTP de `admin` (openapi.yaml operationIds: adminListUsers, adminSuspendUser,
// adminReactivateUser — tag "Admin"). As rotas `/admin/clinics` continuam em `clinics`
// (modules.md §3 nota 14).
import { Router } from "express";
import { getActor } from "../../../platform/actor/index.js";
import { UnauthenticatedError } from "../../../platform/errors/index.js";
import { asyncHandler, buildRequestContext, requireParam } from "../../../platform/http/index.js";
import type { ActorIdentity, AdminListUsersQuery, AdminUserView, RequestContext, SuspendUserInput } from "../application/accounts.js";

export interface AdminController {
  adminListUsers: (actor: ActorIdentity, query: AdminListUsersQuery) => Promise<{ items: AdminUserView[]; nextCursor: string | null }>;
  adminSuspendUser: (actor: ActorIdentity, userId: string, input: SuspendUserInput, context: RequestContext) => Promise<void>;
  adminReactivateUser: (actor: ActorIdentity, userId: string, context: RequestContext) => Promise<void>;
}

function requireActor(): ActorIdentity {
  const actor = getActor();
  if (!actor) {
    throw new UnauthenticatedError({ detail: "Sem sessão válida." });
  }
  return { userId: actor.userId, platformAdmin: actor.platformAdmin };
}

function queryString(req: { query: Record<string, unknown> }, name: string): string | undefined {
  const value = req.query[name];
  return typeof value === "string" ? value : undefined;
}

export function createAdminRouter(controller: AdminController): Router {
  const router = Router();

  router.get(
    "/admin/users",
    asyncHandler(async (req, res) => {
      const status = queryString(req, "status");
      const limit = queryString(req, "limit");
      const cursor = queryString(req, "cursor");
      const result = await controller.adminListUsers(requireActor(), {
        ...(status ? { status } : {}),
        ...(limit ? { limit } : {}),
        ...(cursor ? { cursor } : {}),
      });
      res.json({
        items: result.items.map((u) => ({ id: u.id, email: u.email, status: u.status, createdAt: u.createdAt.toISOString() })),
        nextCursor: result.nextCursor,
      });
    }),
  );

  router.post(
    "/admin/users/:userId/suspend",
    asyncHandler(async (req, res) => {
      await controller.adminSuspendUser(requireActor(), requireParam(req, "userId"), req.body as SuspendUserInput, buildRequestContext(req));
      res.status(204).end();
    }),
  );

  router.post(
    "/admin/users/:userId/reactivate",
    asyncHandler(async (req, res) => {
      await controller.adminReactivateUser(requireActor(), requireParam(req, "userId"), buildRequestContext(req));
      res.status(204).end();
    }),
  );

  return router;
}
