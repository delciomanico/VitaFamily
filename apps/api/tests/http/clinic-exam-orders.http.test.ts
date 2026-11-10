// HTTP (supertest + express-openapi-validator contra docs/05-api/openapi.yaml, SEM base de dados): pedido de exame e declaração de
// presença (M15 U/V, ADR-028, BR-CLN-51..56, AC-CLN-34..36, TC-CLN-25..27, TC-AZ-CLN-V7). Casos de uso reais sobre os fakes das fixtures.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RequestHandler } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { runWithActor } from "../../src/platform/actor/index.js";
import { FixedClock } from "../../src/platform/clock/index.js";
import { createApp } from "../../src/platform/http/index.js";
import { createLogger } from "../../src/platform/logger/index.js";
import { createCompleteClinicAppointmentUseCase, createListClinicAgendaUseCase } from "../../src/modules/appointments/application/clinic-appointments.js";
import { createAppointmentsFixtures } from "../../src/modules/appointments/application/fixtures.js";
import { createAppointmentsClinicPortalRouter } from "../../src/modules/appointments/interface/clinic-portal-router.js";
import { signAccessToken } from "../../src/modules/auth/domain/jwt.js";
import { createBearerAuthSecurityHandler } from "../../src/modules/auth/interface/middleware.js";
import { createGetAttendanceStatementPdfUseCase } from "../../src/modules/clinic-reports/application/attendance-statement.js";
import {
  createCancelExamOrderUseCase,
  createCreateExamOrdersUseCase,
  createCreateWithCompleteUseCase,
  createExamOrderCountsUseCase,
  createGetExamOrdersPdfUseCase,
  createListExamOrdersUseCase,
} from "../../src/modules/clinic-reports/application/exam-orders.js";
import { createExamOrderLinker, createListFamilyExamOrdersUseCase } from "../../src/modules/clinic-reports/application/family-exam-orders.js";
import { createClinicReportsFixtures } from "../../src/modules/clinic-reports/application/fixtures.js";
import { PdfKitRenderer } from "../../src/modules/clinic-reports/infrastructure/pdfkit-renderer.js";
import { createClinicReportsFamilyRouter } from "../../src/modules/clinic-reports/interface/family-router.js";
import { createClinicReportsPortalRouter } from "../../src/modules/clinic-reports/interface/portal-router.js";
import { signClinicAccessToken } from "../../src/modules/clinics/domain/clinic-jwt.js";
import { createClinicActorContextMiddleware, createClinicBearerAuthSecurityHandler } from "../../src/modules/clinics/interface/clinic-portal-middleware.js";

const OPENAPI_SPEC_PATH = join(dirname(fileURLToPath(import.meta.url)), "../../../../docs/05-api/openapi.yaml");
const NOW = new Date("2026-11-10T10:00:00.000Z");
const FAMILY = "11111111-1111-4111-8111-111111111111";
const MEMBER = "22222222-2222-4222-8222-222222222222";
const CLINIC_A = "33333333-3333-4333-8333-333333333333";
const CLINIC_B = "44444444-4444-4444-8444-444444444444";
const ADMIN = "55555555-5555-4555-8555-555555555555";
const MANAGER = "66666666-6666-4666-8666-666666666666";
const DOCTOR = "77777777-7777-4777-8777-777777777771";
const OTHER_DOCTOR = "77777777-7777-4777-8777-777777777772";
const ACCOUNT_B = "77777777-7777-4777-8777-777777777773";
const USER_SELF = "88888888-8888-4888-8888-888888888881";
const USER_TUTOR = "88888888-8888-4888-8888-888888888882";
const USER_OTHER = "88888888-8888-4888-8888-888888888883";
const USER_DEP = "88888888-8888-4888-8888-888888888884";
const USER_STRANGER = "88888888-8888-4888-8888-888888888885";
const SESSION = "99999999-9999-4999-8999-999999999999";
const PROF_1 = "cccccccc-cccc-4ccc-8ccc-cccccccccc01";
const PROF_2 = "cccccccc-cccc-4ccc-8ccc-cccccccccc02";
const APT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01";
const APT_2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02";
const APT_DONE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03";
const APT_NOSHOW = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa04";
const APT_ARRIVED = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa05";
const VISIT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa06";
const COMPLETE_APT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa07";
const SLOT_1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01";
const SLOT_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02";
const SERVICE = "6f9619ff-8b86-4011-b42d-00c04fc964ff";
const KEYS = [{ kid: "k1", secret: new TextEncoder().encode("0123456789abcdef0123456789abcdef") }];
const API = "/api/v1";
const SECRET = "Teste de VIH confidencial";
const FORBIDDEN_PDF_TOKENS = ["/JavaScript", "/JS", "/Launch", "/URI", "/EmbeddedFile", "/AcroForm"];

async function buildHarness() {
  const clock = new FixedClock(NOW);
  const cr = createClinicReportsFixtures(clock);
  cr.professionals.names.set(`${CLINIC_A}|${PROF_1}`, "Dr. João Costa");
  cr.professionals.names.set(`${CLINIC_A}|${PROF_2}`, "Dra. Lima");
  cr.professionals.slots.set(`${CLINIC_A}|${SLOT_1}`, PROF_1);
  cr.professionals.slots.set(`${CLINIC_A}|${SLOT_2}`, PROF_2);
  const vita = { vitaMember: { familyId: FAMILY, memberId: MEMBER } };
  cr.bookings.seed("APPOINTMENT", APT, CLINIC_A, { slotId: SLOT_1, patientName: "Maria Silva", ...vita });
  cr.bookings.seed("APPOINTMENT", APT_2, CLINIC_A, { slotId: SLOT_2, ...vita });
  cr.bookings.seed("APPOINTMENT", APT_DONE, CLINIC_A, { slotId: SLOT_1, status: "COMPLETED", ...vita });
  cr.bookings.seed("APPOINTMENT", APT_NOSHOW, CLINIC_A, { slotId: SLOT_1, status: "NO_SHOW", ...vita });
  cr.bookings.seed("APPOINTMENT", APT_ARRIVED, CLINIC_A, { slotId: SLOT_1, arrivedAt: new Date("2026-11-10T09:00:00Z"), ...vita });
  cr.bookings.seed("VISIT", VISIT, CLINIC_A, { slotId: SLOT_1, status: "SCHEDULED" });
  cr.bookings.seed("APPOINTMENT", COMPLETE_APT, CLINIC_A, { slotId: SLOT_1, status: "COMPLETED", ...vita });
  cr.patientAccess.relations.set(`${USER_SELF}:${MEMBER}`, "SELF");
  cr.patientAccess.relations.set(`${USER_TUTOR}:${MEMBER}`, "TUTOR_OF");
  cr.patientAccess.relations.set(`${USER_OTHER}:${MEMBER}`, "OTHER");
  cr.patientAccess.relations.set(`${USER_DEP}:${MEMBER}`, "DEPENDENT_SELF");
  cr.services.services.set(`${CLINIC_A}|${SERVICE}`, { id: SERVICE, name: "Ecografia abdominal", kind: "EXAM", active: true });
  // PDF reais (pdfkit) para provar o conteúdo dos bytes devolvidos pela API.
  const realPdf = new PdfKitRenderer({ compress: false });
  cr.deps.pdf.render = (document) => {
    cr.pdf.rendered.push(document);
    return realPdf.render(document);
  };

  const portal = createClinicReportsPortalRouter({
    getClinicConsultationReport: () => Promise.reject(new Error("fora do âmbito")),
    saveClinicConsultationReport: () => Promise.reject(new Error("fora do âmbito")),
    finalizeClinicConsultationReport: () => Promise.reject(new Error("fora do âmbito")),
    addClinicConsultationReportAddendum: () => Promise.reject(new Error("fora do âmbito")),
    getClinicConsultationReportPdf: () => Promise.reject(new Error("fora do âmbito")),
    listClinicExamOrders: createListExamOrdersUseCase(cr.deps),
    createClinicExamOrders: createCreateExamOrdersUseCase(cr.deps),
    cancelClinicExamOrder: createCancelExamOrderUseCase(cr.deps),
    getClinicExamOrdersPdf: createGetExamOrdersPdfUseCase(cr.deps),
    getClinicAttendanceStatementPdf: createGetAttendanceStatementPdfUseCase(cr.deps),
  });
  const family = createClinicReportsFamilyRouter({
    getFamilyConsultationReport: () => Promise.reject(new Error("fora do âmbito")),
    getFamilyConsultationReportPdf: () => Promise.reject(new Error("fora do âmbito")),
    listFamilyExamOrders: createListFamilyExamOrdersUseCase(cr.deps),
  });

  // `complete` real de `appointments` ligado à porta real de `clinic-reports` (como o composition root).
  const ap = createAppointmentsFixtures(clock);
  ap.clinics.seed(CLINIC_A, "Clínica Sol", "");
  ap.clinics.seedSlot({ id: SLOT_1, clinicId: CLINIC_A, kind: "APPOINTMENT", specialty: "Cardiologia", startsAt: NOW, durationMinutes: 30, capacity: 1, professionalId: PROF_1, professionalName: "Dr. João Costa" });
  ap.memberNames.seed(FAMILY, MEMBER, "Maria Silva");
  ap.appointmentsRepo.seed({ id: COMPLETE_APT, familyId: FAMILY, memberId: MEMBER, scheduledAt: NOW, status: "SCHEDULED", confirmationStatus: "PENDING", clinicId: CLINIC_A, slotId: SLOT_1, createdAt: NOW });
  const createWithComplete = createCreateWithCompleteUseCase(cr.deps);
  ap.deps.consultationReports.createExamOrdersWithComplete = (trx, actor, kind, bookingId, examOrders, context) =>
    createWithComplete(trx, { clinicAccountId: actor.clinicAccountId, clinicId: actor.clinicId, role: actor.professionalId ? "CLINIC_DOCTOR" : "CLINIC_MANAGER", ...(actor.professionalId ? { professionalId: actor.professionalId } : {}) }, kind, bookingId, examOrders, context);
  const appointmentsPortal = createAppointmentsClinicPortalRouter({
    completeClinicAppointment: createCompleteClinicAppointmentUseCase(ap.deps),
    listClinicAgenda: createListClinicAgendaUseCase(ap.deps),
  } as unknown as Parameters<typeof createAppointmentsClinicPortalRouter>[0]);
  ap.deps.consultationReports.examOrderCounts = (trx, clinicId, _kind, bookingIds) => createExamOrderCountsUseCase(cr.deps)(trx, clinicId, bookingIds);

  const userActor: RequestHandler = (req, _res, next) => {
    if (!req.authSubject) {
      next();
      return;
    }
    runWithActor({ userId: req.authSubject.userId, platformAdmin: false }, () => {
      next();
    });
  };
  const clinicActor = createClinicActorContextMiddleware({
    resolveClinicActorState: (clinicAccountId, sessionId) =>
      Promise.resolve({
        clinicAccountId,
        sessionId,
        clinicId: clinicAccountId === ACCOUNT_B ? CLINIC_B : CLINIC_A,
        role: clinicAccountId === ADMIN ? ("CLINIC_ADMIN" as const) : clinicAccountId === MANAGER || clinicAccountId === ACCOUNT_B ? ("CLINIC_MANAGER" as const) : ("CLINIC_DOCTOR" as const),
        ...(clinicAccountId === DOCTOR ? { professionalId: PROF_1 } : clinicAccountId === OTHER_DOCTOR ? { professionalId: PROF_2 } : {}),
        suspended: false,
      }),
  });
  const app = createApp({
    openApiSpecPath: OPENAPI_SPEC_PATH,
    logger: createLogger({ level: "silent" }),
    securityHandlers: { bearerAuth: createBearerAuthSecurityHandler({ signingKeys: KEYS, clock }), clinicBearerAuth: createClinicBearerAuthSecurityHandler({ signingKeys: KEYS, clock }) },
    actorContextMiddleware: (req, res, next) => {
      userActor(req, res, (err?: unknown) => {
        if (err) {
          next(err);
          return;
        }
        clinicActor(req, res, next);
      });
    },
    registerHealthRoutes: (router) => {
      router.get("/health", (_req, res) => res.json({ status: "ok" }));
    },
    registerRoutes: (router) => {
      router.use(family);
      router.use(portal);
      router.use(appointmentsPortal);
    },
  });
  const clinicToken = async (account: string) => (await signClinicAccessToken({ subject: { clinicAccountId: account, sessionId: SESSION }, now: NOW, ttlSeconds: 900, signingKeys: KEYS })).token;
  const userToken = async (userId: string) => (await signAccessToken({ subject: { userId, sessionId: SESSION }, now: NOW, ttlSeconds: 900, signingKeys: KEYS })).token;
  return {
    app, cr, ap,
    admin: await clinicToken(ADMIN), manager: await clinicToken(MANAGER), doctor: await clinicToken(DOCTOR), otherDoctor: await clinicToken(OTHER_DOCTOR), clinicB: await clinicToken(ACCOUNT_B),
    self: await userToken(USER_SELF), tutor: await userToken(USER_TUTOR), other: await userToken(USER_OTHER), dependent: await userToken(USER_DEP), stranger: await userToken(USER_STRANGER),
  };
}
type H = Awaited<ReturnType<typeof buildHarness>>;
type Method = "get" | "put" | "post" | "delete";
const call = (h: H, method: Method, path: string, token: string, body?: unknown) => {
  const req = request(h.app)[method](`${API}${path}`).set("Authorization", `Bearer ${token}`);
  return body === undefined ? req : req.send(body as object);
};
const json = (res: { body: unknown }): Record<string, unknown> => res.body as Record<string, unknown>;
const orders = (id = APT) => `/clinic-portal/agenda/${id}/exam-orders`;
const ITEMS = { items: [{ name: SECRET, note: "Jejum de 8 h", urgent: true }, { serviceTypeId: SERVICE }] };

describe("pedido de exame — portal da clínica (UC-CLN-39..41)", () => {
  let h: H;
  beforeEach(async () => {
    h = await buildHarness();
  });

  it("sem token => 401 em todas as operações", async () => {
    for (const [method, path] of [["get", orders()], ["post", orders()], ["put", `${orders()}/${SERVICE}/cancel`], ["get", `${orders()}/pdf`], ["get", `/clinic-portal/agenda/${APT_DONE}/attendance-statement/pdf`]] as const) {
      expect((await request(h.app)[method](`${API}${path}`)).status, `${method} ${path}`).toBe(401);
    }
  });

  it("fluxo: Médico cria (201, forma do contrato) -> Admin e Gestor leem -> Médico cancela -> idempotente (200)", async () => {
    const created = await call(h, "post", orders(), h.doctor, ITEMS);
    expect(created.status).toBe(201);
    const items = json(created).items as Record<string, unknown>[];
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ bookingKind: "APPOINTMENT", bookingId: APT, name: SECRET, note: "Jejum de 8 h", urgent: true, status: "ORDERED", patientName: "Maria Silva", authorName: "Dr. João Costa", cancelledAt: null });
    expect(items[1]).toMatchObject({ name: "Ecografia abdominal", serviceTypeId: SERVICE, urgent: false });
    for (const token of [h.admin, h.manager, h.doctor]) {
      const read = await call(h, "get", orders(), token);
      expect(read.status).toBe(200);
      expect(json(read).items).toHaveLength(2);
    }
    const id = String(items[0]?.id);
    const cancelled = await call(h, "put", `${orders()}/${id}/cancel`, h.doctor);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({ id, status: "CANCELLED", cancelledAt: NOW.toISOString() });
    expect((await call(h, "put", `${orders()}/${id}/cancel`, h.doctor)).status).toBe(200);
  });

  it("matriz §6.2b (TC-AZ-CLN-V7): Admin e Gestor => 403 em POST e cancel (sem efeito); Médico de outro profissional => 404; outra clínica => 404", async () => {
    for (const token of [h.admin, h.manager]) {
      expect((await call(h, "post", orders(), token, ITEMS)).status).toBe(403);
      expect((await call(h, "put", `${orders()}/${SERVICE}/cancel`, token)).status).toBe(403);
    }
    expect(h.cr.ordersRepo.orders.size).toBe(0);
    expect((await call(h, "post", orders(), h.otherDoctor, ITEMS)).status).toBe(404);
    expect((await call(h, "post", orders(APT_2), h.otherDoctor, ITEMS)).status).toBe(201);
    expect((await call(h, "post", orders(), h.clinicB, ITEMS)).status).toBe(403); // Gestor da clínica B
    expect((await call(h, "get", orders(), h.clinicB)).status).toBe(404);
  });

  it("validação do contrato: 0/6 itens, nome e serviço ambos/nenhum, texto longo, controlo, campo extra, id inválido => 4xx sem o texto no erro", async () => {
    const bad: unknown[] = [
      {},
      { items: [] },
      { items: Array.from({ length: 6 }, () => ({ name: "x" })) },
      { items: [{ name: "x", serviceTypeId: SERVICE }] },
      { items: [{ note: "x" }] },
      { items: [{ name: "a".repeat(81) }] },
      { items: [{ name: "x", note: "a".repeat(201) }] },
      { items: [{ name: "a\u0007b" }] },
      { items: [{ name: "x", price: 1 }] },
      { items: [{ name: "x" }], extra: true },
    ];
    for (const body of bad) {
      const res = await call(h, "post", orders(), h.doctor, body);
      expect([400, 422], JSON.stringify(body)).toContain(res.status);
      expect(JSON.stringify(res.body)).not.toContain("VIH");
    }
    expect((await call(h, "post", orders("nao-uuid"), h.doctor, ITEMS)).status).toBe(400);
    expect(h.cr.ordersRepo.orders.size).toBe(0);
  });

  it("estados da marcação: COMPLETED admite; NO_SHOW => 409; mais de 5 ativos => 409 LIMIT_EXCEEDED; serviço inexistente => 404", async () => {
    expect((await call(h, "post", orders(APT_DONE), h.doctor, { items: [{ name: "x" }] })).status).toBe(201);
    expect((await call(h, "post", orders(APT_NOSHOW), h.doctor, { items: [{ name: "x" }] })).status).toBe(409);
    for (let i = 0; i < 5; i += 1) expect((await call(h, "post", orders(APT_2).replace(APT_2, APT), h.doctor, { items: [{ name: `E${String(i)}` }] })).status).toBe(201);
    const sixth = await call(h, "post", orders(), h.doctor, { items: [{ name: "sexto" }] });
    expect(sixth.status).toBe(409);
    expect(sixth.body).toMatchObject({ code: "LIMIT_EXCEEDED" });
    expect((await call(h, "post", orders(APT_DONE), h.doctor, { items: [{ serviceTypeId: "6f9619ff-8b86-4011-b42d-00c04fc964aa" }] })).status).toBe(404);
  });

  it("cancelar pedido cumprido na própria clínica => 409; marcado noutra clínica mostra ORDERED e cancela-se", async () => {
    const created = json(await call(h, "post", orders(), h.doctor, { items: [{ name: "A" }, { name: "B" }] })).items as { id: string }[];
    const linker = createExamOrderLinker(h.cr.deps);
    await linker.link({}, { actor: { userId: USER_SELF, platformAdmin: false }, familyId: FAMILY, memberId: MEMBER, orderId: created[0]?.id ?? "", examinationId: "ex-a", examClinicId: CLINIC_A, status: "COMPLETED" }, { requestId: "r" });
    await linker.link({}, { actor: { userId: USER_SELF, platformAdmin: false }, familyId: FAMILY, memberId: MEMBER, orderId: created[1]?.id ?? "", examinationId: "ex-b", examClinicId: CLINIC_B, status: "COMPLETED" }, { requestId: "r" });
    const read = json(await call(h, "get", orders(), h.manager)).items as { status: string }[];
    expect(read.map((o) => o.status)).toEqual(["FULFILLED", "ORDERED"]);
    expect((await call(h, "put", `${orders()}/${String(created[0]?.id)}/cancel`, h.doctor)).status).toBe(409);
    expect((await call(h, "put", `${orders()}/${String(created[1]?.id)}/cancel`, h.doctor)).status).toBe(200);
  });

  it("PDF do pedido: application/pdf, no-store, inline com nome sem dados pessoais; Admin/Gestor/Médico leem; só texto (sem /JavaScript…); sem ativos => 404", async () => {
    expect((await call(h, "get", `${orders()}/pdf`, h.manager)).status).toBe(404);
    await call(h, "post", orders(), h.doctor, ITEMS);
    for (const token of [h.admin, h.manager, h.doctor]) {
      const res = await call(h, "get", `${orders()}/pdf`, token);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("application/pdf");
      expect(res.headers["cache-control"]).toBe("private, no-store");
      expect(res.headers["content-disposition"]).toBe('inline; filename="pedido-exame-20261108.pdf"');
      expect(res.headers["content-disposition"]).not.toMatch(/Maria|Silva/);
      const raw = (res.body as Buffer).toString("latin1");
      expect(raw.startsWith("%PDF-")).toBe(true);
      for (const token2 of FORBIDDEN_PDF_TOKENS) expect(raw, token2).not.toContain(token2);
    }
    expect((await call(h, "get", `${orders()}/pdf`, h.otherDoctor)).status).toBe(404);
    expect((await call(h, "get", `${orders()}/pdf`, h.clinicB)).status).toBe(404);
  });

  it("auditoria: só ids e contagens, nunca o nome do exame, a nota nem o nome do paciente", async () => {
    const created = json(await call(h, "post", orders(), h.doctor, ITEMS)).items as { id: string }[];
    await call(h, "get", orders(), h.admin);
    await call(h, "get", `${orders()}/pdf`, h.admin);
    await call(h, "put", `${orders()}/${String(created[0]?.id)}/cancel`, h.doctor);
    expect(h.cr.audit.events.map((e) => e.action)).toEqual(["EXAM_ORDER_CREATED", "EXAM_ORDER_VIEWED", "EXAM_ORDER_VIEWED", "EXAM_ORDER_CANCELLED"]);
    expect(JSON.stringify(h.cr.audit.events)).not.toMatch(/VIH|Jejum|Maria|Ecografia/);
    expect(h.cr.orderAlerts.raised).toEqual([{ appointmentId: APT, familyId: FAMILY, memberId: MEMBER }]);
  });

  it("visita manual (despacho pelo id): sem ponte nem alerta; imprime-se", async () => {
    expect((await call(h, "post", orders(VISIT), h.doctor, { items: [{ name: "x" }] })).status).toBe(201);
    expect(h.cr.ordersRepo.links.size).toBe(0);
    expect(h.cr.orderAlerts.raised).toEqual([]);
    expect((await call(h, "get", `${orders(VISIT)}/pdf`, h.manager)).status).toBe(200);
  });

  it("rate limit: 30 escritas/min por conta e a 31.ª => 429", async () => {
    for (let i = 0; i < 30; i += 1) await call(h, "post", orders(), h.doctor, { items: [{ name: "x" }] });
    expect((await call(h, "post", orders(), h.doctor, { items: [{ name: "x" }] })).status).toBe(429);
  });
});

describe("`examOrders` em PUT …/complete (BR-CLN-51)", () => {
  let h: H;
  beforeEach(async () => {
    h = await buildHarness();
  });

  it("Médico: conclui e cria os pedidos na mesma operação; a resposta traz examOrderCount", async () => {
    const res = await call(h, "put", `/clinic-portal/agenda/${COMPLETE_APT}/complete`, h.doctor, { outcomeNote: "ok", examOrders: [{ name: "Hemograma" }, { name: "Glicemia", urgent: true }] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: COMPLETE_APT, status: "COMPLETED", examOrderCount: 2 });
    expect([...h.cr.ordersRepo.orders.values()].map((o) => o.name).sort()).toEqual(["Glicemia", "Hemograma"]);
  });

  it("Admin/Gestor com examOrders => 403 FORBIDDEN e nada se grava; mais de 5 itens => 4xx", async () => {
    const forbidden = await call(h, "put", `/clinic-portal/agenda/${COMPLETE_APT}/complete`, h.admin, { outcomeNote: "ok", examOrders: [{ name: "x" }] });
    expect(forbidden.status).toBe(403);
    expect(h.cr.ordersRepo.orders.size).toBe(0);
    const tooMany = await call(h, "put", `/clinic-portal/agenda/${COMPLETE_APT}/complete`, h.doctor, { outcomeNote: "ok", examOrders: Array.from({ length: 6 }, () => ({ name: "x" })) });
    expect([400, 422]).toContain(tooMany.status);
  });
});

describe("pedido de exame — lado família (UC-CLN-42, §6.7)", () => {
  let h: H;
  const path = `/families/${FAMILY}/members/${MEMBER}/exam-orders`;
  beforeEach(async () => {
    h = await buildHarness();
    await call(h, "post", orders(), h.doctor, ITEMS);
  });

  it("SELF e TUTOR_OF leem (forma do contrato, sem conta autora); filtros status/appointmentId", async () => {
    for (const token of [h.self, h.tutor]) {
      const res = await call(h, "get", path, token);
      expect(res.status).toBe(200);
      const items = json(res).items as Record<string, unknown>[];
      expect(items).toHaveLength(2);
      expect(items[0]).toMatchObject({ appointmentId: APT, clinicId: CLINIC_A, clinicName: "Clínica Sol", status: "ORDERED", examinationId: null });
      expect(Object.keys(items[0] ?? {})).not.toContain("authorAccountId");
    }
    expect(json(await call(h, "get", `${path}?status=CANCELLED`, h.self)).items).toEqual([]);
    expect(json(await call(h, "get", `${path}?appointmentId=${APT_2}`, h.self)).items).toEqual([]);
    expect((await call(h, "get", `${path}?status=INVALID`, h.self)).status).toBe(400);
  });

  it("DEPENDENT_SELF e OTHER => 403; desconhecido => 404; sem token => 401; a clínica não usa esta rota", async () => {
    expect((await call(h, "get", path, h.dependent)).status).toBe(403);
    expect((await call(h, "get", path, h.other)).status).toBe(403);
    expect((await call(h, "get", path, h.stranger)).status).toBe(404);
    expect((await request(h.app).get(`${API}${path}`)).status).toBe(401);
    expect((await call(h, "get", path, h.manager)).status).toBe(401);
  });

  it("não há rota da família para o PDF do pedido nem para a declaração de presença", async () => {
    for (const p of [`${path}/pdf`, `/families/${FAMILY}/members/${MEMBER}/appointments/${APT}/attendance-statement/pdf`]) {
      expect([401, 404], p).toContain((await call(h, "get", p, h.self)).status);
    }
  });
});

describe("declaração de presença (UC-CLN-43, BR-CLN-55)", () => {
  let h: H;
  const statement = (id: string, query = "") => `/clinic-portal/agenda/${id}/attendance-statement/pdf${query}`;
  beforeEach(async () => {
    h = await buildHarness();
  });

  it("COMPLETED ou SCHEDULED com chegada: Admin, Gestor e Médico (suas) obtêm o PDF (cabeçalhos, nome sem dados pessoais, só texto)", async () => {
    for (const [token, id] of [[h.admin, APT_DONE], [h.manager, APT_ARRIVED], [h.doctor, APT_ARRIVED]] as const) {
      const res = await call(h, "get", statement(id), token);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("application/pdf");
      expect(res.headers["cache-control"]).toBe("private, no-store");
      expect(res.headers["content-disposition"]).toBe('inline; filename="declaracao-20261108.pdf"');
      const raw = (res.body as Buffer).toString("latin1");
      expect(raw.startsWith("%PDF-")).toBe(true);
      for (const t of FORBIDDEN_PDF_TOKENS) expect(raw, t).not.toContain(t);
    }
    expect(h.cr.audit.events.filter((e) => e.action === "ATTENDANCE_STATEMENT_ISSUED")).toHaveLength(3);
    expect(JSON.stringify(h.cr.audit.events)).not.toMatch(/Maria|Silva/);
  });

  it("includeProfessional: omissão false; true acrescenta o profissional; valor inválido => 400", async () => {
    await call(h, "get", statement(APT_DONE), h.manager);
    expect(JSON.stringify(h.cr.pdf.rendered.at(-1)?.blocks)).not.toContain("Profissional");
    await call(h, "get", statement(APT_DONE, "?includeProfessional=true"), h.manager);
    expect(JSON.stringify(h.cr.pdf.rendered.at(-1)?.blocks)).toContain("Profissional: Dr. João Costa");
    expect((await call(h, "get", statement(APT_DONE, "?includeProfessional=talvez"), h.manager)).status).toBe(400);
  });

  it("não elegível (SCHEDULED sem chegada, NO_SHOW, visita agendada) => 409; outra clínica/profissional => 404; id inválido => 400", async () => {
    for (const id of [APT, APT_NOSHOW, VISIT]) expect((await call(h, "get", statement(id), h.manager)).status, id).toBe(409);
    expect((await call(h, "get", statement(APT_DONE), h.clinicB)).status).toBe(404);
    expect((await call(h, "get", statement(APT_DONE), h.otherDoctor)).status).toBe(404);
    expect((await call(h, "get", statement("x"), h.manager)).status).toBe(400);
  });

  it("rate limit: 30 PDF/min por conta (bolsa partilhada) e a 31.ª => 429", async () => {
    for (let i = 0; i < 30; i += 1) expect((await call(h, "get", statement(APT_DONE), h.manager)).status).toBe(200);
    expect((await call(h, "get", statement(APT_DONE), h.manager)).status).toBe(429);
  });
});
