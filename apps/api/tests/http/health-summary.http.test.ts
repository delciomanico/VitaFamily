// HTTP (supertest + express-openapi-validator contra docs/05-api/openapi.yaml, SEM base de dados; as RESPOSTAS também são
// validadas contra o contrato). M17: TC-RPT-05/08/09/12, AC-RPT-04/07/09, matriz de autorização/IDOR e canário de logs.
import { Writable } from "node:stream";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RequestHandler } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { signAccessToken } from "../../src/modules/auth/domain/jwt.js";
import { createBearerAuthSecurityHandler } from "../../src/modules/auth/interface/middleware.js";
import { createSummaryFixtures, type SummaryFixtureOptions } from "../../src/modules/reports/application/fixtures.js";
import { createFamilyHealthSummaryUseCase, createMemberHealthSummaryUseCase } from "../../src/modules/reports/application/health-summary.js";
import { createFamilyReportUseCase } from "../../src/modules/reports/application/family-report.js";
import { createMemberReportUseCase } from "../../src/modules/reports/application/member-report.js";
import { createReportsRouter } from "../../src/modules/reports/interface/router.js";
import { runWithActor } from "../../src/platform/actor/index.js";
import { FixedClock } from "../../src/platform/clock/index.js";
import { NotFoundError } from "../../src/platform/errors/index.js";
import { createApp } from "../../src/platform/http/index.js";
import { createLogger } from "../../src/platform/logger/index.js";
import { openApiSpecPath } from "../support/openapi-spec.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const NOW = new Date("2026-10-12T10:00:00.000Z");
const FAMILY = "11111111-1111-4111-8111-111111111111";
const OTHER_FAMILY = "99999999-9999-4999-8999-999999999999";
const SELF = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const HIDDEN = "44444444-4444-4444-8444-444444444444";
const USER = "77777777-7777-4777-8777-777777777777";
const SESSION = "88888888-8888-4888-8888-888888888888";
const KEYS = [{ kid: "k1", secret: new TextEncoder().encode("0123456789abcdef0123456789abcdef") }];
const CANARY = "ZXQ-CANARIO-SAUDE";
// Campos que o contrato devolve de propósito (nome do medicamento e do parâmetro) — só se exige que não vão para os logs.
const NAME_CANARY = "ZXQ-NOME-CLINICO";
const API = "/api/v1";
const bearer = (token: string) => `Bearer ${token}`;

const members = [
  { id: SELF, familyId: FAMILY, name: "Eu", birthDate: "1990-01-01", isMinor: false, isDependent: false, hasAccount: true, status: "ACTIVE", isSelf: true, guardianIds: [] },
  { id: OTHER, familyId: FAMILY, name: "Outro", birthDate: "1991-01-01", isMinor: false, isDependent: false, hasAccount: true, status: "ACTIVE", isSelf: false, guardianIds: [] },
  { id: HIDDEN, familyId: FAMILY, name: "Escondido", birthDate: "1992-01-01", isMinor: false, isDependent: false, hasAccount: true, status: "ACTIVE", isSelf: false, guardianIds: [] },
];
const data = {
  [SELF]: { bloodType: "A_POS" },
  [OTHER]: {
    adherence: [{ planId: SELF, medicationName: NAME_CANARY, taken: 6, notTaken: 2, unconfirmed: 2, pending: 4 }],
    plans: [], doses: [], prescriptions: [],
    appointments: [{ id: OTHER, scheduledAt: "2026-10-01T09:00:00Z", status: "COMPLETED", notes: CANARY }],
    examinations: [{ id: OTHER, examDate: "2026-10-02", status: "COMPLETED", name: CANARY, documentIds: [], results: [{ parameter: NAME_CANARY, valueNumeric: 5, unit: "g", referenceMin: 1, referenceMax: 2, createdAt: "2026-10-02T10:00:00Z" }] }],
    alerts: { total: 2, unread: 1, byType: { EXAM_REMINDER: 2 } },
  },
  [HIDDEN]: { appointments: [], examinations: [] },
};

async function buildHarness(overrides: Partial<SummaryFixtureOptions> = {}) {
  const clock = new FixedClock(NOW);
  const fx = createSummaryFixtures({ now: NOW, members, data, denied: { [HIDDEN]: ["ALLERGIES", "MEDICATION", "APPOINTMENTS", "EXAMS"], [OTHER]: ["ALLERGIES"] }, ...overrides });
  const original = fx.deps.sources.listMembers;
  // IDOR: a leitura real devolve NOT_FOUND para famílias a que o utilizador não pertence.
  fx.deps.sources.listMembers = (userId, familyId) => (familyId === FAMILY ? original(userId, familyId) : Promise.reject(new NotFoundError()));
  const logs: string[] = [];
  const destination = new Writable({ write: (chunk: Buffer, _enc, cb) => { logs.push(chunk.toString()); cb(); } });
  const actorContextMiddleware: RequestHandler = (req, _res, next) => {
    if (!req.authSubject) {
      next();
      return;
    }
    runWithActor({ userId: req.authSubject.userId, platformAdmin: false }, () => {
      next();
    });
  };
  const app = createApp({
    openApiSpecPath: openApiSpecPath(REPO_ROOT),
    logger: createLogger({ level: "debug", destination }),
    validateResponses: true,
    securityHandlers: { bearerAuth: createBearerAuthSecurityHandler({ signingKeys: KEYS, clock }) },
    actorContextMiddleware,
    registerHealthRoutes: (router) => {
      router.get("/health", (_req, res) => res.json({ status: "ok" }));
    },
    registerRoutes: (router) => {
      router.use(
        createReportsRouter({
          memberReport: createMemberReportUseCase(fx.deps),
          familyReport: createFamilyReportUseCase(fx.deps),
          memberHealthSummary: createMemberHealthSummaryUseCase(fx.deps),
          familyHealthSummary: createFamilyHealthSummaryUseCase(fx.deps),
        }),
      );
    },
  });
  const token = (await signAccessToken({ subject: { userId: USER, sessionId: SESSION }, now: NOW, ttlSeconds: 900, signingKeys: KEYS })).token;
  return { app, fx, token, logs };
}
type Harness = Awaited<ReturnType<typeof buildHarness>>;

describe("GET /families/{f}/members/{m}/health-summary (UC-RPT-05)", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildHarness();
  });
  const url = (member: string, query = "", family = FAMILY) => `${API}/families/${family}/members/${member}/health-summary${query}`;

  it("401 sem sessão", async () => {
    expect((await request(h.app).get(url(SELF))).status).toBe(401);
  });

  it("AC-RPT-04/TC-RPT-05: 200 conforme o contrato, 12 meses por omissão, resposta privada e sem guardar nada", async () => {
    const res = await request(h.app).get(url(SELF)).set("Authorization", bearer(h.token));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ memberId: SELF, period: { from: "2025-10-12", to: "2026-10-12" } });
    expect(res.headers["cache-control"]).toBe("private, no-store");
  });

  it("AC-RPT-07/TC-RPT-09: OTHER só com partilha parcial — secções sem permissão omitidas; audita REPORT_VIEW", async () => {
    const res = await request(h.app).get(url(OTHER, "?from=2026-10-01&to=2026-10-12")).set("Authorization", bearer(h.token));
    expect(res.status).toBe(200);
    const body = res.body as Record<string, { overall?: { adherencePct: number } }>;
    expect(body.medication?.overall?.adherencePct).toBe(60);
    expect(Object.keys(body)).toEqual(expect.arrayContaining(["medication", "exams", "appointments", "alerts", "missing"]));
    expect(h.fx.audit).toEqual([{ familyId: FAMILY, memberId: OTHER, kind: "HEALTH_SUMMARY" }]);
  });

  it("AC-RPT-09/TC-RPT-12: ver o próprio não audita; membro sem nenhuma categoria => 404 sem auditar", async () => {
    await request(h.app).get(url(SELF)).set("Authorization", bearer(h.token));
    expect(h.fx.audit).toEqual([]);
    const hidden = await request(h.app).get(url(HIDDEN)).set("Authorization", bearer(h.token));
    expect(hidden.status).toBe(404);
    expect(h.fx.audit).toEqual([]);
  });

  it("IDOR: família de outrem ou membro inexistente => 404 igual (sem revelar existência)", async () => {
    const foreignFamily = await request(h.app).get(url(OTHER, "", OTHER_FAMILY)).set("Authorization", bearer(h.token));
    const ghost = await request(h.app).get(url("55555555-5555-4555-8555-555555555555")).set("Authorization", bearer(h.token));
    const hidden = await request(h.app).get(url(HIDDEN)).set("Authorization", bearer(h.token));
    for (const res of [foreignFamily, ghost, hidden]) {
      expect(res.status).toBe(404);
      expect((res.body as { code: string }).code).toBe("NOT_FOUND");
    }
    expect((foreignFamily.body as { title: string }).title).toBe((hidden.body as { title: string }).title);
  });

  it.each(["?from=2026-02-01&to=2026-01-01", "?from=2020-01-01&to=2026-01-01"])("TC-RPT-05: %s => 422 VALIDATION_ERROR", async (query) => {
    const res = await request(h.app).get(url(SELF, query)).set("Authorization", bearer(h.token));
    expect(res.status).toBe(422);
    expect((res.body as { code: string }).code).toBe("VALIDATION_ERROR");
  });

  it("data mal formada => erro 4xx do contrato", async () => {
    const res = await request(h.app).get(url(SELF, "?from=ontem")).set("Authorization", bearer(h.token));
    expect([400, 422]).toContain(res.status);
  });

  it("TC-RPT-12: não existe endpoint de PDF nem de ligação partilhável", async () => {
    for (const path of [`${url(SELF)}/pdf`, `${url(SELF)}/share`, `${API}/families/${FAMILY}/health-summary/pdf`]) {
      const res = await request(h.app).get(path).set("Authorization", bearer(h.token));
      expect(res.status).toBe(404);
    }
    expect([400, 404, 405]).toContain((await request(h.app).post(url(SELF)).set("Authorization", bearer(h.token))).status);
  });

  it("TC-RPT-12: o 31.º pedido no minuto => 429 RATE_LIMITED", async () => {
    const limited = await buildHarness();
    for (let i = 0; i < 30; i++) {
      expect((await request(limited.app).get(url(SELF)).set("Authorization", bearer(limited.token))).status).toBe(200);
    }
    const res = await request(limited.app).get(url(SELF)).set("Authorization", bearer(limited.token));
    expect(res.status).toBe(429);
    expect((res.body as { code: string }).code).toBe("RATE_LIMITED");
  });

  it("TC-RPT-08: nenhum valor assinalado fora da referência", async () => {
    const res = await request(h.app).get(url(OTHER, "?from=2026-10-01&to=2026-10-12")).set("Authorization", bearer(h.token));
    const series = (res.body as { exams: { series: Record<string, unknown>[] } }).exams.series;
    expect(series).toHaveLength(1);
    expect(Object.keys(series[0] as object).sort()).toEqual(["count", "first", "last", "max", "min", "parameter", "points", "referenceMax", "referenceMin", "truncated", "unit", "variationAbs", "variationPct"]);
    expect(JSON.stringify(res.body)).not.toMatch(/outOfRange|abnormal|flag/i);
  });

  it("TC-RPT-12 (canário): nem nomes nem notas de saúde chegam aos logs nem ao corpo de erro", async () => {
    await request(h.app).get(url(OTHER)).set("Authorization", bearer(h.token));
    await request(h.app).get(url(HIDDEN)).set("Authorization", bearer(h.token));
    await request(h.app).get(url(SELF, "?from=2020-01-01&to=2026-01-01")).set("Authorization", bearer(h.token));
    const res = await request(h.app).get(url(OTHER)).set("Authorization", bearer(h.token));
    expect(JSON.stringify(res.body)).not.toContain(CANARY);
    expect(h.logs.join("")).not.toContain(CANARY);
    expect(h.logs.join("")).not.toContain(NAME_CANARY);
  });
});

describe("GET /families/{f}/health-summary (UC-RPT-05b)", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildHarness();
  });
  const url = (query = "", family = FAMILY) => `${API}/families/${family}/health-summary${query}`;

  it("200 conforme o contrato; só membros visíveis; REPORT_VIEW por outro titular visível", async () => {
    const res = await request(h.app).get(url()).set("Authorization", bearer(h.token));
    expect(res.status).toBe(200);
    const body = res.body as { members: { memberId: string }[]; period: { from: string } };
    expect(body.members.map((m) => m.memberId)).toEqual([SELF, OTHER]);
    expect(body.period.from).toBe("2025-10-12");
    expect(JSON.stringify(res.body)).not.toContain(HIDDEN);
    expect(h.fx.audit).toEqual([{ familyId: FAMILY, memberId: OTHER, kind: "HEALTH_SUMMARY" }]);
    expect(res.headers["cache-control"]).toBe("private, no-store");
  });

  it("401, 404 (família alheia), 422 e 429", async () => {
    expect((await request(h.app).get(url())).status).toBe(401);
    expect((await request(h.app).get(url("", OTHER_FAMILY)).set("Authorization", bearer(h.token))).status).toBe(404);
    expect((await request(h.app).get(url("?from=2026-02-01&to=2026-01-01")).set("Authorization", bearer(h.token))).status).toBe(422);
    const limited = await buildHarness();
    for (let i = 0; i < 30; i++) {
      await request(limited.app).get(url()).set("Authorization", bearer(limited.token));
    }
    expect((await request(limited.app).get(url()).set("Authorization", bearer(limited.token))).status).toBe(429);
  });

  it("canário: nomes/notas de saúde não vão para logs nem para o corpo", async () => {
    const res = await request(h.app).get(url()).set("Authorization", bearer(h.token));
    expect(JSON.stringify(res.body)).not.toContain(CANARY);
    expect(h.logs.join("")).not.toContain(CANARY);
  });
});
