// Controllers HTTP de `examinations` (openapi.yaml operationIds: listExaminations,
// createExamination, getExamination, updateExamination, deleteExamination,
// setExaminationStatus, addExamResult, updateExamResult, deleteExamResult, examResultHistory —
// tag "Examinations").
import { Router } from "express";
import { asyncHandler, buildRequestContext, requireParam } from "../../../platform/http/index.js";
import { getActor } from "../../../platform/actor/index.js";
import { UnauthenticatedError } from "../../../platform/errors/index.js";
import type { AddExamResultInput } from "../application/add-exam-result.js";
import type { CreateExaminationInput } from "../application/create-examination.js";
import type { ExamResultHistoryQuery } from "../application/exam-result-history.js";
import type { ExaminationView } from "../application/examination-view.js";
import type { ListExaminationsQuery } from "../application/list-examinations.js";
import type { ActorIdentity, CursorPage, ExamResult, ExamResultHistoryItem, RequestContext } from "../application/ports.js";
import type { SetExaminationStatusInput } from "../application/set-examination-status.js";
import type { UpdateExaminationInput } from "../application/update-examination.js";
import type { UpdateExamResultInput } from "../application/update-exam-result.js";
import { toExamResultHistoryResponse, toExamResultResponse, toExaminationPage, toExaminationResponse } from "./dto.js";

export interface ExaminationsController {
  listExaminations: (actor: ActorIdentity, familyId: string, memberId: string, query: ListExaminationsQuery, context: RequestContext) => Promise<CursorPage<ExaminationView>>;
  createExamination: (actor: ActorIdentity, familyId: string, memberId: string, input: CreateExaminationInput, context: RequestContext) => Promise<ExaminationView>;
  getExamination: (actor: ActorIdentity, familyId: string, memberId: string, examinationId: string, context: RequestContext) => Promise<ExaminationView>;
  updateExamination: (actor: ActorIdentity, familyId: string, memberId: string, examinationId: string, input: UpdateExaminationInput, context: RequestContext) => Promise<ExaminationView>;
  deleteExamination: (actor: ActorIdentity, familyId: string, memberId: string, examinationId: string, context: RequestContext) => Promise<void>;
  setExaminationStatus: (
    actor: ActorIdentity,
    familyId: string,
    memberId: string,
    examinationId: string,
    input: SetExaminationStatusInput,
    context: RequestContext,
  ) => Promise<ExaminationView>;
  addExamResult: (actor: ActorIdentity, familyId: string, memberId: string, examinationId: string, input: AddExamResultInput, context: RequestContext) => Promise<ExamResult>;
  updateExamResult: (
    actor: ActorIdentity,
    familyId: string,
    memberId: string,
    examinationId: string,
    resultId: string,
    input: UpdateExamResultInput,
    context: RequestContext,
  ) => Promise<ExamResult>;
  deleteExamResult: (actor: ActorIdentity, familyId: string, memberId: string, examinationId: string, resultId: string, context: RequestContext) => Promise<void>;
  examResultHistory: (actor: ActorIdentity, familyId: string, memberId: string, query: ExamResultHistoryQuery, context: RequestContext) => Promise<ExamResultHistoryItem[]>;
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

export function createExaminationsRouter(controller: ExaminationsController): Router {
  const router = Router();

  router.get(
    "/families/:familyId/members/:memberId/examinations",
    asyncHandler(async (req, res) => {
      const query: ListExaminationsQuery = {};
      for (const name of ["status", "from", "to", "limit", "cursor"] as const) {
        const value = queryString(req, name);
        if (value !== undefined) {
          query[name] = value;
        }
      }
      const result = await controller.listExaminations(requireActor(), requireParam(req, "familyId"), requireParam(req, "memberId"), query, buildRequestContext(req));
      res.json(toExaminationPage(result));
    }),
  );

  router.post(
    "/families/:familyId/members/:memberId/examinations",
    asyncHandler(async (req, res) => {
      const result = await controller.createExamination(
        requireActor(),
        requireParam(req, "familyId"),
        requireParam(req, "memberId"),
        req.body as CreateExaminationInput,
        buildRequestContext(req),
      );
      res.status(201).json(toExaminationResponse(result));
    }),
  );

  router.get(
    "/families/:familyId/members/:memberId/examinations/:examinationId",
    asyncHandler(async (req, res) => {
      const result = await controller.getExamination(
        requireActor(),
        requireParam(req, "familyId"),
        requireParam(req, "memberId"),
        requireParam(req, "examinationId"),
        buildRequestContext(req),
      );
      res.json(toExaminationResponse(result));
    }),
  );

  router.patch(
    "/families/:familyId/members/:memberId/examinations/:examinationId",
    asyncHandler(async (req, res) => {
      const result = await controller.updateExamination(
        requireActor(),
        requireParam(req, "familyId"),
        requireParam(req, "memberId"),
        requireParam(req, "examinationId"),
        req.body as UpdateExaminationInput,
        buildRequestContext(req),
      );
      res.json(toExaminationResponse(result));
    }),
  );

  router.delete(
    "/families/:familyId/members/:memberId/examinations/:examinationId",
    asyncHandler(async (req, res) => {
      await controller.deleteExamination(requireActor(), requireParam(req, "familyId"), requireParam(req, "memberId"), requireParam(req, "examinationId"), buildRequestContext(req));
      res.status(204).end();
    }),
  );

  router.put(
    "/families/:familyId/members/:memberId/examinations/:examinationId/status",
    asyncHandler(async (req, res) => {
      const result = await controller.setExaminationStatus(
        requireActor(),
        requireParam(req, "familyId"),
        requireParam(req, "memberId"),
        requireParam(req, "examinationId"),
        req.body as SetExaminationStatusInput,
        buildRequestContext(req),
      );
      res.json(toExaminationResponse(result));
    }),
  );

  router.post(
    "/families/:familyId/members/:memberId/examinations/:examinationId/results",
    asyncHandler(async (req, res) => {
      const result = await controller.addExamResult(
        requireActor(),
        requireParam(req, "familyId"),
        requireParam(req, "memberId"),
        requireParam(req, "examinationId"),
        req.body as AddExamResultInput,
        buildRequestContext(req),
      );
      res.status(201).json(toExamResultResponse(result));
    }),
  );

  router.patch(
    "/families/:familyId/members/:memberId/examinations/:examinationId/results/:resultId",
    asyncHandler(async (req, res) => {
      const result = await controller.updateExamResult(
        requireActor(),
        requireParam(req, "familyId"),
        requireParam(req, "memberId"),
        requireParam(req, "examinationId"),
        requireParam(req, "resultId"),
        req.body as UpdateExamResultInput,
        buildRequestContext(req),
      );
      res.json(toExamResultResponse(result));
    }),
  );

  router.delete(
    "/families/:familyId/members/:memberId/examinations/:examinationId/results/:resultId",
    asyncHandler(async (req, res) => {
      await controller.deleteExamResult(
        requireActor(),
        requireParam(req, "familyId"),
        requireParam(req, "memberId"),
        requireParam(req, "examinationId"),
        requireParam(req, "resultId"),
        buildRequestContext(req),
      );
      res.status(204).end();
    }),
  );

  router.get(
    "/families/:familyId/members/:memberId/exam-results",
    asyncHandler(async (req, res) => {
      const parameter = queryString(req, "parameter");
      const result = await controller.examResultHistory(
        requireActor(),
        requireParam(req, "familyId"),
        requireParam(req, "memberId"),
        { ...(parameter !== undefined ? { parameter } : {}) },
        buildRequestContext(req),
      );
      res.json(toExamResultHistoryResponse(result));
    }),
  );

  return router;
}
