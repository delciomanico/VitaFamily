// Controllers HTTP de `admin` (openapi.yaml operationIds: adminListUsers, adminSuspendUser,
// adminReactivateUser — tag "Admin"). As rotas `/admin/clinics` continuam em `clinics`
// (modules.md §3 nota 14).
import { Router } from "express";
import { getActor } from "../../../platform/actor/index.js";
import { UnauthenticatedError } from "../../../platform/errors/index.js";
import { asyncHandler, buildRequestContext, requireParam } from "../../../platform/http/index.js";
import type { ActorIdentity, AdminClinicAccountView, AdminListUsersQuery, AdminUserDetailView, AdminUserView, RequestContext, SuspendClinicAccountInput, SuspendUserInput } from "../application/accounts.js";

export interface AdminController {
  adminListUsers: (actor: ActorIdentity, query: AdminListUsersQuery) => Promise<{ items: AdminUserView[]; nextCursor: string | null }>;
  adminSuspendUser: (actor: ActorIdentity, userId: string, input: SuspendUserInput, context: RequestContext) => Promise<void>;
  adminReactivateUser: (actor: ActorIdentity, userId: string, context: RequestContext) => Promise<void>;
  adminGetUser: (actor: ActorIdentity, userId: string) => Promise<AdminUserDetailView>;
  adminResetUserAccess: (actor: ActorIdentity, userId: string, context: RequestContext) => Promise<void>;
  adminListClinicAccounts: (actor: ActorIdentity, clinicId: string) => Promise<AdminClinicAccountView[]>;
  adminSuspendClinicAccount: (actor: ActorIdentity, clinicId: string, clinicAccountId: string, input: SuspendClinicAccountInput, context: RequestContext) => Promise<void>;
  adminReactivateClinicAccount: (actor: ActorIdentity, clinicId: string, clinicAccountId: string, context: RequestContext) => Promise<void>;
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
      const q = queryString(req, "q");
      const status = queryString(req, "status");
      const limit = queryString(req, "limit");
      const cursor = queryString(req, "cursor");
      const result = await controller.adminListUsers(requireActor(), {
        ...(q ? { q } : {}),
        ...(status ? { status } : {}),
        ...(limit ? { limit } : {}),
        ...(cursor ? { cursor } : {}),
      });
      res.json({
        items: result.items.map((u) => ({ id: u.id, email: u.email, name: u.name, status: u.status, createdAt: u.createdAt.toISOString() })),
        nextCursor: result.nextCursor,
      });
    }),
  );

  router.get(
    "/admin/users/:userId",
    asyncHandler(async (req, res) => {
      const d = await controller.adminGetUser(requireActor(), requireParam(req, "userId"));
      res.json({
        id: d.id,
        email: d.email,
        name: d.name,
        status: d.status,
        platformRole: d.platformRole,
        emailVerifiedAt: d.emailVerifiedAt?.toISOString() ?? null,
        createdAt: d.createdAt.toISOString(),
        suspendedAt: d.suspendedAt?.toISOString() ?? null,
        suspensionReason: d.suspensionReason,
        familiesCount: d.familiesCount,
        activeSessionsCount: d.activeSessionsCount,
        lastSessionUsedAt: d.lastSessionUsedAt?.toISOString() ?? null,
      });
    }),
  );

  router.post(
    "/admin/users/:userId/reset-access",
    asyncHandler(async (req, res) => {
      await controller.adminResetUserAccess(requireActor(), requireParam(req, "userId"), buildRequestContext(req));
      res.status(204).end();
    }),
  );

  router.get(
    "/admin/clinics/:clinicId/accounts",
    asyncHandler(async (req, res) => {
      const accounts = await controller.adminListClinicAccounts(requireActor(), requireParam(req, "clinicId"));
      res.json(
        accounts.map((a) => ({
          id: a.id,
          clinicId: a.clinicId,
          email: a.email,
          role: a.role,
          status: a.status,
          createdAt: a.createdAt.toISOString(),
          lastLoginAt: a.lastLoginAt?.toISOString() ?? null,
          suspendedAt: a.suspendedAt?.toISOString() ?? null,
        })),
      );
    }),
  );

  router.post(
    "/admin/clinics/:clinicId/accounts/:clinicAccountId/suspend",
    asyncHandler(async (req, res) => {
      await controller.adminSuspendClinicAccount(
        requireActor(),
        requireParam(req, "clinicId"),
        requireParam(req, "clinicAccountId"),
        req.body as SuspendClinicAccountInput,
        buildRequestContext(req),
      );
      res.status(204).end();
    }),
  );

  router.post(
    "/admin/clinics/:clinicId/accounts/:clinicAccountId/reactivate",
    asyncHandler(async (req, res) => {
      await controller.adminReactivateClinicAccount(requireActor(), requireParam(req, "clinicId"), requireParam(req, "clinicAccountId"), buildRequestContext(req));
      res.status(204).end();
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
