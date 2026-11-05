// HTTP (supertest + express-openapi-validator contra docs/05-api/openapi.yaml, SEM base de dados).
// Fase 4a (ADR-021/ADR-023): conformidade OpenAPI de /admin/insurers* e /insurance-portal/auth|agents,
// cookie próprio, isolamento entre seguradoras e separação de tokens User/Clinic/Insurance.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { runWithActor } from "../../src/platform/actor/index.js";
import { FixedClock } from "../../src/platform/clock/index.js";
import { createApp } from "../../src/platform/http/index.js";
import { createLogger } from "../../src/platform/logger/index.js";
import { signAccessToken } from "../../src/modules/auth/domain/jwt.js";
import { createBearerAuthSecurityHandler } from "../../src/modules/auth/interface/middleware.js";
import { signClinicAccessToken } from "../../src/modules/clinics/domain/clinic-jwt.js";
import { createClinicBearerAuthSecurityHandler } from "../../src/modules/clinics/interface/clinic-portal-middleware.js";
import {
  createAdminCreateInsurerUseCase,
  createAdminInsurerRootAccountUseCase,
  createAdminListInsurersUseCase,
  createAdminSetInsurerStatusUseCase,
  createAdminUpdateInsurerUseCase,
} from "../../src/modules/insurance/application/admin-insurers.js";
import { createInsuranceFixtures, createInsuranceHolderFixtures } from "../../src/modules/insurance/application/fixtures.js";
import { createDecideInsuranceClaimUseCase, createGetInsuranceClaimUseCase, createListInsuranceClaimsUseCase } from "../../src/modules/insurance/application/portal-claims.js";
import { createInsuranceLoginUseCase } from "../../src/modules/insurance/application/insurance-login.js";
import { createInsuranceLogoutUseCase } from "../../src/modules/insurance/application/insurance-logout.js";
import { createInsuranceRefreshUseCase } from "../../src/modules/insurance/application/insurance-refresh.js";
import { createCreateInsuranceAgentUseCase, createListInsuranceAgentsUseCase, createRemoveInsuranceAgentUseCase } from "../../src/modules/insurance/application/manage-insurance-agents.js";
import { createResolveInsuranceActorStateUseCase } from "../../src/modules/insurance/application/resolve-insurance-actor-state.js";
import { hashInsurancePassword } from "../../src/modules/insurance/domain/insurance-crypto.js";
import { signInsuranceAccessToken } from "../../src/modules/insurance/domain/insurance-jwt.js";
import { createInsuranceAdminRouter } from "../../src/modules/insurance/interface/admin-router.js";
import { createInsuranceActorContextMiddleware, createInsuranceBearerAuthSecurityHandler } from "../../src/modules/insurance/interface/insurance-portal-middleware.js";
import { createInsurancePortalRouter } from "../../src/modules/insurance/interface/insurance-portal-router.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const NOW = new Date("2026-11-05T10:00:00.000Z");
const API = "/api/v1";
const KEYS = [{ kid: "k1", secret: new TextEncoder().encode("0123456789abcdef0123456789abcdef") }];
const ADMIN = "11111111-1111-4111-8111-111111111111";
const PLAIN = "22222222-2222-4222-8222-222222222222";
const INS_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const INS_B = "bbbbbbbb-0000-4000-8000-00000000000b";
const ADM_A = "a1a1a1a1-0000-4000-8000-0000000000a1";
const AGT_A = "a2a2a2a2-0000-4000-8000-0000000000a2";
const ADM_B = "b1b1b1b1-0000-4000-8000-0000000000b1";
const AGT_B = "b2b2b2b2-0000-4000-8000-0000000000b2";
const SESSION = "cccccccc-0000-4000-8000-0000000000cc";
const PASSWORD = "Correcto-Cavalo-7";

async function buildHarness() {
  const clock = new FixedClock(NOW);
  const fx = createInsuranceFixtures(clock);
  const claims = createInsuranceHolderFixtures(clock);
  fx.deps.insuranceSigningKeys.splice(0, 1, ...KEYS);
  const hash = await hashInsurancePassword(PASSWORD);
  for (const [id, name] of [[INS_A, "Seg A"], [INS_B, "Seg B"]] as const) fx.insurersRepo.seed({ id, name, taxId: `nif-${id}`, status: "ACTIVE", createdAt: NOW });
  const acc = (id: string, insurerId: string, role: "INSURANCE_ADMIN" | "INSURANCE_AGENT") => {
    fx.insuranceAccountRepo.seed({ id, insurerId, email: `${id}@seg.pt`, passwordHash: hash, role, status: "ACTIVE", createdAt: NOW });
  };
  acc(ADM_A, INS_A, "INSURANCE_ADMIN");
  acc(AGT_A, INS_A, "INSURANCE_AGENT");
  acc(ADM_B, INS_B, "INSURANCE_ADMIN");
  acc(AGT_B, INS_B, "INSURANCE_AGENT");

  const userActor: RequestHandler = (req, _res, next) => {
    if (!req.authSubject) {
      next();
      return;
    }
    runWithActor({ userId: req.authSubject.userId, platformAdmin: req.authSubject.userId === ADMIN }, () => {
      next();
    });
  };
  const insuranceActor = createInsuranceActorContextMiddleware({ resolveInsuranceActorState: createResolveInsuranceActorStateUseCase(fx.deps) });
  const app = createApp({
    openApiSpecPath: join(REPO_ROOT, "docs/05-api/openapi.yaml"),
    logger: createLogger({ level: "silent" }),
    securityHandlers: {
      bearerAuth: createBearerAuthSecurityHandler({ signingKeys: KEYS, clock }),
      clinicBearerAuth: createClinicBearerAuthSecurityHandler({ signingKeys: KEYS, clock }),
      insuranceBearerAuth: createInsuranceBearerAuthSecurityHandler({ signingKeys: KEYS, clock }),
    },
    actorContextMiddleware: (req: Request, res: Response, next: NextFunction) => {
      userActor(req, res, (err?: unknown) => {
        if (err) {
          next(err);
          return;
        }
        insuranceActor(req, res, next);
      });
    },
    registerHealthRoutes: (router) => {
      router.get("/health", (_req, res) => res.json({ status: "ok" }));
    },
    registerRoutes: (router) => {
      router.use(
        createInsuranceAdminRouter({
          adminListInsurers: createAdminListInsurersUseCase(fx.deps),
          adminCreateInsurer: createAdminCreateInsurerUseCase(fx.deps),
          adminUpdateInsurer: createAdminUpdateInsurerUseCase(fx.deps),
          adminSetInsurerStatus: createAdminSetInsurerStatusUseCase(fx.deps),
          adminCreateOrResetInsurerRootAccount: createAdminInsurerRootAccountUseCase(fx.deps),
        }),
      );
      router.use(
        createInsurancePortalRouter(
          {
            insuranceLogin: createInsuranceLoginUseCase(fx.deps),
            insuranceRefresh: createInsuranceRefreshUseCase(fx.deps),
            insuranceLogout: createInsuranceLogoutUseCase(fx.deps),
            listInsuranceAgents: createListInsuranceAgentsUseCase(fx.deps),
            createInsuranceAgent: createCreateInsuranceAgentUseCase(fx.deps),
            removeInsuranceAgent: createRemoveInsuranceAgentUseCase(fx.deps),
            // Pedidos (Fase 4b) testam-se em `insurance-claims.http.test.ts`; aqui só completam o controlador.
            listInsuranceClaims: createListInsuranceClaimsUseCase(claims.portalDeps),
            getInsuranceClaim: createGetInsuranceClaimUseCase(claims.portalDeps),
            decideInsuranceClaim: createDecideInsuranceClaimUseCase(claims.portalDeps),
          },
          "",
        ),
      );
      // Rotas-sentinela só para provar que o token de seguradora NÃO é aceite nos outros esquemas.
      router.get("/clinic-portal/staff", (_req, res) => res.json([]));
      router.get("/users/me", (_req, res) => res.json({}));
    },
  });
  const userToken = async (id: string) => `Bearer ${(await signAccessToken({ subject: { userId: id, sessionId: SESSION }, now: NOW, ttlSeconds: 900, signingKeys: KEYS })).token}`;
  const insToken = async (id: string, sessionId = SESSION) =>
    `Bearer ${(await signInsuranceAccessToken({ subject: { insuranceAccountId: id, sessionId }, now: NOW, ttlSeconds: 900, signingKeys: KEYS })).token}`;
  const clinicToken = `Bearer ${(await signClinicAccessToken({ subject: { clinicAccountId: ADM_A, sessionId: SESSION }, now: NOW, ttlSeconds: 900, signingKeys: KEYS })).token}`;
  return { app, fx, clock, admin: await userToken(ADMIN), plain: await userToken(PLAIN), clinicToken, userToken, insToken };
}
function setCookies(res: request.Response): string[] {
  return res.headers["set-cookie"] as unknown as string[];
}
type Harness = Awaited<ReturnType<typeof buildHarness>>;

describe("/admin/insurers*", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildHarness();
  });

  it("GET lista conforme o contrato (id, name, taxId, status)", async () => {
    const res = await request(h.app).get(`${API}/admin/insurers`).set("Authorization", h.admin);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: INS_A, name: "Seg A", taxId: `nif-${INS_A}`, status: "ACTIVE" },
      { id: INS_B, name: "Seg B", taxId: `nif-${INS_B}`, status: "ACTIVE" },
    ]);
  });

  it("POST cria (201) e audita; NIF duplicado -> 422 VALIDATION_ERROR; corpo fora do contrato -> 4xx", async () => {
    const res = await request(h.app).post(`${API}/admin/insurers`).set("Authorization", h.admin).send({ name: "Nova", taxId: "999" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: "Nova", taxId: "999", status: "ACTIVE" });
    expect(h.fx.audit.events.map((e) => e.action)).toEqual(["ADMIN_INSURER_CREATE"]);
    const dup = await request(h.app).post(`${API}/admin/insurers`).set("Authorization", h.admin).send({ name: "Outra", taxId: "999" });
    expect(dup.status).toBe(422);
    expect((dup.body as { code: string }).code).toBe("VALIDATION_ERROR");
    expect([400, 422]).toContain((await request(h.app).post(`${API}/admin/insurers`).set("Authorization", h.admin).send({ name: "x" })).status);
  });

  it("PATCH edita nome/NIF; 404 inexistente; id não-uuid -> 4xx", async () => {
    const res = await request(h.app).patch(`${API}/admin/insurers/${INS_A}`).set("Authorization", h.admin).send({ name: "Seg A+" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: INS_A, name: "Seg A+" });
    expect((await request(h.app).patch(`${API}/admin/insurers/${ADM_A}`).set("Authorization", h.admin).send({ name: "x" })).status).toBe(404);
    expect([400, 404, 422]).toContain((await request(h.app).patch(`${API}/admin/insurers/xx`).set("Authorization", h.admin).send({ name: "x" })).status);
  });

  it("PUT status SUSPENDED/ACTIVE; estado inválido -> 4xx; 404", async () => {
    const put = (id: string, status: string) => request(h.app).put(`${API}/admin/insurers/${id}/status`).set("Authorization", h.admin).send({ status });
    expect((await put(INS_A, "SUSPENDED")).body).toMatchObject({ id: INS_A, status: "SUSPENDED" });
    expect((await put(INS_A, "ACTIVE")).body).toMatchObject({ status: "ACTIVE" });
    expect([400, 422]).toContain((await put(INS_A, "ARCHIVED")).status);
    expect((await put(ADM_A, "ACTIVE")).status).toBe(404);
  });

  it("POST root-account: 200 com InsuranceAccount sem palavra-passe/hash; repor é idempotente; 404; e-mail inválido -> 4xx", async () => {
    const call = (id: string, email: string) => request(h.app).post(`${API}/admin/insurers/${id}/root-account`).set("Authorization", h.admin).send({ email });
    const first = await call(INS_A, "novo@seg.pt");
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ id: ADM_A, insurerId: INS_A, email: "novo@seg.pt", role: "INSURANCE_ADMIN", status: "ACTIVE" });
    expect(JSON.stringify(first.body)).not.toMatch(/password|hash/i);
    expect(h.fx.insuranceMailer.lastSentTo("novo@seg.pt")).toBeDefined();
    expect((await call(INS_A, "outro@seg.pt")).body).toMatchObject({ id: ADM_A, email: "outro@seg.pt" });
    expect((await call(ADM_A, "x@seg.pt")).status).toBe(404);
    expect([400, 422]).toContain((await call(INS_A, "nao-e-email")).status);
  });

  const routes: [string, string, object | undefined][] = [
    ["get", "/admin/insurers", undefined],
    ["post", "/admin/insurers", { name: "N", taxId: "1" }],
    ["patch", `/admin/insurers/${INS_A}`, { name: "N" }],
    ["put", `/admin/insurers/${INS_A}/status`, { status: "SUSPENDED" }],
    ["post", `/admin/insurers/${INS_A}/root-account`, { email: "a@b.pt" }],
  ];
  it.each(routes)("%s %s: sem token 401; utilizador normal 403; token de seguradora/clínica 401; nada auditado", async (method, path, body) => {
    const call = (auth?: string) => {
      const r = request(h.app)[method as "get" | "post" | "patch" | "put"](`${API}${path}`);
      if (auth) void r.set("Authorization", auth);
      return r.send(body);
    };
    expect((await call()).status).toBe(401);
    expect((await call(h.plain)).status).toBe(403);
    expect((await call(await h.insToken(ADM_A))).status).toBe(401);
    expect((await call(h.clinicToken)).status).toBe(401);
    expect(h.fx.audit.events).toHaveLength(0);
  });
});

describe("/insurance-portal/auth/*", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildHarness();
  });
  const login = (h2: Harness, id: string, password = PASSWORD) => request(h2.app).post(`${API}/insurance-portal/auth/login`).send({ email: `${id}@seg.pt`, password });

  it("login: 200 {accessToken, expiresIn, insurerId, role} + cookie insurance_refresh_token HttpOnly/SameSite=Strict/Path próprio", async () => {
    const res = await login(h, AGT_A);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ accessToken: expect.any(String) as string, expiresIn: 900, insurerId: INS_A, role: "INSURANCE_AGENT" });
    const cookie = setCookies(res).find((c) => c.startsWith("insurance_refresh_token="));
    expect(cookie).toBeDefined();
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toContain("Path=/api/v1/insurance-portal/auth");
    expect(setCookies(res).some((c) => c.startsWith("refresh_token=") || c.startsWith("clinic_refresh_token="))).toBe(false);
  });

  it("login: credenciais inválidas 401; suspensa 403 ACCOUNT_SUSPENDED; corpo inválido 4xx", async () => {
    const bad = await login(h, AGT_A, "errada");
    expect(bad.status).toBe(401);
    expect((bad.body as { code: string }).code).toBe("AUTH_INVALID_CREDENTIALS");
    h.fx.insurersRepo.setStatus(INS_B, "SUSPENDED");
    const suspended = await login(h, ADM_B);
    expect(suspended.status).toBe(403);
    expect((suspended.body as { code: string }).code).toBe("ACCOUNT_SUSPENDED");
    expect([400, 422]).toContain((await request(h.app).post(`${API}/insurance-portal/auth/login`).send({ email: "x" })).status);
  });

  it("refresh via cookie roda o token (novo cookie); sem cookie 401; token reutilizado 401", async () => {
    const first = await login(h, ADM_A);
    const cookie = setCookies(first).find((c) => c.startsWith("insurance_refresh_token="))?.split(";")[0] ?? "";
    const res = await request(h.app).post(`${API}/insurance-portal/auth/refresh`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ insurerId: INS_A, role: "INSURANCE_ADMIN" });
    expect(setCookies(res).some((c) => c.startsWith("insurance_refresh_token=") && !c.startsWith(cookie))).toBe(true);
    expect((await request(h.app).post(`${API}/insurance-portal/auth/refresh`)).status).toBe(401);
    expect((await request(h.app).post(`${API}/insurance-portal/auth/refresh`).set("Cookie", cookie)).status).toBe(401);
  });

  it("cookies de User/clínica não servem de refresh da seguradora", async () => {
    const res = await request(h.app).post(`${API}/insurance-portal/auth/refresh`).set("Cookie", "refresh_token=abc; clinic_refresh_token=abc");
    expect(res.status).toBe(401);
  });

  it("logout 204 com o access token da seguradora, limpa o cookie e revoga a sessão; sem token 401", async () => {
    const first = await login(h, ADM_A);
    const sessionId = h.fx.insuranceSessionRepo.firstId();
    const token = `Bearer ${(first.body as { accessToken: string }).accessToken}`;
    expect((await request(h.app).post(`${API}/insurance-portal/auth/logout`)).status).toBe(401);
    const res = await request(h.app).post(`${API}/insurance-portal/auth/logout`).set("Authorization", token);
    expect(res.status).toBe(204);
    expect(setCookies(res).some((c) => c.startsWith("insurance_refresh_token=;"))).toBe(true);
    expect(h.fx.insuranceSessionRepo.sessions.get(sessionId)?.revokedAt).toEqual(NOW);
  });
});

describe("/insurance-portal/agents*", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildHarness();
  });
  const base = `${API}/insurance-portal/agents`;

  it("INSURANCE_ADMIN: lista só agentes da própria seguradora (InsuranceAccount, sem hash)", async () => {
    const res = await request(h.app).get(base).set("Authorization", await h.insToken(ADM_A));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: AGT_A, insurerId: INS_A, email: `${AGT_A}@seg.pt`, role: "INSURANCE_AGENT", status: "ACTIVE" }]);
  });

  it("INSURANCE_ADMIN: cria agente (201), valida e-mail (4xx), duplicado 422", async () => {
    const auth = await h.insToken(ADM_A);
    const res = await request(h.app).post(base).set("Authorization", auth).send({ email: "novo@seg.pt" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ insurerId: INS_A, email: "novo@seg.pt", role: "INSURANCE_AGENT", status: "ACTIVE" });
    expect(JSON.stringify(res.body)).not.toMatch(/password|hash/i);
    expect(h.fx.insuranceMailer.lastSentTo("novo@seg.pt")).toBeDefined();
    expect((await request(h.app).post(base).set("Authorization", auth).send({ email: "novo@seg.pt" })).status).toBe(422);
    expect([400, 422]).toContain((await request(h.app).post(base).set("Authorization", auth).send({ email: "x" })).status);
  });

  it("INSURANCE_ADMIN remove agente próprio (204); outra seguradora, admin ou inexistente -> 404", async () => {
    const auth = await h.insToken(ADM_A);
    for (const target of [AGT_B, ADM_B, ADM_A, INS_A]) {
      expect((await request(h.app).delete(`${base}/${target}`).set("Authorization", auth)).status).toBe(404);
    }
    expect(h.fx.insuranceAccountRepo.byId.has(AGT_B)).toBe(true);
    expect((await request(h.app).delete(`${base}/${AGT_A}`).set("Authorization", auth)).status).toBe(204);
    expect(h.fx.insuranceAccountRepo.byId.has(AGT_A)).toBe(false);
  });

  it("INSURANCE_AGENT -> 403 em listar/criar/remover", async () => {
    const auth = await h.insToken(AGT_A);
    expect((await request(h.app).get(base).set("Authorization", auth)).status).toBe(403);
    expect((await request(h.app).post(base).set("Authorization", auth).send({ email: "x@seg.pt" })).status).toBe(403);
    expect((await request(h.app).delete(`${base}/${AGT_A}`).set("Authorization", auth)).status).toBe(403);
    expect(h.fx.audit.events).toHaveLength(0);
  });

  it("sem token 401; token de User/clínica 401; conta ou seguradora suspensa 403; conta apagada 401", async () => {
    expect((await request(h.app).get(base)).status).toBe(401);
    expect((await request(h.app).get(base).set("Authorization", h.admin)).status).toBe(401);
    expect((await request(h.app).get(base).set("Authorization", h.clinicToken)).status).toBe(401);
    const auth = await h.insToken(ADM_A);
    h.fx.insurersRepo.setStatus(INS_A, "SUSPENDED");
    const suspended = await request(h.app).get(base).set("Authorization", auth);
    expect(suspended.status).toBe(403);
    expect((suspended.body as { code: string }).code).toBe("ACCOUNT_SUSPENDED");
    const ghost = await request(h.app).get(base).set("Authorization", await h.insToken("dddddddd-0000-4000-8000-0000000000dd"));
    expect(ghost.status).toBe(401);
  });

  it("token de seguradora é rejeitado nos esquemas de User e de clínica (claims distintas)", async () => {
    const auth = await h.insToken(ADM_A);
    expect((await request(h.app).get(`${API}/clinic-portal/staff`).set("Authorization", auth)).status).toBe(401);
    expect((await request(h.app).get(`${API}/users/me`).set("Authorization", auth)).status).toBe(401);
  });
});
