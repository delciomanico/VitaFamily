// HTTP (supertest + express-openapi-validator contra docs/05-api/openapi.yaml, SEM base de dados): relatório da consulta e
// laudo de exame (M15 S/T, ADR-027, BR-CLN-41..50, AC-CLN-30..33, TC-AZ-CLN-V6). Casos de uso reais sobre os fakes das fixtures.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RequestHandler } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { runWithActor } from "../../src/platform/actor/index.js";
import { FixedClock } from "../../src/platform/clock/index.js";
import { createApp } from "../../src/platform/http/index.js";
import { createLogger } from "../../src/platform/logger/index.js";
import { signAccessToken } from "../../src/modules/auth/domain/jwt.js";
import { createBearerAuthSecurityHandler } from "../../src/modules/auth/interface/middleware.js";
import { createAddAddendumUseCase, createFinalizeReportUseCase, createGetReportPdfUseCase, createGetReportUseCase, createSaveReportUseCase } from "../../src/modules/clinic-reports/application/clinic-reports.js";
import { createGetFamilyReportPdfUseCase, createGetFamilyReportUseCase } from "../../src/modules/clinic-reports/application/family-reports.js";
import { createClinicReportsFixtures } from "../../src/modules/clinic-reports/application/fixtures.js";
import { createClinicReportsFamilyRouter } from "../../src/modules/clinic-reports/interface/family-router.js";
import { createClinicReportsPortalRouter } from "../../src/modules/clinic-reports/interface/portal-router.js";
import { signClinicAccessToken } from "../../src/modules/clinics/domain/clinic-jwt.js";
import { createClinicActorContextMiddleware, createClinicBearerAuthSecurityHandler } from "../../src/modules/clinics/interface/clinic-portal-middleware.js";
import { createCancelClinicExaminationUseCase, createCompleteClinicExaminationUseCase, createDeleteClinicExamDocumentUseCase, createListClinicExamAgendaUseCase, createUploadClinicExamDocumentUseCase } from "../../src/modules/examinations/application/clinic-examinations.js";
import { createCreateExaminationUseCase } from "../../src/modules/examinations/application/create-examination.js";
import { createExaminationsFixtures } from "../../src/modules/examinations/application/fixtures.js";
import { createDiscardResultsDraftUseCase, createDownloadExamReportUseCase, createGetResultsDraftUseCase, createSaveResultsDraftUseCase } from "../../src/modules/examinations/application/results-draft.js";
import { createExaminationsClinicPortalRouter } from "../../src/modules/examinations/interface/clinic-portal-router.js";

const OPENAPI_SPEC_PATH = join(dirname(fileURLToPath(import.meta.url)), "../../../../docs/05-api/openapi.yaml");
const NOW = new Date("2026-11-08T10:00:00.000Z");
const SLOT_AT = new Date("2026-12-01T09:30:00.000Z");
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
const VISIT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03";
const SLOT_1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01";
const SLOT_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02";
const KEYS = [{ kid: "k1", secret: new TextEncoder().encode("0123456789abcdef0123456789abcdef") }];
const API = "/api/v1";
const SECRET = "Lombalgia mecânica confidencial";
const BODY = { reason: "Dor lombar há 3 dias.", findings: "Sem défice neurológico.", impression: SECRET, plan: "Repouso relativo.", sharedWithPatient: true };
const RESULTS = [
  { parameter: "Hemoglobina", valueNumeric: 11.2, unit: "g/dL", referenceMin: 12, referenceMax: 16 },
  { parameter: "Cor", valueText: "Amarela" },
];

async function buildHarness() {
  const clock = new FixedClock(NOW);
  const cr = createClinicReportsFixtures(clock);
  cr.professionals.names.set(`${CLINIC_A}|${PROF_1}`, "Dr. João Costa");
  cr.professionals.names.set(`${CLINIC_A}|${PROF_2}`, "Dra. Lima");
  cr.professionals.slots.set(`${CLINIC_A}|${SLOT_1}`, PROF_1);
  cr.professionals.slots.set(`${CLINIC_A}|${SLOT_2}`, PROF_2);
  cr.bookings.seed("APPOINTMENT", APT, CLINIC_A, { slotId: SLOT_1, status: "COMPLETED" });
  cr.bookings.seed("APPOINTMENT", APT_2, CLINIC_A, { slotId: SLOT_2, status: "COMPLETED" });
  cr.bookings.seed("VISIT", VISIT, CLINIC_A, { slotId: SLOT_1, status: "COMPLETED" });
  cr.familyAppointments.seed(FAMILY, MEMBER, APT, CLINIC_A);
  cr.patientAccess.relations.set(`${USER_SELF}:${MEMBER}`, "SELF");
  cr.patientAccess.relations.set(`${USER_TUTOR}:${MEMBER}`, "TUTOR_OF");
  cr.patientAccess.relations.set(`${USER_OTHER}:${MEMBER}`, "OTHER");
  cr.patientAccess.relations.set(`${USER_DEP}:${MEMBER}`, "DEPENDENT_SELF");

  const ex = createExaminationsFixtures(clock);
  ex.clinics.seed(CLINIC_A, "Clínica Sol", FAMILY);
  ex.clinics.seedSlot({ id: SLOT_1, clinicId: CLINIC_A, kind: "EXAM", specialty: "Análises", startsAt: SLOT_AT, durationMinutes: 30, capacity: 5, professionalId: PROF_1 });
  ex.clinics.seedSlot({ id: SLOT_2, clinicId: CLINIC_A, kind: "EXAM", specialty: "Análises", startsAt: SLOT_AT, durationMinutes: 30, capacity: 5, professionalId: PROF_2 });
  ex.memberNames.names.set(`${FAMILY}:${MEMBER}`, "Maria Silva");
  const book = async (slotId: string) => (await createCreateExaminationUseCase(ex.deps)({ userId: USER_SELF, platformAdmin: false }, FAMILY, MEMBER, { name: "x", examDate: "1999-01-01", slotId }, { requestId: "r" })).id;

  const reportsPortal = createClinicReportsPortalRouter({
    getClinicConsultationReport: createGetReportUseCase(cr.deps),
    saveClinicConsultationReport: createSaveReportUseCase(cr.deps),
    finalizeClinicConsultationReport: createFinalizeReportUseCase(cr.deps),
    addClinicConsultationReportAddendum: createAddAddendumUseCase(cr.deps),
    getClinicConsultationReportPdf: createGetReportPdfUseCase(cr.deps),
  });
  const reportsFamily = createClinicReportsFamilyRouter({
    getFamilyConsultationReport: createGetFamilyReportUseCase(cr.deps),
    getFamilyConsultationReportPdf: createGetFamilyReportPdfUseCase(cr.deps),
  });
  const examsPortal = createExaminationsClinicPortalRouter({
    listClinicExamAgenda: createListClinicExamAgendaUseCase(ex.deps),
    cancelClinicExamination: createCancelClinicExaminationUseCase(ex.deps),
    completeClinicExamination: createCompleteClinicExaminationUseCase(ex.deps),
    uploadClinicExamDocument: createUploadClinicExamDocumentUseCase(ex.deps),
    deleteClinicExamDocument: createDeleteClinicExamDocumentUseCase(ex.deps),
    getClinicExamResultsDraft: createGetResultsDraftUseCase(ex.deps),
    saveClinicExamResultsDraft: createSaveResultsDraftUseCase(ex.deps),
    discardClinicExamResultsDraft: createDiscardResultsDraftUseCase(ex.deps),
    getClinicExamReportPdf: createDownloadExamReportUseCase(ex.deps),
  });

  const userActor: RequestHandler = (req, _res, next) => {
    if (!req.authSubject) { next(); return; }
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
      router.use(reportsFamily);
      router.use(reportsPortal);
      router.use(examsPortal);
    },
  });
  const clinicToken = async (account: string) => (await signClinicAccessToken({ subject: { clinicAccountId: account, sessionId: SESSION }, now: NOW, ttlSeconds: 900, signingKeys: KEYS })).token;
  const userToken = async (userId: string) => (await signAccessToken({ subject: { userId, sessionId: SESSION }, now: NOW, ttlSeconds: 900, signingKeys: KEYS })).token;
  return {
    app, cr, ex, book,
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
/** Corpo de resposta JSON como objeto (supertest devolve `any`). */
const json = (res: { body: unknown }): Record<string, unknown> => res.body as Record<string, unknown>;
const report = (id = APT) => `/clinic-portal/agenda/${id}/report`;

describe("relatório da consulta — portal da clínica (UC-CLN-32..35)", () => {
  let h: H;
  beforeEach(async () => {
    h = await buildHarness();
  });

  it("sem token => 401 em todas as operações", async () => {
    for (const [method, path] of [["get", report()], ["put", report()], ["put", `${report()}/finalize`], ["post", `${report()}/addenda`], ["get", `${report()}/pdf`]] as const) {
      expect((await request(h.app)[method](`${API}${path}`)).status, `${method} ${path}`).toBe(401);
    }
  });

  it("fluxo: Médico guarda (200) -> Gestor e Admin leem -> finaliza -> adenda (201) -> PUT depois de FINAL => 409; forma do contrato", async () => {
    const saved = await call(h, "put", report(), h.doctor, BODY);
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ bookingKind: "APPOINTMENT", bookingId: APT, status: "DRAFT", reason: BODY.reason, sharedWithPatient: true, patientName: "Maria Silva", authorName: "Dr. João Costa", finalizedAt: null, addenda: [] });
    expect((await call(h, "get", report(), h.manager)).body).toMatchObject({ status: "DRAFT", impression: SECRET });
    expect((await call(h, "get", report(), h.admin)).status).toBe(200);
    const final = await call(h, "put", `${report()}/finalize`, h.doctor);
    expect(final.status).toBe(200);
    expect(final.body).toMatchObject({ status: "FINAL", finalizedAt: NOW.toISOString() });
    expect((await call(h, "put", `${report()}/finalize`, h.doctor)).status).toBe(200); // idempotente
    expect((await call(h, "put", report(), h.doctor, BODY)).status).toBe(409);
    const amended = await call(h, "post", `${report()}/addenda`, h.doctor, { text: "Resultado recebido." });
    expect(amended.status).toBe(201);
    expect(json(amended).addenda).toEqual([{ id: expect.any(String) as string, text: "Resultado recebido.", authorName: "Dr. João Costa", createdAt: NOW.toISOString() }]);
    expect(json(amended).impression).toBe(SECRET);
  });

  it("matriz §6.2b: Admin e Gestor => 403 em PUT report, finalize e addenda (sem efeito); Médico de outro profissional => 404", async () => {
    for (const token of [h.admin, h.manager]) {
      expect((await call(h, "put", report(), token, BODY)).status).toBe(403);
      expect((await call(h, "put", `${report()}/finalize`, token)).status).toBe(403);
      expect((await call(h, "post", `${report()}/addenda`, token, { text: "x" })).status).toBe(403);
    }
    expect(h.cr.reportsRepo.reports.size).toBe(0);
    expect((await call(h, "put", report(), h.otherDoctor, BODY)).status).toBe(404);
    expect((await call(h, "put", report(APT_2), h.otherDoctor, BODY)).status).toBe(200);
  });

  it("isolamento: outra clínica => 404 (sem enumeração) e o relatório não vaza", async () => {
    await call(h, "put", report(), h.doctor, BODY);
    const res = await call(h, "get", report(), h.clinicB);
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
  });

  it("validação do contrato: sem secções, campo extra, tipo errado, id inválido => 4xx; erro sem texto do relatório", async () => {
    for (const body of [{}, { sharedWithPatient: true }, { reason: "x", html: "<b>" }, { reason: 5 }, { reason: "x".repeat(301) }]) {
      expect((await call(h, "put", report(), h.doctor, body)).status, JSON.stringify(body)).toBe(422);
    }
    expect((await call(h, "put", report("nao-uuid"), h.doctor, BODY)).status).toBe(400);
    expect((await call(h, "post", `${report()}/addenda`, h.doctor, {})).status).toBe(422);
    expect((await call(h, "get", report(), h.admin)).status).toBe(404);
  });

  it("20 adendas e a 21.ª => 409 LIMIT_EXCEEDED; adenda sobre DRAFT => 409", async () => {
    await call(h, "put", report(), h.doctor, BODY);
    expect((await call(h, "post", `${report()}/addenda`, h.doctor, { text: "x" })).status).toBe(409);
    await call(h, "put", `${report()}/finalize`, h.doctor);
    for (let i = 0; i < 20; i += 1) expect((await call(h, "post", `${report()}/addenda`, h.doctor, { text: `a${String(i)}` })).status).toBe(201);
    const last = await call(h, "post", `${report()}/addenda`, h.doctor, { text: "21" });
    expect(last.status).toBe(409);
    expect(last.body).toMatchObject({ code: "LIMIT_EXCEEDED" });
  });

  it("PDF: application/pdf, no-store, inline com nome sem dados pessoais; Gestor lê; DRAFT com marca; 404 sem relatório", async () => {
    expect((await call(h, "get", `${report()}/pdf`, h.manager)).status).toBe(404);
    await call(h, "put", report(), h.doctor, BODY);
    const res = await call(h, "get", `${report()}/pdf`, h.manager);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(res.headers["content-disposition"]).toBe('inline; filename="relatorio-20261108.pdf"');
    expect(res.headers["content-disposition"]).not.toMatch(/Maria|Silva/);
    expect(h.cr.pdf.rendered.at(-1)?.watermark).toBe("RASCUNHO — sem valor");
  });

  it("visita manual (despacho pelo id): relatório nunca partilhado", async () => {
    const res = await call(h, "put", report(VISIT), h.doctor, BODY);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ bookingKind: "VISIT", sharedWithPatient: false });
  });

  it("auditoria: só ids e contagens, nunca o texto do relatório nem o nome do paciente", async () => {
    await call(h, "put", report(), h.doctor, BODY);
    await call(h, "put", `${report()}/finalize`, h.doctor);
    await call(h, "get", report(), h.admin);
    await call(h, "get", `${report()}/pdf`, h.admin);
    expect(h.cr.audit.events.map((e) => e.action)).toEqual(["CONSULT_REPORT_SAVED", "CONSULT_REPORT_FINALIZED", "CONSULT_REPORT_VIEWED", "CONSULT_REPORT_VIEWED"]);
    expect(JSON.stringify(h.cr.audit.events)).not.toMatch(/Lombalgia|Maria|Dor lombar/);
  });
});

describe("relatório da consulta — lado família (UC-CLN-36, §6.6)", () => {
  let h: H;
  const path = `/families/${FAMILY}/members/${MEMBER}/appointments/${APT}/report`;
  beforeEach(async () => {
    h = await buildHarness();
    await call(h, "put", report(), h.doctor, BODY);
    await call(h, "put", `${report()}/finalize`, h.doctor);
    await call(h, "post", `${report()}/addenda`, h.doctor, { text: "Adenda" });
  });

  it("titular e tutor leem o FINAL partilhado (forma do contrato, sem ids da clínica/conta); sem token => 401", async () => {
    expect((await request(h.app).get(`${API}${path}`)).status).toBe(401);
    for (const token of [h.self, h.tutor]) {
      const res = await call(h, "get", path, token);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ appointmentId: APT, clinicName: "Clínica Sol", authorName: "Dr. João Costa", impression: SECRET, notice: "Documento não fiscal. Não substitui receita médica nem atestado." });
      expect(json(res).addenda).toHaveLength(1);
      expect(Object.keys(json(res))).not.toContain("clinicId");
      expect(Object.keys(json(res))).not.toContain("authorAccountId");
    }
  });

  it("DEPENDENT_SELF e OTHER (mesmo com partilha) => 403; membro de outra família/desconhecido => 404", async () => {
    for (const token of [h.dependent, h.other]) {
      expect((await call(h, "get", path, token)).status).toBe(403);
      expect((await call(h, "get", `${path}/pdf`, token)).status).toBe(403);
    }
    expect((await call(h, "get", path, h.stranger)).status).toBe(404);
  });

  it("PDF: attachment, no-store, auditado sempre; consulta sem relatório partilhado => 404", async () => {
    const res = await call(h, "get", `${path}/pdf`, h.self);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="relatorio-\d{8}\.pdf"$/);
    expect(h.cr.audit.events.at(-1)).toMatchObject({ action: "CONSULT_REPORT_VIEWED", actorType: "USER", metadata: { format: "PDF" } });
    h.cr.familyAppointments.seed(FAMILY, MEMBER, APT_2, CLINIC_A);
    expect((await call(h, "get", `/families/${FAMILY}/members/${MEMBER}/appointments/${APT_2}/report`, h.self)).status).toBe(404);
  });

  it("a clínica não lê nem escreve por esta via: o token de clínica é rejeitado (ADR-020)", async () => {
    expect((await call(h, "get", path, h.admin)).status).toBe(401);
  });
});

describe("rascunho de resultados e laudo — exame (UC-CLN-37/38)", () => {
  let h: H;
  let exam: string;
  let exam2: string;
  const draft = (id: string) => `/clinic-portal/exam-agenda/${id}/results-draft`;
  beforeEach(async () => {
    h = await buildHarness();
    exam = await h.book(SLOT_1);
    exam2 = await h.book(SLOT_2);
  });

  it("PUT (200) -> GET -> DELETE (204, idempotente) -> GET 404; Admin, Gestor e Médico (seus) podem", async () => {
    expect((await call(h, "get", draft(exam), h.admin)).status).toBe(404);
    const saved = await call(h, "put", draft(exam), h.doctor, { results: RESULTS, resultNote: "nota" });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ examinationId: exam, status: "DRAFT", resultNote: "nota", updatedAt: NOW.toISOString() });
    expect(json(saved).results).toHaveLength(2);
    expect(json(await call(h, "get", draft(exam), h.manager)).results).toHaveLength(2);
    expect((await call(h, "put", draft(exam), h.admin, { resultNote: "só nota" })).status).toBe(200);
    expect((await call(h, "delete", draft(exam), h.admin)).status).toBe(204);
    expect((await call(h, "delete", draft(exam), h.admin)).status).toBe(204);
    expect((await call(h, "get", draft(exam), h.admin)).status).toBe(404);
  });

  it("Médico de outro profissional => 404; outra clínica => 404; sem token => 401; validação => 422", async () => {
    expect((await call(h, "put", draft(exam), h.otherDoctor, { results: RESULTS })).status).toBe(404);
    expect((await call(h, "get", draft(exam), h.clinicB)).status).toBe(404);
    expect((await request(h.app).get(`${API}${draft(exam)}`)).status).toBe(401);
    for (const body of [{}, { results: [] }, { results: [{ parameter: "x" }] }, { results: RESULTS, extra: 1 }, { results: [{ parameter: "x", valueNumeric: 1, referenceMin: 5, referenceMax: 1 }] }]) {
      expect((await call(h, "put", draft(exam), h.admin, body)).status, JSON.stringify(body)).toBeGreaterThanOrEqual(400);
    }
  });

  it("complete sem results usa o rascunho e gera o laudo; GET report/pdf (inline, no-store); a vista indica reportAvailable e documento gerado; o paciente já não tem rascunho", async () => {
    await call(h, "put", draft(exam), h.doctor, { results: RESULTS });
    const done = await call(h, "put", `/clinic-portal/exam-agenda/${exam}/complete`, h.doctor, {});
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ status: "COMPLETED", resultsCount: 2, hasResultsDraft: false, reportAvailable: true });
    expect(json(done).documents).toEqual([expect.objectContaining({ generatedBySystem: true, scanStatus: "CLEAN" })]);
    expect(JSON.stringify(done.body)).not.toContain("Hemoglobina");
    const pdf = await call(h, "get", `/clinic-portal/exam-agenda/${exam}/report/pdf`, h.manager);
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toContain("application/pdf");
    expect(pdf.headers["cache-control"]).toBe("private, no-store");
    expect(pdf.headers["content-disposition"]).toBe('inline; filename="laudo-20261201.pdf"');
    expect((await call(h, "get", draft(exam), h.admin)).status).toBe(404);
    // Outro Médico não descarrega o laudo dos exames alheios.
    expect((await call(h, "get", `/clinic-portal/exam-agenda/${exam}/report/pdf`, h.otherDoctor)).status).toBe(404);
  });

  it("generateReport=false conclui sem laudo (404 na descarga); generateReport inválido => 422", async () => {
    const done = await call(h, "put", `/clinic-portal/exam-agenda/${exam2}/complete`, h.admin, { results: RESULTS, generateReport: false });
    expect(done.body).toMatchObject({ status: "COMPLETED", reportAvailable: false });
    expect((await call(h, "get", `/clinic-portal/exam-agenda/${exam2}/report/pdf`, h.admin)).status).toBe(404);
    expect((await call(h, "put", `/clinic-portal/exam-agenda/${exam}/complete`, h.admin, { results: RESULTS, generateReport: "sim" })).status).toBe(422);
  });

  it("falha na geração => 500 INTERNAL_ERROR e o exame fica SCHEDULED; a descarga antes de COMPLETED => 404", async () => {
    h.ex.reportGenerator.failWith = new Error("pdf");
    const res = await call(h, "put", `/clinic-portal/exam-agenda/${exam}/complete`, h.admin, { results: RESULTS });
    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ code: "INTERNAL_ERROR" });
    expect((await call(h, "get", `/clinic-portal/exam-agenda/${exam}/report/pdf`, h.admin)).status).toBe(404);
    expect(((await call(h, "get", "/clinic-portal/exam-agenda", h.admin)).body as { id: string }[]).find((e) => e.id === exam)).toMatchObject({ status: "SCHEDULED" });
  });
});
