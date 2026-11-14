// Controllers HTTP de `/clinic-portal/authorizations*` (marco B fatia 3; openapi tag "Clinic Portal", ADR-034, authorization.md §6.2b/§8.4).
// O ator vem SEMPRE do token da clínica (`getClinicActor`), nunca do corpo/query/caminho. A matriz papel×rota (Médico ⇒ FORBIDDEN)
// está em `clinics/domain/clinic-portal-access.ts` e cada caso de uso volta a decidir o papel (defesa em profundidade).
import { Router } from "express";
import { getClinicActor } from "../../../platform/actor/index.js";
import { UnauthenticatedError, ValidationError } from "../../../platform/errors/index.js";
import { asyncHandler, buildRequestContext, requireParam } from "../../../platform/http/index.js";
import type { Page } from "../../../platform/page/index.js";
import type { ClinicOpsActor } from "../domain/access.js";
import type { AuthorizationAttachment } from "../domain/authorization.js";
import type { UploadedAttachment } from "../application/add-authorization-attachment.js";
import type { AuthorizationView } from "../application/authorization-support.js";
import type { ListAuthorizationsQuery } from "../application/list-authorizations.js";
import type { RequestContext } from "./types.js";
import { toAuthorizationAttachmentResponse, toAuthorizationDetailResponse, toAuthorizationPageResponse, toAuthorizationResponse } from "./dto.js";

export interface InsurerClinicAuthorizationsController {
  createAuthorization: (actor: ClinicOpsActor, body: unknown, ctx: RequestContext) => Promise<AuthorizationView>;
  listAuthorizations: (actor: ClinicOpsActor, query: ListAuthorizationsQuery) => Promise<Page<AuthorizationView>>;
  getAuthorization: (actor: ClinicOpsActor, authorizationId: string) => Promise<AuthorizationView>;
  respondAuthorization: (actor: ClinicOpsActor, authorizationId: string, body: unknown, ctx: RequestContext) => Promise<AuthorizationView>;
  cancelAuthorization: (actor: ClinicOpsActor, authorizationId: string, body: unknown, ctx: RequestContext) => Promise<AuthorizationView>;
  appealAuthorization: (actor: ClinicOpsActor, authorizationId: string, body: unknown, ctx: RequestContext) => Promise<AuthorizationView>;
  addAuthorizationAttachment: (actor: ClinicOpsActor, authorizationId: string, input: { kind: unknown; file: UploadedAttachment }, ctx: RequestContext) => Promise<AuthorizationAttachment>;
  removeAuthorizationAttachment: (actor: ClinicOpsActor, authorizationId: string, attachmentId: string, ctx: RequestContext) => Promise<void>;
}

function requireClinicActor(): ClinicOpsActor {
  const actor = getClinicActor();
  if (!actor) throw new UnauthenticatedError({ detail: "Sem sessão válida." });
  return { clinicAccountId: actor.clinicAccountId, clinicId: actor.clinicId, role: actor.role };
}

const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

/** Forma mínima de um ficheiro de multer (o módulo não importa bibliotecas de I/O). */
interface MulterFile {
  fieldname: string;
  buffer: Buffer;
  originalname: string;
}

function requireUploadedFile(req: { files?: unknown }): UploadedAttachment {
  const files = Array.isArray(req.files) ? (req.files as MulterFile[]) : [];
  const file = files.find((f) => f.fieldname === "file");
  if (!file) throw new ValidationError([{ field: "file", message: "obrigatório" }], { detail: "Ficheiro obrigatório." });
  return { buffer: file.buffer, originalName: file.originalname };
}

export function createClinicAuthorizationsRouter(c: InsurerClinicAuthorizationsController): Router {
  const router = Router();
  const base = "/clinic-portal/authorizations";
  // Dados de terceiros (pedidos, anexos): nunca em cache.
  router.use(base, (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  router.post(base, asyncHandler(async (req, res) => {
    res.status(201).json(toAuthorizationResponse(await c.createAuthorization(requireClinicActor(), req.body, buildRequestContext(req))));
  }));
  router.get(base, asyncHandler(async (req, res) => {
    const q = req.query as Record<string, unknown>;
    const query: ListAuthorizationsQuery = { insurerId: str(q.insurerId), status: str(q.status), processId: str(q.processId), limit: str(q.limit), cursor: str(q.cursor) };
    res.json(toAuthorizationPageResponse(await c.listAuthorizations(requireClinicActor(), query)));
  }));
  router.get(`${base}/:authorizationId`, asyncHandler(async (req, res) => {
    res.json(toAuthorizationDetailResponse(await c.getAuthorization(requireClinicActor(), requireParam(req, "authorizationId"))));
  }));
  router.post(`${base}/:authorizationId/respond`, asyncHandler(async (req, res) => {
    res.json(toAuthorizationDetailResponse(await c.respondAuthorization(requireClinicActor(), requireParam(req, "authorizationId"), req.body, buildRequestContext(req))));
  }));
  router.post(`${base}/:authorizationId/cancel`, asyncHandler(async (req, res) => {
    res.json(toAuthorizationDetailResponse(await c.cancelAuthorization(requireClinicActor(), requireParam(req, "authorizationId"), req.body, buildRequestContext(req))));
  }));
  router.post(`${base}/:authorizationId/appeals`, asyncHandler(async (req, res) => {
    res.status(201).json(toAuthorizationResponse(await c.appealAuthorization(requireClinicActor(), requireParam(req, "authorizationId"), req.body, buildRequestContext(req))));
  }));
  router.post(`${base}/:authorizationId/attachments`, asyncHandler(async (req, res) => {
    const file = requireUploadedFile(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    res.status(201).json(toAuthorizationAttachmentResponse(await c.addAuthorizationAttachment(requireClinicActor(), requireParam(req, "authorizationId"), { kind: body.kind, file }, buildRequestContext(req))));
  }));
  router.delete(`${base}/:authorizationId/attachments/:attachmentId`, asyncHandler(async (req, res) => {
    await c.removeAuthorizationAttachment(requireClinicActor(), requireParam(req, "authorizationId"), requireParam(req, "attachmentId"), buildRequestContext(req));
    res.status(204).end();
  }));

  return router;
}
