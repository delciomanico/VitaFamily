// HTTP (supertest + express-openapi-validator contra docs/05-api/openapi.yaml, SEM base de dados: os casos de uso reais
// correm sobre os fakes das fixtures; as RESPOSTAS são também validadas contra o contrato). Cobre o marco B fatia 1
// (ADR-032): TC-PRC-15/16/17/18/19/22/24 e TC-AZ-PRC-02/03/04/05.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RequestHandler } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { FixedClock } from "../../src/platform/clock/index.js";
import { runWithActor } from "../../src/platform/actor/index.js";
import { DomainError } from "../../src/platform/errors/index.js";
import { createApp } from "../../src/platform/http/index.js";
import { openApiSpecPath } from "../support/openapi-spec.js";
import { createLogger } from "../../src/platform/logger/index.js";
import { signAccessToken } from "../../src/modules/auth/domain/jwt.js";
import { createBearerAuthSecurityHandler } from "../../src/modules/auth/interface/middleware.js";
import { signClinicAccessToken } from "../../src/modules/clinics/domain/clinic-jwt.js";
import { createClinicActorContextMiddleware, createClinicBearerAuthSecurityHandler } from "../../src/modules/clinics/interface/clinic-portal-middleware.js";
import { createGetClinicProcessUseCase } from "../../src/modules/processes/application/get-clinic-process.js";
import { createGetProcessUseCase } from "../../src/modules/processes/application/get-process.js";
import { createListProcessesUseCase } from "../../src/modules/processes/application/list-processes.js";
import { createProcessesFixtures } from "../../src/modules/processes/application/fixtures.js";
import { createProcessesClinicPortalRouter } from "../../src/modules/processes/interface/clinic-portal-router.js";
import { createProcessesRouter } from "../../src/modules/processes/interface/router.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const OPENAPI_SPEC_PATH = openApiSpecPath(REPO_ROOT);
const NOW = new Date("2026-06-01T12:00:00.000Z");
const FAMILY = "11111111-1111-4111-8111-111111111111";
const MEMBER = "22222222-2222-4222-8222-222222222222";
const CLINIC_A = "33333333-3333-4333-8333-333333333333";
const CLINIC_B = "44444444-4444-4444-8444-444444444444";
const ACCOUNT_ADMIN_A = "55555555-5555-4555-8555-555555555555";
const ACCOUNT_MANAGER_B = "66666666-6666-4666-8666-666666666666";
const ACCOUNT_DOCTOR_A = "99999999-9999-4999-8999-999999999999";
const USER = "77777777-7777-4777-8777-777777777777";
const SESSION = "88888888-8888-4888-8888-888888888888";
const P_APPT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const P_EXAM = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const P_NO_CLINIC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ACT_APPT = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const ACT_EXAM = "b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1";
const KEYS = [{ kid: "k1", secret: new TextEncoder().encode("0123456789abcdef0123456789abcdef") }];
const API = "/api/v1";
const FAMILY_URL = `${API}/families/${FAMILY}/members/${MEMBER}/processes`;
const CLINIC_URL = `${API}/clinic-portal/processes`;

async function buildHarness() {
  const clock = new FixedClock(NOW);
  const fx = createProcessesFixtures(clock);
  fx.addProcess({ id: P_APPT, familyId: FAMILY, memberId: MEMBER, originType: "APPOINTMENT", originId: ACT_APPT, clinicId: CLINIC_A, openedAt: new Date("2026-05-01T10:00:00Z"), phase: "NO_SHOW" });
  fx.addProcess({ id: P_EXAM, familyId: FAMILY, memberId: MEMBER, originType: "EXAMINATION", originId: ACT_EXAM, clinicId: CLINIC_A, openedAt: new Date("2026-05-02T10:00:00Z"), phase: "DONE" });
  fx.addProcess({ id: P_NO_CLINIC, familyId: FAMILY, memberId: MEMBER, originType: "APPOINTMENT", originId: "d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1", openedAt: new Date("2026-04-01T10:00:00Z"), phase: "SCHEDULED" });

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
        clinicId: clinicAccountId === ACCOUNT_MANAGER_B ? CLINIC_B : CLINIC_A,
        role: clinicAccountId === ACCOUNT_ADMIN_A ? ("CLINIC_ADMIN" as const) : clinicAccountId === ACCOUNT_DOCTOR_A ? ("CLINIC_DOCTOR" as const) : ("CLINIC_MANAGER" as const),
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
    validateResponses: true,
    securityHandlers: {
      bearerAuth: createBearerAuthSecurityHandler({ signingKeys: KEYS, clock }),
      clinicBearerAuth: createClinicBearerAuthSecurityHandler({ signingKeys: KEYS, clock }),
    },
    actorContextMiddleware,
    registerHealthRoutes: (router) => {
      router.get("/health", (_req, res) => res.json({ status: "ok" }));
    },
    registerRoutes: (router) => {
      router.use(createProcessesRouter({ listProcesses: createListProcessesUseCase(fx.deps), getProcess: createGetProcessUseCase(fx.deps) }));
      router.use(createProcessesClinicPortalRouter({ getClinicProcess: createGetClinicProcessUseCase(fx.deps) }));
    },
  });

  const userToken = (await signAccessToken({ subject: { userId: USER, sessionId: SESSION }, now: NOW, ttlSeconds: 900, signingKeys: KEYS })).token;
  const clinicToken = async (account: string) => (await signClinicAccessToken({ subject: { clinicAccountId: account, sessionId: SESSION }, now: NOW, ttlSeconds: 900, signingKeys: KEYS })).token;
  return {
    app,
    fx,
    userToken,
    adminA: await clinicToken(ACCOUNT_ADMIN_A),
    managerB: await clinicToken(ACCOUNT_MANAGER_B),
    doctorA: await clinicToken(ACCOUNT_DOCTOR_A),
  };
}

type Harness = Awaited<ReturnType<typeof buildHarness>>;
const bearer = (token: string) => `Bearer ${token}`;

describe("GET /families/{f}/members/{m}/processes (UC-PRC-03)", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildHarness();
  });

  it("TC-PRC-15/19: 200 conforme o contrato, openedAt desc, nextCursor sempre presente; TC-PRC-16 só valores do contrato", async () => {
    const res = await request(h.app).get(FAMILY_URL).set("Authorization", bearer(h.userToken));
    expect(res.status).toBe(200);
    const body = res.body as { items: { id: string; familyStatus: string; nextStep: { code: string; actor: string }; origin: { type: string }; scheduledAt: string | null }[]; nextCursor: string | null };
    expect(body.nextCursor).toBeNull();
    expect(body.items.map((i) => i.id)).toEqual([P_EXAM, P_APPT, P_NO_CLINIC]);
    expect(body.items[0]).toMatchObject({ familyStatus: "DONE", nextStep: { code: "NOTHING_PENDING", actor: "NONE" }, origin: { type: "EXAMINATION" } });
    expect(body.items[1]).toMatchObject({ familyStatus: "CANCELLED", nextStep: { code: "RESCHEDULE", actor: "FAMILY" } });
    expect(JSON.stringify(res.body)).not.toMatch(/NO_SHOW|ARRIVED|REQUESTED|clinicId|clinicName|notes/);
  });

  it("TC-PRC-15: filtros status e originType; limit 1 + cursor; limit 0/101 e enums inválidos => 400 (ver divergência); cursor inválido => 400 MALFORMED_REQUEST", async () => {
    const auth = bearer(h.userToken);
    const done = await request(h.app).get(`${FAMILY_URL}?status=DONE`).set("Authorization", auth);
    expect((done.body as { items: { id: string }[] }).items.map((i) => i.id)).toEqual([P_EXAM]);
    const exams = await request(h.app).get(`${FAMILY_URL}?originType=EXAMINATION`).set("Authorization", auth);
    expect((exams.body as { items: { id: string }[] }).items.map((i) => i.id)).toEqual([P_EXAM]);

    const first = await request(h.app).get(`${FAMILY_URL}?limit=1`).set("Authorization", auth);
    const firstBody = first.body as { items: { id: string }[]; nextCursor: string };
    expect(firstBody.items.map((i) => i.id)).toEqual([P_EXAM]);
    const second = await request(h.app).get(`${FAMILY_URL}?limit=1&cursor=${firstBody.nextCursor}`).set("Authorization", auth);
    expect((second.body as { items: { id: string }[] }).items.map((i) => i.id)).toEqual([P_APPT]);

    // DIVERGÊNCIA docs↔plataforma (reportada): o contrato diz 422 VALIDATION_ERROR para limit/status/originType inválidos, mas o
    // validador OpenAPI da plataforma traduz qualquer parâmetro de query inválido para 400 MALFORMED_REQUEST (error-middleware.ts).
    // O 422 mantém-se no caso de uso (testado em application/processes.test.ts).
    for (const query of ["limit=0", "limit=101", "status=OUTRO", "originType=OUTRO"]) {
      const invalid = await request(h.app).get(`${FAMILY_URL}?${query}`).set("Authorization", auth);
      expect(invalid.status, query).toBe(400);
      expect((invalid.body as { code: string }).code).toBe("MALFORMED_REQUEST");
    }
    const malformed = await request(h.app).get(`${FAMILY_URL}?cursor=%25%25%25`).set("Authorization", auth);
    expect(malformed.status).toBe(400);
    expect((malformed.body as { code: string }).code).toBe("MALFORMED_REQUEST");
  });

  it("TC-PRC-22: membro BLOCKED => 423 MEMBER_BLOCKED em lista e detalhe", async () => {
    h.fx.policy.denyWith = new DomainError("MEMBER_BLOCKED");
    for (const url of [FAMILY_URL, `${FAMILY_URL}/${P_APPT}`]) {
      const res = await request(h.app).get(url).set("Authorization", bearer(h.userToken));
      expect(res.status).toBe(423);
      expect((res.body as { code: string }).code).toBe("MEMBER_BLOCKED");
    }
  });

  it("TC-AZ-PRC-01: dependente sem EXAMS vê só consultas (200 filtrado); sem nenhuma categoria => 200 []", async () => {
    h.fx.policy.deniedCategories.add("EXAMS");
    expect(((await request(h.app).get(FAMILY_URL).set("Authorization", bearer(h.userToken))).body as { items: { id: string }[] }).items.map((i) => i.id)).toEqual([P_APPT, P_NO_CLINIC]);
    h.fx.policy.deniedCategories.add("APPOINTMENTS");
    const none = await request(h.app).get(FAMILY_URL).set("Authorization", bearer(h.userToken));
    expect(none.status).toBe(200);
    expect(none.body).toEqual({ items: [], nextCursor: null });
  });

  it("TC-PRC-17: sem rotas de escrita (POST/PUT/PATCH/DELETE) em lista nem detalhe", async () => {
    const auth = bearer(h.userToken);
    for (const url of [FAMILY_URL, `${FAMILY_URL}/${P_APPT}`]) {
      for (const method of ["post", "put", "patch", "delete"] as const) {
        const res = await request(h.app)[method](url).set("Authorization", auth).send({ processId: P_APPT, familyStatus: "DONE" });
        expect(res.status, `${method} ${url}`).toBeGreaterThanOrEqual(400);
      }
    }
    expect(h.fx.repo.rows).toHaveLength(3);
  });

  it("sem token => 401", async () => {
    expect((await request(h.app).get(FAMILY_URL)).status).toBe(401);
  });
});

describe("GET /families/{f}/members/{m}/processes/{processId} (UC-PRC-04)", () => {
  it("TC-PRC-16/19: 200 com os campos do contrato; scheduledAt do facto do ato", async () => {
    const h = await buildHarness();
    h.fx.facts.seed("APPOINTMENT", ACT_APPT, { phase: "SCHEDULED", scheduledAt: new Date("2026-07-01T09:00:00Z") });
    const res = await request(h.app).get(`${FAMILY_URL}/${P_APPT}`).set("Authorization", bearer(h.userToken));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: P_APPT,
      memberId: MEMBER,
      kind: "ROUTINE",
      familyStatus: "SCHEDULED",
      nextStep: { code: "ATTEND", actor: "FAMILY" },
      coverage: null,
      origin: { type: "APPOINTMENT", id: ACT_APPT },
      scheduledAt: "2026-07-01T09:00:00.000Z",
      openedAt: "2026-05-01T10:00:00.000Z",
    });
  });

  // TC-PRC-30/31 (fatia 5, ADR-036): `coverage` e `nextStep` contra o contrato REAL (sem VITA_OPENAPI_SPEC); respostas validadas.
  it.each<[string, "WITHDRAWN" | "EXPIRED", string]>([["revertido", "WITHDRAWN", "COVERAGE_WITHDRAWN"], ["expirado", "EXPIRED", "COVERAGE_EXPIRED"]])("TC-PRC-30 processo sem ato, aprovação %s ⇒ CANCELLED / %s / FAMILY", async (_name, phase, code) => {
    const h = await buildHarness();
    const id = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02";
    h.fx.addProcess({ id, familyId: FAMILY, memberId: MEMBER, originType: "AUTHORIZATION", originId: "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1", openedAt: NOW });
    h.fx.facts.seedCoverage(id, { phase, validUntil: new Date("2026-06-20T10:00:00Z") });
    const res = await request(h.app).get(`${FAMILY_URL}/${id}`).set("Authorization", bearer(h.userToken));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ familyStatus: "CANCELLED", nextStep: { code, actor: "FAMILY" }, coverage: { state: phase, appeal: false, partial: false, dueAt: null, validUntil: phase === "EXPIRED" ? "2026-06-20T10:00:00.000Z" : null } });
  });

  it("TC-PRC-30 com ato: coverage traz o estado e o nextStep mantém a linha do ato; nova análise (appeal) e em parte; TC-PRC-31 não vaza campos internos", async () => {
    const h = await buildHarness();
    h.fx.facts.seed("APPOINTMENT", ACT_APPT, { phase: "SCHEDULED" });
    h.fx.facts.seedCoverage(P_APPT, { phase: "APPROVED", validUntil: new Date("2026-06-20T10:00:00Z"), partial: true, appeal: true });
    const res = await request(h.app).get(`${FAMILY_URL}/${P_APPT}`).set("Authorization", bearer(h.userToken));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ nextStep: { code: "ATTEND", actor: "FAMILY" }, coverage: { state: "APPROVED", appeal: true, partial: true, dueAt: null, validUntil: "2026-06-20T10:00:00.000Z" } });
    expect(Object.keys((res.body as { coverage: object }).coverage).sort()).toEqual(["appeal", "dueAt", "partial", "state", "validUntil"]);
    expect(JSON.stringify(res.body)).not.toMatch(/decisionNote|internalNote|overrideReason|authorizedAmount|requestedAmount|serviceId|justification|decidedBy|autoApproval|assignedTo|escalatedAt/);
  });

  it("TC-PRC-30 em lista: coverage PENDING com dueAt; sem MANAGE_INSURANCE ⇒ coverage null e 200", async () => {
    const h = await buildHarness();
    h.fx.facts.seed("APPOINTMENT", ACT_APPT, { phase: "PENDING" });
    h.fx.facts.seedCoverage(P_APPT, { phase: "PENDING_DECISION", dueAt: new Date("2026-06-03T10:00:00Z") });
    const found = async () => ((await request(h.app).get(`${FAMILY_URL}?originType=APPOINTMENT`).set("Authorization", bearer(h.userToken))).body as { items: { id: string; coverage: object | null; nextStep: { code: string } }[] }).items.find((i) => i.id === P_APPT);
    expect(await found()).toMatchObject({ coverage: { state: "PENDING", dueAt: "2026-06-03T10:00:00.000Z" }, nextStep: { code: "AWAIT_INSURER_DECISION" } });
    h.fx.policy.deniedActions.add("MANAGE_INSURANCE");
    expect(await found()).toMatchObject({ coverage: null, nextStep: { code: "AWAIT_CLINIC_RESPONSE" } });
  });

  it("TC-AZ-PRC-02: inexistente, de outro membro e de categoria não legível => 404 com corpo igual", async () => {
    const h = await buildHarness();
    h.fx.policy.deniedCategories.add("EXAMS");
    const auth = bearer(h.userToken);
    const otherMember = `${API}/families/${FAMILY}/members/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee/processes/${P_APPT}`;
    const responses = await Promise.all([`${FAMILY_URL}/dddddddd-dddd-4ddd-8ddd-dddddddddddd`, otherMember, `${FAMILY_URL}/${P_EXAM}`].map((url) => request(h.app).get(url).set("Authorization", auth)));
    for (const res of responses) expect(res.status).toBe(404);
    expect(new Set(responses.map((r) => JSON.stringify({ ...(r.body as object), instance: undefined, requestId: undefined, traceId: undefined }))).size).toBe(1);
  });

  it("TC-PRC-23: processo sem ato legível => 404 (nunca 5xx)", async () => {
    const h = await buildHarness();
    h.fx.addProcess({ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01", familyId: FAMILY, memberId: MEMBER, openedAt: NOW, phase: null });
    const res = await request(h.app).get(`${FAMILY_URL}/eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01`).set("Authorization", bearer(h.userToken));
    expect(res.status).toBe(404);
  });
});

describe("GET /clinic-portal/processes/{processId} (UC-PRC-05, BR-PRC-06)", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildHarness();
  });

  it("TC-PRC-18: Admin lê só o mínimo (teste de chaves: sem memberId/familyId/familyStatus/nextStep)", async () => {
    const res = await request(h.app).get(`${CLINIC_URL}/${P_APPT}`).set("Authorization", bearer(h.adminA));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: P_APPT, kind: "ROUTINE", origin: { type: "APPOINTMENT", id: ACT_APPT }, phase: "NO_SHOW", openedAt: "2026-05-01T10:00:00.000Z" });
    expect(Object.keys(res.body as object).sort()).toEqual(["id", "kind", "openedAt", "origin", "phase"]);
  });

  it("TC-AZ-PRC-03: outra clínica, sem clínica e inexistente => 404 idêntico", async () => {
    const other = await request(h.app).get(`${CLINIC_URL}/${P_APPT}`).set("Authorization", bearer(h.managerB));
    const none = await request(h.app).get(`${CLINIC_URL}/${P_NO_CLINIC}`).set("Authorization", bearer(h.adminA));
    const missing = await request(h.app).get(`${CLINIC_URL}/dddddddd-dddd-4ddd-8ddd-dddddddddddd`).set("Authorization", bearer(h.adminA));
    for (const res of [other, none, missing]) expect(res.status).toBe(404);
    const normalise = (body: unknown) => JSON.stringify({ ...(body as object), instance: undefined, requestId: undefined, traceId: undefined });
    expect(new Set([other, none, missing].map((r) => normalise(r.body))).size).toBe(1);
  });

  it("TC-AZ-PRC-04: Médico => 403 FORBIDDEN", async () => {
    const res = await request(h.app).get(`${CLINIC_URL}/${P_APPT}`).set("Authorization", bearer(h.doctorA));
    expect(res.status).toBe(403);
    expect((res.body as { code: string }).code).toBe("FORBIDDEN");
  });

  it("TC-AZ-PRC-05: token de utilizador na rota da clínica e token de clínica na rota da família => 401", async () => {
    expect((await request(h.app).get(`${CLINIC_URL}/${P_APPT}`).set("Authorization", bearer(h.userToken))).status).toBe(401);
    expect((await request(h.app).get(FAMILY_URL).set("Authorization", bearer(h.adminA))).status).toBe(401);
  });
});
