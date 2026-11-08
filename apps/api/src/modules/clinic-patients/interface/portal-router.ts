// Controllers HTTP de `/clinic-portal/patients*`, `/clinic-portal/search` e `/clinic-portal/calendar` (openapi.yaml
// operationIds: listClinicPatients, createClinicPatient, linkClinicPatient, getClinicPatient, updateClinicPatient,
// getClinicPatientRecord, getClinicSharedHistory, clinicGlobalSearch, getClinicCalendar — tag "Clinic Portal", M14 P).
// O ator vem de `platform/actor` (`getClinicActor`, ADR-020): nunca `AccessPolicy`/`User`.
import { Router } from "express";
import { asyncHandler, buildRequestContext, requireParam, type RequestContext } from "../../../platform/http/index.js";
import { getClinicActor } from "../../../platform/actor/index.js";
import { UnauthenticatedError, ValidationError } from "../../../platform/errors/index.js";
import type { ClinicCalendarView, ClinicSearchView } from "../application/calendar.js";
import type { ClinicFollowUpView, ClinicReportSummaryView } from "../application/reports.js";
import type { LinkClinicPatientInput } from "../application/patient-link.js";
import type { ClinicPatientPageView, ListClinicPatientsQuery } from "../application/patients.js";
import type { ClinicPortalActor } from "../application/ports.js";
import type { ClinicPatientRecordView } from "../application/record.js";
import type { ClinicSharedHistoryView } from "../application/shared-history.js";
import type { ClinicPatientView } from "../application/support.js";
import { toCalendarResponse, toRecordResponse, toSearchResponse } from "./dto.js";

export interface ClinicPatientsPortalController {
  listClinicPatients: (actor: ClinicPortalActor, query: ListClinicPatientsQuery) => Promise<ClinicPatientPageView>;
  createClinicPatient: (actor: ClinicPortalActor, input: Record<string, unknown>, context: RequestContext) => Promise<ClinicPatientView>;
  linkClinicPatient: (actor: ClinicPortalActor, input: LinkClinicPatientInput, context: RequestContext) => Promise<ClinicPatientView>;
  getClinicPatient: (actor: ClinicPortalActor, patientId: string) => Promise<ClinicPatientView>;
  updateClinicPatient: (actor: ClinicPortalActor, patientId: string, input: Record<string, unknown>, context: RequestContext) => Promise<ClinicPatientView>;
  getClinicPatientRecord: (actor: ClinicPortalActor, patientId: string) => Promise<ClinicPatientRecordView>;
  getClinicSharedHistory: (actor: ClinicPortalActor, patientId: string, context: RequestContext) => Promise<ClinicSharedHistoryView>;
  clinicGlobalSearch: (actor: ClinicPortalActor, q: unknown) => Promise<ClinicSearchView>;
  getClinicCalendar: (actor: ClinicPortalActor, query: { from: unknown; to: unknown; professionalId?: string | undefined }) => Promise<ClinicCalendarView>;
  /** M14 Q (BR-CLN-29/30). */
  getClinicReportSummary: (actor: ClinicPortalActor, query: { from: unknown; to: unknown; professionalId?: string | undefined }) => Promise<ClinicReportSummaryView>;
  listClinicFollowUps: (actor: ClinicPortalActor, until: unknown) => Promise<ClinicFollowUpView[]>;
}

function requireClinicPortalActor(): ClinicPortalActor {
  const actor = getClinicActor();
  if (!actor) {
    throw new UnauthenticatedError({ detail: "Sem sessão válida." });
  }
  return { clinicAccountId: actor.clinicAccountId, clinicId: actor.clinicId, ...(actor.professionalId ? { professionalId: actor.professionalId } : {}) };
}

function queryValue(req: { query: Record<string, unknown> }, name: string): string | undefined {
  const value = req.query[name];
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

function parseLimit(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new ValidationError([{ field: "limit", message: "deve estar entre 1 e 100" }], { detail: "Limite inválido." });
  }
  return limit;
}

export function createClinicPatientsPortalRouter(controller: ClinicPatientsPortalController): Router {
  const router = Router();

  router.get(
    "/clinic-portal/patients",
    asyncHandler(async (req, res) => {
      const limit = parseLimit(queryValue(req, "limit"));
      const cursor = queryValue(req, "cursor");
      const result = await controller.listClinicPatients(requireClinicPortalActor(), { q: queryValue(req, "q"), ...(limit !== undefined ? { limit } : {}), ...(cursor ? { cursor } : {}) });
      res.json(result);
    }),
  );

  router.post(
    "/clinic-portal/patients",
    asyncHandler(async (req, res) => {
      res.status(201).json(await controller.createClinicPatient(requireClinicPortalActor(), req.body as Record<string, unknown>, buildRequestContext(req)));
    }),
  );

  router.post(
    "/clinic-portal/patients/link",
    asyncHandler(async (req, res) => {
      const body = req.body as { code?: unknown; clinicPatientId?: string };
      res.json(await controller.linkClinicPatient(requireClinicPortalActor(), { code: body.code, clinicPatientId: body.clinicPatientId }, buildRequestContext(req)));
    }),
  );

  router.get(
    "/clinic-portal/patients/:patientId",
    asyncHandler(async (req, res) => {
      res.json(await controller.getClinicPatient(requireClinicPortalActor(), requireParam(req, "patientId")));
    }),
  );

  router.patch(
    "/clinic-portal/patients/:patientId",
    asyncHandler(async (req, res) => {
      res.json(await controller.updateClinicPatient(requireClinicPortalActor(), requireParam(req, "patientId"), req.body as Record<string, unknown>, buildRequestContext(req)));
    }),
  );

  router.get(
    "/clinic-portal/patients/:patientId/record",
    asyncHandler(async (req, res) => {
      res.json(toRecordResponse(await controller.getClinicPatientRecord(requireClinicPortalActor(), requireParam(req, "patientId"))));
    }),
  );

  router.get(
    "/clinic-portal/patients/:patientId/shared-history",
    asyncHandler(async (req, res) => {
      res.json(await controller.getClinicSharedHistory(requireClinicPortalActor(), requireParam(req, "patientId"), buildRequestContext(req)));
    }),
  );

  router.get(
    "/clinic-portal/search",
    asyncHandler(async (req, res) => {
      res.json(toSearchResponse(await controller.clinicGlobalSearch(requireClinicPortalActor(), queryValue(req, "q"))));
    }),
  );

  router.get(
    "/clinic-portal/calendar",
    asyncHandler(async (req, res) => {
      const professionalId = queryValue(req, "professionalId");
      res.json(toCalendarResponse(await controller.getClinicCalendar(requireClinicPortalActor(), { from: queryValue(req, "from"), to: queryValue(req, "to"), professionalId })));
    }),
  );

  router.get(
    "/clinic-portal/reports/summary",
    asyncHandler(async (req, res) => {
      const professionalId = queryValue(req, "professionalId");
      res.json(await controller.getClinicReportSummary(requireClinicPortalActor(), { from: queryValue(req, "from"), to: queryValue(req, "to"), professionalId }));
    }),
  );

  router.get(
    "/clinic-portal/follow-ups",
    asyncHandler(async (req, res) => {
      res.json(await controller.listClinicFollowUps(requireClinicPortalActor(), queryValue(req, "until")));
    }),
  );

  return router;
}
