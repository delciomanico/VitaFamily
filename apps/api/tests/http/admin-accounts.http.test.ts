// HTTP (supertest + express-openapi-validator contra docs/05-api/openapi.yaml, SEM base de dados).
// Fase 3 (ADR-023, BR-ADM-01..04/07): conformidade OpenAPI das rotas /admin/users* e
// /admin/clinics/{id}/accounts*, só PLATFORM_ADMIN e separação de tokens (clínica rejeitada).
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RequestHandler } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { runWithActor } from "../../src/platform/actor/index.js";
import { FixedClock } from "../../src/platform/clock/index.js";
import { createApp } from "../../src/platform/http/index.js";
import { createLogger } from "../../src/platform/logger/index.js";
import type { AuditEvent } from "../../src/modules/audit/index.js";
import {
  createAdminGetUserUseCase,
  createAdminListUsersUseCase,
  createAdminReactivateUserUseCase,
  createAdminResetUserAccessUseCase,
  createAdminSuspendUserUseCase,
  type AdminAccountsDeps,
} from "../../src/modules/admin/application/accounts.js";
import { createAdminRouter } from "../../src/modules/admin/interface/router.js";
import { signAccessToken } from "../../src/modules/auth/domain/jwt.js";
import { createBearerAuthSecurityHandler } from "../../src/modules/auth/interface/middleware.js";
import {
  createAdminListClinicAccountsUseCase,
  createAdminReactivateClinicAccountUseCase,
  createAdminSuspendClinicAccountUseCase,
} from "../../src/modules/clinics/application/admin-clinic-accounts.js";
import { createClinicsFixtures } from "../../src/modules/clinics/application/fixtures.js";
import { signClinicAccessToken } from "../../src/modules/clinics/domain/clinic-jwt.js";
import { createClinicBearerAuthSecurityHandler } from "../../src/modules/clinics/interface/clinic-portal-middleware.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const NOW = new Date("2026-01-15T10:00:00.000Z");
const ADMIN = "11111111-1111-4111-8111-111111111111";
const PLAIN_USER = "22222222-2222-4222-8222-222222222222";
const TARGET = "33333333-3333-4333-8333-333333333333";
const PENDING = "44444444-4444-4444-8444-444444444444";
const CLINIC_A = "55555555-5555-4555-8555-555555555555";
const CLINIC_B = "66666666-6666-4666-8666-666666666666";
const ACC_ADMIN_A = "77777777-7777-4777-8777-777777777777";
const ACC_MGR_A = "88888888-8888-4888-8888-888888888888";
const ACC_ADMIN_B = "99999999-9999-4999-8999-999999999999";
const SESSION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const KEYS = [{ kid: "k1", secret: new TextEncoder().encode("0123456789abcdef0123456789abcdef") }];
const API = "/api/v1";

type Status = "PENDING_VERIFICATION" | "ACTIVE" | "SUSPENDED";

async function buildHarness() {
  const clock = new FixedClock(NOW);
  const fx = createClinicsFixtures(clock);
  for (const id of [CLINIC_A, CLINIC_B]) await fx.clinicsRepo.insert({}, { id, type: "PARTNER", name: id, createdAt: NOW });
  const acc = (id: string, clinicId: string, role: "CLINIC_ADMIN" | "CLINIC_MANAGER") => {
    fx.clinicAccountRepo.seed({ id, clinicId, email: `${id}@clinica.pt`, passwordHash: "secret-hash", role, status: "ACTIVE", createdAt: NOW });
  };
  acc(ACC_ADMIN_A, CLINIC_A, "CLINIC_ADMIN");
  acc(ACC_MGR_A, CLINIC_A, "CLINIC_MANAGER");
  acc(ACC_ADMIN_B, CLINIC_B, "CLINIC_ADMIN");
  fx.clinicAccountRepo.lastLogins.set(ACC_ADMIN_A, new Date("2026-01-14T09:00:00.000Z"));

  const users = new Map<string, { id: string; email: string; name: string; status: Status; createdAt: Date; platformRole: "NONE" | "PLATFORM_ADMIN"; birthDate: string; passwordHash: string }>();
  const addUser = (id: string, email: string, name: string, status: Status = "ACTIVE", platformRole: "NONE" | "PLATFORM_ADMIN" = "NONE") =>
    users.set(id, { id, email, name, status, createdAt: NOW, platformRole, birthDate: "1990-01-01", passwordHash: "secret-hash" });
  addUser(ADMIN, "admin@vita.pt", "Admin", "ACTIVE", "PLATFORM_ADMIN");
  addUser(TARGET, "ana@x.pt", "Ana Silva");
  addUser(PENDING, "novo@x.pt", "Novo", "PENDING_VERIFICATION");

  const events: AuditEvent[] = [];
  const resets: string[] = [];
  const deps: AdminAccountsDeps<null> = {
    clock,
    withTransaction: (fn) => fn(null),
    audit: {
      record: (_t, e) => {
        events.push(e);
        return Promise.resolve();
      },
    },
    auth: {
      resetUserAccess: (_t, id) => {
        resets.push(id);
        return Promise.resolve(users.get(id)?.status === "PENDING_VERIFICATION" ? "EMAIL_VERIFICATION" : "PASSWORD_RESET");
      },
      getSessionStats: () => Promise.resolve({ activeCount: 2, lastUsedAt: NOW }),
    },
    families: { countFamiliesOfUser: () => Promise.resolve(1) },
    users: {
      byId: (_t, id) => Promise.resolve(users.get(id) ?? null),
      listAccounts: (_t, f) =>
        Promise.resolve({
          items: [...users.values()].filter((u) => (!f.status || u.status === f.status) && (!f.q || u.email.includes(f.q) || u.name.toLowerCase().includes(f.q))),
          nextCursor: null,
        }),
      setSuspension: (_t, id, s) => {
        const u = users.get(id);
        if (u) u.status = s ? "SUSPENDED" : "ACTIVE";
        return Promise.resolve(u);
      },
    },
  };

  const actorMiddleware: RequestHandler = (req, _res, next) => {
    if (!req.authSubject) {
      next();
      return;
    }
    runWithActor({ userId: req.authSubject.userId, platformAdmin: req.authSubject.userId === ADMIN }, () => {
      next();
    });
  };
  const app = createApp({
    openApiSpecPath: join(REPO_ROOT, "docs/05-api/openapi.yaml"),
    logger: createLogger({ level: "silent" }),
    securityHandlers: {
      bearerAuth: createBearerAuthSecurityHandler({ signingKeys: KEYS, clock }),
      clinicBearerAuth: createClinicBearerAuthSecurityHandler({ signingKeys: KEYS, clock }),
    },
    actorContextMiddleware: actorMiddleware,
    registerHealthRoutes: (router) => {
      router.get("/health", (_req, res) => res.json({ status: "ok" }));
    },
    registerRoutes: (router) => {
      router.use(
        createAdminRouter({
          adminListUsers: createAdminListUsersUseCase(deps),
          adminGetUser: createAdminGetUserUseCase(deps),
          adminSuspendUser: createAdminSuspendUserUseCase(deps),
          adminReactivateUser: createAdminReactivateUserUseCase(deps),
          adminResetUserAccess: createAdminResetUserAccessUseCase(deps),
          adminListClinicAccounts: createAdminListClinicAccountsUseCase(fx.deps),
          adminSuspendClinicAccount: createAdminSuspendClinicAccountUseCase(fx.deps),
          adminReactivateClinicAccount: createAdminReactivateClinicAccountUseCase(fx.deps),
        }),
      );
    },
  });
  const userToken = async (id: string) => `Bearer ${(await signAccessToken({ subject: { userId: id, sessionId: SESSION }, now: NOW, ttlSeconds: 900, signingKeys: KEYS })).token}`;
  const clinicToken = `Bearer ${(await signClinicAccessToken({ subject: { clinicAccountId: ACC_ADMIN_A, sessionId: SESSION }, now: NOW, ttlSeconds: 900, signingKeys: KEYS })).token}`;
  return { app, fx, events, resets, admin: await userToken(ADMIN), plain: await userToken(PLAIN_USER), clinicToken };
}
type Harness = Awaited<ReturnType<typeof buildHarness>>;

describe("GET /admin/users e /admin/users/{id} (BR-ADM-01)", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildHarness();
  });

  it("pesquisa por q devolve name e nunca campos sensíveis", async () => {
    const res = await request(h.app).get(`${API}/admin/users?q=ana`).set("Authorization", h.admin);
    expect(res.status).toBe(200);
    expect((res.body as { items: unknown[] }).items).toEqual([{ id: TARGET, email: "ana@x.pt", name: "Ana Silva", status: "ACTIVE", createdAt: NOW.toISOString() }]);
  });

  it("q com 1 caractere -> 4xx de validação (minLength 2)", async () => {
    const res = await request(h.app).get(`${API}/admin/users?q=a`).set("Authorization", h.admin);
    expect([400, 422]).toContain(res.status);
  });

  it("detalhe operacional conforme o contrato, sem hash nem data de nascimento", async () => {
    const res = await request(h.app).get(`${API}/admin/users/${TARGET}`).set("Authorization", h.admin);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: TARGET, email: "ana@x.pt", name: "Ana Silva", status: "ACTIVE", platformRole: "NONE", emailVerifiedAt: null,
      createdAt: NOW.toISOString(), suspendedAt: null, suspensionReason: null, familiesCount: 1, activeSessionsCount: 2, lastSessionUsedAt: NOW.toISOString(),
    });
    expect(JSON.stringify(res.body)).not.toMatch(/secret-hash|birthDate|passwordHash/);
  });

  it("inexistente -> 404 NOT_FOUND; não uuid -> 4xx", async () => {
    const res = await request(h.app).get(`${API}/admin/users/${CLINIC_A}`).set("Authorization", h.admin);
    expect(res.status).toBe(404);
    expect((res.body as { code: string }).code).toBe("NOT_FOUND");
    expect([400, 404, 422]).toContain((await request(h.app).get(`${API}/admin/users/xx`).set("Authorization", h.admin)).status);
  });
});

describe("POST /admin/users/{id}/reset-access (BR-ADM-02)", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildHarness();
  });

  it("204 sem corpo, audita ADMIN_USER_RESET_ACCESS sem token/PII", async () => {
    const res = await request(h.app).post(`${API}/admin/users/${TARGET}/reset-access`).set("Authorization", h.admin);
    expect(res.status).toBe(204);
    expect(res.text).toBe("");
    expect(h.resets).toEqual([TARGET]);
    expect(h.events).toHaveLength(1);
    expect(h.events[0]).toMatchObject({ action: "ADMIN_USER_RESET_ACCESS", actorType: "PLATFORM_ADMIN", resourceId: TARGET, metadata: { kind: "PASSWORD_RESET" } });
    expect(JSON.stringify(h.events)).not.toContain("ana@x.pt");
  });

  it("conta por verificar -> kind EMAIL_VERIFICATION", async () => {
    await request(h.app).post(`${API}/admin/users/${PENDING}/reset-access`).set("Authorization", h.admin).expect(204);
    expect(h.events[0]?.metadata).toEqual({ kind: "EMAIL_VERIFICATION" });
  });

  it("sobre si próprio -> 403; inexistente -> 404", async () => {
    expect((await request(h.app).post(`${API}/admin/users/${ADMIN}/reset-access`).set("Authorization", h.admin)).status).toBe(403);
    expect((await request(h.app).post(`${API}/admin/users/${CLINIC_A}/reset-access`).set("Authorization", h.admin)).status).toBe(404);
    expect(h.resets).toEqual([]);
  });
});

describe("/admin/clinics/{clinicId}/accounts* (BR-ADM-03/04)", () => {
  let h: Harness;
  const base = `${API}/admin/clinics/${CLINIC_A}/accounts`;
  beforeEach(async () => {
    h = await buildHarness();
  });

  it("lista conforme o contrato, com lastLoginAt e sem palavra-passe", async () => {
    const res = await request(h.app).get(base).set("Authorization", h.admin);
    expect(res.status).toBe(200);
    const body = res.body as { id: string; lastLoginAt: string | null }[];
    expect(body.map((a) => a.id).sort()).toEqual([ACC_ADMIN_A, ACC_MGR_A].sort());
    expect(body.find((a) => a.id === ACC_ADMIN_A)).toEqual({
      id: ACC_ADMIN_A, clinicId: CLINIC_A, email: `${ACC_ADMIN_A}@clinica.pt`, role: "CLINIC_ADMIN", status: "ACTIVE",
      createdAt: NOW.toISOString(), lastLoginAt: "2026-01-14T09:00:00.000Z", suspendedAt: null,
    });
    expect(JSON.stringify(res.body)).not.toContain("secret-hash");
  });

  it("suspender: 204, motivo obrigatório (422), revoga sessões e audita; reativar: 204", async () => {
    await fx(h).clinicSessionRepo.insert({}, { id: "s1", clinicAccountId: ACC_MGR_A, refreshTokenHash: "x", tokenChainId: "c", expiresAt: new Date("2027-01-01"), createdAt: NOW });
    const noReason = await request(h.app).post(`${base}/${ACC_MGR_A}/suspend`).set("Authorization", h.admin).send({ reason: "  " });
    expect(noReason.status).toBe(422);
    expect((await request(h.app).post(`${base}/${ACC_MGR_A}/suspend`).set("Authorization", h.admin).send({})).status).toBeGreaterThanOrEqual(400);

    await request(h.app).post(`${base}/${ACC_MGR_A}/suspend`).set("Authorization", h.admin).send({ reason: "Abuso" }).expect(204);
    expect(fx(h).clinicSessionRepo.sessions.get("s1")?.revokedAt).toEqual(NOW);
    const list = await request(h.app).get(base).set("Authorization", h.admin);
    expect((list.body as { id: string; status: string; suspendedAt: string }[]).find((a) => a.id === ACC_MGR_A)).toMatchObject({ status: "SUSPENDED", suspendedAt: NOW.toISOString() });

    await request(h.app).post(`${base}/${ACC_MGR_A}/reactivate`).set("Authorization", h.admin).expect(204);
    expect(fx(h).audit.events.map((e) => e.action)).toEqual(["ADMIN_CLINIC_ACCOUNT_SUSPEND", "ADMIN_CLINIC_ACCOUNT_REACTIVATE"]);
    expect(JSON.stringify(fx(h).audit.events)).not.toContain("Abuso");
  });

  it("reativar CLINIC_ADMIN com outro ativo -> 409 CONFLICT", async () => {
    await request(h.app).post(`${base}/${ACC_ADMIN_A}/suspend`).set("Authorization", h.admin).send({ reason: "x" }).expect(204);
    fx(h).clinicAccountRepo.seed({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", clinicId: CLINIC_A, email: "novo@clinica.pt", passwordHash: "h", role: "CLINIC_ADMIN", status: "ACTIVE", createdAt: NOW });
    const res = await request(h.app).post(`${base}/${ACC_ADMIN_A}/reactivate`).set("Authorization", h.admin);
    expect(res.status).toBe(409);
    expect((res.body as { code: string }).code).toBe("CONFLICT");
  });

  it("conta de outra clínica ou clínica inexistente -> 404 (sem enumeração)", async () => {
    expect((await request(h.app).post(`${base}/${ACC_ADMIN_B}/suspend`).set("Authorization", h.admin).send({ reason: "x" })).status).toBe(404);
    expect((await request(h.app).post(`${base}/${ACC_ADMIN_B}/reactivate`).set("Authorization", h.admin)).status).toBe(404);
    expect((await request(h.app).get(`${API}/admin/clinics/${PENDING}/accounts`).set("Authorization", h.admin)).status).toBe(404);
  });
});

function fx(h: Harness) {
  return h.fx;
}

describe("autorização e separação de tokens", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildHarness();
  });

  const routes: [string, string][] = [
    ["get", `/admin/users/${TARGET}`],
    ["post", `/admin/users/${TARGET}/reset-access`],
    ["get", `/admin/clinics/${CLINIC_A}/accounts`],
    ["post", `/admin/clinics/${CLINIC_A}/accounts/${ACC_MGR_A}/suspend`],
    ["post", `/admin/clinics/${CLINIC_A}/accounts/${ACC_MGR_A}/reactivate`],
  ];

  it.each(routes)("%s %s: sem token -> 401; utilizador normal -> 403; token de clínica -> 401", async (method, path) => {
    const call = (auth?: string) => {
      const r = request(h.app)[method as "get" | "post"](`${API}${path}`);
      if (auth) void r.set("Authorization", auth);
      return r.send(path.endsWith("suspend") ? { reason: "x" } : undefined);
    };
    expect((await call()).status).toBe(401);
    expect((await call(h.plain)).status).toBe(403);
    expect((await call(h.clinicToken)).status).toBe(401);
    expect(h.events).toHaveLength(0);
    expect(fx(h).audit.events).toHaveLength(0);
  });
});
