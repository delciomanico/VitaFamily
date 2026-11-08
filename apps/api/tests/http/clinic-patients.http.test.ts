// HTTP (supertest + express-openapi-validator contra docs/05-api/openapi.yaml, SEM base de dados): pacientes da clínica,
// ligação por código, consentimento, histórico partilhado, pesquisa, calendário e walk-in com `clinicPatientId` (M14 P,
// BR-CLN-17..24, AC-CLN-13..19, TC-CLN-08..12, TC-AZ-CLN-V3). Os casos de uso reais de `clinic-patients` e `appointments`
// correm sobre os fakes das fixtures, ligados entre si como no composition root (porta `ClinicPatientDirectory`).
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
import { createAppointmentsClinicPortalRouter } from "../../src/modules/appointments/interface/clinic-portal-router.js";
import { signAccessToken } from "../../src/modules/auth/domain/jwt.js";
import { createBearerAuthSecurityHandler } from "../../src/modules/auth/interface/middleware.js";
import { createGetClinicCalendarUseCase, createClinicGlobalSearchUseCase } from "../../src/modules/clinic-patients/application/calendar.js";
import { createCreateClinicLinkCodeUseCase, createListClinicConsentsUseCase, createPutClinicConsentUseCase, createRevokeClinicConsentUseCase } from "../../src/modules/clinic-patients/application/consents.js";
import { createCountActiveVisitsBySlotUseCase, createEnsureLinkedByEmailUseCase, createFindPatientIdsByMembersUseCase, createResolvePatientUseCase } from "../../src/modules/clinic-patients/application/directory.js";
import { createClinicPatientsFixtures } from "../../src/modules/clinic-patients/application/fixtures.js";
import { createLinkClinicPatientUseCase } from "../../src/modules/clinic-patients/application/patient-link.js";
import { createCreateClinicPatientUseCase, createGetClinicPatientUseCase, createListClinicPatientsUseCase, createUpdateClinicPatientUseCase } from "../../src/modules/clinic-patients/application/patients.js";
import { createGetClinicPatientRecordUseCase } from "../../src/modules/clinic-patients/application/record.js";
import { createGetSharedHistoryUseCase } from "../../src/modules/clinic-patients/application/shared-history.js";
import { createGetClinicReportSummaryUseCase, createListClinicFollowUpsUseCase } from "../../src/modules/clinic-patients/application/reports.js";
import { createArriveVisitUseCase, createClearVisitFollowUpUseCase, createConfirmVisitUseCase, createNoShowVisitUseCase, createSetVisitFollowUpUseCase, createStartVisitUseCase } from "../../src/modules/clinic-patients/application/visit-day-flow.js";
import { createBookVisitUseCase, createCancelVisitUseCase, createCompleteVisitUseCase, createListVisitsUseCase } from "../../src/modules/clinic-patients/application/visits.js";
import { createClinicPatientsFamilyRouter } from "../../src/modules/clinic-patients/interface/family-router.js";
import { createClinicPatientsPortalRouter } from "../../src/modules/clinic-patients/interface/portal-router.js";
import { signClinicAccessToken } from "../../src/modules/clinics/domain/clinic-jwt.js";
import { createClinicActorContextMiddleware, createClinicBearerAuthSecurityHandler } from "../../src/modules/clinics/interface/clinic-portal-middleware.js";
import { signInsuranceAccessToken } from "../../src/modules/insurance/domain/insurance-jwt.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const OPENAPI_SPEC_PATH = join(REPO_ROOT, "docs/05-api/openapi.yaml");
const NOW = new Date("2026-11-08T10:00:00.000Z");
const SLOT_AT = new Date("2026-12-01T09:00:00.000Z");
const FAMILY = "11111111-1111-4111-8111-111111111111";
const MEMBER = "22222222-2222-4222-8222-222222222222";
const DEPENDENT = "22222222-2222-4222-8222-222222222223";
const OTHER_MEMBER = "22222222-2222-4222-8222-222222222224";
const CLINIC_A = "33333333-3333-4333-8333-333333333333";
const CLINIC_B = "44444444-4444-4444-8444-444444444444";
const CLINIC_PRIVATE = "44444444-4444-4444-8444-444444444445";
const ACCOUNT_ADMIN = "55555555-5555-4555-8555-555555555555";
const ACCOUNT_MANAGER = "66666666-6666-4666-8666-666666666666";
const ACCOUNT_B = "77777777-7777-4777-8777-777777777778";
const USER_SELF = "77777777-7777-4777-8777-777777777771";
const USER_OTHER = "77777777-7777-4777-8777-777777777772";
const USER_DEP = "77777777-7777-4777-8777-777777777773";
const USER_STRANGER = "77777777-7777-4777-8777-777777777774";
const SESSION = "88888888-8888-4888-8888-888888888888";
const SLOT = "99999999-9999-4999-8999-999999999999";
const SLOT_2 = "99999999-9999-4999-8999-999999999998";
const SLOT_3 = "99999999-9999-4999-8999-999999999997";
const SLOT_EXAM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SLOT_OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROFESSIONAL = "cccccccc-cccc-4ccc-8ccc-cccccccccc01";
const PROFESSIONAL_B = "cccccccc-cccc-4ccc-8ccc-cccccccccc02";
const UNKNOWN = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const EMAIL = "maria.silva@example.pt";
const KEYS = [{ kid: "k1", secret: new TextEncoder().encode("0123456789abcdef0123456789abcdef") }];
const API = "/api/v1";
/** Tokens de longa duração: os testes avançam o relógio injetado (expiração do consentimento) sem expirar a sessão. */
const LONG_TTL = 3 * 365 * 86_400;

async function buildHarness() {
  const clock = new FixedClock(NOW);
  const ap = createAppointmentsFixtures(clock);
  const cp = createClinicPatientsFixtures(clock);

  // Dados partilhados (BD "virtual"): clínicas, horários, nomes, relações.
  ap.clinics.seed(CLINIC_A, "Clínica Sol", "");
  const slot = (id: string, clinicId: string, kind: "APPOINTMENT" | "EXAM", startsAt: Date, extra: { professionalId?: string; professionalName?: string; durationMinutes?: number } = {}) => {
    const base = { id, clinicId, kind, specialty: kind === "EXAM" ? "Ecografia" : "Cardiologia", startsAt, durationMinutes: extra.durationMinutes ?? 30, capacity: kind === "EXAM" ? 2 : 1 };
    ap.clinics.seedSlot({ ...base, ...(extra.professionalId ? { professionalId: extra.professionalId } : {}), ...(extra.professionalName ? { professionalName: extra.professionalName } : {}) });
    cp.slots.seed({ ...base, ...(extra.professionalId ? { professionalId: extra.professionalId } : {}), ...(extra.professionalName ? { professionalName: extra.professionalName } : {}) });
  };
  slot(SLOT, CLINIC_A, "APPOINTMENT", SLOT_AT, { professionalId: PROFESSIONAL, professionalName: "Dra. Lima" });
  slot(SLOT_2, CLINIC_A, "APPOINTMENT", new Date(SLOT_AT.getTime() + 10 * 60_000), { professionalId: PROFESSIONAL, professionalName: "Dra. Lima" });
  slot(SLOT_3, CLINIC_A, "APPOINTMENT", new Date(SLOT_AT.getTime() + 2 * 3_600_000));
  slot(SLOT_EXAM, CLINIC_A, "EXAM", SLOT_AT);
  slot(SLOT_OTHER, CLINIC_B, "APPOINTMENT", SLOT_AT);
  cp.slots.professionals.set(PROFESSIONAL, { id: PROFESSIONAL, clinicId: CLINIC_A, name: "Dra. Lima" });
  cp.slots.professionals.set(PROFESSIONAL_B, { id: PROFESSIONAL_B, clinicId: CLINIC_B, name: "Dr. Alheio" });
  ap.patients.seed(EMAIL, FAMILY, MEMBER, "Maria Santos Silva");
  ap.memberNames.seed(FAMILY, MEMBER, "Maria Santos Silva");
  cp.members.names.set(MEMBER, "Maria Santos Silva");
  cp.members.names.set(DEPENDENT, "Joãozinho Pequeno");
  cp.clinics.clinics.set(CLINIC_A, { id: CLINIC_A, name: "Clínica Sol", active: true });
  cp.clinics.clinics.set(CLINIC_B, { id: CLINIC_B, name: "Clínica B", active: true });
  cp.policy.relations.set(`${USER_SELF}:${MEMBER}`, "SELF");
  cp.policy.relations.set(`${USER_SELF}:${DEPENDENT}`, "TUTOR_OF");
  cp.policy.relations.set(`${USER_OTHER}:${MEMBER}`, "OTHER");
  cp.policy.relations.set(`${USER_DEP}:${DEPENDENT}`, "DEPENDENT_SELF");

  // Ligações do composition root: `appointments` -> `ClinicPatientDirectory` (clinic-patients); `clinic-patients` lê consultas/ocupação de `appointments`.
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
  cp.slots.countActiveBySlot = (trx, ids) => ap.appointmentsRepo.countActiveBySlot(trx, ids);
  cp.calendar.listAppointments = async (trx, clinicId, window) =>
    (await ap.appointmentsRepo.listForClinic(trx, clinicId, window)).map((a) => ({
      id: a.id,
      status: a.status,
      startsAt: a.scheduledAt,
      durationMinutes: a.durationMinutes ?? 30,
      familyId: a.familyId,
      memberId: a.memberId,
      confirmationStatus: a.confirmationStatus,
      ...(a.specialty ? { specialty: a.specialty } : {}),
      ...(a.slotId ? { slotId: a.slotId } : {}),
    }));
  cp.calendar.listRecentAppointments = async (trx, clinicId) =>
    (await ap.appointmentsRepo.listForClinic(trx, clinicId, {})).map((a) => ({ id: a.id, status: a.status, startsAt: a.scheduledAt, durationMinutes: a.durationMinutes ?? 30, familyId: a.familyId, memberId: a.memberId, confirmationStatus: a.confirmationStatus, ...(a.specialty ? { specialty: a.specialty } : {}) }));
  cp.deps.sharedLimiter = ap.deps.walkInRateLimiter;

  const portalRouter = createClinicPatientsPortalRouter({
    listClinicPatients: createListClinicPatientsUseCase(cp.deps),
    createClinicPatient: createCreateClinicPatientUseCase(cp.deps),
    linkClinicPatient: createLinkClinicPatientUseCase(cp.deps),
    getClinicPatient: createGetClinicPatientUseCase(cp.deps),
    updateClinicPatient: createUpdateClinicPatientUseCase(cp.deps),
    getClinicPatientRecord: createGetClinicPatientRecordUseCase(cp.deps),
    getClinicSharedHistory: createGetSharedHistoryUseCase(cp.deps),
    clinicGlobalSearch: createClinicGlobalSearchUseCase(cp.deps),
    getClinicCalendar: createGetClinicCalendarUseCase(cp.deps),
    getClinicReportSummary: createGetClinicReportSummaryUseCase(cp.deps),
    listClinicFollowUps: createListClinicFollowUpsUseCase(cp.deps),
  });
  const familyRouter = createClinicPatientsFamilyRouter({
    listClinicConsents: createListClinicConsentsUseCase(cp.deps),
    putClinicConsent: createPutClinicConsentUseCase(cp.deps),
    revokeClinicConsent: createRevokeClinicConsentUseCase(cp.deps),
    createClinicLinkCode: createCreateClinicLinkCodeUseCase(cp.deps),
  });
  const walkInRouter = createAppointmentsClinicPortalRouter({
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
      router.use(familyRouter);
      router.use(portalRouter);
      router.use(walkInRouter);
    },
  });

  const userToken = async (userId: string) => (await signAccessToken({ subject: { userId, sessionId: SESSION }, now: NOW, ttlSeconds: LONG_TTL, signingKeys: KEYS })).token;
  const clinicToken = async (account: string) => (await signClinicAccessToken({ subject: { clinicAccountId: account, sessionId: SESSION }, now: NOW, ttlSeconds: LONG_TTL, signingKeys: KEYS })).token;
  return {
    app,
    ap,
    cp,
    clock,
    self: await userToken(USER_SELF),
    other: await userToken(USER_OTHER),
    dep: await userToken(USER_DEP),
    stranger: await userToken(USER_STRANGER),
    insuranceToken: (await signInsuranceAccessToken({ subject: { insuranceAccountId: ACCOUNT_ADMIN, sessionId: SESSION }, now: NOW, ttlSeconds: 900, signingKeys: KEYS })).token,
    admin: await clinicToken(ACCOUNT_ADMIN),
    manager: await clinicToken(ACCOUNT_MANAGER),
    otherClinic: await clinicToken(ACCOUNT_B),
  };
}

type Harness = Awaited<ReturnType<typeof buildHarness>>;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const post = (h: Harness, path: string, token: string, body?: unknown) => request(h.app).post(`${API}${path}`).set(auth(token)).send(body as object);
const get = (h: Harness, path: string, token: string) => request(h.app).get(`${API}${path}`).set(auth(token));
const create = async (h: Harness, token: string, body: Record<string, unknown> = { name: "Ana Silva" }) => (await post(h, "/clinic-portal/patients", token, body)).body as { id: string; name: string };
const famPath = (memberId: string, suffix: string) => `/families/${FAMILY}/members/${memberId}/${suffix}`;

/** O portal nunca recebe ids Vita: varre o JSON por qualquer id de família/membro/utilizador. */
function expectNoVitaIds(body: unknown): void {
  const json = JSON.stringify(body);
  for (const id of [FAMILY, MEMBER, DEPENDENT, OTHER_MEMBER, USER_SELF, USER_OTHER]) expect(json).not.toContain(id);
  expect(json).not.toMatch(/"(userId|familyId|memberId)"/);
}

describe("autenticação e separação de atores (TC-AZ-CLN-V3)", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildHarness();
  });

  const portalRoutes: [string, string][] = [
    ["get", "/clinic-portal/patients"],
    ["post", "/clinic-portal/patients"],
    ["post", "/clinic-portal/patients/link"],
    ["get", `/clinic-portal/patients/${UNKNOWN}`],
    ["patch", `/clinic-portal/patients/${UNKNOWN}`],
    ["get", `/clinic-portal/patients/${UNKNOWN}/record`],
    ["get", `/clinic-portal/patients/${UNKNOWN}/shared-history`],
    ["get", "/clinic-portal/search?q=ab"],
    ["get", "/clinic-portal/calendar?from=2026-11-09T00%3A00%3A00Z&to=2026-11-10T00%3A00%3A00Z"],
  ];
  const body = { name: "X", code: "ABCDEFGH" };

  it.each(portalRoutes)("%s %s: sem token, token de User e de seguradora => 401", async (method, path) => {
    for (const token of [undefined, "user", "insurance"] as const) {
      const req = request(h.app)[method as "get"](`${API}${path}`);
      if (token) req.set(auth(token === "user" ? h.self : h.insuranceToken));
      const res = await req.send(method === "get" ? undefined : body);
      expect(res.status).toBe(401);
    }
    expect(h.cp.patientsRepo.byId.size).toBe(0);
  });

  const familyRoutes: [string, string][] = [
    ["get", famPath(MEMBER, "clinic-consents")],
    ["put", famPath(MEMBER, `clinic-consents/${CLINIC_A}`)],
    ["delete", famPath(MEMBER, `clinic-consents/${CLINIC_A}`)],
    ["post", famPath(MEMBER, "clinic-link-codes")],
  ];
  it.each(familyRoutes)("%s %s: sem token e token de clínica/seguradora => 401", async (method, path) => {
    for (const token of [undefined, h.admin, h.insuranceToken]) {
      const req = request(h.app)[method as "get"](`${API}${path}`);
      if (token) req.set(auth(token));
      expect((await req.send(method === "put" ? { level: "BOOKINGS" } : undefined)).status).toBe(401);
    }
  });
});

describe("pacientes da clínica (AC-CLN-13, TC-CLN-08)", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildHarness();
  });

  it("Admin e Gestor: criar (201), ler, editar com null a limpar, listar; sem DELETE; resposta com a forma do contrato e sem ids Vita", async () => {
    for (const token of [h.admin, h.manager]) {
      const created = await post(h, "/clinic-portal/patients", token, { name: "  Ana Silva ", phone: "+351 912 345 678", email: "Ana@Example.pt", birthDate: "1990-05-06", notes: "alergia a nada" });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ name: "Ana Silva", phone: "+351 912 345 678", email: "ana@example.pt", birthDate: "1990-05-06", notes: "alergia a nada", origin: "MANUAL", vitaLink: null });
      expectNoVitaIds(created.body);
      const id = (created.body as { id: string }).id;
      expect((await get(h, `/clinic-portal/patients/${id}`, token)).body).toMatchObject({ id, name: "Ana Silva" });
      const patched = await request(h.app).patch(`${API}/clinic-portal/patients/${id}`).set(auth(token)).send({ phone: null, notes: "nova" });
      expect(patched.status).toBe(200);
      expect(patched.body).toMatchObject({ phone: null, notes: "nova", name: "Ana Silva", origin: "MANUAL" });
    }
    const page = await get(h, "/clinic-portal/patients?limit=1", h.admin);
    expect(page.status).toBe(200);
    expect((page.body as { items: unknown[]; nextCursor: string }).items).toHaveLength(1);
    expect((page.body as { nextCursor: string }).nextCursor).toEqual(expect.any(String));
    const id = ((await get(h, "/clinic-portal/patients", h.admin)).body as { items: { id: string }[] }).items[0]?.id ?? "";
    // Sem DELETE nesta fase (retenção: OP-32): o método não existe no contrato e o registo mantém-se.
    expect((await request(h.app).delete(`${API}/clinic-portal/patients/${id}`).set(auth(h.admin))).status).toBeGreaterThanOrEqual(400);
    expect((await get(h, `/clinic-portal/patients/${id}`, h.admin)).status).toBe(200);
  });

  it("422 no corpo (nome em falta, campos extra, e-mail/telefone inválidos, data futura, patch vazio); parâmetros de query fora do contrato => 400 MALFORMED_REQUEST (validador da plataforma); cursor inválido => 422", async () => {
    for (const bad of [{}, { name: "" }, { name: "A", extra: 1 }, { name: "A", email: "x" }, { name: "A", phone: "abc" }, { name: "A", birthDate: "2099-01-01" }, { name: "x".repeat(121) }, { name: "A", notes: "n".repeat(2001) }]) {
      expect((await post(h, "/clinic-portal/patients", h.admin, bad)).status).toBe(422);
    }
    const id = (await create(h, h.admin)).id;
    expect((await request(h.app).patch(`${API}/clinic-portal/patients/${id}`).set(auth(h.admin)).send({})).status).toBe(422);
    expect((await request(h.app).patch(`${API}/clinic-portal/patients/${id}`).set(auth(h.admin)).send({ name: null })).status).toBe(422);
    for (const q of ["/clinic-portal/patients?q=a", "/clinic-portal/patients?limit=0", "/clinic-portal/patients?limit=101", "/clinic-portal/search?q=a", "/clinic-portal/search"]) {
      expect((await get(h, q, h.admin)).status).toBe(400);
    }
    expect((await get(h, "/clinic-portal/patients?cursor=lixo", h.admin)).status).toBe(422);
  });

  it("pesquisa por nome sem acentos, e-mail e dígitos de telefone; `%`/`_` literais; cursor estável", async () => {
    await create(h, h.admin, { name: "Ângela Costa", phone: "+351 911 000 111" });
    await create(h, h.admin, { name: "Bruno Dias", email: "bruno@clinica.pt" });
    await create(h, h.admin, { name: "100% Natural" });
    const names = async (q: string) => ((await get(h, `/clinic-portal/patients?q=${encodeURIComponent(q)}`, h.admin)).body as { items: { name: string }[] }).items.map((p) => p.name);
    expect(await names("angela")).toEqual(["Ângela Costa"]);
    expect(await names("clinica.pt")).toEqual(["Bruno Dias"]);
    expect(await names("911 000")).toEqual(["Ângela Costa"]);
    expect(await names("0%")).toEqual(["100% Natural"]);
    expect(await names("%%")).toEqual([]);
    expect(await names("__")).toEqual([]);
    const p1 = (await get(h, "/clinic-portal/patients?limit=2", h.admin)).body as { items: { name: string }[]; nextCursor: string };
    const p2 = (await get(h, `/clinic-portal/patients?limit=2&cursor=${p1.nextCursor}`, h.admin)).body as { items: { name: string }[]; nextCursor: string | null };
    expect([...p1.items, ...p2.items].map((p) => p.name)).toEqual(["100% Natural", "Ângela Costa", "Bruno Dias"]);
    expect(p2.nextCursor).toBeNull();
  });

  it("429 + Retry-After ao 61.º pedido/min por conta (listagem e pesquisa partilham o limite); outra conta livre", async () => {
    for (let i = 0; i < 60; i += 1) await get(h, i % 2 ? "/clinic-portal/search?q=ab" : "/clinic-portal/patients", h.manager);
    const res = await get(h, "/clinic-portal/patients", h.manager);
    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toBeDefined();
    expect((await get(h, "/clinic-portal/patients", h.admin)).status).toBe(200);
  });

  it("auditoria sem PII (canário): nome, telefone, e-mail, notas, q e código nunca aparecem", async () => {
    const created = await create(h, h.admin, { name: "CANARY-NOME", phone: "+351 999 888 777", email: "canary@x.pt", notes: "CANARY-NOTAS", birthDate: "1971-03-04" });
    await request(h.app).patch(`${API}/clinic-portal/patients/${created.id}`).set(auth(h.admin)).send({ notes: "CANARY-OUTRA" });
    await get(h, "/clinic-portal/patients?q=CANARY-Q", h.admin);
    await get(h, "/clinic-portal/search?q=CANARY-Q", h.admin);
    const dump = JSON.stringify(h.cp.audit.events).toLowerCase();
    for (const canary of ["canary", "999 888", "1971"]) expect(dump).not.toContain(canary);
    expect(h.cp.audit.events.map((e) => e.action)).toEqual(["CLINIC_PATIENT_CREATE", "CLINIC_PATIENT_UPDATE"]);
  });
});

describe("isolamento entre clínicas (TC-AZ-CLN-V3)", () => {
  it("todas as rotas /patients*, search e calendar com recursos da outra clínica => 404 idêntico", async () => {
    const h = await buildHarness();
    const mine = await create(h, h.admin, { name: "Paciente A" });
    const theirs = await create(h, h.otherClinic, { name: "Paciente B" });
    const patch = (id: string) => request(h.app).patch(`${API}/clinic-portal/patients/${id}`).set(auth(h.admin)).send({ name: "Hack" });
    const responses = [
      await get(h, `/clinic-portal/patients/${theirs.id}`, h.admin),
      await patch(theirs.id),
      await get(h, `/clinic-portal/patients/${theirs.id}/record`, h.admin),
      await get(h, `/clinic-portal/patients/${theirs.id}/shared-history`, h.admin),
      await get(h, `/clinic-portal/patients/${UNKNOWN}`, h.admin),
      await get(h, `/clinic-portal/calendar?from=2026-11-09T00%3A00%3A00Z&to=2026-11-12T00%3A00%3A00Z&professionalId=${PROFESSIONAL_B}`, h.admin),
      await get(h, `/clinic-portal/calendar?from=2026-11-09T00%3A00%3A00Z&to=2026-11-12T00%3A00%3A00Z&professionalId=${UNKNOWN}`, h.admin),
      await post(h, "/clinic-portal/patients/link", h.admin, { code: "ABCDEFGH", clinicPatientId: theirs.id }),
      await post(h, "/clinic-portal/walk-in-appointments", h.admin, { clinicPatientId: theirs.id, slotId: SLOT }),
    ];
    for (const res of responses) expect(res.status).toBe(404);
    const details = new Set(responses.slice(0, 5).map((r) => JSON.stringify({ code: (r.body as { code: string }).code, detail: (r.body as { detail: string }).detail })));
    expect(details.size).toBe(1);
    // nada mudou na outra clínica; cada clínica só lista os seus
    expect((await get(h, `/clinic-portal/patients/${theirs.id}`, h.otherClinic)).body).toMatchObject({ name: "Paciente B" });
    expect(((await get(h, "/clinic-portal/patients", h.admin)).body as { items: { id: string }[] }).items.map((p) => p.id)).toEqual([mine.id]);
    expect(((await get(h, "/clinic-portal/search?q=paciente", h.admin)).body as { patients: { id: string }[] }).patients.map((p) => p.id)).toEqual([mine.id]);
    expect(h.cp.visitsRepo.byId.size).toBe(0);
  });
});

describe("consentimento e ligação, lado família (AC-CLN-15/16, TC-CLN-10/11, §6.4)", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildHarness();
  });

  it("matriz SELF/TUTOR_OF/DEPENDENT_SELF/OTHER × list/put/delete/post; membro de outra família => 404", async () => {
    // PUT cria; POST gera; DELETE apaga (2.º pedido concorrente pode já não encontrar) — corre-se em série para ser determinístico.
    const serial = async (token: string, memberId: string) => {
      const out: number[] = [];
      for (const call of [() => get(h, famPath(memberId, "clinic-consents"), token), () => request(h.app).put(`${API}${famPath(memberId, `clinic-consents/${CLINIC_A}`)}`).set(auth(token)).send({ level: "BOOKINGS" }), () => post(h, famPath(memberId, "clinic-link-codes"), token), () => request(h.app).delete(`${API}${famPath(memberId, `clinic-consents/${CLINIC_A}`)}`).set(auth(token))]) {
        out.push((await call()).status);
      }
      return out;
    };
    expect(await serial(h.self, MEMBER)).toEqual([200, 200, 201, 204]);
    expect(await serial(h.self, DEPENDENT)).toEqual([200, 200, 201, 204]); // tutor
    expect(await serial(h.dep, DEPENDENT)).toEqual([403, 403, 403, 403]);
    expect(await serial(h.other, MEMBER)).toEqual([403, 403, 403, 403]);
    expect(await serial(h.stranger, MEMBER)).toEqual([404, 404, 404, 404]);
    expect(await serial(h.self, OTHER_MEMBER)).toEqual([404, 404, 404, 404]);
  });

  it("PUT: BOOKINGS/HISTORY (+12 meses, renovar), idempotente; clínica privada/inexistente/não parceira => 404; nível inválido => 422", async () => {
    const put = (clinicId: string, body: unknown) => request(h.app).put(`${API}${famPath(MEMBER, `clinic-consents/${clinicId}`)}`).set(auth(h.self)).send(body as object);
    const history = await put(CLINIC_A, { level: "HISTORY" });
    expect(history.status).toBe(200);
    expect(history.body).toEqual({ clinicId: CLINIC_A, clinicName: "Clínica Sol", level: "HISTORY", validUntil: "2027-11-08T10:00:00.000Z", renewalNeeded: false, linked: false });
    h.clock.advance(86_400_000);
    expect(((await put(CLINIC_A, { level: "HISTORY" })).body as { validUntil: string }).validUntil).toBe("2027-11-09T10:00:00.000Z");
    expect((await put(CLINIC_A, { level: "BOOKINGS" })).body).toMatchObject({ level: "BOOKINGS", validUntil: null });
    expect((await put(CLINIC_PRIVATE, { level: "BOOKINGS" })).status).toBe(404);
    expect((await put(UNKNOWN, { level: "BOOKINGS" })).status).toBe(404);
    expect((await put(CLINIC_A, { level: "ALL" })).status).toBe(422);
    expect((await put(CLINIC_A, {})).status).toBe(422);
    expect((await put(CLINIC_A, { level: "HISTORY", extra: true })).status).toBe(422);
  });

  it("fluxo completo: gerar código → clínica liga (200, BOOKINGS) → paciente vê a clínica → HISTORY → histórico ativo → expira → inativo → revoga → desligado", async () => {
    const code = ((await post(h, famPath(MEMBER, "clinic-link-codes"), h.self)).body as { code: string; expiresAt: string });
    expect(code.code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(code.expiresAt).toBe("2026-11-08T10:10:00.000Z");

    const linked = await post(h, "/clinic-portal/patients/link", h.manager, { code: `${code.code.slice(0, 4)}-${code.code.slice(4).toLowerCase()}` });
    expect(linked.status).toBe(200);
    expect(linked.body).toMatchObject({ name: "Maria S.", origin: "VITA", vitaLink: { via: "CODE", consentLevel: "BOOKINGS", consentValidUntil: null } });
    expectNoVitaIds(linked.body);
    const patientId = (linked.body as { id: string }).id;

    // uso único: 404 idêntico ao de um código inexistente
    const reused = await post(h, "/clinic-portal/patients/link", h.admin, { code: code.code });
    const unknownCode = await post(h, "/clinic-portal/patients/link", h.admin, { code: "ZZZZZZZZ" });
    expect(reused.status).toBe(404);
    expect(reused.body).toEqual({ ...(unknownCode.body as object), requestId: (reused.body as { requestId: string }).requestId });

    // o paciente vê a clínica em "quem vê o quê"
    expect((await get(h, famPath(MEMBER, "clinic-consents"), h.self)).body).toEqual([{ clinicId: CLINIC_A, clinicName: "Clínica Sol", level: "BOOKINGS", validUntil: null, renewalNeeded: false, linked: true }]);

    // histórico: sem HISTORY => active=false
    h.cp.sharedHistory.medications = [{ name: "Metformina", dosage: "850 mg", startAt: new Date("2026-01-01T08:00:00Z"), endAt: null, continuous: true }];
    h.cp.sharedHistory.exams = [{ name: "Hemograma", examDate: "2026-10-01", status: "COMPLETED", results: [{ parameter: "Hb", valueNumeric: 7, valueText: null, unit: "g/dL", referenceMin: 12, referenceMax: 16 }] }];
    expect((await get(h, `/clinic-portal/patients/${patientId}/shared-history`, h.admin)).body).toMatchObject({ active: false, level: "BOOKINGS", medications: [], examinations: [] });

    await request(h.app).put(`${API}${famPath(MEMBER, `clinic-consents/${CLINIC_A}`)}`).set(auth(h.self)).send({ level: "HISTORY" });
    const active = await get(h, `/clinic-portal/patients/${patientId}/shared-history`, h.manager);
    expect(active.status).toBe(200);
    expect(active.body).toMatchObject({ active: true, level: "HISTORY", validUntil: "2027-11-08T10:00:00.000Z", medications: [{ name: "Metformina", dosage: "850 mg", continuous: true, endAt: null }], examinations: [{ name: "Hemograma", status: "COMPLETED", results: [{ parameter: "Hb", valueNumeric: 7 }] }] });
    expectNoVitaIds(active.body);
    expect(Object.keys((active.body as { medications: object[] }).medications[0] ?? {}).sort()).toEqual(["continuous", "dosage", "endAt", "name", "startAt"]);
    // auditoria da leitura sem conteúdo
    const view = h.cp.audit.events.find((e) => e.action === "CLINIC_SHARED_HISTORY_VIEW");
    expect(view).toMatchObject({ result: "SUCCESS", metadata: { level: "HISTORY" } });
    expect(JSON.stringify(h.cp.audit.events)).not.toMatch(/Metformina|Hemograma|Hb/);

    // expiração (relógio injetado): efetivo passa a BOOKINGS com renewalNeeded; histórico inativo
    h.clock.advance(366 * 86_400_000);
    expect((await get(h, famPath(MEMBER, "clinic-consents"), h.self)).body).toMatchObject([{ level: "BOOKINGS", validUntil: null, renewalNeeded: true, linked: true }]);
    expect((await get(h, `/clinic-portal/patients/${patientId}/shared-history`, h.admin)).body).toMatchObject({ active: false });

    // revogar: a ligação cai, a clínica conserva o registo desligado
    await request(h.app).put(`${API}${famPath(MEMBER, `clinic-consents/${CLINIC_A}`)}`).set(auth(h.self)).send({ level: "HISTORY" });
    expect((await request(h.app).delete(`${API}${famPath(MEMBER, `clinic-consents/${CLINIC_A}`)}`).set(auth(h.self))).status).toBe(204);
    expect((await get(h, `/clinic-portal/patients/${patientId}/shared-history`, h.admin)).body).toMatchObject({ active: false, level: null, medications: [] });
    expect((await get(h, `/clinic-portal/patients/${patientId}`, h.admin)).body).toMatchObject({ id: patientId, name: "Maria S.", vitaLink: null });
    expect((await request(h.app).delete(`${API}${famPath(MEMBER, `clinic-consents/${CLINIC_A}`)}`).set(auth(h.self))).status).toBe(404);
    expect((await get(h, famPath(MEMBER, "clinic-consents"), h.self)).body).toEqual([]);
  });

  it("código: 5/hora por membro => 429; formato inválido => 422; conflito de ligação => 409; falhas auditadas sem sujeito", async () => {
    for (let i = 0; i < 5; i += 1) expect((await post(h, famPath(MEMBER, "clinic-link-codes"), h.self)).status).toBe(201);
    const limited = await post(h, famPath(MEMBER, "clinic-link-codes"), h.self);
    expect(limited.status).toBe(429);
    expect(limited.headers["retry-after"]).toBeDefined();
    expect((await post(h, "/clinic-portal/patients/link", h.admin, { code: "curto" })).status).toBe(422);
    expect((await post(h, "/clinic-portal/patients/link", h.admin, { code: "ABCDEFGH", extra: 1 })).status).toBe(422);
    const patientA = await create(h, h.admin, { name: "Manual 1" });
    const patientB = await create(h, h.admin, { name: "Manual 2" });
    const code1 = ((await post(h, famPath(DEPENDENT, "clinic-link-codes"), h.self)).body as { code: string }).code;
    expect((await post(h, "/clinic-portal/patients/link", h.admin, { code: code1, clinicPatientId: patientA.id })).status).toBe(200);
    const code2 = ((await post(h, famPath(DEPENDENT, "clinic-link-codes"), h.self)).body as { code: string }).code;
    expect((await post(h, "/clinic-portal/patients/link", h.admin, { code: code2, clinicPatientId: patientB.id })).status).toBe(409);
    expect((await post(h, "/clinic-portal/patients/link", h.admin, { code: "ZZZZZZZZ" })).status).toBe(404);
    const failure = h.cp.audit.events.filter((e) => e.result === "FAILURE");
    expect(failure.length).toBeGreaterThan(0);
    for (const f of failure) expect(f.familyId).toBeUndefined();
    expect(JSON.stringify(h.cp.audit.events)).not.toMatch(new RegExp(`${code1}|${code2}|ZZZZZZZZ`));
  });
});

describe("walk-in com paciente da clínica (AC-CLN-14, TC-CLN-09)", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildHarness();
  });
  const walkIn = (token: string, body: Record<string, unknown>) => post(h, "/clinic-portal/walk-in-appointments", token, body);

  it("exatamente um de patientEmail e clinicPatientId (nenhum ou ambos => 422)", async () => {
    const patient = await create(h, h.admin);
    expect((await walkIn(h.admin, { slotId: SLOT })).status).toBe(422);
    expect((await walkIn(h.admin, { slotId: SLOT, patientEmail: EMAIL, clinicPatientId: patient.id })).status).toBe(422);
    expect(h.ap.appointmentsRepo.byId.size).toBe(0);
    expect(h.cp.visitsRepo.byId.size).toBe(0);
  });

  it("patientEmail cria/reutiliza o paciente da clínica ligado ao membro SELF com BOOKINGS (sem baixar HISTORY)", async () => {
    const first = await walkIn(h.admin, { slotId: SLOT, patientEmail: EMAIL });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ source: "VITA", slotId: SLOT, patientName: "Maria Santos Silva" });
    const patientId = (first.body as { clinicPatientId: string }).clinicPatientId;
    expect(patientId).toBeTruthy();
    expect((await get(h, `/clinic-portal/patients/${patientId}`, h.admin)).body).toMatchObject({ origin: "VITA", name: "Maria S.", vitaLink: { via: "EMAIL", consentLevel: "BOOKINGS" } });
    await request(h.app).put(`${API}${famPath(MEMBER, `clinic-consents/${CLINIC_A}`)}`).set(auth(h.self)).send({ level: "HISTORY" });
    const second = await walkIn(h.manager, { slotId: SLOT_3, patientEmail: EMAIL });
    expect(second.status).toBe(201);
    expect((second.body as { clinicPatientId: string }).clinicPatientId).toBe(patientId);
    expect((await get(h, `/clinic-portal/patients/${patientId}`, h.admin)).body).toMatchObject({ vitaLink: { consentLevel: "HISTORY" } });
    expect(h.cp.patientsRepo.byId.size).toBe(1);
  });

  it("clinicPatientId ligado a um membro Vita => consulta SCHEDULED nesse membro (como por e-mail)", async () => {
    const code = ((await post(h, famPath(MEMBER, "clinic-link-codes"), h.self)).body as { code: string }).code;
    const patientId = ((await post(h, "/clinic-portal/patients/link", h.admin, { code })).body as { id: string }).id;
    const booked = await walkIn(h.manager, { slotId: SLOT, clinicPatientId: patientId, notes: "balcão" });
    expect(booked.status).toBe(201);
    expect(booked.body).toMatchObject({ status: "SCHEDULED", source: "VITA", clinicPatientId: patientId, slotId: SLOT, patientName: "Maria Santos Silva", notes: "balcão" });
    expectNoVitaIds(booked.body);
    expect([...h.ap.appointmentsRepo.byId.values()]).toMatchObject([{ familyId: FAMILY, memberId: MEMBER, walkIn: true, slotId: SLOT }]);
    expect(h.cp.visitsRepo.byId.size).toBe(0);
    expect(h.ap.deps).toBeDefined();
  });

  it("clinicPatientId manual => visita só da clínica: aparece na agenda e no calendário, não na app Vita; ocupa o horário", async () => {
    const patient = await create(h, h.admin, { name: "Cliente Balcão" });
    const visit = await walkIn(h.manager, { slotId: SLOT, clinicPatientId: patient.id, notes: "primeira vez" });
    expect(visit.status).toBe(201);
    expect(visit.body).toMatchObject({ status: "SCHEDULED", source: "MANUAL", clinicPatientId: patient.id, slotId: SLOT, patientName: "Cliente Balcão", specialty: "Cardiologia", professionalName: "Dra. Lima", notes: "primeira vez" });
    expectNoVitaIds(visit.body);
    const visitId = (visit.body as { id: string }).id;
    expect(h.ap.appointmentsRepo.byId.size).toBe(0);
    expect(h.cp.audit.events.find((e) => e.action === "CLINIC_VISIT_BOOK")).toMatchObject({ resourceType: "ClinicVisit", resourceId: visitId, metadata: { slotId: SLOT } });
    expect(JSON.stringify(h.cp.audit.events).toLowerCase()).not.toMatch(/cliente balc|primeira vez/);

    const agenda = await get(h, "/clinic-portal/agenda", h.admin);
    expect((agenda.body as { id: string; source: string }[]).map((a) => [a.id, a.source])).toEqual([[visitId, "MANUAL"]]);
    const calendar = await get(h, "/clinic-portal/calendar?from=2026-11-30T00%3A00%3A00Z&to=2026-12-03T00%3A00%3A00Z", h.admin);
    expect(calendar.status).toBe(200);
    expect((calendar.body as { entries: { id: string; source: string; professionalId: string; endsAt: string }[] }).entries).toMatchObject([{ id: visitId, source: "MANUAL", professionalId: PROFESSIONAL, endsAt: "2026-12-01T09:30:00.000Z" }]);
    // o horário do próprio visita e o outro horário sobreposto do profissional deixam de estar livres
    const free = (calendar.body as { freeSlots: { slotId: string }[] }).freeSlots.map((f) => f.slotId).sort();
    expect(free).toEqual([SLOT_2, SLOT_3, SLOT_EXAM].sort());
    // ocupa o horário: 2.ª marcação (e-mail) no mesmo horário => 409
    expect((await walkIn(h.admin, { slotId: SLOT, patientEmail: EMAIL })).status).toBe(409);
    // a ficha do paciente mostra a visita
    expect((await get(h, `/clinic-portal/patients/${patient.id}/record`, h.admin)).body).toMatchObject({ bookings: [{ id: visitId, source: "MANUAL" }], examinations: [], recommendations: [] });
  });

  it("sobreposição: do paciente (por duração) e do profissional => 409; horário de exame => 422; passado => 409", async () => {
    const a = await create(h, h.admin, { name: "A" });
    const b = await create(h, h.admin, { name: "B" });
    expect((await walkIn(h.admin, { slotId: SLOT, clinicPatientId: a.id })).status).toBe(201);
    // SLOT_2 começa 10 min depois, mesmo profissional => 409 para outro paciente (profissional) e para o mesmo (paciente)
    expect((await walkIn(h.admin, { slotId: SLOT_2, clinicPatientId: b.id })).status).toBe(409);
    expect((await walkIn(h.admin, { slotId: SLOT_2, clinicPatientId: a.id })).status).toBe(409);
    expect((await walkIn(h.admin, { slotId: SLOT_EXAM, clinicPatientId: b.id })).status).toBe(422);
    expect((await walkIn(h.admin, { slotId: SLOT_OTHER, clinicPatientId: b.id })).status).toBe(404);
    expect(h.cp.visitsRepo.byId.size).toBe(1);
  });

  it("cancelar (com motivo) e completar a visita pelos endpoints da agenda; completar com receita => 422; o horário volta a ficar livre", async () => {
    const patient = await create(h, h.admin);
    const id = ((await walkIn(h.admin, { slotId: SLOT, clinicPatientId: patient.id })).body as { id: string }).id;
    expect((await request(h.app).put(`${API}/clinic-portal/agenda/${id}/cancel`).set(auth(h.otherClinic)).send({ note: "x" })).status).toBe(404);
    expect((await request(h.app).put(`${API}/clinic-portal/agenda/${id}/cancel`).set(auth(h.manager)).send({})).status).toBe(422);
    const cancelled = await request(h.app).put(`${API}/clinic-portal/agenda/${id}/cancel`).set(auth(h.manager)).send({ note: "Doente" });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({ id, status: "CANCELLED", responseNote: "Doente", source: "MANUAL" });
    const again = await walkIn(h.admin, { slotId: SLOT, clinicPatientId: patient.id });
    expect(again.status).toBe(201);
    const againId = (again.body as { id: string }).id;
    const withRx = await request(h.app).put(`${API}/clinic-portal/agenda/${againId}/complete`).set(auth(h.admin)).send({ outcomeNote: "ok", prescription: { issuedOn: "2026-11-08", medications: [{ name: "X", dosage: "1", scheduleType: "INTERVAL", intervalHours: 8, startAt: "2026-11-08T10:00:00Z", continuous: true }] } });
    expect(withRx.status).toBe(422);
    const done = await request(h.app).put(`${API}/clinic-portal/agenda/${againId}/complete`).set(auth(h.admin)).send({ outcomeNote: "Tudo bem" });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ status: "COMPLETED", source: "MANUAL" });
    expect((await request(h.app).put(`${API}/clinic-portal/agenda/${againId}/complete`).set(auth(h.admin)).send({})).status).toBe(409);
    expect(h.cp.audit.events.filter((e) => e.action.startsWith("CLINIC_VISIT_")).map((e) => e.action)).toEqual(["CLINIC_VISIT_BOOK", "CLINIC_VISIT_CANCEL", "CLINIC_VISIT_BOOK", "CLINIC_VISIT_COMPLETE"]);
    expect(JSON.stringify(h.cp.audit.events)).not.toMatch(/Doente|Tudo bem/);
  });
});

describe("calendário e pesquisa global (AC-CLN-17/18, TC-CLN-12)", () => {
  it("calendário: forma do contrato, filtro por profissional e janela ≤ 31 dias; pesquisa global devolve pacientes e marcações da clínica", async () => {
    const h = await buildHarness();
    const patient = await create(h, h.admin, { name: "Maria Balcão" });
    await post(h, "/clinic-portal/walk-in-appointments", h.admin, { slotId: SLOT, patientEmail: EMAIL });
    await post(h, "/clinic-portal/walk-in-appointments", h.admin, { slotId: SLOT_3, clinicPatientId: patient.id });

    const win = "from=2026-11-30T00%3A00%3A00Z&to=2026-12-03T00%3A00%3A00Z";
    const calendar = await get(h, `/clinic-portal/calendar?${win}`, h.manager);
    expect(calendar.status).toBe(200);
    const body = calendar.body as { from: string; to: string; entries: { source: string; patientName: string; professionalId: string | null; kind: string }[]; freeSlots: { slotId: string; remaining: number }[] };
    expect(body.entries.map((e) => [e.source, e.kind])).toEqual([["VITA", "APPOINTMENT"], ["MANUAL", "APPOINTMENT"]]);
    // BR-CLN-23: livre = vaga ≥ 1 (SLOT e SLOT_3 ocupados; SLOT_2 tem vaga mesmo sobreposto ao do profissional; exame com 2 vagas)
    expect(body.freeSlots.map((f) => f.slotId).sort()).toEqual([SLOT_2, SLOT_EXAM].sort());
    expect(body.freeSlots.find((f) => f.slotId === SLOT_EXAM)?.remaining).toBe(2);
    expectNoVitaIds(body);
    const filtered = await get(h, `/clinic-portal/calendar?${win}&professionalId=${PROFESSIONAL}`, h.admin);
    expect((filtered.body as { entries: unknown[] }).entries).toHaveLength(1);
    expect((await get(h, "/clinic-portal/calendar?from=2026-11-01T00%3A00%3A00Z&to=2026-12-05T00%3A00%3A00Z", h.admin)).status).toBe(422);
    expect((await get(h, "/clinic-portal/calendar?from=2026-11-05T00%3A00%3A00Z&to=2026-11-01T00%3A00%3A00Z", h.admin)).status).toBe(422);
    // parâmetro obrigatório em falta: rejeitado pelo validador do contrato (400, como em todos os endpoints)
    expect((await get(h, "/clinic-portal/calendar?from=2026-11-05T00%3A00%3A00Z", h.admin)).status).toBe(400);

    const search = await get(h, "/clinic-portal/search?q=maria", h.admin);
    expect(search.status).toBe(200);
    const result = search.body as { patients: { name: string }[]; bookings: { patientName: string; source: string }[] };
    expect(result.patients.map((p) => p.name).sort()).toEqual(["Maria Balcão", "Maria S."]);
    expect(result.bookings.map((b) => b.source).sort()).toEqual(["MANUAL", "VITA"]);
    expectNoVitaIds(result);
    // outra clínica não vê nada
    expect((await get(h, "/clinic-portal/search?q=maria", h.otherClinic)).body).toEqual({ patients: [], bookings: [] });
  });
});
