// HTTP (supertest + express-openapi-validator contra docs/05-api/openapi.yaml, SEM base de dados: os
// casos de uso reais correm sobre os fakes das fixtures). Cobre: conformidade OpenAPI das rotas novas
// (D19/ADR-023), separação de tokens (ADR-020: token de User rejeitado em /clinic-portal e vice-versa,
// mesmo com a mesma chave de assinatura), isolamento entre clínicas, minimização (BR-CLN-03) e o upload
// de PDF (só PDF, só metadados de volta).
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RequestHandler } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { FixedClock } from "../../src/platform/clock/index.js";
import { runWithActor } from "../../src/platform/actor/index.js";
import { createApp } from "../../src/platform/http/index.js";
import { createLogger } from "../../src/platform/logger/index.js";
import { signAccessToken } from "../../src/modules/auth/domain/jwt.js";
import { createBearerAuthSecurityHandler } from "../../src/modules/auth/interface/middleware.js";
import { signClinicAccessToken } from "../../src/modules/clinics/domain/clinic-jwt.js";
import { createClinicActorContextMiddleware, createClinicBearerAuthSecurityHandler } from "../../src/modules/clinics/interface/clinic-portal-middleware.js";
import { createDeleteClinicExamDocumentUseCase as createDocsDelete, createUploadClinicExamDocumentUseCase as createDocsUpload } from "../../src/modules/documents/application/clinic-documents.js";
import { createDocumentsFixtures } from "../../src/modules/documents/application/fixtures.js";
import {
  createCancelClinicExaminationUseCase,
  createCompleteClinicExaminationUseCase,
  createDeleteClinicExamDocumentUseCase,
  createListClinicExamAgendaUseCase,
  createUploadClinicExamDocumentUseCase,
} from "../../src/modules/examinations/application/clinic-examinations.js";
import { createCreateExaminationUseCase } from "../../src/modules/examinations/application/create-examination.js";
import { createExaminationsFixtures } from "../../src/modules/examinations/application/fixtures.js";
import { createGetExaminationUseCase } from "../../src/modules/examinations/application/get-examination.js";
import { createListExaminationsUseCase } from "../../src/modules/examinations/application/list-examinations.js";
import { createExaminationsClinicPortalRouter } from "../../src/modules/examinations/interface/clinic-portal-router.js";
import { createExaminationsRouter, type ExaminationsController } from "../../src/modules/examinations/interface/router.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const OPENAPI_SPEC_PATH = join(REPO_ROOT, "docs/05-api/openapi.yaml");
const NOW = new Date("2026-01-15T10:00:00.000Z");
const SLOT_AT = new Date("2026-02-01T09:30:00.000Z");
const FAMILY = "11111111-1111-4111-8111-111111111111";
const MEMBER = "22222222-2222-4222-8222-222222222222";
const CLINIC_A = "33333333-3333-4333-8333-333333333333";
const CLINIC_B = "44444444-4444-4444-8444-444444444444";
const ACCOUNT_A = "55555555-5555-4555-8555-555555555555";
const ACCOUNT_B = "66666666-6666-4666-8666-666666666666";
const USER = "77777777-7777-4777-8777-777777777777";
const SESSION = "88888888-8888-4888-8888-888888888888";
const SLOT = "99999999-9999-4999-8999-999999999999";
const APPT_SLOT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
// A MESMA chave assina os dois tipos de token: só as claims os distinguem (ADR-020).
const KEYS = [{ kid: "k1", secret: new TextEncoder().encode("0123456789abcdef0123456789abcdef") }];
const PDF = Buffer.from("%PDF-1.4\n%fake\n");

async function buildHarness() {
  const clock = new FixedClock(NOW);
  const fx = createExaminationsFixtures(clock);
  fx.clinics.seed(CLINIC_A, "Clínica Sol", FAMILY);
  fx.clinics.seedSlot({ id: SLOT, clinicId: CLINIC_A, kind: "EXAM", specialty: "Ecografia", startsAt: SLOT_AT, durationMinutes: 30, capacity: 2 });
  fx.clinics.seedSlot({ id: APPT_SLOT, clinicId: CLINIC_A, kind: "APPOINTMENT", specialty: "Cardiologia", startsAt: SLOT_AT, durationMinutes: 30, capacity: 1 });
  fx.memberNames.names.set(`${FAMILY}:${MEMBER}`, "Maria Silva");

  // `documents` real (use cases + fakes) por trás da porta de `examinations`.
  const docs = createDocumentsFixtures(clock);
  const upload = createDocsUpload(docs.deps);
  const remove = createDocsDelete(docs.deps);
  Object.assign(fx.documents, {
    uploadClinicExamDocument: upload,
    deleteClinicExamDocument: remove,
    listForResource: (trx: Record<string, never>, familyId: string, memberId: string, type: "PRESCRIPTION" | "EXAMINATION", id: string) => docs.documentsRepo.listByResource(trx, familyId, memberId, type, id),
  });

  const userController: ExaminationsController = {
    listExaminations: createListExaminationsUseCase(fx.deps),
    createExamination: createCreateExaminationUseCase(fx.deps),
    getExamination: createGetExaminationUseCase(fx.deps),
  } as unknown as ExaminationsController;
  const clinicRouter = createExaminationsClinicPortalRouter({
    listClinicExamAgenda: createListClinicExamAgendaUseCase(fx.deps),
    cancelClinicExamination: createCancelClinicExaminationUseCase(fx.deps),
    completeClinicExamination: createCompleteClinicExaminationUseCase(fx.deps),
    uploadClinicExamDocument: createUploadClinicExamDocumentUseCase(fx.deps),
    deleteClinicExamDocument: createDeleteClinicExamDocumentUseCase(fx.deps),
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
      Promise.resolve({ clinicAccountId, sessionId, clinicId: clinicAccountId === ACCOUNT_B ? CLINIC_B : CLINIC_A, role: "CLINIC_MANAGER" as const, suspended: false }),
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
      router.use(createExaminationsRouter(userController));
      router.use(clinicRouter);
    },
  });

  const userToken = (await signAccessToken({ subject: { userId: USER, sessionId: SESSION }, now: NOW, ttlSeconds: 900, signingKeys: KEYS })).token;
  const clinicToken = async (account: string) => (await signClinicAccessToken({ subject: { clinicAccountId: account, sessionId: SESSION }, now: NOW, ttlSeconds: 900, signingKeys: KEYS })).token;
  return { app, fx, docs, userToken, clinicTokenA: await clinicToken(ACCOUNT_A), clinicTokenB: await clinicToken(ACCOUNT_B) };
}

type Harness = Awaited<ReturnType<typeof buildHarness>>;
const API = "/api/v1";
const EXAMS = `${API}/families/${FAMILY}/members/${MEMBER}/examinations`;

async function requestExam(h: Harness): Promise<string> {
  const res = await request(h.app).post(EXAMS).set("Authorization", `Bearer ${h.userToken}`).send({ name: "x", examDate: "2026-02-01", slotId: SLOT, notes: "em jejum" });
  expect(res.status).toBe(201);
  return (res.body as { id: string }).id;
}

describe("separação de tokens (ADR-020)", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildHarness();
  });

  it("token da clínica -> rotas da clínica: 200", async () => {
    const res = await request(h.app).get(`${API}/clinic-portal/exam-agenda`).set("Authorization", `Bearer ${h.clinicTokenA}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("token de User rejeitado em /clinic-portal/* (401), em todas as rotas novas", async () => {
    const bearer = `Bearer ${h.userToken}`;
    const id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const calls = [
      request(h.app).get(`${API}/clinic-portal/exam-agenda`),
      request(h.app).put(`${API}/clinic-portal/exam-agenda/${id}/cancel`).send({ note: "x" }),
      request(h.app).put(`${API}/clinic-portal/exam-agenda/${id}/complete`).send({ results: [] }),
      request(h.app).post(`${API}/clinic-portal/exam-agenda/${id}/documents`).attach("file", PDF, "r.pdf"),
      request(h.app).delete(`${API}/clinic-portal/exam-agenda/${id}/documents/${id}`),
    ];
    for (const call of calls) {
      expect((await call.set("Authorization", bearer)).status).toBe(401);
    }
  });

  it("token da clínica rejeitado nas rotas de User (401) e sem token -> 401", async () => {
    expect((await request(h.app).get(EXAMS).set("Authorization", `Bearer ${h.clinicTokenA}`)).status).toBe(401);
    expect((await request(h.app).post(EXAMS).set("Authorization", `Bearer ${h.clinicTokenA}`).send({ name: "x", examDate: "2026-02-01", slotId: SLOT })).status).toBe(401);
    expect((await request(h.app).get(EXAMS)).status).toBe(401);
    expect((await request(h.app).get(`${API}/clinic-portal/exam-agenda`)).status).toBe(401);
  });
});

describe("fluxo completo conforme o contrato (UC-EXM-08, UC-CLN-09..10, ADR-023 revisto)", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildHarness();
  });

  it("família marca (nasce SCHEDULED) -> PDF + resultados -> paciente vê; campos novos de Examination", async () => {
    const user = `Bearer ${h.userToken}`;
    const clinicA = `Bearer ${h.clinicTokenA}`;
    const created = await request(h.app).post(EXAMS).set("Authorization", user).send({ name: "x", examDate: "2026-02-01", slotId: SLOT, notes: "em jejum" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      status: "SCHEDULED",
      name: "Ecografia",
      examDate: "2026-02-01",
      scheduledAt: SLOT_AT.toISOString(),
      slotId: SLOT,
      clinicId: CLINIC_A,
      clinicName: "Clínica Sol",
      issuedBy: "FAMILY",
      issuedByClinicAccountId: null,
      resultsIssuedAt: null,
      clinicResultNote: null,
      responseNote: null,
      results: [],
      documentIds: [],
    });
    const id = (created.body as { id: string }).id;

    // BR-CLN-03: só o mínimo; sem passo de confirmação — a agenda já mostra SCHEDULED.
    const agenda = await request(h.app).get(`${API}/clinic-portal/exam-agenda`).set("Authorization", clinicA);
    expect(agenda.body).toEqual([{ id, status: "SCHEDULED", scheduledAt: SLOT_AT.toISOString(), examType: "Ecografia", patientName: "Maria Silva", notes: "em jejum", responseNote: null, resultsCount: 0, documents: [], resultsIssuedAt: null, receiptId: null }]);
    // As rotas de pedidos foram retiradas (ADR-023 revisto): não existem.
    expect((await request(h.app).get(`${API}/clinic-portal/exam-requests`).set("Authorization", clinicA)).status).toBe(404);

    // PDF: só metadados de volta; infetado/não-PDF nunca entra.
    const notPdf = await request(h.app).post(`${API}/clinic-portal/exam-agenda/${id}/documents`).set("Authorization", clinicA).attach("file", Buffer.from([0xff, 0xd8, 0xff, 0xe0]), "foto.jpg");
    expect(notPdf.status).toBe(415);
    expect((notPdf.body as { code: string }).code).toBe("FILE_TYPE_NOT_ALLOWED");
    const uploaded = await request(h.app).post(`${API}/clinic-portal/exam-agenda/${id}/documents`).set("Authorization", clinicA).attach("file", PDF, "resultados.pdf");
    expect(uploaded.status).toBe(201);
    expect(Object.keys(uploaded.body as object).sort()).toEqual(["createdAt", "id", "originalName", "scanStatus", "sizeBytes"]);
    expect(uploaded.body).toMatchObject({ originalName: "resultados.pdf", scanStatus: "PENDING" });

    // O paciente ainda não vê o PDF (exame não COMPLETED).
    const before = await request(h.app).get(`${EXAMS}/${id}`).set("Authorization", user);
    expect((before.body as { documentIds: string[] }).documentIds).toEqual([]);

    const completed = await request(h.app)
      .put(`${API}/clinic-portal/exam-agenda/${id}/complete`)
      .set("Authorization", clinicA)
      .send({ results: [{ parameter: "Glicemia", valueNumeric: 250, unit: "mg/dL", referenceMin: 70, referenceMax: 100 }], resultNote: "ok" });
    expect(completed.status).toBe(200);
    expect(completed.body).toMatchObject({ status: "COMPLETED", resultsCount: 1 });
    expect(JSON.stringify(completed.body)).not.toContain("250");

    const after = await request(h.app).get(`${EXAMS}/${id}`).set("Authorization", user);
    expect(after.body).toMatchObject({ status: "COMPLETED", issuedBy: "CLINIC", issuedByClinicAccountId: ACCOUNT_A, clinicResultNote: "ok", resultsIssuedAt: NOW.toISOString() });
    const body = after.body as { results: { parameter: string }[]; documentIds: string[] };
    expect(body.results.map((r) => r.parameter)).toEqual(["Glicemia"]);
    expect(body.documentIds).toHaveLength(1);
  });

  it("isolamento: a clínica B não vê nem gere agenda/PDF da clínica A (404, sem enumerar)", async () => {
    const id = await requestExam(h);
    const clinicB = `Bearer ${h.clinicTokenB}`;
    expect((await request(h.app).put(`${API}/clinic-portal/exam-agenda/${id}/cancel`).set("Authorization", clinicB).send({ note: "x" })).status).toBe(404);
    expect((await request(h.app).put(`${API}/clinic-portal/exam-agenda/${id}/complete`).set("Authorization", clinicB).send({ results: [{ parameter: "p", valueText: "v" }] })).status).toBe(404);
    expect((await request(h.app).post(`${API}/clinic-portal/exam-agenda/${id}/documents`).set("Authorization", clinicB).attach("file", PDF, "r.pdf")).status).toBe(404);
    expect((await request(h.app).get(`${API}/clinic-portal/exam-agenda`).set("Authorization", clinicB)).body).toEqual([]);
  });

  it("validação OpenAPI: decisão inválida, cancelar sem note, >50 resultados, ficheiro em falta, UUID inválido -> 4xx", async () => {
    const id = await requestExam(h);
    const clinicA = `Bearer ${h.clinicTokenA}`;
    expect((await request(h.app).put(`${API}/clinic-portal/exam-agenda/${id}/cancel`).set("Authorization", clinicA).send({})).status).toBe(422);
    const many = Array.from({ length: 51 }, (_, i) => ({ parameter: `p${String(i)}`, valueNumeric: i }));
    expect((await request(h.app).put(`${API}/clinic-portal/exam-agenda/${id}/complete`).set("Authorization", clinicA).send({ results: many })).status).toBe(422);
    // Parâmetros de caminho/consulta malformados são rejeitados pelo validador (400), nunca chegam ao caso de uso.
    expect((await request(h.app).put(`${API}/clinic-portal/exam-agenda/nao-e-uuid/cancel`).set("Authorization", clinicA).send({ note: "x" })).status).toBe(400);
    expect((await request(h.app).get(`${API}/clinic-portal/exam-agenda?from=ontem`).set("Authorization", clinicA)).status).toBe(400);
    expect((await request(h.app).post(`${API}/clinic-portal/exam-agenda/${id}/documents`).set("Authorization", clinicA).field("outro", "x")).status).toBeGreaterThanOrEqual(400);
  });

  it("estados: completar um cancelado -> 409; cancelar sem motivo útil -> 422; mesmo membro no mesmo horário -> 409; horário de consulta -> 422; horário inexistente -> 409", async () => {
    const id = await requestExam(h);
    const clinicA = `Bearer ${h.clinicTokenA}`;
    const user = `Bearer ${h.userToken}`;
    expect((await request(h.app).put(`${API}/clinic-portal/exam-agenda/${id}/cancel`).set("Authorization", clinicA).send({ note: "   " })).status).toBe(422);
    // O horário tem 2 vagas, mas o mesmo membro não ocupa duas (BR-APT-11).
    expect((await request(h.app).post(EXAMS).set("Authorization", user).send({ name: "x", examDate: "2026-02-01", slotId: SLOT })).status).toBe(409);
    expect((await request(h.app).post(EXAMS).set("Authorization", user).send({ name: "x", examDate: "2026-02-01", slotId: APPT_SLOT })).status).toBe(422);
    expect((await request(h.app).post(EXAMS).set("Authorization", user).send({ name: "x", examDate: "2026-02-01", slotId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" })).status).toBe(409);
    expect((await request(h.app).put(`${API}/clinic-portal/exam-agenda/${id}/cancel`).set("Authorization", clinicA).send({ note: "avaria" })).status).toBe(200);
    expect((await request(h.app).put(`${API}/clinic-portal/exam-agenda/${id}/complete`).set("Authorization", clinicA).send({ results: [{ parameter: "p", valueText: "v" }] })).status).toBe(409);
  });
});
