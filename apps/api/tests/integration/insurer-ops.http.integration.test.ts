// HTTP + PostgreSQL real (testcontainers) do marco S1 / Fase A do módulo de seguradoras (ADR-025): supertest com
// express-openapi-validator a validar PEDIDOS e RESPOSTAS (`validateResponses`) contra docs/05-api/openapi.yaml (TC-SEG-10),
// isolamento entre seguradoras (TC-AZ-SEG-02, incl. FKs compostas na BD), matriz de papéis (TC-AZ-SEG-01), tokens e módulo
// desativado (TC-AZ-SEG-03), importação (TC-SEG-01), estados (TC-SEG-02), código de reclamação (BR-SEG-20, TC-SEG-04 parte
// da seguradora), moeda (TC-SEG-09), privacidade (TC-SEG-08) e job `insurer.expire-policies`.
import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { Kysely } from "kysely";
import { Pool } from "pg";
import request from "supertest";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultMigrationsDir, runMigrations } from "../../db/migrate-runner.js";
import { runWithActor } from "../../src/platform/actor/index.js";
import { FixedClock } from "../../src/platform/clock/index.js";
import { createDb, withTransaction, type Database } from "../../src/platform/db/index.js";
import { createApp } from "../../src/platform/http/index.js";
import { openApiSpecPath } from "../support/openapi-spec.js";
import { createLogger, type Logger } from "../../src/platform/logger/index.js";
import { signAccessToken } from "../../src/modules/auth/domain/jwt.js";
import { createBearerAuthSecurityHandler } from "../../src/modules/auth/interface/middleware.js";
import { createAuditModule } from "../../src/modules/audit/index.js";
import { signClinicAccessToken } from "../../src/modules/clinics/domain/clinic-jwt.js";
import { createClinicBearerAuthSecurityHandler } from "../../src/modules/clinics/interface/clinic-portal-middleware.js";
import {
  createAdminCreateInsurerUseCase,
  createAdminInsurerRootAccountUseCase,
  createAdminListInsurersUseCase,
  createAdminSetInsurerStatusUseCase,
  createAdminUpdateInsurerUseCase,
} from "../../src/modules/insurance/application/admin-insurers.js";
import { FakeInsuranceLogger, FakeInsuranceMailer } from "../../src/modules/insurance/application/fixtures.js";
import { createInsuranceLoginUseCase } from "../../src/modules/insurance/application/insurance-login.js";
import { createInsuranceLogoutUseCase } from "../../src/modules/insurance/application/insurance-logout.js";
import { createInsuranceRefreshUseCase } from "../../src/modules/insurance/application/insurance-refresh.js";
import { createCreateInsuranceAgentUseCase, createListInsuranceAgentsUseCase, createRemoveInsuranceAgentUseCase } from "../../src/modules/insurance/application/manage-insurance-agents.js";
import { createDecideInsuranceClaimUseCase, createGetInsuranceClaimUseCase, createListInsuranceClaimsUseCase } from "../../src/modules/insurance/application/portal-claims.js";
import type { CachedInsuranceAccountState, InsuranceDeps } from "../../src/modules/insurance/application/ports.js";
import { createResolveInsuranceActorStateUseCase } from "../../src/modules/insurance/application/resolve-insurance-actor-state.js";
import { signInsuranceAccessToken } from "../../src/modules/insurance/domain/insurance-jwt.js";
import { InsuranceInMemoryRateLimiter } from "../../src/modules/insurance/domain/insurance-rate-limiter.js";
import { InsuranceTtlCache } from "../../src/modules/insurance/domain/insurance-ttl-cache.js";
import { KyselyInsuranceAccountRepository, KyselyInsuranceSessionRepository, KyselyInsurersRepository, KyselyReimbursementClaimsRepository } from "../../src/modules/insurance/infrastructure/repo.js";
import { createInsuranceAdminRouter } from "../../src/modules/insurance/interface/admin-router.js";
import { createInsuranceActorContextMiddleware, createInsuranceBearerAuthSecurityHandler } from "../../src/modules/insurance/interface/insurance-portal-middleware.js";
import { createInsurancePortalRouter } from "../../src/modules/insurance/interface/insurance-portal-router.js";
import { createInsurerSettingsReader } from "../../src/modules/insurance/index.js";
import { createInsurerOpsModule, createInsurerOpsWorkerModule } from "../../src/modules/insurer-ops/index.js";
import { buildXlsx, IMPORT_HEADER } from "../support/xlsx.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const NOW = new Date("2026-11-11T10:00:00.000Z");
const API = "/api/v1";
const PORTAL = `${API}/insurance-portal`;
const KEYS = [{ kid: "k1", secret: new TextEncoder().encode("0123456789abcdef0123456789abcdef") }];
const SESSION = randomUUID();
const CLAIM_SECRET = "segredo-de-teste-dos-codigos";

const id = {
  platformAdmin: randomUUID(),
  user: randomUUID(),
  insA: randomUUID(),
  insB: randomUUID(),
  insC: randomUUID(), // módulo operacional desativado
  admA: randomUUID(),
  bmA: randomUUID(), // BENEFICIARY_MANAGER
  analystA: randomUUID(), // AUTHORIZATION_ANALYST (só leitura)
  agentA: randomUUID(),
  admB: randomUUID(),
  admC: randomUUID(),
  planA: randomUUID(),
  planADraft: randomUUID(),
  planB: randomUUID(),
  family: randomUUID(),
  member: randomUUID(),
  member2: randomUUID(),
};

describe("integração HTTP: módulo operacional de seguradoras, S1 / Fase A", () => {
  let container: StartedTestContainer;
  let pool: Pool;
  let db: Kysely<Database>;
  let app: ReturnType<typeof createApp>;
  /** Sem validação de respostas: só para o caso em que o contrato omite um estado (ver o PATCH da moeda). */
  let appLoose: ReturnType<typeof createApp>;
  let worker: ReturnType<typeof createInsurerOpsWorkerModule>;
  const clock = new FixedClock(NOW);
  const mailer = new FakeInsuranceMailer();
  const logs: string[] = [];
  const tok = { admA: "", bmA: "", analystA: "", agentA: "", admB: "", admC: "", platform: "", user: "", clinic: "" };

  const insToken = async (accountId: string) => `Bearer ${(await signInsuranceAccessToken({ subject: { insuranceAccountId: accountId, sessionId: SESSION }, now: NOW, ttlSeconds: 900, signingKeys: KEYS })).token}`;
  const send = (method: "get" | "post" | "patch" | "put" | "delete", path: string, token: string | undefined, body?: unknown) => {
    let r = request(app)[method](`${PORTAL}${path}`);
    if (token) r = r.set("Authorization", token);
    return body === undefined ? r : r.send(body as object);
  };
  const upload = (path: string, token: string, buffer: Buffer, filename: string, contentType = "application/octet-stream") =>
    request(app).post(`${PORTAL}${path}`).set("Authorization", token).attach("file", buffer, { filename, contentType });
  const csv = (...lines: string[]) => Buffer.from([IMPORT_HEADER.join(","), ...lines].join("\n"), "utf-8");
  const idOf = async (text: string, params: unknown[]): Promise<string> => ((await pool.query(text, params)).rows[0] as { id: string }).id;
  const count = async (table: string, insurerId: string) => Number(((await pool.query(`SELECT count(*) AS n FROM ${table} WHERE insurer_id=$1`, [insurerId])).rows[0] as { n: string }).n);

  function deps(): InsuranceDeps<Kysely<Database>> {
    return {
      insurersRepo: new KyselyInsurersRepository(),
      insuranceAccountRepo: new KyselyInsuranceAccountRepository(),
      insuranceSessionRepo: new KyselyInsuranceSessionRepository(),
      audit: audit,
      db,
      withTransaction: (fn) => withTransaction(db, fn),
      clock,
      insuranceMailer: mailer,
      logger: new FakeInsuranceLogger() as unknown as Logger,
      insuranceRateLimiter: new InsuranceInMemoryRateLimiter(clock),
      insuranceSigningKeys: KEYS,
      insuranceAccessTtlSeconds: 900,
      insuranceRefreshTtlMs: 30 * 24 * 60 * 60 * 1000,
      accountStateCache: new InsuranceTtlCache<CachedInsuranceAccountState>(clock, 60_000),
      operationalData: ops.operationalData,
    };
  }
  let audit: ReturnType<typeof createAuditModule>;
  let ops: ReturnType<typeof createInsurerOpsModule>;

  beforeAll(async () => {
    container = await new GenericContainer("postgres:16-alpine")
      .withEnvironment({ POSTGRES_USER: "vita", POSTGRES_PASSWORD: "vita", POSTGRES_DB: "vita" })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start();
    pool = new Pool({ connectionString: `postgres://vita:vita@${container.getHost()}:${String(container.getMappedPort(5432))}/vita` });
    db = createDb(pool);
    await runMigrations(pool, defaultMigrationsDir());
    await pool.query("INSERT INTO users (id, email, password_hash, name, birth_date, timezone, status, platform_role, email_verified_at, terms_accepted_version, terms_accepted_at) VALUES ($1,'admin@vita.pt','h','Admin','1990-01-01','Europe/Lisbon','ACTIVE','PLATFORM_ADMIN',now(),'1',now())", [id.platformAdmin]);
    await pool.query("INSERT INTO users (id, email, password_hash, name, birth_date, timezone, status, email_verified_at, terms_accepted_version, terms_accepted_at) VALUES ($1,'paciente@vita.pt','h','Paciente CANARIO-PACIENTE','1990-01-01','Europe/Lisbon','ACTIVE',now(),'1',now())", [id.user]);
    await pool.query("INSERT INTO families (id, name) VALUES ($1,'Familia CANARIO-FAMILIA')", [id.family]);
    await pool.query("INSERT INTO family_members (id, family_id, user_id, name, birth_date, role) VALUES ($1,$2,$3,'Membro CANARIO-MEMBRO','1990-01-01','FAMILY_ADMIN')", [id.member, id.family, id.user]);
    await pool.query("INSERT INTO family_members (id, family_id, name, birth_date, is_dependent) VALUES ($1,$2,'Dep','2015-01-01',true)", [id.member2, id.family]);
    await pool.query("INSERT INTO insurer_accounts (id, name, tax_id, operational_module_enabled) VALUES ($1,'Seg A','500000001',true), ($2,'Seg B','500000002',true), ($3,'Seg C','500000003',false)", [id.insA, id.insB, id.insC]);
    const acc = (accountId: string, insurer: string, role: string) =>
      pool.query("INSERT INTO insurance_accounts (id, insurer_id, email, password_hash, role) VALUES ($1,$2,$3,'x',$4)", [accountId, insurer, `${accountId}@seg.pt`, role]);
    await acc(id.admA, id.insA, "INSURANCE_ADMIN");
    await acc(id.bmA, id.insA, "BENEFICIARY_MANAGER");
    await acc(id.analystA, id.insA, "AUTHORIZATION_ANALYST");
    await acc(id.agentA, id.insA, "INSURANCE_AGENT");
    await acc(id.admB, id.insB, "INSURANCE_ADMIN");
    await acc(id.admC, id.insC, "INSURANCE_ADMIN");
    for (const [planId, insurer, name, status] of [[id.planA, id.insA, "Plano A", "ACTIVE"], [id.planADraft, id.insA, "Plano A rascunho", "DRAFT"], [id.planB, id.insB, "Plano B", "ACTIVE"]] as const) {
      await pool.query("INSERT INTO insurer_plans (id, insurer_id, name, status) VALUES ($1,$2,$3,$4)", [planId, insurer, name, status]);
    }

    audit = createAuditModule({ db, clock });
    ops = createInsurerOpsModule({ db, audit, clock, insurers: createInsurerSettingsReader(), claimCodeSecret: CLAIM_SECRET, partnerClinics: { list: () => Promise.resolve([]), find: () => Promise.resolve(null) }, patientAccess: { authorize: () => Promise.reject(new Error("rotas do paciente não usadas aqui")) } });
    worker = createInsurerOpsWorkerModule({ db, audit, clock, boss: undefined as never });

    tok.admA = await insToken(id.admA);
    tok.bmA = await insToken(id.bmA);
    tok.analystA = await insToken(id.analystA);
    tok.agentA = await insToken(id.agentA);
    tok.admB = await insToken(id.admB);
    tok.admC = await insToken(id.admC);
    tok.platform = `Bearer ${(await signAccessToken({ subject: { userId: id.platformAdmin, sessionId: SESSION }, now: NOW, ttlSeconds: 900, signingKeys: KEYS })).token}`;
    tok.user = `Bearer ${(await signAccessToken({ subject: { userId: id.user, sessionId: SESSION }, now: NOW, ttlSeconds: 900, signingKeys: KEYS })).token}`;
    tok.clinic = `Bearer ${(await signClinicAccessToken({ subject: { clinicAccountId: randomUUID(), sessionId: SESSION }, now: NOW, ttlSeconds: 900, signingKeys: KEYS })).token}`;

    const d = deps();
    const userActor: RequestHandler = (req, _res, next) => {
      if (!req.authSubject) {
        next();
        return;
      }
      runWithActor({ userId: req.authSubject.userId, platformAdmin: req.authSubject.userId === id.platformAdmin }, () => {
        next();
      });
    };
    const insuranceActor = createInsuranceActorContextMiddleware({ resolveInsuranceActorState: createResolveInsuranceActorStateUseCase(d) });
    const portalClaimsDeps = {
      claimsRepo: new KyselyReimbursementClaimsRepository(),
      receipts: { lockVisible: () => Promise.resolve([]), refs: () => Promise.resolve([]), summaries: () => Promise.resolve([]) },
      audit,
      withTransaction: <T>(fn: (trx: Kysely<Database>) => Promise<T>) => withTransaction(db, fn),
      clock,
    };
    const logDestination = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        logs.push(chunk.toString());
        callback();
      },
    });
    const makeApp = (validateResponses: boolean) => createApp({
      openApiSpecPath: openApiSpecPath(REPO_ROOT),
      logger: createLogger({ level: "debug", destination: logDestination }),
      validateResponses,
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
            adminListInsurers: createAdminListInsurersUseCase(d),
            adminCreateInsurer: createAdminCreateInsurerUseCase(d),
            adminUpdateInsurer: createAdminUpdateInsurerUseCase(d),
            adminSetInsurerStatus: createAdminSetInsurerStatusUseCase(d),
            adminCreateOrResetInsurerRootAccount: createAdminInsurerRootAccountUseCase(d),
          }),
        );
        router.use(
          createInsurancePortalRouter(
            {
              insuranceLogin: createInsuranceLoginUseCase(d),
              insuranceRefresh: createInsuranceRefreshUseCase(d),
              insuranceLogout: createInsuranceLogoutUseCase(d),
              listInsuranceAgents: createListInsuranceAgentsUseCase(d),
              createInsuranceAgent: createCreateInsuranceAgentUseCase(d),
              removeInsuranceAgent: createRemoveInsuranceAgentUseCase(d),
              listInsuranceClaims: createListInsuranceClaimsUseCase(portalClaimsDeps),
              getInsuranceClaim: createGetInsuranceClaimUseCase(portalClaimsDeps),
              decideInsuranceClaim: createDecideInsuranceClaimUseCase(portalClaimsDeps),
            },
            "",
          ),
        );
        router.use(ops.router);
        router.get("/clinic-portal/staff", (_req, res) => res.json([]));
        router.get("/users/me", (_req, res) => res.json({}));
      },
    });
    app = makeApp(true);
    appLoose = makeApp(false);
  }, 180_000);

  afterAll(async () => {
    await pool.end();
    await container.stop();
  });

  // ---------------------------------------------------------------- seguradora (admin): moeda e módulo (TC-SEG-09)
  describe("admin: currency e operationalModuleEnabled (TC-SEG-09)", () => {
    it("POST: por omissão AOA/false; valores explícitos; GET devolve ambos; moeda inválida ⇒ 422", async () => {
      const def = await request(app).post(`${API}/admin/insurers`).set("Authorization", tok.platform).send({ name: "Padrão", taxId: "700000001" });
      expect(def.status).toBe(201);
      expect(def.body).toMatchObject({ currency: "AOA", operationalModuleEnabled: false });
      const explicit = await request(app).post(`${API}/admin/insurers`).set("Authorization", tok.platform).send({ name: "Euro", taxId: "700000002", currency: "EUR", operationalModuleEnabled: true });
      expect(explicit.body).toMatchObject({ currency: "EUR", operationalModuleEnabled: true });
      const list = await request(app).get(`${API}/admin/insurers`).set("Authorization", tok.platform);
      expect(list.status).toBe(200);
      expect((list.body as { name: string; currency: string }[]).find((i) => i.name === "Euro")).toMatchObject({ currency: "EUR" });
      expect((await request(app).post(`${API}/admin/insurers`).set("Authorization", tok.platform).send({ name: "X", taxId: "700000003", currency: "eur" })).status).toBe(422);
    });

    it("PATCH: só PLATFORM_ADMIN; moeda muda sem dados e fica CONFLICT com beneficiários; módulo liga/desliga e audita", async () => {
      const created = (await request(app).post(`${API}/admin/insurers`).set("Authorization", tok.platform).send({ name: "Mut", taxId: "700000010" })).body as { id: string };
      const patch = (token: string, body: object) => request(app).patch(`${API}/admin/insurers/${created.id}`).set("Authorization", token).send(body);
      expect((await patch(tok.user, { currency: "USD" })).status).toBe(403);
      expect((await patch(tok.platform, { currency: "USD", operationalModuleEnabled: true })).body).toMatchObject({ currency: "USD", operationalModuleEnabled: true });
      await pool.query("INSERT INTO insurer_beneficiaries (insurer_id, name, id_document_type, id_document_number, birth_date, card_number) VALUES ($1,'N','BI','1','1990-01-01','VF1')", [created.id]);
      // DIVERGÊNCIA DE CONTRATO: `PATCH /admin/insurers/{id}` não declara `409` em openapi.yaml (BR-SEG-19/TC-SEG-09 exigem CONFLICT);
      // por isso este pedido passa por uma app sem validação de respostas.
      const conflict = await request(appLoose).patch(`${API}/admin/insurers/${created.id}`).set("Authorization", tok.platform).send({ currency: "EUR" });
      expect(conflict.status).toBe(409);
      expect(conflict.body).toMatchObject({ code: "CONFLICT" });
      expect((await patch(tok.platform, { currency: "USD" })).status).toBe(200); // mesma moeda: sem efeito
      expect((await patch(tok.platform, { operationalModuleEnabled: false })).body).toMatchObject({ operationalModuleEnabled: false });
      const actions = (await pool.query("SELECT action, metadata FROM audit_logs WHERE resource_id=$1 ORDER BY id", [created.id])).rows as { action: string; metadata: Record<string, unknown> | null }[];
      expect(actions.map((a) => a.action)).toEqual(expect.arrayContaining(["ADMIN_INSURER_CURRENCY_UPDATE", "ADMIN_INSURER_MODULE_ENABLE", "ADMIN_INSURER_MODULE_DISABLE"]));
      expect(actions.find((a) => a.action === "ADMIN_INSURER_CURRENCY_UPDATE")?.metadata).toMatchObject({ insurerId: created.id, currency: "USD" });
    });

    it("a BD rejeita moeda fora do formato ISO e o INSERT de pedido de reembolso sem moeda (default removido)", async () => {
      await expect(pool.query("INSERT INTO insurer_accounts (name, tax_id, currency) VALUES ('M','700000020','eu')")).rejects.toMatchObject({ code: "23514" });
      expect((await pool.query("SELECT column_default FROM information_schema.columns WHERE table_name='reimbursement_claims' AND column_name='currency'")).rows[0]).toMatchObject({ column_default: null });
    });
  });

  // ---------------------------------------------------------------- matriz de papéis (TC-AZ-SEG-01) e tokens/módulo (TC-AZ-SEG-03)
  describe("autorização", () => {
    const u = randomUUID();
    const company = { name: "Emp", taxId: "NIF-M" };
    const beneficiary = { name: "B", idDocumentType: "BI", idDocumentNumber: "M-1", birthDate: "1990-01-01", relationship: "HOLDER" };
    const policy = { planId: u, holderId: u, number: "M-1", validFrom: "2026-01-01", validTo: "2026-12-31" };
    // [método, caminho, corpo, escrita?]
    const routes: [string, string, object | undefined, boolean][] = [
      ["get", "/companies", undefined, false],
      ["post", "/companies", company, true],
      ["patch", `/companies/${u}`, { name: "N" }, true],
      ["get", "/beneficiaries", undefined, false],
      ["post", "/beneficiaries", beneficiary, true],
      ["get", `/beneficiaries/${u}`, undefined, false],
      ["patch", `/beneficiaries/${u}`, { name: "N" }, true],
      ["post", `/beneficiaries/${u}/status`, { status: "ACTIVE" }, true],
      ["post", `/beneficiaries/${u}/claim-code`, undefined, true],
      ["get", `/imports/${u}`, undefined, false],
      ["delete", `/imports/${u}`, undefined, true],
      ["post", `/imports/${u}/commit`, undefined, true],
      ["get", "/link-requests", undefined, false],
      ["post", `/link-requests/${u}/confirm`, undefined, true],
      ["post", `/link-requests/${u}/reject`, { note: "n" }, true],
      ["get", "/policies", undefined, false],
      ["post", "/policies", policy, true],
      ["get", `/policies/${u}`, undefined, false],
      ["patch", `/policies/${u}`, { validTo: "2026-12-31" }, true],
      ["post", `/policies/${u}/status`, { status: "ACTIVE" }, true],
    ];
    type Method = "get" | "post" | "patch" | "delete";
    const matrix = routes.flatMap(([method, path, body, write]) =>
      (
        [
          ["admA", true],
          ["bmA", true],
          ["analystA", !write],
          ["agentA", false],
        ] as const
      ).map(([role, allowed]) => [role, method, path, body, allowed] as const),
    );

    it.each(matrix)("%s %s %s ⇒ %s", async (role, method, path, body, allowed) => {
      const res = await send(method as Method, path, tok[role], body);
      if (allowed) expect([401, 403], `${role} ${method} ${path} ⇒ ${String(res.status)}`).not.toContain(res.status);
      else expect(res.status, `${role} ${method} ${path}`).toBe(403);
    });

    it("sem efeito parcial: escrita negada (BENEFICIARY_MANAGER não gere agentes; ANALYST não cria empresas)", async () => {
      const before = await count("insurer_companies", id.insA);
      expect((await send("post", "/companies", tok.analystA, { name: "Neg", taxId: "NEG-1" })).status).toBe(403);
      expect(await count("insurer_companies", id.insA)).toBe(before);
      const agents = await request(app).post(`${PORTAL}/agents`).set("Authorization", tok.bmA).send({ email: "x@seg.pt" });
      expect(agents.status).toBe(403);
    });

    it.each(matrix.filter(([role]) => role === "admA").map(([, method, path, body]) => [method, path, body] as const))("módulo desativado ⇒ 404 em %s %s", async (method, path, body) => {
      expect((await send(method as Method, path, tok.admC, body)).status).toBe(404);
    });

    it("módulo desativado: o fluxo de reembolso mantém-se (ADR-021)", async () => {
      expect((await request(app).get(`${PORTAL}/claims`).set("Authorization", tok.admC)).status).toBe(200);
    });

    it("tokens distintos: User, clínica e ausência de token ⇒ 401; o token da seguradora não vale fora do seu prefixo", async () => {
      for (const token of [tok.user, tok.clinic, undefined]) {
        expect((await send("get", "/companies", token)).status).toBe(401);
        expect((await send("post", "/beneficiaries", token, beneficiary)).status).toBe(401);
      }
      expect((await request(app).get(`${API}/clinic-portal/staff`).set("Authorization", tok.admA)).status).toBe(401);
      expect((await request(app).get(`${API}/users/me`).set("Authorization", tok.admA)).status).toBe(401);
    });

    it("INSURANCE_ADMIN cria BENEFICIARY_MANAGER (só com módulo ativo); lista e remove; audita INSURER_ACCOUNT_*", async () => {
      const bad = await request(app).post(`${PORTAL}/agents`).set("Authorization", tok.admC).send({ email: "bm@c.pt", role: "BENEFICIARY_MANAGER" });
      expect(bad.status).toBe(422);
      const created = await request(app).post(`${PORTAL}/agents`).set("Authorization", tok.admA).send({ email: "bm2@a.pt", role: "BENEFICIARY_MANAGER" });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ role: "BENEFICIARY_MANAGER", insurerId: id.insA });
      expect((await request(app).post(`${PORTAL}/agents`).set("Authorization", tok.admA).send({ email: "ag@a.pt" })).body).toMatchObject({ role: "INSURANCE_AGENT" });
      const list = await request(app).get(`${PORTAL}/agents`).set("Authorization", tok.admA);
      expect((list.body as { role: string }[]).map((a) => a.role).sort()).toEqual(expect.arrayContaining(["BENEFICIARY_MANAGER", "INSURANCE_AGENT"]));
      expect((list.body as { role: string }[]).some((a) => a.role === "INSURANCE_ADMIN")).toBe(false);
      expect((await request(app).delete(`${PORTAL}/agents/${(created.body as { id: string }).id}`).set("Authorization", tok.admA)).status).toBe(204);
      expect((await request(app).delete(`${PORTAL}/agents/${id.admA}`).set("Authorization", tok.admA)).status).toBe(404);
      const actions = (await pool.query("SELECT action, metadata FROM audit_logs WHERE action IN ('INSURER_ACCOUNT_CREATE','INSURER_ACCOUNT_REMOVE')")).rows as { action: string; metadata: Record<string, string> }[];
      expect(actions.map((a) => a.action)).toEqual(["INSURER_ACCOUNT_CREATE", "INSURER_ACCOUNT_REMOVE"]);
      expect(actions[0]?.metadata).toMatchObject({ insurerId: id.insA, role: "BENEFICIARY_MANAGER" });
    });
  });

  // ---------------------------------------------------------------- empresas, beneficiários, apólices, ligações
  describe("fluxo completo da seguradora A e isolamento da B (TC-AZ-SEG-02)", () => {
    const own = { company: "", holder: "", child: "", card: "", policy: "", link1: "", link2: "" };

    it("empresas: criar, NIF duplicado ⇒ 409, PATCH nome/estado, paginação estável", async () => {
      const a = await send("post", "/companies", tok.admA, { name: "Empresa CANARIO-EMPRESA", taxId: "NIF-A1" });
      expect(a.status).toBe(201);
      own.company = (a.body as { id: string }).id;
      expect((await send("post", "/companies", tok.bmA, { name: "Outra", taxId: "NIF-A1" })).status).toBe(409);
      for (let i = 2; i <= 5; i++) expect((await send("post", "/companies", tok.bmA, { name: `E${String(i)}`, taxId: `NIF-A${String(i)}` })).status).toBe(201);
      const patched = await send("patch", `/companies/${own.company}`, tok.admA, { name: "Renomeada", status: "INACTIVE" });
      expect(patched.body).toMatchObject({ name: "Renomeada", status: "INACTIVE", taxId: "NIF-A1" });
      expect((await send("get", "/companies?status=INACTIVE", tok.admA)).body).toMatchObject({ items: [{ id: own.company }], nextCursor: null });
      const seen: string[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 10; page++) {
        const res = await send("get", `/companies?limit=2${cursor ? `&cursor=${cursor}` : ""}`, tok.admA);
        expect(res.status).toBe(200);
        seen.push(...(res.body as { items: { id: string }[] }).items.map((i) => i.id));
        cursor = (res.body as { nextCursor: string | null }).nextCursor;
        if (!cursor) break;
      }
      const total = await count("insurer_companies", id.insA); // inclui a empresa criada pela matriz de papéis
      expect(seen).toHaveLength(total);
      expect(new Set(seen).size).toBe(total);
      expect((await send("get", "/companies?cursor=lixo", tok.admA)).status).toBe(422);
      expect((await send("get", "/companies?status=XPTO", tok.admA)).status).toBe(422);
    });

    it("beneficiários: nasce PENDING; cartão gerado; documento duplicado ⇒ 409; dependente exige titular; filtros", async () => {
      const holder = await send("post", "/beneficiaries", tok.bmA, { name: "Titular CANARIO-NOME", idDocumentType: "bi", idDocumentNumber: "CANARIO-DOC-1", birthDate: "1980-05-20", relationship: "HOLDER", companyId: own.company });
      expect(holder.status).toBe(201);
      own.holder = (holder.body as { id: string }).id;
      expect(holder.body).toMatchObject({ status: "PENDING", idDocumentType: "BI", linked: false, holderId: null, companyId: own.company });
      expect((holder.body as { cardNumber: string }).cardNumber).toMatch(/^VF\d{14}$/);
      own.card = (holder.body as { cardNumber: string }).cardNumber;
      expect((await send("post", "/beneficiaries", tok.admA, { name: "Dup", idDocumentType: "BI", idDocumentNumber: "CANARIO-DOC-1", birthDate: "1980-05-20", relationship: "HOLDER" })).status).toBe(409);
      const child = await send("post", "/beneficiaries", tok.admA, { name: "Filho", idDocumentType: "BI", idDocumentNumber: "CANARIO-DOC-2", birthDate: "2010-01-01", relationship: "CHILD", holderId: own.holder });
      expect(child.status).toBe(201);
      own.child = (child.body as { id: string }).id;
      expect((child.body as { holderId: string }).holderId).toBe(own.holder);
      expect((await send("post", "/beneficiaries", tok.admA, { name: "SemTitular", idDocumentType: "BI", idDocumentNumber: "X-3", birthDate: "2010-01-01", relationship: "CHILD" })).status).toBe(422);
      expect((await send("post", "/beneficiaries", tok.admA, { name: "TitularComTitular", idDocumentType: "BI", idDocumentNumber: "X-4", birthDate: "2010-01-01", relationship: "HOLDER", holderId: own.holder })).status).toBe(422);
      expect((await send("post", "/beneficiaries", tok.admA, { name: "TitularInvalido", idDocumentType: "BI", idDocumentNumber: "X-5", birthDate: "2010-01-01", relationship: "CHILD", holderId: own.child })).status).toBe(422);
      expect((await send("post", "/beneficiaries", tok.admA, { name: "DataFalsa", idDocumentType: "BI", idDocumentNumber: "X-6", birthDate: "2026-02-30", relationship: "HOLDER" })).status).toBe(422);
      expect((await send("get", `/beneficiaries?holderId=${own.holder}`, tok.admA)).body).toMatchObject({ items: [{ id: own.child }] });
      expect((await send("get", `/beneficiaries?q=${own.card}`, tok.admA)).body).toMatchObject({ items: [{ id: own.holder }] });
      expect((await send("get", "/beneficiaries?q=CANARIO-DOC-2", tok.admA)).body).toMatchObject({ items: [{ id: own.child }] });
      expect((await send("get", "/beneficiaries?q=CANARIO-DOC", tok.admA)).body).toMatchObject({ items: [] }); // documento: pesquisa exata
      expect((await send("get", "/beneficiaries?q=canario-nome", tok.admA)).body).toMatchObject({ items: [{ id: own.holder }] }); // nome: contém
      expect((await send("get", "/beneficiaries?status=ACTIVE", tok.admA)).body).toMatchObject({ items: [] });
      expect((await send("patch", `/beneficiaries/${own.holder}`, tok.admA, { name: "Titular Novo", companyId: null })).body).toMatchObject({ name: "Titular Novo", companyId: null, idDocumentNumber: "CANARIO-DOC-1" });
      expect((await send("patch", `/beneficiaries/${own.holder}`, tok.admA, { companyId: own.company })).status).toBe(200);
    });

    it("estados do beneficiário: PENDING→ACTIVE⇄SUSPENDED→CANCELLED; notas; transição inválida ⇒ INVALID_STATE_TRANSITION", async () => {
      const status = (benId: string, body: object) => send("post", `/beneficiaries/${benId}/status`, tok.bmA, body);
      expect((await status(own.holder, { status: "SUSPENDED", note: "n" })).body).toMatchObject({ code: "INVALID_STATE_TRANSITION" });
      expect((await status(own.holder, { status: "ACTIVE" })).body).toMatchObject({ status: "ACTIVE" });
      expect((await status(own.holder, { status: "SUSPENDED" })).status).toBe(422);
      expect((await status(own.holder, { status: "SUSPENDED", note: "atraso" })).body).toMatchObject({ status: "SUSPENDED", statusNote: "atraso" });
      expect((await send("get", `/beneficiaries/${own.holder}`, tok.bmA)).body).toMatchObject({ statusNote: "atraso" });
      // BR-SEG-24: a nota persiste (coluna status_note), mas nunca vai para a auditoria; voltar a ACTIVE limpa-a.
      expect((await pool.query("SELECT count(*)::int AS n FROM audit_logs WHERE metadata::text LIKE '%atraso%'")).rows[0]).toMatchObject({ n: 0 });
      expect((await status(own.holder, { status: "ACTIVE" })).body).toMatchObject({ status: "ACTIVE", statusNote: null });
      expect((await status(own.child, { status: "CANCELLED", note: "saiu" })).body).toMatchObject({ status: "CANCELLED" });
      expect((await status(own.child, { status: "ACTIVE" })).body).toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    });

    it("código de reclamação: em claro só na resposta; na BD só o HMAC; novo invalida o anterior; CANCELLED ⇒ 409; auditoria sem o código", async () => {
      const first = await send("post", `/beneficiaries/${own.holder}/claim-code`, tok.admA);
      expect(first.status).toBe(201);
      expect(first.headers["cache-control"]).toBe("no-store");
      const code = (first.body as { code: string }).code;
      expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
      expect(new Date((first.body as { expiresAt: string }).expiresAt).getTime()).toBeGreaterThan(NOW.getTime());
      const row1 = (await pool.query("SELECT claim_code_hash, claim_code_expires_at FROM insurer_beneficiaries WHERE id=$1", [own.holder])).rows[0] as { claim_code_hash: string };
      expect(row1.claim_code_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(row1)).not.toContain(code.replace("-", ""));
      const second = await send("post", `/beneficiaries/${own.holder}/claim-code`, tok.bmA);
      const row2 = (await pool.query("SELECT claim_code_hash FROM insurer_beneficiaries WHERE id=$1", [own.holder])).rows[0] as { claim_code_hash: string };
      expect(row2.claim_code_hash).not.toBe(row1.claim_code_hash);
      expect((second.body as { code: string }).code).not.toBe(code);
      expect((await send("post", `/beneficiaries/${own.child}/claim-code`, tok.admA)).status).toBe(409);
      expect(JSON.stringify(first.body)).not.toContain("claim_code");
      const audits = JSON.stringify((await pool.query("SELECT * FROM audit_logs WHERE action='INSURER_LINK_REQUEST'")).rows);
      expect(audits).toContain("CODE_ISSUED");
      for (const secret of [code, code.replace("-", ""), (second.body as { code: string }).code, row1.claim_code_hash]) expect(audits).not.toContain(secret);
      // a leitura do beneficiário nunca devolve nada do código
      expect(JSON.stringify((await send("get", `/beneficiaries/${own.holder}`, tok.admA)).body)).not.toMatch(/claim|hash|code/i);
    });

    it("apólices: criar (plano/titular/empresa da própria seguradora), número único, datas, edição e estados com plano ACTIVE", async () => {
      const base = { planId: id.planA, holderId: own.holder, number: "APL-1", validFrom: "2026-01-01", validTo: "2026-12-31" };
      const created = await send("post", "/policies", tok.bmA, { ...base, companyId: own.company });
      expect(created.status).toBe(201);
      own.policy = (created.body as { id: string }).id;
      expect(created.body).toMatchObject({ number: "APL-1", planName: "Plano A", planVersion: 1, status: "DRAFT", holderId: own.holder, companyId: own.company });
      expect((await send("post", "/policies", tok.admA, base)).status).toBe(409);
      expect((await send("post", "/policies", tok.admA, { ...base, number: "APL-2", validFrom: "2026-02-01", validTo: "2026-01-01" })).status).toBe(422);
      expect((await send("post", "/policies", tok.admA, { ...base, number: "APL-3", holderId: own.child })).status).toBe(422); // não é titular
      expect((await send("get", "/policies?status=DRAFT&q=apl", tok.admA)).body).toMatchObject({ items: [{ id: own.policy }] });
      // DRAFT→ACTIVE exige plano ACTIVE
      const draftPlanPolicy = await send("post", "/policies", tok.admA, { ...base, number: "APL-D", planId: id.planADraft });
      expect(draftPlanPolicy.status).toBe(201);
      expect((await send("post", `/policies/${(draftPlanPolicy.body as { id: string }).id}/status`, tok.admA, { status: "ACTIVE" })).status).toBe(409);
      expect((await send("patch", `/policies/${own.policy}`, tok.admA, { planId: id.planADraft })).body).toMatchObject({ planId: id.planADraft });
      expect((await send("patch", `/policies/${own.policy}`, tok.admA, { planId: id.planA })).status).toBe(200);
      expect((await send("post", `/policies/${own.policy}/status`, tok.admA, { status: "ACTIVE" })).body).toMatchObject({ status: "ACTIVE" });
      expect((await send("patch", `/policies/${own.policy}`, tok.admA, { planId: id.planADraft })).status).toBe(409); // plano só em DRAFT
      expect((await send("patch", `/policies/${own.policy}`, tok.admA, { validTo: "2027-06-30" })).body).toMatchObject({ validTo: "2027-06-30" });
      expect((await send("patch", `/policies/${own.policy}`, tok.admA, { validTo: "2025-01-01" })).status).toBe(422);
      expect((await send("post", `/policies/${own.policy}/status`, tok.admA, { status: "CANCELLED" })).status).toBe(422); // nota
      expect((await send("post", `/policies/${own.policy}/status`, tok.admA, { status: "SUSPENDED", note: "n" })).body).toMatchObject({ status: "SUSPENDED", statusNote: "n" });
      expect((await send("post", `/policies/${own.policy}/status`, tok.admA, { status: "ACTIVE" })).body).toMatchObject({ status: "ACTIVE", statusNote: null });
      expect((await send("post", `/policies/${own.policy}/status`, tok.admA, { status: "CANCELLED", note: "fim" })).body).toMatchObject({ status: "CANCELLED", statusNote: "fim" });
      expect((await send("post", `/policies/${own.policy}/status`, tok.admA, { status: "ACTIVE" })).body).toMatchObject({ code: "INVALID_STATE_TRANSITION" });
      expect((await send("patch", `/policies/${own.policy}`, tok.admA, { validTo: "2027-07-01" })).status).toBe(409); // final
    });

    it("pedidos de ligação: lista PENDING por omissão; confirmar liga (linked=true); rejeitar exige motivo; segunda decisão ⇒ 409; nada do paciente na resposta", async () => {
      const mk = (benId: string, member: string) =>
        idOf("INSERT INTO insurer_beneficiary_link_requests (insurer_id, beneficiary_id, requested_by, family_id, family_member_id) VALUES ($1,$2,$3,$4,$5) RETURNING id", [id.insA, benId, id.user, id.family, member]);
      own.link1 = await mk(own.holder, id.member);
      const list = await send("get", "/link-requests", tok.analystA);
      expect(list.status).toBe(200);
      expect(list.body).toMatchObject({ items: [{ id: own.link1, beneficiaryId: own.holder, status: "PENDING", beneficiaryName: "Titular Novo", cardNumber: own.card }] });
      const confirmed = await send("post", `/link-requests/${own.link1}/confirm`, tok.bmA);
      expect(confirmed.status).toBe(200);
      expect(confirmed.body).toMatchObject({ status: "CONFIRMED", decisionNote: null });
      expect(Object.keys(confirmed.body as object).sort()).toEqual(["beneficiaryId", "beneficiaryName", "cardNumber", "decidedAt", "decisionNote", "id", "requestedAt", "status"]);
      expect((await send("post", `/link-requests/${own.link1}/confirm`, tok.bmA)).status).toBe(409);
      expect((await send("post", `/link-requests/${own.link1}/reject`, tok.bmA, { note: "tarde" })).status).toBe(409);
      expect((await send("get", `/beneficiaries/${own.holder}`, tok.admA)).body).toMatchObject({ linked: true });
      expect((await pool.query("SELECT family_member_id FROM insurer_beneficiaries WHERE id=$1", [own.holder])).rows[0]).toMatchObject({ family_member_id: id.member });
      expect((await send("get", "/link-requests?status=CONFIRMED", tok.admA)).body).toMatchObject({ items: [{ id: own.link1 }] });
      // 2.º pedido para o MESMO beneficiário já ligado ⇒ 409 ao confirmar; rejeitar com motivo ⇒ REJECTED
      own.link2 = await mk(own.holder, id.member2);
      expect((await send("post", `/link-requests/${own.link2}/confirm`, tok.admA)).status).toBe(409);
      expect((await send("post", `/link-requests/${own.link2}/reject`, tok.admA, {})).status).toBe(422);
      expect((await send("post", `/link-requests/${own.link2}/reject`, tok.admA, { note: "documento não confere" })).body).toMatchObject({ status: "REJECTED", decisionNote: "documento não confere" });
    });

    it("privacidade (TC-SEG-08): nenhuma resposta da seguradora contém ids/nomes de utilizador, família ou membro", async () => {
      const bodies = [
        (await send("get", "/beneficiaries", tok.admA)).text,
        (await send("get", `/beneficiaries/${own.holder}`, tok.admA)).text,
        (await send("get", "/link-requests?status=CONFIRMED", tok.admA)).text,
        (await send("get", "/link-requests?status=REJECTED", tok.admA)).text,
        (await send("get", "/policies", tok.admA)).text,
      ].join("\n");
      for (const secret of [id.user, id.family, id.member, id.member2, "CANARIO-PACIENTE", "CANARIO-FAMILIA", "CANARIO-MEMBRO", "paciente@vita.pt", "family_id", "familyId", "familyMemberId"]) expect(bodies).not.toContain(secret);
    });

    it("isolamento: a seguradora B nunca vê nem altera recursos da A (404) e as listas só têm linhas próprias", async () => {
      const own2 = { company: (await send("post", "/companies", tok.admB, { name: "Emp B", taxId: "NIF-B1" })).body as { id: string } };
      const holderB = (await send("post", "/beneficiaries", tok.admB, { name: "Tit B", idDocumentType: "BI", idDocumentNumber: "CANARIO-DOC-1", birthDate: "1980-05-20", relationship: "HOLDER" })).body as { id: string };
      expect(holderB.id).toBeTruthy(); // mesmo documento noutra seguradora é permitido (unicidade por seguradora)
      const notFound = async (method: "get" | "post" | "patch" | "delete", path: string, body?: object) => {
        const res = await send(method, path, tok.admB, body);
        expect(res.status, `${method} ${path}`).toBe(404);
        expect(res.body).toMatchObject({ code: "NOT_FOUND" });
      };
      await notFound("patch", `/companies/${own.company}`, { name: "Hack" });
      await notFound("get", `/beneficiaries/${own.holder}`);
      await notFound("patch", `/beneficiaries/${own.holder}`, { name: "Hack" });
      await notFound("post", `/beneficiaries/${own.holder}/status`, { status: "ACTIVE" });
      await notFound("post", `/beneficiaries/${own.holder}/claim-code`);
      await notFound("get", `/policies/${own.policy}`);
      await notFound("patch", `/policies/${own.policy}`, { validTo: "2030-01-01" });
      await notFound("post", `/policies/${own.policy}/status`, { status: "ACTIVE" });
      await notFound("post", `/link-requests/${own.link2}/confirm`);
      await notFound("post", `/link-requests/${own.link2}/reject`, { note: "n" });
      // referências cruzadas em corpo ⇒ VALIDATION_ERROR (nunca cruzamento)
      const cross = async (path: string, body: object, method: "post" | "patch" = "post") => { expect((await send(method, path, tok.admB, body)).status, path).toBe(422); };
      await cross("/beneficiaries", { name: "X", idDocumentType: "BI", idDocumentNumber: "X-B1", birthDate: "1990-01-01", relationship: "HOLDER", companyId: own.company });
      await cross("/beneficiaries", { name: "X", idDocumentType: "BI", idDocumentNumber: "X-B2", birthDate: "1990-01-01", relationship: "CHILD", holderId: own.holder });
      await cross(`/beneficiaries/${holderB.id}`, { companyId: own.company }, "patch");
      await cross("/policies", { planId: id.planA, holderId: holderB.id, number: "B-1", validFrom: "2026-01-01", validTo: "2026-12-31" });
      await cross("/policies", { planId: id.planB, holderId: own.holder, number: "B-2", validFrom: "2026-01-01", validTo: "2026-12-31" });
      await cross("/policies", { planId: id.planB, holderId: holderB.id, companyId: own.company, number: "B-3", validFrom: "2026-01-01", validTo: "2026-12-31" });
      // listas e filtros só com linhas próprias
      for (const path of ["/companies", "/beneficiaries", "/policies", "/link-requests?status=CONFIRMED", "/link-requests?status=REJECTED"]) {
        const items = ((await send("get", path, tok.admB)).body as { items: { id: string }[] }).items.map((i) => i.id);
        for (const foreign of [own.company, own.holder, own.child, own.policy, own.link1, own.link2]) expect(items, path).not.toContain(foreign);
      }
      expect((await send("get", `/beneficiaries?holderId=${own.holder}`, tok.admB)).body).toMatchObject({ items: [] });
      expect((await send("get", `/policies?holderId=${own.holder}`, tok.admB)).body).toMatchObject({ items: [] });
      expect((await send("get", `/beneficiaries?q=CANARIO-DOC-2`, tok.admB)).body).toMatchObject({ items: [] });
      expect(own2.company.id).toBeTruthy();
    });

    it("BD: a FK composta (insurer_id, id) rejeita referências entre seguradoras", async () => {
      const reject = async (sqlText: string, params: unknown[]) => {
        await expect(pool.query(sqlText, params)).rejects.toMatchObject({ code: "23503" });
      };
      const holderB = await idOf("SELECT id FROM insurer_beneficiaries WHERE insurer_id=$1 LIMIT 1", [id.insB]);
      const companyB = await idOf("SELECT id FROM insurer_companies WHERE insurer_id=$1 LIMIT 1", [id.insB]);
      await reject("INSERT INTO insurer_policies (insurer_id, plan_id, holder_id, number, valid_from, valid_to) VALUES ($1,$2,$3,'FK-1','2026-01-01','2026-12-31')", [id.insB, id.planA, holderB]); // plano de A
      await reject("INSERT INTO insurer_policies (insurer_id, plan_id, holder_id, number, valid_from, valid_to) VALUES ($1,$2,$3,'FK-2','2026-01-01','2026-12-31')", [id.insB, id.planB, randomUUID()]); // titular inexistente
      await reject("INSERT INTO insurer_policies (insurer_id, plan_id, holder_id, number, valid_from, valid_to) VALUES ($1,$2,$3,'FK-3','2026-01-01','2026-12-31')", [id.insA, id.planA, holderB]); // titular de B em A
      await reject("INSERT INTO insurer_beneficiaries (insurer_id, company_id, name, id_document_type, id_document_number, birth_date, card_number) VALUES ($1,$2,'n','BI','FK-4','1990-01-01','VFFK4')", [id.insA, companyB]);
      await reject("INSERT INTO insurer_beneficiaries (insurer_id, holder_id, name, id_document_type, id_document_number, birth_date, relationship, card_number) VALUES ($1,$2,'n','BI','FK-5','1990-01-01','CHILD','VFFK5')", [id.insA, holderB]);
      await reject("INSERT INTO insurer_beneficiary_link_requests (insurer_id, beneficiary_id, family_id, family_member_id) VALUES ($1,$2,$3,$4)", [id.insA, holderB, id.family, id.member2]);
      await expect(pool.query("INSERT INTO insurer_beneficiaries (insurer_id, name, id_document_type, id_document_number, birth_date, relationship, card_number) VALUES ($1,'n','BI','CK-1','1990-01-01','HOLDER','VFCK1') RETURNING id", [id.insA]).then(() => pool.query("UPDATE insurer_beneficiaries SET claim_code_hash='x' WHERE insurer_id=$1 AND id_document_number='CK-1'", [id.insA]))).rejects.toMatchObject({ code: "23514" });
      await expect(pool.query("INSERT INTO insurer_beneficiaries (insurer_id, holder_id, name, id_document_type, id_document_number, birth_date, relationship, card_number) VALUES ($1,NULL,'n','BI','CK-2','1990-01-01','CHILD','VFCK2')", [id.insA])).rejects.toMatchObject({ code: "23514" });
    });
  });

  // ---------------------------------------------------------------- importação (TC-SEG-01)
  describe("importação CSV/XLSX (TC-SEG-01, BR-SEG-17)", () => {
    it("pré-visualização NÃO grava; erros por linha; commit grava só as válidas (PENDING), conta importedRows/errorRows/duplicateRows", async () => {
      const before = await count("insurer_beneficiaries", id.insA);
      await send("post", "/companies", tok.admA, { name: "Emp Imp", taxId: "NIF-IMP" });
      const file = csv(
        "Ana Imp,bi,IMP-1,1985-03-01,HOLDER,,NIF-IMP", //                2 válida (titular)
        "Bruno Imp,BI,IMP-2,1990-02-02,SPOUSE,IMP-1,", //                  3 válida (dependente, titular no ficheiro)
        "Dup Ficheiro,BI,IMP-1,1990-02-02,HOLDER,,", //                    4 DUPLICATE_IN_FILE
        "Dup Existente,BI,CANARIO-DOC-2,2010-01-01,CHILD,CANARIO-DOC-1,", // 5 DUPLICATE_EXISTING
        ",BI,IMP-5,1990-01-01,HOLDER,,", //                               6 REQUIRED
        "Data Mal,BI,IMP-6,01/01/1990,HOLDER,,", //                       7 INVALID_FORMAT
        "Sem Titular,BI,IMP-7,2000-01-01,CHILD,NAO-EXISTE,", //            8 HOLDER_NOT_FOUND
        "Emp Falsa,BI,IMP-8,2000-01-01,HOLDER,,NIF-NAO", //                9 COMPANY_NOT_FOUND
        "Titular Existente,BI,IMP-9,2001-01-01,OTHER,CANARIO-DOC-1,", //   10 válida (titular já existente)
      );
      const preview = await upload("/imports", tok.bmA, file, "lote.csv", "text/csv");
      expect(preview.status).toBe(201);
      expect(preview.body).toMatchObject({ format: "CSV", status: "PREVIEW", rowCount: 9, validRows: 3, errorRows: 6, duplicateRows: 2, importedRows: null, errorsTruncated: false });
      expect((preview.body as { errors: { row: number; code: string }[] }).errors.map((e) => [e.row, e.code])).toEqual([
        [4, "DUPLICATE_IN_FILE"],
        [5, "DUPLICATE_EXISTING"],
        [6, "REQUIRED"],
        [7, "INVALID_FORMAT"],
        [8, "HOLDER_NOT_FOUND"],
        [9, "COMPANY_NOT_FOUND"],
      ]);
      expect((preview.body as { preview: { row: number }[] }).preview.map((p) => p.row)).toEqual([2, 3, 10]);
      expect(await count("insurer_beneficiaries", id.insA)).toBe(before); // não grava
      expect(JSON.stringify((preview.body as { errors: unknown }).errors)).not.toContain("Dup Ficheiro");

      const batchId = (preview.body as { id: string }).id;
      expect((await send("get", `/imports/${batchId}`, tok.analystA)).body).toMatchObject({ status: "PREVIEW", validRows: 3 });
      const commit = await send("post", `/imports/${batchId}/commit`, tok.admA);
      expect(commit.status).toBe(200);
      expect(commit.body).toMatchObject({ status: "COMMITTED", importedRows: 3, errorRows: 6, duplicateRows: 2, validRows: 3, preview: [] });
      expect(await count("insurer_beneficiaries", id.insA)).toBe(before + 3);
      const rows = (await pool.query("SELECT id_document_number, status::text, relationship::text, holder_id, company_id, card_number FROM insurer_beneficiaries WHERE id_document_number IN ('IMP-1','IMP-2','IMP-9') AND insurer_id=$1 ORDER BY id_document_number", [id.insA])).rows as { status: string; holder_id: string | null; company_id: string | null; card_number: string }[];
      expect(rows.every((r) => r.status === "PENDING")).toBe(true); // nunca ACTIVE
      expect(rows[0]?.holder_id).toBeNull();
      expect(rows[0]?.company_id).not.toBeNull();
      expect(rows[1]?.holder_id).not.toBeNull();
      expect(rows[2]?.holder_id).not.toBeNull();
      expect(new Set(rows.map((r) => r.card_number)).size).toBe(3);
      // linhas pessoais descartadas do lote
      expect((await pool.query("SELECT rows FROM insurer_import_batches WHERE id=$1", [batchId])).rows[0]).toMatchObject({ rows: null });
      expect((await send("post", `/imports/${batchId}/commit`, tok.admA)).status).toBe(409);
      expect((await send("delete", `/imports/${batchId}`, tok.admA)).status).toBe(409);
      // ficheiro repetido: tudo duplicado
      const again = await upload("/imports", tok.admA, csv("Ana Imp,BI,IMP-1,1985-03-01,HOLDER,,"), "lote.csv", "text/csv");
      expect(again.body).toMatchObject({ validRows: 0, errorRows: 1, duplicateRows: 1 });
      expect((await send("post", `/imports/${(again.body as { id: string }).id}/commit`, tok.admA)).body).toMatchObject({ importedRows: 0, status: "COMMITTED" });
    });

    it("XLSX com data em série do Excel; mesma regra de importação", async () => {
      const xlsx = buildXlsx([IMPORT_HEADER, ["Xis Imp", "BI", "XLS-1", 32874, "HOLDER", "", ""], ["Dep Xis", "BI", "XLS-2", "2015-05-05", "CHILD", "XLS-1", ""]]);
      const res = await upload("/imports", tok.admA, xlsx, "lote.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ format: "XLSX", rowCount: 2, validRows: 2, errorRows: 0 });
      expect((res.body as { preview: { birthDate: string }[] }).preview[0]?.birthDate).toBe("1990-01-01");
      expect((await send("post", `/imports/${(res.body as { id: string }).id}/commit`, tok.admA)).body).toMatchObject({ importedRows: 2 });
    });

    it("limites: 5.000 linhas OK (CSV e XLSX), 5.001 ⇒ 422; vazio/tipo errado ⇒ 415; >10 MB ⇒ 413; cabeçalho em falta ⇒ 422", async () => {
      const lines = (n: number, prefix: string) => Array.from({ length: n }, (_v, i) => `P ${prefix}${String(i)},BI,${prefix}${String(i)},1990-01-01,HOLDER,,`);
      const max = await upload("/imports", tok.admA, csv(...lines(5000, "L")), "max.csv", "text/csv");
      expect(max.status).toBe(201);
      expect(max.body).toMatchObject({ rowCount: 5000, validRows: 5000 });
      const batch = (max.body as { id: string }).id;
      // transação única: um erro a meio ⇒ nada gravado e o lote continua em PREVIEW
      await pool.query("CREATE FUNCTION fail_boom() RETURNS trigger AS $$ BEGIN IF NEW.id_document_number = 'L4999' THEN RAISE EXCEPTION 'boom'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql");
      await pool.query("CREATE TRIGGER fail_boom BEFORE INSERT ON insurer_beneficiaries FOR EACH ROW EXECUTE FUNCTION fail_boom()");
      const countBefore = await count("insurer_beneficiaries", id.insA);
      expect((await send("post", `/imports/${batch}/commit`, tok.admA)).status).toBe(500);
      await pool.query("DROP TRIGGER fail_boom ON insurer_beneficiaries");
      expect(await count("insurer_beneficiaries", id.insA)).toBe(countBefore);
      expect((await send("get", `/imports/${batch}`, tok.admA)).body).toMatchObject({ status: "PREVIEW" });
      expect((await send("post", `/imports/${batch}/commit`, tok.admA)).body).toMatchObject({ importedRows: 5000 });
      expect(await count("insurer_beneficiaries", id.insA)).toBe(countBefore + 5000);

      const xlsxMax = await upload("/imports", tok.admA, buildXlsx([IMPORT_HEADER, ...Array.from({ length: 5000 }, (_v, i) => [`X ${String(i)}`, "BI", `XM${String(i)}`, "1990-01-01", "HOLDER", "", ""])]), "max.xlsx");
      expect(xlsxMax.status).toBe(201);
      expect(xlsxMax.body).toMatchObject({ format: "XLSX", rowCount: 5000, validRows: 5000 });
      const over = await upload("/imports", tok.admA, csv(...lines(5001, "O")), "over.csv", "text/csv");
      expect(over.status).toBe(422);
      expect((await upload("/imports", tok.admA, Buffer.alloc(0), "vazio.csv")).status).toBe(415);
      expect((await upload("/imports", tok.admA, Buffer.from("%PDF-1.4\n%âã\u0000"), "x.pdf", "application/pdf")).status).toBe(415);
      expect((await upload("/imports", tok.admA, Buffer.from("name\nAna"), "x.csv")).status).toBe(422);
      expect((await upload("/imports", tok.admA, Buffer.alloc(10 * 1024 * 1024 + 10, 0x61), "grande.csv")).status).toBe(413);
      expect((await upload("/imports", tok.analystA, csv("A,BI,Z-1,1990-01-01,HOLDER,,"), "a.csv")).status).toBe(403);
      expect((await upload("/imports", tok.admC, csv("A,BI,Z-1,1990-01-01,HOLDER,,"), "a.csv")).status).toBe(404);
    }, 120_000);

    it("DELETE só em PREVIEW (204 → CANCELLED e linhas descartadas); lote de outra seguradora ⇒ 404", async () => {
      const res = await upload("/imports", tok.admA, csv("C Imp,BI,CAN-1,1990-01-01,HOLDER,,"), "c.csv");
      const batch = (res.body as { id: string }).id;
      expect((await send("get", `/imports/${batch}`, tok.admB)).status).toBe(404);
      expect((await send("delete", `/imports/${batch}`, tok.admB)).status).toBe(404);
      expect((await send("post", `/imports/${batch}/commit`, tok.admB)).status).toBe(404);
      expect((await send("delete", `/imports/${batch}`, tok.admA)).status).toBe(204);
      expect((await pool.query("SELECT status::text, rows FROM insurer_import_batches WHERE id=$1", [batch])).rows[0]).toMatchObject({ status: "CANCELLED", rows: null });
      expect((await send("post", `/imports/${batch}/commit`, tok.admA)).status).toBe(409);
      expect((await send("delete", `/imports/${batch}`, tok.admA)).status).toBe(409);
    });
  });

  // ---------------------------------------------------------------- job
  describe("job insurer.expire-policies", () => {
    it("ACTIVE com validTo < hoje ⇒ EXPIRED (só essas); idempotente; auditado como SYSTEM por seguradora (só contagem)", async () => {
      const holderA = await idOf("SELECT id FROM insurer_beneficiaries WHERE insurer_id=$1 AND relationship='HOLDER' LIMIT 1", [id.insA]);
      const holderB = await idOf("SELECT id FROM insurer_beneficiaries WHERE insurer_id=$1 AND relationship='HOLDER' LIMIT 1", [id.insB]);
      const ins = (insurer: string, plan: string, holder: string, number: string, to: string, status: string) =>
        pool.query("INSERT INTO insurer_policies (insurer_id, plan_id, holder_id, number, valid_from, valid_to, status) VALUES ($1,$2,$3,$4,'2020-01-01',$5,$6)", [insurer, plan, holder, number, to, status]);
      await ins(id.insA, id.planA, holderA, "J-OLD", "2026-11-10", "ACTIVE");
      await ins(id.insA, id.planA, holderA, "J-TODAY", "2026-11-11", "ACTIVE"); // ainda vale hoje
      await ins(id.insA, id.planA, holderA, "J-DRAFT", "2026-11-10", "DRAFT");
      await ins(id.insA, id.planA, holderA, "J-SUSP", "2026-11-10", "SUSPENDED");
      await ins(id.insB, id.planB, holderB, "J-OLD-B", "2026-01-01", "ACTIVE");
      const first = await worker.expirePolicies();
      expect(first.expired).toBe(2);
      const states = Object.fromEntries((await pool.query("SELECT number, status::text FROM insurer_policies WHERE number LIKE 'J-%'")).rows.map((r: { number: string; status: string }) => [r.number, r.status]));
      expect(states).toEqual({ "J-OLD": "EXPIRED", "J-TODAY": "ACTIVE", "J-DRAFT": "DRAFT", "J-SUSP": "SUSPENDED", "J-OLD-B": "EXPIRED" });
      expect((await worker.expirePolicies()).expired).toBe(0);
      const audit = (await pool.query("SELECT actor_type::text, metadata FROM audit_logs WHERE request_id='job:insurer.expire-policies' ORDER BY id")).rows as { actor_type: string; metadata: Record<string, unknown> }[];
      expect(audit).toHaveLength(2);
      expect(audit.every((a) => a.actor_type === "SYSTEM")).toBe(true);
      expect(audit.map((a) => a.metadata.insurerId).sort()).toEqual([id.insA, id.insB].sort());
      clock.advance(0);
    });
  });

  // ---------------------------------------------------------------- correções da revisão de segurança (migração 0035)
  describe("revisão de segurança da Fase A", () => {
    const mkBeneficiary = (n: string, status: string, member?: string) =>
      idOf(
        "INSERT INTO insurer_beneficiaries (insurer_id, name, id_document_type, id_document_number, birth_date, card_number, status, family_id, family_member_id) VALUES ($1,'Rev','BI',$2,'1990-01-01',$3,$4,$5,$6) RETURNING id",
        [id.insA, `REV-${n}`, `REV-CARD-${n}`, status, member ? id.family : null, member ?? null],
      );

    it("confirmar pedido de beneficiário CANCELLED ⇒ 409 e nada é ligado (#8)", async () => {
      const member = randomUUID();
      await pool.query("INSERT INTO family_members (id, family_id, name, birth_date, is_dependent) VALUES ($1,$2,'Dep Rev','2015-01-01',true)", [member, id.family]);
      const ben = await mkBeneficiary("8", "CANCELLED");
      const link = await idOf("INSERT INTO insurer_beneficiary_link_requests (insurer_id, beneficiary_id, requested_by, family_id, family_member_id) VALUES ($1,$2,$3,$4,$5) RETURNING id", [id.insA, ben, id.user, id.family, member]);
      expect((await send("post", `/link-requests/${link}/confirm`, tok.admA)).status).toBe(409);
      expect((await pool.query("SELECT family_member_id FROM insurer_beneficiaries WHERE id=$1", [ben])).rows[0]).toMatchObject({ family_member_id: null });
      expect((await pool.query("SELECT status::text FROM insurer_beneficiary_link_requests WHERE id=$1", [link])).rows[0]).toMatchObject({ status: "PENDING" });
    });

    it("apagar o membro desliga o beneficiário e sobe card_version uma vez (invalida QR); desligar já com bump não duplica (#10)", async () => {
      const member = randomUUID();
      await pool.query("INSERT INTO family_members (id, family_id, name, birth_date, is_dependent) VALUES ($1,$2,'Dep Rev 2','2015-01-01',true)", [member, id.family]);
      const ben = await mkBeneficiary("10", "ACTIVE", member);
      await pool.query("DELETE FROM family_members WHERE id=$1", [member]);
      expect((await pool.query("SELECT card_version, family_member_id, family_id FROM insurer_beneficiaries WHERE id=$1", [ben])).rows[0]).toMatchObject({ card_version: 2, family_member_id: null, family_id: null });
      const member2 = randomUUID();
      await pool.query("INSERT INTO family_members (id, family_id, name, birth_date, is_dependent) VALUES ($1,$2,'Dep Rev 3','2015-01-01',true)", [member2, id.family]);
      const ben2 = await mkBeneficiary("10B", "ACTIVE", member2);
      await pool.query("UPDATE insurer_beneficiaries SET family_id=NULL, family_member_id=NULL, card_version=card_version+1 WHERE id=$1", [ben2]); // revogação explícita
      expect((await pool.query("SELECT card_version FROM insurer_beneficiaries WHERE id=$1", [ben2])).rows[0]).toMatchObject({ card_version: 2 });
    });

    it("job insurer.purge-import-previews: PREVIEW com mais de 24 h ⇒ CANCELLED sem linhas; recentes e fechados intactos; idempotente; auditoria só com contagem (#3)", async () => {
      const mk = (status: string, ageH: number, rows: boolean) =>
        idOf("INSERT INTO insurer_import_batches (insurer_id, format, row_count, status, error_report, rows, created_at) VALUES ($1,'CSV',1,$2,'{}'::jsonb,$3::jsonb,$4) RETURNING id", [
          id.insA,
          status,
          rows ? JSON.stringify([{ name: "CANARIO-PURGA" }]) : null,
          new Date(NOW.getTime() - ageH * 3_600_000),
        ]);
      const stale = await mk("PREVIEW", 25, true);
      const fresh = await mk("PREVIEW", 23, true);
      const done = await mk("COMMITTED", 48, false);
      expect((await worker.purgeImportPreviews()).purged).toBeGreaterThanOrEqual(1);
      const state = async (batch: string): Promise<unknown> => (await pool.query("SELECT status::text, rows IS NULL AS no_rows FROM insurer_import_batches WHERE id=$1", [batch])).rows[0] as unknown;
      expect(await state(stale)).toMatchObject({ status: "CANCELLED", no_rows: true });
      expect(await state(fresh)).toMatchObject({ status: "PREVIEW", no_rows: false });
      expect(await state(done)).toMatchObject({ status: "COMMITTED" });
      expect((await worker.purgeImportPreviews()).purged).toBe(0);
      const audit = (await pool.query("SELECT actor_type::text, metadata FROM audit_logs WHERE request_id='job:insurer.purge-import-previews'")).rows as { actor_type: string; metadata: Record<string, unknown> }[];
      expect(audit.length).toBeGreaterThanOrEqual(1);
      expect(audit.every((a) => a.actor_type === "SYSTEM" && a.metadata.insurerId !== undefined)).toBe(true);
      expect(JSON.stringify(audit)).not.toContain("CANARIO-PURGA");
    });
  });

  // ---------------------------------------------------------------- auditoria (BR-SEG-15) e privacidade nos registos
  describe("auditoria INSURER_* (BR-SEG-15)", () => {
    it("ações da Fase A com actor INSURANCE_ACCOUNT e metadata.insurerId; nunca dados pessoais, nº de cartão, documentos ou notas", async () => {
      const rows = (await pool.query("SELECT action, actor_type::text, actor_insurance_account_id, metadata FROM audit_logs WHERE action LIKE 'INSURER\\_%' AND actor_type='INSURANCE_ACCOUNT' ORDER BY id")).rows as {
        action: string;
        actor_insurance_account_id: string | null;
        metadata: { insurerId?: string } | null;
      }[];
      const actions = new Set(rows.map((r) => r.action));
      for (const a of [
        "INSURER_COMPANY_CREATE",
        "INSURER_COMPANY_UPDATE",
        "INSURER_BENEFICIARY_CREATE",
        "INSURER_BENEFICIARY_UPDATE",
        "INSURER_BENEFICIARY_STATUS",
        "INSURER_IMPORT_PREVIEW",
        "INSURER_IMPORT_COMMIT",
        "INSURER_IMPORT_CANCEL",
        "INSURER_LINK_REQUEST",
        "INSURER_LINK_DECIDE",
        "INSURER_POLICY_CREATE",
        "INSURER_POLICY_UPDATE",
        "INSURER_POLICY_STATUS",
      ]) expect(actions, a).toContain(a);
      expect(rows.every((r) => r.actor_insurance_account_id !== null && typeof r.metadata?.insurerId === "string")).toBe(true);
      const all = JSON.stringify((await pool.query("SELECT * FROM audit_logs")).rows);
      for (const secret of ["CANARIO-NOME", "CANARIO-DOC", "CANARIO-EMPRESA", "Titular Novo", "Ana Imp", "documento não confere", "atraso", "VF0", "IMP-1", "NIF-A1"]) expect(all, secret).not.toContain(secret);
      expect(all).not.toMatch(/VF\d{14}/);
      expect(logs.join("\n")).not.toContain("CANARIO");
    });
  });
});
