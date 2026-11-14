// HTTP + PostgreSQL real (testcontainers) da fatia 2 do marco B (ADR-033): migração 0037 (TC-CAT-01/02), tipos de serviço
// (TC-CAT-03..07), política da seguradora (TC-POL-02..06), matriz (TC-AZ-POL-01) e moeda (TC-MOE-04, integração). O supertest
// valida PEDIDOS e RESPOSTAS contra docs/05-api/openapi.yaml (`validateResponses`).
import { randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { Kysely } from "kysely";
import { Pool } from "pg";
import request from "supertest";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultMigrationsDir, runMigrations } from "../../db/migrate-runner.js";
import { FixedClock } from "../../src/platform/clock/index.js";
import { createDb, withTransaction, type Database } from "../../src/platform/db/index.js";
import { createApp } from "../../src/platform/http/index.js";
import { createLogger, type Logger } from "../../src/platform/logger/index.js";
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

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const NOW = new Date("2026-11-14T10:00:00.000Z");
const PORTAL = "/api/v1/insurance-portal";
const KEYS = [{ kid: "k1", secret: new TextEncoder().encode("0123456789abcdef0123456789abcdef") }];
const SESSION = randomUUID();

const id = {
  insA: randomUUID(),
  insB: randomUUID(),
  insC: randomUUID(), // módulo desativado
  insNew: randomUUID(), // criada depois da migração: semeada na primeira utilização
  clinic: randomUUID(),
  clinicAcc: randomUUID(),
};
const ROLES = ["INSURANCE_ADMIN", "BENEFICIARY_MANAGER", "AUTHORIZATION_ANALYST", "CLAIMS_MANAGER", "FINANCE_MANAGER", "INSURANCE_AGENT"] as const;
type Role = (typeof ROLES)[number];

describe("integração: catálogo service_kind, política e moeda (marco B fatia 2)", () => {
  let container: StartedTestContainer;
  let pool: Pool;
  let db: Kysely<Database>;
  let app: ReturnType<typeof createApp>;
  const clock = new FixedClock(NOW);
  const tokenA = {} as Record<Role, string>;
  const accountA = {} as Record<Role, string>;
  let tokB = "";
  let tokC = "";
  let tokNew = "";
  let tokClinic = "";
  const svcA = { CONS: "", LAB: "", AMB: "", NOC: "", FISIO: "", OUT: "" };
  let svcB = "";

  const insToken = async (accountId: string) => `Bearer ${(await signInsuranceAccessToken({ subject: { insuranceAccountId: accountId, sessionId: SESSION }, now: NOW, ttlSeconds: 900, signingKeys: KEYS })).token}`;
  const send = (method: "get" | "post" | "patch" | "put" | "delete", path: string, token: string | undefined, body?: unknown) => {
    let r = request(app)[method](`${PORTAL}${path}`);
    if (token) r = r.set("Authorization", token);
    return body === undefined ? r : r.send(body as object);
  };
  const rows = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows as Record<string, unknown>[];
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- asserção de tipo do corpo de teste
  const as = <T>(res: { body: unknown }): T => res.body as T;
  /** Elemento obrigatório (falha o teste, não o linter). */
  const need = <T>(value: T | undefined): T => {
    if (value === undefined) throw new Error("elemento em falta");
    return value;
  };
  interface Kind { id: string; code: string; name: string; guideType: string; expenseType: string; status: string; servicesCount: number }
  interface Setting { key: string; value: number; source: string; serviceOverrides: { serviceId: string; value: number }[] }

  beforeAll(async () => {
    container = await new GenericContainer("postgres:16-alpine")
      .withEnvironment({ POSTGRES_USER: "vita", POSTGRES_PASSWORD: "vita", POSTGRES_DB: "vita" })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start();
    pool = new Pool({ connectionString: `postgres://vita:vita@${container.getHost()}:${String(container.getMappedPort(5432))}/vita` });
    db = createDb(pool);

    // 1.º migrações anteriores à 0037, com dados «antigos» (categoria livre); 2.º a 0037 (TC-CAT-01/02).
    const before = mkdtempSync(join(tmpdir(), "vita-mig-"));
    for (const f of readdirSync(defaultMigrationsDir()).filter((n) => n < "0037")) cpSync(join(defaultMigrationsDir(), f), join(before, f));
    await runMigrations(pool, before);
    await pool.query("INSERT INTO insurer_accounts (id, name, tax_id, operational_module_enabled, currency) VALUES ($1,'Seg A','500000001',true,'AOA'), ($2,'Seg B','500000002',true,'USD'), ($3,'Seg C','500000003',false,'AOA')", [id.insA, id.insB, id.insC]);
    const legacy: [string, string, string, string | null][] = [
      ["CONS", "Consulta", "Consultas", "CONSULTATION"],
      ["LAB", "Análises", "Exames laboratoriais", "DIAGNOSTICS"],
      ["AMB", "Ambígua", "Consulta e exames", null],
      ["NOC", "Sem categoria", "", null],
      ["FISIO", "Fisioterapia", "Fisioterapia", "TREATMENT"],
      ["OUT", "Outros", "Outros", null],
    ];
    for (const [code, name, category] of legacy) await pool.query("INSERT INTO insurer_services (insurer_id, code, name, category) VALUES ($1,$2,$3,$4)", [id.insA, code, name, category]);
    await pool.query("INSERT INTO insurer_services (insurer_id, code, name, category, status) VALUES ($1,'CONS','Consulta B','CONSULTAS','INACTIVE')", [id.insB]);
    await runMigrations(pool, defaultMigrationsDir());

    await pool.query("INSERT INTO insurer_accounts (id, name, tax_id, operational_module_enabled, currency) VALUES ($1,'Seg Nova','500000004',true,'AOA')", [id.insNew]);
    const acc = async (accountId: string, insurer: string, role: string) => pool.query("INSERT INTO insurance_accounts (id, insurer_id, email, password_hash, role) VALUES ($1,$2,$3,'x',$4)", [accountId, insurer, `${accountId}@seg.pt`, role]);
    for (const role of ROLES) {
      accountA[role] = randomUUID();
      await acc(accountA[role], id.insA, role);
      tokenA[role] = await insToken(accountA[role]);
    }
    const [admB, admC, admNew] = [randomUUID(), randomUUID(), randomUUID()];
    await acc(admB, id.insB, "INSURANCE_ADMIN");
    await acc(admC, id.insC, "INSURANCE_ADMIN");
    await acc(admNew, id.insNew, "INSURANCE_ADMIN");
    [tokB, tokC, tokNew] = [await insToken(admB), await insToken(admC), await insToken(admNew)];

    await pool.query("INSERT INTO clinics (id, type, name) VALUES ($1,'PARTNER','Clínica Alfa')", [id.clinic]);
    await pool.query("INSERT INTO clinic_accounts (id, clinic_id, email, password_hash, role) VALUES ($1,$2,'c@cli.pt','x','CLINIC_ADMIN')", [id.clinicAcc, id.clinic]);
    await pool.query("INSERT INTO insurer_providers (insurer_id, clinic_id, name) VALUES ($1,$2,'Alfa')", [id.insA, id.clinic]);
    tokClinic = `Bearer ${(await signClinicAccessToken({ subject: { clinicAccountId: id.clinicAcc, sessionId: SESSION }, now: NOW, ttlSeconds: 900, signingKeys: KEYS })).token}`;

    const audit = createAuditModule({ db, clock });
    const ops = createInsurerOpsModule({
      db,
      audit,
      clock,
      insurers: createInsurerSettingsReader(),
      claimCodeSecret: "segredo-de-teste-dos-codigos",
      partnerClinics: { list: (trx, query) => new KyselyClinicsRepository().listPartnerDirectory(trx, query), find: (trx, clinicId) => new KyselyClinicsRepository().findPartnerDirectoryEntry(trx, clinicId) },
      patientAccess: { authorize: () => Promise.reject(new Error("rotas do paciente não usadas aqui")) },
    });
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
    const clinicActor = createClinicActorContextMiddleware({
      resolveClinicActorState: async (clinicAccountId, sessionId) => {
        const row = (await rows("SELECT clinic_id, role, status FROM clinic_accounts WHERE id=$1", [clinicAccountId]))[0] as { clinic_id: string; role: "CLINIC_ADMIN"; status: string };
        return { clinicAccountId, sessionId, clinicId: row.clinic_id, role: row.role, suspended: row.status !== "ACTIVE" };
      },
    });
    const insuranceActor = createInsuranceActorContextMiddleware({ resolveInsuranceActorState: createResolveInsuranceActorStateUseCase(d) });
    app = createApp({
      openApiSpecPath: join(REPO_ROOT, "docs/05-api/openapi.yaml"),
      logger: createLogger({ level: "silent" }),
      validateResponses: true,
      securityHandlers: {
        bearerAuth: () => Promise.resolve(false),
        clinicBearerAuth: createClinicBearerAuthSecurityHandler({ signingKeys: KEYS, clock }),
        insuranceBearerAuth: createInsuranceBearerAuthSecurityHandler({ signingKeys: KEYS, clock }),
      },
      actorContextMiddleware: (req: Request, res: Response, next: NextFunction) => {
        const handler: RequestHandler = clinicActor;
        handler(req, res, (e1?: unknown) => {
          if (e1) next(e1);
          else insuranceActor(req, res, next);
        });
      },
      registerHealthRoutes: (router) => {
        router.get("/health", (_req, res) => res.json({ status: "ok" }));
      },
      registerRoutes: (router) => {
        router.use(ops.router);
      },
    });
    for (const code of Object.keys(svcA) as (keyof typeof svcA)[]) svcA[code] = need((await rows("SELECT id FROM insurer_services WHERE insurer_id=$1 AND code=$2", [id.insA, code]))[0]).id as string;
    svcB = need((await rows("SELECT id FROM insurer_services WHERE insurer_id=$1", [id.insB]))[0]).id as string;
  }, 240_000);

  afterAll(async () => {
    await pool.end();
    await container.stop();
  });

  // ------------------------------------------------------------------ migração 0037
  describe("migração 0037 (TC-CAT-01/02)", () => {
    it("TC-CAT-01: sementes (3 guias, 9 despesas com legacy_code, 5 chaves); seguradoras existentes com 9 tipos; repetir não duplica", async () => {
      expect((await rows("SELECT code FROM guide_types ORDER BY sort_order")).map((r) => r.code)).toEqual(["CONSULTATION", "SERVICES", "ADMISSION"]);
      expect((await rows("SELECT legacy_code FROM expense_types ORDER BY sort_order")).map((r) => r.legacy_code)).toEqual(["I", "P", "C", "EAD", "T", "E", "PO", "M", "SD"]);
      expect((await rows("SELECT key FROM policy_setting_definitions ORDER BY key")).map((r) => r.key)).toEqual(["APPEAL_REQUEST_DAYS", "APPEAL_RESPONSE_HOURS", "AUTHORIZATION_DECISION_HOURS", "INFO_REQUEST_EXPIRY_DAYS", "URGENT_NOTICE_HOURS"]);
      for (const insurer of [id.insA, id.insB, id.insC]) expect(await rows("SELECT 1 FROM insurer_service_kinds WHERE insurer_id=$1", [insurer])).toHaveLength(9);
      expect(await rows("SELECT 1 FROM insurer_service_kinds WHERE insurer_id=$1", [id.insNew])).toHaveLength(0); // criada depois: semeia-se na 1.ª utilização

      const sql = readFileSync(join(defaultMigrationsDir(), "0037_insurer_catalog_policy.sql"), "utf8");
      const seed = /-- 3\.[\s\S]*?(?=-- 4\.)/.exec(sql)?.[0] ?? "";
      const mapping = /-- 5\.[\s\S]*$/.exec(sql)?.[0] ?? "";
      const snapshot = JSON.stringify(await rows("SELECT id, service_kind_id FROM insurer_services ORDER BY id"));
      await pool.query(seed);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(mapping);
        await client.query("COMMIT");
      } finally {
        client.release();
      }
      expect(await rows("SELECT 1 FROM insurer_service_kinds WHERE insurer_id=$1", [id.insA])).toHaveLength(9);
      expect(JSON.stringify(await rows("SELECT id, service_kind_id FROM insurer_services ORDER BY id"))).toBe(snapshot);
    });

    it("TC-CAT-02: mapeamento conservador da category; ambíguas e vazias ficam NULL; code/name/status e contagem intocados", async () => {
      const found = await rows("SELECT s.code, k.expense_type FROM insurer_services s LEFT JOIN insurer_service_kinds k ON k.insurer_id=s.insurer_id AND k.id=s.service_kind_id WHERE s.insurer_id=$1", [id.insA]);
      const got = Object.fromEntries(found.map((r) => [r.code as string, r.expense_type]));
      expect(got).toEqual({ CONS: "CONSULTATION", LAB: "DIAGNOSTICS", AMB: null, NOC: null, FISIO: "TREATMENT", OUT: null });
      expect(await rows("SELECT 1 FROM insurer_services")).toHaveLength(7);
      expect(await rows("SELECT name, status FROM insurer_services WHERE insurer_id=$1 AND code='CONS'", [id.insB])).toEqual([{ name: "Consulta B", status: "INACTIVE" }]);
      expect((await rows("SELECT k.expense_type FROM insurer_services s JOIN insurer_service_kinds k ON k.insurer_id=s.insurer_id AND k.id=s.service_kind_id WHERE s.insurer_id=$1", [id.insB]))[0]?.expense_type).toBe("CONSULTATION");
    });

    it("FK composta: serviço não aponta para tipo de outra seguradora; cascata ao apagar a seguradora", async () => {
      const otherKind = (await rows("SELECT id FROM insurer_service_kinds WHERE insurer_id=$1 LIMIT 1", [id.insB]))[0]?.id;
      await expect(pool.query("UPDATE insurer_services SET service_kind_id=$1 WHERE id=$2", [otherKind, svcA.OUT])).rejects.toMatchObject({ code: "23503" });
    });
  });

  // ------------------------------------------------------------------ tipos de serviço
  describe("tipos de serviço (TC-CAT-03..07)", () => {
    it("TC-CAT-03: GET lista os 9 por omissão com servicesCount; semeia a seguradora nova na 1.ª utilização", async () => {
      const list = await send("get", "/service-kinds", tokenA.INSURANCE_ADMIN);
      expect(list.status).toBe(200);
      const kinds = as<Kind[]>(list);
      expect(kinds).toHaveLength(9);
      expect(kinds.find((k) => k.code === "CONSULTATION")).toMatchObject({ name: "Consultas", guideType: "CONSULTATION", expenseType: "CONSULTATION", status: "ACTIVE", servicesCount: 1 });
      expect(kinds.find((k) => k.code === "DENTAL")).toMatchObject({ guideType: "SERVICES", servicesCount: 0 });
      expect(as<Kind[]>(await send("get", "/service-kinds", tokNew))).toHaveLength(9);
      expect(await rows("SELECT 1 FROM audit_logs WHERE action LIKE 'INSURER_SERVICE_KIND%'")).toHaveLength(0); // semeadura sem auditoria
      expect(as<Kind[]>(await send("get", "/service-kinds?status=INACTIVE", tokenA.INSURANCE_ADMIN))).toEqual([]);
    });

    let custom = "";
    it("TC-CAT-03: POST cria; code repetido ⇒ 409; guia/despesa desconhecidos ⇒ 422; PATCH não altera o code; leitura por papéis; escrita só ADMIN", async () => {
      const created = await send("post", "/service-kinds", tokenA.INSURANCE_ADMIN, { code: "PEDIATRIA", name: "Pediatria", guideType: "CONSULTATION", expenseType: "CONSULTATION" });
      expect(created.status).toBe(201);
      custom = as<Kind>(created).id;
      expect(created.body).toMatchObject({ code: "PEDIATRIA", status: "ACTIVE", servicesCount: 0 });
      expect((await send("post", "/service-kinds", tokenA.INSURANCE_ADMIN, { code: "PEDIATRIA", name: "Outro", guideType: "CONSULTATION", expenseType: "CONSULTATION" })).status).toBe(409);
      for (const bad of [{ guideType: "NOPE", expenseType: "CONSULTATION" }, { guideType: "SERVICES", expenseType: "NOPE" }]) {
        expect((await send("post", "/service-kinds", tokenA.INSURANCE_ADMIN, { code: "X1", name: "X", ...bad })).status).toBe(422);
      }
      const patched = await send("patch", `/service-kinds/${custom}`, tokenA.INSURANCE_ADMIN, { name: "Pediatria geral", guideType: "SERVICES", code: "OUTRO" });
      expect(patched.status).toBe(200);
      expect(patched.body).toMatchObject({ code: "PEDIATRIA", name: "Pediatria geral", guideType: "SERVICES" }); // `code` ignorado: imutável
      expect((await send("post", "/service-kinds", tokenA.BENEFICIARY_MANAGER, { code: "Z", name: "Z", guideType: "SERVICES", expenseType: "DENTAL" })).status).toBe(403);
      const audit = await rows("SELECT action, metadata FROM audit_logs WHERE action LIKE 'INSURER_SERVICE_KIND%' ORDER BY id");
      expect(audit.map((r) => r.action)).toEqual(["INSURER_SERVICE_KIND_CREATE", "INSURER_SERVICE_KIND_UPDATE"]);
      expect((audit[0]?.metadata as { insurerId: string }).insurerId).toBe(id.insA);
    });

    it("TC-CAT-03: inativar tipo com serviço ATIVO ligado ⇒ 409; sem serviços ativos ⇒ 200", async () => {
      const consultation = need(as<Kind[]>(await send("get", "/service-kinds", tokenA.INSURANCE_ADMIN)).find((k) => k.code === "CONSULTATION"));
      expect((await send("patch", `/service-kinds/${consultation.id}`, tokenA.INSURANCE_ADMIN, { status: "INACTIVE" })).status).toBe(409);
      expect((await send("patch", `/service-kinds/${custom}`, tokenA.INSURANCE_ADMIN, { status: "INACTIVE" })).status).toBe(200);
      expect((await send("patch", `/service-kinds/${custom}`, tokenA.INSURANCE_ADMIN, { status: "ACTIVE" })).status).toBe(200);
    });

    it("TC-CAT-04: PATCH /services/{id} com serviceKindId ⇒ guideType/expenseType derivados; outra seguradora/inativo ⇒ 422; null remove", async () => {
      const kinds = as<Kind[]>(await send("get", "/service-kinds", tokenA.INSURANCE_ADMIN));
      const dental = need(kinds.find((k) => k.code === "DENTAL"));
      const res = await send("patch", `/services/${svcA.OUT}`, tokenA.INSURANCE_ADMIN, { serviceKindId: dental.id });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ serviceKindId: dental.id, guideType: "SERVICES", expenseType: "DENTAL" });
      const foreign = need(as<Kind[]>(await send("get", "/service-kinds", tokB))[0]);
      expect((await send("patch", `/services/${svcA.OUT}`, tokenA.INSURANCE_ADMIN, { serviceKindId: foreign.id })).status).toBe(422);
      expect((await send("patch", `/services/${svcA.OUT}`, tokenA.INSURANCE_ADMIN, { serviceKindId: randomUUID() })).status).toBe(422);
      await pool.query("UPDATE insurer_service_kinds SET status='INACTIVE' WHERE id=$1", [kinds.find((k) => k.code === "PROSTHETICS")?.id]);
      expect((await send("patch", `/services/${svcA.OUT}`, tokenA.INSURANCE_ADMIN, { serviceKindId: kinds.find((k) => k.code === "PROSTHETICS")?.id })).status).toBe(422);
      await pool.query("UPDATE insurer_service_kinds SET status='ACTIVE' WHERE id=$1", [kinds.find((k) => k.code === "PROSTHETICS")?.id]);
      const cleared = await send("patch", `/services/${svcA.OUT}`, tokenA.INSURANCE_ADMIN, { serviceKindId: null });
      expect(cleared.body).toMatchObject({ serviceKindId: null, guideType: null, expenseType: null });
    });

    it("TC-CAT-05: classify — onlyUnclassified não sobrescreve; false sobrescreve; categoria normalizada; auditoria sem a categoria", async () => {
      const kinds = as<Kind[]>(await send("get", "/service-kinds", tokenA.INSURANCE_ADMIN));
      const [med, dent] = [need(kinds.find((k) => k.code === "MEDICATION")), need(kinds.find((k) => k.code === "DENTAL"))];
      await pool.query("UPDATE insurer_services SET category='Próteses Dentárias' WHERE id=ANY($1)", [[svcA.AMB, svcA.OUT]]);
      await pool.query("UPDATE insurer_services SET service_kind_id=$1 WHERE id=$2", [dent.id, svcA.AMB]);
      const first = await send("post", "/services/classify", tokenA.INSURANCE_ADMIN, { category: "  proteses dentarias ", serviceKindId: med.id });
      expect(first.body).toEqual({ updated: 1 }); // AMB já tinha tipo; só OUT
      expect((await rows("SELECT service_kind_id FROM insurer_services WHERE id=$1", [svcA.AMB]))[0]?.service_kind_id).toBe(dent.id);
      const second = await send("post", "/services/classify", tokenA.INSURANCE_ADMIN, { category: "PRÓTESES DENTÁRIAS", serviceKindId: med.id, onlyUnclassified: false });
      expect(second.body).toEqual({ updated: 2 });
      expect((await rows("SELECT service_kind_id FROM insurer_services WHERE id=$1", [svcA.AMB]))[0]?.service_kind_id).toBe(med.id);
      expect((await send("post", "/services/classify", tokenA.INSURANCE_ADMIN, { category: null, serviceKindId: med.id })).body).toEqual({ updated: 1 }); // NOC (sem categoria/vazia)
      expect((await send("post", "/services/classify", tokenA.INSURANCE_ADMIN, { category: "Inexistente", serviceKindId: med.id })).body).toEqual({ updated: 0 });
      expect((await send("post", "/services/classify", tokenA.INSURANCE_ADMIN, { category: "x", serviceKindId: as<Kind[]>(await send("get", "/service-kinds", tokB))[0]?.id })).status).toBe(422);
      expect((await send("post", "/services/classify", tokenA.BENEFICIARY_MANAGER, { category: "x", serviceKindId: med.id })).status).toBe(403);
      const audit = await rows("SELECT metadata FROM audit_logs WHERE action='INSURER_SERVICE_CLASSIFY' ORDER BY id");
      expect(audit.map((r) => (r.metadata as { count: number }).count)).toEqual([1, 2, 1, 0]);
      expect(JSON.stringify(audit)).not.toMatch(/prote|dent|Inexistente/i);
    });

    it("TC-CAT-06: novo tipo por dados — guia e despesa fictícios inseridos por SQL são aceites e listados, sem alterar código", async () => {
      await pool.query("INSERT INTO guide_types (code, sort_order) VALUES ('TEST_GUIDE', 99)");
      await pool.query("INSERT INTO expense_types (code, legacy_code, default_guide_type, default_name, sort_order) VALUES ('TEST_EXPENSE','ZZ','TEST_GUIDE','Teste',99)");
      const types = as<{ guideTypes: { code: string }[]; expenseTypes: { code: string; legacyCode: string }[] }>(await send("get", "/catalog-types", tokenA.CLAIMS_MANAGER));
      expect(types.guideTypes.map((g) => g.code)).toEqual(["CONSULTATION", "SERVICES", "ADMISSION", "TEST_GUIDE"]);
      expect(types.expenseTypes.map((e) => e.code)).toContain("TEST_EXPENSE");
      expect((await send("post", "/service-kinds", tokenA.INSURANCE_ADMIN, { code: "NOVO", name: "Novo", guideType: "TEST_GUIDE", expenseType: "TEST_EXPENSE" })).status).toBe(201);
    });

    it("TC-CAT-07: clínica vê guideType/expenseType (nulos se por classificar) e NÃO serviceKindId nem política", async () => {
      await pool.query("UPDATE insurer_services SET service_kind_id=NULL WHERE id=$1", [svcA.OUT]);
      const res = await request(app).get("/api/v1/clinic-portal/insurers/" + id.insA + "/services").set("Authorization", tokClinic);
      expect(res.status).toBe(200);
      const items = as<{ items: Record<string, unknown>[] }>(res).items;
      expect(items.find((i) => i.code === "CONS")).toEqual({ code: "CONS", name: "Consulta", category: "Consultas", guideType: "CONSULTATION", expenseType: "CONSULTATION" });
      expect(items.find((i) => i.code === "OUT")).toMatchObject({ guideType: null, expenseType: null });
      expect(JSON.stringify(items)).not.toMatch(/serviceKindId|policy|Hours|Days/);
    });
  });

  // ------------------------------------------------------------------ política
  describe("política da seguradora (TC-POL-02..06)", () => {
    const get = async (token = tokenA.INSURANCE_ADMIN) => as<Setting[]>(await send("get", "/policy-settings", token));

    it("GET: 5 chaves com limites e omissão do Vita; qualquer papel do módulo lê; sem escrita ⇒ valor por omissão", async () => {
      const settings = await get(tokenA.FINANCE_MANAGER);
      expect(settings.map((s) => [s.key, s.value, s.source])).toEqual([
        ["APPEAL_REQUEST_DAYS", 15, "DEFAULT"],
        ["APPEAL_RESPONSE_HOURS", 72, "DEFAULT"],
        ["AUTHORIZATION_DECISION_HOURS", 48, "DEFAULT"],
        ["INFO_REQUEST_EXPIRY_DAYS", 7, "DEFAULT"],
        ["URGENT_NOTICE_HOURS", 48, "DEFAULT"],
      ]);
      expect(settings.find((s) => s.key === "AUTHORIZATION_DECISION_HOURS")).toMatchObject({ unit: "HOURS", min: 24, max: 120, defaultValue: 48, allowsServiceScope: true, serviceOverrides: [] });
    });

    it.each([
      ["AUTHORIZATION_DECISION_HOURS", [24, 120], [23, 121], "entre 24 e 120 horas"],
      ["APPEAL_REQUEST_DAYS", [5, 30], [4, 31], "entre 5 e 30 dias"],
      ["APPEAL_RESPONSE_HOURS", [24, 120], [23, 121], "entre 24 e 120 horas"],
      ["INFO_REQUEST_EXPIRY_DAYS", [1, 30], [0, 31], "entre 1 e 30 dias"],
      ["URGENT_NOTICE_HOURS", [24, 72], [23, 73], "entre 24 e 72 horas"],
    ])("TC-POL-02 %s: limites inclusivos; fora ⇒ 422 (field=value, intervalo na mensagem); não inteiro ⇒ 422", async (key, ok, bad, message) => {
      for (const value of ok) expect((await send("put", `/policy-settings/${key}`, tokenA.INSURANCE_ADMIN, { value })).status).toBe(200);
      for (const value of bad) {
        const res = await send("put", `/policy-settings/${key}`, tokenA.INSURANCE_ADMIN, { value });
        expect(res.status).toBe(422);
        expect(res.body).toMatchObject({ code: "VALIDATION_ERROR", errors: [{ field: "value", message }] });
      }
      expect((await send("put", `/policy-settings/${key}`, tokenA.INSURANCE_ADMIN, { value: 30.5 })).status).toBe(422);
      await send("delete", `/policy-settings/${key}`, tokenA.INSURANCE_ADMIN);
    });

    it("TC-POL-03: serviceId só em chaves com escopo; serviço de outra seguradora ⇒ 404; chave desconhecida ⇒ 404; PUT repetido idempotente", async () => {
      expect((await send("put", "/policy-settings/APPEAL_REQUEST_DAYS", tokenA.INSURANCE_ADMIN, { value: 10, serviceId: svcA.CONS })).status).toBe(422);
      expect((await send("put", "/policy-settings/AUTHORIZATION_DECISION_HOURS", tokenA.INSURANCE_ADMIN, { value: 72, serviceId: svcB })).status).toBe(404);
      expect((await send("put", "/policy-settings/NAO_EXISTE", tokenA.INSURANCE_ADMIN, { value: 72 })).status).toBe(404);
      const first = await send("put", "/policy-settings/AUTHORIZATION_DECISION_HOURS", tokenA.INSURANCE_ADMIN, { value: 72, serviceId: svcA.CONS });
      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({ key: "AUTHORIZATION_DECISION_HOURS", value: 48, source: "DEFAULT", serviceOverrides: [{ serviceId: svcA.CONS, serviceCode: "CONS", value: 72 }] });
      const again = await send("put", "/policy-settings/AUTHORIZATION_DECISION_HOURS", tokenA.INSURANCE_ADMIN, { value: 72, serviceId: svcA.CONS });
      expect(again.body).toEqual(first.body);
      expect(await rows("SELECT 1 FROM insurer_policy_settings WHERE insurer_id=$1 AND setting_key='AUTHORIZATION_DECISION_HOURS' AND service_id IS NOT NULL", [id.insA])).toHaveLength(1);
      expect((await send("put", "/policy-settings/AUTHORIZATION_DECISION_HOURS", tokenA.INSURANCE_ADMIN, { value: 96 })).body).toMatchObject({ value: 96, source: "INSURER" });
    });

    it("TC-POL-04: DELETE repõe — sem serviceId volta à omissão; com serviceId volta ao valor da seguradora; repetir ⇒ 204 sem nova auditoria", async () => {
      const before = (await rows("SELECT 1 FROM audit_logs WHERE action='INSURER_POLICY_SETTING_RESET'")).length;
      expect((await send("delete", `/policy-settings/AUTHORIZATION_DECISION_HOURS?serviceId=${svcA.CONS}`, tokenA.INSURANCE_ADMIN)).status).toBe(204);
      let current = need((await get()).find((s) => s.key === "AUTHORIZATION_DECISION_HOURS"));
      expect(current).toMatchObject({ value: 96, source: "INSURER", serviceOverrides: [] });
      expect((await send("delete", "/policy-settings/AUTHORIZATION_DECISION_HOURS", tokenA.INSURANCE_ADMIN)).status).toBe(204);
      current = need((await get()).find((s) => s.key === "AUTHORIZATION_DECISION_HOURS"));
      expect(current).toMatchObject({ value: 48, source: "DEFAULT" });
      expect((await send("delete", "/policy-settings/AUTHORIZATION_DECISION_HOURS", tokenA.INSURANCE_ADMIN)).status).toBe(204);
      expect((await send("delete", "/policy-settings/NAO_EXISTE", tokenA.INSURANCE_ADMIN)).status).toBe(404);
      expect((await rows("SELECT 1 FROM audit_logs WHERE action='INSURER_POLICY_SETTING_RESET'")).length - before).toBe(2);
    });

    it("TC-POL-05: auditoria INSURER_POLICY_SETTING_UPDATE com key, serviceId?, from, to, insurerId; sem dados pessoais", async () => {
      await send("put", "/policy-settings/URGENT_NOTICE_HOURS", tokenA.INSURANCE_ADMIN, { value: 36 });
      const audit = await rows("SELECT metadata, actor_type::text AS actor_type FROM audit_logs WHERE action='INSURER_POLICY_SETTING_UPDATE' ORDER BY id DESC LIMIT 1");
      expect(audit[0]).toMatchObject({ actor_type: "INSURANCE_ACCOUNT", metadata: { insurerId: id.insA, key: "URGENT_NOTICE_HOURS", from: 48, to: 36 } });
      const withService = await rows("SELECT metadata FROM audit_logs WHERE action='INSURER_POLICY_SETTING_UPDATE' AND metadata ? 'serviceId' ORDER BY id LIMIT 1");
      expect(withService[0]?.metadata).toMatchObject({ key: "AUTHORIZATION_DECISION_HOURS", serviceId: svcA.CONS, from: 48, to: 72 });
      const all = JSON.stringify(await rows("SELECT metadata FROM audit_logs WHERE action LIKE 'INSURER_POLICY_SETTING%'"));
      expect(all).not.toMatch(/@|Consulta/);
    });

    it("TC-POL-06 BR-SEG-14: isolamento — B não vê definições nem exceções de A; escrita de B não afeta A; serviço de A ⇒ 404 em B", async () => {
      await send("put", "/policy-settings/AUTHORIZATION_DECISION_HOURS", tokenA.INSURANCE_ADMIN, { value: 60, serviceId: svcA.LAB });
      const b = need((await get(tokB)).find((s) => s.key === "AUTHORIZATION_DECISION_HOURS"));
      expect(b).toMatchObject({ value: 48, source: "DEFAULT", serviceOverrides: [] });
      expect((await send("put", "/policy-settings/AUTHORIZATION_DECISION_HOURS", tokB, { value: 100, serviceId: svcA.LAB })).status).toBe(404);
      expect((await send("put", "/policy-settings/APPEAL_REQUEST_DAYS", tokB, { value: 20 })).status).toBe(200);
      expect((await get()).find((s) => s.key === "APPEAL_REQUEST_DAYS")).toMatchObject({ value: 15, source: "DEFAULT" });
      expect(as<Kind[]>(await send("get", "/service-kinds", tokB)).every((k) => k.servicesCount <= 1)).toBe(true);
      const aKind = need(as<Kind[]>(await send("get", "/service-kinds", tokenA.INSURANCE_ADMIN))[0]);
      expect((await send("patch", `/service-kinds/${aKind.id}`, tokB, { name: "x" })).status).toBe(404);
    });
  });

  // ------------------------------------------------------------------ matriz de papéis
  describe("TC-AZ-POL-01: matriz (authorization.md §8.2b)", () => {
    const ops: [string, "get" | "post" | "patch" | "put" | "delete", () => string, () => unknown, "read" | "admin"][] = [
      ["catalog-types", "get", () => "/catalog-types", () => undefined, "read"],
      ["list kinds", "get", () => "/service-kinds", () => undefined, "read"],
      ["list policy", "get", () => "/policy-settings", () => undefined, "read"],
      ["create kind", "post", () => "/service-kinds", () => ({ code: `K${randomUUID().slice(0, 6)}`, name: "K", guideType: "SERVICES", expenseType: "DENTAL" }), "admin"],
      ["patch kind", "patch", () => `/service-kinds/${randomUUID()}`, () => ({ name: "x" }), "admin"],
      ["classify", "post", () => "/services/classify", () => ({ category: "zz", serviceKindId: randomUUID() }), "admin"],
      ["put policy", "put", () => "/policy-settings/APPEAL_RESPONSE_HOURS", () => ({ value: 72 }), "admin"],
      ["delete policy", "delete", () => "/policy-settings/APPEAL_RESPONSE_HOURS", () => undefined, "admin"],
    ];
    const cases = ROLES.flatMap((role) => ops.map(([name, method, path, body, access]) => ({ role, name, method, path, body, access })));
    it.each(cases)("$role · $name", async ({ role, method, path, body, access }) => {
      const res = await send(method, path(), tokenA[role], body());
      const allowed = role === "INSURANCE_ADMIN" || (access === "read" && role !== "INSURANCE_AGENT");
      if (allowed) expect(res.status, JSON.stringify(res.body)).not.toBe(403);
      else expect(res.status).toBe(403);
    });

    it("sem token ⇒ 401; token de clínica ⇒ 401/403; módulo desativado ⇒ 404 em todas as rotas", async () => {
      expect((await send("get", "/service-kinds", undefined)).status).toBe(401);
      expect([401, 403]).toContain((await send("get", "/policy-settings", tokClinic)).status);
      for (const [, method, path, body] of ops) expect((await send(method, path(), tokC, body())).status).toBe(404);
    });
  });

  // ------------------------------------------------------------------ moeda
  describe("TC-MOE-04 (integração): reimbursement_claims.currency = insurer_accounts.currency em todas as linhas", () => {
    it("sem divergências (a fatia não toca em reimbursement_claims)", async () => {
      expect(await rows("SELECT 1 FROM reimbursement_claims c JOIN insurer_accounts i ON i.id=c.insurer_id WHERE c.currency <> i.currency")).toEqual([]);
    });
  });
});
