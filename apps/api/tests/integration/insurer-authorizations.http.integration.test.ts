// HTTP + PostgreSQL real (testcontainers) da fatia 3 do marco B (ADR-034, BR-AUT-01..16): migração 0039, as 8 rotas
// `/clinic-portal/authorizations*`, o semáforo na elegibilidade, o job `insurer.expire-info-requests`, as portas reais com
// `processes` (abrir/validar processo, factos de cobertura) e os anexos (antivírus fake). O supertest valida PEDIDOS e RESPOSTAS
// contra docs/05-api/openapi.yaml (`validateResponses`). As decisões do analista são da fatia 4 (`insurer-decisions.http.integration.test.ts`):
// aqui os estados `APPROVED`, `REJECTED` e `INFO_REQUESTED` ainda se obtêm por FIXTURE (SQL; desde a `0040` com `decided_by_kind`).
import { randomUUID } from "node:crypto";
import { join, dirname } from "node:path";
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
import { openApiSpecPath } from "../support/openapi-spec.js";
import { createLogger } from "../../src/platform/logger/index.js";
import type { Storage } from "../../src/platform/storage/index.js";
import { createAuditModule } from "../../src/modules/audit/index.js";
import { signClinicAccessToken } from "../../src/modules/clinics/domain/clinic-jwt.js";
import { KyselyClinicsRepository } from "../../src/modules/clinics/infrastructure/repo.js";
import { createClinicActorContextMiddleware, createClinicBearerAuthSecurityHandler } from "../../src/modules/clinics/interface/clinic-portal-middleware.js";
import { createInsurerSettingsReader } from "../../src/modules/insurance/index.js";
import { createInsurerOpsModule, createInsurerOpsWorkerModule } from "../../src/modules/insurer-ops/index.js";
import { createGetActFactsUseCase as createAppointmentFacts } from "../../src/modules/appointments/application/act-facts.js";
import { KyselyAppointmentActFactsSource } from "../../src/modules/appointments/infrastructure/repo.js";
import { KyselyAuditRepository } from "../../src/modules/audit/infrastructure/repo.js";
import { FakeAccessPolicy } from "../../src/modules/processes/application/fixtures.js";
import { createGetProcessUseCase } from "../../src/modules/processes/application/get-process.js";
import { createGetClinicProcessUseCase } from "../../src/modules/processes/application/get-clinic-process.js";
import { createFindProcessForClinicUseCase, createOpenProcessUseCase } from "../../src/modules/processes/application/link-process.js";
import { createListProcessesUseCase } from "../../src/modules/processes/application/list-processes.js";
import type { ProcessesDeps } from "../../src/modules/processes/application/ports.js";
import { KyselyProcessesRepository } from "../../src/modules/processes/infrastructure/repo.js";
import { createAttachmentFiles } from "../../src/main/attachment-files.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const NOW = new Date("2026-11-14T10:00:00.000Z");
const API = "/api/v1/clinic-portal";
const KEYS = [{ kid: "k1", secret: new TextEncoder().encode("0123456789abcdef0123456789abcdef") }];
const SESSION = randomUUID();
const CANARY = "CANARIO-JUSTIFICACAO-7731";
const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(64, 1)]);

const id = {
  insA: randomUUID(),
  insB: randomUUID(),
  insOff: randomUUID(), // módulo desativado
  clinicX: randomUUID(),
  clinicY: randomUUID(),
  accAdmin: randomUUID(),
  accManager: randomUUID(),
  accDoctor: randomUUID(),
  accY: randomUUID(),
  plan: randomUUID(),
  planB: randomUUID(),
  user: randomUUID(),
  family: randomUUID(),
  member: randomUUID(),
  otherMember: randomUUID(),
  holder: randomUUID(),
  benLinked: randomUUID(),
  benFree: randomUUID(),
  benSuspended: randomUUID(),
  benB: randomUUID(),
  professional: randomUUID(),
};
const svc = { CONS: randomUUID(), LAB: randomUUID(), EXC: randomUUID(), WAIT: randomUUID(), ADM: randomUUID(), UNCL: randomUUID(), OFF: randomUUID(), BCONS: randomUUID() };

interface Auth {
  id: string;
  status: string;
  guideType: string;
  processId: string | null;
  parentRequestId: string | null;
  allowedActions: string[];
  decisionDueAt: string;
  currency: string;
  attachments: { id: string }[];
  timeline?: { status: string; by: string; note: string | null }[];
  appealOpenUntil: string | null;
  closedReason: string | null;
}

describe("integração: pedido de autorização pelo prestador (marco B fatia 3)", () => {
  let container: StartedTestContainer;
  let pool: Pool;
  let db: Kysely<Database>;
  let app: ReturnType<typeof createApp>;
  let ops: ReturnType<typeof createInsurerOpsModule>;
  let worker: ReturnType<typeof createInsurerOpsWorkerModule>;
  const clock = new FixedClock(NOW);
  const tok = {} as Record<"admin" | "manager" | "doctor" | "y", string>;
  const stored = new Map<string, Buffer>();
  let scannerDown = false;
  const storage: Storage = {
    putObject: (key, body) => {
      stored.set(key, body);
      return Promise.resolve();
    },
    getObject: () => Promise.reject(new Error("não usado")),
    deleteObject: (key) => {
      stored.delete(key);
      return Promise.resolve();
    },
    copyObject: () => Promise.resolve(),
  };
  const virusScanner = {
    scan: (buffer: Buffer) => (scannerDown ? Promise.reject(new Error("clamav em baixo")) : Promise.resolve(buffer.includes("EICAR") ? ("INFECTED" as const) : ("CLEAN" as const))),
  };

  /** Valor obrigatório (falha o teste, não o linter). */
  const need = <T>(value: T | null | undefined): T => {
    if (value === null || value === undefined) throw new Error("valor em falta");
    return value;
  };
  const rows = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows as Record<string, unknown>[];
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- asserção de tipo do corpo de teste
  const as = <T>(res: { body: unknown }): T => res.body as T;
  const tick = () => { clock.advance(11 * 60 * 1000); }; // fora da janela do rate limit (10 min)
  const call = (method: "get" | "post" | "delete", path: string, token: string | undefined) => {
    let r = request(app)[method](`${API}${path}`);
    if (token) r = r.set("Authorization", token);
    return r;
  };
  const send = (method: "get" | "post" | "delete", path: string, token: string | undefined, body?: unknown) => (body === undefined ? call(method, path, token) : call(method, path, token).send(body as object));
  const day = (offset: number) => new Date(clock.now().getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  let nextCard = 0;
  /** Beneficiário novo (cartão único) com a apólice do plano; `link` liga-o ao membro. */
  const newBeneficiary = async (over: { status?: string; linked?: boolean; policy?: boolean } = {}) => {
    const benId = randomUUID();
    const memberId = randomUUID();
    const card = `VF-${String(++nextCard)}`;
    // Um beneficiário ligado por membro (índice único): cada um tem o seu membro na mesma família.
    if (over.linked) await pool.query("INSERT INTO family_members (id, family_id, name, birth_date, is_dependent) VALUES ($1,$2,'Membro','1990-01-01',false)", [memberId, id.family]);
    await pool.query("INSERT INTO insurer_beneficiaries (id, insurer_id, name, id_document_type, id_document_number, birth_date, relationship, card_number, status, family_id, family_member_id) VALUES ($1,$2,$3,'BI',$4,'1980-01-01','HOLDER',$5,$6,$7,$8)", [
      benId,
      id.insA,
      `Beneficiario ${String(nextCard)}`,
      `DOC-${String(nextCard)}`,
      card,
      over.status ?? "ACTIVE",
      over.linked ? id.family : null,
      over.linked ? memberId : null,
    ]);
    if (over.policy !== false) await pool.query("INSERT INTO insurer_policies (insurer_id, plan_id, holder_id, number, valid_from, valid_to, status) VALUES ($1,$2,$3,$4,'2026-01-01','2026-12-31','ACTIVE')", [id.insA, id.plan, benId, `AP-${String(nextCard)}`]);
    return { id: benId, card, doc: `DOC-${String(nextCard)}`, memberId };
  };
  /** Corpo de pedido base (AMARELO: CONS exige autorização); `over` sobrepõe. */
  const body = (card: string, over: Record<string, unknown> = {}) => ({ insurerId: id.insA, cardNumber: card, serviceCode: "CONS", requestedAmount: 250.5, expectedOn: day(6), justification: "Consulta pedida pelo serviço de saúde da empresa", ...over });
  const create = (card: string, over: Record<string, unknown> = {}, token = tok.admin) => {
    tick();
    return send("post", "/authorizations", token, body(card, over));
  };
  const openRequest = async (over: { linked?: boolean; service?: string } = {}) => {
    const ben = await newBeneficiary({ linked: over.linked ?? false });
    const res = await create(ben.card, over.service ? { serviceCode: over.service } : {});
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return { ben, auth: as<Auth>(res) };
  };
  const setState = (authId: string, sql: string, params: unknown[] = []) => pool.query(`UPDATE insurer_authorizations SET ${sql} WHERE id = $1`, [authId, ...params]);
  const asRejected = (authId: string, decidedAt: Date) => setState(authId, "status='REJECTED', decided_by_kind='ANALYST', decision_note='Fora de cobertura', decided_at=$2", [decidedAt]);
  const asInfoRequested = (authId: string, expires: Date) => setState(authId, "status='INFO_REQUESTED', decision_note='Falta o orçamento', info_expires_at=$2", [expires]);

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
    await pool.query("INSERT INTO family_members (id, family_id, user_id, name, birth_date, role) VALUES ($1,$2,$3,'Ana','1990-01-01','FAMILY_ADMIN')", [id.member, id.family, id.user]);
    await pool.query("INSERT INTO family_members (id, family_id, name, birth_date, is_dependent) VALUES ($1,$2,'Outro','2015-01-01',true)", [id.otherMember, id.family]);
    await pool.query("INSERT INTO insurer_accounts (id, name, tax_id, operational_module_enabled, currency) VALUES ($1,'Seg A','500000001',true,'AOA'), ($2,'Seg B','500000002',true,'USD'), ($3,'Seg Off','500000003',false,'AOA')", [id.insA, id.insB, id.insOff]);
    await pool.query("INSERT INTO clinics (id, type, name) VALUES ($1,'PARTNER','Clínica X'), ($2,'PARTNER','Clínica Y')", [id.clinicX, id.clinicY]);
    await pool.query("INSERT INTO clinic_professionals (id, clinic_id, name) VALUES ($1,$2,'Dr. Medico')", [id.professional, id.clinicX]);
    const account = (accId: string, clinic: string, email: string, role: string, professional: string | null) => pool.query("INSERT INTO clinic_accounts (id, clinic_id, email, password_hash, role, professional_id) VALUES ($1,$2,$3,'x',$4,$5)", [accId, clinic, email, role, professional]);
    await account(id.accAdmin, id.clinicX, "admin@x.pt", "CLINIC_ADMIN", null);
    await account(id.accManager, id.clinicX, "manager@x.pt", "CLINIC_MANAGER", null);
    await account(id.accDoctor, id.clinicX, "doctor@x.pt", "CLINIC_DOCTOR", id.professional);
    await account(id.accY, id.clinicY, "admin@y.pt", "CLINIC_ADMIN", null);
    await pool.query("INSERT INTO insurer_providers (insurer_id, clinic_id, name) VALUES ($1,$2,'X'), ($1,$3,'Y'), ($4,$2,'X em B'), ($5,$2,'X em Off')", [id.insA, id.clinicX, id.clinicY, id.insB, id.insOff]);
    const sign = async (accId: string) => `Bearer ${(await signClinicAccessToken({ subject: { clinicAccountId: accId, sessionId: SESSION }, now: NOW, ttlSeconds: 30 * 86_400, signingKeys: KEYS })).token}`;
    tok.admin = await sign(id.accAdmin);
    tok.manager = await sign(id.accManager);
    tok.doctor = await sign(id.accDoctor);
    tok.y = await sign(id.accY);

    // Catálogo da seguradora A: tipos de serviço (guia deduzida), serviços e o plano com coberturas.
    const kind = async (insurer: string, code: string, guide: string, expense: string) => (await rows("INSERT INTO insurer_service_kinds (insurer_id, code, name, guide_type, expense_type) VALUES ($1,$2,$2,$3,$4) RETURNING id", [insurer, code, guide, expense]))[0]?.id as string;
    const kConsult = await kind(id.insA, "CONSULTATION", "CONSULTATION", "CONSULTATION");
    const kDiag = await kind(id.insA, "DIAGNOSTICS", "SERVICES", "DIAGNOSTICS");
    const kAdm = await kind(id.insA, "INPATIENT", "ADMISSION", "INPATIENT");
    const service = (insurer: string, sid: string, code: string, kindId: string | null, status = "ACTIVE") => pool.query("INSERT INTO insurer_services (id, insurer_id, code, name, status, service_kind_id) VALUES ($1,$2,$3,$4,$5,$6)", [sid, insurer, code, `Serviço ${code}`, status, kindId]);
    await service(id.insA, svc.CONS, "CONS", kConsult);
    await service(id.insA, svc.LAB, "LAB", kDiag);
    await service(id.insA, svc.EXC, "EXC", kConsult);
    await service(id.insA, svc.WAIT, "WAIT", kDiag);
    await service(id.insA, svc.ADM, "ADM", kAdm);
    await service(id.insA, svc.UNCL, "UNCL", null);
    await service(id.insA, svc.OFF, "OFF", kConsult, "INACTIVE");
    await pool.query("INSERT INTO insurer_plans (id, insurer_id, name, status) VALUES ($1,$2,'Plano Ouro','ACTIVE'), ($3,$4,'Plano B','ACTIVE')", [id.plan, id.insA, id.planB, id.insB]);
    const coverage = (sid: string, type: string, copay: number, waiting: number, auth: boolean) =>
      pool.query("INSERT INTO insurer_plan_coverages (insurer_id, plan_id, service_id, type, copay_pct, waiting_days, requires_authorization) VALUES ($1,$2,$3,$4,$5,$6,$7)", [id.insA, id.plan, sid, type, copay, waiting, auth]);
    await coverage(svc.CONS, "INCLUDED", 80, 0, true);
    await coverage(svc.LAB, "INCLUDED", 100, 0, false); // VERDE
    await coverage(svc.EXC, "EXCLUDED", 0, 0, false); // VERMELHO
    await coverage(svc.WAIT, "INCLUDED", 70, 330, false); // carência até 2026-11-27: AMARELO antes, VERDE depois
    await coverage(svc.ADM, "INCLUDED", 90, 0, true);
    await coverage(svc.UNCL, "INCLUDED", 90, 0, true);
    await coverage(svc.OFF, "INCLUDED", 90, 0, true);
    await pool.query("INSERT INTO insurer_services (id, insurer_id, code, name) VALUES ($1,$2,'CONS','Consulta B')", [svc.BCONS, id.insB]);
    await pool.query("INSERT INTO insurer_beneficiaries (id, insurer_id, name, id_document_type, id_document_number, birth_date, relationship, card_number, status) VALUES ($1,$2,'Ben B','BI','B-1','1980-01-01','HOLDER','VB-1','ACTIVE')", [id.benB, id.insB]);
    await pool.query("INSERT INTO insurer_policies (insurer_id, plan_id, holder_id, number, valid_from, valid_to, status) VALUES ($1,$2,$3,'APB-1','2026-01-01','2026-12-31','ACTIVE')", [id.insB, id.planB, id.benB]);

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
    processesDeps = procDeps;
    ops = createInsurerOpsModule({
      db,
      audit,
      clock,
      insurers: createInsurerSettingsReader(),
      claimCodeSecret: "segredo-de-teste-dos-codigos",
      partnerClinics: { list: (trx, query) => new KyselyClinicsRepository().listPartnerDirectory(trx, query), find: (trx, clinicId) => new KyselyClinicsRepository().findPartnerDirectoryEntry(trx, clinicId) },
      patientAccess: { authorize: () => Promise.reject(new Error("rotas do paciente não usadas aqui")) },
      processes: { open: createOpenProcessUseCase(procDeps), findForClinic: createFindProcessForClinicUseCase(procDeps) },
      files: createAttachmentFiles({ storage, virusScanner }),
    });
    worker = createInsurerOpsWorkerModule({ db, audit, clock, boss: {} as never });
    const clinicActor = createClinicActorContextMiddleware({
      resolveClinicActorState: async (clinicAccountId, sessionId) => {
        const row = (await rows("SELECT clinic_id, role, status, professional_id FROM clinic_accounts WHERE id=$1", [clinicAccountId]))[0] as { clinic_id: string; role: "CLINIC_ADMIN"; status: string; professional_id: string | null };
        return { clinicAccountId, sessionId, clinicId: row.clinic_id, role: row.role, suspended: row.status !== "ACTIVE", ...(row.professional_id ? { professionalId: row.professional_id } : {}) };
      },
    });
    app = createApp({
      openApiSpecPath: openApiSpecPath(REPO_ROOT),
      logger: createLogger({ level: "silent" }),
      validateResponses: true,
      securityHandlers: {
        bearerAuth: () => Promise.resolve(false),
        clinicBearerAuth: createClinicBearerAuthSecurityHandler({ signingKeys: KEYS, clock }),
        insuranceBearerAuth: () => Promise.resolve(false),
      },
      actorContextMiddleware: (req: Request, res: Response, next: NextFunction) => {
        const handler: RequestHandler = clinicActor;
        handler(req, res, next);
      },
      registerHealthRoutes: (router) => {
        router.get("/health", (_req, res) => res.json({ status: "ok" }));
      },
      registerRoutes: (router) => {
        router.use(ops.router);
      },
    });
  }, 240_000);
  let processesDeps: ProcessesDeps<Kysely<Database>>;

  afterAll(async () => {
    await pool.end();
    await container.stop();
  });

  // ------------------------------------------------------------------ migração 0039 e esquema sem dados clínicos
  describe("migração 0039 (TC-AUT-17)", () => {
    it("TC-AUT-17: nenhuma coluna clínica nas tabelas novas; enums com os valores do contrato", async () => {
      const columns = await rows("SELECT table_name, column_name FROM information_schema.columns WHERE table_name IN ('insurer_authorizations','insurer_authorization_events','insurer_attachments')");
      expect(columns.length).toBeGreaterThan(30);
      // Palavras inteiras do nome da coluna (`decided_at` não é «cid»; o regex do contrato apanhava-o por engano).
      expect(columns.filter((c) => /(^|_)(diagnos\w*|icd|cid|condition|symptom|clinical|anamnes\w*)(_|$)/i.test(String(c.column_name)))).toEqual([]);
      expect((await rows("SELECT unnest(enum_range(NULL::authorization_status))::text AS v")).map((r) => r.v)).toEqual(["SUBMITTED", "IN_REVIEW", "INFO_REQUESTED", "APPROVED", "REJECTED", "CANCELLED"]);
      expect((await rows("SELECT unnest(enum_range(NULL::process_origin_type))::text AS v")).map((r) => r.v)).toContain("AUTHORIZATION");
      expect((await rows("SELECT unnest(enum_range(NULL::process_kind))::text AS v")).map((r) => r.v)).toContain("AUTHORIZED");
    });

    it("TC-AZ-AUT-04: a BD rejeita referências cruzadas entre seguradoras (FK composta)", async () => {
      const bad = (benId: string, serviceId: string, insurer = id.insA) =>
        pool.query("INSERT INTO insurer_authorizations (insurer_id, beneficiary_id, provider_id, service_id, guide_type, justification, requested_amount, expected_on, decision_due_at, created_at, updated_at, status) VALUES ($1,$2,(SELECT id FROM insurer_providers WHERE insurer_id=$1 LIMIT 1),$3,'CONSULTATION','x',1,'2026-12-01',now(),now(),now(),'IN_REVIEW')", [insurer, benId, serviceId]);
      await expect(bad(id.benB, svc.CONS)).rejects.toMatchObject({ code: "23503" });
      const ben = await newBeneficiary();
      await expect(bad(ben.id, svc.BCONS)).rejects.toMatchObject({ code: "23503" });
    });
  });

  // ------------------------------------------------------------------ criar
  describe("criar (TC-AUT-02..08, UC-SEG-06)", () => {
    it("TC-AUT-02: serviço AMARELO ⇒ 201 IN_REVIEW, 2 eventos PORTAL, guia deduzida, moeda e prazo da seguradora, auditoria sem texto livre", async () => {
      const ben = await newBeneficiary();
      const res = await create(ben.card, { justification: `Consulta ${CANARY}` });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      const auth = as<Auth>(res);
      expect(auth).toMatchObject({ status: "IN_REVIEW", guideType: "CONSULTATION", currency: "AOA", allowedActions: ["CANCEL", "ATTACH"], processId: null });
      expect(Date.parse(auth.decisionDueAt)).toBe(clock.now().getTime() + 48 * 3_600_000);
      const events = await rows("SELECT from_status, to_status, actor_type, channel FROM insurer_authorization_events WHERE authorization_id=$1 ORDER BY id", [auth.id]);
      expect(events).toEqual([
        { from_status: null, to_status: "SUBMITTED", actor_type: "CLINIC_ACCOUNT", channel: "PORTAL" },
        { from_status: "SUBMITTED", to_status: "IN_REVIEW", actor_type: "SYSTEM", channel: "PORTAL" },
      ]);
      const audit = await rows("SELECT actor_type, actor_clinic_account_id, metadata FROM audit_logs WHERE action='AUTHORIZATION_SUBMIT' AND resource_id=$1", [auth.id]);
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ actor_type: "CLINIC_ACCOUNT", actor_clinic_account_id: id.accAdmin });
      expect(audit[0]?.metadata).toMatchObject({ insurerId: id.insA, guideType: "CONSULTATION", light: "YELLOW", appeal: false, hasProcess: false });
      expect(JSON.stringify(audit)).not.toContain(CANARY);
      expect(JSON.stringify(audit)).not.toContain(ben.card);
    });

    it("TC-AUT-03: VERDE, VERMELHO (excluído, inativo, desconhecido) ⇒ o MESMO 422 sem razão; carência e data decidem o semáforo", async () => {
      const ben = await newBeneficiary();
      const rejections = [] as { field: string | undefined; detail: unknown }[];
      for (const serviceCode of ["LAB", "EXC", "OFF", "NAO-EXISTE"]) {
        const res = await create(ben.card, { serviceCode });
        expect(res.status, serviceCode).toBe(422);
        const problem = as<{ detail: string; errors?: { field: string }[] }>(res);
        rejections.push({ field: problem.errors?.[0]?.field, detail: problem.detail });
      }
      expect(new Set(rejections.map((r) => JSON.stringify(r))).size).toBe(1);
      expect(rejections[0]?.field).toBe("serviceCode");
      expect(JSON.stringify(rejections)).not.toMatch(/exclu|plano|cobertura|carência/i);
      // carência: antes do fim ⇒ AMARELO (cria); depois ⇒ coberto sem autorização ⇒ VERDE ⇒ 422
      expect((await create(ben.card, { serviceCode: "WAIT", expectedOn: "2026-11-20" })).status).toBe(201);
      expect((await create(ben.card, { serviceCode: "WAIT", expectedOn: "2026-11-30" })).status).toBe(422);
    });

    it("TC-AUT-04 / TC-AZ-AUT-02: cartão inexistente, inelegível, QR inválido, documento desconhecido ⇒ o MESMO 404; exatamente um identificador", async () => {
      const suspended = await newBeneficiary({ status: "SUSPENDED" });
      const noPolicy = await newBeneficiary({ policy: false });
      const probes = [{ cardNumber: "NAO-EXISTE" }, { cardNumber: suspended.card }, { cardNumber: noPolicy.card }, { qrToken: "lixo.lixo.lixo" }, { idDocument: { type: "BI", number: "DESCONHECIDO" } }];
      const problems = [] as unknown[];
      for (const probe of probes) {
        tick();
        const res = await send("post", "/authorizations", tok.admin, { insurerId: id.insA, serviceCode: "CONS", requestedAmount: 10, expectedOn: day(3), justification: "x", ...probe });
        expect(res.status, JSON.stringify(probe)).toBe(404);
        const problem = as<Record<string, unknown>>(res);
        delete problem.instance;
        delete problem.requestId;
        problems.push(problem);
      }
      expect(new Set(problems.map((p) => JSON.stringify(p))).size).toBe(1);
      const two = await create("x", { qrToken: "y" });
      expect(two.status).toBe(422);
      expect((await send("post", "/authorizations", tok.admin, { ...body("x"), cardNumber: undefined })).status).toBe(422);
    });

    it("TC-AUT-04: o rate limit é PARTILHADO com a elegibilidade (por conta) ⇒ 429 + Retry-After; nunca regista o identificador", async () => {
      tick();
      const probe = { cardNumber: "RATE-LIMIT-CANARIO" };
      let status = 0;
      let last: Awaited<ReturnType<typeof send>> | undefined;
      for (let i = 0; i < 31 && status !== 429; i++) {
        last = await send("post", `/insurers/${id.insA}/eligibility`, tok.manager, probe);
        status = last.status;
      }
      expect(status).toBe(429);
      expect(last?.headers["retry-after"]).toBeDefined();
      const res = await send("post", "/authorizations", tok.manager, body("OUTRO"));
      expect(res.status).toBe(429);
      expect(JSON.stringify(await rows("SELECT metadata FROM audit_logs WHERE action='ELIGIBILITY_CHECK'"))).not.toContain("RATE-LIMIT-CANARIO");
      tick();
    });

    it("TC-AUT-05: guia deduzida do serviço; override para código ativo; inexistente/inativo ⇒ 422; sem kind ⇒ 422, com guideType ⇒ cria; o pedido guarda a guia", async () => {
      const ben = await newBeneficiary();
      expect(as<Auth>(await create(ben.card, { serviceCode: "ADM" })).guideType).toBe("ADMISSION");
      expect((await create(ben.card, { serviceCode: "CONS", guideType: "SERVICES", expectedOn: day(7) })).status).toBe(201);
      for (const guideType of ["NAO_EXISTE", "consulta"]) expect((await create(ben.card, { guideType, expectedOn: day(8) })).status, guideType).toBe(422);
      await pool.query("UPDATE guide_types SET active=false WHERE code='ADMISSION'");
      expect((await create(ben.card, { serviceCode: "CONS", guideType: "ADMISSION", expectedOn: day(9) })).status).toBe(422);
      await pool.query("UPDATE guide_types SET active=true WHERE code='ADMISSION'");
      expect((await create(ben.card, { serviceCode: "UNCL" })).status).toBe(422);
      const withGuide = await create(ben.card, { serviceCode: "UNCL", guideType: "SERVICES" });
      expect(withGuide.status).toBe(201);
      // reclassificar depois o serviço não altera o guardado
      await pool.query("UPDATE insurer_service_kinds SET guide_type='SERVICES' WHERE insurer_id=$1 AND code='CONSULTATION'", [id.insA]);
      expect((await rows("SELECT guide_type FROM insurer_authorizations WHERE id=$1", [as<Auth>(withGuide).id]))[0]?.guide_type).toBe("SERVICES");
      await pool.query("UPDATE insurer_service_kinds SET guide_type='CONSULTATION' WHERE insurer_id=$1 AND code='CONSULTATION'", [id.insA]);
    });

    it("TC-AUT-06 / TC-AZ-AUT-01: validação sem efeito; campos clínicos rejeitados; Médico ⇒ 403; sem token ⇒ 401", async () => {
      const ben = await newBeneficiary();
      const before = Number((await rows("SELECT count(*)::int AS n FROM insurer_authorizations"))[0]?.n);
      for (const over of [{ justification: "" }, { justification: "x".repeat(501) }, { requestedAmount: 0 }, { requestedAmount: 1e13 }, { requestedAmount: 10.123 }, { expectedOn: day(-1) }, { expectedOn: "amanhã" }, { diagnosis: "x" }, { icd: "J00" }]) {
        expect([400, 422], JSON.stringify(over)).toContain((await create(ben.card, over)).status);
      }
      expect((await create(ben.card, {}, tok.doctor)).status).toBe(403);
      expect((await send("post", "/authorizations", undefined, body(ben.card))).status).toBe(401);
      expect(Number((await rows("SELECT count(*)::int AS n FROM insurer_authorizations"))[0]?.n)).toBe(before);
    });

    it("TC-AUT-07: ligação ao Process — sem processId e beneficiário ligado abre AUTHORIZATION/AUTHORIZED; não ligado ⇒ sem processo; processId do ato liga sem abrir", async () => {
      const linked = await newBeneficiary({ linked: true });
      const first = as<Auth>(await create(linked.card));
      expect(first.processId).not.toBeNull();
      const process = (await rows("SELECT kind, origin_type, origin_id, clinic_id, family_id, member_id FROM processes WHERE id=$1", [first.processId]))[0];
      expect(process).toMatchObject({ kind: "AUTHORIZED", origin_type: "AUTHORIZATION", origin_id: first.id, clinic_id: id.clinicX, family_id: id.family, member_id: linked.memberId });
      const opened = (await rows("SELECT actor_type, actor_clinic_account_id, metadata FROM audit_logs WHERE action='PROCESS_OPEN' AND resource_id=$1", [first.processId]))[0];
      expect(opened).toMatchObject({ actor_type: "CLINIC_ACCOUNT", actor_clinic_account_id: id.accAdmin });
      expect(opened?.metadata).toMatchObject({ originType: "AUTHORIZATION" });
      // (f) 2.º pedido com o mesmo processId ⇒ 1 : N
      const second = as<Auth>(await create(linked.card, { serviceCode: "ADM", processId: first.processId }));
      expect(second.processId).toBe(first.processId);
      expect(Number((await rows("SELECT count(*)::int AS n FROM processes WHERE origin_type='AUTHORIZATION'"))[0]?.n)).toBeGreaterThan(0);
      // (d) não ligado
      expect((await openRequest()).auth.processId).toBeNull();
      // (a) processId do ato da própria clínica e do mesmo membro: liga sem abrir processo novo
      const appointmentProcess = randomUUID();
      const appointmentId = randomUUID();
      await pool.query("INSERT INTO processes (id, family_id, member_id, kind, origin_type, origin_id, clinic_id, opened_at) VALUES ($1,$2,$3,'ROUTINE','APPOINTMENT',$4,$5,now())", [appointmentProcess, id.family, linked.memberId, appointmentId, id.clinicX]);
      const before = Number((await rows("SELECT count(*)::int AS n FROM processes"))[0]?.n);
      const withAct = as<Auth>(await create(linked.card, { serviceCode: "UNCL", guideType: "SERVICES", processId: appointmentProcess }));
      expect(withAct.processId).toBe(appointmentProcess);
      expect(Number((await rows("SELECT count(*)::int AS n FROM processes"))[0]?.n)).toBe(before);
      // (b) inexistente, de outra clínica ou de outro membro ⇒ a MESMA mensagem 422
      const otherClinicProcess = randomUUID();
      const otherMemberProcess = randomUUID();
      await pool.query("INSERT INTO processes (id, family_id, member_id, kind, origin_type, origin_id, clinic_id, opened_at) VALUES ($1,$2,$3,'ROUTINE','APPOINTMENT',$4,$5,now()), ($6,$2,$7,'ROUTINE','APPOINTMENT',$8,$9,now())", [otherClinicProcess, id.family, linked.memberId, randomUUID(), id.clinicY, otherMemberProcess, id.otherMember, randomUUID(), id.clinicX]);
      const details = new Set<string>();
      for (const processId of [randomUUID(), otherClinicProcess, otherMemberProcess]) {
        const res = await create(linked.card, { processId, expectedOn: day(10) });
        expect(res.status).toBe(422);
        details.add(JSON.stringify(as<{ detail: string; errors: unknown }>(res).errors));
      }
      expect(details.size).toBe(1);
    });

    it("TC-AUT-07 (e): falha ao abrir o processo ⇒ nenhum pedido nem evento (transação única)", async () => {
      const linked = await newBeneficiary({ linked: true });
      const before = Number((await rows("SELECT count(*)::int AS n FROM insurer_authorizations"))[0]?.n);
      await pool.query("CREATE FUNCTION fail_process_insert() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'falha simulada'; END $$ LANGUAGE plpgsql");
      await pool.query("CREATE TRIGGER fail_process_insert BEFORE INSERT ON processes FOR EACH ROW EXECUTE FUNCTION fail_process_insert()");
      try {
        expect((await create(linked.card)).status).toBe(500);
      } finally {
        await pool.query("DROP TRIGGER fail_process_insert ON processes");
        await pool.query("DROP FUNCTION fail_process_insert()");
      }
      expect(Number((await rows("SELECT count(*)::int AS n FROM insurer_authorizations"))[0]?.n)).toBe(before);
      expect(await rows("SELECT 1 FROM audit_logs WHERE action='AUTHORIZATION_SUBMIT' AND metadata->>'serviceId' = $1 AND created_at > $2", [svc.CONS, new Date(clock.now().getTime() - 1000)]).catch(() => [])).toEqual([]);
    });

    it("TC-AUT-08: duplicado em curso ⇒ 409; dois pedidos concorrentes ⇒ exatamente um; depois de CANCELLED/REJECTED aceita", async () => {
      const ben = await newBeneficiary();
      tick();
      const [a, b] = await Promise.all([send("post", "/authorizations", tok.admin, body(ben.card)), send("post", "/authorizations", tok.manager, body(ben.card))]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      const winner = as<Auth>(a.status === 201 ? a : b);
      expect((await create(ben.card)).status).toBe(409);
      expect((await send("post", `/authorizations/${winner.id}/cancel`, tok.admin, {})).status).toBe(200);
      const again = await create(ben.card);
      expect(again.status).toBe(201);
      await asRejected(as<Auth>(again).id, clock.now());
      expect((await create(ben.card)).status).toBe(201);
    });
  });
  
  // ------------------------------------------------------------------ elegibilidade com semáforo
  describe("elegibilidade com semáforo (TC-COV-15, BR-SEG-43)", () => {
    const eligibility = (payload: object, token = tok.admin) => {
      tick();
      return send("post", `/insurers/${id.insA}/eligibility`, token, payload);
    };

    it("com serviceCode ativo e eligible ⇒ light + patientSharePct (100 − copayPct; nulo se VERMELHO); sem serviceCode a resposta é a de antes", async () => {
      const ben = await newBeneficiary();
      const light = async (serviceCode: string) => {
        const res = await eligibility({ cardNumber: ben.card, serviceCode });
        expect(res.status).toBe(200);
        return as<{ light?: string; patientSharePct?: number | null; coverages: unknown[] }>(res);
      };
      expect(await light("CONS")).toMatchObject({ light: "YELLOW", patientSharePct: 20 });
      expect(await light("LAB")).toMatchObject({ light: "GREEN", patientSharePct: 0 });
      expect(await light("EXC")).toMatchObject({ light: "RED", patientSharePct: null });
      expect(await light("WAIT")).toMatchObject({ light: "YELLOW", patientSharePct: 30 });
      expect(await light("OFF")).not.toHaveProperty("light"); // inativo: não é código ATIVO da lista
      const plain = as<Record<string, unknown>>(await eligibility({ cardNumber: ben.card }));
      expect(plain).not.toHaveProperty("light");
      expect(plain).not.toHaveProperty("patientSharePct");
      const refused = as<Record<string, unknown>>(await eligibility({ cardNumber: "NAO-EXISTE", serviceCode: "CONS" }));
      expect(Object.keys(refused).sort()).toEqual(["eligible", "notice"]);
      const full = await light("CONS");
      expect(Object.keys(full).sort()).toEqual(["beneficiaryName", "coverages", "currency", "eligible", "light", "notice", "patientSharePct", "planName", "status", "validFrom", "validTo"]);
      expect(JSON.stringify(full)).not.toMatch(/balance|reserved|usedAmount|reason|NOT_IN_PLAN|LIMIT_EXHAUSTED/i);
    });
  });

  // ------------------------------------------------------------------ listar, ver, responder, cancelar
  describe("listar, ver, responder e cancelar (TC-AUT-09..11)", () => {
    it("TC-AUT-09: ordem createdAt desc com cursor sem repetidos, filtros OPEN/estado/insurerId/processId; allowedActions por estado; timeline", async () => {
      const made = [] as Auth[];
      for (let i = 0; i < 3; i++) made.push((await openRequest()).auth);
      const [pending, info, rejected] = made as [Auth, Auth, Auth];
      await asInfoRequested(info.id, new Date(clock.now().getTime() + 5 * 86_400_000));
      await asRejected(rejected.id, new Date(clock.now().getTime() - 2 * 86_400_000));
      const detail = async (authId: string) => as<Auth>(await send("get", `/authorizations/${authId}`, tok.manager));
      expect((await detail(pending.id)).allowedActions).toEqual(["CANCEL", "ATTACH"]);
      expect((await detail(info.id)).allowedActions).toEqual(["RESPOND", "CANCEL", "ATTACH"]);
      const rej = await detail(rejected.id);
      expect(rej.allowedActions).toEqual(["APPEAL"]);
      expect(Date.parse(rej.appealOpenUntil ?? "")).toBe(clock.now().getTime() - 2 * 86_400_000 + 15 * 86_400_000);
      expect(JSON.stringify(rej.timeline)).not.toMatch(/internal|analyst|analista/i);
      const all: string[] = [];
      let cursor: string | null = null;
      do {
        const page: { body: { items: Auth[]; nextCursor: string | null } } = await send("get", `/authorizations?limit=4${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, tok.admin);
        all.push(...page.body.items.map((i) => i.id));
        cursor = page.body.nextCursor;
      } while (cursor);
      expect(new Set(all).size).toBe(all.length);
      const created = (await rows("SELECT a.id FROM insurer_authorizations a JOIN insurer_providers p ON p.id=a.provider_id WHERE p.clinic_id=$1 ORDER BY a.created_at DESC, a.id DESC", [id.clinicX])).map((r) => r.id);
      expect(all).toEqual(created);
      const openOnes = as<{ items: Auth[] }>(await send("get", "/authorizations?status=OPEN&limit=100", tok.admin)).items;
      expect(openOnes.every((a) => ["SUBMITTED", "IN_REVIEW", "INFO_REQUESTED"].includes(a.status))).toBe(true);
      expect(as<{ items: Auth[] }>(await send("get", `/authorizations?status=REJECTED&insurerId=${id.insA}&limit=100`, tok.admin)).items.map((a) => a.id)).toContain(rejected.id);
      expect(as<{ items: Auth[] }>(await send("get", `/authorizations?insurerId=${id.insB}`, tok.admin)).items).toEqual([]);
      expect((await send("get", "/authorizations?status=INVENTADO", tok.admin)).status).toBe(400);
    });

    it("TC-AUT-09 / TC-AZ-AUT-03: a leitura mantém-se com a ligação suspensa e o módulo desativado; as escritas ⇒ 404", async () => {
      const { auth } = await openRequest();
      await pool.query("UPDATE insurer_providers SET status='SUSPENDED' WHERE insurer_id=$1 AND clinic_id=$2", [id.insA, id.clinicX]);
      try {
        expect((await send("get", `/authorizations/${auth.id}`, tok.admin)).status).toBe(200);
        expect(as<{ items: Auth[] }>(await send("get", "/authorizations?limit=100", tok.admin)).items.map((a) => a.id)).toContain(auth.id);
        expect((await send("post", `/authorizations/${auth.id}/cancel`, tok.admin, {})).status).toBe(404);
        expect((await send("post", `/authorizations/${auth.id}/attachments`, tok.admin).attach("file", PDF, "a.pdf").field("kind", "QUOTE")).status).toBe(404);
        expect((await create((await newBeneficiary()).card)).status).toBe(404);
      } finally {
        await pool.query("UPDATE insurer_providers SET status='ACTIVE' WHERE insurer_id=$1 AND clinic_id=$2", [id.insA, id.clinicX]);
      }
      await pool.query("UPDATE insurer_accounts SET operational_module_enabled=false WHERE id=$1", [id.insA]);
      try {
        expect((await send("get", `/authorizations/${auth.id}`, tok.admin)).status).toBe(200);
        expect((await send("post", `/authorizations/${auth.id}/cancel`, tok.admin, {})).status).toBe(404);
      } finally {
        await pool.query("UPDATE insurer_accounts SET operational_module_enabled=true WHERE id=$1", [id.insA]);
      }
    });

    it("TC-AUT-10: responder só em INFO_REQUESTED ⇒ IN_REVIEW, novo prazo, infoExpiresAt nulo, evento com a nota; senão 409; vazia ⇒ 422", async () => {
      const { auth } = await openRequest();
      expect((await send("post", `/authorizations/${auth.id}/respond`, tok.admin, { message: "ok" })).status).toBe(409);
      await asInfoRequested(auth.id, new Date(clock.now().getTime() + 3 * 86_400_000));
      expect((await send("post", `/authorizations/${auth.id}/respond`, tok.admin, { message: " " })).status).toBe(422);
      tick();
      const res = await send("post", `/authorizations/${auth.id}/respond`, tok.admin, { message: `Segue o orçamento ${CANARY}` });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const after = as<Auth>(res);
      expect(after).toMatchObject({ status: "IN_REVIEW", allowedActions: ["CANCEL", "ATTACH"] });
      expect(Date.parse(after.decisionDueAt)).toBe(clock.now().getTime() + 48 * 3_600_000);
      expect((await rows("SELECT info_expires_at FROM insurer_authorizations WHERE id=$1", [auth.id]))[0]?.info_expires_at).toBeNull();
      expect(after.timeline?.at(-1)).toMatchObject({ status: "IN_REVIEW", by: "CLINIC", note: `Segue o orçamento ${CANARY}` });
      const audit = await rows("SELECT metadata FROM audit_logs WHERE action='AUTHORIZATION_INFO_RESPOND' AND resource_id=$1", [auth.id]);
      expect(audit).toHaveLength(1);
      expect(JSON.stringify(audit)).not.toContain(CANARY);
    });

    it("TC-AUT-11: cancelar pendente ⇒ CANCELLED/CLINIC_CANCELLED; APPROVED, REJECTED, CANCELLED ⇒ 409; auditoria", async () => {
      const { auth } = await openRequest();
      const res = await send("post", `/authorizations/${auth.id}/cancel`, tok.manager, { note: "paciente desistiu" });
      expect(res.status).toBe(200);
      expect(as<Auth>(res)).toMatchObject({ status: "CANCELLED", closedReason: "CLINIC_CANCELLED", allowedActions: [] });
      expect((await send("post", `/authorizations/${auth.id}/cancel`, tok.manager, {})).status).toBe(409);
      expect((await rows("SELECT count(*)::int AS n FROM audit_logs WHERE action='AUTHORIZATION_CANCEL' AND resource_id=$1", [auth.id]))[0]?.n).toBe(1);
      const approved = (await openRequest()).auth;
      await setState(approved.id, "status='APPROVED', decided_by_kind='ANALYST', authorized_amount=100, code='COD-1', valid_until=now() + interval '30 days', decided_at=now()");
      expect((await send("post", `/authorizations/${approved.id}/cancel`, tok.admin, {})).status).toBe(409);
      const rejected = (await openRequest()).auth;
      await asRejected(rejected.id, clock.now());
      expect((await send("post", `/authorizations/${rejected.id}/cancel`, tok.admin, {})).status).toBe(409);
    });
  });

  // ------------------------------------------------------------------ recurso
  describe("recurso (TC-AUT-12, BR-AUT-08)", () => {
    it("dentro do prazo ⇒ 201 com parentRequestId, herda dados/processo; recusado inalterado; dia 16 ⇒ 409; prazo em dados (20 dias); um vivo; cadeia", async () => {
      const { auth } = await openRequest({ linked: true });
      expect((await send("post", `/authorizations/${auth.id}/appeals`, tok.admin, { justification: "x" })).status).toBe(409); // não recusado
      await asRejected(auth.id, new Date(clock.now().getTime() - 10 * 86_400_000));
      tick();
      const res = await send("post", `/authorizations/${auth.id}/appeals`, tok.admin, { justification: "Segue novo orçamento" });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      const appeal = as<Auth>(res);
      expect(appeal).toMatchObject({ status: "IN_REVIEW", parentRequestId: auth.id, processId: auth.processId, guideType: auth.guideType });
      expect((await rows("SELECT status FROM insurer_authorizations WHERE id=$1", [auth.id]))[0]?.status).toBe("REJECTED");
      expect((await send("post", `/authorizations/${auth.id}/appeals`, tok.admin, { justification: "outra vez" })).status).toBe(409); // um vivo
      expect(as<Auth>(await send("get", `/authorizations/${auth.id}`, tok.admin)).allowedActions).toEqual([]);
      // cancelar o 1.º recurso reabre a possibilidade
      await send("post", `/authorizations/${appeal.id}/cancel`, tok.admin, {});
      const second = await send("post", `/authorizations/${auth.id}/appeals`, tok.admin, { justification: "2.º recurso", requestedAmount: 300 });
      expect(second.status).toBe(201);
      // cadeia: recurso do recurso (≥ 3 em cadeia, sem limite fixo)
      let current = as<Auth>(second);
      for (let i = 0; i < 2; i++) {
        await asRejected(current.id, clock.now());
        const next = await send("post", `/authorizations/${current.id}/appeals`, tok.admin, { justification: `recurso ${String(i)}` });
        expect(next.status).toBe(201);
        current = as<Auth>(next);
      }
      // dia 16: fora do prazo; com APPEAL_REQUEST_DAYS=20 da seguradora ⇒ aceite (prazo em dados)
      const late = (await openRequest()).auth;
      await asRejected(late.id, new Date(clock.now().getTime() - 16 * 86_400_000));
      expect((await send("post", `/authorizations/${late.id}/appeals`, tok.admin, { justification: "tarde" })).status).toBe(409);
      await pool.query("INSERT INTO insurer_policy_settings (insurer_id, setting_key, value) VALUES ($1,'APPEAL_REQUEST_DAYS',20)", [id.insA]);
      try {
        tick();
        expect((await send("post", `/authorizations/${late.id}/appeals`, tok.admin, { justification: "tarde mas dentro de 20 dias" })).status).toBe(201);
      } finally {
        await pool.query("DELETE FROM insurer_policy_settings WHERE insurer_id=$1 AND setting_key='APPEAL_REQUEST_DAYS'", [id.insA]);
      }
    });

    it("expectedOn herdada já passada ⇒ 422; mesmo semáforo (VERMELHO/VERDE ⇒ 422)", async () => {
      const { auth } = await openRequest();
      await asRejected(auth.id, clock.now());
      await setState(auth.id, "expected_on=$2", [day(-2)]);
      expect((await send("post", `/authorizations/${auth.id}/appeals`, tok.admin, { justification: "x" })).status).toBe(422);
      tick();
      expect((await send("post", `/authorizations/${auth.id}/appeals`, tok.admin, { justification: "x", expectedOn: day(5) })).status).toBe(201);
      // serviço passa a VERDE (já não exige autorização) ⇒ o recurso é recusado
      const other = (await openRequest()).auth;
      await asRejected(other.id, clock.now());
      await pool.query("UPDATE insurer_plan_coverages SET requires_authorization=false WHERE service_id=$1", [svc.CONS]);
      try {
        tick();
        expect((await send("post", `/authorizations/${other.id}/appeals`, tok.admin, { justification: "x" })).status).toBe(422);
      } finally {
        await pool.query("UPDATE insurer_plan_coverages SET requires_authorization=true WHERE service_id=$1", [svc.CONS]);
      }
    });
  });

  // ------------------------------------------------------------------ job
  describe("job insurer.expire-info-requests (TC-AUT-13)", () => {
    it("caduca só depois do limite guardado, é idempotente e escreve evento SYSTEM e auditoria; a política mudar depois não altera o limite", async () => {
      const { auth } = await openRequest();
      await asInfoRequested(auth.id, new Date(clock.now().getTime() + 86_400_000));
      await pool.query("INSERT INTO insurer_policy_settings (insurer_id, setting_key, value) VALUES ($1,'INFO_REQUEST_EXPIRY_DAYS',1)", [id.insA]);
      expect((await worker.expireInfoRequests()).expired).toBe(0);
      expect((await rows("SELECT status FROM insurer_authorizations WHERE id=$1", [auth.id]))[0]?.status).toBe("INFO_REQUESTED");
      clock.advance(2 * 86_400_000);
      expect((await worker.expireInfoRequests()).expired).toBeGreaterThanOrEqual(1);
      expect((await worker.expireInfoRequests()).expired).toBe(0); // idempotente
      expect((await rows("SELECT status, closed_reason, info_expires_at FROM insurer_authorizations WHERE id=$1", [auth.id]))[0]).toEqual({ status: "CANCELLED", closed_reason: "INFO_TIMEOUT", info_expires_at: null });
      expect((await rows("SELECT actor_type, to_status FROM insurer_authorization_events WHERE authorization_id=$1 ORDER BY id DESC LIMIT 1", [auth.id]))[0]).toEqual({ actor_type: "SYSTEM", to_status: "CANCELLED" });
      expect((await rows("SELECT actor_type, metadata FROM audit_logs WHERE action='AUTHORIZATION_INFO_TIMEOUT' AND resource_id=$1", [auth.id]))[0]).toMatchObject({ actor_type: "SYSTEM" });
      await pool.query("DELETE FROM insurer_policy_settings WHERE insurer_id=$1", [id.insA]);
    });
  });

  // ------------------------------------------------------------------ anexos
  describe("anexos administrativos (TC-AUT-14, BR-AUT-13)", () => {
    const upload = (authId: string, buffer: Buffer, name: string, kind: string, token = tok.admin) => call("post", `/authorizations/${authId}/attachments`, token).attach("file", buffer, name).field("kind", kind);

    it("metadados na resposta, 6.º ⇒ 409, tipo por conteúdo, infetado ⇒ 422 sem gravar, scanner em baixo ⇒ 503, só pendentes, remover pelo outbox, clínica Y ⇒ 404", async () => {
      const { auth } = await openRequest();
      const first = await upload(auth.id, PDF, `${CANARY}.pdf`, "QUOTE");
      expect(first.status, JSON.stringify(first.body)).toBe(201);
      expect(as<Record<string, unknown>>(first)).toEqual(expect.objectContaining({ kind: "QUOTE", mimeType: "application/pdf", sizeBytes: PDF.length, originalName: `${CANARY}.pdf` }));
      expect(as<Record<string, unknown>>(first)).not.toHaveProperty("storageKey");
      expect(await upload(auth.id, PDF, "a.pdf", "LAUDO")).toMatchObject({ status: 422 });
      expect(await upload(auth.id, Buffer.from("MZ-executavel"), "virus.exe", "QUOTE")).toMatchObject({ status: 415 });
      expect(await upload(auth.id, Buffer.from("PK-docx"), "a.docx", "QUOTE")).toMatchObject({ status: 415 });
      const storedBefore = stored.size;
      expect(await upload(auth.id, Buffer.concat([PDF, Buffer.from("EICAR")]), "b.pdf", "QUOTE")).toMatchObject({ status: 422 });
      expect(stored.size).toBe(storedBefore);
      expect(Number((await rows("SELECT count(*)::int AS n FROM insurer_attachments WHERE authorization_id=$1", [auth.id]))[0]?.n)).toBe(1);
      scannerDown = true;
      expect((await upload(auth.id, PDF, "c.pdf", "QUOTE")).status).toBe(503);
      scannerDown = false;
      expect((await upload(auth.id, PDF, "a.pdf", "QUOTE", tok.y)).status).toBe(404);
      for (let i = 0; i < 4; i++) expect((await upload(auth.id, PDF, `${String(i)}.pdf`, "OTHER_ADMIN")).status).toBe(201);
      expect((await upload(auth.id, PDF, "sexto.pdf", "ID_COPY")).status).toBe(409);
      const detail = as<Auth>(await send("get", `/authorizations/${auth.id}`, tok.admin));
      expect(detail.attachments).toHaveLength(5);
      const attachmentId = as<{ id: string }>(first).id;
      const key = (await rows("SELECT storage_key FROM insurer_attachments WHERE id=$1", [attachmentId]))[0]?.storage_key as string;
      expect(key).not.toContain(CANARY);
      expect((await send("delete", `/authorizations/${auth.id}/attachments/${attachmentId}`, tok.y)).status).toBe(404);
      expect((await send("delete", `/authorizations/${auth.id}/attachments/${attachmentId}`, tok.admin)).status).toBe(204);
      expect((await rows("SELECT 1 FROM file_deletions WHERE storage_key=$1 AND deleted_at IS NULL", [key]))).toHaveLength(1);
      expect((await send("delete", `/authorizations/${auth.id}/attachments/${attachmentId}`, tok.admin)).status).toBe(404);
      const audit = JSON.stringify(await rows("SELECT metadata FROM audit_logs WHERE action LIKE 'AUTHORIZATION_ATTACHMENT_%'"));
      expect(audit).not.toContain(CANARY);
      // fora do estado pendente: nem anexar nem remover
      await asRejected(auth.id, clock.now());
      expect((await upload(auth.id, PDF, "d.pdf", "QUOTE")).status).toBe(409);
      const another = as<Auth>(await send("get", `/authorizations/${auth.id}`, tok.admin)).attachments[0]?.id ?? "";
      expect((await send("delete", `/authorizations/${auth.id}/attachments/${another}`, tok.admin)).status).toBe(409);
    });
  });

  // ------------------------------------------------------------------ expansão por dados, isolamento, não-vazamento
  describe("expansão por dados, isolamento e não-vazamento (TC-AUT-15/16, TC-AZ-AUT-02/04)", () => {
    it("TC-AUT-15: guide_type fictício e service_kind novo só por SQL ⇒ deduzido e aceite como override; serviço novo com requiresAuthorization pede autorização, sem código novo", async () => {
      await pool.query("INSERT INTO guide_types (code, sort_order) VALUES ('TEST_GUIDE', 99)");
      const kindId = (await rows("INSERT INTO insurer_service_kinds (insurer_id, code, name, guide_type, expense_type) VALUES ($1,'TESTK','Teste','TEST_GUIDE','CONSULTATION') RETURNING id", [id.insA]))[0]?.id as string;
      const serviceId = randomUUID();
      await pool.query("INSERT INTO insurer_services (id, insurer_id, code, name, service_kind_id) VALUES ($1,$2,'NOVO','Serviço novo',$3)", [serviceId, id.insA, kindId]);
      await pool.query("INSERT INTO insurer_plan_coverages (insurer_id, plan_id, service_id, type, copay_pct, requires_authorization) VALUES ($1,$2,$3,'INCLUDED',60,true)", [id.insA, id.plan, serviceId]);
      const ben = await newBeneficiary();
      const res = await create(ben.card, { serviceCode: "NOVO" });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(as<Auth>(res).guideType).toBe("TEST_GUIDE");
      expect(as<Auth>(await create(ben.card, { serviceCode: "CONS", guideType: "TEST_GUIDE" })).guideType).toBe("TEST_GUIDE");
    });

    it("TC-AZ-AUT-02/04: a clínica Y não vê pedidos da X (404 em todas as rotas; lista vazia); seguradora/serviço cruzados ⇒ 404/422", async () => {
      const { auth } = await openRequest();
      for (const [method, path, payload] of [
        ["get", `/authorizations/${auth.id}`, undefined],
        ["post", `/authorizations/${auth.id}/respond`, { message: "x" }],
        ["post", `/authorizations/${auth.id}/cancel`, {}],
        ["post", `/authorizations/${auth.id}/appeals`, { justification: "x" }],
      ] as const) {
        expect((await send(method, path, tok.y, payload)).status, path).toBe(404);
      }
      expect(as<{ items: Auth[] }>(await send("get", "/authorizations?limit=100", tok.y)).items).toEqual([]);
      const ben = await newBeneficiary();
      expect((await create(ben.card, { insurerId: id.insB })).status).toBe(404); // beneficiário de A em B
      // beneficiário de B com o código de um serviço de A (que B não tem) ⇒ recusa sem razão, sem cruzar seguradoras
      expect((await create("VB-1", { insurerId: id.insB, serviceCode: "LAB" })).status).toBe(422);
      expect((await create("VB-1", { insurerId: id.insB, serviceCode: "CONS" })).status).toBe(422); // B não tem cobertura configurada para CONS
      expect((await create(ben.card, { insurerId: id.insOff })).status).toBe(404); // módulo desativado
      expect((await create(ben.card, { insurerId: randomUUID() })).status).toBe(404);
    });

    it("TC-AUT-16: o canário (justificação, resposta, nome do ficheiro) não aparece em auditoria nem nas rotas da família; a resposta do prestador não tem saldo, razão, notas internas, analista, ids de família/membro nem nº de cartão", async () => {
      const { ben, auth } = await openRequest({ linked: true });
      await asInfoRequested(auth.id, new Date(clock.now().getTime() + 86_400_000));
      await send("post", `/authorizations/${auth.id}/respond`, tok.admin, { message: CANARY });
      const detail = JSON.stringify((await send("get", `/authorizations/${auth.id}`, tok.admin)).body);
      for (const forbidden of [id.family, ben.memberId, ben.card, ben.doc, "balance", "reserved", "used", "analyst", "decidedBy", "NOT_IN_PLAN", "WAITING_PERIOD", "familyId", "memberId"]) {
        expect(detail, forbidden).not.toContain(forbidden);
      }
      expect(JSON.stringify(await rows("SELECT metadata FROM audit_logs"))).not.toContain(CANARY);
      // vista da família (TC-PRC-27): sem justificação, valor, serviço nem anexos; kind AUTHORIZED
      const family = JSON.stringify(
        await createListProcessesUseCase(processesDeps)({ userId: id.user, platformAdmin: false }, id.family, ben.memberId, {}, { requestId: "r" }),
      );
      expect(family).not.toContain(CANARY);
      expect(family).not.toMatch(/justification|requestedAmount|serviceCode|attachments/);
      expect(family).toContain("AUTHORIZED");
    });
  });

  // ------------------------------------------------------------------ processos: estado simples e ciclo de vida
  describe("Process: estado simples e ciclo de vida (TC-PRC-27/28)", () => {
    const view = async (processId: string, memberId: string) => createGetProcessUseCase(processesDeps)({ userId: id.user, platformAdmin: false }, id.family, memberId, processId, { requestId: "r" });

    it("TC-PRC-27: AUTHORIZATION sem marcação ⇒ IN_PROGRESS/AWAIT_INSURER_DECISION com dueAt; INFO_REQUESTED ⇒ AWAIT_CLINIC_INFORMATION; APPROVED ⇒ ATTEND; CANCELLED ⇒ CANCELLED", async () => {
      const { auth, ben } = await openRequest({ linked: true });
      const processId = need(auth.processId);
      const view_ = (id_: string) => view(id_, ben.memberId);
      expect(await view_(processId)).toMatchObject({ kind: "AUTHORIZED", familyStatus: "IN_PROGRESS", nextStep: { code: "AWAIT_INSURER_DECISION", actor: "INSURER", dueAt: new Date(auth.decisionDueAt) }, origin: { type: "AUTHORIZATION", id: auth.id } });
      await asInfoRequested(auth.id, new Date(clock.now().getTime() + 86_400_000));
      expect(await view_(processId)).toMatchObject({ familyStatus: "IN_PROGRESS", nextStep: { code: "AWAIT_CLINIC_INFORMATION", actor: "CLINIC" } });
      await setState(auth.id, "status='APPROVED', decided_by_kind='ANALYST', info_expires_at=NULL, authorized_amount=100, code='COD-2', valid_until=now() + interval '30 days', decided_at=now()");
      expect(await view_(processId)).toMatchObject({ familyStatus: "IN_PROGRESS", nextStep: { code: "ATTEND", actor: "FAMILY" } });
      await setState(auth.id, "status='CANCELLED', closed_reason='INFO_TIMEOUT', authorized_amount=NULL, code=NULL, valid_until=NULL");
      expect(await view_(processId)).toMatchObject({ familyStatus: "CANCELLED", nextStep: { code: "NOTHING_PENDING", actor: "NONE" } });
    });

    it("TC-PRC-27: processo de consulta com pedido ligado mostra AWAIT_INSURER_DECISION; APPROVED volta à linha do ato", async () => {
      const appointmentId = randomUUID();
      const processId = randomUUID();
      const linked = await newBeneficiary({ linked: true });
      await pool.query("INSERT INTO processes (id, family_id, member_id, kind, origin_type, origin_id, clinic_id, opened_at) VALUES ($1,$2,$3,'ROUTINE','APPOINTMENT',$4,$5,now())", [processId, id.family, linked.memberId, appointmentId, id.clinicX]);
      await pool.query("INSERT INTO appointments (id, family_id, member_id, scheduled_at, status, clinic_id, clinic_name, process_id) VALUES ($1,$2,$3,'2030-01-01T10:00:00Z','SCHEDULED',$4,'Clínica X',$5)", [appointmentId, id.family, linked.memberId, id.clinicX, processId]);
      const res = await create(linked.card, { processId });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(await view(processId, linked.memberId)).toMatchObject({ kind: "ROUTINE", familyStatus: "IN_PROGRESS", nextStep: { code: "AWAIT_INSURER_DECISION", actor: "INSURER" } });
      await setState(as<Auth>(res).id, "status='APPROVED', decided_by_kind='ANALYST', authorized_amount=100, code='COD-3', valid_until=now() + interval '30 days', decided_at=now()");
      expect(await view(processId, linked.memberId)).toMatchObject({ familyStatus: "SCHEDULED", nextStep: { code: "ATTEND", actor: "FAMILY" } });
    });

    it("TC-PRC-28: apagar a consulta apaga o Process e deixa process_id = NULL; o pedido mantém-se e continua visível; GET do processo AUTHORIZATION ⇒ phase nula", async () => {
      const appointmentId = randomUUID();
      const processId = randomUUID();
      const linked = await newBeneficiary({ linked: true });
      await pool.query("INSERT INTO processes (id, family_id, member_id, kind, origin_type, origin_id, clinic_id, opened_at) VALUES ($1,$2,$3,'ROUTINE','APPOINTMENT',$4,$5,now())", [processId, id.family, linked.memberId, appointmentId, id.clinicX]);
      const auth = as<Auth>(await create(linked.card, { processId }));
      await pool.query("DELETE FROM processes WHERE id=$1", [processId]);
      expect((await rows("SELECT process_id FROM insurer_authorizations WHERE id=$1", [auth.id]))[0]?.process_id).toBeNull();
      const after = as<Auth>(await send("get", `/authorizations/${auth.id}`, tok.admin));
      expect(after).toMatchObject({ id: auth.id, processId: null });
      const fromAuthorization = need((await openRequest({ linked: true })).auth.processId);
      expect(await createGetClinicProcessUseCase(processesDeps)({ clinicAccountId: id.accAdmin, clinicId: id.clinicX, role: "CLINIC_ADMIN" }, fromAuthorization)).toMatchObject({ kind: "AUTHORIZED", phase: null, origin: { type: "AUTHORIZATION" } });
      // apagar o membro: cascata do processo AUTHORIZATION, o pedido fica intacto
      const cascaded = await openRequest({ linked: true });
      const authId = cascaded.auth.id;
      await pool.query("DELETE FROM family_members WHERE id=$1", [cascaded.ben.memberId]).catch(() => undefined);
      await pool.query("DELETE FROM processes WHERE member_id=$1 AND origin_type='AUTHORIZATION'", [cascaded.ben.memberId]);
      expect((await rows("SELECT process_id FROM insurer_authorizations WHERE id=$1", [authId]))[0]?.process_id).toBeNull();
    });
  });

  // ------------------------------------------------------------------ factos da cobertura sem N+1
  it("getCoverageFacts devolve um facto por processo, em lote", async () => {
    const a = (await openRequest({ linked: true })).auth;
    const b = (await openRequest({ linked: true })).auth;
    const facts = await withTransaction(db, (trx) => ops.getCoverageFacts(trx, id.family, [need(a.processId), need(b.processId), randomUUID()]));
    expect(facts.map((f) => f.processId).sort()).toEqual([need(a.processId), need(b.processId)].sort());
    expect(facts.every((f) => f.fact.phase === "PENDING_DECISION" && f.fact.dueAt instanceof Date)).toBe(true);
  });

});
