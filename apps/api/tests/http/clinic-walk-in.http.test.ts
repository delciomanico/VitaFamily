// HTTP (supertest + express-openapi-validator contra docs/05-api/openapi.yaml, SEM base de dados): marcação
// presencial pela clínica (D20, ADR-024, BR-CLN-10, AC-CLN-05/06, TC-CLN-03). Os casos de uso reais correm
// sobre os fakes das fixtures. Cobre: oráculo uniforme, ausência de ids, 422/429+Retry-After, ordem de
// validação, isolamento entre clínicas, ambos os papéis, tokens de User/seguradora rejeitados, e a consulta
// no SELF do paciente e na agenda da clínica, com cancelar/completar pelos fluxos existentes.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RequestHandler } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { FixedClock } from "../../src/platform/clock/index.js";
import { runWithActor } from "../../src/platform/actor/index.js";
import { createApp } from "../../src/platform/http/index.js";
import { createLogger } from "../../src/platform/logger/index.js";
import { createCancelClinicAppointmentUseCase, createCompleteClinicAppointmentUseCase, createListClinicAgendaUseCase, createListClinicRequestsUseCase, createRespondClinicRequestUseCase } from "../../src/modules/appointments/application/clinic-appointments.js";
import { createArriveClinicAppointmentUseCase, createClearClinicFollowUpUseCase, createConfirmClinicAppointmentByPhoneUseCase, createNoShowClinicAppointmentUseCase, createSetClinicFollowUpUseCase, createStartClinicAppointmentUseCase } from "../../src/modules/appointments/application/clinic-day-flow.js";
import { createClinicPatientLookupUseCase, createCreateWalkInAppointmentUseCase } from "../../src/modules/appointments/application/clinic-walk-in.js";
import { createAppointmentsFixtures } from "../../src/modules/appointments/application/fixtures.js";
import { createListAppointmentsUseCase } from "../../src/modules/appointments/application/list-appointments.js";
import { createAppointmentsClinicPortalRouter } from "../../src/modules/appointments/interface/clinic-portal-router.js";
import { createAppointmentsRouter, type AppointmentsController } from "../../src/modules/appointments/interface/router.js";
import { signAccessToken } from "../../src/modules/auth/domain/jwt.js";
import { createBearerAuthSecurityHandler } from "../../src/modules/auth/interface/middleware.js";
import { signClinicAccessToken } from "../../src/modules/clinics/domain/clinic-jwt.js";
import { createClinicActorContextMiddleware, createClinicBearerAuthSecurityHandler } from "../../src/modules/clinics/interface/clinic-portal-middleware.js";
import { signInsuranceAccessToken } from "../../src/modules/insurance/domain/insurance-jwt.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const OPENAPI_SPEC_PATH = join(REPO_ROOT, "docs/05-api/openapi.yaml");
const NOW = new Date("2026-01-15T10:00:00.000Z");
const SLOT_AT = new Date("2026-02-01T09:00:00.000Z");
const FAMILY = "11111111-1111-4111-8111-111111111111";
const MEMBER = "22222222-2222-4222-8222-222222222222";
const CLINIC_A = "33333333-3333-4333-8333-333333333333";
const CLINIC_B = "44444444-4444-4444-8444-444444444444";
const ACCOUNT_ADMIN = "55555555-5555-4555-8555-555555555555";
const ACCOUNT_MANAGER = "66666666-6666-4666-8666-666666666666";
const ACCOUNT_B = "77777777-7777-4777-8777-777777777778";
const USER = "77777777-7777-4777-8777-777777777777";
const SESSION = "88888888-8888-4888-8888-888888888888";
const SLOT = "99999999-9999-4999-8999-999999999999";
const SLOT_2 = "99999999-9999-4999-8999-999999999998";
const SLOT_EXAM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SLOT_PAST = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab";
const SLOT_OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const EMAIL = "maria.silva@example.pt";
const KEYS = [{ kid: "k1", secret: new TextEncoder().encode("0123456789abcdef0123456789abcdef") }];
const API = "/api/v1";

async function buildHarness() {
  const clock = new FixedClock(NOW);
  const fx = createAppointmentsFixtures(clock);
  fx.clinics.seed(CLINIC_A, "Clínica Sol", "");
  const slot = (id: string, clinicId: string, kind: "APPOINTMENT" | "EXAM", startsAt: Date): void => {
    fx.clinics.seedSlot({ id, clinicId, kind, specialty: kind === "EXAM" ? "Ecografia" : "Cardiologia", startsAt, durationMinutes: 30, capacity: kind === "EXAM" ? 2 : 1 });
  };
  slot(SLOT, CLINIC_A, "APPOINTMENT", SLOT_AT);
  slot(SLOT_2, CLINIC_A, "APPOINTMENT", new Date(SLOT_AT.getTime() + 10 * 60_000));
  slot(SLOT_EXAM, CLINIC_A, "EXAM", SLOT_AT);
  slot(SLOT_PAST, CLINIC_A, "APPOINTMENT", new Date("2026-01-01T09:00:00.000Z"));
  slot(SLOT_OTHER, CLINIC_B, "APPOINTMENT", SLOT_AT);
  fx.patients.seed(EMAIL, FAMILY, MEMBER, "Maria Santos Silva");
  fx.memberNames.seed(FAMILY, MEMBER, "Maria Santos Silva");

  const userController = { listAppointments: createListAppointmentsUseCase(fx.deps) } as unknown as AppointmentsController;
  const clinicRouter = createAppointmentsClinicPortalRouter({
    listClinicRequests: createListClinicRequestsUseCase(fx.deps),
    respondClinicRequest: createRespondClinicRequestUseCase(fx.deps),
    listClinicAgenda: createListClinicAgendaUseCase(fx.deps),
    cancelClinicAppointment: createCancelClinicAppointmentUseCase(fx.deps),
    completeClinicAppointment: createCompleteClinicAppointmentUseCase(fx.deps),
    confirmClinicAppointmentByPhone: createConfirmClinicAppointmentByPhoneUseCase(fx.deps),
    arriveClinicAppointment: createArriveClinicAppointmentUseCase(fx.deps),
    startClinicAppointment: createStartClinicAppointmentUseCase(fx.deps),
    noShowClinicAppointment: createNoShowClinicAppointmentUseCase(fx.deps),
    setClinicFollowUp: createSetClinicFollowUpUseCase(fx.deps),
    clearClinicFollowUp: createClearClinicFollowUpUseCase(fx.deps),
    clinicPatientLookup: createClinicPatientLookupUseCase(fx.deps),
    createClinicWalkInAppointment: createCreateWalkInAppointmentUseCase(fx.deps),
  });

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
      router.use(clinicRouter);
    },
  });

  const userToken = (await signAccessToken({ subject: { userId: USER, sessionId: SESSION }, now: NOW, ttlSeconds: 900, signingKeys: KEYS })).token;
  const insuranceToken = (await signInsuranceAccessToken({ subject: { insuranceAccountId: ACCOUNT_ADMIN, sessionId: SESSION }, now: NOW, ttlSeconds: 900, signingKeys: KEYS })).token;
  const clinicToken = async (account: string) => (await signClinicAccessToken({ subject: { clinicAccountId: account, sessionId: SESSION }, now: NOW, ttlSeconds: 900, signingKeys: KEYS })).token;
  return { app, fx, clock, userToken, insuranceToken, admin: await clinicToken(ACCOUNT_ADMIN), manager: await clinicToken(ACCOUNT_MANAGER), otherClinic: await clinicToken(ACCOUNT_B) };
}

type Harness = Awaited<ReturnType<typeof buildHarness>>;
const lookup = (h: Harness, token: string, email: unknown) => request(h.app).post(`${API}/clinic-portal/patient-lookup`).set("Authorization", `Bearer ${token}`).send({ email });
const walkIn = (h: Harness, token: string, body: Record<string, unknown>) => request(h.app).post(`${API}/clinic-portal/walk-in-appointments`).set("Authorization", `Bearer ${token}`).send(body);

describe("POST /clinic-portal/patient-lookup", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildHarness();
  });

  it("200 só com displayName (nenhum id), ambos os papéis; e-mail normalizado", async () => {
    for (const token of [h.admin, h.manager]) {
      const res = await lookup(h, token, "  Maria.Silva@EXAMPLE.pt ".trim());
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ displayName: "Maria S." });
      expect(JSON.stringify(res.body)).not.toContain(FAMILY);
      expect(JSON.stringify(res.body)).not.toContain(MEMBER);
    }
  });

  it("404 idêntico (corpo e estado) para inexistente, suspenso e sem SELF — nada na resposta os distingue", async () => {
    // Suspenso/sem SELF resolvem-se para `null` na porta, tal como o inexistente (oráculo uniforme).
    const bodies = [];
    for (const email of ["nao-existe@example.pt", "suspenso@example.pt", "sem-self@example.pt"]) {
      const res = await lookup(h, h.admin, email);
      expect(res.status).toBe(404);
      bodies.push({ ...(res.body as Record<string, unknown>), instance: undefined, requestId: undefined });
    }
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[2]).toEqual(bodies[0]);
    expect((bodies[0] as { code: string }).code).toBe("NOT_FOUND");
  });

  it("sem pesquisa parcial/prefixo", async () => {
    expect((await lookup(h, h.admin, "maria.silva@example.p")).status).toBe(404);
  });

  it("422 e-mail inválido; 401 sem token", async () => {
    expect((await lookup(h, h.admin, "nao-e-email")).status).toBe(422);
    expect((await request(h.app).post(`${API}/clinic-portal/patient-lookup`).send({ email: EMAIL })).status).toBe(401);
  });

  it("token de User e de seguradora rejeitados (401)", async () => {
    expect((await lookup(h, h.userToken, EMAIL)).status).toBe(401);
    expect((await lookup(h, h.insuranceToken, EMAIL)).status).toBe(401);
  });

  it("429 com Retry-After ao exceder 10 respostas 404 em 15 min", async () => {
    for (let i = 0; i < 10; i += 1) {
      expect((await lookup(h, h.admin, `x${String(i)}@example.pt`)).status).toBe(404);
    }
    const res = await lookup(h, h.admin, EMAIL);
    expect(res.status).toBe(429);
    expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
    expect((res.body as { code: string }).code).toBe("RATE_LIMITED");
    // Outra conta (de outra clínica) não é afetada pelo contador de falhas da primeira.
    expect((await lookup(h, h.otherClinic, EMAIL)).status).toBe(200);
  });

  it("auditoria nunca contém o e-mail nem o displayName (canário)", async () => {
    await lookup(h, h.admin, EMAIL);
    await lookup(h, h.admin, "canario-pesquisado@example.pt");
    const dump = JSON.stringify(h.fx.audit.events);
    expect(dump).not.toContain("canario-pesquisado");
    expect(dump).not.toContain("maria.silva");
    expect(dump).not.toContain("Maria");
    expect(h.fx.audit.events.map((e) => e.result)).toEqual(["SUCCESS", "FAILURE"]);
  });
});

describe("POST /clinic-portal/walk-in-appointments", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildHarness();
  });

  it("201 ClinicBooking SCHEDULED só com o mínimo; aparece na agenda da clínica e na lista do paciente; ambos os papéis", async () => {
    const created = await walkIn(h, h.manager, { patientEmail: EMAIL, slotId: SLOT, notes: "trazer exames" });
    expect(created.status).toBe(201);
    expect(created.body).toEqual({
      id: (created.body as { id: string }).id,
      status: "SCHEDULED",
      scheduledAt: SLOT_AT.toISOString(),
      specialty: "Cardiologia",
      professionalName: null,
      patientName: "Maria Santos Silva",
      notes: "trazer exames",
      responseNote: null,
      source: "VITA",
      clinicPatientId: (created.body as { clinicPatientId: string }).clinicPatientId,
      slotId: SLOT,
      // M14 Q: estado de confirmação e fluxo do dia (a marcação nasce "Sem resposta", sem chegada nem retorno).
      confirmationStatus: "PENDING",
      confirmationSource: null,
      dayState: "SCHEDULED",
      arrivedAt: null,
      startedAt: null,
      waitingMinutes: null,
      followUpDueOn: null,
      receiptId: null,
      reportStatus: null,
    });
    const id = (created.body as { id: string }).id;

    const agenda = await request(h.app).get(`${API}/clinic-portal/agenda`).set("Authorization", `Bearer ${h.admin}`);
    expect((agenda.body as { id: string }[]).map((a) => a.id)).toEqual([id]);

    const mine = await request(h.app).get(`${API}/families/${FAMILY}/members/${MEMBER}/appointments`).set("Authorization", `Bearer ${h.userToken}`);
    expect(mine.status).toBe(200);
    expect((mine.body as { items: { id: string; status: string; slotId: string; clinicName: string }[] }).items).toMatchObject([{ id, status: "SCHEDULED", slotId: SLOT, clinicName: "Clínica Sol" }]);

  });

  it("a clínica cancela (com motivo) e completa pelos fluxos existentes; o horário volta a ficar livre ao cancelar", async () => {
    const id = ((await walkIn(h, h.admin, { patientEmail: EMAIL, slotId: SLOT })).body as { id: string }).id;
    const cancelled = await request(h.app).put(`${API}/clinic-portal/agenda/${id}/cancel`).set("Authorization", `Bearer ${h.manager}`).send({ note: "Médico indisponível" });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({ status: "CANCELLED", responseNote: "Médico indisponível" });
    // BR-APT-06: a marcação cancelada deixa de ocupar o horário.
    const again = await walkIn(h, h.admin, { patientEmail: EMAIL, slotId: SLOT });
    expect(again.status).toBe(201);
    const completed = await request(h.app).put(`${API}/clinic-portal/agenda/${(again.body as { id: string }).id}/complete`).set("Authorization", `Bearer ${h.admin}`).send({ outcomeNote: "ok" });
    expect(completed.status).toBe(200);
    expect(completed.body).toMatchObject({ status: "COMPLETED" });
  });

  it("404 horário de outra clínica ou inexistente; 404 paciente genérico (igual ao lookup)", async () => {
    expect((await walkIn(h, h.admin, { patientEmail: EMAIL, slotId: SLOT_OTHER })).status).toBe(404);
    expect((await walkIn(h, h.admin, { patientEmail: EMAIL, slotId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" })).status).toBe(404);
    // A outra clínica não vê o horário da primeira.
    expect((await walkIn(h, h.otherClinic, { patientEmail: EMAIL, slotId: SLOT })).status).toBe(404);
    const noPatient = await walkIn(h, h.admin, { patientEmail: "ninguem@example.pt", slotId: SLOT });
    const lookupMiss = await lookup(h, h.admin, "ninguem@example.pt");
    expect(noPatient.status).toBe(404);
    expect((noPatient.body as { detail: string }).detail).toBe((lookupMiss.body as { detail: string }).detail);
    expect(h.fx.appointmentsRepo.byId.size).toBe(0);
  });

  it("409 ocupado e passado; 422 kind=EXAM; 409 sobreposição com consulta SCHEDULED do paciente", async () => {
    expect((await walkIn(h, h.admin, { patientEmail: EMAIL, slotId: SLOT_PAST })).status).toBe(409);
    expect((await walkIn(h, h.admin, { patientEmail: EMAIL, slotId: SLOT_EXAM })).status).toBe(422);
    expect((await walkIn(h, h.admin, { patientEmail: EMAIL, slotId: SLOT })).status).toBe(201);
    h.fx.patients.seed("outra@example.pt", "fam-2", "mem-2", "Outra Pessoa");
    expect((await walkIn(h, h.admin, { patientEmail: "outra@example.pt", slotId: SLOT })).status).toBe(409);
    // Sobreposição: consulta SCHEDULED do paciente a começar dentro do intervalo do horário (SLOT_AT + 10 min).
    h.fx.appointmentsRepo.seed({ id: "pre-existing", familyId: "fam-3", memberId: "mem-3", scheduledAt: new Date(SLOT_AT.getTime() + 10 * 60_000), status: "SCHEDULED", confirmationStatus: "PENDING", createdAt: NOW });
    h.fx.patients.seed("terceiro@example.pt", "fam-3", "mem-3", "Terceiro Utilizador");
    expect((await walkIn(h, h.admin, { patientEmail: "terceiro@example.pt", slotId: SLOT_2 })).status).toBe(409);
    expect((await walkIn(h, h.admin, { patientEmail: "terceiro@example.pt", slotId: SLOT_EXAM })).status).toBe(422);
  });

  it("422 contrato: e-mail inválido, slotId não UUID, notes > 2000, campos extra; 401 sem token", async () => {
    expect((await walkIn(h, h.admin, { patientEmail: "x", slotId: SLOT })).status).toBe(422);
    expect((await walkIn(h, h.admin, { patientEmail: EMAIL, slotId: "nao-uuid" })).status).toBe(422);
    expect((await walkIn(h, h.admin, { patientEmail: EMAIL, slotId: SLOT, notes: "x".repeat(2001) })).status).toBe(422);
    expect((await walkIn(h, h.admin, { patientEmail: EMAIL, slotId: SLOT, memberId: MEMBER })).status).toBe(422);
    expect((await request(h.app).post(`${API}/clinic-portal/walk-in-appointments`).send({ patientEmail: EMAIL, slotId: SLOT })).status).toBe(401);
  });

  it("token de User e de seguradora rejeitados (401)", async () => {
    expect((await walkIn(h, h.userToken, { patientEmail: EMAIL, slotId: SLOT })).status).toBe(401);
    expect((await walkIn(h, h.insuranceToken, { patientEmail: EMAIL, slotId: SLOT })).status).toBe(401);
    expect(h.fx.appointmentsRepo.byId.size).toBe(0);
  });

  it("429 após 30 pedidos/hora por conta (lookup + marcação partilham o limite); auditoria sem e-mail", async () => {
    for (let i = 0; i < 30; i += 1) {
      await request(h.app).post(`${API}/clinic-portal/patient-lookup`).set("Authorization", `Bearer ${h.manager}`).set("X-Forwarded-For", `10.1.0.${String(i + 1)}`).send({ email: EMAIL });
    }
    const res = await walkIn(h, h.manager, { patientEmail: EMAIL, slotId: SLOT });
    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toBeDefined();
    expect(JSON.stringify(h.fx.audit.events)).not.toContain(EMAIL);
  });

  it("auditoria CLINIC_WALKIN_BOOK com slotId e sem e-mail", async () => {
    const id = ((await walkIn(h, h.admin, { patientEmail: EMAIL, slotId: SLOT })).body as { id: string }).id;
    const event = h.fx.audit.events.find((e) => e.action === "CLINIC_WALKIN_BOOK");
    expect(event).toMatchObject({ actorType: "CLINIC_ACCOUNT", actorClinicAccountId: ACCOUNT_ADMIN, resourceType: "Appointment", resourceId: id, familyId: FAMILY, subjectMemberId: MEMBER, metadata: { slotId: SLOT } });
    expect(JSON.stringify(h.fx.audit.events)).not.toContain(EMAIL);
  });
});
