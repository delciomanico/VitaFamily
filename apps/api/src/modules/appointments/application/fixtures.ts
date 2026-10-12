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
  ClinicOutcomeChange,
  ClinicPrescriptionInput,
  ClinicSlotLite,
  ClinicStatusChange,
  ClinicsPort,
  CursorPage,
  MembershipPort,
  MemberNamesPort,
  NewAppointmentRecord,
  PrescriptionsPort,
  RequestContext,
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
  readonly slots = new Map<string, ClinicSlotLite>();

  async getBookableClinic(_trx: FakeTrx, familyId: string, clinicId: string): Promise<{ id: string; name: string } | null> {
    const clinic = this.clinics.get(clinicId);
    if (!clinic || !clinic.active || clinic.familyId !== familyId) {
      return Promise.resolve(null);
    }
    return Promise.resolve({ id: clinic.id, name: clinic.name });
  }

  async listFreeSlots(clinicId: string, specialty?: string): Promise<ClinicSlotLite[]> {
    return Promise.resolve([...this.slots.values()].filter((slot) => slot.clinicId === clinicId && (!specialty || slot.specialty === specialty)));
  }

  async findSlot(clinicId: string, slotId: string): Promise<ClinicSlotLite | null> {
    const slot = this.slots.get(slotId);
    return Promise.resolve(slot?.clinicId === clinicId ? slot : null);
  }

  seed(id: string, name: string, familyId: string, active = true): void {
    this.clinics.set(id, { id, name, familyId, active });
  }

  seedSlot(slot: ClinicSlotLite): void {
    this.slots.set(slot.id, slot);
  }
}

export class FakeMembershipPort implements MembershipPort<FakeTrx> {
  readonly members = new Map<string, { memberId: string; status: "ACTIVE" | "BLOCKED" }>();
  defaultMembership: { memberId: string; status: "ACTIVE" | "BLOCKED" } | null = { memberId: "member-actor", status: "ACTIVE" };

  async getMembershipFacts(_trx: FakeTrx, familyId: string, userId: string): Promise<{ memberId: string; status: "ACTIVE" | "BLOCKED" } | null> {
    return Promise.resolve(this.members.get(`${familyId}:${userId}`) ?? this.defaultMembership);
  }

  seed(familyId: string, userId: string, memberId: string, status: "ACTIVE" | "BLOCKED" = "ACTIVE"): void {
    this.members.set(`${familyId}:${userId}`, { memberId, status });
  }
}

export class FakeMemberNamesPort implements MemberNamesPort<FakeTrx> {
  readonly names = new Map<string, string>();

  async getMemberName(_trx: FakeTrx, familyId: string, memberId: string): Promise<string | null> {
    return Promise.resolve(this.names.get(`${familyId}:${memberId}`) ?? "Membro Teste");
  }

  seed(familyId: string, memberId: string, name: string): void {
    this.names.set(`${familyId}:${memberId}`, name);
  }
}

export class FakePrescriptionsPort implements PrescriptionsPort<FakeTrx> {
  readonly calls: { familyId: string; memberId: string; input: ClinicPrescriptionInput; origin: { clinicAccountId: string; appointmentId: string } }[] = [];
  denyWith?: Error;

  async issueForClinic(
    _trx: FakeTrx,
    familyId: string,
    memberId: string,
    input: ClinicPrescriptionInput,
    origin: { clinicAccountId: string; appointmentId: string },
    _context: RequestContext,
  ): Promise<{ id: string }> {
    if (this.denyWith) {
      throw this.denyWith;
    }
    this.calls.push({ familyId, memberId, input, origin });
    return Promise.resolve({ id: `prescription-${this.calls.length.toString()}` });
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
      ...(record.specialty !== undefined ? { specialty: record.specialty } : {}),
      ...(record.reason !== undefined ? { reason: record.reason } : {}),
      ...(record.notes !== undefined ? { notes: record.notes } : {}),
      ...(record.slotId !== undefined ? { slotId: record.slotId } : {}),
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
    if (changes.specialty === null) delete updated.specialty;
    else if (changes.specialty !== undefined) updated.specialty = changes.specialty;
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

  async findActiveBySlot(_trx: FakeTrx, slotId: string): Promise<Appointment | null> {
    const found = [...this.byId.values()].find((appointment) => appointment.slotId === slotId && (appointment.status === "REQUESTED" || appointment.status === "SCHEDULED"));
    return Promise.resolve(found ?? null);
  }

  async listActiveSlotIds(_trx: FakeTrx, slotIds: string[]): Promise<string[]> {
    const result: string[] = [];
    for (const appointment of this.byId.values()) {
      const { slotId } = appointment;
      if (slotId === undefined) continue;
      if (!slotIds.includes(slotId)) continue;
      if (appointment.status !== "REQUESTED" && appointment.status !== "SCHEDULED") continue;
      result.push(slotId);
    }
    return Promise.resolve(result);
  }

  async findByClinicId(_trx: FakeTrx, clinicId: string, appointmentId: string): Promise<Appointment | null> {
    const appointment = this.byId.get(appointmentId);
    return Promise.resolve(appointment?.clinicId === clinicId ? appointment : null);
  }

  async listByClinicAndStatus(_trx: FakeTrx, clinicId: string, statuses: AppointmentStatus[], filter: { from?: Date; to?: Date }): Promise<Appointment[]> {
    const items = [...this.byId.values()].filter((appointment) => {
      if (appointment.clinicId !== clinicId || !statuses.includes(appointment.status)) return false;
      if (filter.from && appointment.scheduledAt.getTime() < filter.from.getTime()) return false;
      if (filter.to && appointment.scheduledAt.getTime() > filter.to.getTime()) return false;
      return true;
    });
    return Promise.resolve(items.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime()));
  }

  async updateStatusByClinic(_trx: FakeTrx, appointmentId: string, change: ClinicStatusChange): Promise<Appointment> {
    const appointment = this.byId.get(appointmentId);
    if (!appointment) {
      throw new Error("consulta inexistente no fake");
    }
    const updated: Appointment = { ...appointment, status: change.status };
    if (change.responseNote === null) delete updated.responseNote;
    else if (change.responseNote !== undefined) updated.responseNote = change.responseNote;
    this.byId.set(appointmentId, updated);
    return Promise.resolve(updated);
  }

  async completeByClinic(_trx: FakeTrx, appointmentId: string, change: ClinicOutcomeChange): Promise<Appointment> {
    const appointment = this.byId.get(appointmentId);
    if (!appointment) {
      throw new Error("consulta inexistente no fake");
    }
    const updated: Appointment = {
      ...appointment,
      status: "COMPLETED",
      outcomeRecordedByClinicAccountId: change.clinicAccountId,
      outcomeRecordedAt: change.recordedAt,
    };
    if (change.outcomeNote === null) delete updated.clinicOutcomeNote;
    else if (change.outcomeNote !== undefined) updated.clinicOutcomeNote = change.outcomeNote;
    this.byId.set(appointmentId, updated);
    return Promise.resolve(updated);
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
  membership: FakeMembershipPort;
  memberNames: FakeMemberNamesPort;
  clinics: FakeClinicsPort;
  prescriptions: FakePrescriptionsPort;
  audit: FakeAuditPort;
}

export function createAppointmentsFixtures(clock: Clock): AppointmentsFixtures {
  const appointmentsRepo = new FakeAppointmentsRepository();
  const policy = new FakeAccessPolicy();
  const membership = new FakeMembershipPort();
  const memberNames = new FakeMemberNamesPort();
  const clinics = new FakeClinicsPort();
  const prescriptions = new FakePrescriptionsPort();
  const audit = new FakeAuditPort();
  const deps: AppointmentsDeps<FakeTrx> = {
    appointmentsRepo,
    policy,
    membership,
    memberNames,
    clinics,
    prescriptions,
    audit,
    db: FAKE_TRX,
    withTransaction: (fn) => fn(FAKE_TRX),
    clock,
  };
  return { deps, appointmentsRepo, policy, membership, memberNames, clinics, prescriptions, audit };
}
