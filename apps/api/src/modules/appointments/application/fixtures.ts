// Fakes em memória das portas de `appointments` (mesmo padrão de `prescriptions`/`medications`
// `application/fixtures.ts`). Não é ficheiro de teste.
import { decodeCursor, encodeCursor } from "../../../platform/page/index.js";
import type { Clock } from "../../../platform/clock/index.js";
import type { AccessContext, CanInput, Relation } from "../../access/index.js";
import type { AuditEvent } from "../../audit/index.js";
import type { Appointment, AppointmentStatus } from "../domain/appointment.js";
import type {
  AccessPolicyPort,
  AppointmentChanges,
  AppointmentListFilter,
  AppointmentsDeps,
  AppointmentsRepository,
  AuditPort,
  ClinicsPort,
  CursorPage,
  NewAppointmentRecord,
} from "./ports.js";

export type FakeTrx = Record<string, never>;
const FAKE_TRX: FakeTrx = {};

export class FakeAccessPolicy implements AccessPolicyPort<FakeTrx> {
  readonly calls: CanInput[] = [];
  relation: Relation = "SELF";
  denyWith?: Error;

  async can(_trx: FakeTrx, input: CanInput): Promise<AccessContext> {
    this.calls.push(input);
    if (this.denyWith) {
      throw this.denyWith;
    }
    return Promise.resolve({
      actor: { id: "actor-1", familyId: input.familyId, name: "Actor", isDependent: false, status: "ACTIVE" },
      subject: {
        id: input.subjectMemberId ?? "subject-1",
        familyId: input.familyId,
        name: "Subject",
        isDependent: false,
        status: "ACTIVE",
      },
      relation: this.relation,
    });
  }
}

export class FakeAuditPort implements AuditPort<FakeTrx> {
  readonly events: AuditEvent[] = [];

  async record(_trx: FakeTrx, event: AuditEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }
}

export class FakeClinicsPort implements ClinicsPort<FakeTrx> {
  readonly clinics = new Map<string, { id: string; name: string; familyId: string; active: boolean }>();

  async getBookableClinic(_trx: FakeTrx, familyId: string, clinicId: string): Promise<{ id: string; name: string } | null> {
    const clinic = this.clinics.get(clinicId);
    if (!clinic || !clinic.active || clinic.familyId !== familyId) {
      return Promise.resolve(null);
    }
    return Promise.resolve({ id: clinic.id, name: clinic.name });
  }

  seed(id: string, name: string, familyId: string, active = true): void {
    this.clinics.set(id, { id, name, familyId, active });
  }
}

function sortByCreatedAt<T extends { createdAt: Date; id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
}

function paginate<T extends { createdAt: Date; id: string }>(items: T[], limit: number, cursor?: string): CursorPage<T> {
  const sorted = sortByCreatedAt(items);
  let start = 0;
  if (cursor) {
    const decoded = decodeCursor(cursor);
    start = sorted.findIndex((item) => item.createdAt.toISOString() === decoded.createdAt && item.id === decoded.id) + 1;
  }
  const page = sorted.slice(start, start + limit);
  const hasMore = start + limit < sorted.length;
  const last = page.at(-1);
  const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;
  return { items: page, nextCursor };
}

export class FakeAppointmentsRepository implements AppointmentsRepository<FakeTrx> {
  readonly byId = new Map<string, Appointment>();

  async insert(_trx: FakeTrx, record: NewAppointmentRecord): Promise<Appointment> {
    const appointment: Appointment = {
      id: record.id,
      familyId: record.familyId,
      memberId: record.memberId,
      scheduledAt: record.scheduledAt,
      status: record.status,
      createdAt: record.createdAt,
      ...(record.professionalName !== undefined ? { professionalName: record.professionalName } : {}),
      ...(record.clinicId !== undefined ? { clinicId: record.clinicId } : {}),
      ...(record.clinicName !== undefined ? { clinicName: record.clinicName } : {}),
      ...(record.reason !== undefined ? { reason: record.reason } : {}),
      ...(record.notes !== undefined ? { notes: record.notes } : {}),
    };
    this.byId.set(appointment.id, appointment);
    return Promise.resolve(appointment);
  }

  async findById(_trx: FakeTrx, familyId: string, memberId: string, appointmentId: string): Promise<Appointment | null> {
    const appointment = this.byId.get(appointmentId);
    return Promise.resolve(appointment?.familyId === familyId && appointment.memberId === memberId ? appointment : null);
  }

  async listByMember(_trx: FakeTrx, familyId: string, memberId: string, filter: AppointmentListFilter, limit: number, cursor?: string): Promise<CursorPage<Appointment>> {
    const items = [...this.byId.values()].filter((appointment) => {
      if (appointment.familyId !== familyId || appointment.memberId !== memberId) return false;
      if (filter.status && appointment.status !== filter.status) return false;
      if (filter.from && appointment.scheduledAt.getTime() < filter.from.getTime()) return false;
      if (filter.to && appointment.scheduledAt.getTime() > filter.to.getTime()) return false;
      return true;
    });
    return Promise.resolve(paginate(items, limit, cursor));
  }

  async update(_trx: FakeTrx, familyId: string, memberId: string, appointmentId: string, changes: AppointmentChanges): Promise<Appointment> {
    const appointment = this.requireOwned(familyId, memberId, appointmentId);
    const updated: Appointment = { ...appointment };
    if (changes.scheduledAt !== undefined) updated.scheduledAt = changes.scheduledAt;
    if (changes.professionalName === null) delete updated.professionalName;
    else if (changes.professionalName !== undefined) updated.professionalName = changes.professionalName;
    if (changes.clinicId === null) delete updated.clinicId;
    else if (changes.clinicId !== undefined) updated.clinicId = changes.clinicId;
    if (changes.clinicName === null) delete updated.clinicName;
    else if (changes.clinicName !== undefined) updated.clinicName = changes.clinicName;
    if (changes.reason === null) delete updated.reason;
    else if (changes.reason !== undefined) updated.reason = changes.reason;
    if (changes.notes === null) delete updated.notes;
    else if (changes.notes !== undefined) updated.notes = changes.notes;
    this.byId.set(appointmentId, updated);
    return Promise.resolve(updated);
  }

  async updateStatus(_trx: FakeTrx, familyId: string, memberId: string, appointmentId: string, status: AppointmentStatus): Promise<Appointment> {
    const appointment = this.requireOwned(familyId, memberId, appointmentId);
    const updated: Appointment = { ...appointment, status };
    this.byId.set(appointmentId, updated);
    return Promise.resolve(updated);
  }

  async delete(_trx: FakeTrx, familyId: string, memberId: string, appointmentId: string): Promise<void> {
    const appointment = this.byId.get(appointmentId);
    if (appointment?.familyId === familyId && appointment.memberId === memberId) {
      this.byId.delete(appointmentId);
    }
    return Promise.resolve();
  }

  readonly outcomeRequestedAt = new Map<string, Date>();

  async listReminderCandidates(_trx: FakeTrx, now: Date, outcomeWindowMs: number, limit: number): Promise<Appointment[]> {
    const lookahead = now.getTime() + outcomeWindowMs;
    const outcomeThreshold = now.getTime() - outcomeWindowMs;
    return Promise.resolve(
      [...this.byId.values()]
        .filter((appointment) => {
          if (appointment.status !== "SCHEDULED") return false;
          const future = appointment.scheduledAt.getTime() > now.getTime() && appointment.scheduledAt.getTime() <= lookahead;
          const overdue = appointment.scheduledAt.getTime() <= outcomeThreshold && !this.outcomeRequestedAt.has(appointment.id);
          return future || overdue;
        })
        .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())
        .slice(0, limit),
    );
  }

  async setOutcomeRequested(_trx: FakeTrx, appointmentId: string, requestedAt: Date): Promise<void> {
    this.outcomeRequestedAt.set(appointmentId, requestedAt);
    return Promise.resolve();
  }

  private requireOwned(familyId: string, memberId: string, appointmentId: string): Appointment {
    const appointment = this.byId.get(appointmentId);
    if (!appointment) {
      throw new Error("consulta inexistente no fake");
    }
    if (appointment.familyId !== familyId || appointment.memberId !== memberId) {
      throw new Error("consulta inexistente no fake");
    }
    return appointment;
  }

  seed(appointment: Appointment): void {
    this.byId.set(appointment.id, appointment);
  }
}

export interface AppointmentsFixtures {
  deps: AppointmentsDeps<FakeTrx>;
  appointmentsRepo: FakeAppointmentsRepository;
  policy: FakeAccessPolicy;
  clinics: FakeClinicsPort;
  audit: FakeAuditPort;
}

export function createAppointmentsFixtures(clock: Clock): AppointmentsFixtures {
  const appointmentsRepo = new FakeAppointmentsRepository();
  const policy = new FakeAccessPolicy();
  const clinics = new FakeClinicsPort();
  const audit = new FakeAuditPort();
  const deps: AppointmentsDeps<FakeTrx> = {
    appointmentsRepo,
    policy,
    clinics,
    audit,
    db: FAKE_TRX,
    withTransaction: (fn) => fn(FAKE_TRX),
    clock,
  };
  return { deps, appointmentsRepo, policy, clinics, audit };
}
