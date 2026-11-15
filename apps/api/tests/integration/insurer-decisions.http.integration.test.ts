// HTTP + PostgreSQL real (testcontainers) da fatia 4 do marco B (ADR-035, BR-AUT-03/17..23): migração 0040 (TC-DEC-19), as 15 rotas
// `/insurance-portal/authorizations*` e `/auto-approval-rules*` (TC-DEC-04..10/12/16/17, TC-AZ-DEC-01..03), a auto-aprovação na criação
// (TC-DEC-03), o job `insurer.flag-sla-breaches` (TC-DEC-11), a validade derivada (TC-DEC-15) e o não-vazamento (TC-DEC-13). As decisões
// passam POR ROTA (já não por fixture). O supertest valida PEDIDOS e RESPOSTAS contra o contrato (`validateResponses`).
import { randomUUID } from "node:crypto";
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
import { InMemoryStorage } from "../../src/platform/storage/index.js";
import { createAuditModule } from "../../src/modules/audit/index.js";
import { KyselyAuditRepository } from "../../src/modules/audit/infrastructure/repo.js";
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
import { createInsurerOpsModule, createInsurerOpsWorkerModule } from "../../src/modules/insurer-ops/index.js";
import { createGetActFactsUseCase as createAppointmentFacts } from "../../src/modules/appointments/application/act-facts.js";
import { KyselyAppointmentActFactsSource } from "../../src/modules/appointments/infrastructure/repo.js";
import { FakeAccessPolicy } from "../../src/modules/processes/application/fixtures.js";
import { createFindProcessForClinicUseCase, createOpenProcessUseCase } from "../../src/modules/processes/application/link-process.js";
import type { ProcessesDeps } from "../../src/modules/processes/application/ports.js";
import { KyselyProcessesRepository } from "../../src/modules/processes/infrastructure/repo.js";
import { createAttachmentFiles } from "../../src/main/attachment-files.js";
import { openApiSpecPath } from "../support/openapi-spec.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const NOW = new Date("2026-11-14T10:00:00.000Z");
const API = "/api/v1";
const KEYS = [{ kid: "k1", secret: new TextEncoder().encode("0123456789abcdef0123456789abcdef") }];
const SESSION = randomUUID();
const CANARY = "CANARIO-DECISAO-5519";
const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(64, 1)]);

const ROLES = ["INSURANCE_ADMIN", "BENEFICIARY_MANAGER", "AUTHORIZATION_ANALYST", "CLAIMS_MANAGER", "FINANCE_MANAGER", "INSURANCE_AGENT", "SUPERVISOR"] as const;
type Role = (typeof ROLES)[number];

const id = {
  insA: randomUUID(),
  insB: randomUUID(),
  insOff: randomUUID(),
  clinicX: randomUUID(),
  accClinic: randomUUID(),
  plan: randomUUID(),
  user: randomUUID(),
  family: randomUUID(),
};
const svc = { CONS: randomUUID(), CONS2: randomUUID(), ADM: randomUUID(), WAIT: randomUUID(), LAB: randomUUID(), BCONS: randomUUID() };

interface Auth {
  id: string;
  status: string;
  closedReason: string | null;
  code: string | null;
  validUntil: string | null;
  expired: boolean;
  authorizedAmount: number | null;
  requestedAmount: number;
  partial: boolean;
  decisionNote: string | null;
  decisionDueAt: string;
  slaStatus: string | null;
  escalatedAt: string | null;
  assignedTo: { id: string; email: string } | null;
  decidedBy: string | null;
  isAppeal: boolean;
  parentRequestId: string | null;
  allowedActions: string[];
  autoApproval: { ok: boolean; ruleId: string | null; ruleName: string | null; checks: { check: string; ok: boolean; reason: string }[] } | null;
  coverage?: { reason: string; remaining: number | null; limitPerYear: number | null; requiresAuthorization: boolean };
  attachments?: { id: string }[];
  timeline?: { status: string; by: string; note: string | null; internalNote: string | null }[];
  processId?: string | null;
}
interface Rule { id: string; name: string; scope: string; serviceKindId: string | null; serviceId: string | null; targetName: string; maxAmount: number; currency: string; active: boolean }

describe("integração: decisão pela seguradora, auto-aprovação, SLA e SUPERVISOR (marco B fatia 4)", () => {
  let container: StartedTestContainer;
  let pool: Pool;
  let db: Kysely<Database>;
  let app: ReturnType<typeof createApp>;
  let ops: ReturnType<typeof createInsurerOpsModule>;
  let worker: ReturnType<typeof createInsurerOpsWorkerModule>;
  const clock = new FixedClock(NOW);
  const storage = new InMemoryStorage();
  const tokA = {} as Record<Role | "ANALYST2" | "SUPERVISOR2", string>;
  const accA = {} as Record<Role | "ANALYST2" | "SUPERVISOR2", string>;
  const tokB = {} as Record<"INSURANCE_ADMIN" | "AUTHORIZATION_ANALYST" | "SUPERVISOR", string>;
  const accB = {} as Record<"INSURANCE_ADMIN" | "AUTHORIZATION_ANALYST" | "SUPERVISOR", string>;
  let tokOff = "";
  let tokClinic = "";
  let tokUser = "";
  let kindConsult = "";
  let kindInpatient = "";

  const need = <T>(value: T | null | undefined): T => {
    if (value === null || value === undefined) throw new Error("valor em falta");
    return value;
  };
  const rows = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows as Record<string, unknown>[];
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- asserção de tipo do corpo de teste
  const as = <T>(res: { body: unknown }): T => res.body as T;
  const tick = () => {
    clock.advance(11 * 60 * 1000); // fora da janela do rate limit (10 min)
  };
  const day = (offset: number) => new Date(clock.now().getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  type Method = "get" | "post" | "patch" | "put" | "delete";
  const call = (method: Method, path: string, token: string | undefined, body?: unknown) => {
    let r = request(app)[method](`${API}${path}`);
    if (token) r = r.set("Authorization", token);
    return body === undefined ? r : r.send(body as object);
  };
  const ins = (method: Method, path: string, token: string | undefined, body?: unknown) => call(method, `/insurance-portal${path}`, token, body);
  const clinic = (method: Method, path: string, body?: unknown, token = tokClinic) => call(method, `/clinic-portal${path}`, token, body);
  const insToken = async (accountId: string) => `Bearer ${(await signInsuranceAccessToken({ subject: { insuranceAccountId: accountId, sessionId: SESSION }, now: NOW, ttlSeconds: 400 * 86_400, signingKeys: KEYS })).token}`;

  let nextCard = 0;
  const newBeneficiary = async (over: { linked?: boolean } = {}) => {
    const benId = randomUUID();
    const memberId = randomUUID();
    const card = `DEC-${String(++nextCard)}`;
    if (over.linked) await pool.query("INSERT INTO family_members (id, family_id, name, birth_date, is_dependent) VALUES ($1,$2,'Membro','1990-01-01',false)", [memberId, id.family]);
    await pool.query("INSERT INTO insurer_beneficiaries (id, insurer_id, name, id_document_type, id_document_number, birth_date, relationship, card_number, status, family_id, family_member_id) VALUES ($1,$2,$3,'BI',$4,'1980-01-01','HOLDER',$5,'ACTIVE',$6,$7)", [
      benId,
      id.insA,
      `Beneficiario ${String(nextCard)}`,
      `DOC-${String(nextCard)}`,
      card,
      over.linked ? id.family : null,
      over.linked ? memberId : null,
    ]);
    await pool.query("INSERT INTO insurer_policies (insurer_id, plan_id, holder_id, number, valid_from, valid_to, status) VALUES ($1,$2,$3,$4,'2026-01-01','2030-12-31','ACTIVE')", [id.insA, id.plan, benId, `AP-${String(nextCard)}`]);
    return { id: benId, card, memberId };
  };
  const body = (card: string, over: Record<string, unknown> = {}) => ({ insurerId: id.insA, cardNumber: card, serviceCode: "CONS", requestedAmount: 250.5, expectedOn: day(6), justification: "Consulta pedida pelo serviço de saúde da empresa", ...over });
  const create = (card: string, over: Record<string, unknown> = {}) => {
    tick();
    return clinic("post", "/authorizations", body(card, over));
  };
  /** Pedido novo `IN_REVIEW` (sem regras ativas). */
  const openRequest = async (over: Record<string, unknown> = {}, linked = false) => {
    const ben = await newBeneficiary({ linked });
    const res = await create(ben.card, over);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(as<Auth>(res).status).toBe("IN_REVIEW");
    return { ben, auth: as<Auth>(res) };
  };
  /** Fim do dia UTC de `date` + `days` (BR-AUT-07). */
  const endOfDay = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00.000Z`) + (days + 1) * 86_400_000 - 1).toISOString();
  const appeal = (authId: string, justification = "Novo fundamento administrativo") => {
    tick();
    return clinic("post", `/authorizations/${authId}/appeals`, { justification });
  };
  /** Corpo válido de cada ação (o validador do contrato corre antes da autorização). */
  const payloadOf = (action: string): Record<string, unknown> => (action === "approve" || action === "assign" ? {} : { reason: "x" });
  const get = async (authId: string, token = tokA.SUPERVISOR) => as<Auth>(await ins("get", `/authorizations/${authId}`, token));
  const approve = (authId: string, token: string, payload: unknown = {}) => ins("post", `/authorizations/${authId}/approve`, token, payload);
  const reject = (authId: string, token: string, reason = "Fora de cobertura") => ins("post", `/authorizations/${authId}/reject`, token, { reason });
  /** Recusa um pedido novo pelo analista e devolve-o já recusado. */
  const rejectedRequest = async (token = tokA.AUTHORIZATION_ANALYST, over: Record<string, unknown> = {}) => {
    const { ben, auth } = await openRequest(over);
    expect((await reject(auth.id, token)).status).toBe(200);
    return { ben, auth };
  };
  const createRule = (payload: Record<string, unknown>, token = tokA.SUPERVISOR) => ins("post", "/auto-approval-rules", token, payload);
  const clearRules = () => pool.query("DELETE FROM insurer_auto_approval_rules");
  const auditRows = (action: string, resourceId: string) => rows("SELECT actor_type, actor_insurance_account_id, metadata FROM audit_logs WHERE action=$1 AND resource_id=$2", [action, resourceId]);

  beforeAll(async () => {
    container = await new GenericContainer("postgres:16-alpine")
      .withEnvironment({ POSTGRES_USER: "vita", POSTGRES_PASSWORD: "vita", POSTGRES_DB: "vita" })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start();
    pool = new Pool({ connectionString: `postgres://vita:vita@${container.getHost()}:${String(container.getMappedPort(5432))}/vita` });
    db = createDb(pool);
    await runMigrations(pool, defaultMigrationsDir());

    await pool.query("INSERT INTO users (id, email, password_hash, name, birth_date, timezone, terms_accepted_version, terms_accepted_at) VALUES ($1,'a@b.pt','x','Ana','1990-01-01','Europe/Lisbon','1',now())", [id.user]);
    await pool.query("INSERT INTO families (id, name) VALUES ($1,'Fam')", [id.family]);
    await pool.query("INSERT INTO insurer_accounts (id, name, tax_id, operational_module_enabled, currency) VALUES ($1,'Seg A','500000001',true,'AOA'), ($2,'Seg B','500000002',true,'USD'), ($3,'Seg Off','500000003',false,'AOA')", [id.insA, id.insB, id.insOff]);
    await pool.query("INSERT INTO clinics (id, type, name) VALUES ($1,'PARTNER','Clínica X')", [id.clinicX]);
    await pool.query("INSERT INTO clinic_accounts (id, clinic_id, email, password_hash, role) VALUES ($1,$2,'admin@x.pt','x','CLINIC_ADMIN')", [id.accClinic, id.clinicX]);
    await pool.query("INSERT INTO insurer_providers (insurer_id, clinic_id, name) VALUES ($1,$2,'Clínica X Prestador')", [id.insA, id.clinicX]);

    const account = (accountId: string, insurer: string, role: string) => pool.query("INSERT INTO insurance_accounts (id, insurer_id, email, password_hash, role) VALUES ($1,$2,$3,'x',$4)", [accountId, insurer, `${accountId}@seg.pt`, role]);
    for (const role of ROLES) {
      accA[role] = randomUUID();
      await account(accA[role], id.insA, role);
      tokA[role] = await insToken(accA[role]);
    }
    for (const extra of ["ANALYST2", "SUPERVISOR2"] as const) {
      accA[extra] = randomUUID();
      await account(accA[extra], id.insA, extra === "ANALYST2" ? "AUTHORIZATION_ANALYST" : "SUPERVISOR");
      tokA[extra] = await insToken(accA[extra]);
    }
    for (const role of ["INSURANCE_ADMIN", "AUTHORIZATION_ANALYST", "SUPERVISOR"] as const) {
      accB[role] = randomUUID();
      await account(accB[role], id.insB, role);
      tokB[role] = await insToken(accB[role]);
    }
    const offAdmin = randomUUID();
    await account(offAdmin, id.insOff, "SUPERVISOR");
    tokOff = await insToken(offAdmin);
    tokClinic = `Bearer ${(await signClinicAccessToken({ subject: { clinicAccountId: id.accClinic, sessionId: SESSION }, now: NOW, ttlSeconds: 400 * 86_400, signingKeys: KEYS })).token}`;
    tokUser = "Bearer invalido.de.utilizador";

    const kind = async (insurer: string, code: string, guide: string, expense: string) => (await rows("INSERT INTO insurer_service_kinds (insurer_id, code, name, guide_type, expense_type) VALUES ($1,$2,$2,$3,$4) RETURNING id", [insurer, code, guide, expense]))[0]?.id as string;
    kindConsult = await kind(id.insA, "CONSULTATION", "CONSULTATION", "CONSULTATION");
    kindInpatient = await kind(id.insA, "INPATIENT", "ADMISSION", "INPATIENT");
    const kindDiag = await kind(id.insA, "DIAGNOSTICS", "SERVICES", "DIAGNOSTICS");
    const service = (insurer: string, sid: string, code: string, kindId: string | null) => pool.query("INSERT INTO insurer_services (id, insurer_id, code, name, status, service_kind_id) VALUES ($1,$2,$3,$4,'ACTIVE',$5)", [sid, insurer, code, `Serviço ${code}`, kindId]);
    await service(id.insA, svc.CONS, "CONS", kindConsult);
    await service(id.insA, svc.CONS2, "CONS2", kindConsult);
    await service(id.insA, svc.ADM, "ADM", kindInpatient);
    await service(id.insA, svc.WAIT, "WAIT", kindDiag);
    await service(id.insA, svc.LAB, "LAB", kindDiag);
    await service(id.insB, svc.BCONS, "CONS", null);
    await pool.query("INSERT INTO insurer_plans (id, insurer_id, name, status) VALUES ($1,$2,'Plano Ouro','ACTIVE')", [id.plan, id.insA]);
    const coverage = (sid: string, copay: number, waiting: number, auth: boolean, limit: number | null) =>
      pool.query("INSERT INTO insurer_plan_coverages (insurer_id, plan_id, service_id, type, copay_pct, waiting_days, requires_authorization, limit_per_year) VALUES ($1,$2,$3,$8,$4,$5,$6,$7)", [id.insA, id.plan, sid, copay, waiting, auth, limit, limit === null ? "INCLUDED" : "LIMITED"]);
    await coverage(svc.CONS, 80, 0, true, null);
    await coverage(svc.CONS2, 80, 0, true, null);
    await coverage(svc.ADM, 90, 0, true, 1000); // com teto: saldo = 1000
    await coverage(svc.WAIT, 70, 1500, false, null); // carência longa (até 2030): sempre AMARELO nos testes
    await coverage(svc.LAB, 100, 0, false, null); // VERDE

    const audit = createAuditModule({ db, clock });
    const procDeps: ProcessesDeps<Kysely<Database>> = {
      repo: new KyselyProcessesRepository(),
      facts: {
        getActFacts: async (trx, familyId, refs) => (await createAppointmentFacts(new KyselyAppointmentActFactsSource())(trx, familyId, refs.map((r) => r.originId))).map((e) => ({ originType: "APPOINTMENT" as const, originId: e.originId, fact: e.fact })),
        getCoverageFacts: (trx, familyId, processIds) => ops.getCoverageFacts(trx, familyId, processIds),
      },
      policy: new FakeAccessPolicy(),
      audit: new KyselyAuditRepository(),
      withTransaction: (fn) => withTransaction(db, fn),
      clock,
      onInconsistency: () => undefined,
    };
    ops = createInsurerOpsModule({
      db,
      audit,
      clock,
      insurers: createInsurerSettingsReader(),
      claimCodeSecret: "segredo-de-teste-dos-codigos",
      partnerClinics: { list: (trx, query) => new KyselyClinicsRepository().listPartnerDirectory(trx, query), find: (trx, clinicId) => new KyselyClinicsRepository().findPartnerDirectoryEntry(trx, clinicId) },
      patientAccess: { authorize: () => Promise.reject(new Error("rotas do paciente não usadas aqui")) },
      processes: { open: createOpenProcessUseCase(procDeps), findForClinic: createFindProcessForClinicUseCase(procDeps) },
      files: createAttachmentFiles({ storage, virusScanner: { scan: () => Promise.resolve("CLEAN" as const) } }),
    });
    worker = createInsurerOpsWorkerModule({ db, audit, clock, boss: {} as never });

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
      accountStateCache: new InsuranceTtlCache<CachedInsuranceAccountState>(clock, 1),
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
      openApiSpecPath: openApiSpecPath(REPO_ROOT),
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
  }, 240_000);

  afterAll(async () => {
    await pool.end();
    await container.stop();
  });

  // ------------------------------------------------------------------ migração 0040
  describe("migração 0040 (TC-DEC-19)", () => {
    it("valores novos dos enums, decisor, semente idempotente da validade; nenhuma coluna clínica nas tabelas novas (TC-AUT-17)", async () => {
      expect((await rows("SELECT unnest(enum_range(NULL::authorization_closed_reason))::text AS v")).map((r) => r.v)).toEqual(["INFO_TIMEOUT", "CLINIC_CANCELLED", "ANALYST_CANCELLED"]);
      expect((await rows("SELECT unnest(enum_range(NULL::insurance_account_role))::text AS v")).map((r) => r.v)).toContain("SUPERVISOR");
      expect((await rows("SELECT unnest(enum_range(NULL::authorization_decider))::text AS v")).map((r) => r.v)).toEqual(["ANALYST", "SUPERVISOR", "SYSTEM"]);
      expect(await rows("SELECT * FROM policy_setting_definitions WHERE key='AUTHORIZATION_VALIDITY_DAYS'")).toMatchObject([{ unit: "DAYS", min_value: 1, max_value: 365, default_value: 30, allows_service_scope: false }]);
      await pool.query("INSERT INTO policy_setting_definitions (key, unit, min_value, max_value, default_value, allows_service_scope) VALUES ('AUTHORIZATION_VALIDITY_DAYS','DAYS',1,365,30,false) ON CONFLICT DO NOTHING");
      expect(await rows("SELECT 1 FROM policy_setting_definitions WHERE key='AUTHORIZATION_VALIDITY_DAYS'")).toHaveLength(1);
      const columns = await rows("SELECT column_name FROM information_schema.columns WHERE table_name IN ('insurer_authorizations','insurer_authorization_events','insurer_auto_approval_rules')");
      expect(columns.filter((c) => /(^|_)(diagnos\w*|icd|cid|condition|symptom|clinical|anamnes\w*)(_|$)/i.test(String(c.column_name)))).toEqual([]);
    });

    it("CHECK do decisor, UNIQUE da regra ativa por alvo, FK composta entre seguradoras, UNIQUE de duplicado com APPROVED, SET NULL da atribuição", async () => {
      const ben = await newBeneficiary();
      const insert = (status: string, decidedBy: string | null, benId = ben.id) =>
        pool.query(
          "INSERT INTO insurer_authorizations (insurer_id, beneficiary_id, provider_id, service_id, guide_type, justification, requested_amount, authorized_amount, code, valid_until, expected_on, decision_due_at, created_at, updated_at, status, decided_by_kind, decision_note) VALUES ($1,$2,(SELECT id FROM insurer_providers WHERE insurer_id=$1 LIMIT 1),$3,'CONSULTATION','x',10,10,$4,now(),'2027-03-01',now(),now(),now(),$5,$6,'n')",
          [id.insA, benId, svc.ADM, randomUUID(), status, decidedBy],
        );
      await expect(insert("APPROVED", null)).rejects.toMatchObject({ code: "23514" });
      await insert("APPROVED", "ANALYST");
      await expect(insert("APPROVED", "SYSTEM")).rejects.toMatchObject({ code: "23505" }); // BR-AUT-09: a aprovação também bloqueia o duplicado
      await insert("REJECTED", "ANALYST"); // recusado liberta a chave

      const rule = (insurer: string, over: { kind?: string | null; service?: string | null; active?: boolean }) =>
        pool.query("INSERT INTO insurer_auto_approval_rules (insurer_id, name, service_kind_id, service_id, max_amount, active, created_at, updated_at) VALUES ($1,'r',$2,$3,100,$4,now(),now())", [insurer, over.kind ?? null, over.service ?? null, over.active ?? true]);
      await rule(id.insA, { service: svc.LAB });
      await expect(rule(id.insA, { service: svc.LAB })).rejects.toMatchObject({ code: "23505" });
      await rule(id.insA, { service: svc.LAB, active: false });
      await expect(rule(id.insA, { service: svc.BCONS })).rejects.toMatchObject({ code: "23503" }); // serviço de outra seguradora
      await expect(rule(id.insA, { kind: kindConsult, service: svc.LAB })).rejects.toMatchObject({ code: "23514" });
      await expect(rule(id.insA, {})).rejects.toMatchObject({ code: "23514" });
      await clearRules();

      const analyst = randomUUID();
      await pool.query("INSERT INTO insurance_accounts (id, insurer_id, email, password_hash, role) VALUES ($1,$2,'tmp@seg.pt','x','AUTHORIZATION_ANALYST')", [analyst, id.insA]);
      const target = (await rows("SELECT id FROM insurer_authorizations WHERE status='REJECTED' LIMIT 1"))[0]?.id;
      await pool.query("UPDATE insurer_authorizations SET assigned_to_insurance_account_id=$1 WHERE id=$2", [analyst, target]);
      await pool.query("DELETE FROM insurance_accounts WHERE id=$1", [analyst]);
      expect((await rows("SELECT assigned_to_insurance_account_id AS a FROM insurer_authorizations WHERE id=$1", [target]))[0]?.a).toBeNull();
      await pool.query("DELETE FROM insurer_authorizations WHERE beneficiary_id=$1", [ben.id]);
    });
  });

  // ------------------------------------------------------------------ regras (CRUD)
  describe("regras de auto-aprovação (TC-DEC-16, BR-AUT-23)", () => {
    it("CRUD pelo supervisor: um alvo, valor > 0, uma ativa por alvo (também sob corrida), PATCH sem alvo, DELETE idempotente, auditoria", async () => {
      const created = await createRule({ name: "Consultas", serviceId: svc.CONS, maxAmount: 300 });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const rule = as<Rule>(created);
      expect(rule).toMatchObject({ name: "Consultas", scope: "SERVICE", serviceId: svc.CONS, serviceKindId: null, targetName: "Serviço CONS", maxAmount: 300, currency: "AOA", active: true });

      for (const bad of [{ name: "x", maxAmount: 1 }, { name: "x", serviceId: svc.CONS, serviceKindId: kindConsult, maxAmount: 1 }, { name: "x", serviceId: svc.LAB, maxAmount: 0 }, { name: "", serviceId: svc.LAB, maxAmount: 1 }, { name: "x", serviceId: svc.LAB, maxAmount: 1, diagnosis: "x" }]) {
        expect([400, 422], JSON.stringify(bad)).toContain((await createRule(bad)).status);
      }
      expect((await createRule({ name: "Dup", serviceId: svc.CONS, maxAmount: 10 })).status).toBe(409);
      // serviço/tipo de outra seguradora ou inexistente ⇒ 422 sem cruzamento (TC-AZ-DEC-02)
      expect((await createRule({ name: "x", serviceId: svc.BCONS, maxAmount: 10 })).status).toBe(422);
      expect((await createRule({ name: "x", serviceKindId: randomUUID(), maxAmount: 10 })).status).toBe(422);
      expect((await createRule({ name: "x", serviceId: randomUUID(), maxAmount: 10 })).status).toBe(422);

      // sob corrida: exatamente uma ativa por alvo
      const race = await Promise.all([createRule({ name: "A", serviceKindId: kindInpatient, maxAmount: 10 }), createRule({ name: "B", serviceKindId: kindInpatient, maxAmount: 20 })]);
      expect(race.map((r) => r.status).sort()).toEqual([201, 409]);

      const patched = await ins("patch", `/auto-approval-rules/${rule.id}`, tokA.SUPERVISOR, { maxAmount: 400, name: "Consultas v2" });
      expect(patched.status).toBe(200);
      expect(as<Rule>(patched)).toMatchObject({ maxAmount: 400, name: "Consultas v2", serviceId: svc.CONS });
      expect([400, 422]).toContain((await ins("patch", `/auto-approval-rules/${rule.id}`, tokA.SUPERVISOR, { serviceId: svc.LAB })).status); // o alvo não se altera
      expect([400, 422]).toContain((await ins("patch", `/auto-approval-rules/${rule.id}`, tokA.SUPERVISOR, {})).status);
      // desativar, criar outra ativa no alvo e tentar reativar ⇒ 409
      expect(as<Rule>(await ins("patch", `/auto-approval-rules/${rule.id}`, tokA.SUPERVISOR, { active: false })).active).toBe(false);
      const second = as<Rule>(await createRule({ name: "Consultas 2", serviceId: svc.CONS, maxAmount: 50 }));
      expect((await ins("patch", `/auto-approval-rules/${rule.id}`, tokA.SUPERVISOR, { active: true })).status).toBe(409);
      expect((await ins("patch", `/auto-approval-rules/${randomUUID()}`, tokA.SUPERVISOR, { active: true })).status).toBe(404);
      expect((await ins("patch", `/auto-approval-rules/${rule.id}`, tokB.SUPERVISOR, { active: true })).status).toBe(404); // outra seguradora

      const list = as<Rule[]>(await ins("get", "/auto-approval-rules", tokA.AUTHORIZATION_ANALYST));
      expect(list.length).toBeGreaterThanOrEqual(3);
      expect(list.map((r) => r.active)).toEqual([...list.map((r) => r.active)].sort((x, y) => Number(y) - Number(x))); // ativas primeiro
      expect((await ins("get", "/auto-approval-rules", tokB.SUPERVISOR)).body).toEqual([]);

      expect((await ins("delete", `/auto-approval-rules/${second.id}`, tokA.SUPERVISOR)).status).toBe(204);
      expect((await ins("delete", `/auto-approval-rules/${second.id}`, tokA.SUPERVISOR)).status).toBe(204); // idempotente
      expect(await auditRows("AUTO_APPROVAL_RULE_DELETE", second.id)).toHaveLength(1); // só quando algo foi apagado
      expect(await auditRows("AUTO_APPROVAL_RULE_CREATE", rule.id)).toHaveLength(1);
      expect((await auditRows("AUTO_APPROVAL_RULE_UPDATE", rule.id))[0]?.metadata).toMatchObject({ insurerId: id.insA, scope: "SERVICE" });
      expect(JSON.stringify(await rows("SELECT metadata FROM audit_logs WHERE resource_type='AutoApprovalRule'"))).not.toContain("Consultas");
      await clearRules();
    });

    it("101.ª regra ⇒ 409 LIMIT_EXCEEDED", async () => {
      for (let i = 0; i < 100; i++) await pool.query("INSERT INTO insurer_auto_approval_rules (insurer_id, name, service_id, max_amount, active, created_at, updated_at) VALUES ($1,$2,$3,10,false,now(),now())", [id.insA, `r${String(i)}`, svc.LAB]);
      const res = await createRule({ name: "101", serviceId: svc.LAB, maxAmount: 10 });
      expect(res.status).toBe(409);
      expect(as<{ code: string }>(res).code).toBe("LIMIT_EXCEEDED");
      await clearRules();
    });
  });

  // ------------------------------------------------------------------ auto-aprovação
  describe("auto-aprovação na criação (TC-DEC-03, BR-AUT-03/07)", () => {
    it("regra ativa para o serviço ⇒ 201 APPROVED com código, valor, validade (política em dados), eventos, rasto e auditoria; a clínica não vê que foi automática", async () => {
      await createRule({ name: "Regra CANARIO-REGRA", serviceId: svc.CONS, maxAmount: 300 });
      const ben = await newBeneficiary({ linked: true });
      const exp = day(6);
      const res = await create(ben.card, { expectedOn: exp, justification: `Consulta ${CANARY}` });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      const auth = as<Auth>(res);
      expect(auth).toMatchObject({ status: "APPROVED", authorizedAmount: 250.5, partial: false, allowedActions: [] });
      expect(auth.code).toMatch(/^([2-9A-HJKMNP-Z]{4}-){6}[2-9A-HJKMNP-Z]{4}$/);
      expect(auth.validUntil).toBe(endOfDay(exp, 30)); // fim do dia de expectedOn + 30 d
      expect(res.body).not.toHaveProperty("decidedBy");
      expect(res.body).not.toHaveProperty("autoApproval");

      const events = await rows("SELECT from_status, to_status, actor_type FROM insurer_authorization_events WHERE authorization_id=$1 ORDER BY id", [auth.id]);
      expect(events).toEqual([
        { from_status: null, to_status: "SUBMITTED", actor_type: "CLINIC_ACCOUNT" },
        { from_status: "SUBMITTED", to_status: "APPROVED", actor_type: "SYSTEM" },
      ]);
      const row = (await rows("SELECT decided_by_kind, decided_by_insurance_account_id, assigned_to_insurance_account_id, auto_approval_trace FROM insurer_authorizations WHERE id=$1", [auth.id]))[0];
      expect(row).toMatchObject({ decided_by_kind: "SYSTEM", decided_by_insurance_account_id: null, assigned_to_insurance_account_id: null });
      expect(row?.auto_approval_trace).toMatchObject({ ok: true, ruleName: "Regra CANARIO-REGRA", checks: [{ check: "NOT_APPEAL", ok: true, reason: "OK" }, { check: "COVERED_REQUIRES_AUTHORIZATION" }, { check: "WITHIN_LIMIT" }, { check: "RULE_MATCH" }] });
      const audit = await auditRows("AUTHORIZATION_AUTO_APPROVE", auth.id);
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ actor_type: "SYSTEM" });
      expect(audit[0]?.metadata).toMatchObject({ insurerId: id.insA, checks: 4 });
      expect(JSON.stringify(audit)).not.toContain("CANARIO");

      // a clínica: decisão da seguradora (by=INSURER), sem rasto, sem decisor
      const clinicView = as<Auth & { timeline: { status: string; by: string }[] }>(await clinic("get", `/authorizations/${auth.id}`));
      expect(clinicView.timeline.map((e) => `${e.status}:${e.by}`)).toEqual(["SUBMITTED:CLINIC", "APPROVED:INSURER"]);
      expect(JSON.stringify(clinicView)).not.toMatch(/autoApproval|decidedBy|SYSTEM|escalatedAt|assignedTo|coverage|internalNote|CANARIO-REGRA/);

      // a seguradora vê o rasto e o decisor
      const detail = await get(auth.id);
      expect(detail).toMatchObject({ decidedBy: "SYSTEM", slaStatus: "MET" });
      expect(detail.autoApproval).toMatchObject({ ok: true, ruleName: "Regra CANARIO-REGRA" });
      expect(detail.timeline?.map((e) => `${e.status}:${e.by}`)).toEqual(["SUBMITTED:CLINIC", "APPROVED:SYSTEM"]);

      // duplicado de um APPROVED ⇒ 409, também sob concorrência (BR-AUT-09 emendado)
      expect((await create(ben.card, { expectedOn: exp })).status).toBe(409);
      // o analista não reverte a automática; o supervisor sim, e a clínica já não vê o código
      expect((await ins("post", `/authorizations/${auth.id}/cancel`, tokA.AUTHORIZATION_ANALYST, { reason: "x" })).status).toBe(403);
      expect((await ins("post", `/authorizations/${auth.id}/cancel`, tokA.SUPERVISOR, { reason: "Revisão" })).status).toBe(200);
      await clearRules();
    });

    it("sem regras, regra inativa, valor acima, carência e regra de tipo vs. de serviço ⇒ IN_REVIEW com rasto explicativo (ou aprovação por tipo)", async () => {
      const probe = async (over: Record<string, unknown> = {}) => {
        const ben = await newBeneficiary();
        const res = await create(ben.card, over);
        expect(res.status, JSON.stringify(res.body)).toBe(201);
        return as<Auth>(res);
      };
      const trace = async (authId: string) => (await get(authId)).autoApproval;
      const fails = (t: Auth["autoApproval"]) => (t?.checks ?? []).filter((c) => !c.ok).map((c) => `${c.check}:${c.reason}`);

      expect(fails(await trace((await probe()).id))).toEqual(["RULE_MATCH:NO_RULE_FOR_SERVICE"]);
      const inactive = as<Rule>(await createRule({ name: "Inativa", serviceId: svc.CONS, maxAmount: 1000, active: false }));
      expect(fails(await trace((await probe()).id))).toEqual(["RULE_MATCH:NO_RULE_FOR_SERVICE"]);
      await ins("patch", `/auto-approval-rules/${inactive.id}`, tokA.SUPERVISOR, { active: true, maxAmount: 250 });
      expect(fails(await trace((await probe()).id))).toEqual(["RULE_MATCH:AMOUNT_ABOVE_RULE_MAX"]); // 250,50 > 250
      expect(fails(await trace((await probe({ requestedAmount: 250 })).id))).toEqual([]); // = max aprova... (ver abaixo)
      await clearRules();

      // carência: nunca se auto-aprova, mesmo com regra generosa (Q-A1)
      await createRule({ name: "Carência", serviceId: svc.WAIT, maxAmount: 99999 });
      const waiting = await probe({ serviceCode: "WAIT" });
      expect(waiting.status).toBe("IN_REVIEW");
      expect(fails(await trace(waiting.id))).toEqual(["COVERED_REQUIRES_AUTHORIZATION:WAITING_PERIOD"]);
      await clearRules();

      // saldo: valor acima do teto anual ⇒ AMOUNT_ABOVE_LIMIT
      await createRule({ name: "Internamento", serviceKindId: kindInpatient, maxAmount: 99999 });
      expect(fails(await trace((await probe({ serviceCode: "ADM", requestedAmount: 1000.01 })).id))).toEqual(["WITHIN_LIMIT:AMOUNT_ABOVE_LIMIT"]);
      // regra do TIPO aprova; a do SERVIÇO precede e restringe
      const byKind = await probe({ serviceCode: "ADM", requestedAmount: 900 });
      expect(byKind.status).toBe("APPROVED");
      await clearRules();
      await createRule({ name: "Tipo", serviceKindId: kindConsult, maxAmount: 1000 });
      await createRule({ name: "Serviço", serviceId: svc.CONS, maxAmount: 10 });
      const restricted = await probe({ requestedAmount: 100 });
      expect(restricted.status).toBe("IN_REVIEW");
      expect((await trace(restricted.id))?.ruleName).toBe("Serviço");
      expect((await probe({ serviceCode: "CONS2", requestedAmount: 100 })).status).toBe("APPROVED"); // CONS2 só tem a regra do tipo
      await clearRules();
    });

    it("não é retroativa e nunca corre em recurso, resposta ou reabertura; a regra é dados (tipo fictício por SQL, sem código novo)", async () => {
      const { auth: pending } = await openRequest();
      const { auth: rejected } = await rejectedRequest();
      await createRule({ name: "Consultas", serviceId: svc.CONS, maxAmount: 99999 });
      expect((await get(pending.id)).status).toBe("IN_REVIEW"); // pedido anterior não é aprovado
      // recurso do recusado ⇒ sempre IN_REVIEW, sem rasto
      const appeal = await clinic("post", `/authorizations/${rejected.id}/appeals`, { justification: "Novo fundamento administrativo" });
      expect(appeal.status, JSON.stringify(appeal.body)).toBe(201);
      expect(as<Auth>(appeal).status).toBe("IN_REVIEW");
      expect((await get(as<Auth>(appeal).id)).autoApproval).toBeNull();
      await clearRules();

      // tipo fictício inserido por SQL + regra passam a auto-aprovar sem alterar código (§2.4)
      const fictional = (await rows("INSERT INTO insurer_service_kinds (insurer_id, code, name, guide_type, expense_type) VALUES ($1,'TELE','Teleconsulta','CONSULTATION','CONSULTATION') RETURNING id", [id.insA]))[0]?.id as string;
      const teleId = randomUUID();
      await pool.query("INSERT INTO insurer_services (id, insurer_id, code, name, status, service_kind_id) VALUES ($1,$2,'TELE1','Tele 1','ACTIVE',$3)", [teleId, id.insA, fictional]);
      await pool.query("INSERT INTO insurer_plan_coverages (insurer_id, plan_id, service_id, type, copay_pct, waiting_days, requires_authorization) VALUES ($1,$2,$3,'INCLUDED',100,0,true)", [id.insA, id.plan, teleId]);
      expect((await createRule({ name: "Tele", serviceKindId: fictional, maxAmount: 500 })).status).toBe(201);
      const ben = await newBeneficiary();
      const res = await create(ben.card, { serviceCode: "TELE1" });
      expect(as<Auth>(res).status).toBe("APPROVED");
      await clearRules();
    });
  });

  // ------------------------------------------------------------------ fila
  describe("fila (TC-DEC-04, BR-AUT-19)", () => {
    it("abertos por prazo ↑ com desempate por id, cursor sem repetidos nem omissões, SUBMITTED ausente, filtros e sort=RECENT", async () => {
      await pool.query("DELETE FROM insurer_authorizations");
      const made: Auth[] = [];
      for (let i = 0; i < 5; i++) made.push((await openRequest({ requestedAmount: 10 + i })).auth);
      // dois com o mesmo prazo (desempate por id) e um escalado, um em INFO_REQUESTED, um recurso
      await pool.query("UPDATE insurer_authorizations SET decision_due_at = decision_due_at - interval '3 days' WHERE id IN ($1,$2)", [made[3]?.id, made[4]?.id]);
      await pool.query("UPDATE insurer_authorizations SET decision_due_at = (SELECT decision_due_at FROM insurer_authorizations WHERE id=$1) WHERE id=$2", [made[3]?.id, made[4]?.id]);
      await ins("post", `/authorizations/${need(made[1]).id}/request-info`, tokA.AUTHORIZATION_ANALYST, { reason: "Falta o orçamento" });
      const submitted = (await openRequest()).auth;
      await pool.query("UPDATE insurer_authorizations SET status='SUBMITTED' WHERE id=$1", [submitted.id]);

      const all = as<{ items: Auth[]; nextCursor: string | null }>(await ins("get", "/authorizations?limit=100", tokA.AUTHORIZATION_ANALYST));
      expect(all.items.map((a) => a.id)).not.toContain(submitted.id);
      expect(all.items).toHaveLength(5);
      const keys = all.items.map((a) => `${a.decisionDueAt}|${a.id}`);
      expect(keys).toEqual([...keys].sort());
      // cursor de 2 em 2
      const seen: string[] = [];
      let cursor: string | null = null;
      for (let guard = 0; guard < 10; guard++) {
        const page: { items: Auth[]; nextCursor: string | null } = as(await ins("get", `/authorizations?limit=2${cursor ? `&cursor=${cursor}` : ""}`, tokA.SUPERVISOR));
        seen.push(...page.items.map((a) => a.id));
        cursor = page.nextCursor;
        if (!cursor) break;
      }
      expect(seen).toEqual(all.items.map((a) => a.id));
      expect(new Set(seen).size).toBe(seen.length);

      // filtros
      const ids = async (qs: string, token = tokA.SUPERVISOR) => as<{ items: Auth[] }>(await ins("get", `/authorizations?${qs}`, token)).items.map((a) => a.id);
      expect(await ids("status=INFO_REQUESTED")).toEqual([made[1]?.id]);
      expect(await ids("status=SUBMITTED")).toEqual([submitted.id]);
      expect((await ids("overdue=true")).sort()).toEqual([made[3]?.id, made[4]?.id].sort()); // os dois com o prazo recuado
      await pool.query("UPDATE insurer_authorizations SET escalated_at=now() WHERE id=$1", [made[0]?.id]);
      expect(await ids("escalated=true")).toEqual([made[0]?.id]);
      expect((await ids("escalated=false")).sort()).toEqual([made[1]?.id, made[2]?.id, made[3]?.id, made[4]?.id].sort());
      expect(await ids("appeal=true")).toEqual([]);
      expect(await ids("decidedBy=SYSTEM")).toEqual([]);
      await ins("post", `/authorizations/${need(made[2]).id}/assign`, tokA.AUTHORIZATION_ANALYST, {});
      expect((await ids("assigned=ME", tokA.AUTHORIZATION_ANALYST)).sort()).toEqual([made[1]?.id, made[2]?.id].sort()); // o pedido de informação também ficou com este analista
      expect(await ids("assigned=ME", tokA.ANALYST2)).toEqual([]);
      expect(await ids("assigned=UNASSIGNED")).not.toContain(made[2]?.id);
      const t0 = clock.now();
      clock.advance(10 * 86_400_000); // todos os IN_REVIEW passam o prazo (48 h)
      expect((await ids("overdue=true")).sort()).toEqual([made[0]?.id, made[2]?.id, made[3]?.id, made[4]?.id].sort()); // o INFO_REQUESTED não conta
      clock.set(t0);

      // RECENT: updatedAt decrescente
      await pool.query("UPDATE insurer_authorizations SET updated_at = now() + interval '1 hour' WHERE id=$1", [made[4]?.id]);
      const recent = as<{ items: Auth[] }>(await ins("get", "/authorizations?sort=RECENT&status=IN_REVIEW", tokA.SUPERVISOR)).items;
      expect(recent[0]?.id).toBe(made[4]?.id);
      // limit fora de 1–100 e parâmetros inválidos ⇒ 400
      for (const qs of ["limit=0", "limit=101", "status=XPTO", "assigned=X", "sort=Y", "overdue=talvez"]) expect((await ins("get", `/authorizations?${qs}`, tokA.SUPERVISOR)).status, qs).toBe(400);
      // isolamento: a seguradora B só vê as suas linhas
      expect(as<{ items: unknown[] }>(await ins("get", "/authorizations", tokB.INSURANCE_ADMIN)).items).toEqual([]);
      await pool.query("DELETE FROM insurer_authorizations");
    });
  });

  // ------------------------------------------------------------------ aprovar
  describe("aprovar (TC-DEC-05, BR-AUT-04/07/17)", () => {
    it("omissões (valor = pedido, validade da política), em parte com note, valor/validade inválidos, cobertura vermelha, código único, evento e auditoria sem texto", async () => {
      const exp = day(6);
      const { auth } = await openRequest({ expectedOn: exp, justification: `x ${CANARY}` });
      for (const bad of [{ authorizedAmount: 250.51 }, { authorizedAmount: 0 }, { authorizedAmount: -5 }, { authorizedAmount: 100 }, { validUntil: "2020-11-01T00:00:00Z" }, { validUntil: "2040-01-01T00:00:00Z" }, { diagnosis: "x" }, { note: "x".repeat(201) }]) {
        expect([400, 422], JSON.stringify(bad)).toContain((await approve(auth.id, tokA.AUTHORIZATION_ANALYST, bad)).status);
      }
      expect((await get(auth.id)).status).toBe("IN_REVIEW");

      const ok = await approve(auth.id, tokA.AUTHORIZATION_ANALYST, { overrideReason: undefined });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      const done = as<Auth>(ok);
      expect(done).toMatchObject({ status: "APPROVED", authorizedAmount: 250.5, partial: false, decidedBy: "ANALYST", slaStatus: "MET", expired: false });
      expect(done.validUntil).toBe(endOfDay(exp, 30));
      expect(done.assignedTo?.id).toBe(accA.AUTHORIZATION_ANALYST); // o analista que age num pedido livre fica com ele
      const events = await rows("SELECT from_status, to_status, actor_type, actor_role, actor_account_id, channel, internal_note FROM insurer_authorization_events WHERE authorization_id=$1 ORDER BY id DESC LIMIT 1", [auth.id]);
      expect(events[0]).toMatchObject({ from_status: "IN_REVIEW", to_status: "APPROVED", actor_type: "INSURANCE_ACCOUNT", actor_role: "ANALYST", actor_account_id: accA.AUTHORIZATION_ANALYST, channel: "PORTAL", internal_note: null });
      const audit = await auditRows("AUTHORIZATION_APPROVE", auth.id);
      expect(audit[0]?.metadata).toEqual({ insurerId: id.insA, decidedBy: "ANALYST", partial: false, override: false });
      expect(JSON.stringify(audit)).not.toContain(CANARY);
      // outra decisão sobre o mesmo ⇒ 409 INVALID_STATE_TRANSITION
      const again = await approve(auth.id, tokA.AUTHORIZATION_ANALYST);
      expect(again.status).toBe(409);
      expect(as<{ code: string }>(again).code).toBe("INVALID_STATE_TRANSITION");
      expect(as<{ code: string }>(await reject(auth.id, tokA.AUTHORIZATION_ANALYST)).code).toBe("INVALID_STATE_TRANSITION");

      // códigos únicos
      const second = as<Auth>(await approve((await openRequest()).auth.id, tokA.AUTHORIZATION_ANALYST));
      expect(second.code).not.toBe(done.code);
    });

    it("em parte exige note (visível à clínica); carência exige overrideReason INTERNO (a clínica não o vê)", async () => {
      const { auth } = await openRequest();
      expect((await approve(auth.id, tokA.AUTHORIZATION_ANALYST, { authorizedAmount: 100 })).status).toBe(422);
      const partial = as<Auth>(await approve(auth.id, tokA.AUTHORIZATION_ANALYST, { authorizedAmount: 100, note: "Só parte do valor" }));
      expect(partial).toMatchObject({ status: "APPROVED", authorizedAmount: 100, partial: true, decisionNote: "Só parte do valor" });
      const clinicView = as<{ partial: boolean; authorizedAmount: number; decisionNote: string }>(await clinic("get", `/authorizations/${auth.id}`));
      expect(clinicView).toMatchObject({ partial: true, authorizedAmount: 100, decisionNote: "Só parte do valor" });

      const waiting = (await openRequest({ serviceCode: "WAIT" })).auth;
      expect((await get(waiting.id)).coverage).toMatchObject({ reason: "WAITING_PERIOD", requiresAuthorization: false });
      expect((await approve(waiting.id, tokA.AUTHORIZATION_ANALYST, {})).status).toBe(422);
      const overridden = await approve(waiting.id, tokA.AUTHORIZATION_ANALYST, { overrideReason: `Exceção interna ${CANARY}` });
      expect(overridden.status, JSON.stringify(overridden.body)).toBe(200);
      const detail = await get(waiting.id);
      expect(detail.timeline?.find((e) => e.status === "APPROVED")?.internalNote).toContain(CANARY);
      expect(JSON.stringify((await clinic("get", `/authorizations/${waiting.id}`)).body)).not.toContain(CANARY);
      expect((await auditRows("AUTHORIZATION_APPROVE", waiting.id))[0]?.metadata).toMatchObject({ override: true });
    });

    it("valor acima do saldo (teto anual) ⇒ 422; cobertura que passou a vermelha ⇒ 422 coverage; validUntil indicada dentro dos limites ⇒ ok", async () => {
      const { auth } = await openRequest({ serviceCode: "ADM", requestedAmount: 1500 });
      const detail = await get(auth.id);
      expect(detail.coverage).toMatchObject({ remaining: 1000, limitPerYear: 1000 });
      const wanted = new Date(clock.now().getTime() + 20 * 86_400_000).toISOString();
      const over = await approve(auth.id, tokA.AUTHORIZATION_ANALYST, { authorizedAmount: 1000.01, note: "x" });
      expect(over.status).toBe(422);
      expect(as<{ errors: { field: string }[] }>(over).errors[0]?.field).toBe("authorizedAmount");
      const valid = await approve(auth.id, tokA.AUTHORIZATION_ANALYST, { authorizedAmount: 1000, note: "Até ao teto", validUntil: wanted });
      expect(valid.status, JSON.stringify(valid.body)).toBe(200);
      expect(as<Auth>(valid).validUntil).toBe(wanted);

      const red = (await openRequest()).auth;
      await pool.query("UPDATE insurer_services SET status='INACTIVE' WHERE id=$1", [svc.CONS]);
      const res = await approve(red.id, tokA.AUTHORIZATION_ANALYST);
      await pool.query("UPDATE insurer_services SET status='ACTIVE' WHERE id=$1", [svc.CONS]);
      expect(res.status).toBe(422);
      expect(as<{ errors: { field: string }[] }>(res).errors[0]?.field).toBe("coverage");
      expect((await reject(red.id, tokA.AUTHORIZATION_ANALYST)).status).toBe(200); // a seguradora recusa em vez de aprovar
    });

    it("2 decisões concorrentes ⇒ exatamente uma; a outra 409 INVALID_STATE_TRANSITION", async () => {
      const { auth } = await openRequest();
      const [a, b] = await Promise.all([approve(auth.id, tokA.AUTHORIZATION_ANALYST), reject(auth.id, tokA.AUTHORIZATION_ANALYST)]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      expect(as<{ code: string }>(a.status === 409 ? a : b).code).toBe("INVALID_STATE_TRANSITION");
      expect((await rows("SELECT count(*)::int AS n FROM insurer_authorization_events WHERE authorization_id=$1 AND to_status IN ('APPROVED','REJECTED')", [auth.id]))[0]?.n).toBe(1);
    });
  });

  // ------------------------------------------------------------------ recusar e pedir informação
  describe("recusar e pedir informação (TC-DEC-06, BR-AUT-14/17/20)", () => {
    it("reason obrigatório e visível à clínica; INFO_REQUESTED define infoExpiresAt por política; a resposta recalcula o prazo e limpa a escalada; estado errado ⇒ 409", async () => {
      const { auth } = await openRequest();
      for (const bad of [{}, { reason: "" }, { reason: "x".repeat(501) }, { reason: "x", icd: "J00" }]) expect([400, 422], JSON.stringify(bad)).toContain((await ins("post", `/authorizations/${auth.id}/request-info`, tokA.AUTHORIZATION_ANALYST, bad)).status);
      await pool.query("UPDATE insurer_authorizations SET escalated_at = now() WHERE id=$1", [auth.id]);
      const info = as<Auth>(await ins("post", `/authorizations/${auth.id}/request-info`, tokA.AUTHORIZATION_ANALYST, { reason: `Falta o orçamento ${CANARY}` }));
      expect(info).toMatchObject({ status: "INFO_REQUESTED", decisionNote: `Falta o orçamento ${CANARY}`, slaStatus: null });
      expect((need((await rows("SELECT info_expires_at FROM insurer_authorizations WHERE id=$1", [auth.id]))[0]?.info_expires_at) as Date).getTime()).toBe(clock.now().getTime() + 7 * 86_400_000);
      expect(as<Auth>(await clinic("get", `/authorizations/${auth.id}`))).toMatchObject({ status: "INFO_REQUESTED", decisionNote: `Falta o orçamento ${CANARY}` });
      expect((await auditRows("AUTHORIZATION_REQUEST_INFO", auth.id))[0]?.metadata).toEqual({ insurerId: id.insA });
      expect(JSON.stringify(await rows("SELECT metadata FROM audit_logs WHERE resource_id=$1", [auth.id]))).not.toContain(CANARY);
      // estado errado ⇒ 409
      expect((await ins("post", `/authorizations/${auth.id}/request-info`, tokA.AUTHORIZATION_ANALYST, { reason: "x" })).status).toBe(409);
      expect((await approve(auth.id, tokA.AUTHORIZATION_ANALYST)).status).toBe(409);

      // a clínica responde ⇒ IN_REVIEW, prazo recalculado, escalada limpa
      tick();
      const answered = await clinic("post", `/authorizations/${auth.id}/respond`, { message: "Orçamento anexo" });
      expect(answered.status, JSON.stringify(answered.body)).toBe(200);
      const after = await get(auth.id);
      expect(after.status).toBe("IN_REVIEW");
      expect(Date.parse(after.decisionDueAt)).toBe(clock.now().getTime() + 48 * 3_600_000);
      expect(after.escalatedAt).toBeNull();

      const rejected = as<Auth>(await reject(auth.id, tokA.AUTHORIZATION_ANALYST, `Fora de cobertura ${CANARY}`));
      expect(rejected).toMatchObject({ status: "REJECTED", decisionNote: `Fora de cobertura ${CANARY}`, decidedBy: "ANALYST", slaStatus: "MET" });
      expect(as<Auth>(await clinic("get", `/authorizations/${auth.id}`))).toMatchObject({ status: "REJECTED", decisionNote: `Fora de cobertura ${CANARY}` });
      expect((await auditRows("AUTHORIZATION_REJECT", auth.id))[0]?.metadata).toEqual({ insurerId: id.insA, decidedBy: "ANALYST" });
      expect(JSON.stringify(await rows("SELECT metadata FROM audit_logs WHERE resource_id=$1", [auth.id]))).not.toContain(CANARY);
    });

    it("o job INFO_TIMEOUT mantém-se para pedidos de informação feitos pela seguradora", async () => {
      const { auth } = await openRequest();
      await ins("post", `/authorizations/${auth.id}/request-info`, tokA.AUTHORIZATION_ANALYST, { reason: "Falta" });
      const t0 = clock.now();
      clock.advance(8 * 86_400_000);
      expect((await worker.expireInfoRequests()).expired).toBeGreaterThanOrEqual(1);
      expect(await get(auth.id)).toMatchObject({ status: "CANCELLED", closedReason: "INFO_TIMEOUT" });
      clock.set(t0);
    });
  });

  // ------------------------------------------------------------------ atribuição
  describe("atribuição (TC-DEC-07, BR-AUT-18)", () => {
    it("o analista toma um pedido livre; o 2.º ⇒ 409 CONFLICT; o supervisor atribui, reatribui e liberta; contas inválidas ⇒ 422; recurso ⇒ 409; sem evento de estado", async () => {
      const { auth } = await openRequest();
      const eventsBefore = Number((await rows("SELECT count(*)::int AS n FROM insurer_authorization_events WHERE authorization_id=$1", [auth.id]))[0]?.n);
      const taken = await ins("post", `/authorizations/${auth.id}/assign`, tokA.AUTHORIZATION_ANALYST, {});
      expect(taken.status, JSON.stringify(taken.body)).toBe(200);
      expect(as<Auth>(taken).assignedTo).toMatchObject({ id: accA.AUTHORIZATION_ANALYST });
      expect((await ins("post", `/authorizations/${auth.id}/assign`, tokA.ANALYST2, {})).status).toBe(409);
      expect(as<{ code: string }>(await ins("post", `/authorizations/${auth.id}/assign`, tokA.ANALYST2, {})).code).toBe("CONFLICT");
      expect((await approve(auth.id, tokA.ANALYST2)).status).toBe(409); // atribuído a outro: não decide
      expect((await ins("post", `/authorizations/${auth.id}/assign`, tokA.ANALYST2, { analystId: accA.AUTHORIZATION_ANALYST })).status).toBe(403); // só para si

      const reassigned = await ins("post", `/authorizations/${auth.id}/assign`, tokA.SUPERVISOR, { analystId: accA.ANALYST2 });
      expect(as<Auth>(reassigned).assignedTo).toMatchObject({ id: accA.ANALYST2 });
      expect(as<Auth>(await ins("post", `/authorizations/${auth.id}/assign`, tokA.SUPERVISOR, { analystId: null })).assignedTo).toBeNull();
      expect((await ins("post", `/authorizations/${auth.id}/assign`, tokA.SUPERVISOR, {})).status).toBe(422);
      // contas que não são analistas ativos da seguradora ⇒ 422
      const suspended = randomUUID();
      await pool.query("INSERT INTO insurance_accounts (id, insurer_id, email, password_hash, role, status) VALUES ($1,$2,'susp@seg.pt','x','AUTHORIZATION_ANALYST','SUSPENDED')", [suspended, id.insA]);
      for (const analystId of [accB.AUTHORIZATION_ANALYST, suspended, accA.SUPERVISOR2, accA.INSURANCE_ADMIN, randomUUID()]) expect((await ins("post", `/authorizations/${auth.id}/assign`, tokA.SUPERVISOR, { analystId })).status, analystId).toBe(422);
      // a marca não é estado: nenhum evento novo; auditada
      expect(Number((await rows("SELECT count(*)::int AS n FROM insurer_authorization_events WHERE authorization_id=$1", [auth.id]))[0]?.n)).toBe(eventsBefore);
      const audit = await auditRows("AUTHORIZATION_ASSIGN", auth.id);
      expect(audit.map((a) => (a.metadata as { assignedTo: string | null }).assignedTo)).toEqual([accA.AUTHORIZATION_ANALYST, accA.ANALYST2, null]);
      // outro estado ⇒ 409
      await approve(auth.id, tokA.AUTHORIZATION_ANALYST);
      expect((await ins("post", `/authorizations/${auth.id}/assign`, tokA.SUPERVISOR, { analystId: accA.AUTHORIZATION_ANALYST })).status).toBe(409);

      // lista de analistas atribuíveis: só ativos da própria seguradora (id e e-mail)
      const assignees = as<{ id: string; email: string }[]>(await ins("get", "/authorizations/assignees", tokA.SUPERVISOR));
      expect(assignees.map((a) => a.id).sort()).toEqual([accA.AUTHORIZATION_ANALYST, accA.ANALYST2].sort());
      expect(Object.keys(need(assignees[0])).sort()).toEqual(["email", "id"]);
      expect((await ins("get", "/authorizations/assignees", tokA.INSURANCE_ADMIN)).status).toBe(200);
      for (const role of ["AUTHORIZATION_ANALYST", "CLAIMS_MANAGER", "FINANCE_MANAGER", "BENEFICIARY_MANAGER", "INSURANCE_AGENT"] as const) expect((await ins("get", "/authorizations/assignees", tokA[role])).status, role).toBe(403);
    });

    it("recurso nunca se atribui (409); pedido de outra seguradora ⇒ 404", async () => {
      const { auth } = await rejectedRequest();
      const appealed = as<Auth>(await appeal(auth.id));
      expect((await ins("post", `/authorizations/${appealed.id}/assign`, tokA.SUPERVISOR, { analystId: accA.AUTHORIZATION_ANALYST })).status).toBe(409);
      expect((await ins("post", `/authorizations/${appealed.id}/assign`, tokA.AUTHORIZATION_ANALYST, {})).status).toBe(409);
      expect((await ins("post", `/authorizations/${auth.id}/assign`, tokB.SUPERVISOR, { analystId: accB.AUTHORIZATION_ANALYST })).status).toBe(404);
    });
  });

  // ------------------------------------------------------------------ separação de funções
  describe("separação de funções (TC-DEC-08, BR-AUT-18/22)", () => {
    it("analista em recurso ⇒ 403; supervisor em pedido normal ⇒ 403; o supervisor da recusa de origem ⇒ 403 e um 2.º decide; quem recusou o reaberto ⇒ 403", async () => {
      const { auth: normal } = await openRequest();
      for (const action of ["approve", "reject", "request-info"] as const) {
        expect((await ins("post", `/authorizations/${normal.id}/${action}`, tokA.SUPERVISOR, payloadOf(action))).status, action).toBe(403);
      }
      // cadeia: recusa pelo analista ⇒ recurso ⇒ analista 403 ⇒ supervisor decide (recusa) ⇒ novo recurso ⇒ o mesmo supervisor 403, outro decide
      const { auth: first } = await rejectedRequest();
      const appeal1 = as<Auth>(await appeal(first.id, "Recurso 1"));
      expect(appeal1).toMatchObject({ status: "IN_REVIEW", parentRequestId: first.id });
      const detail = await get(appeal1.id, tokA.AUTHORIZATION_ANALYST);
      expect(detail).toMatchObject({ isAppeal: true, allowedActions: ["DOWNLOAD_ATTACHMENT"] }); // o analista vê o recurso mas não o decide
      for (const action of ["approve", "reject", "request-info"] as const) expect((await ins("post", `/authorizations/${appeal1.id}/${action}`, tokA.AUTHORIZATION_ANALYST, payloadOf(action))).status, action).toBe(403);
      expect(Date.parse(detail.decisionDueAt)).toBe(Date.parse(need((await rows("SELECT created_at FROM insurer_authorizations WHERE id=$1", [appeal1.id]))[0]?.created_at as Date).toISOString()) + 72 * 3_600_000); // APPEAL_RESPONSE_HOURS

      // o supervisor S1 recusa o recurso (a origem foi do analista: pode)
      const s1 = as<Auth>(await reject(appeal1.id, tokA.SUPERVISOR, "Mantém-se a recusa"));
      expect(s1).toMatchObject({ status: "REJECTED", decidedBy: "SUPERVISOR" });
      const appeal2 = as<Auth>(await appeal(appeal1.id, "Recurso 2"));
      expect((await approve(appeal2.id, tokA.SUPERVISOR)).status).toBe(403); // S1 decidiu a recusa de origem
      expect((await get(appeal2.id, tokA.SUPERVISOR)).allowedActions).toEqual(["DOWNLOAD_ATTACHMENT"]);
      const second = await approve(appeal2.id, tokA.SUPERVISOR2);
      expect(second.status, JSON.stringify(second.body)).toBe(200);
      expect(as<Auth>(second)).toMatchObject({ status: "APPROVED", decidedBy: "SUPERVISOR" });
    });

    it("quem recusou um pedido reaberto não volta a decidi-lo; outro analista decide", async () => {
      const { auth } = await rejectedRequest(tokA.AUTHORIZATION_ANALYST);
      const reopened = await ins("post", `/authorizations/${auth.id}/reopen`, tokA.SUPERVISOR, { reason: "Documento novo" });
      expect(reopened.status, JSON.stringify(reopened.body)).toBe(200);
      expect(as<Auth>(reopened)).toMatchObject({ status: "IN_REVIEW", decidedBy: null, assignedTo: null, escalatedAt: null });
      expect((await approve(auth.id, tokA.AUTHORIZATION_ANALYST)).status).toBe(403);
      expect((await get(auth.id, tokA.AUTHORIZATION_ANALYST)).allowedActions).toEqual(["DOWNLOAD_ATTACHMENT"]);
      expect((await approve(auth.id, tokA.ANALYST2)).status).toBe(200);
    });

    it("Admin, Claims e Finance só leem (403 em qualquer escrita); Agent e BeneficiaryManager ⇒ 403 também na leitura", async () => {
      const { auth } = await openRequest();
      for (const role of ["INSURANCE_ADMIN", "CLAIMS_MANAGER", "FINANCE_MANAGER"] as const) {
        expect((await ins("get", `/authorizations/${auth.id}`, tokA[role])).status, role).toBe(200);
        expect((await ins("get", "/authorizations", tokA[role])).status, role).toBe(200);
        expect((await ins("get", "/authorizations/metrics", tokA[role])).status, role).toBe(200);
        for (const action of ["approve", "reject", "request-info", "cancel", "reopen", "assign"] as const) expect((await ins("post", `/authorizations/${auth.id}/${action}`, tokA[role], payloadOf(action))).status, `${role} ${action}`).toBe(403);
        expect((await get(auth.id, tokA[role])).allowedActions).toEqual([]);
      }
      for (const role of ["INSURANCE_AGENT", "BENEFICIARY_MANAGER"] as const) {
        expect((await ins("get", `/authorizations/${auth.id}`, tokA[role])).status, role).toBe(403);
        expect((await ins("get", "/authorizations", tokA[role])).status, role).toBe(403);
      }
    });
  });

  // ------------------------------------------------------------------ reverter e reabrir
  describe("reverter e reabrir (TC-DEC-09/10, BR-AUT-21/22)", () => {
    it("reverter: o analista só decisões suas; ANALYST_CANCELLED com reason visível; o código deixa de valer; a clínica continua sem poder cancelar; não-APPROVED ⇒ 409", async () => {
      const exp = day(9);
      const { auth, ben } = await openRequest({ expectedOn: exp });
      const approved = as<Auth>(await approve(auth.id, tokA.AUTHORIZATION_ANALYST));
      expect(approved.code).not.toBeNull();
      expect((await clinic("post", `/authorizations/${auth.id}/cancel`, {})).status).toBe(409); // BR-AUT-15
      for (const bad of [{}, { reason: "" }]) expect([400, 422]).toContain((await ins("post", `/authorizations/${auth.id}/cancel`, tokA.AUTHORIZATION_ANALYST, bad)).status);
      const reverted = await ins("post", `/authorizations/${auth.id}/cancel`, tokA.ANALYST2, { reason: `Erro de registo ${CANARY}` });
      expect(reverted.status, JSON.stringify(reverted.body)).toBe(200); // qualquer analista reverte uma decisão de analista
      expect(as<Auth>(reverted)).toMatchObject({ status: "CANCELLED", closedReason: "ANALYST_CANCELLED", decisionNote: `Erro de registo ${CANARY}`, code: null, validUntil: null, decidedBy: "ANALYST" });
      expect(as<Auth>(await clinic("get", `/authorizations/${auth.id}`))).toMatchObject({ status: "CANCELLED", closedReason: "ANALYST_CANCELLED", decisionNote: `Erro de registo ${CANARY}`, code: null });
      expect((await auditRows("AUTHORIZATION_REVERT", auth.id))[0]?.metadata).toEqual({ insurerId: id.insA, previousDecidedBy: "ANALYST" });
      expect(JSON.stringify(await rows("SELECT metadata FROM audit_logs WHERE resource_id=$1", [auth.id]))).not.toContain(CANARY);
      expect((await ins("post", `/authorizations/${auth.id}/cancel`, tokA.SUPERVISOR, { reason: "x" })).status).toBe(409);
      // a chave do duplicado foi libertada: novo pedido igual aceita
      expect((await create(ben.card, { expectedOn: exp })).status).toBe(201);
    });

    it("decisão de supervisor (recurso aprovado) só o supervisor reverte; o analista ⇒ 403", async () => {
      const { auth } = await rejectedRequest();
      const appealed = as<Auth>(await appeal(auth.id));
      expect((await approve(appealed.id, tokA.SUPERVISOR)).status).toBe(200);
      expect((await ins("post", `/authorizations/${appealed.id}/cancel`, tokA.AUTHORIZATION_ANALYST, { reason: "x" })).status).toBe(403);
      expect((await ins("post", `/authorizations/${appealed.id}/cancel`, tokA.SUPERVISOR2, { reason: "Revisão" })).status).toBe(200);
    });

    it("reabrir: só supervisor, REJECTED dentro do prazo, sem recurso vivo e sem duplicado; limpa decisão/atribuição/escalada; recalcula o prazo; sem auto-aprovação; motivo INTERNO", async () => {
      const { auth } = await rejectedRequest();
      expect((await ins("post", `/authorizations/${auth.id}/reopen`, tokA.AUTHORIZATION_ANALYST, { reason: "x" })).status).toBe(403);
      await pool.query("UPDATE insurer_authorizations SET escalated_at=now(), assigned_to_insurance_account_id=$2 WHERE id=$1", [auth.id, accA.AUTHORIZATION_ANALYST]);
      // com regra ativa, a reabertura NÃO auto-aprova
      await createRule({ name: "Consultas", serviceId: svc.CONS, maxAmount: 99999 });
      tick();
      const reopened = await ins("post", `/authorizations/${auth.id}/reopen`, tokA.SUPERVISOR, { reason: `Decisão revista ${CANARY}` });
      expect(reopened.status, JSON.stringify(reopened.body)).toBe(200);
      const view = as<Auth>(reopened);
      expect(view).toMatchObject({ status: "IN_REVIEW", decidedBy: null, assignedTo: null, escalatedAt: null, code: null, authorizedAmount: null, decisionNote: null });
      expect(Date.parse(view.decisionDueAt)).toBe(clock.now().getTime() + 48 * 3_600_000);
      expect(view.timeline?.at(-1)).toMatchObject({ status: "IN_REVIEW", by: "SUPERVISOR", note: null, internalNote: `Decisão revista ${CANARY}` });
      const clinicView = JSON.stringify((await clinic("get", `/authorizations/${auth.id}`)).body);
      expect(clinicView).not.toContain(CANARY);
      expect(JSON.stringify(await rows("SELECT metadata FROM audit_logs WHERE resource_id=$1", [auth.id]))).not.toContain(CANARY);
      expect((await auditRows("AUTHORIZATION_REOPEN", auth.id))).toHaveLength(1);
      expect((await ins("post", `/authorizations/${auth.id}/reopen`, tokA.SUPERVISOR, { reason: "x" })).status).toBe(409); // já IN_REVIEW
      await clearRules();

      // recurso vivo ⇒ 409 CONFLICT; fora de prazo ⇒ 409 INVALID_STATE_TRANSITION; duplicado em curso ⇒ 409 CONFLICT
      const { auth: withAppeal } = await rejectedRequest();
      await appeal(withAppeal.id, "Recurso");
      const conflict = await ins("post", `/authorizations/${withAppeal.id}/reopen`, tokA.SUPERVISOR, { reason: "x" });
      expect([conflict.status, as<{ code: string }>(conflict).code]).toEqual([409, "CONFLICT"]);
      const { auth: late } = await rejectedRequest();
      const tLate = clock.now();
      clock.advance(16 * 86_400_000);
      const outside = await ins("post", `/authorizations/${late.id}/reopen`, tokA.SUPERVISOR, { reason: "x" });
      clock.set(tLate);
      expect([outside.status, as<{ code: string }>(outside).code]).toEqual([409, "INVALID_STATE_TRANSITION"]);
      const exp = day(11);
      const { auth: dup, ben: dupBen } = await rejectedRequest(tokA.AUTHORIZATION_ANALYST, { expectedOn: exp });
      expect((await create(dupBen.card, { expectedOn: exp })).status).toBe(201); // pedido igual em curso
      const dupRes = await ins("post", `/authorizations/${dup.id}/reopen`, tokA.SUPERVISOR, { reason: "x" });
      expect([dupRes.status, as<{ code: string }>(dupRes).code]).toEqual([409, "CONFLICT"]);
    });
  });

  // ------------------------------------------------------------------ SLA e métricas
  describe("SLA e métricas (TC-DEC-11/12, BR-AUT-20, Q-V2 A)", () => {
    it("o job marca escalated_at nos IN_REVIEW com prazo passado; antes do prazo e INFO_REQUESTED nada; idempotente; NUNCA altera o estado; recurso usa APPEAL_RESPONSE_HOURS", async () => {
      await pool.query("DELETE FROM insurer_authorizations");
      const { auth: due } = await openRequest();
      const { auth: info } = await openRequest();
      await ins("post", `/authorizations/${info.id}/request-info`, tokA.AUTHORIZATION_ANALYST, { reason: "Falta" });
      const { auth: rejected } = await rejectedRequest();
      const appealed = as<Auth>(await appeal(rejected.id, "Recurso"));

      const t0 = clock.now();
      expect(await worker.flagSlaBreaches()).toEqual({ flagged: 0 }); // nada antes do prazo
      clock.advance(49 * 3_600_000); // > 48 h; o recurso (72 h) ainda não
      expect(await worker.flagSlaBreaches()).toEqual({ flagged: 1 }); // o pedido normal em atraso
      expect(await worker.flagSlaBreaches()).toEqual({ flagged: 0 }); // idempotente
      expect((await get(due.id)).escalatedAt).not.toBeNull();
      expect((await get(due.id))).toMatchObject({ status: "IN_REVIEW", slaStatus: "OVERDUE" });
      expect((await get(info.id)).escalatedAt).toBeNull();
      expect((await get(appealed.id)).escalatedAt).toBeNull();
      clock.advance(24 * 3_600_000); // 73 h depois do recurso
      expect(await worker.flagSlaBreaches()).toEqual({ flagged: 1 });
      expect((await get(appealed.id)).escalatedAt).not.toBeNull();

      const audit = await auditRows("AUTHORIZATION_SLA_BREACH", due.id);
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ actor_type: "SYSTEM", metadata: { insurerId: id.insA } });
      // 30 dias depois continua IN_REVIEW: nunca aprova nem recusa por silêncio
      clock.advance(30 * 86_400_000);
      await worker.flagSlaBreaches();
      expect((await get(due.id)).status).toBe("IN_REVIEW");
      expect((await rows("SELECT count(*)::int AS n FROM insurer_authorization_events WHERE authorization_id=$1 AND to_status IN ('APPROVED','REJECTED')", [due.id]))[0]?.n).toBe(0);
      clock.set(t0);
      await pool.query("DELETE FROM insurer_authorizations");
    });

    it("métricas: contagens abertas e do período sobre fixtures conhecidas; sem dados ⇒ null; to−from > 366 d ⇒ 422; só agregados", async () => {
      await pool.query("DELETE FROM insurer_authorizations");
      const t0 = clock.now();
      const empty = as<{ period: Record<string, unknown> }>(await ins("get", "/authorizations/metrics", tokA.SUPERVISOR));
      expect(empty.period).toMatchObject({ decided: 0, slaMetPct: null, autoApprovedPct: null, medianDecisionHours: null });

      await createRule({ name: "Auto", serviceId: svc.CONS2, maxAmount: 1000 });
      const autoBen = await newBeneficiary();
      expect(as<Auth>(await create(autoBen.card, { serviceCode: "CONS2" })).status).toBe("APPROVED");
      await clearRules();
      const a = (await openRequest()).auth; // aprovado dentro do prazo
      const r = (await openRequest()).auth; // recusado fora do prazo
      const open1 = (await openRequest()).auth; // fica aberto, em atraso
      const open2 = (await openRequest()).auth; // fica aberto, sem analista
      await ins("post", `/authorizations/${open2.id}/assign`, tokA.AUTHORIZATION_ANALYST, {});
      const info = (await openRequest()).auth;
      await ins("post", `/authorizations/${info.id}/request-info`, tokA.AUTHORIZATION_ANALYST, { reason: "Falta" });
      clock.advance(3_600_000);
      expect((await approve(a.id, tokA.AUTHORIZATION_ANALYST)).status).toBe(200);
      clock.advance(60 * 3_600_000);
      expect((await reject(r.id, tokA.AUTHORIZATION_ANALYST)).status).toBe(200);
      await worker.flagSlaBreaches();
      const m = as<{ open: Record<string, number>; period: Record<string, number | string | null> }>(await ins("get", "/authorizations/metrics", tokA.CLAIMS_MANAGER));
      expect(m.open).toEqual({ total: 3, unassigned: 1, overdue: 2, escalated: 2, infoRequested: 1 });
      expect(m.period).toMatchObject({ decided: 3, approved: 2, rejected: 1, autoApproved: 1, decidedWithinSla: 2, slaMetPct: 66.7, autoApprovedPct: 33.3 });
      expect(typeof m.period.medianDecisionHours).toBe("number");
      expect(Object.keys(m.period).sort()).toEqual(["approved", "autoApproved", "autoApprovedPct", "decided", "decidedWithinSla", "from", "medianDecisionHours", "rejected", "slaMetPct", "to"]);
      expect(open1.id).toBeDefined();
      for (const qs of ["from=2025-01-01&to=2026-11-14", "from=2026-11-14&to=2026-11-14", "from=2026-11-15&to=2026-11-14", "from=x"]) expect([400, 422], qs).toContain((await ins("get", `/authorizations/metrics?${qs}`, tokA.SUPERVISOR)).status);
      expect((await ins("get", "/authorizations/metrics?from=2026-11-14&to=2026-11-15", tokA.SUPERVISOR)).status).toBe(200);
      // isolamento: a seguradora B não vê nada
      expect(as<{ open: { total: number } }>(await ins("get", "/authorizations/metrics", tokB.INSURANCE_ADMIN)).open.total).toBe(0);
      clock.set(t0);
      await pool.query("DELETE FROM insurer_authorizations");
    });
  });

  // ------------------------------------------------------------------ validade derivada
  describe("validade e expiração derivada (TC-DEC-15, BR-AUT-07)", () => {
    it("AUTHORIZATION_VALIDITY_DAYS em dados muda o validUntil seguinte; expired deriva do relógio, sem job nem estado; coverage-phase com now ⇒ CLOSED", async () => {
      expect((await ins("put", "/policy-settings/AUTHORIZATION_VALIDITY_DAYS", tokA.SUPERVISOR, { value: 60 })).status).toBe(200);
      const exp = day(6);
      const { auth } = await openRequest({ expectedOn: exp }, true);
      const done = as<Auth>(await approve(auth.id, tokA.AUTHORIZATION_ANALYST));
      expect(done.validUntil).toBe(endOfDay(exp, 60)); // fim do dia de expectedOn + 60 d
      expect((await ins("put", "/policy-settings/AUTHORIZATION_VALIDITY_DAYS", tokA.SUPERVISOR, { value: 366 })).status).toBe(422);
      expect((await ins("delete", "/policy-settings/AUTHORIZATION_VALIDITY_DAYS", tokA.SUPERVISOR)).status).toBe(204);
      expect(done.expired).toBe(false);

      const processId = need((await rows("SELECT process_id FROM insurer_authorizations WHERE id=$1", [auth.id]))[0]?.process_id) as string;
      const phase = async () => (await ops.getCoverageFacts(db, id.family, [processId]))[0]?.fact.phase;
      expect(await phase()).toBe("APPROVED");
      const t0 = clock.now();
      clock.set(new Date(Date.parse(need(done.validUntil)) + 1000));
      expect((await get(auth.id)).expired).toBe(true);
      expect(await phase()).toBe("CLOSED");
      expect((await get(auth.id)).status).toBe("APPROVED"); // sem estado EXPIRED nem job
      clock.set(t0);
      // o valor por omissão (30 d) volta depois de apagar a definição da seguradora
      const next = as<Auth>(await approve((await openRequest({ expectedOn: exp })).auth.id, tokA.AUTHORIZATION_ANALYST));
      expect(next.validUntil).toBe(endOfDay(exp, 30));
    });
  });

  // ------------------------------------------------------------------ anexos
  describe("anexos na seguradora (TC-DEC-17, BR-AUT-13)", () => {
    it("analista e supervisor descarregam (no-store, attachment, auditoria sem o nome); os restantes só veem metadados; outro pedido ou seguradora ⇒ 404", async () => {
      const { auth } = await openRequest();
      tick();
      const upload = await clinic("post", `/authorizations/${auth.id}/attachments`).attach("file", PDF, "orçamento-CANARIO.pdf").field("kind", "QUOTE");
      expect(upload.status, JSON.stringify(upload.body)).toBe(201);
      const attachmentId = as<{ id: string }>(upload).id;
      const detail = await get(auth.id, tokA.INSURANCE_ADMIN);
      expect(detail.attachments?.map((a) => a.id)).toEqual([attachmentId]); // metadados
      for (const role of ["AUTHORIZATION_ANALYST", "SUPERVISOR"] as const) {
        const res = await ins("get", `/authorizations/${auth.id}/attachments/${attachmentId}`, tokA[role]).buffer(true).parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on("data", (c: Buffer) => chunks.push(c));
          r.on("end", () => { cb(null, Buffer.concat(chunks)); });
        });
        expect(res.status, role).toBe(200);
        expect(res.headers["cache-control"]).toBe("private, no-store");
        expect(res.headers["content-disposition"]).toMatch(/^attachment;/);
        expect(res.headers["content-type"]).toContain("application/pdf");
        expect((res.body as Buffer).equals(PDF)).toBe(true);
      }
      for (const role of ["INSURANCE_ADMIN", "CLAIMS_MANAGER", "FINANCE_MANAGER", "BENEFICIARY_MANAGER", "INSURANCE_AGENT"] as const) expect((await ins("get", `/authorizations/${auth.id}/attachments/${attachmentId}`, tokA[role])).status, role).toBe(403);
      const audit = await auditRows("AUTHORIZATION_ATTACHMENT_DOWNLOAD", auth.id);
      expect(audit).toHaveLength(2);
      expect(audit[0]?.metadata).toMatchObject({ insurerId: id.insA, kind: "QUOTE", sizeBytes: PDF.length });
      expect(JSON.stringify(audit)).not.toMatch(/CANARIO|orçamento/);
      // anexo de outro pedido, de outra seguradora ou inexistente ⇒ 404
      const { auth: other } = await openRequest();
      expect((await ins("get", `/authorizations/${other.id}/attachments/${attachmentId}`, tokA.SUPERVISOR)).status).toBe(404);
      expect((await ins("get", `/authorizations/${auth.id}/attachments/${attachmentId}`, tokB.SUPERVISOR)).status).toBe(404);
      expect((await ins("get", `/authorizations/${auth.id}/attachments/${randomUUID()}`, tokA.SUPERVISOR)).status).toBe(404);
    });
  });

  // ------------------------------------------------------------------ matriz, isolamento e conformidade
  describe("matriz e isolamento (TC-AZ-DEC-01..03, TC-DEC-21)", () => {
    const READ = ["INSURANCE_ADMIN", "AUTHORIZATION_ANALYST", "CLAIMS_MANAGER", "FINANCE_MANAGER", "SUPERVISOR"] as const;
    it("TC-AZ-DEC-01: leituras por papel (gerada da tabela §8.2d); escritas de regras só do supervisor; assignees só supervisor e admin", async () => {
      const { auth } = await openRequest();
      const expectations: [string, string, Record<Role, number>][] = [
        ["get", "/authorizations", { INSURANCE_ADMIN: 200, AUTHORIZATION_ANALYST: 200, CLAIMS_MANAGER: 200, FINANCE_MANAGER: 200, SUPERVISOR: 200, BENEFICIARY_MANAGER: 403, INSURANCE_AGENT: 403 }],
        ["get", "/authorizations/metrics", { INSURANCE_ADMIN: 200, AUTHORIZATION_ANALYST: 200, CLAIMS_MANAGER: 200, FINANCE_MANAGER: 200, SUPERVISOR: 200, BENEFICIARY_MANAGER: 403, INSURANCE_AGENT: 403 }],
        ["get", `/authorizations/${auth.id}`, { INSURANCE_ADMIN: 200, AUTHORIZATION_ANALYST: 200, CLAIMS_MANAGER: 200, FINANCE_MANAGER: 200, SUPERVISOR: 200, BENEFICIARY_MANAGER: 403, INSURANCE_AGENT: 403 }],
        ["get", "/auto-approval-rules", { INSURANCE_ADMIN: 200, AUTHORIZATION_ANALYST: 200, SUPERVISOR: 200, CLAIMS_MANAGER: 403, FINANCE_MANAGER: 403, BENEFICIARY_MANAGER: 403, INSURANCE_AGENT: 403 }],
        ["post", "/auto-approval-rules", { INSURANCE_ADMIN: 403, AUTHORIZATION_ANALYST: 403, SUPERVISOR: 201, CLAIMS_MANAGER: 403, FINANCE_MANAGER: 403, BENEFICIARY_MANAGER: 403, INSURANCE_AGENT: 403 }],
        ["put", "/policy-settings/INFO_REQUEST_EXPIRY_DAYS", { INSURANCE_ADMIN: 200, SUPERVISOR: 200, AUTHORIZATION_ANALYST: 403, CLAIMS_MANAGER: 403, FINANCE_MANAGER: 403, BENEFICIARY_MANAGER: 403, INSURANCE_AGENT: 403 }],
      ];
      for (const [method, path, perRole] of expectations) {
        for (const role of ROLES) {
          const payload = method === "post" ? { name: `m-${role}`, serviceId: svc.LAB, maxAmount: 5 } : method === "put" ? { value: 7 } : undefined;
          const res = await ins(method as Method, path, tokA[role], payload);
          expect(res.status, `${role} ${method} ${path}`).toBe(perRole[role]);
          if (res.status === 201) await clearRules();
        }
      }
      for (const role of ROLES) expect((await ins("delete", `/auto-approval-rules/${randomUUID()}`, tokA[role])).status, role).toBe(role === "SUPERVISOR" ? 204 : 403);
      expect(READ.length).toBe(5);
    });

    it("TC-AZ-DEC-02: pedido, anexo, regra e conta de outra seguradora ⇒ 404/422 sem cruzamento; módulo desativado ⇒ 404; a fila só tem linhas próprias", async () => {
      const { auth } = await openRequest();
      for (const [method, path, payload] of [
        ["get", `/authorizations/${auth.id}`, undefined],
        ["post", `/authorizations/${auth.id}/approve`, {}],
        ["post", `/authorizations/${auth.id}/reject`, { reason: "x" }],
        ["post", `/authorizations/${auth.id}/request-info`, { reason: "x" }],
        ["post", `/authorizations/${auth.id}/cancel`, { reason: "x" }],
        ["post", `/authorizations/${auth.id}/reopen`, { reason: "x" }],
        ["post", `/authorizations/${auth.id}/assign`, {}],
      ] as [Method, string, unknown][]) {
        for (const token of [tokB.AUTHORIZATION_ANALYST, tokB.SUPERVISOR, tokB.INSURANCE_ADMIN]) expect((await ins(method, path, token, payload)).status, `${method} ${path}`).toBe(token === tokB.INSURANCE_ADMIN && method !== "get" ? 403 : 404);
      }
      expect((await ins("get", "/authorizations", tokOff)).status).toBe(404);
      expect((await ins("get", "/authorizations/metrics", tokOff)).status).toBe(404);
      expect((await ins("get", "/auto-approval-rules", tokOff)).status).toBe(404);
      expect((await createRule({ name: "x", serviceId: svc.LAB, maxAmount: 5 }, tokOff)).status).toBe(404);
      const own = as<{ items: Auth[] }>(await ins("get", "/authorizations?limit=100", tokA.SUPERVISOR)).items;
      expect(own.length).toBeGreaterThan(0);
      expect(as<{ items: Auth[] }>(await ins("get", "/authorizations?limit=100", tokB.SUPERVISOR)).items).toEqual([]);
    });

    it("TC-AZ-DEC-03 / TC-DEC-21: token de User ou de clínica nas rotas da seguradora ⇒ 401; a clínica não ganha acesso nem vê decisor, rasto, notas internas, atribuição, escalada ou cobertura; sem token ⇒ 401", async () => {
      const { auth } = await openRequest();
      await ins("post", `/authorizations/${auth.id}/assign`, tokA.AUTHORIZATION_ANALYST, {});
      for (const token of [tokClinic, tokUser, undefined]) {
        expect((await ins("get", "/authorizations", token)).status).toBe(401);
        expect((await ins("get", `/authorizations/${auth.id}`, token)).status).toBe(401);
        expect((await ins("post", `/authorizations/${auth.id}/approve`, token, {})).status).toBe(401);
        expect((await ins("get", "/auto-approval-rules", token)).status).toBe(401);
      }
      const view = JSON.stringify((await clinic("get", `/authorizations/${auth.id}`)).body);
      expect(view).not.toMatch(/decidedBy|autoApproval|internalNote|assignedTo|escalatedAt|coverage|slaStatus|originDecider|accountId/);
    });

    it("TC-DEC-13: a resposta da seguradora não tem ids de utilizador/família/membro nem processId; auto_approval_trace só tem códigos, ids e o nome da regra", async () => {
      await createRule({ name: "Consultas", serviceId: svc.CONS, maxAmount: 99999 });
      const linked = await newBeneficiary({ linked: true });
      const auth = as<Auth>(await create(linked.card));
      await clearRules();
      const queue = JSON.stringify((await ins("get", "/authorizations?limit=100&status=APPROVED", tokA.SUPERVISOR)).body);
      const detail = JSON.stringify((await ins("get", `/authorizations/${auth.id}`, tokA.SUPERVISOR)).body);
      for (const body of [queue, detail]) {
        expect(body).not.toContain(id.family);
        expect(body).not.toContain(id.user);
        expect(body).not.toContain(linked.memberId);
        expect(body).not.toMatch(/processId|familyId|memberId|userId/);
      }
      const trace = (await rows("SELECT auto_approval_trace AS t FROM insurer_authorizations WHERE id=$1", [auth.id]))[0]?.t as { ok: boolean; ruleId: string; ruleName: string; checks: { check: string; ok: boolean; reason: string }[] };
      expect(Object.keys(trace).sort()).toEqual(["checks", "ok", "ruleId", "ruleName"]);
      for (const check of trace.checks) {
        expect(Object.keys(check).sort()).toEqual(["check", "ok", "reason"]);
        expect(check.reason).toMatch(/^[A-Z_]+$/);
      }
    });
  });
});
