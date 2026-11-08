// HTTP (supertest + express-openapi-validator contra docs/05-api/openapi.yaml, SEM base de dados): confirmação ativa, fluxo do dia,
// retorno e indicadores (M14 Q, BR-CLN-25..30, AC-CLN-20..24, TC-CLN-13..16, TC-AZ-CLN-V4). Os casos de uso reais de `appointments` e
// `clinic-patients` correm sobre os fakes das fixtures, ligados como no composition root.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RequestHandler } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { FixedClock } from "../../src/platform/clock/index.js";
import { runWithActor } from "../../src/platform/actor/index.js";
import { ForbiddenError } from "../../src/platform/errors/index.js";
import { createApp } from "../../src/platform/http/index.js";
import { createLogger } from "../../src/platform/logger/index.js";
import {
  createArriveClinicAppointmentUseCase,
  createClearClinicFollowUpUseCase,
  createConfirmClinicAppointmentByPhoneUseCase,
  createNoShowClinicAppointmentUseCase,
  createSetClinicFollowUpUseCase,
  createStartClinicAppointmentUseCase,
} from "../../src/modules/appointments/application/clinic-day-flow.js";
import { createCancelClinicAppointmentUseCase, createCompleteClinicAppointmentUseCase, createListClinicAgendaUseCase, createListClinicRequestsUseCase, createRespondClinicRequestUseCase } from "../../src/modules/appointments/application/clinic-appointments.js";
import { createClinicPatientLookupUseCase, createCreateWalkInAppointmentUseCase } from "../../src/modules/appointments/application/clinic-walk-in.js";
import { createAppointmentsFixtures } from "../../src/modules/appointments/application/fixtures.js";
import { createSetAppointmentConfirmationUseCase } from "../../src/modules/appointments/application/set-appointment-confirmation.js";
import type { Appointment } from "../../src/modules/appointments/domain/appointment.js";
import { createAppointmentsClinicPortalRouter } from "../../src/modules/appointments/interface/clinic-portal-router.js";
import { createAppointmentsRouter, type AppointmentsController } from "../../src/modules/appointments/interface/router.js";
import { signAccessToken } from "../../src/modules/auth/domain/jwt.js";
import { createBearerAuthSecurityHandler } from "../../src/modules/auth/interface/middleware.js";
import { createGetClinicCalendarUseCase } from "../../src/modules/clinic-patients/application/calendar.js";
import {
  createCountActiveVisitsBySlotUseCase,
  createEnsureLinkedByEmailUseCase,
  createFindPatientIdsByMembersUseCase,
  createResolvePatientUseCase,
} from "../../src/modules/clinic-patients/application/directory.js";
import { createClinicPatientsFixtures } from "../../src/modules/clinic-patients/application/fixtures.js";
import { createGetClinicReportSummaryUseCase, createListClinicFollowUpsUseCase } from "../../src/modules/clinic-patients/application/reports.js";
import {
  createArriveVisitUseCase,
  createClearVisitFollowUpUseCase,
  createConfirmVisitUseCase,
  createNoShowVisitUseCase,
  createSetVisitFollowUpUseCase,
  createStartVisitUseCase,
} from "../../src/modules/clinic-patients/application/visit-day-flow.js";
import { createBookVisitUseCase, createCancelVisitUseCase, createCompleteVisitUseCase, createListVisitsUseCase } from "../../src/modules/clinic-patients/application/visits.js";
import { createClinicPatientsPortalRouter } from "../../src/modules/clinic-patients/interface/portal-router.js";
import { signClinicAccessToken } from "../../src/modules/clinics/domain/clinic-jwt.js";
import { createClinicActorContextMiddleware, createClinicBearerAuthSecurityHandler } from "../../src/modules/clinics/interface/clinic-portal-middleware.js";
import { signInsuranceAccessToken } from "../../src/modules/insurance/domain/insurance-jwt.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const OPENAPI_SPEC_PATH = join(REPO_ROOT, "docs/05-api/openapi.yaml");
const NOW = new Date("2026-01-15T10:00:00.000Z");
const TODAY_PM = new Date("2026-01-15T15:00:00.000Z");
const FUTURE = new Date("2026-02-01T09:00:00.000Z");
const FAMILY = "11111111-1111-4111-8111-111111111111";
const MEMBER = "22222222-2222-4222-8222-222222222222";
const CLINIC_A = "33333333-3333-4333-8333-333333333333";
const CLINIC_B = "44444444-4444-4444-8444-444444444444";
const ACCOUNT_ADMIN = "55555555-5555-4555-8555-555555555555";
const ACCOUNT_MANAGER = "66666666-6666-4666-8666-666666666666";
const ACCOUNT_B = "77777777-7777-4777-8777-777777777778";
const USER = "77777777-7777-4777-8777-777777777771";
const SESSION = "88888888-8888-4888-8888-888888888888";
const SLOT = "99999999-9999-4999-8999-999999999999";
const SLOT_V = "99999999-9999-4999-8999-999999999998";
const PROFESSIONAL = "cccccccc-cccc-4ccc-8ccc-cccccccccc01";
const PROFESSIONAL_B = "cccccccc-cccc-4ccc-8ccc-cccccccccc02";
const APT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01";
const APT_DONE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02";
const APT_PRIVATE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03";
const UNKNOWN = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const KEYS = [{ kid: "k1", secret: new TextEncoder().encode("0123456789abcdef0123456789abcdef") }];
const API = "/api/v1";
/** O relógio injetado avança dias nos testes: tokens de longa duração. */
const LONG_TTL = 3 * 365 * 86_400;

async function buildHarness() {
  const clock = new FixedClock(NOW);
  const ap = createAppointmentsFixtures(clock);
  const cp = createClinicPatientsFixtures(clock);
  ap.clinics.seed(CLINIC_A, "Clínica Sol", "");
  const slot = (id: string, startsAt: Date, professionalId?: string) => {
    const base = { id, clinicId: CLINIC_A, kind: "APPOINTMENT" as const, specialty: "Cardiologia", startsAt, durationMinutes: 30, capacity: 1, ...(professionalId ? { professionalId, professionalName: "Dra. Lima" } : {}) };
    ap.clinics.seedSlot(base);
    cp.slots.seed(base);
  };
  slot(SLOT, TODAY_PM, PROFESSIONAL);
  slot(SLOT_V, new Date(TODAY_PM.getTime() + 3_600_000));
  cp.slots.professionals.set(PROFESSIONAL, { id: PROFESSIONAL, clinicId: CLINIC_A, name: "Dra. Lima" });
  cp.slots.professionals.set(PROFESSIONAL_B, { id: PROFESSIONAL_B, clinicId: CLINIC_B, name: "Dr. Alheio" });
  ap.memberNames.seed(FAMILY, MEMBER, "Maria Santos Silva");
  cp.members.names.set(MEMBER, "Maria Santos Silva");
  const seed = (overrides: Partial<Appointment> & { id: string }, withSlot = true): void => {
    const appointment: Appointment = { familyId: FAMILY, memberId: MEMBER, scheduledAt: TODAY_PM, status: "SCHEDULED", confirmationStatus: "PENDING", clinicId: CLINIC_A, slotId: SLOT, createdAt: NOW, ...overrides };
    if (!withSlot) delete appointment.slotId;
    ap.appointmentsRepo.seed(appointment);
  };
  seed({ id: APT });
  seed({ id: APT_DONE, status: "COMPLETED", scheduledAt: new Date("2026-01-10T10:00:00.000Z") }, false);
  seed({ id: APT_PRIVATE, scheduledAt: FUTURE }, false); // consulta sem clínica parceira (sem slotId)

  ap.deps.clinicPatients = {
    resolvePatient: createResolvePatientUseCase(cp.deps),
    ensureLinkedByEmail: createEnsureLinkedByEmailUseCase(cp.deps),
    bookVisit: createBookVisitUseCase(cp.deps),
    listVisits: createListVisitsUseCase(cp.deps),
    cancelVisit: createCancelVisitUseCase(cp.deps),
    completeVisit: createCompleteVisitUseCase(cp.deps),
    confirmVisit: createConfirmVisitUseCase(cp.deps),
    arriveVisit: createArriveVisitUseCase(cp.deps),
    startVisit: createStartVisitUseCase(cp.deps),
    noShowVisit: createNoShowVisitUseCase(cp.deps),
    setVisitFollowUp: createSetVisitFollowUpUseCase(cp.deps),
    clearVisitFollowUp: createClearVisitFollowUpUseCase(cp.deps),
    countActiveVisitsBySlot: createCountActiveVisitsBySlotUseCase(cp.deps),
    findPatientIdsByMembers: createFindPatientIdsByMembersUseCase(cp.deps),
  };
  const toFact = (a: Appointment) => ({
    id: a.id, status: a.status, startsAt: a.scheduledAt, durationMinutes: a.durationMinutes ?? 30, familyId: a.familyId, memberId: a.memberId, confirmationStatus: a.confirmationStatus,
    ...(a.slotId ? { slotId: a.slotId } : {}), ...(a.arrivedAt ? { arrivedAt: a.arrivedAt } : {}), ...(a.startedAt ? { startedAt: a.startedAt } : {}),
  });
  cp.calendar.listAppointments = async (trx, clinicId, window) => (await ap.appointmentsRepo.listForClinic(trx, clinicId, window)).map(toFact);
  cp.calendar.listAppointmentFollowUps = async (trx, clinicId, until, limit) =>
    (await ap.appointmentsRepo.listFollowUpsByClinic(trx, clinicId, until, limit)).flatMap((a) => (a.followUpDueOn ? [{ id: a.id, familyId: a.familyId, memberId: a.memberId, dueOn: a.followUpDueOn }] : []));

  const userController = { setAppointmentConfirmation: createSetAppointmentConfirmationUseCase(ap.deps) } as unknown as AppointmentsController;
  const apRouter = createAppointmentsClinicPortalRouter({
    listClinicRequests: createListClinicRequestsUseCase(ap.deps),
    respondClinicRequest: createRespondClinicRequestUseCase(ap.deps),
    listClinicAgenda: createListClinicAgendaUseCase(ap.deps),
    cancelClinicAppointment: createCancelClinicAppointmentUseCase(ap.deps),
    completeClinicAppointment: createCompleteClinicAppointmentUseCase(ap.deps),
    confirmClinicAppointmentByPhone: createConfirmClinicAppointmentByPhoneUseCase(ap.deps),
    arriveClinicAppointment: createArriveClinicAppointmentUseCase(ap.deps),
    startClinicAppointment: createStartClinicAppointmentUseCase(ap.deps),
    noShowClinicAppointment: createNoShowClinicAppointmentUseCase(ap.deps),
    setClinicFollowUp: createSetClinicFollowUpUseCase(ap.deps),
    clearClinicFollowUp: createClearClinicFollowUpUseCase(ap.deps),
    clinicPatientLookup: createClinicPatientLookupUseCase(ap.deps),
    createClinicWalkInAppointment: createCreateWalkInAppointmentUseCase(ap.deps),
  });
  const cpRouter = createClinicPatientsPortalRouter({
    getClinicCalendar: createGetClinicCalendarUseCase(cp.deps),
    getClinicReportSummary: createGetClinicReportSummaryUseCase(cp.deps),
    listClinicFollowUps: createListClinicFollowUpsUseCase(cp.deps),
  } as unknown as Parameters<typeof createClinicPatientsPortalRouter>[0]);

  const userActorMiddleware: RequestHandler = (req, _res, next) => {
    if (!req.authSubject) {
      next();
      return;
    }
    runWithActor({ userId: req.authSubject.userId, platformAdmin: false }, () => {
      next();
    });
  };
  const clinicActorMiddleware = createClinicActorContextMiddleware({
    resolveClinicActorState: (clinicAccountId, sessionId) =>
      Promise.resolve({
        clinicAccountId,
        sessionId,
        clinicId: clinicAccountId === ACCOUNT_B ? CLINIC_B : CLINIC_A,
        role: clinicAccountId === ACCOUNT_ADMIN ? ("CLINIC_ADMIN" as const) : ("CLINIC_MANAGER" as const),
        suspended: false,
      }),
  });
  const actorContextMiddleware: RequestHandler = (req, res, next) => {
    userActorMiddleware(req, res, (err?: unknown) => {
      if (err) {
        next(err);
        return;
      }
      clinicActorMiddleware(req, res, next);
    });
  };
  const app = createApp({
    openApiSpecPath: OPENAPI_SPEC_PATH,
    logger: createLogger({ level: "silent" }),
    securityHandlers: {
      bearerAuth: createBearerAuthSecurityHandler({ signingKeys: KEYS, clock }),
      clinicBearerAuth: createClinicBearerAuthSecurityHandler({ signingKeys: KEYS, clock }),
    },
    actorContextMiddleware,
    registerHealthRoutes: (router) => {
      router.get("/health", (_req, res) => res.json({ status: "ok" }));
    },
    registerRoutes: (router) => {
      router.use(createAppointmentsRouter(userController));
      router.use(cpRouter);
      router.use(apRouter);
    },
  });
  const clinicToken = async (account: string) => (await signClinicAccessToken({ subject: { clinicAccountId: account, sessionId: SESSION }, now: NOW, ttlSeconds: LONG_TTL, signingKeys: KEYS })).token;
  return {
    app, ap, cp, clock,
    userToken: (await signAccessToken({ subject: { userId: USER, sessionId: SESSION }, now: NOW, ttlSeconds: 900, signingKeys: KEYS })).token,
    insuranceToken: (await signInsuranceAccessToken({ subject: { insuranceAccountId: ACCOUNT_ADMIN, sessionId: SESSION }, now: NOW, ttlSeconds: 900, signingKeys: KEYS })).token,
    admin: await clinicToken(ACCOUNT_ADMIN),
    manager: await clinicToken(ACCOUNT_MANAGER),
    otherClinic: await clinicToken(ACCOUNT_B),
  };
}
type Harness = Awaited<ReturnType<typeof buildHarness>>;
const confirmation = (h: Harness, token: string, id: string, body: unknown) =>
  request(h.app).put(`${API}/families/${FAMILY}/members/${MEMBER}/appointments/${id}/confirmation`).set("Authorization", `Bearer ${token}`).send(body as object);
const act = (h: Harness, token: string, id: string, action: string) => request(h.app).put(`${API}/clinic-portal/agenda/${id}/${action}`).set("Authorization", `Bearer ${token}`);

describe("PUT …/appointments/{id}/confirmation (família, AC-CLN-20)", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildHarness();
  });

  it("GOING => 200 Appointment CONFIRMED (idempotente); CANNOT => CANCELLED/DECLINED; GOING depois de CANNOT => 409 INVALID_STATE_TRANSITION", async () => {
    const going = await confirmation(h, h.userToken, APT, { response: "GOING" });
    expect(going.status).toBe(200);
    expect(going.body).toMatchObject({ id: APT, status: "SCHEDULED", confirmationStatus: "CONFIRMED", followUpDueOn: null });
    expect((await confirmation(h, h.userToken, APT, { response: "GOING" })).status).toBe(200);
    const cannot = await confirmation(h, h.userToken, APT, { response: "CANNOT" });
    expect(cannot.status).toBe(200);
    expect(cannot.body).toMatchObject({ status: "CANCELLED", confirmationStatus: "DECLINED" });
    expect((await confirmation(h, h.userToken, APT, { response: "CANNOT" })).status).toBe(200);
    const late = await confirmation(h, h.userToken, APT, { response: "GOING" });
    expect(late.status).toBe(409);
    expect(late.body).toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("422 corpo inválido; 422 clínica sem parceria; 404 consulta inexistente; 403 sem permissão; 401 sem token ou com token de clínica", async () => {
    expect((await confirmation(h, h.userToken, APT, { response: "TALVEZ" })).status).toBe(422);
    expect((await confirmation(h, h.userToken, APT, {})).status).toBe(422);
    const privateRes = await confirmation(h, h.userToken, APT_PRIVATE, { response: "GOING" });
    expect(privateRes.status).toBe(422);
    expect(privateRes.body).toMatchObject({ code: "VALIDATION_ERROR" });
    expect((await confirmation(h, h.userToken, UNKNOWN, { response: "GOING" })).status).toBe(404);
    h.ap.policy.denyWith = new ForbiddenError({ detail: "Sem permissão." });
    expect((await confirmation(h, h.userToken, APT, { response: "GOING" })).status).toBe(403);
    h.ap.policy.denyWith = undefined as unknown as Error;
    expect((await request(h.app).put(`${API}/families/${FAMILY}/members/${MEMBER}/appointments/${APT}/confirmation`).send({ response: "GOING" })).status).toBe(401);
    expect((await confirmation(h, h.admin, APT, { response: "GOING" })).status).toBe(401);
  });
});

describe("PUT /clinic-portal/agenda/{id}/confirm|arrive|start|no-show (AC-CLN-22, TC-AZ-CLN-V4)", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildHarness();
  });

  it("consulta Vita: confirm, arrive, start (200 ClinicBooking) por ambos os papéis; a app só vê SCHEDULED; complete continua igual", async () => {
    const confirmed = await act(h, h.admin, APT, "confirm");
    expect(confirmed.status).toBe(200);
    expect(confirmed.body).toMatchObject({ id: APT, status: "SCHEDULED", confirmationStatus: "CONFIRMED", confirmationSource: "CLINIC", dayState: "SCHEDULED", source: "VITA", arrivedAt: null, waitingMinutes: null });
    const arrived = await act(h, h.manager, APT, "arrive");
    expect(arrived.body).toMatchObject({ status: "SCHEDULED", dayState: "ARRIVED", arrivedAt: NOW.toISOString(), waitingMinutes: 0 });
    h.clock.advance(12 * 60_000);
    const started = await act(h, h.admin, APT, "start");
    expect(started.body).toMatchObject({ status: "SCHEDULED", dayState: "IN_PROGRESS", waitingMinutes: 12 });
    expect(JSON.stringify(arrived.body)).not.toMatch(new RegExp(`${FAMILY}|${MEMBER}`));
    const done = await request(h.app).put(`${API}/clinic-portal/agenda/${APT}/complete`).set("Authorization", `Bearer ${h.manager}`).send({ outcomeNote: "ok" });
    expect(done.body).toMatchObject({ status: "COMPLETED", dayState: "COMPLETED" });
    const mine = await request(h.app).get(`${API}/clinic-portal/calendar`).query({ from: "2026-01-15T00:00:00Z", to: "2026-01-16T00:00:00Z" }).set("Authorization", `Bearer ${h.admin}`);
    expect(mine.status).toBe(200);
    expect((mine.body as { entries: { id: string; dayState: string; confirmationStatus: string }[] }).entries.find((e) => e.id === APT)).toMatchObject({ dayState: "COMPLETED", confirmationStatus: "CONFIRMED" });
  });

  it("no-show: 409 antes da hora; depois da hora => NO_SHOW e arrive volta a SCHEDULED", async () => {
    expect((await act(h, h.admin, APT, "no-show")).status).toBe(409);
    h.clock.advance(6 * 3_600_000);
    const noShow = await act(h, h.admin, APT, "no-show");
    expect(noShow.status).toBe(200);
    expect(noShow.body).toMatchObject({ status: "NO_SHOW", dayState: "NO_SHOW" });
    const late = await act(h, h.admin, APT, "arrive");
    expect(late.body).toMatchObject({ status: "SCHEDULED", dayState: "ARRIVED" });
  });

  it("arrive/start fora do dia local => 409 INVALID_STATE_TRANSITION", async () => {
    h.clock.advance(24 * 3_600_000);
    for (const action of ["arrive", "start"]) {
      const res = await act(h, h.admin, APT, action);
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    }
  });

  it("visita manual: o mesmo caminho /agenda/{id}/… despacha para a visita (ambas as ações)", async () => {
    h.cp.visitsRepo.byId.set("visit-1", { id: "visit-1", clinicId: CLINIC_A, clinicPatientId: "cp-1", scheduledAt: new Date(TODAY_PM.getTime() + 3_600_000), durationMinutes: 30, status: "SCHEDULED", confirmationStatus: "PENDING", createdAt: NOW } as never);
    h.cp.patientsRepo.byId.set("cp-1", { id: "cp-1", clinicId: CLINIC_A, name: "Zé Manuel", origin: "MANUAL", createdAt: NOW, updatedAt: NOW });
    const visitId = "visit-1";
    // ids de visita não são UUID neste fake: usa um UUID real
    const uuid = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01";
    const visit = h.cp.visitsRepo.byId.get(visitId);
    if (!visit) throw new Error("visita em falta");
    h.cp.visitsRepo.byId.delete(visitId);
    h.cp.visitsRepo.byId.set(uuid, { ...visit, id: uuid });
    const confirmed = await act(h, h.admin, uuid, "confirm");
    expect(confirmed.body).toMatchObject({ id: uuid, source: "MANUAL", confirmationStatus: "CONFIRMED", confirmationSource: "CLINIC", patientName: "Zé Manuel" });
    expect((await act(h, h.manager, uuid, "arrive")).body).toMatchObject({ dayState: "ARRIVED" });
    expect((await act(h, h.manager, uuid, "start")).body).toMatchObject({ dayState: "IN_PROGRESS", status: "SCHEDULED" });
    expect((await act(h, h.otherClinic, uuid, "arrive")).status).toBe(404);
  });

  it("isolamento: outra clínica => 404 em todas as ações; id desconhecido => 404; id não-UUID => 400 (validação do contrato); token de User/seguradora ou sem token => 401", async () => {
    for (const action of ["confirm", "arrive", "start", "no-show"]) {
      expect((await act(h, h.otherClinic, APT, action)).status).toBe(404);
      expect((await act(h, h.admin, UNKNOWN, action)).status).toBe(404);
      expect((await act(h, h.admin, "nao-e-uuid", action)).status).toBe(400);
      expect((await act(h, h.userToken, APT, action)).status).toBe(401);
      expect((await act(h, h.insuranceToken, APT, action)).status).toBe(401);
      expect((await request(h.app).put(`${API}/clinic-portal/agenda/${APT}/${action}`)).status).toBe(401);
    }
    expect((await h.ap.appointmentsRepo.findByClinicId({}, CLINIC_A, APT))?.arrivedAt).toBeUndefined();
  });

  it("a clínica não escreve DECLINED: não há rota nem corpo para isso; cancelar exige motivo (fluxo existente)", async () => {
    const res = await request(h.app).put(`${API}/clinic-portal/agenda/${APT}/confirm`).set("Authorization", `Bearer ${h.admin}`).send({ confirmationStatus: "DECLINED" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ confirmationStatus: "CONFIRMED" });
  });
});

describe("PUT|DELETE /clinic-portal/agenda/{id}/follow-up e GET /clinic-portal/follow-ups (AC-CLN-24)", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildHarness();
  });
  const put = (h2: Harness, token: string, id: string, body: unknown) => request(h2.app).put(`${API}/clinic-portal/agenda/${id}/follow-up`).set("Authorization", `Bearer ${token}`).send(body as object);

  it("PUT calcula followUpDueOn, substitui, aparece em /follow-ups (ordenado, sem ids Vita) e DELETE limpa (idempotente)", async () => {
    const set = await put(h, h.admin, APT_DONE, { amount: 3, unit: "MONTHS" });
    expect(set.status).toBe(200);
    expect(set.body).toMatchObject({ id: APT_DONE, status: "COMPLETED", followUpDueOn: "2026-04-10" });
    expect((await put(h, h.manager, APT_DONE, { amount: 2, unit: "WEEKS" })).body).toMatchObject({ followUpDueOn: "2026-01-24" });
    const list = await request(h.app).get(`${API}/clinic-portal/follow-ups`).set("Authorization", `Bearer ${h.manager}`);
    expect(list.status).toBe(200);
    expect(list.body).toEqual([{ bookingId: APT_DONE, source: "VITA", clinicPatientId: null, patientName: "Maria Santos Silva", patientPhone: null, dueOn: "2026-01-24", patientNotified: false }]);
    expect(JSON.stringify(list.body)).not.toMatch(new RegExp(`${FAMILY}|${MEMBER}`));
    expect((await request(h.app).get(`${API}/clinic-portal/follow-ups`).query({ until: "2026-01-20" }).set("Authorization", `Bearer ${h.admin}`)).body).toEqual([]);
    for (let i = 0; i < 2; i++) {
      const cleared = await request(h.app).delete(`${API}/clinic-portal/agenda/${APT_DONE}/follow-up`).set("Authorization", `Bearer ${h.admin}`);
      expect(cleared.status).toBe(200);
      expect(cleared.body).toMatchObject({ followUpDueOn: null });
    }
    expect((await request(h.app).get(`${API}/clinic-portal/follow-ups`).set("Authorization", `Bearer ${h.admin}`)).body).toEqual([]);
  });

  it("amount 0/25 ou unit inválida => 422; não COMPLETED => 409; outra clínica => 404; sem/errado token => 401; until com formato inválido => 400 (validação do contrato, como os restantes filtros de data)", async () => {
    for (const body of [{ amount: 0, unit: "WEEKS" }, { amount: 25, unit: "MONTHS" }, { amount: 2, unit: "DAYS" }, { unit: "WEEKS" }, { amount: 1.5, unit: "WEEKS" }]) {
      expect((await put(h, h.admin, APT_DONE, body)).status).toBe(422);
    }
    const open = await put(h, h.admin, APT, { amount: 2, unit: "WEEKS" });
    expect(open.status).toBe(409);
    expect(open.body).toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect((await put(h, h.otherClinic, APT_DONE, { amount: 2, unit: "WEEKS" })).status).toBe(404);
    expect((await request(h.app).delete(`${API}/clinic-portal/agenda/${APT_DONE}/follow-up`).set("Authorization", `Bearer ${h.otherClinic}`)).status).toBe(404);
    expect((await put(h, h.userToken, APT_DONE, { amount: 2, unit: "WEEKS" })).status).toBe(401);
    expect((await request(h.app).get(`${API}/clinic-portal/follow-ups`).set("Authorization", `Bearer ${h.userToken}`)).status).toBe(401);
    expect((await request(h.app).get(`${API}/clinic-portal/follow-ups`).query({ until: "amanhã" }).set("Authorization", `Bearer ${h.admin}`)).status).toBe(400);
    expect((await request(h.app).get(`${API}/clinic-portal/follow-ups`).set("Authorization", `Bearer ${h.otherClinic}`)).body).toEqual([]);
  });
});

describe("GET /clinic-portal/reports/summary (AC-CLN-23)", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildHarness();
  });
  const summary = (h2: Harness, token: string, query: Record<string, string>) => request(h2.app).get(`${API}/clinic-portal/reports/summary`).query(query).set("Authorization", `Bearer ${token}`);

  it("200 com totals e byProfessional (sem PII); ambos os papéis; filtro por profissional", async () => {
    await act(h, h.admin, APT, "confirm");
    const res = await summary(h, h.manager, { from: "2026-01-01", to: "2026-01-31" });
    expect(res.status).toBe(200);
    const body = res.body as { from: string; to: string; totals: Record<string, unknown>; byProfessional: Record<string, unknown>[] };
    expect(body).toMatchObject({ from: "2026-01-01", to: "2026-01-31" });
    expect(body.totals).toMatchObject({ slotsTotal: 2, slotsBooked: 1, completed: 1, noShows: 0, cancellations: 0, declinedByPatient: 0, newPatients: 0, examsCompleted: 0 });
    expect(body.totals.occupancyRate).toBe(0.5);
    expect(body.byProfessional.map((r) => r.professionalName)).toEqual(["Dra. Lima", null]);
    expect(JSON.stringify(res.body)).not.toMatch(/Maria|Zé|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?<!cccccccc-cccc-4ccc-8ccc-cccccccccc01)/);
    const filtered = await summary(h, h.admin, { from: "2026-01-01", to: "2026-01-31", professionalId: PROFESSIONAL });
    expect(filtered.status).toBe(200);
    expect((filtered.body as { byProfessional: unknown[] }).byProfessional).toHaveLength(1);
  });

  it("400 parâmetro em falta; 422 janela invertida ou > 366 dias; 404 profissional de outra clínica; 401 tokens errados", async () => {
    expect((await summary(h, h.admin, { from: "2026-01-01" })).status).toBe(400);
    expect((await summary(h, h.admin, { from: "2026-02-01", to: "2026-01-01" })).status).toBe(422);
    expect((await summary(h, h.admin, { from: "2025-01-01", to: "2026-01-31" })).status).toBe(422);
    expect((await summary(h, h.admin, { from: "2026-01-01", to: "2026-01-31", professionalId: PROFESSIONAL_B })).status).toBe(404);
    expect((await summary(h, h.userToken, { from: "2026-01-01", to: "2026-01-31" })).status).toBe(401);
    expect((await summary(h, h.insuranceToken, { from: "2026-01-01", to: "2026-01-31" })).status).toBe(401);
    expect((await request(h.app).get(`${API}/clinic-portal/reports/summary`).query({ from: "2026-01-01", to: "2026-01-31" })).status).toBe(401);
  });

  it("o 31.º pedido por minuto => 429 RATE_LIMITED com Retry-After; outra conta livre", async () => {
    for (let i = 0; i < 30; i++) expect((await summary(h, h.admin, { from: "2026-01-01", to: "2026-01-31" })).status).toBe(200);
    const limited = await summary(h, h.admin, { from: "2026-01-01", to: "2026-01-31" });
    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({ code: "RATE_LIMITED" });
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
    expect((await summary(h, h.manager, { from: "2026-01-01", to: "2026-01-31" })).status).toBe(200);
  });
});
