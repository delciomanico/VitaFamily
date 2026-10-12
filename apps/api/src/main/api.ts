// Composition root do processo "api": monta o Express app (platform/http), liga as rotas de
// operações (/health, /health/ready) e arranca o servidor HTTP. Ligar um módulo novo = 1 import
// aqui + 1 registo de rotas em `registerRoutes` (ainda nenhum em M0).
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { NextFunction, Request, RequestHandler, Response, Router } from "express";
import PgBoss from "pg-boss";
import { loadConfig } from "../platform/config/index.js";
import { createLogger } from "../platform/logger/index.js";
import { createDb, createPool, checkConnection } from "../platform/db/index.js";
import { SystemClock } from "../platform/clock/index.js";
import { MinioStorage } from "../platform/storage/index.js";
import { createApp } from "../platform/http/index.js";
import { createMetrics } from "../platform/metrics/index.js";
import { asyncHandler } from "../platform/http/async-handler.js";
import { ServiceUnavailableError } from "../platform/errors/index.js";
import { createAuditModule } from "../modules/audit/index.js";
import { createUsersModule } from "../modules/users/index.js";
import { createAuthModule, parseSigningKeys, SmtpMailer } from "../modules/auth/index.js";
import { createFamiliesModule, SmtpMailer as FamiliesSmtpMailer } from "../modules/families/index.js";
import { createAccessModule } from "../modules/access/index.js";
import { createHealthRecordsModule } from "../modules/health-records/index.js";
import { ClamAvScanner, createDocumentsModule, type DocumentsModule } from "../modules/documents/index.js";
import { createMedicationsModule } from "../modules/medications/index.js";
import { createPrescriptionsModule } from "../modules/prescriptions/index.js";
import { ClinicSmtpMailer, createClinicsModule, parseClinicSigningKeys } from "../modules/clinics/index.js";
import { createAppointmentsModule } from "../modules/appointments/index.js";
import { createExaminationsModule } from "../modules/examinations/index.js";
import { createLifecycleModule, type LifecycleModule } from "../modules/lifecycle/index.js";
import { createAdminModule } from "../modules/admin/index.js";
import { createReportsModule } from "../modules/reports/index.js";
import { createNotificationsModule, SmtpMailer as NotificationsSmtpMailer, WebPushSender } from "../modules/notifications/index.js";
import { createAlertsModule } from "../modules/alerts/index.js";

/**
 * Sobe a partir deste ficheiro até encontrar `relativePath`. Não usa um número fixo de "..": em
 * dev corre via `tsx` a partir de `src/main`, em produção a partir de `dist/src/main` (uma pasta
 * mais profunda) — um número fixo acerta só num dos dois. A imagem de produção (apps/api/Dockerfile)
 * não leva o monorepo completo, só `docs/05-api/openapi.yaml`; por isso procura-se este ficheiro
 * em concreto, não um marcador separado da raiz do workspace.
 */
function findUpwards(startDir: string, relativePath: string): string {
  let dir = startDir;
  for (;;) {
    const candidate = join(dir, relativePath);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`Não encontrei "${relativePath}" a partir de "${startDir}".`);
    }
    dir = parent;
  }
}

const OPENAPI_SPEC_PATH = findUpwards(dirname(fileURLToPath(import.meta.url)), "docs/05-api/openapi.yaml");

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

  // O MinIO pode ainda estar a arrancar quando a API sobe (mesmo compose): sem repetir, o bucket
  // ficava por criar até ao próximo reinício e todos os uploads davam 500.
  async function ensureBucketWithRetry(target: { ensureBucket: () => Promise<void> }, message: string): Promise<void> {
    for (let attempt = 1; attempt <= 30; attempt++) {
      try {
        await target.ensureBucket();
        return;
      } catch (err) {
        logger.error({ err, attempt }, message);
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }

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
  // `families` precisa de `documents` (ficheiros) e `lifecycle` (pacote de dados), que dependem dele:
  // a porta `memberData` resolve-os tardiamente (atribuídos mais abaixo, antes de o servidor ouvir).
  const late: { documents?: DocumentsModule; lifecycle?: LifecycleModule } = {};
  const required = <T>(module: T | undefined, name: string): T => {
    if (!module) throw new Error(`${name} ainda não inicializado`);
    return module;
  };
  const families = createFamiliesModule({
    db,
    audit,
    users,
    clock,
    mailer: new FamiliesSmtpMailer(config.SMTP_URL, config.MAIL_FROM),
    appBaseUrl: config.APP_BASE_URL,
    memberData: {
      purgeMemberFiles: (trx, familyId, memberId) => required(late.documents, "documents").purgeMemberFiles(trx, familyId, memberId),
      purgeFamilyFiles: (trx, familyId) => required(late.documents, "documents").purgeFamilyFiles(trx, familyId),
      exportBeforeRemoval: (input) => required(late.lifecycle, "lifecycle").exportBeforeRemoval(input),
    },
  });
  const auth = createAuthModule({
    db,
    audit,
    users,
    families,
    clock,
    mailer: new SmtpMailer(config.SMTP_URL, config.MAIL_FROM),
    logger,
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
  void ensureBucketWithRetry(storage, "storage_ensure_bucket_failed");
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

  late.documents = documents;

  // M6 (plan.md §4): `medications` antes de `prescriptions` — `prescriptions` depende de
  // `medications` pela raiz (modules.md §3.6), nunca o inverso.
  const medications = createMedicationsModule({ db, audit, access, clock });
  const prescriptions = createPrescriptionsModule({ db, audit, access, medications, documents, clock });

  // M7 (plan.md §4): `clinics` antes de `appointments`/`examinations` — ambos dependem de
  // `clinics.getBookableClinic` (ClinicLookup, modules.md §2), nunca o inverso.
  // D17/D18 (ADR-020): identidade do Portal da Clínica (`ClinicAccount`) totalmente separada de
  // `auth`/`User` — reutiliza o mesmo valor de configuração `JWT_SIGNING_KEYS`/TTLs, mas com o seu
  // próprio parser/tipo (`parseClinicSigningKeys`, duplicado de `auth`, nunca importado de lá).
  const clinics = createClinicsModule({
    db,
    audit,
    access,
    clock,
    clinicMailer: new ClinicSmtpMailer(config.SMTP_URL, config.MAIL_FROM),
    logger,
    clinicSigningKeys: parseClinicSigningKeys(config.JWT_SIGNING_KEYS),
    clinicAccessTtlSeconds: Math.round(parseDurationMs(config.JWT_ACCESS_TTL) / 1000),
    clinicRefreshTtlMs: parseDurationMs(config.REFRESH_TTL),
    cookieDomain: config.COOKIE_DOMAIN,
  });
  // D18 (BR-CLN-06/BR-RX-07): `appointments` liga-se a `prescriptions` só aqui, pela sua API
  // pública (`issuePrescriptionForClinic`) — nenhuma aresta nova no grafo de módulos (modules.md
  // §3 notas 16/20; `appointments/application/ports.ts#PrescriptionsPort`).
  const appointments = createAppointmentsModule({
    db,
    audit,
    access,
    clinics,
    prescriptions: { issuePrescriptionForClinic: prescriptions.issuePrescriptionForClinic },
    clock,
  });
  const examinations = createExaminationsModule({ db, audit, access, clinics, documents, clock });

  // M8 (plan.md §4): `notifications` antes de `alerts` — `alerts` depende de `notifications`
  // pela raiz (modules.md §3 nota 15), nunca o inverso.
  const notifications = createNotificationsModule({
    db,
    users,
    clock,
    mailer: new NotificationsSmtpMailer(config.SMTP_URL, config.MAIL_FROM),
    pushSender: new WebPushSender({ publicKey: config.VAPID_PUBLIC_KEY, privateKey: config.VAPID_PRIVATE_KEY, subject: config.VAPID_SUBJECT }),
  });
  const alerts = createAlertsModule({ db, families, notifications, clock });

  // M9 (plan.md §4): `reports` lê pelas APIs públicas dos módulos dono (modules.md §2); cada
  // leitura aplica a sua `AccessPolicy` e auditoria, por isso reports não decide permissões.
  const reports = createReportsModule({
    clock,
    sources: {
      listMembers: families.reads.listMembers,
      bloodType: healthRecords.reads.bloodType,
      allergies: healthRecords.reads.allergies,
      conditions: healthRecords.reads.conditions,
      prescriptions: prescriptions.reads.prescriptions,
      plans: medications.reads.plans,
      doses: medications.reads.doses,
      adherence: medications.reads.adherence,
      appointments: appointments.reads.appointments,
      examinations: examinations.reads.examinations,
    },
  });

  const admin = createAdminModule({ db, users, audit, clock });

  // M9: `lifecycle` (exportação de dados) lê pelas mesmas APIs públicas; o pacote vai para o
  // bucket de exportações (`S3_BUCKET_EXPORTS`), à parte dos documentos.
  const exportsStorage = new MinioStorage({
    endpoint: config.S3_ENDPOINT,
    useSSL: config.S3_USE_SSL,
    accessKey: config.S3_ACCESS_KEY,
    secretKey: config.S3_SECRET_KEY,
    region: config.S3_REGION,
    bucket: config.S3_BUCKET_EXPORTS,
  });
  void ensureBucketWithRetry(exportsStorage, "exports_storage_ensure_bucket_failed");
  const lifecycle = createLifecycleModule({
    db,
    audit,
    clock,
    storage: exportsStorage,
    mailer: new FamiliesSmtpMailer(config.SMTP_URL, config.MAIL_FROM),
    onBuildError: (err, exportId) => {
      logger.error({ err, exportId }, "export_build_failed");
    },
    onNotifyError: (err) => {
      logger.error({ err }, "lifecycle_notify_failed");
    },
    account: {
      verifyPassword: auth.verifyPassword,
      leaveFamily: (userId, familyId, context) => families.actions.leaveFamily(userId, familyId, context),
      deleteFamily: (userId, familyId, context) => families.actions.deleteFamily(userId, familyId, context),
      deleteAccount: users.deleteAccount,
      anonymizeAudit: audit.anonymizeUser,
    },
    sources: {
      account: async (userId) => {
        const user = await users.byId(db, userId);
        return user ? { name: user.name, email: user.email, birthDate: user.birthDate, timezone: user.timezone } : null;
      },
      listFamilies: families.reads.listFamilies,
      listMembers: families.reads.listMembers,
      bloodType: healthRecords.reads.bloodType,
      allergies: healthRecords.reads.allergies,
      conditions: healthRecords.reads.conditions,
      prescriptions: prescriptions.reads.prescriptions,
      plans: medications.reads.plans,
      doses: medications.reads.doses,
      appointments: appointments.reads.appointments,
      examinations: examinations.reads.examinations,
      documents: documents.reads.list,
      downloadDocument: documents.reads.download,
    },
  });

  late.lifecycle = lifecycle;

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

  const metrics = createMetrics();

  // D17/D18 (ADR-020): `/clinic-portal/*` usa um SEGUNDO ator (`ClinicActorInfo`), nunca o de
  // `User` — `createApp` só tem UM slot de `actorContextMiddleware`; aqui compõem-se os dois
  // (primeiro o de `auth`, depois o de `clinics`) porque cada pedido só preenche um dos dois
  // `req.authSubject`/`req.clinicAuthSubject` (esquemas de segurança distintos no contrato), nunca
  // os dois ao mesmo tempo — nenhuma rota de negócio lê o ator "errado" (ADR-020).
  const actorContextMiddleware: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
    auth.actorContextMiddleware(req, res, (err?: unknown) => {
      if (err) {
        next(err);
        return;
      }
      clinics.clinicActorContextMiddleware(req, res, next);
    });
  };

  const app = createApp({
    openApiSpecPath: OPENAPI_SPEC_PATH,
    logger,
    securityHandlers: { ...auth.securityHandlers, ...clinics.clinicSecurityHandlers },
    actorContextMiddleware,
    metrics: { middleware: metrics.httpMiddleware, handler: metrics.handler },
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
      router.use(clinics.clinicPortalRouter);
      router.use(appointments.router);
      router.use(appointments.clinicPortalRouter);
      router.use(examinations.router);
      router.use(notifications.router);
      router.use(alerts.router);
      router.use(reports.router);
      router.use(admin.router);
      router.use(lifecycle.router);
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
