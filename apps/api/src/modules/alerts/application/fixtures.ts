// Fakes em memória das portas de `alerts` (mesmo padrão de `medications`/`families`
// `application/fixtures.ts`). Não é ficheiro de teste.
import type { Appointment } from "../../appointments/index.js";
import type { Examination } from "../../examinations/index.js";
import type { FamilyMember } from "../../families/index.js";
import type { DoseOccurrence } from "../../medications/index.js";
import type { AlertNotificationType } from "../../notifications/index.js";
import type { Alert } from "../domain/alert.js";
import type {
  AlertListFilter,
  AlertsDeps,
  AlertsRepository,
  AppointmentsPort,
  CursorPage,
  EnqueueForAlertInput,
  ExaminationsPort,
  FamiliesPort,
  MedicationsPort,
  NewAlertRecord,
  NotificationsPort,
} from "./ports.js";

export type FakeTrx = Record<string, never>;
export const FAKE_TRX: FakeTrx = {};

export class FakeAlertsRepository implements AlertsRepository<FakeTrx> {
  readonly byId = new Map<string, Alert>();
  readonly byDedupeKey = new Map<string, string>();

  async insertIfNew(_trx: FakeTrx, record: NewAlertRecord): Promise<Alert | null> {
    if (this.byDedupeKey.has(record.dedupeKey)) {
      return Promise.resolve(null);
    }
    const alert: Alert = {
      id: record.id,
      recipientUserId: record.recipientUserId,
      familyId: record.familyId,
      memberId: record.memberId,
      type: record.type,
      sourceType: record.sourceType,
      sourceId: record.sourceId,
      ruleKey: record.ruleKey,
      dedupeKey: record.dedupeKey,
      triggerAt: record.triggerAt,
      createdAt: record.createdAt,
    };
    this.byId.set(alert.id, alert);
    this.byDedupeKey.set(record.dedupeKey, alert.id);
    return Promise.resolve(alert);
  }

  async findById(_trx: FakeTrx, recipientUserId: string, id: string): Promise<Alert | null> {
    const alert = this.byId.get(id);
    return Promise.resolve(alert?.recipientUserId === recipientUserId ? alert : null);
  }

  async listByRecipient(_trx: FakeTrx, recipientUserId: string, filter: AlertListFilter, limit: number, _cursor?: string): Promise<CursorPage<Alert>> {
    let items = [...this.byId.values()].filter((a) => a.recipientUserId === recipientUserId);
    if (filter.unread === true) items = items.filter((a) => !a.readAt);
    if (filter.unread === false) items = items.filter((a) => a.readAt);
    items.sort((a, b) => {
      const rankA = a.readAt ? 1 : 0;
      const rankB = b.readAt ? 1 : 0;
      if (rankA !== rankB) return rankA - rankB;
      return b.triggerAt.getTime() - a.triggerAt.getTime();
    });
    return Promise.resolve({ items: items.slice(0, limit), nextCursor: null });
  }

  async markRead(_trx: FakeTrx, id: string, readAt: Date): Promise<Alert> {
    const alert = this.byId.get(id);
    if (!alert) throw new Error("alerta inexistente no fake");
    const updated = { ...alert, readAt };
    this.byId.set(id, updated);
    return Promise.resolve(updated);
  }

  async markAllRead(_trx: FakeTrx, recipientUserId: string, readAt: Date): Promise<string[]> {
    const ids: string[] = [];
    for (const [id, alert] of this.byId) {
      if (alert.recipientUserId === recipientUserId && !alert.readAt) {
        this.byId.set(id, { ...alert, readAt });
        ids.push(id);
      }
    }
    return Promise.resolve(ids);
  }
}

export class FakeMedicationsPort implements MedicationsPort<FakeTrx> {
  doses: DoseOccurrence[] = [];

  async listReminderCandidates(_trx: FakeTrx, now: Date, limit: number): Promise<DoseOccurrence[]> {
    return Promise.resolve(
      this.doses.filter((d) => (d.status === "PENDING" || d.status === "UNCONFIRMED") && d.scheduledAt.getTime() <= now.getTime()).slice(0, limit),
    );
  }
}

export class FakeAppointmentsPort implements AppointmentsPort<FakeTrx> {
  appointments: Appointment[] = [];
  readonly outcomeRequestedAt = new Map<string, Date>();

  async listReminderCandidates(_trx: FakeTrx, now: Date, outcomeWindowMs: number, limit: number): Promise<Appointment[]> {
    const lookahead = now.getTime() + outcomeWindowMs;
    const outcomeThreshold = now.getTime() - outcomeWindowMs;
    return Promise.resolve(
      this.appointments
        .filter((a) => {
          if (a.status !== "SCHEDULED") return false;
          const future = a.scheduledAt.getTime() > now.getTime() && a.scheduledAt.getTime() <= lookahead;
          const overdue = a.scheduledAt.getTime() <= outcomeThreshold && !this.outcomeRequestedAt.has(a.id);
          return future || overdue;
        })
        .slice(0, limit),
    );
  }

  async setOutcomeRequested(_trx: FakeTrx, appointmentId: string, requestedAt: Date): Promise<void> {
    this.outcomeRequestedAt.set(appointmentId, requestedAt);
    return Promise.resolve();
  }
}

export class FakeExaminationsPort implements ExaminationsPort<FakeTrx> {
  examinations: Examination[] = [];

  async listReminderCandidates(_trx: FakeTrx, from: string, to: string, limit: number): Promise<Examination[]> {
    return Promise.resolve(this.examinations.filter((e) => e.status === "SCHEDULED" && e.examDate >= from && e.examDate <= to).slice(0, limit));
  }
}

export class FakeFamiliesPort implements FamiliesPort<FakeTrx> {
  readonly members = new Map<string, FamilyMember>();
  readonly guardianUserIdsByDependent = new Map<string, string[]>();
  readonly timeZoneByMember = new Map<string, string>();

  async findMemberById(_trx: FakeTrx, _familyId: string, memberId: string): Promise<FamilyMember | null> {
    return Promise.resolve(this.members.get(memberId) ?? null);
  }

  async listGuardianUserIds(_trx: FakeTrx, _familyId: string, dependentId: string): Promise<string[]> {
    return Promise.resolve(this.guardianUserIdsByDependent.get(dependentId) ?? []);
  }

  async getEffectiveTimezone(_trx: FakeTrx, _familyId: string, memberId: string): Promise<string> {
    return Promise.resolve(this.timeZoneByMember.get(memberId) ?? "UTC");
  }

  seedMember(member: FamilyMember): void {
    this.members.set(member.id, member);
  }
}

export class FakeNotificationsPort implements NotificationsPort<FakeTrx> {
  readonly disabledTypesByUser = new Map<string, Set<AlertNotificationType>>();
  readonly enqueued: EnqueueForAlertInput[] = [];
  readonly skipped: string[] = [];

  async isTypeEnabled(_trx: FakeTrx, userId: string, type: AlertNotificationType): Promise<boolean> {
    return Promise.resolve(!this.disabledTypesByUser.get(userId)?.has(type));
  }

  async enqueueForAlert(_trx: FakeTrx, input: EnqueueForAlertInput): Promise<void> {
    this.enqueued.push(input);
    return Promise.resolve();
  }

  async skipPendingForAlert(_trx: FakeTrx, alertId: string): Promise<void> {
    this.skipped.push(alertId);
    return Promise.resolve();
  }

  disableType(userId: string, type: AlertNotificationType): void {
    const set = this.disabledTypesByUser.get(userId) ?? new Set<AlertNotificationType>();
    set.add(type);
    this.disabledTypesByUser.set(userId, set);
  }
}

export interface AlertsFixtures {
  deps: AlertsDeps<FakeTrx>;
  alertsRepo: FakeAlertsRepository;
  medications: FakeMedicationsPort;
  appointments: FakeAppointmentsPort;
  examinations: FakeExaminationsPort;
  families: FakeFamiliesPort;
  notifications: FakeNotificationsPort;
}

export function createAlertsFixtures(clock: { now(): Date }): AlertsFixtures {
  const alertsRepo = new FakeAlertsRepository();
  const medications = new FakeMedicationsPort();
  const appointments = new FakeAppointmentsPort();
  const examinations = new FakeExaminationsPort();
  const families = new FakeFamiliesPort();
  const notifications = new FakeNotificationsPort();
  const deps: AlertsDeps<FakeTrx> = {
    alertsRepo,
    medications,
    appointments,
    examinations,
    families,
    notifications,
    db: FAKE_TRX,
    withTransaction: (fn) => fn(FAKE_TRX),
    clock,
  };
  return { deps, alertsRepo, medications, appointments, examinations, families, notifications };
}
