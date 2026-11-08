// Fakes em memória das portas de `appointments` (mesmo padrão de `prescriptions`/`medications`
// `application/fixtures.ts`). Não é ficheiro de teste.
import { ValidationError } from "../../../platform/errors/index.js";
import { decodeCursor, encodeCursor } from "../../../platform/page/index.js";
import type { Clock } from "../../../platform/clock/index.js";
import type { AccessContext, CanInput, Relation } from "../../access/index.js";
import type { AuditEvent } from "../../audit/index.js";
import type { Appointment, AppointmentStatus } from "../domain/appointment.js";
import { WalkInInMemoryRateLimiter } from "../domain/walk-in.js";
import type {
  AccessPolicyPort,
  AppointmentChanges,
  AppointmentListFilter,
  AppointmentsDeps,
  AppointmentsRepository,
  AuditPort,
  ClinicOutcomeChange,
  ClinicPrescriptionInput,
  AppointmentSlotBookingCount,
  ClinicAppointmentsFilter,
  ClinicPatientDirectoryPort,
  ClinicPortalActor,
  ClinicVisitBookingView,
  ClinicSlotLite,
  ExamSlotOccupancyPort,
  ClinicStatusChange,
  ClinicsPort,
  ConfirmationChange,
  CursorPage,
  DayFlowChange,
  MembershipPort,
  MemberNamesPort,
  NewAppointmentRecord,
  PatientDirectoryPort,
  PrescriptionsPort,
  ReminderWindows,
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
    if (!clinic || !clinic.active || (clinic.familyId !== "" && clinic.familyId !== familyId)) {
      return Promise.resolve(null);
    }
    return Promise.resolve({ id: clinic.id, name: clinic.name });
  }

  async listFreeSlots(clinicId: string, specialty?: string, kind: "APPOINTMENT" | "EXAM" = "APPOINTMENT"): Promise<ClinicSlotLite[]> {
    return Promise.resolve([...this.slots.values()].filter((slot) => slot.clinicId === clinicId && slot.kind === kind && (!specialty || slot.specialty === specialty)));
  }

  async findSlot(clinicId: string, slotId: string): Promise<ClinicSlotLite | null> {
    const slot = this.slots.get(slotId);
    return Promise.resolve(slot?.clinicId === clinicId ? slot : null);
  }

  async lockSlot(_trx: FakeTrx, slotId: string): Promise<ClinicSlotLite | null> {
    return Promise.resolve(this.slots.get(slotId) ?? null);
  }

  async listProfessionalSlotsOverlapping(_trx: FakeTrx, professionalId: string, from: Date, to: Date, excludeSlotId: string): Promise<string[]> {
    return Promise.resolve(
      [...this.slots.values()]
        .filter((slot) => slot.id !== excludeSlotId && slot.professionalId === professionalId)
        .filter((slot) => slot.startsAt.getTime() < to.getTime() && slot.startsAt.getTime() + slot.durationMinutes * 60_000 > from.getTime())
        .map((slot) => slot.id),
    );
  }

  /** `familyId` vazio = clínica PARTNER (selecionável por qualquer família). */
  seed(id: string, name: string, familyId: string, active = true): void {
    this.clinics.set(id, { id, name, familyId, active });
  }

  seedSlot(slot: ClinicSlotLite): void {
    this.slots.set(slot.id, slot);
  }
}

export class FakeExamSlotOccupancyPort implements ExamSlotOccupancyPort<FakeTrx> {
  /** `slotId` -> exames `SCHEDULED` nesse horário. */
  readonly booked = new Map<string, number>();

  async countScheduledBySlot(_trx: FakeTrx, slotIds: string[]): Promise<{ slotId: string; count: number }[]> {
    return Promise.resolve(slotIds.filter((id) => (this.booked.get(id) ?? 0) > 0).map((slotId) => ({ slotId, count: this.booked.get(slotId) ?? 0 })));
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

/** D20: `email` (já normalizado) -> paciente resolvível; ausente = inexistente/não ACTIVE/sem SELF (oráculo uniforme). */
export class FakePatientDirectory implements PatientDirectoryPort<FakeTrx> {
  readonly patients = new Map<string, { familyId: string; memberId: string; fullName: string }>();
  readonly lookedUp: string[] = [];

  async findSelfByEmail(_trx: FakeTrx, email: string): Promise<{ familyId: string; memberId: string; fullName: string } | null> {
    this.lookedUp.push(email);
    return Promise.resolve(this.patients.get(email) ?? null);
  }

  seed(email: string, familyId: string, memberId: string, fullName: string): void {
    this.patients.set(email, { familyId, memberId, fullName });
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

/** BR-CLN-25: repõe `PENDING` e anula confirmação/chegada/início (reativação ou nova hora). */
function resetDayFlow(appointment: Appointment): void {
  appointment.confirmationStatus = "PENDING";
  delete appointment.confirmationSource;
  delete appointment.confirmedAt;
  delete appointment.arrivedAt;
  delete appointment.startedAt;
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
      confirmationStatus: "PENDING",
      createdAt: record.createdAt,
      ...(record.professionalName !== undefined ? { professionalName: record.professionalName } : {}),
      ...(record.clinicId !== undefined ? { clinicId: record.clinicId } : {}),
      ...(record.clinicName !== undefined ? { clinicName: record.clinicName } : {}),
      ...(record.specialty !== undefined ? { specialty: record.specialty } : {}),
      ...(record.reason !== undefined ? { reason: record.reason } : {}),
      ...(record.notes !== undefined ? { notes: record.notes } : {}),
      ...(record.slotId !== undefined ? { slotId: record.slotId } : {}),
      durationMinutes: record.durationMinutes ?? 30,
      ...(record.walkIn ? { walkIn: true } : {}),
      ...(record.bookedByClinicAccountId !== undefined ? { bookedByClinicAccountId: record.bookedByClinicAccountId } : {}),
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
    if (changes.scheduledAt !== undefined) {
      updated.scheduledAt = changes.scheduledAt;
      resetDayFlow(updated);
    }
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

  async updateStatus(_trx: FakeTrx, familyId: string, memberId: string, appointmentId: string, status: AppointmentStatus, options: { resetDayFlow?: boolean } = {}): Promise<Appointment> {
    const appointment = this.requireOwned(familyId, memberId, appointmentId);
    const updated: Appointment = { ...appointment, status };
    if (status !== "COMPLETED") delete updated.followUpDueOn;
    if (options.resetDayFlow) resetDayFlow(updated);
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

  async listFollowUpCandidates(_trx: FakeTrx, from: string, to: string, limit: number): Promise<Appointment[]> {
    return Promise.resolve([...this.byId.values()].filter((a) => a.status === "COMPLETED" && a.followUpDueOn !== undefined && a.followUpDueOn >= from && a.followUpDueOn <= to).slice(0, limit));
  }

  async applyConfirmation(_trx: FakeTrx, familyId: string, memberId: string, appointmentId: string, change: ConfirmationChange): Promise<Appointment> {
    const appointment = this.requireOwned(familyId, memberId, appointmentId);
    const updated: Appointment = { ...appointment, confirmationStatus: change.confirmationStatus };
    if (change.confirmationSource) updated.confirmationSource = change.confirmationSource;
    else delete updated.confirmationSource;
    if (change.confirmedAt) updated.confirmedAt = change.confirmedAt;
    else delete updated.confirmedAt;
    if (change.cancel) {
      updated.status = "CANCELLED";
      delete updated.followUpDueOn;
    }
    this.byId.set(appointmentId, updated);
    return Promise.resolve(updated);
  }

  async applyConfirmationByClinic(_trx: FakeTrx, clinicId: string, appointmentId: string, confirmedAt: Date): Promise<Appointment> {
    const appointment = this.requireOfClinic(clinicId, appointmentId);
    const updated: Appointment = { ...appointment, confirmationStatus: "CONFIRMED", confirmationSource: "CLINIC", confirmedAt };
    this.byId.set(appointmentId, updated);
    return Promise.resolve(updated);
  }

  async applyDayFlow(_trx: FakeTrx, clinicId: string, appointmentId: string, change: DayFlowChange): Promise<Appointment> {
    const appointment = this.requireOfClinic(clinicId, appointmentId);
    const updated: Appointment = { ...appointment, ...(change.status ? { status: change.status } : {}), ...(change.arrivedAt ? { arrivedAt: change.arrivedAt } : {}), ...(change.startedAt ? { startedAt: change.startedAt } : {}) };
    this.byId.set(appointmentId, updated);
    return Promise.resolve(updated);
  }

  async setFollowUp(_trx: FakeTrx, clinicId: string, appointmentId: string, dueOn: string | null): Promise<Appointment> {
    const appointment = this.requireOfClinic(clinicId, appointmentId);
    const updated: Appointment = { ...appointment };
    if (dueOn === null) delete updated.followUpDueOn;
    else updated.followUpDueOn = dueOn;
    this.byId.set(appointmentId, updated);
    return Promise.resolve(updated);
  }

  async listFollowUpsByClinic(_trx: FakeTrx, clinicId: string, until: string, limit: number): Promise<Appointment[]> {
    return Promise.resolve(
      [...this.byId.values()]
        .filter((a) => a.clinicId === clinicId && a.status === "COMPLETED" && a.followUpDueOn !== undefined && a.followUpDueOn <= until)
        .sort((a, b) => (a.followUpDueOn ?? "").localeCompare(b.followUpDueOn ?? "") || a.id.localeCompare(b.id))
        .slice(0, limit),
    );
  }

  async listReminderCandidates(_trx: FakeTrx, now: Date, windows: ReminderWindows, limit: number): Promise<Appointment[]> {
    const lookahead = now.getTime() + windows.lookaheadMs;
    const outcomeThreshold = now.getTime() - windows.outcomeWindowMs;
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

  async countActiveBySlot(_trx: FakeTrx, slotIds: string[]): Promise<AppointmentSlotBookingCount[]> {
    const bySlot = new Map<string, AppointmentSlotBookingCount>();
    for (const appointment of this.byId.values()) {
      const { slotId } = appointment;
      if (slotId === undefined || !slotIds.includes(slotId)) continue;
      if (appointment.status !== "REQUESTED" && appointment.status !== "SCHEDULED") continue;
      const entry = bySlot.get(slotId) ?? { slotId, requested: 0, scheduled: 0 };
      if (appointment.status === "REQUESTED") entry.requested += 1;
      else entry.scheduled += 1;
      bySlot.set(slotId, entry);
    }
    return Promise.resolve([...bySlot.values()]);
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

  async listForClinic(_trx: FakeTrx, clinicId: string, filter: ClinicAppointmentsFilter, limit?: number): Promise<Appointment[]> {
    const rows = [...this.byId.values()]
      .filter((a) => a.clinicId === clinicId)
      .filter((a) => !filter.from || a.scheduledAt.getTime() >= filter.from.getTime())
      .filter((a) => !filter.to || a.scheduledAt.getTime() < filter.to.getTime())
      .filter((a) => !(filter.familyId && filter.memberId) || (a.familyId === filter.familyId && a.memberId === filter.memberId))
      .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
    return Promise.resolve(limit === undefined ? rows : rows.reverse().slice(0, limit));
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

  async findScheduledOverlapping(_trx: FakeTrx, familyId: string, memberId: string, from: Date, to: Date): Promise<Appointment[]> {
    return Promise.resolve(
      [...this.byId.values()].filter(
        (a) =>
          a.familyId === familyId &&
          a.memberId === memberId &&
          a.status === "SCHEDULED" &&
          a.scheduledAt.getTime() < to.getTime() &&
          a.scheduledAt.getTime() + (a.durationMinutes ?? 30) * 60_000 > from.getTime(),
      ),
    );
  }

  private requireOfClinic(clinicId: string, appointmentId: string): Appointment {
    const appointment = this.byId.get(appointmentId);
    if (appointment?.clinicId !== clinicId) {
      throw new Error("consulta inexistente no fake");
    }
    return appointment;
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
  examSlotOccupancy: FakeExamSlotOccupancyPort;
  prescriptions: FakePrescriptionsPort;
  patients: FakePatientDirectory;
  clinicPatients: FakeClinicPatientDirectory;
  audit: FakeAuditPort;
}

/** Fake de `ClinicPatientDirectoryPort` (M14 P): pacientes semeados, visitas em memória; regras reais testam-se em `clinic-patients`. */
export class FakeClinicPatientDirectory implements ClinicPatientDirectoryPort<FakeTrx> {
  readonly patients = new Map<string, { clinicId: string; name: string; link: { familyId: string; memberId: string } | null }>();
  readonly visits = new Map<string, ClinicVisitBookingView & { clinicId: string }>();
  readonly ensured: { clinicId: string; familyId: string; memberId: string; clinicPatientId: string }[] = [];
  readonly calls: string[] = [];
  private counter = 0;

  constructor(private readonly clinics: FakeClinicsPort) {}

  seedPatient(id: string, clinicId: string, name: string, link: { familyId: string; memberId: string } | null = null): void {
    this.patients.set(id, { clinicId, name, link });
  }

  async resolvePatient(_trx: FakeTrx, clinicId: string, clinicPatientId: string) {
    const patient = this.patients.get(clinicPatientId);
    return Promise.resolve(patient?.clinicId === clinicId ? { clinicPatientId, name: patient.name, link: patient.link } : null);
  }

  async ensureLinkedByEmail(_trx: FakeTrx, actor: ClinicPortalActor, input: { familyId: string; memberId: string; fullName: string }): Promise<{ clinicPatientId: string }> {
    const existing = [...this.patients.entries()].find(([, p]) => p.clinicId === actor.clinicId && p.link?.memberId === input.memberId);
    const clinicPatientId = existing?.[0] ?? `auto-patient-${String(++this.counter)}`;
    if (!existing) this.seedPatient(clinicPatientId, actor.clinicId, input.fullName, { familyId: input.familyId, memberId: input.memberId });
    this.ensured.push({ clinicId: actor.clinicId, familyId: input.familyId, memberId: input.memberId, clinicPatientId });
    return Promise.resolve({ clinicPatientId });
  }

  async bookVisit(_trx: FakeTrx, actor: ClinicPortalActor, input: { clinicPatientId: string; slotId: string; notes?: string | null }): Promise<ClinicVisitBookingView> {
    this.calls.push("bookVisit");
    const slot = this.clinics.slots.get(input.slotId);
    const patient = this.patients.get(input.clinicPatientId);
    if (!slot || !patient) throw new Error("slot/paciente em falta no fake");
    const view: ClinicVisitBookingView & { clinicId: string } = {
      id: `visit-${String(++this.counter)}`,
      clinicId: actor.clinicId,
      status: "SCHEDULED",
      scheduledAt: slot.startsAt.toISOString(),
      specialty: slot.specialty,
      patientName: patient.name,
      source: "MANUAL",
      clinicPatientId: input.clinicPatientId,
      slotId: slot.id,
      confirmationStatus: "PENDING",
      dayState: "SCHEDULED",
      ...(input.notes ? { notes: input.notes } : {}),
    };
    this.visits.set(view.id, view);
    return Promise.resolve(view);
  }

  /** M14 Q: as regras reais das visitas testam-se em `clinic-patients`; o fake só regista a chamada e devolve a vista. */
  private visitAction(name: string, clinicId: string, visitId: string, patch: Partial<ClinicVisitBookingView>): Promise<ClinicVisitBookingView | null> {
    this.calls.push(name);
    const visit = this.visits.get(visitId);
    if (visit?.clinicId !== clinicId) return Promise.resolve(null);
    const updated = { ...visit, ...patch };
    this.visits.set(visitId, updated);
    return Promise.resolve(updated);
  }

  async confirmVisit(_trx: FakeTrx, actor: ClinicPortalActor, visitId: string): Promise<ClinicVisitBookingView | null> {
    return this.visitAction("confirmVisit", actor.clinicId, visitId, { confirmationStatus: "CONFIRMED", confirmationSource: "CLINIC" });
  }

  async arriveVisit(_trx: FakeTrx, actor: ClinicPortalActor, visitId: string): Promise<ClinicVisitBookingView | null> {
    return this.visitAction("arriveVisit", actor.clinicId, visitId, { dayState: "ARRIVED" });
  }

  async startVisit(_trx: FakeTrx, actor: ClinicPortalActor, visitId: string): Promise<ClinicVisitBookingView | null> {
    return this.visitAction("startVisit", actor.clinicId, visitId, { dayState: "IN_PROGRESS" });
  }

  async noShowVisit(_trx: FakeTrx, actor: ClinicPortalActor, visitId: string): Promise<ClinicVisitBookingView | null> {
    return this.visitAction("noShowVisit", actor.clinicId, visitId, { status: "NO_SHOW", dayState: "NO_SHOW" });
  }

  async setVisitFollowUp(_trx: FakeTrx, actor: ClinicPortalActor, visitId: string): Promise<ClinicVisitBookingView | null> {
    return this.visitAction("setVisitFollowUp", actor.clinicId, visitId, { followUpDueOn: "2027-01-01" });
  }

  async clearVisitFollowUp(_trx: FakeTrx, actor: ClinicPortalActor, visitId: string): Promise<ClinicVisitBookingView | null> {
    return this.visitAction("clearVisitFollowUp", actor.clinicId, visitId, {});
  }

  async listVisits(_trx: FakeTrx, clinicId: string): Promise<ClinicVisitBookingView[]> {
    return Promise.resolve([...this.visits.values()].filter((v) => v.clinicId === clinicId));
  }

  async cancelVisit(_trx: FakeTrx, actor: ClinicPortalActor, visitId: string, note: string): Promise<ClinicVisitBookingView | null> {
    const visit = this.visits.get(visitId);
    if (visit?.clinicId !== actor.clinicId) return Promise.resolve(null);
    const updated = { ...visit, status: "CANCELLED" as const, responseNote: note };
    this.visits.set(visitId, updated);
    return Promise.resolve(updated);
  }

  async completeVisit(_trx: FakeTrx, actor: ClinicPortalActor, visitId: string, input: { outcomeNote?: string | null; prescription?: unknown }): Promise<ClinicVisitBookingView | null> {
    const visit = this.visits.get(visitId);
    if (visit?.clinicId !== actor.clinicId) return Promise.resolve(null);
    if (input.prescription !== undefined && input.prescription !== null) {
      throw new ValidationError([{ field: "prescription", message: "não aplicável" }], { detail: "Visitas manuais não têm receita." });
    }
    const updated = { ...visit, status: "COMPLETED" as const };
    this.visits.set(visitId, updated);
    return Promise.resolve(updated);
  }

  async countActiveVisitsBySlot(_trx: FakeTrx, slotIds: string[]): Promise<{ slotId: string; count: number }[]> {
    return Promise.resolve(slotIds.flatMap((slotId) => {
      const count = [...this.visits.values()].filter((v) => v.slotId === slotId && v.status === "SCHEDULED").length;
      return count > 0 ? [{ slotId, count }] : [];
    }));
  }

  async findPatientIdsByMembers(_trx: FakeTrx, clinicId: string, memberIds: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    for (const [id, p] of this.patients) {
      if (p.clinicId === clinicId && p.link && memberIds.includes(p.link.memberId)) map.set(p.link.memberId, id);
    }
    return Promise.resolve(map);
  }
}

export function createAppointmentsFixtures(clock: Clock): AppointmentsFixtures {
  const appointmentsRepo = new FakeAppointmentsRepository();
  const policy = new FakeAccessPolicy();
  const membership = new FakeMembershipPort();
  const memberNames = new FakeMemberNamesPort();
  const clinics = new FakeClinicsPort();
  const examSlotOccupancy = new FakeExamSlotOccupancyPort();
  const prescriptions = new FakePrescriptionsPort();
  const patients = new FakePatientDirectory();
  const clinicPatients = new FakeClinicPatientDirectory(clinics);
  const audit = new FakeAuditPort();
  const deps: AppointmentsDeps<FakeTrx> = {
    appointmentsRepo,
    policy,
    membership,
    memberNames,
    clinics,
    examSlotOccupancy,
    prescriptions,
    patients,
    clinicPatients,
    walkInRateLimiter: new WalkInInMemoryRateLimiter(clock),
    audit,
    db: FAKE_TRX,
    withTransaction: (fn) => fn(FAKE_TRX),
    clock,
  };
  return { deps, appointmentsRepo, policy, membership, memberNames, clinics, examSlotOccupancy, prescriptions, patients, clinicPatients, audit };
}
