// Controllers HTTP de `documents` (openapi.yaml operationIds: uploadDocument, listDocuments,
// getDocument, deleteDocument, downloadDocument — tag "Documents"). `uploadDocument` é
// `multipart/form-data`; o ficheiro chega em `req.files` (multer, já ligado pelo
// `express-openapi-validator` em `platform/http`, `fileUploader` por defeito) — sem depender dos
// tipos ambiente de "multer" (não é dependência direta deste módulo, conventions.md §3.9: a camada
// `interface` não importa bibliotecas de I/O), só da forma mínima do objeto que o multer produz.
import { Router } from "express";
import { asyncHandler, buildRequestContext, requireParam } from "../../../platform/http/index.js";
import { getActor } from "../../../platform/actor/index.js";
import { UnauthenticatedError, ValidationError } from "../../../platform/errors/index.js";
import type { Document, ResourceType } from "../domain/document.js";
import type { ListDocumentsQuery } from "../application/list-documents.js";
import type { DownloadDocumentResult } from "../application/download-document.js";
import type { ActorIdentity, RequestContext } from "../application/ports.js";
import type { UploadDocumentInput } from "../application/upload-document.js";
import { contentDispositionHeader, toDocumentResponse } from "./dto.js";

export interface DocumentsController {
  uploadDocument: (
    actor: ActorIdentity,
    familyId: string,
    memberId: string,
    input: UploadDocumentInput,
    context: RequestContext,
  ) => Promise<Document>;
  listDocuments: (
    actor: ActorIdentity,
    familyId: string,
    memberId: string,
    query: ListDocumentsQuery,
  ) => Promise<Document[]>;
  getDocument: (actor: ActorIdentity, familyId: string, memberId: string, documentId: string) => Promise<Document>;
  deleteDocument: (
    actor: ActorIdentity,
    familyId: string,
    memberId: string,
    documentId: string,
    context: RequestContext,
  ) => Promise<void>;
  downloadDocument: (
    actor: ActorIdentity,
    familyId: string,
    memberId: string,
    documentId: string,
    context: RequestContext,
  ) => Promise<DownloadDocumentResult>;
}

/** Forma mínima de um ficheiro de multer (`Express.Multer.File`) — ver nota de topo. */
interface UploadedFile {
  fieldname: string;
  originalname: string;
  buffer: Buffer;
}

function requireActor(): ActorIdentity {
  const actor = getActor();
  if (!actor) {
    throw new UnauthenticatedError({ detail: "Sem sessão válida." });
  }
  return { userId: actor.userId, platformAdmin: actor.platformAdmin };
}

function requireUploadedFile(req: { files?: unknown }): UploadedFile {
  const files = Array.isArray(req.files) ? (req.files as UploadedFile[]) : [];
  const file = files.find((f) => f.fieldname === "file");
  if (!file) {
    throw new ValidationError([{ field: "file", message: "obrigatório" }], { detail: "Ficheiro obrigatório." });
  }
  return file;
}

function requireBodyString(body: unknown, field: string): string {
  const value = (body as Record<string, unknown> | null)?.[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new ValidationError([{ field, message: "obrigatório" }], { detail: "Dados inválidos." });
  }
  return value;
}

function isResourceType(value: string): value is ResourceType {
  return value === "PRESCRIPTION" || value === "EXAMINATION";
}

export function createDocumentsRouter(controller: DocumentsController): Router {
  const router = Router();

  router.post(
    "/families/:familyId/members/:memberId/documents",
    asyncHandler(async (req, res) => {
      const file = requireUploadedFile(req);
      const resourceTypeRaw = requireBodyString(req.body, "resourceType");
      if (!isResourceType(resourceTypeRaw)) {
        throw new ValidationError([{ field: "resourceType", message: "PRESCRIPTION ou EXAMINATION" }], {
          detail: "Dados inválidos.",
        });
      }
      const resourceId = requireBodyString(req.body, "resourceId");

      const result = await controller.uploadDocument(
        requireActor(),
        requireParam(req, "familyId"),
        requireParam(req, "memberId"),
        {
          resourceType: resourceTypeRaw,
          resourceId,
          file: { buffer: file.buffer, originalName: file.originalname },
        },
        buildRequestContext(req),
      );
      res.status(201).json(toDocumentResponse(result));
    }),
  );

  router.get(
    "/families/:familyId/members/:memberId/documents",
    asyncHandler(async (req, res) => {
      const resourceType = typeof req.query.resourceType === "string" ? req.query.resourceType : undefined;
      const resourceId = typeof req.query.resourceId === "string" ? req.query.resourceId : undefined;
      const query: ListDocumentsQuery = {
        ...(resourceType && isResourceType(resourceType) ? { resourceType } : {}),
        ...(resourceId ? { resourceId } : {}),
      };
      const result = await controller.listDocuments(
        requireActor(),
        requireParam(req, "familyId"),
        requireParam(req, "memberId"),
        query,
      );
      res.json(result.map(toDocumentResponse));
    }),
  );

  router.get(
    "/families/:familyId/members/:memberId/documents/:documentId",
    asyncHandler(async (req, res) => {
      const result = await controller.getDocument(
        requireActor(),
        requireParam(req, "familyId"),
        requireParam(req, "memberId"),
        requireParam(req, "documentId"),
      );
      res.json(toDocumentResponse(result));
    }),
  );

  router.delete(
    "/families/:familyId/members/:memberId/documents/:documentId",
    asyncHandler(async (req, res) => {
      await controller.deleteDocument(
        requireActor(),
        requireParam(req, "familyId"),
        requireParam(req, "memberId"),
        requireParam(req, "documentId"),
        buildRequestContext(req),
      );
      res.status(204).end();
    }),
  );

  router.get(
    "/families/:familyId/members/:memberId/documents/:documentId/download",
    asyncHandler(async (req, res) => {
      const { document, stream } = await controller.downloadDocument(
        requireActor(),
        requireParam(req, "familyId"),
        requireParam(req, "memberId"),
        requireParam(req, "documentId"),
        buildRequestContext(req),
      );
      // ADR-006/BR-DOC-04: nunca cacheável, entrega mediada (nunca URL pública).
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("Content-Type", document.mimeType);
      res.setHeader("Content-Disposition", contentDispositionHeader(document.originalName));
      stream.on("error", () => res.destroy());
      stream.pipe(res);
    }),
  );

  return router;
}
