// Composition root do processo "api": monta o Express app (platform/http), liga as rotas de
// operações (/health, /health/ready) e arranca o servidor HTTP. Ligar um módulo novo = 1 import
// aqui + 1 registo de rotas em `registerRoutes` (ainda nenhum em M0).
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Router } from "express";
import PgBoss from "pg-boss";
import { loadConfig } from "../platform/config/index.js";
import { createLogger } from "../platform/logger/index.js";
import { createDb, createPool, checkConnection } from "../platform/db/index.js";
import { SystemClock } from "../platform/clock/index.js";
import { MinioStorage } from "../platform/storage/index.js";
import { createApp } from "../platform/http/index.js";
import { asyncHandler } from "../platform/http/async-handler.js";
import { ServiceUnavailableError } from "../platform/errors/index.js";
import { createAuditModule } from "../modules/audit/index.js";
import { createUsersModule } from "../modules/users/index.js";
import { createAuthModule, parseSigningKeys, SmtpMailer } from "../modules/auth/index.js";
import { createFamiliesModule, SmtpMailer as FamiliesSmtpMailer } from "../modules/families/index.js";
import { createAccessModule } from "../modules/access/index.js";
import { createHealthRecordsModule } from "../modules/health-records/index.js";
import { ClamAvScanner, createDocumentsModule } from "../modules/documents/index.js";
import { createMedicationsModule } from "../modules/medications/index.js";
import { createPrescriptionsModule } from "../modules/prescriptions/index.js";
import { createClinicsModule } from "../modules/clinics/index.js";
import { createAppointmentsModule } from "../modules/appointments/index.js";
import { createExaminationsModule } from "../modules/examinations/index.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const OPENAPI_SPEC_PATH = join(REPO_ROOT, "docs/05-api/openapi.yaml");

/** `JWT_ACCESS_TTL`/`REFRESH_TTL` (environment.md §2) — só se suportam sufixos `s`/`m`/`h`/`d`. */
function parseDurationMs(value: string): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(value);
  if (!match) {
    throw new Error(`Duração inválida: "${value}" (esperado ex.: "15m", "30d").`);
  }
  const amount = Number(match[1]);
  const unitMs = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] as "s" | "m" | "h" | "d"];
  return amount * unitMs;
}

export function main(): void {
  const config = loadConfig();
  const logger = createLogger({ level: config.LOG_LEVEL });
  const pool = createPool(config.DATABASE_URL);
  const db = createDb(pool);
  const clock = new SystemClock();

  const audit = createAuditModule({ db });
  const users = createUsersModule({
    db,
    audit,
    clock,
    currentTermsVersion: config.TERMS_VERSION,
  });
  // `families` antes de `auth`: auth -> families é intencional e unidirecional (modules.md §3.7,
  // UC-MEM-05/BR-MEM-12/13/17) — auth consome o convite de conta de dependente na mesma transação
  // da criação do User.
  const families = createFamiliesModule({
    db,
    audit,
    users,
    clock,
    mailer: new FamiliesSmtpMailer(config.SMTP_URL, config.MAIL_FROM),
    appBaseUrl: config.APP_BASE_URL,
  });
  const auth = createAuthModule({
    db,
    audit,
    users,
    families,
    clock,
    mailer: new SmtpMailer(config.SMTP_URL, config.MAIL_FROM),
    signingKeys: parseSigningKeys(config.JWT_SIGNING_KEYS),
    accessTtlSeconds: Math.round(parseDurationMs(config.JWT_ACCESS_TTL) / 1000),
    refreshTtlMs: parseDurationMs(config.REFRESH_TTL),
    appBaseUrl: config.APP_BASE_URL,
    cookieDomain: config.COOKIE_DOMAIN,
    currentTermsVersion: config.TERMS_VERSION,
  });
  const access = createAccessModule({ db, audit, families, clock });
  const healthRecords = createHealthRecordsModule({ db, audit, access, families, clock });

  // `documents` (M5): `boss` aqui só envia (`enqueueScan`); quem consome (`documents.scan`) é o
  // processo "worker" (main/worker.ts, modules.md §4) — não bloqueia o arranque do servidor HTTP.
  const boss = new PgBoss(config.DATABASE_URL);
  boss.on("error", (err: Error) => {
    logger.error({ err }, "pg_boss_error");
  });
  boss.start().catch((err: unknown) => {
    logger.error({ err }, "pg_boss_start_failed");
  });
  const storage = new MinioStorage({
    endpoint: config.S3_ENDPOINT,
    useSSL: config.S3_USE_SSL,
    accessKey: config.S3_ACCESS_KEY,
    secretKey: config.S3_SECRET_KEY,
    region: config.S3_REGION,
    bucket: config.S3_BUCKET_DOCUMENTS,
  });
  storage.ensureBucket().catch((err: unknown) => {
    logger.error({ err }, "storage_ensure_bucket_failed");
  });
  const documents = createDocumentsModule({
    db,
    audit,
    access,
    clock,
    storage,
    virusScanner: new ClamAvScanner({ host: config.CLAMAV_HOST, port: config.CLAMAV_PORT }),
    boss,
    maxFileSizeBytes: config.UPLOAD_MAX_BYTES,
    maxFamilyStorageBytes: config.FAMILY_STORAGE_QUOTA_BYTES,
  });

  // M6 (plan.md §4): `medications` antes de `prescriptions` — `prescriptions` depende de
  // `medications` pela raiz (modules.md §3.6), nunca o inverso.
  const medications = createMedicationsModule({ db, audit, access, clock });
  const prescriptions = createPrescriptionsModule({ db, audit, access, medications, documents, clock });

  // M7 (plan.md §4): `clinics` antes de `appointments`/`examinations` — ambos dependem de
  // `clinics.getBookableClinic` (ClinicLookup, modules.md §2), nunca o inverso.
  const clinics = createClinicsModule({ db, audit, access, clock });
  const appointments = createAppointmentsModule({ db, audit, access, clinics, clock });
  const examinations = createExaminationsModule({ db, audit, access, clinics, documents, clock });

  function registerHealthRoutes(router: Router): void {
    router.get("/health", (_req, res) => {
      res.json({ status: "ok" });
    });
    router.get(
      "/health/ready",
      asyncHandler(async (_req, res, next) => {
        const healthy = await checkConnection(pool);
        if (!healthy) {
          next(new ServiceUnavailableError({ detail: "Base de dados indisponível." }));
          return;
        }
        res.json({ status: "ok" });
      }),
    );
  }

  const app = createApp({
    openApiSpecPath: OPENAPI_SPEC_PATH,
    logger,
    securityHandlers: auth.securityHandlers,
    actorContextMiddleware: auth.actorContextMiddleware,
    registerHealthRoutes,
    registerRoutes: (router) => {
      router.use(users.router);
      router.use(auth.router);
      router.use(families.router);
      router.use(access.router);
      router.use(healthRecords.router);
      router.use(documents.router);
      router.use(medications.router);
      router.use(prescriptions.router);
      router.use(clinics.router);
      router.use(clinics.adminRouter);
      router.use(appointments.router);
      router.use(examinations.router);
    },
  });

  const server = app.listen(config.PORT, () => {
    logger.info({ port: config.PORT, env: config.NODE_ENV }, "api_started");
  });

  function shutdown(signal: string): void {
    logger.info({ signal }, "api_shutting_down");
    server.close(() => {
      boss
        .stop()
        .catch((err: unknown) => {
          logger.error({ err }, "pg_boss_stop_failed");
        })
        .finally(() => {
          pool
            .end()
            .catch((err: unknown) => {
              logger.error({ err }, "pool_close_failed");
            })
            .finally(() => process.exit(0));
        });
    });
  }

  process.on("SIGTERM", () => {
    shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    shutdown("SIGINT");
  });
}

main();
