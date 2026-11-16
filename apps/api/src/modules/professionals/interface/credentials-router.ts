// Controllers HTTP de `/professional-portal/credentials*` (UC-MKT-04). `multipart/form-data` (multer do validador OpenAPI → `req.files`).
// O download é um stream mediado: `Cache-Control: private, no-store`, `attachment` com nome GENÉRICO (o nome original nunca se guarda).
import { Router } from "express";
import type { ServerResponse } from "node:http";
import type { Readable } from "node:stream";
import { ValidationError } from "../../../platform/errors/index.js";
import { asyncHandler, buildRequestContext, requireParam, type RequestContext } from "../../../platform/http/index.js";
import type { CredentialDownload, UploadCredentialInput } from "../application/credentials.js";
import type { CredentialRecord } from "../application/ports.js";
import type { ProfessionalActor } from "../application/profile.js";
import { requireProfessionalActor } from "./profile-router.js";

export interface CredentialsController {
  listCredentials: (actor: ProfessionalActor) => Promise<CredentialRecord[]>;
  uploadCredential: (actor: ProfessionalActor, input: UploadCredentialInput, ctx: RequestContext) => Promise<CredentialRecord>;
  deleteCredential: (actor: ProfessionalActor, credentialId: string, ctx: RequestContext) => Promise<void>;
  downloadCredential: (actor: ProfessionalActor, credentialId: string, ctx: RequestContext) => Promise<CredentialDownload>;
}

/** Só metadados (BR-MKT-17): nunca `storageKey`. */
export function toCredentialResponse(c: CredentialRecord) {
  return {
    id: c.id,
    kind: c.kind,
    number: c.number,
    issuingBody: c.issuingBody,
    validUntil: c.validUntil,
    scanStatus: c.scanStatus,
    contentType: c.contentType,
    sizeBytes: c.sizeBytes,
    createdAt: c.createdAt.toISOString(),
  };
}

interface UploadedFile {
  fieldname: string;
  buffer: Buffer;
}

function requireUploadedFile(req: { files?: unknown }): UploadedFile {
  const files = Array.isArray(req.files) ? (req.files as UploadedFile[]) : [];
  const file = files.find((f) => f.fieldname === "file");
  if (!file) throw new ValidationError([{ field: "file", message: "obrigatório" }], { detail: "Ficheiro obrigatório." });
  return file;
}

const EXTENSION: Record<CredentialRecord["contentType"], string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" };

/** Envia o ficheiro como anexo anónimo (sem nome original). Partilhado com a rota do admin (S7). */
export function sendCredentialFile(res: ServerResponse, stream: Readable, contentType: CredentialRecord["contentType"], kind: string): void {
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Content-Disposition", `attachment; filename="credencial-${kind.toLowerCase()}.${EXTENSION[contentType]}"`);
  // Um erro do armazenamento a meio do stream não pode derrubar o processo (sem listener, 'error' é fatal): corta a resposta.
  stream.on("error", () => {
    res.destroy();
  });
  stream.pipe(res);
}

export function createCredentialsRouter(controller: CredentialsController): Router {
  const router = Router();

  router.get(
    "/professional-portal/credentials",
    asyncHandler(async (_req, res) => {
      res.set("Cache-Control", "no-store").json((await controller.listCredentials(requireProfessionalActor())).map(toCredentialResponse));
    }),
  );

  router.post(
    "/professional-portal/credentials",
    asyncHandler(async (req, res) => {
      const file = requireUploadedFile(req);
      const created = await controller.uploadCredential(requireProfessionalActor(), { fields: req.body as Record<string, unknown>, file }, buildRequestContext(req));
      res.status(201).json(toCredentialResponse(created));
    }),
  );

  router.delete(
    "/professional-portal/credentials/:credentialId",
    asyncHandler(async (req, res) => {
      await controller.deleteCredential(requireProfessionalActor(), requireParam(req, "credentialId"), buildRequestContext(req));
      res.status(204).end();
    }),
  );

  router.get(
    "/professional-portal/credentials/:credentialId/file",
    asyncHandler(async (req, res) => {
      const download = await controller.downloadCredential(requireProfessionalActor(), requireParam(req, "credentialId"), buildRequestContext(req));
      sendCredentialFile(res, download.stream, download.contentType, download.kind);
    }),
  );

  return router;
}
