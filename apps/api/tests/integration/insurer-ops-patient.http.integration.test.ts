// HTTP + PostgreSQL real (testcontainers) do marco S6 parcial (app do paciente) da Fase A de seguradoras (ADR-025):
// supertest com express-openapi-validator a validar PEDIDOS e RESPOSTAS (`validateResponses`) contra docs/05-api/openapi.yaml,
// `access.AccessPolicy` REAL (MANAGE_INSURANCE) sobre `families` reais. Cobre reclamar/desligar o cartão (TC-SEG-04, BR-SEG-20/25),
// cartão/QR/cobertura (TC-SEG-07, BR-SEG-18/23, UC-SEG-14/15), isolamento e papéis (TC-AZ-SEG, §8.5) e minimização (TC-SEG-08).
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { Writable } from "node:stream";
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
import { createAccessModule } from "../../src/modules/access/index.js";
import { createAuditModule } from "../../src/modules/audit/index.js";
import { signAccessToken } from "../../src/modules/auth/domain/jwt.js";
import { createBearerAuthSecurityHandler } from "../../src/modules/auth/interface/middleware.js";
import { signClinicAccessToken } from "../../src/modules/clinics/domain/clinic-jwt.js";
import { KyselyClinicsRepository } from "../../src/modules/clinics/infrastructure/repo.js";
import { createClinicActorContextMiddleware, createClinicBearerAuthSecurityHandler } from "../../src/modules/clinics/interface/clinic-portal-middleware.js";
import { createFamiliesModule } from "../../src/modules/families/index.js";
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
import { CARD_QR_TTL_SECONDS, verifyCardQrToken } from "../../src/modules/insurer-ops/domain/card-qr.js";
import { createUsersModule } from "../../src/modules/users/index.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const NOW = new Date("2026-11-11T10:00:00.000Z");
const API = "/api/v1";
const PORTAL = `${API}/insurance-portal`;
const CLINIC = `${API}/clinic-portal`;
const KEYS = [{ kid: "k1", secret: new TextEncoder().encode("0123456789abcdef0123456789abcdef") }];
const SESSION = randomUUID();
const CLAIM_SECRET = "segredo-de-teste-dos-codigos";
const DAY_MS = 24 * 60 * 60 * 1000;

const id = {
  insA: randomUUID(),
  insB: randomUUID(),
  insC: randomUUID(), // módulo operacional desativado
  insD: randomUUID(), // suspensa
  admA: randomUUID(),
  admB: randomUUID(),
  admC: randomUUID(),
  clinicAlfa: randomUUID(),
  accAlfa: randomUUID(),
  f1: randomUUID(),
  f2: randomUUID(),
  f3: randomUUID(),
  uAdult: randomUUID(), // SELF de mAdult
  uOther: randomUUID(), // adulto da mesma família, sem tutela (OTHER)
  uTutor: randomUUID(), // tutor de mKid e mTeen
  uTeen: randomUUID(), // dependente com conta (DEPENDENT_SELF)
  uOut: randomUUID(), // outra família
  uDel: randomUUID(),
  mAdult: randomUUID(),
  mOther: randomUUID(),
  mTutor: randomUUID(),
  mKid: randomUUID(),
  mTeen: randomUUID(),
  mOut: randomUUID(),
  mDel: randomUUID(),
};

interface Problem {
  code: string;
  title: string;
  status: number;
  detail?: string;
}

describe("integração HTTP: app do paciente (S6 parcial) — cartão, QR e cobertura", () => {
  let container: StartedTestContainer;
  let pool: Pool;
  let db: Kysely<Database>;
  let app: ReturnType<typeof createApp>;
  let audit: ReturnType<typeof createAuditModule>;
  const clock = new FixedClock(NOW);
  const logs: string[] = [];
  const tok = { admA: "", admB: "", admC: "", adult: "", other: "", tutor: "", teen: "", out: "", del: "", clinic: "" };

  const insToken = async (accountId: string) => `Bearer ${(await signInsuranceAccessToken({ subject: { insuranceAccountId: accountId, sessionId: SESSION }, now: NOW, ttlSeconds: 86_400, signingKeys: KEYS })).token}`;
  const userToken = async (userId: string) => `Bearer ${(await signAccessToken({ subject: { userId, sessionId: SESSION }, now: NOW, ttlSeconds: 86_400, signingKeys: KEYS })).token}`;
  const portal = (method: "get" | "post" | "put", path: string, token: string, payload?: unknown) => {
    const r = request(app)[method](`${PORTAL}${path}`).set("Authorization", token);
    return payload === undefined ? r : r.send(payload as object);
  };
  // Cada utilizador chega de um IP próprio (o limite por IP não mistura os testes; o limite por utilizador é o testado).
  const ips = new Map<string, string>();
  const pat = (method: "get" | "post" | "delete", family: string, member: string, path: string, token: string | undefined, payload?: unknown, ip?: string) => {
    let r = request(app)[method](`${API}/families/${family}/members/${member}/insurance${path}`);
    if (token) {
      r = r.set("Authorization", token);
      if (!ips.has(token)) ips.set(token, `10.9.0.${String(ips.size + 1)}`);
      r = r.set("X-Forwarded-For", ip ?? ips.get(token) ?? "10.9.9.9");
    }
    return payload === undefined ? r : r.send(payload as object);
  };
  const clinicEligibility = (payload: object) => request(app).post(`${CLINIC}/insurers/${id.insA}/eligibility`).set("Authorization", tok.clinic).send(payload);
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- asserção de tipo do corpo de teste
  const body = <T>(res: { body: unknown }): T => res.body as T;
  const col = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows as Record<string, unknown>[];
  const problem = (res: { body: unknown }) => {
    const p = res.body as Problem;
    return { code: p.code, title: p.title, status: p.status, detail: p.detail };
  };

  // Estado partilhado entre os passos (ordem importa).
  const s = {
    planA: "", planB: "",
    holderA: { id: "", card: "" }, kidA: { id: "", card: "" }, holderB: { id: "", card: "" }, holderC: { id: "", card: "" }, extra: { id: "", card: "" }, delA: { id: "", card: "" }, teenA: { id: "", card: "" },
    codeHolderA: "", codeKidA: "", codeHolderB: "", codeExtra: "", codeDel: "",
    claimAdultA: "", claimKidA: "", claimAdultB: "", claimExtra: "", claimDel: "",
    qrToken: "",
  };

  const newBeneficiary = async (token: string, over: Record<string, unknown>, activate = true) => {
    const res = await portal("post", "/beneficiaries", token, { name: "Beneficiario", idDocumentType: "BI", birthDate: "1980-01-01", relationship: "HOLDER", ...over });
    expect(res.status).toBe(201);
    const created = body<{ id: string; cardNumber: string }>(res);
    if (activate) expect((await portal("post", `/beneficiaries/${created.id}/status`, token, { status: "ACTIVE" })).status).toBe(200);
    return { id: created.id, card: created.cardNumber };
  };
  const newCode = async (token: string, beneficiaryId: string) => body<{ code: string }>(await portal("post", `/beneficiaries/${beneficiaryId}/claim-code`, token)).code;
  const newPolicy = async (token: string, planId: string, holderId: string, number: string) => {
    const res = await portal("post", "/policies", token, { planId, holderId, number, validFrom: "2026-11-01", validTo: "2027-10-31" });
    expect(res.status).toBe(201);
    expect((await portal("post", `/policies/${body<{ id: string }>(res).id}/status`, token, { status: "ACTIVE" })).status).toBe(200);
  };
  const claimBody = (insurerId: string, policyNumber: string, code: string) => ({ insurerId, policyNumber, code });

  beforeAll(async () => {
    container = await new GenericContainer("postgres:16-alpine")
      .withEnvironment({ POSTGRES_USER: "vita", POSTGRES_PASSWORD: "vita", POSTGRES_DB: "vita" })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start();
    pool = new Pool({ connectionString: `postgres://vita:vita@${container.getHost()}:${String(container.getMappedPort(5432))}/vita` });
    db = createDb(pool);
    await runMigrations(pool, defaultMigrationsDir());

    const user = (uid: string, email: string) =>
      pool.query("INSERT INTO users (id, email, password_hash, name, birth_date, timezone, status, email_verified_at, terms_accepted_version, terms_accepted_at) VALUES ($1,$2,'h','Utilizador','1990-01-01','Europe/Lisbon','ACTIVE',now(),'1',now())", [uid, email]);
    for (const [uid, email] of [[id.uAdult, "adult"], [id.uOther, "other"], [id.uTutor, "tutor"], [id.uTeen, "teen"], [id.uOut, "out"], [id.uDel, "del"]] as const) await user(uid, `${email}@vita.pt`);
    for (const f of [id.f1, id.f2, id.f3]) await pool.query("INSERT INTO families (id, name) VALUES ($1,'Familia')", [f]);
    const member = (mid: string, family: string, userId: string | null, name: string, birth: string, dependent: boolean) =>
      pool.query("INSERT INTO family_members (id, family_id, user_id, name, birth_date, role, is_dependent) VALUES ($1,$2,$3,$4,$5,$6,$7)", [mid, family, userId, name, birth, userId && !dependent ? "FAMILY_MEMBER" : null, dependent]);
    await member(id.mAdult, id.f1, id.uAdult, "Adulto", "1985-05-05", false);
    await member(id.mOther, id.f1, id.uOther, "Outro adulto", "1986-06-06", false);
    await member(id.mTutor, id.f1, id.uTutor, "Tutor", "1980-01-01", false);
    await member(id.mKid, id.f1, null, "Crianca", "2018-03-03", true);
    await member(id.mTeen, id.f1, id.uTeen, "Adolescente", "2012-02-02", true);
    await member(id.mOut, id.f2, id.uOut, "Fora", "1990-01-01", false);
    await member(id.mDel, id.f3, id.uDel, "Apagar", "1990-01-01", false);
    for (const dep of [id.mKid, id.mTeen]) await pool.query("INSERT INTO guardianships (family_id, dependent_id, guardian_id, is_primary) VALUES ($1,$2,$3,true)", [id.f1, dep, id.mTutor]);

    await pool.query("INSERT INTO insurer_accounts (id, name, tax_id, operational_module_enabled, currency) VALUES ($1,'Seg A','500000001',true,'AOA'), ($2,'Seg B','500000002',true,'USD'), ($3,'Seg C','500000003',false,'AOA'), ($4,'Seg D','500000004',true,'AOA')", [id.insA, id.insB, id.insC, id.insD]);
    await pool.query("UPDATE insurer_accounts SET status='SUSPENDED' WHERE id=$1", [id.insD]);
    for (const [acc, ins] of [[id.admA, id.insA], [id.admB, id.insB], [id.admC, id.insC]] as const) await pool.query("INSERT INTO insurance_accounts (id, insurer_id, email, password_hash, role) VALUES ($1,$2,$3,'x','INSURANCE_ADMIN')", [acc, ins, `${acc}@seg.pt`]);
    await pool.query("INSERT INTO clinics (id, type, name) VALUES ($1,'PARTNER','Clinica Alfa')", [id.clinicAlfa]);
    await pool.query("INSERT INTO clinic_accounts (id, clinic_id, email, password_hash, role) VALUES ($1,$2,'alfa@cli.pt','x','CLINIC_ADMIN')", [id.accAlfa, id.clinicAlfa]);
    await pool.query("INSERT INTO insurer_providers (insurer_id, clinic_id, name) VALUES ($1,$2,'Alfa')", [id.insA, id.clinicAlfa]);

    // Módulos REAIS de `users`, `families` e `access` (a política MANAGE_INSURANCE é a de produção).
    audit = createAuditModule({ db, clock });
    const users = createUsersModule({ db, audit, clock, currentTermsVersion: "1" });
    const families = createFamiliesModule({
      db,
      audit,
      users,
      clock,
      mailer: { send: () => Promise.resolve() },
      appBaseUrl: "https://x.test",
      memberData: { purgeMemberFiles: () => Promise.resolve(), purgeFamilyFiles: () => Promise.resolve(), exportBeforeRemoval: () => Promise.reject(new Error("não usado")) },
    });
    const access = createAccessModule({ db, audit, families, clock });
    const ops = createInsurerOpsModule({
      db,
      audit,
      clock,
      insurers: createInsurerSettingsReader(),
      claimCodeSecret: CLAIM_SECRET,
      partnerClinics: { list: (trx, query) => new KyselyClinicsRepository().listPartnerDirectory(trx, query), find: (trx, clinicId) => new KyselyClinicsRepository().findPartnerDirectoryEntry(trx, clinicId) },
      patientAccess: {
        authorize: async (trx, { actor, familyId, memberId }) => {
          const ctx = await access.policy.can(trx, { userId: actor.userId, platformAdmin: actor.platformAdmin, familyId, action: "MANAGE_INSURANCE", subjectMemberId: memberId });
          return { relation: ctx.relation ?? "OTHER" };
        },
      },
    });
    tok.admA = await insToken(id.admA);
    tok.admB = await insToken(id.admB);
    tok.admC = await insToken(id.admC);
    tok.adult = await userToken(id.uAdult);
    tok.other = await userToken(id.uOther);
    tok.tutor = await userToken(id.uTutor);
    tok.teen = await userToken(id.uTeen);
    tok.out = await userToken(id.uOut);
    tok.del = await userToken(id.uDel);
    tok.clinic = `Bearer ${(await signClinicAccessToken({ subject: { clinicAccountId: id.accAlfa, sessionId: SESSION }, now: NOW, ttlSeconds: 86_400, signingKeys: KEYS })).token}`;

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
      insuranceRefreshTtlMs: 30 * DAY_MS,
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
        const row = (await col("SELECT clinic_id, role FROM clinic_accounts WHERE id=$1", [clinicAccountId]))[0] as { clinic_id: string; role: "CLINIC_ADMIN" };
        return { clinicAccountId, sessionId, clinicId: row.clinic_id, role: row.role, suspended: false };
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

    // Dados das seguradoras pelo portal (HTTP real): serviços, plano ativo com coberturas, titulares, dependente e apólices.
    const svc = async (token: string, code: string, name: string) => body<{ id: string }>(await portal("post", "/services", token, { code, name })).id;
    const [cons, rx, anal] = [await svc(tok.admA, "CONS", "Consulta"), await svc(tok.admA, "RX", "Raio-X"), await svc(tok.admA, "ANAL", "Analises")];
    s.planA = body<{ id: string }>(await portal("post", "/plans", tok.admA, { name: "Plano Ouro" })).id;
    await portal("put", `/plans/${s.planA}/coverages`, tok.admA, {
      items: [
        { serviceId: cons, covered: true, copayPct: 80, waitingDays: 30 },
        { serviceId: rx, covered: true, copayPct: 100, limitPerYear: 150000.5, requiresAuthorization: true },
        { serviceId: anal, covered: false },
      ],
    });
    expect((await portal("post", `/plans/${s.planA}/status`, tok.admA, { status: "ACTIVE" })).status).toBe(200);
    const svcB = await svc(tok.admB, "B-X", "Servico B");
    s.planB = body<{ id: string }>(await portal("post", "/plans", tok.admB, { name: "Plano Prata" })).id;
    await portal("put", `/plans/${s.planB}/coverages`, tok.admB, { items: [{ serviceId: svcB, covered: true, copayPct: 50 }] });
    await portal("post", `/plans/${s.planB}/status`, tok.admB, { status: "ACTIVE" });

    s.holderA = await newBeneficiary(tok.admA, { name: "CANARIO-NOME-A", idDocumentNumber: "CANARIO-DOC-A", birthDate: "1985-05-05" });
    s.kidA = await newBeneficiary(tok.admA, { name: "Crianca A", idDocumentNumber: "CANARIO-DOC-KID", relationship: "CHILD", holderId: s.holderA.id, birthDate: "2018-03-03" });
    s.teenA = await newBeneficiary(tok.admA, { name: "Adolescente A", idDocumentNumber: "CANARIO-DOC-TEEN", relationship: "CHILD", holderId: s.holderA.id, birthDate: "2012-02-02" });
    s.extra = await newBeneficiary(tok.admA, { name: "Extra A", idDocumentNumber: "CANARIO-DOC-X", relationship: "SPOUSE", holderId: s.holderA.id, birthDate: "1986-06-06" });
    s.delA = await newBeneficiary(tok.admA, { name: "Apagar A", idDocumentNumber: "CANARIO-DOC-DEL", relationship: "SPOUSE", holderId: s.holderA.id, birthDate: "1990-01-01" });
    await newPolicy(tok.admA, s.planA, s.holderA.id, "AP-001");
    s.holderB = await newBeneficiary(tok.admB, { name: "Titular B", idDocumentNumber: "B-DOC-1", birthDate: "1985-05-05" });
    await newPolicy(tok.admB, s.planB, s.holderB.id, "AP-B-1");
    // insC: módulo desativado ⇒ o paciente não o vê (o portal da seguradora C recusa tudo; os dados criam-se por SQL)
    const hc = randomUUID();
    s.holderC = { id: hc, card: "VF99999999999999" };
    await pool.query("INSERT INTO insurer_beneficiaries (id, insurer_id, name, id_document_type, id_document_number, birth_date, relationship, card_number, status) VALUES ($1,$2,'Titular C','BI','C-DOC','1985-05-05','HOLDER',$3,'ACTIVE')", [hc, id.insC, s.holderC.card]);
    const pc = randomUUID();
    await pool.query("INSERT INTO insurer_plans (id, insurer_id, name, status) VALUES ($1,$2,'Plano C','ACTIVE')", [pc, id.insC]);
    await pool.query("INSERT INTO insurer_policies (insurer_id, plan_id, holder_id, number, valid_from, valid_to, status) VALUES ($1,$2,$3,'AP-C-1','2026-11-01','2027-10-31','ACTIVE')", [id.insC, pc, hc]);
  }, 240_000);

  afterAll(async () => {
    await pool.end();
    await container.stop();
  });

  const allSix = (family: string, member: string, token: string | undefined, beneficiary: string = randomUUID(), claim: string = randomUUID()) =>
    Promise.all([
      pat("get", family, member, "/card-claims", token),
      pat("post", family, member, "/card-claims", token, claimBody(id.insA, "AP-001", "ZZZZ-ZZZZ")),
      pat("delete", family, member, `/card-claims/${claim}`, token),
      pat("get", family, member, "/cards", token),
      pat("get", family, member, `/cards/${beneficiary}/qr`, token),
      pat("get", family, member, `/cards/${beneficiary}/coverage`, token),
    ]);

  // ------------------------------------------------------------------ autenticação e autorização (§8.5, TC-AZ-SEG)
  describe("autorização: SELF (adulto) ou TUTOR_OF; os restantes ⇒ 404; sem token ⇒ 401", () => {
    it("sem token ⇒ 401 nas seis rotas", async () => {
      for (const res of await allSix(id.f1, id.mAdult, undefined)) expect(res.status).toBe(401);
    });

    it("OTHER (adulto da mesma família), DEPENDENT_SELF, outra família e membro de outra família ⇒ 404 nas seis rotas", async () => {
      const cases: [string, string, string][] = [
        [id.f1, id.mAdult, tok.other], // OTHER
        [id.f1, id.mTeen, tok.teen], // dependente com conta olhando para si
        [id.f1, id.mKid, tok.adult], // adulto sem tutela do dependente
        [id.f1, id.mAdult, tok.out], // utilizador de outra família
        [id.f2, id.mOut, tok.adult], // família alheia
        [id.f1, id.mOut, tok.adult], // membro de outra família na minha família
      ];
      for (const [family, member, token] of cases) {
        for (const res of await allSix(family, member, token)) {
          expect(res.status, `${family}/${member}`).toBe(404);
          expect(res.body).toMatchObject({ code: "NOT_FOUND" });
        }
      }
    });
  });

  // ------------------------------------------------------------------ reclamar o cartão (TC-SEG-04, BR-SEG-20/25)
  describe("reclamar o cartão", () => {
    it("o código em claro só existe na emissão e vale 7 dias exatos (BR-SEG-25); só o HMAC fica na BD", async () => {
      const res = await portal("post", `/beneficiaries/${s.holderA.id}/claim-code`, tok.admA);
      expect(res.status).toBe(201);
      const issued = body<{ code: string; expiresAt: string }>(res);
      s.codeHolderA = issued.code;
      expect(new Date(issued.expiresAt).getTime()).toBe(NOW.getTime() + 7 * DAY_MS);
      const row = (await col("SELECT claim_code_hash, claim_code_expires_at FROM insurer_beneficiaries WHERE id=$1", [s.holderA.id]))[0] as { claim_code_hash: string; claim_code_expires_at: Date };
      expect(row.claim_code_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.claim_code_hash).not.toContain(issued.code.replace("-", ""));
      expect(row.claim_code_expires_at.getTime()).toBe(NOW.getTime() + 7 * DAY_MS);
      s.codeKidA = await newCode(tok.admA, s.kidA.id);
      s.codeHolderB = await newCode(tok.admB, s.holderB.id);
      s.codeExtra = await newCode(tok.admA, s.extra.id);
      s.codeDel = await newCode(tok.admA, s.delA.id);
    });

    it("anti-enumeração: apólice/código inexistentes, errados, expirados, de outra seguradora, módulo desativado ou seguradora suspensa ⇒ o MESMO 404, sem criar pedidos", async () => {
      // expirado: o código de `extra` já passou da validade
      const expired = await newCode(tok.admA, s.extra.id);
      await pool.query("UPDATE insurer_beneficiaries SET claim_code_expires_at = $2 WHERE id=$1", [s.extra.id, new Date(NOW.getTime() - 1000)]);
      const attempts: [string, string, string][] = [
        [id.insA, "AP-001", "ZZZZ-ZZZZ"], // código errado
        [id.insA, "AP-001", s.codeHolderB], // código de outra seguradora
        [id.insA, "AP-INEXISTENTE", s.codeHolderA], // apólice inexistente
        [id.insA, "AP-B-1", s.codeHolderA], // apólice de outra seguradora
        [id.insB, "AP-001", s.codeHolderA], // código de A na seguradora B
        [id.insA, "AP-001", expired], // expirado
        [randomUUID(), "AP-001", s.codeHolderA], // seguradora inexistente
        [id.insC, "AP-C-1", "ABCD-EFGH"], // módulo desativado
        [id.insD, "AP-001", s.codeHolderA], // seguradora suspensa / sem apólice
      ];
      const results = [];
      for (const [insurerId, policy, code] of attempts) {
        const res = await pat("post", id.f1, id.mAdult, "/card-claims", tok.adult, claimBody(insurerId, policy, code));
        expect(res.status, `${policy}/${code}`).toBe(404);
        results.push(problem(res));
      }
      for (const p of results) expect(p).toEqual(results[0]);
      expect(await col("SELECT 1 FROM insurer_beneficiary_link_requests")).toHaveLength(0);
      // o código válido não foi consumido por tentativas falhadas
      expect((await col("SELECT claim_code_hash FROM insurer_beneficiaries WHERE id=$1", [s.holderA.id]))[0]).toMatchObject({ claim_code_hash: expect.any(String) as string });
      // dependente do titular com o código certo mas apólice trocada ⇒ também 404
      const wrongPolicy = await pat("post", id.f1, id.mAdult, "/card-claims", tok.adult, claimBody(id.insA, "AP-001 ", "ZZZZ"));
      expect(wrongPolicy.status).toBe(404);
      // restaura o código de `extra` válido e deixa a janela do limitador esvaziar (10 tentativas/15 min já gastas)
      s.codeExtra = await newCode(tok.admA, s.extra.id);
      clock.advance(16 * 60 * 1000);
    });

    it("validação do pedido ⇒ 422 (sem ecoar valores); código com/sem hífen e minúsculas é aceite", async () => {
      expect((await pat("post", id.f1, id.mAdult, "/card-claims", tok.adult, { insurerId: "nao-uuid", policyNumber: "AP-001", code: "X" })).status).toBe(422);
      expect((await pat("post", id.f1, id.mAdult, "/card-claims", tok.adult, { insurerId: id.insA, policyNumber: "", code: "X" })).status).toBe(422);
      expect((await pat("post", id.f1, id.mAdult, "/card-claims", tok.adult, { insurerId: id.insA, policyNumber: "AP-001" })).status).toBe(422);
      const res = await pat("post", id.f1, id.mAdult, "/card-claims", tok.adult, claimBody(id.insA, "AP-001", s.codeHolderA.replace("-", "").toLowerCase()));
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ insurerId: id.insA, insurerName: "Seg A", beneficiaryId: null, status: "PENDING", decidedAt: null, decisionNote: null });
      s.claimAdultA = body<{ id: string }>(res).id;
    });

    it("pedido PENDING: uso único do código (outro membro ⇒ 404), segundo pedido do membro ⇒ 409; sem cartão/QR/cobertura antes da confirmação", async () => {
      expect((await col("SELECT claim_code_hash FROM insurer_beneficiaries WHERE id=$1", [s.holderA.id]))[0]).toMatchObject({ claim_code_hash: null });
      const reuse = await pat("post", id.f1, id.mTutor, "/card-claims", tok.tutor, claimBody(id.insA, "AP-001", s.codeHolderA));
      expect(reuse.status).toBe(404);
      const again = await pat("post", id.f1, id.mAdult, "/card-claims", tok.adult, claimBody(id.insA, "AP-001", s.codeExtra));
      expect(again.status).toBe(409);
      expect(await col("SELECT 1 FROM insurer_beneficiary_link_requests")).toHaveLength(1);
      expect((await pat("get", id.f1, id.mAdult, "/cards", tok.adult)).body).toEqual([]);
      expect((await pat("get", id.f1, id.mAdult, `/cards/${s.holderA.id}/qr`, tok.adult)).status).toBe(404);
      expect((await pat("get", id.f1, id.mAdult, `/cards/${s.holderA.id}/coverage`, tok.adult)).status).toBe(404);
      const list = await pat("get", id.f1, id.mAdult, "/card-claims", tok.adult);
      expect(list.body).toEqual([expect.objectContaining({ id: s.claimAdultA, status: "PENDING", beneficiaryId: null, insurerName: "Seg A" })]);
      // desligar um pedido ainda PENDING ⇒ 409 (só CONFIRMED→REVOKED)
      expect((await pat("delete", id.f1, id.mAdult, `/card-claims/${s.claimAdultA}`, tok.adult)).status).toBe(409);
    });

    it("auditoria INSURER_LINK_REQUEST (ator USER, step=CLAIM) sem código, apólice nem cartão", async () => {
      const rows = await col("SELECT actor_type, actor_user_id, family_id, subject_member_id, result, metadata FROM audit_logs WHERE action='INSURER_LINK_REQUEST' AND actor_type='USER'");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ actor_type: "USER", actor_user_id: id.uAdult, family_id: id.f1, subject_member_id: id.mAdult, result: "SUCCESS", metadata: { insurerId: id.insA, step: "CLAIM" } });
    });

    it("a seguradora vê o pedido (sem ids do paciente), confirma e o paciente passa a ver a ligação", async () => {
      const list = await portal("get", "/link-requests?status=PENDING", tok.admA);
      const items = body<{ items: Record<string, unknown>[] }>(list).items;
      expect(items).toHaveLength(1);
      expect(Object.keys(items[0] ?? {}).sort()).toEqual(["beneficiaryId", "beneficiaryName", "cardNumber", "decidedAt", "decisionNote", "id", "requestedAt", "status"]);
      expect((await portal("post", `/link-requests/${s.claimAdultA}/confirm`, tok.admA)).status).toBe(200);
      const mine = body<Record<string, unknown>[]>(await pat("get", id.f1, id.mAdult, "/card-claims", tok.adult));
      expect(mine).toEqual([expect.objectContaining({ id: s.claimAdultA, status: "CONFIRMED", beneficiaryId: s.holderA.id })]);
      expect(mine[0]?.decidedAt).not.toBeNull();
    });
  });

  // ------------------------------------------------------------------ cartão digital (UC-SEG-15, TC-SEG-07)
  describe("cartão digital", () => {
    it("um cartão por seguradora ligada: só dados da seguradora, nunca de saúde; várias seguradoras são independentes (BR-SEG-23)", async () => {
      const one = await pat("get", id.f1, id.mAdult, "/cards", tok.adult);
      expect(one.status).toBe(200);
      expect(one.headers["cache-control"]).toBe("no-store");
      expect(one.body).toEqual([
        {
          beneficiaryId: s.holderA.id,
          insurerId: id.insA,
          insurerName: "Seg A",
          currency: "AOA",
          beneficiaryName: "CANARIO-NOME-A",
          cardNumber: s.holderA.card,
          status: "ACTIVE",
          planName: "Plano Ouro",
          policyNumber: "AP-001",
          validFrom: "2026-11-01",
          validTo: "2027-10-31",
        },
      ]);
      expect(s.holderA.card).toMatch(/^VF\d{14}$/);
      // segunda seguradora: pedido, confirmação e dois cartões independentes
      const claim = await pat("post", id.f1, id.mAdult, "/card-claims", tok.adult, claimBody(id.insB, "AP-B-1", s.codeHolderB));
      expect(claim.status).toBe(201);
      s.claimAdultB = body<{ id: string }>(claim).id;
      expect((await portal("post", `/link-requests/${s.claimAdultB}/confirm`, tok.admB)).status).toBe(200);
      const two = body<{ insurerName: string; currency: string; planName: string; cardNumber: string }[]>(await pat("get", id.f1, id.mAdult, "/cards", tok.adult));
      expect(two.map((c) => [c.insurerName, c.currency, c.planName, c.cardNumber])).toEqual([["Seg A", "AOA", "Plano Ouro", s.holderA.card], ["Seg B", "USD", "Plano Prata", s.holderB.card]]);
      expect(Object.keys(two[0] ?? {}).sort()).toEqual(["beneficiaryId", "beneficiaryName", "cardNumber", "currency", "insurerId", "insurerName", "planName", "policyNumber", "status", "validFrom", "validTo"]);
    });

    it("beneficiário não ACTIVE mostra o estado no cartão", async () => {
      await pool.query("UPDATE insurer_beneficiaries SET status='SUSPENDED' WHERE id=$1", [s.holderB.id]);
      const cards = body<{ insurerName: string; status: string }[]>(await pat("get", id.f1, id.mAdult, "/cards", tok.adult));
      expect(cards.map((c) => [c.insurerName, c.status])).toEqual([["Seg A", "ACTIVE"], ["Seg B", "SUSPENDED"]]);
      await pool.query("UPDATE insurer_beneficiaries SET status='ACTIVE' WHERE id=$1", [s.holderB.id]);
    });

    it("seguradora com módulo operacional desativado: ligação existente não aparece e o QR/cobertura ⇒ 404", async () => {
      await pool.query("UPDATE insurer_beneficiaries SET family_id=$2, family_member_id=$3 WHERE id=$1", [s.holderC.id, id.f1, id.mAdult]);
      const cards = body<{ insurerName: string }[]>(await pat("get", id.f1, id.mAdult, "/cards", tok.adult));
      expect(cards.map((c) => c.insurerName)).toEqual(["Seg A", "Seg B"]);
      expect((await pat("get", id.f1, id.mAdult, `/cards/${s.holderC.id}/qr`, tok.adult)).status).toBe(404);
      expect((await pat("get", id.f1, id.mAdult, `/cards/${s.holderC.id}/coverage`, tok.adult)).status).toBe(404);
      await pool.query("UPDATE insurer_beneficiaries SET family_id=NULL, family_member_id=NULL WHERE id=$1", [s.holderC.id]);
    });
  });

  // ------------------------------------------------------------------ QR do cartão (BR-SEG-18)
  describe("QR do cartão", () => {
    it("emite token assinado de 120 s, sem dados clínicos, e audita CARD_QR_ISSUE sem o token", async () => {
      const res = await pat("get", id.f1, id.mAdult, `/cards/${s.holderA.id}/qr`, tok.adult);
      expect(res.status).toBe(200);
      expect(res.headers["cache-control"]).toBe("no-store");
      const t0 = clock.now();
      const qr = body<{ token: string; expiresAt: string; cardVersion: number }>(res);
      s.qrToken = qr.token;
      expect(qr.cardVersion).toBe(1);
      expect(new Date(qr.expiresAt).getTime()).toBe(t0.getTime() + CARD_QR_TTL_SECONDS * 1000);
      expect(Object.keys(qr).sort()).toEqual(["cardVersion", "expiresAt", "token"]);
      expect(verifyCardQrToken(CLAIM_SECRET, qr.token, t0)).toEqual({ insurerId: id.insA, beneficiaryId: s.holderA.id, cardVersion: 1, expiresAt: Math.floor(t0.getTime() / 1000) + 120 });
      const payload = JSON.parse(Buffer.from(qr.token.split(".")[0] ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
      expect(Object.keys(payload).sort()).toEqual(["b", "c", "e", "i", "v"]);
      const audits = await col("SELECT actor_user_id, family_id, subject_member_id, metadata FROM audit_logs WHERE action='CARD_QR_ISSUE'");
      expect(audits).toEqual([{ actor_user_id: id.uAdult, family_id: id.f1, subject_member_id: id.mAdult, metadata: { insurerId: id.insA } }]);
      expect(JSON.stringify(await col("SELECT * FROM audit_logs"))).not.toContain(qr.token);
      expect(logs.join("")).not.toContain(qr.token);
      // novo pedido ⇒ novo token (expiração igual no mesmo segundo, mas é um pedido auditado distinto)
      clock.advance(1000);
      const second = body<{ token: string }>(await pat("get", id.f1, id.mAdult, `/cards/${s.holderA.id}/qr`, tok.adult));
      expect(second.token).not.toBe(qr.token);
      clock.advance(-1000);
    });

    it("a elegibilidade da clínica aceita o token; rejeita-o adulterado, de outra seguradora ou expirado (resposta idêntica)", async () => {
      const ok = await clinicEligibility({ qrToken: s.qrToken });
      expect(ok.body).toMatchObject({ eligible: true, beneficiaryName: "CANARIO-NOME-A", planName: "Plano Ouro" });
      const notEligible = { eligible: false, notice: expect.any(String) as string };
      const tampered = `${s.qrToken.slice(0, -2)}${s.qrToken.endsWith("AA") ? "BB" : "AA"}`;
      expect((await clinicEligibility({ qrToken: tampered })).body).toEqual(notEligible);
      // QR emitido para a seguradora B apresentado na validação da seguradora A
      const qrB = body<{ token: string }>(await pat("get", id.f1, id.mAdult, `/cards/${s.holderB.id}/qr`, tok.adult)).token;
      expect((await clinicEligibility({ qrToken: qrB })).body).toEqual(notEligible);
      clock.advance((CARD_QR_TTL_SECONDS + 1) * 1000);
      expect((await clinicEligibility({ qrToken: s.qrToken })).body).toEqual(notEligible);
      clock.advance(-(CARD_QR_TTL_SECONDS + 1) * 1000);
    });

    it("beneficiário de outro membro/ligação, inexistente ou de outra seguradora ⇒ 404", async () => {
      for (const beneficiary of [s.kidA.id, s.holderC.id, randomUUID()]) {
        expect((await pat("get", id.f1, id.mAdult, `/cards/${beneficiary}/qr`, tok.adult)).status).toBe(404);
      }
    });
  });

  // ------------------------------------------------------------------ cobertura (UC-SEG-14, D-A2)
  describe("cobertura (plano, validade, serviços e limites — sem saldo)", () => {
    it("devolve cobertura e limites; EXCLUDED não listado; sem used/reserved/saldo; SELF não gera COVERAGE_VIEW", async () => {
      const res = await pat("get", id.f1, id.mAdult, `/cards/${s.holderA.id}/coverage`, tok.adult);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        beneficiaryId: s.holderA.id,
        insurerId: id.insA,
        currency: "AOA",
        status: "ACTIVE",
        planName: "Plano Ouro",
        policyNumber: "AP-001",
        validFrom: "2026-11-01",
        validTo: "2027-10-31",
        coverages: [
          { serviceCode: "CONS", serviceName: "Consulta", coveredNow: false, copayPct: 80, limitPerYear: null, waitingDays: 30, waitingEndsOn: "2026-12-01", requiresAuthorization: false },
          { serviceCode: "RX", serviceName: "Raio-X", coveredNow: true, copayPct: 100, limitPerYear: 150000.5, waitingDays: 0, waitingEndsOn: null, requiresAuthorization: true },
        ],
      });
      const text = JSON.stringify(res.body);
      for (const forbidden of ["used", "reserved", "balance", "saldo", "familyId", "memberId", "holderId", "CANARIO-DOC", "birthDate", "statusNote"]) expect(text).not.toContain(forbidden);
      expect(await col("SELECT 1 FROM audit_logs WHERE action='COVERAGE_VIEW'")).toHaveLength(0);
    });

    it("beneficiário não ACTIVE: estado visível e sem serviços listados", async () => {
      await pool.query("UPDATE insurer_beneficiaries SET status='SUSPENDED' WHERE id=$1", [s.holderB.id]);
      expect((await pat("get", id.f1, id.mAdult, `/cards/${s.holderB.id}/coverage`, tok.adult)).body).toMatchObject({ status: "SUSPENDED", coverages: [] });
      await pool.query("UPDATE insurer_beneficiaries SET status='ACTIVE' WHERE id=$1", [s.holderB.id]);
    });
  });

  // ------------------------------------------------------------------ tutor (BR-INS-02, §8.5)
  describe("tutor de dependente", () => {
    it("o tutor reclama pelo dependente (código do dependente + apólice do titular); o dependente com conta e o adulto sem tutela não podem", async () => {
      const claim = await pat("post", id.f1, id.mKid, "/card-claims", tok.tutor, claimBody(id.insA, "AP-001", s.codeKidA));
      expect(claim.status).toBe(201);
      s.claimKidA = body<{ id: string }>(claim).id;
      expect((await pat("post", id.f1, id.mKid, "/card-claims", tok.adult, claimBody(id.insA, "AP-001", s.codeKidA))).status).toBe(404);
      expect((await pat("get", id.f1, id.mKid, "/card-claims", tok.teen)).status).toBe(404);
      expect((await portal("post", `/link-requests/${s.claimKidA}/confirm`, tok.admA)).status).toBe(200);
      const cards = body<{ beneficiaryId: string; beneficiaryName: string; policyNumber: string }[]>(await pat("get", id.f1, id.mKid, "/cards", tok.tutor));
      expect(cards).toEqual([expect.objectContaining({ beneficiaryId: s.kidA.id, beneficiaryName: "Crianca A", policyNumber: "AP-001" })]);
      // o tutor lê a cobertura do dependente ⇒ COVERAGE_VIEW (ator = tutor, sujeito = dependente, só insurerId)
      expect((await pat("get", id.f1, id.mKid, `/cards/${s.kidA.id}/coverage`, tok.tutor)).status).toBe(200);
      const audits = await col("SELECT actor_user_id, family_id, subject_member_id, resource_id, metadata FROM audit_logs WHERE action='COVERAGE_VIEW'");
      expect(audits).toEqual([{ actor_user_id: id.uTutor, family_id: id.f1, subject_member_id: id.mKid, resource_id: s.kidA.id, metadata: { insurerId: id.insA } }]);
      // o cartão do dependente não aparece no membro adulto nem o contrário
      expect(body<unknown[]>(await pat("get", id.f1, id.mAdult, "/cards", tok.adult)).map((c) => (c as { beneficiaryId: string }).beneficiaryId)).not.toContain(s.kidA.id);
      expect((await pat("get", id.f1, id.mAdult, `/cards/${s.kidA.id}/coverage`, tok.adult)).status).toBe(404);
      // pedido do dependente não é visível/desligável pelo membro adulto (isolamento por membro)
      expect((await pat("delete", id.f1, id.mAdult, `/card-claims/${s.claimKidA}`, tok.adult)).status).toBe(404);
      expect(body<unknown[]>(await pat("get", id.f1, id.mAdult, "/card-claims", tok.adult))).toHaveLength(2);
    });

    it("o tutor também reclama para si (SELF)", async () => {
      const code = await newCode(tok.admA, s.teenA.id);
      expect((await pat("post", id.f1, id.mTeen, "/card-claims", tok.tutor, claimBody(id.insA, "AP-001", code))).status).toBe(201);
    });
  });

  // ------------------------------------------------------------------ rejeição e desligar (TC-SEG-04)
  describe("rejeição e desligar", () => {
    it("a seguradora rejeita com motivo: o paciente vê REJECTED + motivo, sem cartão; o código está consumido; novo código permite novo pedido", async () => {
      const claim = await pat("post", id.f1, id.mOther, "/card-claims", tok.other, claimBody(id.insA, "AP-001", s.codeExtra));
      expect(claim.status).toBe(201);
      s.claimExtra = body<{ id: string }>(claim).id;
      expect((await portal("post", `/link-requests/${s.claimExtra}/reject`, tok.admA, { note: "Dados não conferem" })).status).toBe(200);
      const mine = body<{ id: string; status: string; decisionNote: string | null; beneficiaryId: string | null }[]>(await pat("get", id.f1, id.mOther, "/card-claims", tok.other));
      expect(mine).toEqual([expect.objectContaining({ id: s.claimExtra, status: "REJECTED", decisionNote: "Dados não conferem", beneficiaryId: null })]);
      expect((await pat("get", id.f1, id.mOther, `/cards/${s.extra.id}/coverage`, tok.other)).status).toBe(404);
      expect(body<unknown[]>(await pat("get", id.f1, id.mOther, "/cards", tok.other))).toEqual([]);
      expect((await pat("delete", id.f1, id.mOther, `/card-claims/${s.claimExtra}`, tok.other)).status).toBe(409);
      expect((await pat("post", id.f1, id.mOther, "/card-claims", tok.other, claimBody(id.insA, "AP-001", s.codeExtra))).status).toBe(404);
      const fresh = await newCode(tok.admA, s.extra.id);
      expect((await pat("post", id.f1, id.mOther, "/card-claims", tok.other, claimBody(id.insA, "AP-001", fresh))).status).toBe(201);
    });

    it("desligar: CONFIRMED→REVOKED, audita INSURER_LINK_REVOKE; cartão/QR/cobertura ⇒ 404; o beneficiário mantém-se; o QR emitido deixa de valer", async () => {
      const qrBefore = body<{ token: string }>(await pat("get", id.f1, id.mAdult, `/cards/${s.holderA.id}/qr`, tok.adult)).token;
      expect((await clinicEligibility({ qrToken: qrBefore })).body).toMatchObject({ eligible: true });
      expect((await pat("delete", id.f1, id.mAdult, `/card-claims/${s.claimAdultA}`, tok.adult)).status).toBe(204);
      const claims = body<{ id: string; status: string; beneficiaryId: string | null }[]>(await pat("get", id.f1, id.mAdult, "/card-claims", tok.adult));
      expect(claims.find((c) => c.id === s.claimAdultA)).toMatchObject({ status: "REVOKED", beneficiaryId: null });
      expect(body<{ insurerName: string }[]>(await pat("get", id.f1, id.mAdult, "/cards", tok.adult)).map((c) => c.insurerName)).toEqual(["Seg B"]);
      expect((await pat("get", id.f1, id.mAdult, `/cards/${s.holderA.id}/qr`, tok.adult)).status).toBe(404);
      expect((await pat("get", id.f1, id.mAdult, `/cards/${s.holderA.id}/coverage`, tok.adult)).status).toBe(404);
      const row = (await col("SELECT name, status, family_id, family_member_id, card_version FROM insurer_beneficiaries WHERE id=$1", [s.holderA.id]))[0];
      expect(row).toMatchObject({ name: "CANARIO-NOME-A", status: "ACTIVE", family_id: null, family_member_id: null, card_version: 2 });
      expect((await clinicEligibility({ qrToken: qrBefore })).body).toEqual({ eligible: false, notice: expect.any(String) as string });
      expect((await portal("get", `/beneficiaries/${s.holderA.id}`, tok.admA)).body).toMatchObject({ linked: false });
      expect(await col("SELECT metadata, actor_user_id, family_id, subject_member_id, resource_id FROM audit_logs WHERE action='INSURER_LINK_REVOKE'")).toEqual([
        { metadata: { insurerId: id.insA }, actor_user_id: id.uAdult, family_id: id.f1, subject_member_id: id.mAdult, resource_id: s.claimAdultA },
      ]);
      // já revogado ⇒ 409; pedido de outro membro/inexistente ⇒ 404
      expect((await pat("delete", id.f1, id.mAdult, `/card-claims/${s.claimAdultA}`, tok.adult)).status).toBe(409);
      expect((await pat("delete", id.f1, id.mAdult, `/card-claims/${randomUUID()}`, tok.adult)).status).toBe(404);
      expect((await pat("delete", id.f1, id.mKid, `/card-claims/${s.claimKidA}`, tok.adult)).status).toBe(404);
    });

    it("depois de desligar, com novo código o paciente pode voltar a ligar", async () => {
      const code = await newCode(tok.admA, s.holderA.id);
      const again = await pat("post", id.f1, id.mAdult, "/card-claims", tok.adult, claimBody(id.insA, "AP-001", code));
      expect(again.status).toBe(201);
    });

    it("eliminar a família só quebra a ligação: o beneficiário e os dados da seguradora mantêm-se", async () => {
      const code = body<{ code: string }>(await portal("post", `/beneficiaries/${s.delA.id}/claim-code`, tok.admA)).code;
      const claim = await pat("post", id.f3, id.mDel, "/card-claims", tok.del, claimBody(id.insA, "AP-001", code));
      expect(claim.status).toBe(201);
      expect((await portal("post", `/link-requests/${body<{ id: string }>(claim).id}/confirm`, tok.admA)).status).toBe(200);
      expect((await pat("get", id.f3, id.mDel, "/cards", tok.del)).body).toHaveLength(1);
      await pool.query("DELETE FROM families WHERE id=$1", [id.f3]);
      expect((await col("SELECT name, family_id, family_member_id FROM insurer_beneficiaries WHERE id=$1", [s.delA.id]))[0]).toMatchObject({ name: "Apagar A", family_id: null, family_member_id: null });
      expect(await col("SELECT 1 FROM insurer_beneficiary_link_requests WHERE family_id=$1", [id.f3])).toHaveLength(0);
    });
  });

  // ------------------------------------------------------------------ P-SEG-1: revogar o consentimento é sempre possível
  describe("P-SEG-1: listar pedidos e desligar com módulo desativado ou seguradora suspensa", () => {
    const seed = async (insurerId: string, doc: string, status: "CONFIRMED" | "PENDING") => {
      const beneficiary = randomUUID();
      const request = randomUUID();
      await pool.query("INSERT INTO insurer_beneficiaries (id, insurer_id, name, id_document_type, id_document_number, birth_date, relationship, card_number, status, family_id, family_member_id) VALUES ($1,$2,'Titular X','BI',$3,'1985-05-05','HOLDER',$4,'ACTIVE',$5,$6)", [beneficiary, insurerId, doc, `VF${doc.padEnd(14, "0").slice(0, 14)}`, status === "CONFIRMED" ? id.f2 : null, status === "CONFIRMED" ? id.mOut : null]);
      await pool.query("INSERT INTO insurer_beneficiary_link_requests (id, insurer_id, beneficiary_id, family_id, family_member_id, status, decided_at) VALUES ($1,$2,$3,$4,$5,$6,$7)", [request, insurerId, beneficiary, id.f2, id.mOut, status, status === "CONFIRMED" ? NOW : null]);
      return { beneficiary, request };
    };

    it.each([
      ["módulo desativado", () => id.insC, "Seg C"],
      ["seguradora suspensa", () => id.insD, "Seg D"],
    ])("%s: o paciente vê o pedido, desliga (204, audita) e o resto continua a exigir módulo ativo", async (_label, insurer, name) => {
      const { request, beneficiary } = await seed(insurer(), `PSEG1-${name}`, "CONFIRMED");
      const listed = body<{ id: string; insurerName: string; status: string }[]>(await pat("get", id.f2, id.mOut, "/card-claims", tok.out));
      expect(listed.find((c) => c.id === request)).toMatchObject({ insurerName: name, status: "CONFIRMED" });
      if (insurer() === id.insC) {
        expect((await pat("get", id.f2, id.mOut, `/cards/${beneficiary}/qr`, tok.out)).status).toBe(404);
        expect((await pat("get", id.f2, id.mOut, `/cards/${beneficiary}/coverage`, tok.out)).status).toBe(404);
        expect(body<unknown[]>(await pat("get", id.f2, id.mOut, "/cards", tok.out))).toHaveLength(0);
      }
      expect((await pat("delete", id.f2, id.mOut, `/card-claims/${request}`, tok.out)).status).toBe(204);
      const rows = await col("SELECT status FROM insurer_beneficiary_link_requests WHERE id=$1", [request]);
      expect(rows[0]).toMatchObject({ status: "REVOKED" });
      expect((await col("SELECT family_id, card_version FROM insurer_beneficiaries WHERE id=$1", [beneficiary]))[0]).toMatchObject({ family_id: null, card_version: 2 });
      expect(await col("SELECT metadata FROM audit_logs WHERE action='INSURER_LINK_REVOKE' AND resource_id=$1", [request])).toEqual([{ metadata: { insurerId: insurer() } }]);
      // já revogado ⇒ 409 (não 404); reclamar continua a ser 404 (módulo/estado)
      expect((await pat("delete", id.f2, id.mOut, `/card-claims/${request}`, tok.out)).status).toBe(409);
      expect((await pat("post", id.f2, id.mOut, "/card-claims", tok.out, claimBody(insurer(), "AP-C-1", "ABCD-EFGH"))).status).toBe(404);
    });

    it("pedidos alheios (outro membro/família) continuam 404 mesmo com módulo desativado; PENDING não se desliga (409)", async () => {
      const { request } = await seed(id.insC, "PSEG1-PEND", "PENDING");
      expect((await pat("delete", id.f2, id.mOut, `/card-claims/${request}`, tok.out)).status).toBe(409);
      expect((await pat("delete", id.f1, id.mAdult, `/card-claims/${request}`, tok.adult)).status).toBe(404);
      expect((await pat("get", id.f1, id.mAdult, "/card-claims", tok.adult)).body).not.toContainEqual(expect.objectContaining({ id: request }));
    });
  });

  // ------------------------------------------------------------------ GET /insurance-portal/me e filtro relationship
  describe("GET /insurance-portal/me", () => {
    let agentToken = "";
    beforeAll(async () => {
      const agent = randomUUID();
      await pool.query("INSERT INTO insurance_accounts (id, insurer_id, email, password_hash, role) VALUES ($1,$2,'agente-me@seg.pt','x','INSURANCE_AGENT')", [agent, id.insA]);
      agentToken = await insToken(agent);
    });

    it("devolve só o contexto da própria seguradora e papel (ADMIN, AGENT), validado contra o contrato", async () => {
      const a = await portal("get", "/me", tok.admA);
      expect(a.status).toBe(200);
      expect(a.body).toEqual({ insurerId: id.insA, name: "Seg A", currency: "AOA", operationalModuleEnabled: true, role: "INSURANCE_ADMIN" });
      const agent = await portal("get", "/me", agentToken);
      expect(agent.body).toEqual({ insurerId: id.insA, name: "Seg A", currency: "AOA", operationalModuleEnabled: true, role: "INSURANCE_AGENT" });
      expect((await portal("get", "/me", tok.admB)).body).toMatchObject({ insurerId: id.insB, currency: "USD" });
    });

    it("funciona com o módulo desativado (as restantes rotas dão 404)", async () => {
      expect((await portal("get", "/me", tok.admC)).body).toEqual({ insurerId: id.insC, name: "Seg C", currency: "AOA", operationalModuleEnabled: false, role: "INSURANCE_ADMIN" });
      expect((await portal("get", "/beneficiaries", tok.admC)).status).toBe(404);
    });

    it("minimização: sem dados de outra seguradora, e-mail, nomes de beneficiários nem ids de pacientes", async () => {
      const text = JSON.stringify([(await portal("get", "/me", tok.admA)).body, (await portal("get", "/me", agentToken)).body]);
      for (const forbidden of [id.insB, id.insC, "Seg B", "Seg C", "@seg.pt", "CANARIO", "Titular", id.admA, id.f1, id.mAdult, id.uAdult]) expect(text, forbidden).not.toContain(forbidden);
      expect(Object.keys((await portal("get", "/me", tok.admA)).body as object).sort()).toEqual(["currency", "insurerId", "name", "operationalModuleEnabled", "role"]);
    });

    it("token de User, de clínica ou ausente ⇒ 401", async () => {
      for (const token of [tok.adult, tok.clinic]) expect((await request(app).get(`${PORTAL}/me`).set("Authorization", token)).status).toBe(401);
      expect((await request(app).get(`${PORTAL}/me`)).status).toBe(401);
    });
  });

  describe("GET /insurance-portal/beneficiaries?relationship=", () => {
    it("filtra por parentesco e combina com q e companyId; só da própria seguradora", async () => {
      const holders = body<{ items: { relationship: string; name: string }[] }>(await portal("get", "/beneficiaries?relationship=HOLDER", tok.admA));
      expect(holders.items.length).toBeGreaterThan(0);
      expect(holders.items.every((b) => b.relationship === "HOLDER")).toBe(true);
      expect(holders.items.map((b) => b.name)).not.toContain("Titular B");
      const children = body<{ items: { relationship: string }[] }>(await portal("get", "/beneficiaries?relationship=CHILD", tok.admA));
      expect(children.items.length).toBeGreaterThan(0);
      expect(children.items.every((b) => b.relationship === "CHILD")).toBe(true);
      const q = body<{ items: { name: string }[] }>(await portal("get", "/beneficiaries?relationship=HOLDER&q=CANARIO-NOME", tok.admA));
      expect(q.items.map((b) => b.name)).toEqual(["CANARIO-NOME-A"]);
      expect(body<{ items: unknown[] }>(await portal("get", "/beneficiaries?relationship=CHILD&q=CANARIO-NOME", tok.admA)).items).toHaveLength(0);
      expect(body<{ items: { name: string }[] }>(await portal("get", "/beneficiaries?relationship=HOLDER", tok.admB)).items.map((b) => b.name)).toEqual(["Titular B"]);
    });

    it("valor inválido ⇒ 400 e sem ligar ao módulo desativado (404)", async () => {
      expect((await portal("get", "/beneficiaries?relationship=BOSS", tok.admA)).status).toBe(400);
      expect((await portal("get", "/beneficiaries?relationship=HOLDER", tok.admC)).status).toBe(404);
    });
  });

  // ------------------------------------------------------------------ concorrência (TC-SEG-15: uso único do código)
  describe("concorrência", () => {
    it("duas reclamações simultâneas com o mesmo código ⇒ exatamente uma cria o pedido (201), a outra recebe o mesmo 404", async () => {
      const holder = await newBeneficiary(tok.admB, { name: "Concorrente B", idDocumentNumber: "CONC-B-1" });
      await newPolicy(tok.admB, s.planB, holder.id, "AP-B-CONC");
      const code = await newCode(tok.admB, holder.id);
      const [a, b] = await Promise.all([
        pat("post", id.f2, id.mOut, "/card-claims", tok.out, claimBody(id.insB, "AP-B-CONC", code)),
        pat("post", id.f1, id.mOther, "/card-claims", tok.other, claimBody(id.insB, "AP-B-CONC", code)),
      ]);
      expect([a.status, b.status].sort()).toEqual([201, 404]);
      expect(await col("SELECT 1 FROM insurer_beneficiary_link_requests WHERE beneficiary_id=$1", [holder.id])).toHaveLength(1);
      expect((await col("SELECT claim_code_hash FROM insurer_beneficiaries WHERE id=$1", [holder.id]))[0]).toMatchObject({ claim_code_hash: null });
    });
  });

  // ------------------------------------------------------------------ rate limiting
  describe("rate limiting", () => {
    it("reclamar: 10 tentativas por utilizador em 15 min (cada tentativa conta) ⇒ 429 + Retry-After e auditoria DENIED", async () => {
      // o tutor já gastou 3 tentativas (mKid, recusa do adulto não conta aqui, mTeen, reuse em mTutor): conta-se pelo limitador
      let limited = 0;
      let last: request.Response | undefined;
      for (let i = 0; i < 12; i++) {
        last = await pat("post", id.f1, id.mTutor, "/card-claims", tok.tutor, claimBody(id.insA, "AP-001", `BAD${String(i)}BAD0`));
        if (last.status === 429) limited++;
        else expect(last.status).toBe(404);
      }
      expect(limited).toBeGreaterThanOrEqual(2);
      expect(last?.status).toBe(429);
      expect(last?.headers["retry-after"]).toBeDefined();
      expect(last?.body).toMatchObject({ code: "RATE_LIMITED" });
      const denied = await col("SELECT metadata FROM audit_logs WHERE action='INSURER_LINK_REQUEST' AND result='DENIED'");
      // vários 429, mas no máximo 1 registo DENIED por chave e janela (não inflar `audit_logs`)
      expect(limited).toBeGreaterThanOrEqual(2);
      expect(denied).toHaveLength(1);
      expect(denied[0]).toMatchObject({ metadata: { step: "CLAIM", reason: "RATE_LIMITED" } });
      // o código errado nunca aparece em auditoria nem em logs
      expect(JSON.stringify(await col("SELECT * FROM audit_logs"))).not.toContain("BAD0BAD0");
      expect(logs.join("")).not.toContain("BAD1BAD0");
    });

    it("QR: 20 pedidos por 10 min por cartão ⇒ 429 + Retry-After; outro cartão do mesmo utilizador não é afetado", async () => {
      let status = 200;
      let issued = 0;
      for (let i = 0; i < 25 && status === 200; i++) {
        const res = await pat("get", id.f1, id.mAdult, `/cards/${s.holderB.id}/qr`, tok.adult);
        status = res.status;
        if (status === 200) issued++;
        else {
          expect(res.headers["retry-after"]).toBeDefined();
          expect(res.body).toMatchObject({ code: "RATE_LIMITED" });
        }
      }
      expect(status).toBe(429);
      expect(issued).toBeLessThanOrEqual(20);
      expect(await col("SELECT 1 FROM audit_logs WHERE action='CARD_QR_ISSUE' AND result='DENIED'")).toHaveLength(1);
    });
  });

  // ------------------------------------------------------------------ minimização e privacidade (TC-SEG-08)
  describe("minimização", () => {
    it("nenhuma auditoria nem log contém código, nº de apólice, nº de cartão, documento ou nome do beneficiário", async () => {
      const everything = JSON.stringify(await col("SELECT action, metadata, resource_type, resource_id FROM audit_logs WHERE actor_type='USER'")) + logs.join("");
      for (const secret of ["AP-001", "AP-B-1", s.holderA.card, s.holderB.card, s.kidA.card, "CANARIO-DOC", "CANARIO-NOME", s.codeHolderA, s.codeKidA, s.codeHolderB]) {
        expect(everything, secret).not.toContain(secret);
      }
    });

    it("as respostas do portal da seguradora continuam sem ids de utilizador/família/membro do paciente (linked: boolean)", async () => {
      const text = JSON.stringify([(await portal("get", "/link-requests?status=CONFIRMED", tok.admA)).body, (await portal("get", `/beneficiaries/${s.kidA.id}`, tok.admA)).body]);
      for (const forbidden of [id.f1, id.mAdult, id.mKid, id.mTutor, id.uAdult, id.uTutor]) expect(text).not.toContain(forbidden);
      expect(text).toContain('"linked":true');
    });
  });
});
