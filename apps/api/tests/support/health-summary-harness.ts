// Harness de integração do Resumo de saúde (M17): PostgreSQL real (testcontainers, todas as migrações) e os módulos REAIS ligados como em
// `main/api.ts` — `families`/`access`/`health-records`/`medications`/`prescriptions`/`documents`/`appointments`/`examinations`/`alerts`/`reports`,
// auditoria real e `createApp` com validação de pedidos E respostas contra o openapi.yaml. Só ficam de fora (stubs) as portas de fluxos
// que o Resumo não usa: notificações, clínicas, processos, recibos, relatórios de clínica. Os dados entram por SQL (cada módulo dono tem os seus
// testes de escrita), com o `FixedClock` do harness de `professionals` (`START` = 2026-11-16T10:00Z).
import { randomUUID } from "node:crypto";
import { createAccessModule } from "../../src/modules/access/index.js";
import { createAlertsModule, type AlertsModule } from "../../src/modules/alerts/index.js";
import { createAppointmentsModule } from "../../src/modules/appointments/index.js";
import { signAccessToken } from "../../src/modules/auth/domain/jwt.js";
import { createClinicsModule } from "../../src/modules/clinics/index.js";
import { createDocumentsModule } from "../../src/modules/documents/index.js";
import { createExaminationsModule } from "../../src/modules/examinations/index.js";
import { createFamiliesModule } from "../../src/modules/families/index.js";
import { createHealthRecordsModule } from "../../src/modules/health-records/index.js";
import { createMedicationsModule } from "../../src/modules/medications/index.js";
import { createPrescriptionsModule, type PrescriptionsModule } from "../../src/modules/prescriptions/index.js";
import { createReportsModule } from "../../src/modules/reports/index.js";
import { createLogger } from "../../src/platform/logger/index.js";
import { createUsersModule } from "../../src/modules/users/index.js";
import { withTransaction } from "../../src/platform/db/index.js";
import type { RateLimiter } from "../../src/platform/rate-limit/async.js";
import { FailingRateLimiter } from "../../src/platform/rate-limit/failing.js";
import { createTestRateLimiter } from "./rate-limiter-factory.js";
import { SIGNING_KEYS, START, startProfessionalsHarness, type LogSink, type ProfessionalsHarness } from "./professionals-harness.js";

export { START };
export const API = "/api/v1";

export interface SummaryUser {
  id: string;
  email: string;
  token: string;
}

export interface SummaryMemberOptions {
  userId?: string;
  dependent?: boolean;
  role?: "FAMILY_ADMIN" | "FAMILY_MEMBER";
  blocked?: boolean;
  guardians?: string[];
  name?: string;
  bloodType?: string;
}

export interface SummaryHarness {
  h: ProfessionalsHarness;
  alerts: AlertsModule;
  /** Enquanto `true`, o limitador de `reports` falha como o Redis parado (ADR-038 §5). */
  failLimiter: { value: boolean };
  user(name: string, options?: { timezone?: string }): Promise<SummaryUser>;
  family(name?: string): Promise<string>;
  member(familyId: string, options?: SummaryMemberOptions): Promise<string>;
  /** `grantee = null` => toda a família (DM3). */
  grant(familyId: string, owner: string, grantee: string | null, category: string): Promise<void>;
  prescription(input: { familyId: string; memberId: string; issuedOn: string; status?: "ACTIVE" | "COMPLETED" | "CANCELLED"; issuedBy?: string }): Promise<string>;
  plan(input: { familyId: string; memberId: string; name?: string; prescriptionId?: string; times?: string[] | null; intervalHours?: number; startAt: Date; endAt?: Date; status?: "ACTIVE" | "ENDED" }): Promise<string>;
  /** Tomas do plano; `at` em ISO; um único INSERT (mesmo `created_at` para todas, como a geração diária real). */
  doses(planId: string, familyId: string, memberId: string, items: { at: string; status: "PENDING" | "TAKEN" | "NOT_TAKEN" | "UNCONFIRMED" }[]): Promise<void>;
  appointment(input: { familyId: string; memberId: string; scheduledAt: string; status?: "SCHEDULED" | "COMPLETED" | "NO_SHOW" | "CANCELLED"; reason?: string }): Promise<string>;
  exam(input: {
    familyId: string;
    memberId: string;
    examDate: string;
    name?: string;
    status?: "SCHEDULED" | "COMPLETED" | "CANCELLED";
    results?: { parameter: string; value?: number | null; text?: string; unit?: string | null; referenceMin?: number; referenceMax?: number; createdAt?: string }[];
  }): Promise<string>;
  examDocument(familyId: string, memberId: string, examId: string): Promise<void>;
  rxDocument(familyId: string, memberId: string, prescriptionId: string): Promise<void>;
  alert(input: { recipientUserId: string; familyId: string; memberId: string; type: string; triggerAt: string; read?: boolean; sourceType?: "DOSE" | "APPOINTMENT" | "EXAMINATION"; sourceId?: string }): Promise<string>;
  token(userId: string): Promise<string>;
  stop(): Promise<void>;
}

export async function startSummaryHarness(options: { logStream?: LogSink; poolMax?: number; validateResponses?: boolean } = {}): Promise<SummaryHarness> {
  const failLimiter = { value: false };
  let alertsModule: AlertsModule | undefined;

  const h = await startProfessionalsHarness(
    {},
    ({ audit, db, clock, storage }) => {
      const switchable = (namespace: string): RateLimiter => {
        const working = createTestRateLimiter(clock, namespace);
        const failing = new FailingRateLimiter(clock, namespace);
        const current = (): RateLimiter => (failLimiter.value ? failing : working);
        return { consume: (key, rule, opts) => current().consume(key, rule, opts), peek: (key, rule, opts) => current().peek(key, rule, opts), reset: (key) => current().reset(key) };
      };
      const users = createUsersModule({ db, audit, clock, currentTermsVersion: "1" });
      const families = createFamiliesModule({
        db,
        audit,
        users,
        clock,
        mailer: { send: () => Promise.resolve() },
        appBaseUrl: "https://vitafamily.cassfrei.com",
        memberData: { purgeMemberFiles: () => Promise.resolve(), purgeFamilyFiles: () => Promise.resolve(), exportBeforeRemoval: () => Promise.reject(new Error("não usado")) },
      });
      const access = createAccessModule({ db, audit, families, clock });
      const healthRecords = createHealthRecordsModule({ db, audit, access, families, clock });
      const documents = createDocumentsModule({
        db,
        audit,
        access,
        clock,
        rateLimiter: createTestRateLimiter(clock, "documents"),
        storage,
        virusScanner: { scan: () => Promise.resolve("CLEAN") } as never,
        boss: {} as never,
        maxFileSizeBytes: 10 * 1024 * 1024,
        maxFamilyStorageBytes: 100 * 1024 * 1024,
      });
      const late: { prescriptions?: PrescriptionsModule } = {};
      const medications = createMedicationsModule({
        db,
        audit,
        access,
        clock,
        prescriptionOrigin: { isContentReadOnly: (trx, familyId, memberId, prescriptionId) => (late.prescriptions ? late.prescriptions.isContentReadOnly(trx, familyId, memberId, prescriptionId) : Promise.resolve(false)) },
      });
      const prescriptions = createPrescriptionsModule({ db, audit, access, medications, documents, clock });
      late.prescriptions = prescriptions;
      const clinics = createClinicsModule({
        db,
        audit,
        access,
        clock,
        rateLimiter: createTestRateLimiter(clock, "clinics"),
        clinicMailer: { send: () => Promise.resolve() } as never,
        logger: createLogger({ level: "silent" }),
        clinicSigningKeys: [],
        clinicAccessTtlSeconds: 900,
        clinicRefreshTtlMs: 1000,
        cookieDomain: "",
        slotOccupancy: { countActiveBySlot: () => Promise.resolve([]) },
      });
      const alerts = createAlertsModule({
        db,
        families,
        notifications: { isTypeEnabled: () => Promise.resolve(true), enqueueForAlert: () => Promise.resolve(), skipPendingForAlert: () => Promise.resolve() } as never,
        clock,
      });
      alertsModule = alerts;
      const examinations = createExaminationsModule({
        db,
        rateLimiter: createTestRateLimiter(clock, "examinations"),
        audit,
        access,
        clinics,
        documents,
        alerts: { raiseExamEvent: alerts.raiseExamEvent },
        receipts: {} as never,
        reportGenerator: {} as never,
        examOrders: {} as never,
        processes: { open: () => Promise.resolve(), discard: () => Promise.resolve() } as never,
        clock,
      });
      const appointments = createAppointmentsModule({
        db,
        walkInRateLimiter: createTestRateLimiter(clock, "clinic-walkin"),
        audit,
        access,
        clinics,
        examSlotOccupancy: { countScheduledBySlot: () => Promise.resolve([]) },
        prescriptions: {} as never,
        patients: {} as never,
        clinicPatients: {} as never,
        receipts: {} as never,
        consultationReports: {} as never,
        completionReceipts: {} as never,
        processes: { open: () => Promise.resolve(), discard: () => Promise.resolve() } as never,
        clock,
      });
      const reports = createReportsModule({
        clock,
        rateLimiter: switchable("reports"),
        // Mesma ligação que `main/api.ts` (M17, modules.md nota 40).
        summary: {
          alerts: (actor, familyId, memberId, query) => alerts.reads.memberAlertsSummary(actor.userId, familyId, memberId, query),
          canWrite: async (actor, familyId, memberId, category, action) => {
            try {
              await withTransaction(db, (trx) => access.policy.can(trx, { userId: actor.userId, platformAdmin: actor.platformAdmin, familyId, action, subjectMemberId: memberId, category }));
              return true;
            } catch {
              return false;
            }
          },
          timezone: (familyId, memberId) => withTransaction(db, (trx) => access.getEffectiveTimezone(trx, familyId, memberId)),
          auditView: (actor, familyId, memberId, kind, context) =>
            withTransaction(db, (trx) =>
              audit.record(trx, {
                occurredAt: clock.now(),
                actorType: "USER",
                actorUserId: actor.userId,
                action: "REPORT_VIEW",
                resourceType: "HealthSummary",
                resourceId: memberId,
                familyId,
                subjectMemberId: memberId,
                result: "SUCCESS",
                requestId: context.requestId,
                ...(context.ip !== undefined ? { ip: context.ip } : {}),
                ...(context.userAgent !== undefined ? { userAgent: context.userAgent } : {}),
                metadata: { kind },
              }),
            ),
        },
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
      return [reports.router];
    },
    { ...(options.logStream ? { logStream: options.logStream } : {}), ...(options.poolMax ? { poolMax: options.poolMax } : {}), ...(options.validateResponses === false ? { validateResponses: false } : {}) },
  );
  if (!alertsModule) throw new Error("alerts não ligado");
  const { pool, clock } = h;
  const token = async (userId: string): Promise<string> => (await signAccessToken({ subject: { userId, sessionId: randomUUID() }, now: clock.now(), ttlSeconds: 120 * 86_400, signingKeys: SIGNING_KEYS })).token;
  let storageSeq = 0;
  const document = async (familyId: string, memberId: string, column: "prescription_id" | "examination_id", resourceId: string) => {
    await pool.query(
      `INSERT INTO documents (family_id, member_id, ${column}, storage_key, original_name, mime_type, size_bytes, checksum_sha256, scan_status)
       VALUES ($1,$2,$3,$4,'doc.pdf','application/pdf',10,'00','CLEAN')`,
      [familyId, memberId, resourceId, `summary-test/${String(++storageSeq)}`],
    );
  };

  return {
    h,
    alerts: alertsModule,
    failLimiter,
    token,
    async user(name, opts = {}) {
      const id = randomUUID();
      const email = `${name}-${id}@exemplo.ao`;
      await pool.query(
        "INSERT INTO users (id, email, password_hash, name, birth_date, timezone, status, terms_accepted_version, terms_accepted_at) VALUES ($1,$2,'x',$3,'1985-01-01',$4,'ACTIVE','1',now())",
        [id, email, name, opts.timezone ?? "Africa/Luanda"],
      );
      return { id, email, token: await token(id) };
    },
    async family(name = "Família") {
      const id = randomUUID();
      await pool.query("INSERT INTO families (id, name) VALUES ($1,$2)", [id, name]);
      return id;
    },
    async member(familyId, opts = {}) {
      const id = randomUUID();
      await pool.query(
        "INSERT INTO family_members (id, family_id, user_id, name, birth_date, role, is_dependent, status, blocked_at, blood_type) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::blood_type)",
        [id, familyId, opts.userId ?? null, opts.name ?? "Membro", opts.dependent ? "2018-01-01" : "1985-01-01", opts.role ?? null, opts.dependent ?? false, opts.blocked ? "BLOCKED" : "ACTIVE", opts.blocked ? clock.now() : null, opts.bloodType ?? null],
      );
      for (const [i, guardian] of (opts.guardians ?? []).entries()) {
        await pool.query("INSERT INTO guardianships (family_id, dependent_id, guardian_id, is_primary) VALUES ($1,$2,$3,$4)", [familyId, id, guardian, i === 0]);
      }
      return id;
    },
    async grant(familyId, owner, grantee, category) {
      await pool.query("INSERT INTO sharing_grants (family_id, owner_member_id, grantee_member_id, category) VALUES ($1,$2,$3,$4::data_category)", [familyId, owner, grantee, category]);
    },
    async prescription(input) {
      const id = randomUUID();
      await pool.query("INSERT INTO prescriptions (id, family_id, member_id, issued_on, status, created_at) VALUES ($1,$2,$3,$4,$5::prescription_status,date_trunc('milliseconds', now()))", [id, input.familyId, input.memberId, input.issuedOn, input.status ?? "ACTIVE"]);
      return id;
    },
    async plan(input) {
      const id = randomUUID();
      const interval = input.intervalHours !== undefined;
      await pool.query(
        `INSERT INTO medication_plans (id, family_id, member_id, prescription_id, name, dosage, schedule_type, times, interval_hours, start_at, end_at, continuous, status, created_at)
         VALUES ($1,$2,$3,$4,$5,'1 comp.',$6::schedule_type,$7,$8,$9,$10,$11,$12::plan_status,date_trunc('milliseconds', now()))`,
        [
          id,
          input.familyId,
          input.memberId,
          input.prescriptionId ?? null,
          input.name ?? "Medicamento",
          interval ? "INTERVAL" : "FIXED_TIMES",
          interval ? null : (input.times ?? ["08:00"]),
          input.intervalHours ?? null,
          input.startAt.toISOString(),
          input.endAt ? input.endAt.toISOString() : null,
          input.endAt === undefined,
          input.status ?? "ACTIVE",
        ],
      );
      return id;
    },
    async doses(planId, familyId, memberId, items) {
      await pool.query(
        `INSERT INTO dose_occurrences (family_id, member_id, plan_id, scheduled_at, status, acted_at, created_at)
         SELECT $1, $2, $3, d.at::timestamptz, d.status::dose_status, CASE WHEN d.status IN ('TAKEN','NOT_TAKEN') THEN d.at::timestamptz END, date_trunc('milliseconds', now())
         FROM unnest($4::text[], $5::text[]) AS d(at, status)`,
        [familyId, memberId, planId, items.map((i) => i.at), items.map((i) => i.status)],
      );
    },
    async appointment(input) {
      const id = randomUUID();
      await pool.query("INSERT INTO appointments (id, family_id, member_id, scheduled_at, status, reason, created_at) VALUES ($1,$2,$3,$4,$5::appointment_status,$6,date_trunc('milliseconds', now()))", [id, input.familyId, input.memberId, input.scheduledAt, input.status ?? "SCHEDULED", input.reason ?? null]);
      return id;
    },
    async exam(input) {
      const id = randomUUID();
      await pool.query("INSERT INTO examinations (id, family_id, member_id, name, exam_date, status, created_at) VALUES ($1,$2,$3,$4,$5,$6::exam_status,date_trunc('milliseconds', now()))", [id, input.familyId, input.memberId, input.name ?? "Exame", input.examDate, input.status ?? "COMPLETED"]);
      for (const r of input.results ?? []) {
        await pool.query("INSERT INTO exam_results (examination_id, parameter, value_numeric, value_text, unit, reference_min, reference_max, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8::timestamptz, date_trunc('milliseconds', now())))", [
          id,
          r.parameter,
          r.value ?? null,
          r.text ?? null,
          r.unit ?? null,
          r.referenceMin ?? null,
          r.referenceMax ?? null,
          r.createdAt ?? null,
        ]);
      }
      return id;
    },
    examDocument: (familyId, memberId, examId) => document(familyId, memberId, "examination_id", examId),
    rxDocument: (familyId, memberId, prescriptionId) => document(familyId, memberId, "prescription_id", prescriptionId),
    async alert(input) {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO alerts (id, recipient_user_id, family_id, member_id, type, source_type, source_id, rule_key, dedupe_key, trigger_at, read_at)
         VALUES ($1,$2,$3,$4,$5::alert_type,$6::alert_source,$7,'test-rule',$8,$9,$10)`,
        [id, input.recipientUserId, input.familyId, input.memberId, input.type, input.sourceType ?? "DOSE", input.sourceId ?? randomUUID(), `dedupe-${id}`, input.triggerAt, input.read ? input.triggerAt : null],
      );
      return id;
    },
    stop: () => h.stop(),
  };
}
