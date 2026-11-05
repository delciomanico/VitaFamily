// HTTP (supertest + express-openapi-validator contra docs/05-api/openapi.yaml, SEM base de dados: os
// casos de uso reais correm sobre os fakes das fixtures). Cobre a Fase 2 (ADR-023, BR-CLN-09, AC-REC-01):
// conformidade OpenAPI de `/clinic-portal/recommendations` e `/families/{f}/members/{m}/recommendations`,
// separação de tokens (ADR-020), isolamento entre clínicas e imutabilidade (sem PUT/PATCH/DELETE).
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
import { createCreateClinicRecommendationUseCase, createListClinicRecommendationsUseCase } from "../../src/modules/recommendations/application/clinic-recommendations.js";
import { createRecommendationsFixtures } from "../../src/modules/recommendations/application/fixtures.js";
import { createListRecommendationsUseCase } from "../../src/modules/recommendations/application/list-recommendations.js";
import { createRecommendationsClinicPortalRouter } from "../../src/modules/recommendations/interface/clinic-portal-router.js";
import { createRecommendationsRouter } from "../../src/modules/recommendations/interface/router.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const OPENAPI_SPEC_PATH = join(REPO_ROOT, "docs/05-api/openapi.yaml");
const NOW = new Date("2026-01-15T10:00:00.000Z");
const FAMILY = "11111111-1111-4111-8111-111111111111";
const MEMBER = "22222222-2222-4222-8222-222222222222";
const CLINIC_A = "33333333-3333-4333-8333-333333333333";
const CLINIC_B = "44444444-4444-4444-8444-444444444444";
const ACCOUNT_A = "55555555-5555-4555-8555-555555555555";
const ACCOUNT_B = "66666666-6666-4666-8666-666666666666";
const USER = "77777777-7777-4777-8777-777777777777";
const SESSION = "88888888-8888-4888-8888-888888888888";
const APPT = "99999999-9999-4999-8999-999999999999";
const APPT_CANCELLED = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EXAM = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const KEYS = [{ kid: "k1", secret: new TextEncoder().encode("0123456789abcdef0123456789abcdef") }];
const API = "/api/v1";
const FAMILY_URL = `${API}/families/${FAMILY}/members/${MEMBER}/recommendations`;
const CLINIC_URL = `${API}/clinic-portal/recommendations`;

async function buildHarness() {
  const clock = new FixedClock(NOW);
  const fx = createRecommendationsFixtures(clock);
  fx.memberNames.names.set(`${FAMILY}:${MEMBER}`, "Maria Silva");
  fx.origins.seedAppointment(APPT, CLINIC_A, { familyId: FAMILY, memberId: MEMBER, status: "SCHEDULED", clinicName: "Clínica Sol" });
  fx.origins.seedAppointment(APPT_CANCELLED, CLINIC_A, { familyId: FAMILY, memberId: MEMBER, status: "CANCELLED", clinicName: "Clínica Sol" });
  fx.origins.seedExamination(EXAM, CLINIC_A, { familyId: FAMILY, memberId: MEMBER, status: "COMPLETED", clinicName: "Clínica Sol" });

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
      router.use(createRecommendationsRouter({ listRecommendations: createListRecommendationsUseCase(fx.deps) }));
      router.use(
        createRecommendationsClinicPortalRouter({
          createClinicRecommendation: createCreateClinicRecommendationUseCase(fx.deps),
          listClinicRecommendations: createListClinicRecommendationsUseCase(fx.deps),
        }),
      );
    },
  });

  const userToken = (await signAccessToken({ subject: { userId: USER, sessionId: SESSION }, now: NOW, ttlSeconds: 900, signingKeys: KEYS })).token;
  const clinicToken = async (account: string) => (await signClinicAccessToken({ subject: { clinicAccountId: account, sessionId: SESSION }, now: NOW, ttlSeconds: 900, signingKeys: KEYS })).token;
  return { app, fx, userToken, clinicTokenA: await clinicToken(ACCOUNT_A), clinicTokenB: await clinicToken(ACCOUNT_B) };
}

type Harness = Awaited<ReturnType<typeof buildHarness>>;

describe("POST /clinic-portal/recommendations (UC-REC-01, AC-REC-01)", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildHarness();
  });

  it("201 conforme o contrato: consulta e exame; nunca devolve dados além do mínimo (BR-CLN-03)", async () => {
    const clinicA = `Bearer ${h.clinicTokenA}`;
    const onAppointment = await request(h.app).post(CLINIC_URL).set("Authorization", clinicA).send({ appointmentId: APPT, text: "Repouso 3 dias" });
    expect(onAppointment.status).toBe(201);
    expect(onAppointment.body).toEqual({ id: expect.any(String) as string, appointmentId: APPT, examinationId: null, patientName: "Maria Silva", text: "Repouso 3 dias", createdAt: NOW.toISOString() });

    const onExam = await request(h.app).post(CLINIC_URL).set("Authorization", clinicA).send({ examinationId: EXAM, appointmentId: null, text: "Repetir em 6 meses" });
    expect(onExam.status).toBe(201);
    expect(onExam.body).toMatchObject({ appointmentId: null, examinationId: EXAM });

    // Auditoria sem o texto; alerta genérico por cada recomendação.
    expect(h.fx.audit.events.map((e) => e.action)).toEqual(["RECOMMENDATION_CREATE", "RECOMMENDATION_CREATE"]);
    expect(JSON.stringify(h.fx.audit.events)).not.toContain("Repouso");
    expect(h.fx.alerts.events).toHaveLength(2);
  });

  it.each([
    ["sem origem", { text: "x" }],
    ["origem dupla", { appointmentId: APPT, examinationId: EXAM, text: "x" }],
    ["texto vazio", { appointmentId: APPT, text: "" }],
    ["texto com 2001 caracteres", { appointmentId: APPT, text: "a".repeat(2001) }],
    ["sem texto", { appointmentId: APPT }],
  ])("%s -> 422 VALIDATION_ERROR", async (_name, body) => {
    const res = await request(h.app).post(CLINIC_URL).set("Authorization", `Bearer ${h.clinicTokenA}`).send(body);
    expect(res.status).toBe(422);
    expect((res.body as { code: string }).code).toBe("VALIDATION_ERROR");
    expect(h.fx.repo.byId.size).toBe(0);
  });

  it("origem de outra clínica ou inexistente -> 404; origem CANCELLED -> 409", async () => {
    const send = (token: string, body: object) => request(h.app).post(CLINIC_URL).set("Authorization", `Bearer ${token}`).send(body);
    expect((await send(h.clinicTokenB, { appointmentId: APPT, text: "x" })).status).toBe(404);
    expect((await send(h.clinicTokenB, { examinationId: EXAM, text: "x" })).status).toBe(404);
    expect((await send(h.clinicTokenA, { appointmentId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", text: "x" })).status).toBe(404);
    const conflict = await send(h.clinicTokenA, { appointmentId: APPT_CANCELLED, text: "x" });
    expect(conflict.status).toBe(409);
    expect((conflict.body as { code: string }).code).toBe("CONFLICT");
    expect(h.fx.repo.byId.size).toBe(0);
  });

  it("imutável: não existem PUT/PATCH/DELETE (nem em /recommendations nem em /recommendations/{id})", async () => {
    const clinicA = `Bearer ${h.clinicTokenA}`;
    const created = await request(h.app).post(CLINIC_URL).set("Authorization", clinicA).send({ appointmentId: APPT, text: "x" });
    const id = (created.body as { id: string }).id;
    for (const method of ["put", "patch", "delete"] as const) {
      expect((await request(h.app)[method](`${CLINIC_URL}/${id}`).set("Authorization", clinicA).send({ text: "y" })).status).toBeGreaterThanOrEqual(400);
      expect((await request(h.app)[method](CLINIC_URL).set("Authorization", clinicA).send({ text: "y" })).status).toBeGreaterThanOrEqual(400);
    }
    expect(h.fx.repo.byId.get(id)?.text).toBe("x");
  });
});

describe("GET /clinic-portal/recommendations (UC-REC-02)", () => {
  it("isolamento entre clínicas e filtros por consulta/exame", async () => {
    const h = await buildHarness();
    const clinicA = `Bearer ${h.clinicTokenA}`;
    const clinicB = `Bearer ${h.clinicTokenB}`;
    await request(h.app).post(CLINIC_URL).set("Authorization", clinicA).send({ appointmentId: APPT, text: "consulta" });
    await request(h.app).post(CLINIC_URL).set("Authorization", clinicA).send({ examinationId: EXAM, text: "exame" });

    const all = await request(h.app).get(CLINIC_URL).set("Authorization", clinicA);
    expect(all.status).toBe(200);
    expect((all.body as { text: string }[]).map((r) => r.text).sort()).toEqual(["consulta", "exame"]);
    expect(((await request(h.app).get(`${CLINIC_URL}?examinationId=${EXAM}`).set("Authorization", clinicA)).body as { text: string }[]).map((r) => r.text)).toEqual(["exame"]);
    expect((await request(h.app).get(CLINIC_URL).set("Authorization", clinicB)).body).toEqual([]);
    expect((await request(h.app).get(`${CLINIC_URL}?appointmentId=nao-e-uuid`).set("Authorization", clinicA)).status).toBe(400);
  });
});

describe("GET /families/{f}/members/{m}/recommendations (UC-REC-03)", () => {
  it("devolve { items, nextCursor } conforme o contrato, com clinicName; paginação por cursor", async () => {
    const h = await buildHarness();
    const clinicA = `Bearer ${h.clinicTokenA}`;
    await request(h.app).post(CLINIC_URL).set("Authorization", clinicA).send({ appointmentId: APPT, text: "consulta" });
    h.fx.audit.events.length = 0;

    const res = await request(h.app).get(FAMILY_URL).set("Authorization", `Bearer ${h.userToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [{ id: expect.any(String) as string, memberId: MEMBER, appointmentId: APPT, examinationId: null, clinicName: "Clínica Sol", text: "consulta", createdAt: NOW.toISOString() }], nextCursor: null });
    // Titular a ler as suas: sem auditoria; leitura por tutor/outro é auditada (testado nos casos de uso).
    expect(h.fx.audit.events).toHaveLength(0);

    expect((await request(h.app).get(`${FAMILY_URL}?limit=0`).set("Authorization", `Bearer ${h.userToken}`)).status).toBe(422);
    expect((await request(h.app).get(`${FAMILY_URL}?examinationId=nao-e-uuid`).set("Authorization", `Bearer ${h.userToken}`)).status).toBe(400);
  });

  it("não há rota para a família escrever (POST/PUT/DELETE)", async () => {
    const h = await buildHarness();
    const user = `Bearer ${h.userToken}`;
    expect((await request(h.app).post(FAMILY_URL).set("Authorization", user).send({ text: "x" })).status).toBeGreaterThanOrEqual(400);
    expect((await request(h.app).delete(FAMILY_URL).set("Authorization", user)).status).toBeGreaterThanOrEqual(400);
  });
});

describe("separação de tokens (ADR-020)", () => {
  it("token de User rejeitado em /clinic-portal/recommendations e vice-versa; sem token -> 401", async () => {
    const h = await buildHarness();
    const user = `Bearer ${h.userToken}`;
    const clinic = `Bearer ${h.clinicTokenA}`;
    expect((await request(h.app).get(CLINIC_URL).set("Authorization", user)).status).toBe(401);
    expect((await request(h.app).post(CLINIC_URL).set("Authorization", user).send({ appointmentId: APPT, text: "x" })).status).toBe(401);
    expect((await request(h.app).get(FAMILY_URL).set("Authorization", clinic)).status).toBe(401);
    expect((await request(h.app).get(FAMILY_URL)).status).toBe(401);
    expect((await request(h.app).get(CLINIC_URL)).status).toBe(401);
  });
});
