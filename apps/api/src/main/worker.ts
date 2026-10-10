// Composition root do processo "worker": arranca a infraestrutura de filas (pg-boss) sobre o
// PostgreSQL (sem Redis, ADR-004/ADR-014) e regista os jobs de cada módulo (modules.md §4/§5:
// `documents` — antivírus (M5); `medications` — `generate-doses`/`mark-unconfirmed` (M6); cada
// módulo seguinte acrescenta 1 import + 1 registo, mesmo padrão).
import PgBoss from "pg-boss";
import { loadConfig } from "../platform/config/index.js";
import { createLogger } from "../platform/logger/index.js";
import { createDb, createPool } from "../platform/db/index.js";
import { SystemClock } from "../platform/clock/index.js";
import { MinioStorage } from "../platform/storage/index.js";
import { createAuditModule } from "../modules/audit/index.js";
import { createUsersModule } from "../modules/users/index.js";
import { createFamiliesModule, SmtpMailer as FamiliesSmtpMailer } from "../modules/families/index.js";
import { createAccessModule } from "../modules/access/index.js";
import { ClamAvScanner, createDocumentsWorkerModule } from "../modules/documents/index.js";
import { createMedicationsWorkerModule } from "../modules/medications/index.js";
import { createAppointmentsReminderQueries } from "../modules/appointments/index.js";
import { createExaminationsReminderQueries } from "../modules/examinations/index.js";
import { createNotificationsWorkerModule, SmtpMailer as NotificationsSmtpMailer, WebPushSender } from "../modules/notifications/index.js";
import { createAlertsWorkerModule } from "../modules/alerts/index.js";

export function main(): void {
  const config = loadConfig();
  const logger = createLogger({ level: config.LOG_LEVEL });

  const pool = createPool(config.DATABASE_URL);
  const db = createDb(pool);
  const clock = new SystemClock();
  const audit = createAuditModule({ db });
  // `medications.generate-doses`/`mark-unconfirmed` (modules.md §5) precisam de
  // `access.getEffectiveTimezone` (nota 10) para resolver o fuso efetivo do sujeito — por isso este
  // processo monta a cadeia `users -> families -> access` só para esse fim (nunca para autorizar
  // pedidos HTTP, que não existem aqui); `documents.scan` continua sem precisar de nenhum dos dois
  // (nunca autoriza nada).
  const users = createUsersModule({ db, audit, clock, currentTermsVersion: config.TERMS_VERSION });
  const families = createFamiliesModule({
    db,
    audit,
    users,
    clock,
    mailer: new FamiliesSmtpMailer(config.SMTP_URL, config.MAIL_FROM),
    appBaseUrl: config.APP_BASE_URL,
  });
  const access = createAccessModule({ db, audit, families, clock });
  const storage = new MinioStorage({
    endpoint: config.S3_ENDPOINT,
    useSSL: config.S3_USE_SSL,
    accessKey: config.S3_ACCESS_KEY,
    secretKey: config.S3_SECRET_KEY,
    region: config.S3_REGION,
    bucket: config.S3_BUCKET_DOCUMENTS,
  });
  const virusScanner = new ClamAvScanner({ host: config.CLAMAV_HOST, port: config.CLAMAV_PORT });

  const boss = new PgBoss(config.DATABASE_URL);

  boss.on("error", (err: Error) => {
    logger.error({ err }, "pg_boss_error");
  });

  const documentsWorker = createDocumentsWorkerModule({ db, audit, clock, storage, virusScanner, boss });
  const medicationsWorker = createMedicationsWorkerModule({ db, audit, access, clock, boss });

  // M8 (plan.md §4): `alerts.scan` só precisa de ler consultas/exames (`listReminderCandidates`)
  // e escrever `outcome_requested_at` — nunca `clinics`/`documents`/`access` (processo de
  // sistema, sem ator a autorizar nem nome de clínica a resolver), por isso usa as raízes de
  // composição mínimas destes módulos em vez de `createAppointmentsModule`/`createExaminationsModule`.
  const appointmentsQueries = createAppointmentsReminderQueries({ db });
  const examinationsQueries = createExaminationsReminderQueries({ db });
  const notificationsWorker = createNotificationsWorkerModule({
    db,
    users,
    clock,
    mailer: new NotificationsSmtpMailer(config.SMTP_URL, config.MAIL_FROM),
    pushSender: new WebPushSender({ publicKey: config.VAPID_PUBLIC_KEY, privateKey: config.VAPID_PRIVATE_KEY, subject: config.VAPID_SUBJECT }),
    boss,
  });
  const alertsWorker = createAlertsWorkerModule({
    db,
    families,
    medications: medicationsWorker,
    appointments: appointmentsQueries,
    examinations: examinationsQueries,
    notifications: notificationsWorker,
    clock,
    boss,
  });

  boss
    .start()
    .then(async () => {
      await documentsWorker.registerWorker();
      await medicationsWorker.registerWorkers();
      await notificationsWorker.registerWorkers();
      await alertsWorker.registerWorkers();
      logger.info({}, "worker_started");
    })
    .catch((err: unknown) => {
      logger.error({ err }, "worker_start_failed");
      process.exit(1);
    });

  async function shutdown(signal: string): Promise<void> {
    logger.info({ signal }, "worker_shutting_down");
    await boss.stop();
    await pool.end();
    process.exit(0);
  }

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
}

main();
