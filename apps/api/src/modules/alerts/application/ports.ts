// Portas do módulo `alerts` (conventions.md §3.2): definidas aqui, implementadas em
// `infrastructure` (Kysely/pg) ou ligadas à raiz a partir da API pública de `medications`,
// `appointments`, `examinations`, `families`, `notifications` (modules.md §2, nota 15 — `alerts`
// nunca acede às tabelas desses módulos, conventions.md §3.5). Genéricas em `Trx` para que esta
// camada nunca importe "kysely" (conventions.md §3.9).
import type { Clock } from "../../../platform/clock/index.js";
import type { Appointment } from "../../appointments/index.js";
import type { Examination } from "../../examinations/index.js";
import type { FamilyMember } from "../../families/index.js";
import type { DoseOccurrence } from "../../medications/index.js";
import type { AlertNotificationType } from "../../notifications/index.js";
import type { Alert, AlertSourceType, AlertType, RuleKey } from "../domain/alert.js";

export type WithTransaction<Trx> = <T>(fn: (trx: Trx) => Promise<T>) => Promise<T>;

/** `medications` (modules.md §3 nota 3: "interfaces de consulta"). */
export interface MedicationsPort<Trx> {
  listReminderCandidates(trx: Trx, now: Date, limit: number): Promise<DoseOccurrence[]>;
}

/** `appointments` (modules.md §3 nota 3). */
export interface AppointmentsPort<Trx> {
  listReminderCandidates(trx: Trx, now: Date, outcomeWindowMs: number, limit: number): Promise<Appointment[]>;
  setOutcomeRequested(trx: Trx, appointmentId: string, requestedAt: Date): Promise<void>;
}

/** `examinations` (modules.md §3 nota 3). */
export interface ExaminationsPort<Trx> {
  listReminderCandidates(trx: Trx, from: string, to: string, limit: number): Promise<Examination[]>;
}

/** `families` (modules.md §2) — destinatários (FR-ALR-08) e fuso efetivo (Q8). */
export interface FamiliesPort<Trx> {
  findMemberById(trx: Trx, familyId: string, memberId: string): Promise<FamilyMember | null>;
  listGuardianUserIds(trx: Trx, familyId: string, dependentId: string): Promise<string[]>;
  getEffectiveTimezone(trx: Trx, familyId: string, memberId: string): Promise<string>;
}

export interface EnqueueForAlertInput {
  alertId: string;
  recipientUserId: string;
}

/** `notifications` (modules.md §2 nota 15) — único consumidor que fecha o pipeline Alerta→Notificação. */
export interface NotificationsPort<Trx> {
  isTypeEnabled(trx: Trx, userId: string, type: AlertNotificationType): Promise<boolean>;
  enqueueForAlert(trx: Trx, input: EnqueueForAlertInput): Promise<void>;
  skipPendingForAlert(trx: Trx, alertId: string): Promise<void>;
}

export interface NewAlertRecord {
  id: string;
  recipientUserId: string;
  familyId: string;
  memberId: string;
  type: AlertType;
  sourceType: AlertSourceType;
  sourceId: string;
  ruleKey: RuleKey;
  dedupeKey: string;
  triggerAt: Date;
  createdAt: Date;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface AlertListFilter {
  unread?: boolean;
}

/** `alerts` (schema.md §4) — propriedade exclusiva deste módulo (conventions.md §3.5). */
export interface AlertsRepository<Trx> {
  /** `dedupe_key` UNIQUE (schema.md §4) — ON CONFLICT DO NOTHING (ADR-009: idempotente). Devolve
   * `null` se já existia (nada de novo a fazer: sem nova notificação). */
  insertIfNew(trx: Trx, record: NewAlertRecord): Promise<Alert | null>;
  findById(trx: Trx, recipientUserId: string, id: string): Promise<Alert | null>;
  /** UC-ALR-03: "não lidos primeiro" (`(read_at IS NULL) DESC, trigger_at DESC`, indexes.md). */
  listByRecipient(trx: Trx, recipientUserId: string, filter: AlertListFilter, limit: number, cursor?: string): Promise<CursorPage<Alert>>;
  markRead(trx: Trx, id: string, readAt: Date): Promise<Alert>;
  /** UC-ALR-04 "marcar todos": devolve os `id` efetivamente marcados agora (para
   * `notifications.skipPendingForAlert` por cada um). */
  markAllRead(trx: Trx, recipientUserId: string, readAt: Date): Promise<string[]>;
}

export interface AlertsDeps<Trx> {
  alertsRepo: AlertsRepository<Trx>;
  medications: MedicationsPort<Trx>;
  appointments: AppointmentsPort<Trx>;
  examinations: ExaminationsPort<Trx>;
  families: FamiliesPort<Trx>;
  notifications: NotificationsPort<Trx>;
  db: Trx;
  withTransaction: WithTransaction<Trx>;
  clock: Clock;
}

/** Subconjunto para o processo "api" (`listAlerts`/`markAlertRead`/`markAllAlertsRead`) — sem as
 * portas de dados de agenda; `families` só para o nome do membro na vista (`interface/dto.ts`,
 * openapi.yaml `Alert.memberName`), `notifications` para `skipPendingForAlert` ao ler. */
export type AlertsApiDeps<Trx> = Pick<AlertsDeps<Trx>, "alertsRepo" | "families" | "notifications" | "db" | "withTransaction" | "clock">;

/** Subconjunto para o processo "worker" (`alerts.scan`) — nunca HTTP. */
export type AlertsWorkerDeps<Trx> = Pick<AlertsDeps<Trx>, "alertsRepo" | "medications" | "appointments" | "examinations" | "families" | "notifications" | "withTransaction" | "clock">;

export type { Alert, AlertSourceType, AlertType, RuleKey } from "../domain/alert.js";
