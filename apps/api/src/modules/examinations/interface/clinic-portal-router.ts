// Controllers HTTP de `/clinic-portal/exam-agenda/*` (openapi.yaml operationIds:
// listClinicExamAgenda, cancelClinicExamination,
// completeClinicExamination, uploadClinicExamDocument, deleteClinicExamDocument — tag "Clinic
// Portal", D19/ADR-023). Vive em `examinations/interface` (tal como o de consultas em `appointments`,
// ver `appointments/interface/clinic-portal-router.ts`): a direção `examinations -> clinics` fixada em
// modules.md §2 nunca se inverte. O ator (`ClinicActorInfo`) vem de `platform/actor` — token de clínica
// separado (ADR-020); `main/api.ts` monta este router a seguir ao de `clinics`.
import { Router } from "express";
import { asyncHandler, buildRequestContext, requireParam, type RequestContext } from "../../../platform/http/index.js";
import { getClinicActor } from "../../../platform/actor/index.js";
import { UnauthenticatedError, ValidationError } from "../../../platform/errors/index.js";
import type {
  CancelClinicExaminationInput,
  ClinicExamDocumentView,
  ClinicExamView,
  CompleteClinicExaminationInput,
  ListClinicExamAgendaQuery,
  UploadClinicExamDocumentInput,
} from "../application/clinic-examinations.js";
import type { ClinicPortalActor } from "../application/ports.js";
import type { ClinicExamResultsDraftView, ExamReportDownload } from "../application/results-draft.js";
import { toClinicExamListResponse, toClinicExamResponse } from "./dto.js";

export interface ExaminationsClinicPortalController {
  listClinicExamAgenda: (actor: ClinicPortalActor, query: ListClinicExamAgendaQuery) => Promise<ClinicExamView[]>;
  cancelClinicExamination: (actor: ClinicPortalActor, examinationId: string, input: CancelClinicExaminationInput, context: RequestContext) => Promise<ClinicExamView>;
  completeClinicExamination: (actor: ClinicPortalActor, examinationId: string, input: CompleteClinicExaminationInput, context: RequestContext) => Promise<ClinicExamView>;
  uploadClinicExamDocument: (actor: ClinicPortalActor, examinationId: string, input: UploadClinicExamDocumentInput, context: RequestContext) => Promise<ClinicExamDocumentView>;
  deleteClinicExamDocument: (actor: ClinicPortalActor, examinationId: string, documentId: string, context: RequestContext) => Promise<void>;
  /** M15 T (BR-CLN-47..49). */
  getClinicExamResultsDraft: (actor: ClinicPortalActor, examinationId: string) => Promise<ClinicExamResultsDraftView>;
  saveClinicExamResultsDraft: (actor: ClinicPortalActor, examinationId: string, body: unknown, context: RequestContext) => Promise<ClinicExamResultsDraftView>;
  discardClinicExamResultsDraft: (actor: ClinicPortalActor, examinationId: string, context: RequestContext) => Promise<void>;
  getClinicExamReportPdf: (actor: ClinicPortalActor, examinationId: string, context: RequestContext) => Promise<ExamReportDownload>;
}

/** Forma mínima de um ficheiro de multer (`Express.Multer.File`) — ver `documents/interface/router.ts`. */
interface UploadedFile {
  fieldname: string;
  originalname: string;
  buffer: Buffer;
}

function requireClinicPortalActor(): ClinicPortalActor {
  const actor = getClinicActor();
  if (!actor) {
    throw new UnauthenticatedError({ detail: "Sem sessão válida." });
  }
  return { clinicAccountId: actor.clinicAccountId, clinicId: actor.clinicId, ...(actor.professionalId ? { professionalId: actor.professionalId } : {}) };
}

function queryString(req: { query: Record<string, unknown> }, name: string): string | undefined {
  const value = req.query[name];
  return typeof value === "string" ? value : undefined;
}

function parseDateQuery(value: string | undefined, field: string): Date | undefined {
  if (value === undefined) {
    return undefined;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ValidationError([{ field, message: "data/hora inválida" }], { detail: "Filtro de período inválido." });
  }
  return date;
}

function requireUploadedFile(req: { files?: unknown }): UploadedFile {
  const files = Array.isArray(req.files) ? (req.files as UploadedFile[]) : [];
  const file = files.find((f) => f.fieldname === "file");
  if (!file) {
    throw new ValidationError([{ field: "file", message: "obrigatório" }], { detail: "Ficheiro obrigatório." });
  }
  return file;
}

export function createExaminationsClinicPortalRouter(controller: ExaminationsClinicPortalController): Router {
  const router = Router();

  router.get(
    "/clinic-portal/exam-agenda",
    asyncHandler(async (req, res) => {
      const query: ListClinicExamAgendaQuery = {};
      const from = parseDateQuery(queryString(req, "from"), "from");
      const to = parseDateQuery(queryString(req, "to"), "to");
      if (from) query.from = from;
      if (to) query.to = to;
      res.json(toClinicExamListResponse(await controller.listClinicExamAgenda(requireClinicPortalActor(), query)));
    }),
  );

  router.put(
    "/clinic-portal/exam-agenda/:examinationId/cancel",
    asyncHandler(async (req, res) => {
      const result = await controller.cancelClinicExamination(requireClinicPortalActor(), requireParam(req, "examinationId"), req.body as CancelClinicExaminationInput, buildRequestContext(req));
      res.json(toClinicExamResponse(result));
    }),
  );

  router.put(
    "/clinic-portal/exam-agenda/:examinationId/complete",
    asyncHandler(async (req, res) => {
      const body = req.body as CompleteClinicExaminationInput;
      // M15 T (BR-CLN-47): `results` omitido (≠ `[]`) usa o rascunho; `generateReport` omitido => true (BR-CLN-48).
      const input: CompleteClinicExaminationInput = {
        ...(body.results !== undefined ? { results: body.results } : {}),
        resultNote: body.resultNote ?? null,
        ...(body.generateReport !== undefined ? { generateReport: body.generateReport } : {}),
      };
      const result = await controller.completeClinicExamination(requireClinicPortalActor(), requireParam(req, "examinationId"), input, buildRequestContext(req));
      res.json(toClinicExamResponse(result));
    }),
  );

  router.get(
    "/clinic-portal/exam-agenda/:examinationId/results-draft",
    asyncHandler(async (req, res) => {
      res.json(await controller.getClinicExamResultsDraft(requireClinicPortalActor(), requireParam(req, "examinationId")));
    }),
  );

  router.put(
    "/clinic-portal/exam-agenda/:examinationId/results-draft",
    asyncHandler(async (req, res) => {
      res.json(await controller.saveClinicExamResultsDraft(requireClinicPortalActor(), requireParam(req, "examinationId"), req.body, buildRequestContext(req)));
    }),
  );

  router.delete(
    "/clinic-portal/exam-agenda/:examinationId/results-draft",
    asyncHandler(async (req, res) => {
      await controller.discardClinicExamResultsDraft(requireClinicPortalActor(), requireParam(req, "examinationId"), buildRequestContext(req));
      res.status(204).end();
    }),
  );

  router.get(
    "/clinic-portal/exam-agenda/:examinationId/report/pdf",
    asyncHandler(async (req, res) => {
      const pdf = await controller.getClinicExamReportPdf(requireClinicPortalActor(), requireParam(req, "examinationId"), buildRequestContext(req));
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("Content-Disposition", `inline; filename="${pdf.filename}"`);
      res.send(pdf.bytes);
    }),
  );

  router.post(
    "/clinic-portal/exam-agenda/:examinationId/documents",
    asyncHandler(async (req, res) => {
      const file = requireUploadedFile(req);
      const result = await controller.uploadClinicExamDocument(
        requireClinicPortalActor(),
        requireParam(req, "examinationId"),
        { file: { buffer: file.buffer, originalName: file.originalname } },
        buildRequestContext(req),
      );
      res.status(201).json(result);
    }),
  );

  router.delete(
    "/clinic-portal/exam-agenda/:examinationId/documents/:documentId",
    asyncHandler(async (req, res) => {
      await controller.deleteClinicExamDocument(requireClinicPortalActor(), requireParam(req, "examinationId"), requireParam(req, "documentId"), buildRequestContext(req));
      res.status(204).end();
    }),
  );

  return router;
}
