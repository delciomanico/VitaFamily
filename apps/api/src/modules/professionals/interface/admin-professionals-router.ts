// Controllers HTTP de `/admin/professionals*` (tag «Admin», UC-MKT-06/10). O ator é o de User (`getActor`) e o guard `PLATFORM_ADMIN` está
// nos casos de uso (como em `clinics`); tokens de profissional/clínica nem chegam aqui (esquema `bearerAuth` ⇒ 401).
import { Router } from "express";
import { getActor } from "../../../platform/actor/index.js";
import { UnauthenticatedError } from "../../../platform/errors/index.js";
import { asyncHandler, buildRequestContext, requireParam, type RequestContext } from "../../../platform/http/index.js";
import type {
  AdminActor,
  AdminCredentialDownload,
  AdminListQuery,
  AdminProfessionalDetailView,
  AdminProfessionalPageView,
} from "../application/admin-professionals.js";
import type { ProfessionalDecision } from "../domain/validation-status.js";
import { sendCredentialFile, toCredentialResponse } from "./credentials-router.js";

export interface AdminProfessionalsController {
  list: (actor: AdminActor, query: AdminListQuery) => Promise<AdminProfessionalPageView>;
  get: (actor: AdminActor, professionalId: string) => Promise<AdminProfessionalDetailView>;
  decide: (actor: AdminActor, professionalId: string, input: { decision: ProfessionalDecision; reason?: string }, ctx: RequestContext) => Promise<AdminProfessionalDetailView>;
  downloadCredential: (actor: AdminActor, professionalId: string, credentialId: string, ctx: RequestContext) => Promise<AdminCredentialDownload>;
}

function requireAdminActor(): AdminActor {
  const actor = getActor();
  if (!actor) throw new UnauthenticatedError({ detail: "Sem sessão válida." });
  return { userId: actor.userId, platformAdmin: actor.platformAdmin };
}

function str(req: { query: Record<string, unknown> }, name: string): string | undefined {
  const v = req.query[name];
  return typeof v === "string" ? v : undefined;
}

function toDetailResponse(d: AdminProfessionalDetailView) {
  return {
    id: d.id,
    email: d.email,
    emailVerifiedAt: d.emailVerifiedAt?.toISOString() ?? null,
    displayName: d.displayName,
    bio: d.bio,
    city: d.city,
    validationStatus: d.validationStatus,
    statusReason: d.statusReason,
    statusChangedAt: d.statusChangedAt.toISOString(),
    submittedAt: d.submittedAt?.toISOString() ?? null,
    approvedAt: d.approvedAt?.toISOString() ?? null,
    specialties: d.specialties,
    credentials: d.credentials.map(toCredentialResponse),
    history: d.history.map((h) => ({ id: h.id, action: h.action, fromStatus: h.fromStatus, toStatus: h.toStatus, actor: h.actor, reason: h.reason, createdAt: h.createdAt.toISOString() })),
    createdAt: d.createdAt.toISOString(),
  };
}

export function createAdminProfessionalsRouter(controller: AdminProfessionalsController): Router {
  const router = Router();

  router.get(
    "/admin/professionals",
    asyncHandler(async (req, res) => {
      // O validador OpenAPI já converteu `limit` para número.
      const limit = req.query.limit;
      const status = str(req, "status") as AdminListQuery["status"];
      const category = str(req, "category") as AdminListQuery["category"];
      const q = str(req, "q");
      const cursor = str(req, "cursor");
      const page = await controller.list(requireAdminActor(), {
        ...(status ? { status } : {}),
        ...(category ? { category } : {}),
        ...(q ? { q } : {}),
        ...(limit !== undefined ? { limit: Number(limit) } : {}),
        ...(cursor ? { cursor } : {}),
      });
      res.set("Cache-Control", "no-store").json({
        items: page.items.map((i) => ({ ...i, submittedAt: i.submittedAt?.toISOString() ?? null, createdAt: i.createdAt.toISOString() })),
        nextCursor: page.nextCursor,
      });
    }),
  );

  router.get(
    "/admin/professionals/:professionalId",
    asyncHandler(async (req, res) => {
      res.set("Cache-Control", "no-store").json(toDetailResponse(await controller.get(requireAdminActor(), requireParam(req, "professionalId"))));
    }),
  );

  router.post(
    "/admin/professionals/:professionalId/decisions",
    asyncHandler(async (req, res) => {
      const body = req.body as { decision: ProfessionalDecision; reason?: string };
      const detail = await controller.decide(requireAdminActor(), requireParam(req, "professionalId"), { decision: body.decision, ...(body.reason !== undefined ? { reason: body.reason } : {}) }, buildRequestContext(req));
      res.set("Cache-Control", "no-store").json(toDetailResponse(detail));
    }),
  );

  router.get(
    "/admin/professionals/:professionalId/credentials/:credentialId/file",
    asyncHandler(async (req, res) => {
      const download = await controller.downloadCredential(requireAdminActor(), requireParam(req, "professionalId"), requireParam(req, "credentialId"), buildRequestContext(req));
      sendCredentialFile(res, download.stream, download.contentType, download.kind);
    }),
  );

  return router;
}
