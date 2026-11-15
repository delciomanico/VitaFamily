// HTTP + PostgreSQL real (testcontainers) dos marcos S2 (mínimo) e S3 (parcial) da Fase A do módulo de seguradoras (ADR-025):
// supertest com express-openapi-validator a validar PEDIDOS e RESPOSTAS (`validateResponses`) contra docs/05-api/openapi.yaml
// (TC-SEG-10). Cobre serviços, planos/versões/coberturas (TC-SEG-02/03), clínicas parceiras e prestadores (TC-SEG-11),
// elegibilidade na clínica (TC-SEG-05/06), matriz de papéis (TC-AZ-SEG-01), isolamento (TC-AZ-SEG-02, FKs compostas),
// tokens/módulo desativado (TC-AZ-SEG-03) e clínica sobre seguradora (TC-AZ-SEG-04), com chaves canário (minimização).
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
import { KyselyClinicsRepository } from "../../src/modules/clinics/infrastructure/repo.js";
import { createClinicActorContextMiddleware, createClinicBearerAuthSecurityHandler } from "../../src/modules/clinics/interface/clinic-portal-middleware.js";
import { FakeInsuranceLogger, FakeInsuranceMailer } from "../../src/modules/insurance/application/fixtures.js";
import type { CachedInsuranceAccountState, InsuranceDeps } from "../../src/modules/insurance/application/ports.js";
import { createResolveInsuranceActorStateUseCase } from "../../src/modules/insurance/application/resolve-insurance-actor-state.js";
import { signInsuranceAccessToken } from "../../src/modules/insurance/domain/insurance-jwt.js";
import { InsuranceInMemoryRateLimiter } from "../../src/modules/insurance/domain/insurance-rate-limiter.js";
import { InsuranceTtlCache } from "../../src/modules/insurance/domain/insurance-ttl-cache.js";
import { KyselyInsuranceAccountRepository, KyselyInsuranceSessionRepository, KyselyInsurersRepository } from "../../src/modules/insurance/infrastructure/repo.js";
import { createInsuranceActorContextMiddleware, createInsuranceBearerAuthSecurityHandler } from "../../src/modules/insurance/interface/insurance-portal-middleware.js";
import { createInsurerSettingsReader } from "../../src/modules/insurance/index.js";
import { createInsurerOpsModule } from "../../src/modules/insurer-ops/index.js";
import { CARD_QR_TTL_SECONDS, signCardQrToken } from "../../src/modules/insurer-ops/domain/card-qr.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const NOW = new Date("2026-11-11T10:00:00.000Z");
const API = "/api/v1";
const PORTAL = `${API}/insurance-portal`;
const CLINIC = `${API}/clinic-portal`;
const KEYS = [{ kid: "k1", secret: new TextEncoder().encode("0123456789abcdef0123456789abcdef") }];
const SESSION = randomUUID();
const CLAIM_SECRET = "segredo-de-teste-dos-codigos";
const NOTICE = "Verificação de cobertura; não constitui garantia de pagamento.";

const id = {
  insA: randomUUID(),
  insB: randomUUID(),
  insC: randomUUID(), // módulo operacional desativado
  insD: randomUUID(), // suspensa
  admA: randomUUID(),
  bmA: randomUUID(),
  agentA: randomUUID(),
  admB: randomUUID(),
  admC: randomUUID(),
  family: randomUUID(),
  user: randomUUID(),
  clinicAlfa: randomUUID(), // PARTNER ativa, com display_name e dados internos (canário)
  clinicBeta: randomUUID(), // PARTNER ativa
  clinicOld: randomUUID(), // PARTNER arquivada
  clinicPrivate: randomUUID(), // PRIVATE
  clinicFree: randomUUID(), // PARTNER nunca ligada
  accAdmin: randomUUID(),
  accManager: randomUUID(),
  accDoctor: randomUUID(),
  accFree: randomUUID(),
  accLimit: randomUUID(),
  accIp: randomUUID(),
  accIp2: randomUUID(),
};

describe("integração HTTP: módulo operacional de seguradoras, S2 mínimo e S3 parcial", () => {
  let container: StartedTestContainer;
  let pool: Pool;
  let db: Kysely<Database>;
  let app: ReturnType<typeof createApp>;
  const clock = new FixedClock(NOW);
  const logs: string[] = [];
  const tok = { admA: "", bmA: "", agentA: "", admB: "", admC: "", user: "", insClinic: "", admin: "", manager: "", doctor: "", free: "", limit: "", ip: "", ip2: "" };

  const insToken = async (accountId: string) => `Bearer ${(await signInsuranceAccessToken({ subject: { insuranceAccountId: accountId, sessionId: SESSION }, now: NOW, ttlSeconds: 900, signingKeys: KEYS })).token}`;
  const clinicToken = async (accountId: string) => `Bearer ${(await signClinicAccessToken({ subject: { clinicAccountId: accountId, sessionId: SESSION }, now: NOW, ttlSeconds: 900, signingKeys: KEYS })).token}`;
  const send = (method: "get" | "post" | "patch" | "put" | "delete", path: string, token: string | undefined, body?: unknown) => {
    let r = request(app)[method](`${PORTAL}${path}`);
    if (token) r = r.set("Authorization", token);
    return body === undefined ? r : r.send(body as object);
  };
  const clinic = (method: "get" | "post", path: string, token: string | undefined, body?: unknown, ip?: string) => {
    let r = request(app)[method](`${CLINIC}${path}`);
    if (token) r = r.set("Authorization", token);
    if (ip) r = r.set("X-Forwarded-For", ip);
    return body === undefined ? r : r.send(body as object);
  };
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- asserção de tipo do corpo de teste
  const body = <T>(res: { body: unknown }): T => res.body as T;
  const col = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows as Record<string, unknown>[];

  let audit: ReturnType<typeof createAuditModule>;

  beforeAll(async () => {
    container = await new GenericContainer("postgres:16-alpine")
      .withEnvironment({ POSTGRES_USER: "vita", POSTGRES_PASSWORD: "vita", POSTGRES_DB: "vita" })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start();
    pool = new Pool({ connectionString: `postgres://vita:vita@${container.getHost()}:${String(container.getMappedPort(5432))}/vita` });
    db = createDb(pool);
    await runMigrations(pool, defaultMigrationsDir());

    await pool.query("INSERT INTO users (id, email, password_hash, name, birth_date, timezone, status, email_verified_at, terms_accepted_version, terms_accepted_at) VALUES ($1,'paciente@vita.pt','h','Paciente','1990-01-01','Europe/Lisbon','ACTIVE',now(),'1',now())", [id.user]);
    await pool.query("INSERT INTO families (id, name) VALUES ($1,'Familia')", [id.family]);
    await pool.query("INSERT INTO insurer_accounts (id, name, tax_id, operational_module_enabled, currency) VALUES ($1,'Seg A','500000001',true,'AOA'), ($2,'Seg B','500000002',true,'USD'), ($3,'Seg C','500000003',false,'AOA'), ($4,'Seg D','500000004',true,'AOA')", [id.insA, id.insB, id.insC, id.insD]);
    await pool.query("UPDATE insurer_accounts SET status='SUSPENDED' WHERE id=$1", [id.insD]);
    const acc = (accountId: string, insurer: string, role: string) => pool.query("INSERT INTO insurance_accounts (id, insurer_id, email, password_hash, role) VALUES ($1,$2,$3,'x',$4)", [accountId, insurer, `${accountId}@seg.pt`, role]);
    await acc(id.admA, id.insA, "INSURANCE_ADMIN");
    await acc(id.bmA, id.insA, "BENEFICIARY_MANAGER");
    await acc(id.agentA, id.insA, "INSURANCE_AGENT");
    await acc(id.admB, id.insB, "INSURANCE_ADMIN");
    await acc(id.admC, id.insC, "INSURANCE_ADMIN");

    // Clínicas: dados internos "canário" que nunca podem chegar à seguradora (BR-SEG-14, ADR-005).
    await pool.query(
      "INSERT INTO clinics (id, type, name, address, phone, email, display_name, description, opening_hours) VALUES ($1,'PARTNER','Clínica Alfa','CANARIO-MORADA','CANARIO-TELEFONE','canario-clinica@x.pt','Alfa Saúde','CANARIO-DESCRICAO','CANARIO-HORARIO')",
      [id.clinicAlfa],
    );
    await pool.query("INSERT INTO clinics (id, type, name) VALUES ($1,'PARTNER','Clínica Beta'), ($2,'PARTNER','Clínica Antiga'), ($3,'PARTNER','Clínica Livre')", [id.clinicBeta, id.clinicOld, id.clinicFree]);
    await pool.query("UPDATE clinics SET status='ARCHIVED' WHERE id=$1", [id.clinicOld]);
    await pool.query("INSERT INTO clinics (id, type, name, family_id) VALUES ($1,'PRIVATE','Clínica Privada',$2)", [id.clinicPrivate, id.family]);
    const cacc = (accountId: string, clinicId: string, role: string) =>
      pool.query("INSERT INTO clinic_accounts (id, clinic_id, email, password_hash, role) VALUES ($1,$2,$3,'x',$4)", [accountId, clinicId, `${accountId}@cli.pt`, role]);
    await cacc(id.accAdmin, id.clinicAlfa, "CLINIC_ADMIN");
    await cacc(id.accManager, id.clinicAlfa, "CLINIC_MANAGER");
    await pool.query("INSERT INTO clinic_professionals (id, clinic_id, name) VALUES ($1,$2,'Dr. Canario')", [id.accDoctor, id.clinicAlfa]);
    await pool.query("INSERT INTO clinic_accounts (id, clinic_id, email, password_hash, role, professional_id) VALUES ($1,$2,$3,'x','CLINIC_DOCTOR',$1)", [id.accDoctor, id.clinicAlfa, `${id.accDoctor}@cli.pt`]);
    await cacc(id.accFree, id.clinicFree, "CLINIC_ADMIN");
    await cacc(id.accLimit, id.clinicAlfa, "CLINIC_MANAGER");
    await cacc(id.accIp, id.clinicAlfa, "CLINIC_MANAGER");
    await cacc(id.accIp2, id.clinicAlfa, "CLINIC_MANAGER");

    audit = createAuditModule({ db, clock });
    const ops = createInsurerOpsModule({
      db,
      audit,
      clock,
      insurers: createInsurerSettingsReader(),
      claimCodeSecret: CLAIM_SECRET,
      partnerClinics: { list: (trx, query) => new KyselyClinicsRepository().listPartnerDirectory(trx, query), find: (trx, clinicId) => new KyselyClinicsRepository().findPartnerDirectoryEntry(trx, clinicId) },
      patientAccess: { authorize: () => Promise.reject(new Error("rotas do paciente não usadas aqui")) },
    });
    for (const [key, account] of [["admA", id.admA], ["bmA", id.bmA], ["agentA", id.agentA], ["admB", id.admB], ["admC", id.admC]] as const) tok[key] = await insToken(account);
    for (const [key, account] of [["admin", id.accAdmin], ["manager", id.accManager], ["doctor", id.accDoctor], ["free", id.accFree], ["limit", id.accLimit], ["ip", id.accIp], ["ip2", id.accIp2]] as const) tok[key] = await clinicToken(account);
    tok.user = `Bearer ${(await signAccessToken({ subject: { userId: id.user, sessionId: SESSION }, now: NOW, ttlSeconds: 900, signingKeys: KEYS })).token}`;
    tok.insClinic = tok.admA;

    const d: InsuranceDeps<Kysely<Database>> = {
      insurersRepo: new KyselyInsurersRepository(),
      insuranceAccountRepo: new KyselyInsuranceAccountRepository(),
      insuranceSessionRepo: new KyselyInsuranceSessionRepository(),
      audit,
      db,
      withTransaction: (fn) => withTransaction(db, fn),
      clock,
      insuranceMailer: new FakeInsuranceMailer(),
      logger: new FakeInsuranceLogger() as unknown as Logger,
      insuranceRateLimiter: new InsuranceInMemoryRateLimiter(clock),
      insuranceSigningKeys: KEYS,
      insuranceAccessTtlSeconds: 900,
      insuranceRefreshTtlMs: 30 * 24 * 60 * 60 * 1000,
      accountStateCache: new InsuranceTtlCache<CachedInsuranceAccountState>(clock, 60_000),
      operationalData: ops.operationalData,
    };
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
      resolveClinicActorState: async (clinicAccountId, sessionId) => {
        const row = (await col("SELECT clinic_id, role, professional_id, status FROM clinic_accounts WHERE id=$1", [clinicAccountId]))[0] as { clinic_id: string; role: "CLINIC_ADMIN" | "CLINIC_MANAGER" | "CLINIC_DOCTOR"; professional_id: string | null; status: string };
        return { clinicAccountId, sessionId, clinicId: row.clinic_id, role: row.role, ...(row.professional_id ? { professionalId: row.professional_id } : {}), suspended: row.status !== "ACTIVE" };
      },
    });
    const insuranceActor = createInsuranceActorContextMiddleware({ resolveInsuranceActorState: createResolveInsuranceActorStateUseCase(d) });
    const logDestination = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        logs.push(chunk.toString());
        callback();
      },
    });
    app = createApp({
      openApiSpecPath: openApiSpecPath(REPO_ROOT),
      logger: createLogger({ level: "debug", destination: logDestination }),
      validateResponses: true,
      securityHandlers: {
        bearerAuth: createBearerAuthSecurityHandler({ signingKeys: KEYS, clock }),
        clinicBearerAuth: createClinicBearerAuthSecurityHandler({ signingKeys: KEYS, clock }),
        insuranceBearerAuth: createInsuranceBearerAuthSecurityHandler({ signingKeys: KEYS, clock }),
      },
      actorContextMiddleware: (req: Request, res: Response, next: NextFunction) => {
        userActor(req, res, (e1?: unknown) => {
          if (e1) {
            next(e1);
            return;
          }
          clinicActor(req, res, (e2?: unknown) => {
            if (e2) {
              next(e2);
              return;
            }
            insuranceActor(req, res, next);
          });
        });
      },
      registerHealthRoutes: (router) => {
        router.get("/health", (_req, res) => res.json({ status: "ok" }));
      },
      registerRoutes: (router) => {
        router.use(ops.router);
        router.get("/users/me", (_req, res) => res.json({}));
      },
    });
  }, 180_000);

  afterAll(async () => {
    await pool.end();
    await container.stop();
  });

  const svc = { a1: "", a2: "", a3: "", a4: "", b1: "" };
  const plan = { v1: "", v2: "", b: "" };

  // ---------------------------------------------------------------- serviços (BR-SEG-22)
  describe("serviços", () => {
    it("criar (só INSURANCE_ADMIN), código duplicado ⇒ 409, lista por seguradora (mesmo código noutra seguradora é permitido)", async () => {
      const a1 = await send("post", "/services", tok.admA, { code: "CONS", name: "Consulta", category: "Consultas" });
      expect(a1.status).toBe(201);
      expect(a1.body).toMatchObject({ code: "CONS", name: "Consulta", category: "Consultas", status: "ACTIVE" });
      svc.a1 = body<{ id: string }>(a1).id;
      svc.a2 = body<{ id: string }>(await send("post", "/services", tok.admA, { code: "RX", name: "Raio-X" })).id;
      svc.a3 = body<{ id: string }>(await send("post", "/services", tok.admA, { code: "ANAL", name: "Análises", category: "Exames" })).id;
      svc.a4 = body<{ id: string }>(await send("post", "/services", tok.admA, { code: "FISIO", name: "Fisioterapia" })).id;
      expect((await send("post", "/services", tok.admA, { code: "CONS", name: "Outra" })).status).toBe(409);
      expect((await send("post", "/services", tok.bmA, { code: "NOVO", name: "x" })).status).toBe(403);
      expect((await send("post", "/services", tok.admA, { code: "", name: "x" })).status).toBe(422);
      const b1 = await send("post", "/services", tok.admB, { code: "CONS", name: "Consulta B" });
      expect(b1.status).toBe(201);
      svc.b1 = body<{ id: string }>(b1).id;
    });

    it("lista: papéis de leitura, filtros q/status, paginação estável, só linhas próprias", async () => {
      expect((await send("get", "/services", tok.bmA)).status).toBe(200);
      expect(body<{ items: { id: string }[] }>(await send("get", "/services?q=raio", tok.admA)).items.map((s) => s.id)).toEqual([svc.a2]);
      expect(body<{ items: { id: string }[] }>(await send("get", "/services?q=ANAL", tok.admA)).items.map((s) => s.id)).toEqual([svc.a3]);
      const seen: string[] = [];
      let cursor: string | null = null;
      for (let i = 0; i < 6; i++) {
        const res = await send("get", `/services?limit=1${cursor ? `&cursor=${cursor}` : ""}`, tok.admA);
        seen.push(...body<{ items: { id: string }[] }>(res).items.map((s) => s.id));
        cursor = body<{ nextCursor: string | null }>(res).nextCursor;
        if (!cursor) break;
      }
      expect([...seen].sort()).toEqual([svc.a1, svc.a2, svc.a3, svc.a4].sort());
      expect(seen).not.toContain(svc.b1);
      expect((await send("get", "/services?status=XPTO", tok.admA)).status).toBe(422);
    });

    it("PATCH: nome/categoria/estado; o código não se altera; outra seguradora ⇒ 404; BENEFICIARY_MANAGER ⇒ 403", async () => {
      expect((await send("patch", `/services/${svc.a4}`, tok.admA, { name: "Fisio", category: null, status: "INACTIVE" })).body).toMatchObject({ code: "FISIO", name: "Fisio", category: null, status: "INACTIVE" });
      expect((await send("get", "/services?status=INACTIVE", tok.admA)).body).toMatchObject({ items: [{ id: svc.a4 }] });
      expect((await send("patch", `/services/${svc.a1}`, tok.bmA, { name: "x" })).status).toBe(403);
      const cross = await send("patch", `/services/${svc.a1}`, tok.admB, { name: "Hack" });
      expect(cross.status).toBe(404);
      expect(cross.body).toMatchObject({ code: "NOT_FOUND" });
      expect((await col("SELECT name FROM insurer_services WHERE id=$1", [svc.a1]))[0]).toMatchObject({ name: "Consulta" });
    });
  });

  // ---------------------------------------------------------------- planos, versões e coberturas (TC-SEG-02/03)
  describe("planos, versões e coberturas", () => {
    it("criar plano (v1 DRAFT); nome duplicado ⇒ 409; só INSURANCE_ADMIN escreve, qualquer papel lê", async () => {
      const p = await send("post", "/plans", tok.admA, { name: "Plano Ouro" });
      expect(p.status).toBe(201);
      expect(p.body).toMatchObject({ name: "Plano Ouro", version: 1, status: "DRAFT", coverageCount: 0 });
      plan.v1 = body<{ id: string }>(p).id;
      expect((await send("post", "/plans", tok.admA, { name: "Plano Ouro" })).status).toBe(409);
      expect((await send("post", "/plans", tok.bmA, { name: "Plano X" })).status).toBe(403);
      plan.b = body<{ id: string }>(await send("post", "/plans", tok.admB, { name: "Plano Ouro" })).id; // mesmo nome noutra seguradora
      expect((await send("get", `/plans/${plan.v1}`, tok.bmA)).status).toBe(200);
      expect((await send("get", `/plans/${plan.v1}`, tok.agentA)).status).toBe(403);
    });

    it("ativar sem cobertura ⇒ 409; transições inválidas ⇒ INVALID_STATE_TRANSITION", async () => {
      expect((await send("post", `/plans/${plan.v1}/status`, tok.admA, { status: "ACTIVE" })).status).toBe(409);
      expect((await send("post", `/plans/${plan.v1}/status`, tok.admA, { status: "ARCHIVED" })).body).toMatchObject({ code: "INVALID_STATE_TRANSITION" });
      expect((await send("post", `/plans/${plan.v1}/status`, tok.admA, { status: "DRAFT" })).status).toBe(422);
      expect((await send("post", `/plans/${plan.v1}/status`, tok.bmA, { status: "ACTIVE" })).status).toBe(403);
    });

    it("PUT coverages: mapeamento covered/limitPerYear → coverage_type, copayPct, carência; substitui o conjunto inteiro", async () => {
      const put = await send("put", `/plans/${plan.v1}/coverages`, tok.admA, {
        items: [
          { serviceId: svc.a1, covered: true, copayPct: 80, waitingDays: 30, requiresAuthorization: false },
          { serviceId: svc.a2, covered: true, copayPct: 100, limitPerYear: 150000.5, requiresAuthorization: true },
          { serviceId: svc.a3, covered: false },
          { serviceId: svc.a4, covered: true },
        ],
      });
      expect(put.status).toBe(200);
      const items = body<{ serviceId: string; serviceCode: string; covered: boolean; copayPct: number; limitPerYear: number | null; waitingDays: number; requiresAuthorization: boolean }[]>(put);
      expect(items.map((i) => i.serviceCode)).toEqual(["ANAL", "CONS", "FISIO", "RX"]);
      expect(items.find((i) => i.serviceCode === "CONS")).toMatchObject({ covered: true, copayPct: 80, limitPerYear: null, waitingDays: 30, requiresAuthorization: false });
      expect(items.find((i) => i.serviceCode === "RX")).toMatchObject({ covered: true, copayPct: 100, limitPerYear: 150000.5, requiresAuthorization: true });
      expect(items.find((i) => i.serviceCode === "ANAL")).toMatchObject({ covered: false });
      const types = Object.fromEntries((await col("SELECT s.code, c.type::text AS type FROM insurer_plan_coverages c JOIN insurer_services s ON s.id=c.service_id WHERE c.plan_id=$1", [plan.v1])).map((r) => [r.code as string, r.type as string]));
      expect(types).toEqual({ CONS: "INCLUDED", RX: "LIMITED", ANAL: "EXCLUDED", FISIO: "INCLUDED" });
      expect((await send("get", `/plans/${plan.v1}`, tok.bmA)).body).toMatchObject({ coverageCount: 4 });
      expect((await send("get", `/plans/${plan.v1}/coverages`, tok.bmA)).body).toHaveLength(4);
      // substitui: só um item
      expect((await send("put", `/plans/${plan.v1}/coverages`, tok.admA, { items: [{ serviceId: svc.a1, covered: true, copayPct: 80, waitingDays: 30 }, { serviceId: svc.a2, covered: true, limitPerYear: 150000.5, requiresAuthorization: true }, { serviceId: svc.a3, covered: false }] })).body).toHaveLength(3);
      expect(await col("SELECT 1 FROM insurer_plan_coverages WHERE plan_id=$1", [plan.v1])).toHaveLength(3);
    });

    it("PUT coverages: validações (422), serviço de outra seguradora ⇒ 422 sem efeito, papel ⇒ 403", async () => {
      const before = await col("SELECT service_id FROM insurer_plan_coverages WHERE plan_id=$1 ORDER BY service_id", [plan.v1]);
      const put = (items: unknown[], token = tok.admA) => send("put", `/plans/${plan.v1}/coverages`, token, { items });
      expect((await put([{ serviceId: svc.a1, covered: true, copayPct: 101 }])).status).toBe(422);
      expect((await put([{ serviceId: svc.a1, covered: true, copayPct: -1 }])).status).toBe(422);
      expect((await put([{ serviceId: svc.a1, covered: true, limitPerYear: -5 }])).status).toBe(422);
      expect((await put([{ serviceId: svc.a1, covered: true, waitingDays: -1 }])).status).toBe(422);
      expect((await put([{ serviceId: svc.a1, covered: true }, { serviceId: svc.a1, covered: false }])).status).toBe(422);
      expect((await put([{ serviceId: svc.b1, covered: true }])).body).toMatchObject({ code: "VALIDATION_ERROR" }); // serviço da seguradora B
      expect((await put([{ serviceId: randomUUID(), covered: true }])).status).toBe(422);
      expect((await put([{ serviceId: svc.a1, covered: true }], tok.bmA)).status).toBe(403);
      expect(await col("SELECT service_id FROM insurer_plan_coverages WHERE plan_id=$1 ORDER BY service_id", [plan.v1])).toEqual(before);
    });

    it("ativar com cobertura; PUT em plano ACTIVE ⇒ 409 (imutável); nova versão só de ACTIVE, copia coberturas, uma só DRAFT", async () => {
      expect((await send("post", `/plans/${plan.v1}/new-version`, tok.admA)).status).toBe(409); // DRAFT
      expect((await send("post", `/plans/${plan.v1}/status`, tok.admA, { status: "ACTIVE" })).body).toMatchObject({ status: "ACTIVE", coverageCount: 3 });
      expect((await send("put", `/plans/${plan.v1}/coverages`, tok.admA, { items: [{ serviceId: svc.a1, covered: true }] })).status).toBe(409);
      expect(await col("SELECT 1 FROM insurer_plan_coverages WHERE plan_id=$1", [plan.v1])).toHaveLength(3);
      const v2 = await send("post", `/plans/${plan.v1}/new-version`, tok.admA);
      expect(v2.status).toBe(201);
      expect(v2.body).toMatchObject({ name: "Plano Ouro", version: 2, status: "DRAFT", coverageCount: 3 });
      plan.v2 = body<{ id: string }>(v2).id;
      expect((await send("post", `/plans/${plan.v1}/new-version`, tok.admA)).status).toBe(409); // já existe DRAFT
      expect((await send("post", `/plans/${plan.v2}/new-version`, tok.admA)).status).toBe(409); // origem DRAFT
      expect((await send("post", `/plans/${plan.v1}/new-version`, tok.bmA)).status).toBe(403);
      // a versão nova edita-se; a antiga mantém-se intacta
      expect((await send("put", `/plans/${plan.v2}/coverages`, tok.admA, { items: [{ serviceId: svc.a1, covered: true, copayPct: 90 }] })).body).toHaveLength(1);
      expect(await col("SELECT 1 FROM insurer_plan_coverages WHERE plan_id=$1", [plan.v1])).toHaveLength(3);
      expect((await send("get", "/plans?status=DRAFT", tok.admA)).body).toMatchObject({ items: [{ id: plan.v2, version: 2 }] });
      expect(body<{ items: { version: number }[] }>(await send("get", "/plans?name=ouro", tok.admA)).items.map((p) => p.version).sort()).toEqual([1, 2]);
    });

    it("plano com apólice ATIVA é imutável (BR-SEG-01): sem ativar de novo, sem editar coberturas; ARCHIVED deixa de aceitar apólices", async () => {
      // v2 passa a ACTIVE e v1 é arquivado; as apólices ativas de v1 mantêm o plano v1 (imutável).
      expect((await send("post", `/plans/${plan.v2}/status`, tok.admA, { status: "ACTIVE" })).body).toMatchObject({ status: "ACTIVE" });
      expect((await send("put", `/plans/${plan.v2}/coverages`, tok.admA, { items: [] })).status).toBe(409);
      expect((await send("post", `/plans/${plan.v1}/status`, tok.admA, { status: "ARCHIVED" })).body).toMatchObject({ status: "ARCHIVED" });
      expect((await send("post", `/plans/${plan.v1}/status`, tok.admA, { status: "ACTIVE" })).body).toMatchObject({ code: "INVALID_STATE_TRANSITION" });
      const holder = body<{ id: string }>(await send("post", "/beneficiaries", tok.admA, { name: "H", idDocumentType: "BI", idDocumentNumber: "ARQ-1", birthDate: "1980-01-01", relationship: "HOLDER" }));
      const policy = await send("post", "/policies", tok.admA, { planId: plan.v1, holderId: holder.id, number: "ARQ-P1", validFrom: "2026-01-01", validTo: "2026-12-31" });
      expect(policy.status).toBe(422); // plano arquivado não aceita apólices novas
      // para o resto dos testes volta a existir uma versão ativa com 3 coberturas: reativa-se via nova versão a partir de v2 (1 cobertura)
    });

    it("isolamento (TC-AZ-SEG-02): plano/serviço/cobertura de outra seguradora ⇒ 404 ou 422; listas só próprias; FK composta na BD", async () => {
      for (const [method, path, payload] of [
        ["get", `/plans/${plan.v1}`, undefined],
        ["post", `/plans/${plan.v1}/status`, { status: "ARCHIVED" }],
        ["post", `/plans/${plan.v1}/new-version`, undefined],
        ["get", `/plans/${plan.v1}/coverages`, undefined],
        ["put", `/plans/${plan.v1}/coverages`, { items: [] }],
      ] as const) {
        const res = await send(method, path, tok.admB, payload);
        expect(res.status, `${method} ${path}`).toBe(404);
      }
      const listB = body<{ items: { id: string }[] }>(await send("get", "/plans", tok.admB)).items.map((p) => p.id);
      expect(listB).toEqual([plan.b]);
      expect(body<{ items: { id: string }[] }>(await send("get", "/services", tok.admB)).items.map((s) => s.id)).toEqual([svc.b1]);
      // A BD rejeita a cobertura que cruza seguradoras (plano de A, serviço de B) e o prestador de uma seguradora com clínica inexistente.
      await expect(pool.query("INSERT INTO insurer_plan_coverages (insurer_id, plan_id, service_id, type) VALUES ($1,$2,$3,'INCLUDED')", [id.insA, plan.v1, svc.b1])).rejects.toMatchObject({ code: "23503" });
      await expect(pool.query("INSERT INTO insurer_plan_coverages (insurer_id, plan_id, service_id, type) VALUES ($1,$2,$3,'INCLUDED')", [id.insB, plan.v1, svc.b1])).rejects.toMatchObject({ code: "23503" });
      await expect(pool.query("INSERT INTO insurer_plan_coverages (insurer_id, plan_id, service_id, type, limit_per_year) VALUES ($1,$2,$3,'INCLUDED',5)", [id.insA, plan.v2, svc.a2])).rejects.toMatchObject({ code: "23514" });
    });

    it("auditoria: eventos de serviços/planos/coberturas sem dados pessoais; só ids, enums e contagens", async () => {
      const rows = await col("SELECT action, actor_type::text AS actor_type, metadata FROM audit_logs WHERE action LIKE 'INSURER_SERVICE%' OR action LIKE 'INSURER_PLAN%' OR action='INSURER_COVERAGE_UPDATE'");
      const actions = new Set(rows.map((r) => r.action));
      for (const a of ["INSURER_SERVICE_CREATE", "INSURER_SERVICE_UPDATE", "INSURER_PLAN_CREATE", "INSURER_PLAN_STATUS", "INSURER_PLAN_NEW_VERSION", "INSURER_COVERAGE_UPDATE"]) expect(actions.has(a), a).toBe(true);
      for (const r of rows) {
        expect(r.actor_type).toBe("INSURANCE_ACCOUNT");
        expect(r.metadata).toHaveProperty("insurerId");
      }
      expect(JSON.stringify(rows)).not.toMatch(/Consulta|Raio|Plano Ouro/);
    });
  });

  // ---------------------------------------------------------------- clínicas parceiras e prestadores (TC-SEG-11)
  describe("clínicas parceiras e prestadores", () => {
    it("partner-clinics: só INSURANCE_ADMIN; só PARTNER+ACTIVE; `id` e `name` apenas (display_name ?? name); sem dados internos", async () => {
      expect((await send("get", "/partner-clinics", tok.bmA)).status).toBe(403);
      expect((await send("get", "/partner-clinics", tok.agentA)).status).toBe(403);
      expect((await send("get", "/partner-clinics", tok.admC)).status).toBe(404); // módulo desativado
      expect((await send("get", "/partner-clinics", undefined)).status).toBe(401);
      const res = await send("get", "/partner-clinics", tok.admA);
      expect(res.status).toBe(200);
      const items = body<{ items: { id: string; name: string }[] }>(res).items;
      expect(items.map((i) => i.name)).toEqual(["Alfa Saúde", "Clínica Beta", "Clínica Livre"]); // ordenadas; sem arquivada nem privada
      for (const item of items) expect(Object.keys(item).sort()).toEqual(["id", "name"]);
      expect(items.map((i) => i.id)).not.toContain(id.clinicOld);
      expect(items.map((i) => i.id)).not.toContain(id.clinicPrivate);
      for (const canary of ["CANARIO", "canario", "Clínica Alfa", "family", "phone", "address", "email", "openingHours", "displayName", "description", "slot"]) expect(res.text).not.toContain(canary);
    });

    it("partner-clinics: `q` filtra por nome, paginação estável por nome, cursor inválido ⇒ 422, `q` fora dos logs e da auditoria", async () => {
      expect(body<{ items: { name: string }[] }>(await send("get", "/partner-clinics?q=beta", tok.admA)).items.map((i) => i.name)).toEqual(["Clínica Beta"]);
      expect(body<{ items: { name: string }[] }>(await send("get", "/partner-clinics?q=alfa", tok.admA)).items.map((i) => i.name)).toEqual(["Alfa Saúde"]);
      expect(body<{ items: unknown[] }>(await send("get", "/partner-clinics?q=nada-assim", tok.admA)).items).toEqual([]);
      const seen: string[] = [];
      let cursor: string | null = null;
      for (let i = 0; i < 5; i++) {
        const res = await send("get", `/partner-clinics?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, tok.admA);
        expect(res.status).toBe(200);
        seen.push(...body<{ items: { name: string }[] }>(res).items.map((x) => x.name));
        cursor = body<{ nextCursor: string | null }>(res).nextCursor;
        if (!cursor) break;
      }
      expect(seen).toEqual(["Alfa Saúde", "Clínica Beta", "Clínica Livre"]);
      expect((await send("get", "/partner-clinics?cursor=lixo", tok.admA)).status).toBe(422);
      expect(logs.join("")).not.toContain("nada-assim");
      expect(JSON.stringify(await col("SELECT metadata FROM audit_logs WHERE metadata::text LIKE '%nada-assim%'"))).toBe("[]");
    });

    it("providers: ligar clínica parceira ativa; já ligada ⇒ 409; inexistente/privada/arquivada ⇒ o MESMO 404; só INSURANCE_ADMIN escreve", async () => {
      expect((await send("post", "/providers", tok.bmA, { clinicId: id.clinicAlfa })).status).toBe(403);
      const ok = await send("post", "/providers", tok.admA, { clinicId: id.clinicAlfa });
      expect(ok.status).toBe(201);
      expect(ok.body).toMatchObject({ clinicId: id.clinicAlfa, name: "Alfa Saúde", status: "ACTIVE" });
      expect((await send("post", "/providers", tok.admA, { clinicId: id.clinicAlfa })).status).toBe(409);
      const errs = [randomUUID(), id.clinicPrivate, id.clinicOld].map(async (clinicId) => send("post", "/providers", tok.admA, { clinicId }));
      const [missing, priv, archived] = await Promise.all(errs);
      for (const res of [missing, priv, archived]) {
        expect(res?.status).toBe(404);
        expect(res?.body).toMatchObject({ code: "NOT_FOUND", detail: "Recurso não encontrado." });
      }
      expect((await send("post", "/providers", tok.admA, { clinicId: "nao-uuid" })).status).toBe(422);
      expect(await col("SELECT 1 FROM insurer_providers WHERE insurer_id=$1", [id.insA])).toHaveLength(1);
      // a mesma clínica pode ligar-se à seguradora B (a ligação de A é invisível a B)
      expect((await send("post", "/providers", tok.admB, { clinicId: id.clinicAlfa })).status).toBe(201);
    });

    it("providers: lista só com ligações próprias; estado ACTIVE⇄SUSPENDED; isolamento de ids (404)", async () => {
      const list = await send("get", "/providers", tok.bmA);
      expect(list.status).toBe(200);
      expect(body<{ items: { clinicId: string }[] }>(list).items).toMatchObject([{ clinicId: id.clinicAlfa }]);
      const listB = body<{ items: { id: string }[] }>(await send("get", "/providers", tok.admB)).items;
      const providerA = body<{ items: { id: string }[] }>(list).items[0]?.id ?? "";
      expect(listB.map((p) => p.id)).not.toContain(providerA);
      expect((await send("post", `/providers/${providerA}/status`, tok.admB, { status: "SUSPENDED" })).status).toBe(404);
      expect((await send("post", `/providers/${providerA}/status`, tok.bmA, { status: "SUSPENDED" })).status).toBe(403);
      expect((await send("post", `/providers/${providerA}/status`, tok.admA, { status: "ACTIVE_X" })).status).toBe(422);
      expect((await send("post", `/providers/${providerA}/status`, tok.admA, { status: "SUSPENDED" })).body).toMatchObject({ status: "SUSPENDED" });
      expect(body<{ items: unknown[] }>(await send("get", "/providers?status=ACTIVE", tok.admA)).items).toHaveLength(0);
      expect((await send("post", `/providers/${providerA}/status`, tok.admA, { status: "ACTIVE" })).body).toMatchObject({ status: "ACTIVE" });
      expect((await col("SELECT action FROM audit_logs WHERE action LIKE 'INSURER_PROVIDER%' ORDER BY id")).map((r) => r.action)).toEqual(expect.arrayContaining(["INSURER_PROVIDER_CREATE", "INSURER_PROVIDER_STATUS"]));
    });
  });

  // ---------------------------------------------------------------- matriz de papéis e tokens (TC-AZ-SEG-01/03)
  describe("autorização das rotas novas", () => {
    const u = randomUUID();
    const routes: [string, string, object | undefined, "admin" | "read"][] = [
      ["get", "/services", undefined, "read"],
      ["post", "/services", { code: "M1", name: "m" }, "admin"],
      ["patch", `/services/${u}`, { name: "n" }, "admin"],
      ["get", "/plans", undefined, "read"],
      ["post", "/plans", { name: "Plano Matriz" }, "admin"],
      ["get", `/plans/${u}`, undefined, "read"],
      ["post", `/plans/${u}/status`, { status: "ACTIVE" }, "admin"],
      ["post", `/plans/${u}/new-version`, undefined, "admin"],
      ["get", `/plans/${u}/coverages`, undefined, "read"],
      ["put", `/plans/${u}/coverages`, { items: [] }, "admin"],
      ["get", "/partner-clinics", undefined, "admin"],
      ["get", "/providers", undefined, "read"],
      ["post", "/providers", { clinicId: u }, "admin"],
      ["post", `/providers/${u}/status`, { status: "SUSPENDED" }, "admin"],
    ];
    const matrix = routes.flatMap(([method, path, payload, level]) => [
      ["admA", method, path, payload, true],
      ["bmA", method, path, payload, level === "read"],
      ["agentA", method, path, payload, false],
    ] as const);
    it.each(matrix)("%s %s %s ⇒ permitido=%s", async (role, method, path, payload, allowed) => {
      const res = await send(method as "get", path, tok[role], payload);
      if (allowed) expect([401, 403], `${role} ${method} ${path}`).not.toContain(res.status);
      else expect(res.status, `${role} ${method} ${path}`).toBe(403);
    });
    it.each(routes.map(([method, path, payload]) => [method, path, payload] as const))("módulo desativado ⇒ 404 em %s %s", async (method, path, payload) => {
      expect((await send(method as "get", path, tok.admC, payload)).status).toBe(404);
    });
    it("tokens distintos: User, clínica e ausência de token ⇒ 401 em /insurance-portal; token da seguradora ⇒ 401 em /clinic-portal", async () => {
      for (const token of [tok.user, tok.admin, undefined]) {
        expect((await send("get", "/services", token)).status).toBe(401);
        expect((await send("get", "/partner-clinics", token)).status).toBe(401);
        expect((await send("get", "/providers", token)).status).toBe(401);
      }
      expect((await clinic("get", "/insurers", tok.admA)).status).toBe(401);
      expect((await clinic("get", "/insurers", tok.user)).status).toBe(401);
      expect((await clinic("get", "/insurers", undefined)).status).toBe(401);
      expect((await clinic("post", `/insurers/${id.insA}/eligibility`, tok.admA, { cardNumber: "x" })).status).toBe(401);
    });
  });

  // ---------------------------------------------------------------- portal da clínica: lista, serviços, elegibilidade
  describe("portal da clínica sobre a seguradora (TC-AZ-SEG-04, TC-SEG-05/06)", () => {
    const ben: Record<string, { id: string; card: string }> = {};
    let activePlan = "";
    const CANARY = { name: "CANARIO-NOME-TITULAR", doc: "CANARIO-DOC-9", docDep: "CANARIO-DOC-DEP" };

    const makeBeneficiary = async (key: string, over: Record<string, unknown>, status?: string) => {
      const res = await send("post", "/beneficiaries", tok.admA, { name: "Beneficiario", idDocumentType: "BI", birthDate: "1980-01-01", relationship: "HOLDER", ...over });
      expect(res.status, key).toBe(201);
      const created = body<{ id: string; cardNumber: string }>(res);
      ben[key] = { id: created.id, card: created.cardNumber };
      if (status) expect((await send("post", `/beneficiaries/${created.id}/status`, tok.admA, status === "ACTIVE" ? { status } : { status, note: "n" })).status, key).toBe(200);
      return ben[key];
    };
    const makePolicy = async (holderId: string, number: string, validFrom: string, validTo: string, status: "ACTIVE" | "SUSPENDED" | null) => {
      const res = await send("post", "/policies", tok.admA, { planId: activePlan, holderId, number, validFrom, validTo });
      expect(res.status, number).toBe(201);
      const policyId = body<{ id: string }>(res).id;
      if (status) expect((await send("post", `/policies/${policyId}/status`, tok.admA, { status })).status, number).toBe(200);
      return policyId;
    };
    const check = (payload: object, token = tok.admin, ip?: string) => clinic("post", `/insurers/${id.insA}/eligibility`, token, payload, ip);

    it("preparação: plano ativo com coberturas, titular + dependente com apólice ACTIVE vigente", async () => {
      // v2 (ACTIVE, 1 cobertura) já existe; cria-se um plano novo "Plano Prata" mais completo para a elegibilidade.
      activePlan = body<{ id: string }>(await send("post", "/plans", tok.admA, { name: "Plano Prata" })).id;
      expect((await send("put", `/plans/${activePlan}/coverages`, tok.admA, {
        items: [
          { serviceId: svc.a1, covered: true, copayPct: 80, waitingDays: 30 },
          { serviceId: svc.a2, covered: true, copayPct: 100, limitPerYear: 150000.5, requiresAuthorization: true },
          { serviceId: svc.a3, covered: false },
          { serviceId: svc.a4, covered: true },
        ],
      })).status).toBe(200);
      expect((await send("post", `/plans/${activePlan}/status`, tok.admA, { status: "ACTIVE" })).status).toBe(200);
      const holder = await makeBeneficiary("holder", { name: CANARY.name, idDocumentNumber: CANARY.doc }, "ACTIVE");
      await makeBeneficiary("dep", { name: "Dep", idDocumentNumber: CANARY.docDep, relationship: "CHILD", holderId: holder.id }, "ACTIVE");
      await makePolicy(holder.id, "POL-1", "2026-11-01", "2027-10-31", "ACTIVE");
      // não elegíveis: beneficiário PENDING, SUSPENDED, apólice SUSPENDED, apólice fora de datas, sem apólice
      const pending = await makeBeneficiary("pending", { idDocumentNumber: "NE-1" });
      await makePolicy(pending.id, "POL-PEND", "2026-01-01", "2027-12-31", "ACTIVE");
      const susp = await makeBeneficiary("suspended", { idDocumentNumber: "NE-2" }, "ACTIVE");
      await makePolicy(susp.id, "POL-BSUSP", "2026-01-01", "2027-12-31", "ACTIVE");
      expect((await send("post", `/beneficiaries/${susp.id}/status`, tok.admA, { status: "SUSPENDED", note: "x" })).status).toBe(200);
      const psusp = await makeBeneficiary("policySuspended", { idDocumentNumber: "NE-3" }, "ACTIVE");
      await makePolicy(psusp.id, "POL-PSUSP", "2026-01-01", "2027-12-31", "ACTIVE");
      await pool.query("UPDATE insurer_policies SET status='SUSPENDED' WHERE number='POL-PSUSP'");
      const old = await makeBeneficiary("old", { idDocumentNumber: "NE-4" }, "ACTIVE");
      await makePolicy(old.id, "POL-OLD", "2025-01-01", "2026-11-10", "ACTIVE");
      const future = await makeBeneficiary("future", { idDocumentNumber: "NE-5" }, "ACTIVE");
      await makePolicy(future.id, "POL-FUT", "2026-11-12", "2027-12-31", "ACTIVE");
      await makeBeneficiary("noPolicy", { idDocumentNumber: "NE-6" }, "ACTIVE");
      const cancelled = await makeBeneficiary("cancelled", { idDocumentNumber: "NE-7" }, "ACTIVE");
      await makePolicy(cancelled.id, "POL-CANC", "2026-01-01", "2027-12-31", "ACTIVE");
      expect((await send("post", `/beneficiaries/${cancelled.id}/status`, tok.admA, { status: "CANCELLED", note: "x" })).status).toBe(200);
      // beneficiário elegível da seguradora B (cartão de outra seguradora)
      const planB = body<{ id: string }>(await send("post", "/plans", tok.admB, { name: "Plano B2" })).id;
      const svcB = body<{ id: string }>(await send("post", "/services", tok.admB, { code: "B-X", name: "Bx" })).id;
      await send("put", `/plans/${planB}/coverages`, tok.admB, { items: [{ serviceId: svcB, covered: true }] });
      await send("post", `/plans/${planB}/status`, tok.admB, { status: "ACTIVE" });
      const hb = body<{ id: string; cardNumber: string }>(await send("post", "/beneficiaries", tok.admB, { name: "Tit B", idDocumentType: "BI", idDocumentNumber: "B-DOC", birthDate: "1980-01-01", relationship: "HOLDER" }));
      await send("post", `/beneficiaries/${hb.id}/status`, tok.admB, { status: "ACTIVE" });
      await send("post", "/policies", tok.admB, { planId: planB, holderId: hb.id, number: "POL-B", validFrom: "2026-01-01", validTo: "2027-12-31" }).then(async (r) => send("post", `/policies/${body<{ id: string }>(r).id}/status`, tok.admB, { status: "ACTIVE" }));
      ben.otherInsurer = { id: hb.id, card: hb.cardNumber };
    });

    it("GET /clinic-portal/insurers: só seguradoras ligadas (ativas) e com módulo ativo; Admin e Gestor; Médico ⇒ 403; sem ligação ⇒ lista vazia", async () => {
      const admin = await clinic("get", "/insurers", tok.admin);
      expect(admin.status).toBe(200);
      expect(admin.body).toEqual([{ id: id.insA, name: "Seg A", currency: "AOA" }, { id: id.insB, name: "Seg B", currency: "USD" }].sort((a, b) => a.name.localeCompare(b.name)));
      expect((await clinic("get", "/insurers", tok.manager)).body).toHaveLength(2);
      expect((await clinic("get", "/insurers", tok.doctor)).status).toBe(403);
      expect((await clinic("get", "/insurers", tok.free)).body).toEqual([]); // clínica não ligada: vazio, não vê as ligações de outra
    });

    it("elegibilidade por nº de cartão: eligible=true com plano, validade, moeda e coberturas (EXCLUDED e serviço INACTIVE não listados; carência ⇒ coveredNow=false)", async () => {
      const res = await check({ cardNumber: ben.holder?.card });
      expect(res.status).toBe(200);
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.body).toEqual({
        eligible: true,
        notice: NOTICE,
        beneficiaryName: CANARY.name,
        status: "ACTIVE",
        planName: "Plano Prata",
        validFrom: "2026-11-01",
        validTo: "2027-10-31",
        currency: "AOA",
        coverages: [
          { serviceCode: "CONS", serviceName: "Consulta", coveredNow: false, copayPct: 80, limitPerYear: null, waitingDays: 30, waitingEndsOn: "2026-12-01", requiresAuthorization: false },
          { serviceCode: "RX", serviceName: "Raio-X", coveredNow: true, copayPct: 100, limitPerYear: 150000.5, waitingDays: 0, waitingEndsOn: null, requiresAuthorization: true },
        ],
      });
      const keys = JSON.stringify(res.body);
      for (const forbidden of ["used", "reserved", "balance", "saldo", "familyId", "memberId", "insurerId", "holderId", id.family, id.user]) expect(keys).not.toContain(forbidden);
      expect(Object.keys(res.body as object).sort()).toEqual(["beneficiaryName", "coverages", "currency", "eligible", "notice", "planName", "status", "validFrom", "validTo"]);
    });

    it("elegibilidade por documento, por cartão em minúsculas e do dependente (apólice do titular); `serviceCode` filtra", async () => {
      const byDoc = await check({ idDocument: { type: "bi", number: CANARY.doc }, serviceCode: "RX" });
      expect(byDoc.body).toMatchObject({ eligible: true, beneficiaryName: CANARY.name, coverages: [{ serviceCode: "RX" }] });
      expect((byDoc.body as { coverages: unknown[] }).coverages).toHaveLength(1);
      expect((await check({ cardNumber: ben.holder?.card.toLowerCase() })).body).toMatchObject({ eligible: true });
      expect((await check({ cardNumber: ben.dep?.card })).body).toMatchObject({ eligible: true, beneficiaryName: "Dep", planName: "Plano Prata" });
      expect((await check({ cardNumber: ben.holder?.card, serviceCode: "ANAL" })).body).toMatchObject({ eligible: true, coverages: [] }); // EXCLUDED: não listado
      expect((await check({ cardNumber: ben.holder?.card, serviceCode: "NAO-EXISTE" })).body).toMatchObject({ eligible: true, coverages: [] });
      expect((await check({ cardNumber: ben.holder?.card }, tok.manager)).body).toMatchObject({ eligible: true }); // Gestor = Admin (Q6)
    });

    it("QR: válido ⇒ eligible; expirado, adulterado, revogado (cardVersion), de outra seguradora, lixo ⇒ a MESMA resposta {eligible:false, notice}", async () => {
      const exp = Math.floor(NOW.getTime() / 1000) + CARD_QR_TTL_SECONDS;
      const holder = ben.holder as { id: string; card: string };
      const good = signCardQrToken(CLAIM_SECRET, { insurerId: id.insA, beneficiaryId: holder.id, cardVersion: 1, expiresAt: exp });
      expect((await check({ qrToken: good })).body).toMatchObject({ eligible: true, beneficiaryName: CANARY.name });
      const notEligible = { eligible: false, notice: NOTICE };
      const bad = [
        signCardQrToken(CLAIM_SECRET, { insurerId: id.insA, beneficiaryId: holder.id, cardVersion: 1, expiresAt: Math.floor(NOW.getTime() / 1000) - 1 }), // expirado
        signCardQrToken("outro-segredo", { insurerId: id.insA, beneficiaryId: holder.id, cardVersion: 1, expiresAt: exp }), // assinatura
        signCardQrToken(CLAIM_SECRET, { insurerId: id.insB, beneficiaryId: holder.id, cardVersion: 1, expiresAt: exp }), // de outra seguradora
        signCardQrToken(CLAIM_SECRET, { insurerId: id.insA, beneficiaryId: ben.otherInsurer?.id ?? "", cardVersion: 1, expiresAt: exp }), // beneficiário de outra seguradora
        signCardQrToken(CLAIM_SECRET, { insurerId: id.insA, beneficiaryId: randomUUID(), cardVersion: 1, expiresAt: exp }), // inexistente
        `${good}x`,
        "lixo",
      ];
      for (const token of bad) expect((await check({ qrToken: token })).body, token.slice(0, 12)).toEqual(notEligible);
      // revogação: o emissor sobe `cardVersion` (BR-SEG-18) e o QR anterior deixa de valer
      await pool.query("UPDATE insurer_beneficiaries SET card_version = 2 WHERE id=$1", [holder.id]);
      expect((await check({ qrToken: good })).body).toEqual(notEligible);
      expect((await check({ qrToken: signCardQrToken(CLAIM_SECRET, { insurerId: id.insA, beneficiaryId: holder.id, cardVersion: 2, expiresAt: exp }) })).body).toMatchObject({ eligible: true });
    });

    it("anti-enumeração (BR-SEG-18): inexistente, inelegível por qualquer motivo e cartão de outra seguradora ⇒ resposta IDÊNTICA", async () => {
      const notEligible = { eligible: false, notice: NOTICE };
      const cases: object[] = [
        { cardNumber: "VF00000000000000" },
        { cardNumber: ben.otherInsurer?.card },
        { idDocument: { type: "BI", number: "B-DOC" } }, // documento de beneficiário da seguradora B
        { idDocument: { type: "BI", number: "NAO-EXISTE" } },
        ...["pending", "suspended", "policySuspended", "old", "future", "noPolicy", "cancelled"].map((key) => ({ cardNumber: ben[key]?.card })),
      ];
      for (const payload of cases) {
        const res = await check(payload);
        expect(res.status, JSON.stringify(payload)).toBe(200);
        expect(res.body, JSON.stringify(payload)).toEqual(notEligible);
        expect(Object.keys(res.body as object)).toEqual(["eligible", "notice"]);
      }
    });

    it("validação do pedido: exatamente um identificador (senão 422); campos extra/vazios ⇒ 422", async () => {
      expect((await check({})).status).toBe(422);
      expect((await check({ cardNumber: "a", qrToken: "b" })).status).toBe(422);
      expect((await check({ cardNumber: "a", idDocument: { type: "BI", number: "1" } })).status).toBe(422);
      expect((await check({ idDocument: { type: "BI" } })).status).toBe(422);
      expect((await check({ cardNumber: "   " })).status).toBe(422);
    });

    it("papéis e ligação (TC-AZ-SEG-04): Médico ⇒ 403; clínica sem ligação, ligação SUSPENDED, módulo desativado, seguradora suspensa ou inexistente ⇒ 404; clínica A não vê a ligação da B", async () => {
      const probe = { cardNumber: ben.holder?.card };
      expect((await check(probe, tok.doctor)).status).toBe(403);
      expect((await clinic("get", `/insurers/${id.insA}/services`, tok.doctor)).status).toBe(403);
      for (const path of [`/insurers/${id.insA}/services`]) {
        const res = await clinic("get", path, tok.free);
        expect(res.status).toBe(404);
        expect(res.body).toMatchObject({ code: "NOT_FOUND" });
      }
      expect((await check(probe, tok.free)).status).toBe(404);
      for (const insurer of [id.insC, id.insD, randomUUID()]) {
        expect((await clinic("post", `/insurers/${insurer}/eligibility`, tok.admin, probe)).status).toBe(404);
        expect((await clinic("get", `/insurers/${insurer}/services`, tok.admin)).status).toBe(404);
      }
      // ligar a Alfa à C (módulo desativado) e à D (suspensa): continua 404 e não aparece na lista
      await pool.query("INSERT INTO insurer_providers (insurer_id, clinic_id, name) VALUES ($1,$3,'x'), ($2,$3,'x')", [id.insC, id.insD, id.clinicAlfa]);
      expect((await clinic("post", `/insurers/${id.insC}/eligibility`, tok.admin, probe)).status).toBe(404);
      expect((await clinic("post", `/insurers/${id.insD}/eligibility`, tok.admin, probe)).status).toBe(404);
      expect((await clinic("get", "/insurers", tok.admin)).body).toHaveLength(2);
      // ligação suspensa ⇒ a seguradora desaparece e passa a 404
      await pool.query("UPDATE insurer_providers SET status='SUSPENDED' WHERE insurer_id=$1 AND clinic_id=$2", [id.insB, id.clinicAlfa]);
      expect((await clinic("get", "/insurers", tok.admin)).body).toEqual([{ id: id.insA, name: "Seg A", currency: "AOA" }]);
      expect((await clinic("post", `/insurers/${id.insB}/eligibility`, tok.admin, { cardNumber: ben.otherInsurer?.card })).status).toBe(404);
      await pool.query("UPDATE insurer_providers SET status='ACTIVE' WHERE insurer_id=$1 AND clinic_id=$2", [id.insB, id.clinicAlfa]);
      // desativar o módulo da A ⇒ 404 imediato
      await pool.query("UPDATE insurer_accounts SET operational_module_enabled=false WHERE id=$1", [id.insA]);
      expect((await check(probe)).status).toBe(404);
      await pool.query("UPDATE insurer_accounts SET operational_module_enabled=true WHERE id=$1", [id.insA]);
      expect((await check(probe)).status).toBe(200);
    });

    it("serviços para a clínica: só ACTIVE, só código/nome/categoria, `q` e paginação; Gestor ✓", async () => {
      const res = await clinic("get", `/insurers/${id.insA}/services`, tok.admin);
      expect(res.status).toBe(200);
      const items = body<{ items: Record<string, unknown>[] }>(res).items;
      expect(items.map((i) => i.code).sort()).toEqual(["ANAL", "CONS", "M1", "RX"]); // FISIO inativo; M1 vem da matriz de papéis
      for (const item of items) expect(Object.keys(item).sort()).toEqual(["category", "code", "expenseType", "guideType", "name"]);
      expect(res.text).not.toMatch(/"id"|insurerId|status/);
      expect((await clinic("get", `/insurers/${id.insA}/services?q=raio`, tok.manager)).body).toMatchObject({ items: [{ code: "RX" }], nextCursor: null });
      const p1 = await clinic("get", `/insurers/${id.insA}/services?limit=2`, tok.admin);
      expect(body<{ items: unknown[]; nextCursor: string }>(p1).items).toHaveLength(2);
      const p2 = await clinic("get", `/insurers/${id.insA}/services?limit=2&cursor=${encodeURIComponent(body<{ nextCursor: string }>(p1).nextCursor)}`, tok.admin);
      expect(body<{ items: unknown[]; nextCursor: null }>(p2)).toMatchObject({ nextCursor: null });
      expect(body<{ items: unknown[] }>(p2).items).toHaveLength(2);
      // a lista de outra seguradora nunca aparece
      expect(res.text).not.toContain("Consulta B");
    });

    it("auditoria ELIGIBILITY_CHECK (BR-SEG-15/18): uma entrada por validação, actor CLINIC_ACCOUNT, `metadata` só com insurerId/result/serviceCode/light (fatia 3, audit.md); nenhum canário em auditoria nem em logs", async () => {
      const rows = await col("SELECT actor_type::text AS actor_type, actor_clinic_account_id, actor_clinic_id, resource_type, resource_id, result::text AS result, metadata FROM audit_logs WHERE action='ELIGIBILITY_CHECK'");
      expect(rows.length).toBeGreaterThan(20);
      for (const r of rows) {
        expect(r.actor_type).toBe("CLINIC_ACCOUNT");
        expect(r.actor_clinic_id).toBe(id.clinicAlfa);
        expect(r.resource_type).toBe("Insurer");
        expect(Object.keys(r.metadata as object).every((k) => ["insurerId", "result", "serviceCode", "reason", "light"].includes(k))).toBe(true);
        expect((r.metadata as { insurerId: string }).insurerId).toBe(id.insA);
      }
      const results = new Set(rows.map((r) => (r.metadata as { result?: string }).result));
      expect(results).toEqual(new Set(["ELIGIBLE", "NOT_ELIGIBLE"]));
      const serviceCodes = new Set(rows.map((r) => (r.metadata as { serviceCode?: string }).serviceCode).filter(Boolean));
      expect(serviceCodes).toEqual(new Set(["RX", "ANAL"])); // só códigos reais da lista (NAO-EXISTE nunca entra)
      const dump = JSON.stringify(rows) + logs.join("");
      for (const canary of [CANARY.name, CANARY.doc, CANARY.docDep, ben.holder?.card ?? "?", ben.dep?.card ?? "?", ben.otherInsurer?.card ?? "?", "B-DOC", "NAO-EXISTE", "VF00000000000000"]) expect(dump, canary).not.toContain(canary);
      // acessos negados (404/403) não se auditam
      expect(rows.every((r) => r.result === "SUCCESS")).toBe(true);
    });

    it("rate limit por conta de clínica (30/10 min): o 31.º pedido ⇒ 429 + Retry-After, auditado como DENIED/RATE_LIMITED sem identificadores; outras contas não são afetadas", async () => {
      const payload = { cardNumber: ben.holder?.card };
      for (let i = 0; i < 30; i++) expect((await check(payload, tok.limit, `10.1.0.${String(i + 1)}`)).status, `pedido ${String(i)}`).toBe(200);
      const limited = await check(payload, tok.limit, "10.1.1.1");
      expect(limited.status).toBe(429);
      expect(limited.body).toMatchObject({ code: "RATE_LIMITED" });
      expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
      expect((await check(payload, tok.manager, "10.1.1.2")).status).toBe(200); // outra conta, outro IP
      const denied = await col("SELECT result::text AS result, metadata, actor_clinic_account_id FROM audit_logs WHERE action='ELIGIBILITY_CHECK' AND result='DENIED'");
      expect(denied).toHaveLength(1);
      expect(denied[0]).toMatchObject({ metadata: { insurerId: id.insA, reason: "RATE_LIMITED" }, actor_clinic_account_id: id.accLimit });
      expect(JSON.stringify(denied)).not.toContain(ben.holder?.card ?? "?");
    });

    it("rate limit por IP (60/10 min): contas diferentes no mesmo IP partilham o limite", async () => {
      const payload = { cardNumber: "VF11111111111111" };
      const ip = "10.2.0.1";
      // 60 pedidos repartidos por duas contas (nenhuma passa o limite por conta de 30)
      for (let i = 0; i < 30; i++) expect((await check(payload, tok.ip, ip)).status).toBe(200);
      for (let i = 0; i < 30; i++) expect((await check(payload, tok.ip2, ip)).status).toBe(200);
      const limited = await check(payload, tok.manager, ip);
      expect(limited.status).toBe(429);
      expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
      expect((await check(payload, tok.manager, "10.2.0.2")).status).toBe(200); // outro IP
      expect(await col("SELECT 1 FROM audit_logs WHERE action='ELIGIBILITY_CHECK' AND result='DENIED'")).toHaveLength(2);
    });

    it("a janela liberta-se com o tempo (Retry-After honrado)", async () => {
      clock.set(new Date(NOW.getTime() + 11 * 60 * 1000));
      expect((await check({ cardNumber: "VF11111111111111" }, tok.ip, "10.2.0.1")).status).toBe(200);
      clock.set(NOW);
    });
  });
});
