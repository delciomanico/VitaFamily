// Harness de integração do módulo `professionals` (MK1): PostgreSQL real (testcontainers) com TODAS as migrações, módulo real ligado
// exatamente como em `main/api.ts` (repositórios Kysely, auditoria real, `createApp` com validação de pedidos E respostas contra o
// openapi.yaml) e os três esquemas de segurança (`bearerAuth` de User, `clinicBearerAuth`, `professionalBearerAuth`) para testar tokens
// cruzados. Cada ficheiro de teste cria o seu (um contentor por ficheiro).
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Writable } from "node:stream";
import type { Express, NextFunction, Request, RequestHandler, Response } from "express";
import type { Kysely } from "kysely";
import { Pool } from "pg";
import request from "supertest";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { defaultMigrationsDir, runMigrations } from "../../db/migrate-runner.js";
import { FixedClock } from "../../src/platform/clock/index.js";
import { runWithActor } from "../../src/platform/actor/index.js";
import { createDb, type Database } from "../../src/platform/db/index.js";
import { createApp } from "../../src/platform/http/index.js";
import { createLogger } from "../../src/platform/logger/index.js";
import { createAuditModule, type AuditModule } from "../../src/modules/audit/index.js";
import { signAccessToken } from "../../src/modules/auth/domain/jwt.js";
import { createBearerAuthSecurityHandler } from "../../src/modules/auth/interface/middleware.js";
import { signClinicAccessToken } from "../../src/modules/clinics/domain/clinic-jwt.js";
import { createClinicActorContextMiddleware, createClinicBearerAuthSecurityHandler } from "../../src/modules/clinics/interface/clinic-portal-middleware.js";
import { InMemoryStorage } from "../../src/platform/storage/index.js";
import { createProfessionalsJobs, createProfessionalsModule, ProfessionalFakeMailer, type CredentialScanQueue, type CredentialScanner, type ProfessionalsJobs, type ProfessionalsModule } from "../../src/modules/professionals/index.js";
import { openApiSpecPath } from "./openapi-spec.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
export const API = "/api/v1";
export const PROFESSIONAL_API = `${API}/professional-portal`;
export const SIGNING_KEYS = [{ kid: "k1", secret: new TextEncoder().encode("0123456789abcdef0123456789abcdef") }];
export const STRONG_PASSWORD = "uma-palavra-passe-forte-123";
export const ADMIN_USER_ID = "99999999-9999-4999-8999-999999999999";
export const PLAIN_USER_ID = "77777777-7777-4777-8777-777777777777";
export const START = new Date("2026-11-16T10:00:00.000Z");

/** Antivírus de teste: marca INFECTED qualquer ficheiro que contenha a assinatura de teste. */
export const INFECTED_MARKER = "EICAR-TEST-SIGNATURE";
class FakeScanner implements CredentialScanner {
  scan(buffer: Buffer): Promise<"CLEAN" | "INFECTED"> {
    return Promise.resolve(buffer.includes(INFECTED_MARKER) ? "INFECTED" : "CLEAN");
  }
}
class RecordingQueue implements CredentialScanQueue {
  readonly jobs: { credentialId: string }[] = [];
  enqueueScan(job: { credentialId: string }): Promise<void> {
    this.jobs.push(job);
    return Promise.resolve();
  }
}

/** Destino dos logs técnicos capturados: objeto com `write` (recebe cada linha JSON) ou array (recebe cada linha). */
export type LogSink = { write(chunk: string): void } | string[];

export interface ProfessionalsHarnessOptions {
  /** Captura os logs técnicos reais (logger da API e dos módulos) com nível `debug`; sem a opção o logger fica `silent`. */
  logStream?: LogSink;
}

function logSinkToWritable(sink: LogSink): Writable {
  return new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      const line = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      if (Array.isArray(sink)) sink.push(line);
      else sink.write(line);
      callback();
    },
  });
}

export interface ProfessionalsHarness {
  storage: InMemoryStorage;
  /** Casos de uso dos jobs (antivírus, outbox de ficheiros). */
  jobs: ProfessionalsJobs;
  /** Trabalhos de antivírus enfileirados pela API e ainda não executados. */
  scanQueue: { credentialId: string }[];
  /** Executa (e esvazia) a fila de antivírus como o worker faria. */
  runScans(): Promise<void>;
  container: StartedTestContainer;
  pool: Pool;
  db: Kysely<Database>;
  clock: FixedClock;
  mailer: ProfessionalFakeMailer;
  audit: AuditModule;
  module: ProfessionalsModule;
  app: Express;
  /** Regista, lê o código do e-mail falso, verifica e devolve `{ email, accountId, professionalId }`. */
  registerVerified(email?: string, password?: string): Promise<{ email: string; accountId: string; professionalId: string }>;
  /** Login; devolve o access token e o cookie de refresh. */
  login(email: string, password?: string): Promise<{ token: string; refreshCookie: string; professionalId: string }>;
  /** Registo + verificação + login numa chamada. */
  newProfessional(email?: string): Promise<{ email: string; accountId: string; professionalId: string; token: string }>;
  /** Último código de 6 dígitos enviado a `email` (do texto do e-mail falso). */
  lastCode(email: string): string;
  /** Tokens de outros atores, para os testes de tokens cruzados. */
  userToken(): Promise<string>;
  /** Token de User que o actor de teste trata como Platform Admin (existe a linha em `users`, para `decided_by`). */
  adminToken(): Promise<string>;
  clinicToken(): Promise<string>;
  stop(): Promise<void>;
}

let counter = 0;
let ipCounter = 0;
/** IP único por chamada do harness, para os limites por IP (5 registos/5 min…) não interferirem entre testes. */
export const nextIp = (): string => `172.16.${String(Math.floor(++ipCounter / 250))}.${String((ipCounter % 250) + 1)}`;
export const uniqueEmail = (prefix = "prof"): string => `${prefix}-${String(++counter)}-${String(Date.now())}@exemplo.ao`;

export async function startProfessionalsHarness(overrides: Partial<Parameters<typeof createProfessionalsModule>[0]> = {}, extraRouters: (parts: { audit: AuditModule; db: Kysely<Database>; clock: FixedClock; module: ProfessionalsModule }) => import("express").Router[] = () => [], options: ProfessionalsHarnessOptions = {}): Promise<ProfessionalsHarness> {
  const container = await new GenericContainer("postgres:16-alpine")
    .withEnvironment({ POSTGRES_USER: "vita", POSTGRES_PASSWORD: "vita", POSTGRES_DB: "vita" })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start();
  const pool = new Pool({ connectionString: `postgres://vita:vita@${container.getHost()}:${String(container.getMappedPort(5432))}/vita` });
  await runMigrations(pool, defaultMigrationsDir());
  const db = createDb(pool);
  const clock = new FixedClock(START);
  // Sem `logStream`: logger `silent` (comportamento anterior). Com `logStream`: nível `debug` e as linhas JSON reais vão para o destino.
  const logger = options.logStream ? createLogger({ level: "debug", destination: logSinkToWritable(options.logStream) }) : createLogger({ level: "silent" });
  const audit = createAuditModule({ db, clock });
  const mailer = new ProfessionalFakeMailer();
  const storage = new InMemoryStorage();
  const queue = new RecordingQueue();
  const jobs = createProfessionalsJobs({ db, audit, clock, logger, storage, scanner: new FakeScanner(), scanQueue: queue });
  const module = createProfessionalsModule({
    db,
    audit,
    clock,
    logger,
    mailer,
    signingKeys: SIGNING_KEYS,
    accessTtlSeconds: 900,
    refreshTtlMs: 30 * 24 * 3600 * 1000,
    cookieDomain: "",
    appBaseUrl: "https://vitafamily.cassfrei.com",
    storage,
    scanQueue: queue,
    ...overrides,
  });

  // Os três atores compõem-se como em main/api.ts (cada pedido só preenche um `*AuthSubject`).
  const clinicMiddleware = createClinicActorContextMiddleware({
    resolveClinicActorState: () => Promise.reject(new Error("não usado: nenhuma rota de clínica montada")),
  });
  // Ator de User simplificado (sem `auth`): o admin é o `ADMIN_USER_ID`; qualquer outro User não é admin.
  const userActorMiddleware: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
    const subject = req.authSubject;
    if (!subject) {
      next();
      return;
    }
    runWithActor({ userId: subject.userId, sessionId: subject.sessionId, platformAdmin: subject.userId === ADMIN_USER_ID }, () => {
      next();
    });
  };
  const actorContextMiddleware: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
    userActorMiddleware(req, res, (userErr?: unknown) => {
      if (userErr) {
        next(userErr);
        return;
      }
      clinicMiddleware(req, res, (err?: unknown) => {
        if (err) {
          next(err);
          return;
        }
        module.actorContextMiddleware(req, res, next);
      });
    });
  };
  const app = createApp({
    openApiSpecPath: openApiSpecPath(REPO_ROOT),
    logger,
    validateResponses: true,
    maxUploadBytes: 10 * 1024 * 1024,
    securityHandlers: {
      bearerAuth: createBearerAuthSecurityHandler({ signingKeys: SIGNING_KEYS, clock }),
      clinicBearerAuth: createClinicBearerAuthSecurityHandler({ signingKeys: SIGNING_KEYS, clock }),
      ...module.securityHandlers,
    },
    actorContextMiddleware,
    registerHealthRoutes: () => undefined,
    registerRoutes: (router) => {
      router.use(module.router);
      for (const extra of extraRouters({ audit, db, clock, module })) router.use(extra);
    },
  });

  const lastCode = (email: string): string => {
    const text = mailer.lastSentTo(email)?.text ?? "";
    const match = /\b(\d{6})\b/.exec(text);
    if (!match?.[1]) throw new Error(`sem código no último e-mail para ${email}`);
    return match[1];
  };

  const harness: ProfessionalsHarness = {
    container,
    storage,
    jobs,
    scanQueue: queue.jobs,
    async runScans() {
      for (const job of queue.jobs.splice(0)) await jobs.scanCredential(job);
    },
    pool,
    db,
    clock,
    mailer,
    audit,
    module,
    app,
    lastCode,
    async registerVerified(email = uniqueEmail(), password = STRONG_PASSWORD) {
      await request(app).post(`${PROFESSIONAL_API}/auth/register`).set("X-Forwarded-For", nextIp()).send({ email, password, termsVersion: "1.0" }).expect(202);
      await request(app).post(`${PROFESSIONAL_API}/auth/verify-email`).set("X-Forwarded-For", nextIp()).send({ email, token: lastCode(email) }).expect(204);
      const { rows } = await pool.query<{ id: string; pid: string }>("SELECT a.id, p.id AS pid FROM professional_accounts a JOIN professionals p ON p.account_id = a.id WHERE a.email = $1", [email]);
      const row = rows[0];
      if (!row) throw new Error("conta não criada");
      return { email, accountId: row.id, professionalId: row.pid };
    },
    async login(email, password = STRONG_PASSWORD) {
      const res = await request(app).post(`${PROFESSIONAL_API}/auth/login`).set("X-Forwarded-For", nextIp()).send({ email, password }).expect(200);
      const cookie = (res.headers["set-cookie"] as unknown as string[] | undefined)?.find((c) => c.startsWith("professional_refresh_token="));
      if (!cookie) throw new Error("sem cookie de refresh");
      return { token: (res.body as { accessToken: string }).accessToken, refreshCookie: cookie.split(";")[0] ?? "", professionalId: (res.body as { professionalId: string }).professionalId };
    },
    async newProfessional(email = uniqueEmail()) {
      const registered = await harness.registerVerified(email);
      const { token } = await harness.login(email);
      return { ...registered, token };
    },
    async adminToken() {
      await pool.query("INSERT INTO users (id, email, password_hash, name, birth_date, timezone, status, terms_accepted_version, terms_accepted_at) VALUES ($1,'admin@exemplo.ao','x','Admin','1980-01-01','Africa/Luanda','ACTIVE','1',now()) ON CONFLICT (id) DO NOTHING", [ADMIN_USER_ID]);
      return (await signAccessToken({ subject: { userId: ADMIN_USER_ID, sessionId: "88888888-8888-4888-8888-888888888888" }, now: clock.now(), ttlSeconds: 900, signingKeys: SIGNING_KEYS })).token;
    },
    async userToken() {
      return (await signAccessToken({ subject: { userId: PLAIN_USER_ID, sessionId: "88888888-8888-4888-8888-888888888888" }, now: clock.now(), ttlSeconds: 900, signingKeys: SIGNING_KEYS })).token;
    },
    async clinicToken() {
      return (await signClinicAccessToken({ subject: { clinicAccountId: "55555555-5555-4555-8555-555555555555", sessionId: "88888888-8888-4888-8888-888888888888" }, now: clock.now(), ttlSeconds: 900, signingKeys: SIGNING_KEYS })).token;
    },
    async stop() {
      await pool.end();
      await container.stop();
    },
  };
  return harness;
}
