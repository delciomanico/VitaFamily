// Fakes em memória das portas de `clinic-patients` (mesmo padrão de `appointments`/`clinics` `application/fixtures.ts`).
// Não é ficheiro de teste. Os repositórios reproduzem as regras relevantes da BD (UNIQUE, cascatas por membro).
import type { Clock } from "../../../platform/clock/index.js";
import { ConflictError, ForbiddenError, NotFoundError } from "../../../platform/errors/index.js";
import type { AccessContext, CanInput } from "../../access/index.js";
import type { AuditEvent } from "../../audit/index.js";
import { patientMatches, type ClinicPatient } from "../domain/clinic-patient.js";
import type { ClinicConsent } from "../domain/consent.js";
import type { ClinicVisit } from "../domain/clinic-visit.js";
import { InMemoryRateLimiter } from "../domain/rate-limiter.js";
import type {
  AccessPolicyPort,
  AppointmentFact,
  AuditPort,
  CalendarSourcePort,
  ClinicDirectoryPort,
  ClinicPatientLink,
  ClinicPatientsDeps,
  ConsentWrite,
  ConsentsRepository,
  ExaminationFact,
  FollowUpFact,
  LinkCodeRecord,
  LinkCodesRepository,
  LinksRepository,
  MemberDirectoryPort,
  NewPatientRecord,
  NewVisitRecord,
  PatientChanges,
  PatientListFilter,
  PatientsRepository,
  RecommendationFact,
  RecommendationsSourcePort,
  ReportSourcePort,
  SharedExam,
  SharedHistoryReaderPort,
  SharedMedication,
  SlotFacts,
  SlotReservationPort,
  VisitDayFlowChange,
  VisitListFilter,
  VisitsRepository,
} from "./ports.js";

export type FakeTrx = Record<string, never>;
const FAKE_TRX: FakeTrx = {};

export class FakeAuditPort implements AuditPort<FakeTrx> {
  readonly events: AuditEvent[] = [];
  async record(_trx: FakeTrx, event: AuditEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }
}

/** `MANAGE_CLINIC_CONSENT`: `relations` mapeia `userId:memberId` -> relação; sem entrada => família/membro inexistente. */
export class FakeAccessPolicy implements AccessPolicyPort<FakeTrx> {
  readonly relations = new Map<string, "SELF" | "TUTOR_OF" | "DEPENDENT_SELF" | "OTHER">();
  readonly calls: CanInput[] = [];

  async can(_trx: FakeTrx, input: CanInput): Promise<AccessContext> {
    this.calls.push(input);
    const relation = this.relations.get(`${input.userId}:${input.subjectMemberId ?? ""}`);
    if (input.platformAdmin) throw new ForbiddenError({ detail: "Platform Admin não acede a dados de saúde." });
    if (!relation) throw new NotFoundError({ detail: "Família não encontrada." });
    if (relation !== "SELF" && relation !== "TUTOR_OF") throw new ForbiddenError({ detail: "Sem permissão." });
    return Promise.resolve({
      actor: { id: "actor", familyId: input.familyId, name: "A", isDependent: false, status: "ACTIVE" },
      subject: { id: input.subjectMemberId ?? "", familyId: input.familyId, name: "S", isDependent: false, status: "ACTIVE" },
      relation,
    });
  }
}

export class FakePatientsRepository implements PatientsRepository<FakeTrx> {
  readonly byId = new Map<string, ClinicPatient>();

  async insert(_trx: FakeTrx, record: NewPatientRecord): Promise<ClinicPatient> {
    const patient: ClinicPatient = {
      id: record.id,
      clinicId: record.clinicId,
      name: record.name,
      origin: record.origin,
      createdAt: record.createdAt,
      updatedAt: record.createdAt,
      ...(record.phone ? { phone: record.phone } : {}),
      ...(record.email ? { email: record.email } : {}),
      ...(record.birthDate ? { birthDate: record.birthDate } : {}),
      ...(record.notes ? { notes: record.notes } : {}),
    };
    this.byId.set(patient.id, patient);
    return Promise.resolve(patient);
  }

  async findById(_trx: FakeTrx, clinicId: string, patientId: string): Promise<ClinicPatient | null> {
    const patient = this.byId.get(patientId);
    return Promise.resolve(patient?.clinicId === clinicId ? patient : null);
  }

  async countCreatedBetween(_trx: FakeTrx, clinicId: string, from: Date, to: Date): Promise<number> {
    return Promise.resolve([...this.byId.values()].filter((p) => p.clinicId === clinicId && p.createdAt.getTime() >= from.getTime() && p.createdAt.getTime() < to.getTime()).length);
  }

  async findManyByIds(_trx: FakeTrx, clinicId: string, patientIds: string[]): Promise<ClinicPatient[]> {
    return Promise.resolve(patientIds.flatMap((id) => { const p = this.byId.get(id); return p?.clinicId === clinicId ? [p] : []; }));
  }

  async update(_trx: FakeTrx, clinicId: string, patientId: string, changes: PatientChanges, now: Date): Promise<ClinicPatient> {
    const existing = this.byId.get(patientId);
    if (existing?.clinicId !== clinicId) throw new Error("paciente inexistente no fake");
    const next: ClinicPatient = { ...existing, updatedAt: now };
    if (changes.name !== undefined) next.name = changes.name;
    for (const key of ["phone", "email", "birthDate", "notes"] as const) {
      const value = changes[key];
      if (value === null) Reflect.deleteProperty(next, key);
      else if (value !== undefined) next[key] = value;
    }
    this.byId.set(patientId, next);
    return Promise.resolve(next);
  }

  async list(_trx: FakeTrx, clinicId: string, filter: PatientListFilter, limit: number): Promise<ClinicPatient[]> {
    const norm = (p: ClinicPatient): string => p.name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim().replace(/\s+/g, " ");
    return Promise.resolve(
      [...this.byId.values()]
        .filter((p) => p.clinicId === clinicId)
        .filter((p) => !filter.terms || patientMatches(p, filter.terms))
        .sort((a, b) => (norm(a) < norm(b) ? -1 : norm(a) > norm(b) ? 1 : a.id.localeCompare(b.id)))
        .filter((p) => {
          if (!filter.after) return true;
          const n = norm(p);
          return n > filter.after.n || (n === filter.after.n && p.id > filter.after.i);
        })
        .slice(0, limit),
    );
  }
}

export class FakeLinksRepository implements LinksRepository<FakeTrx> {
  readonly links: ClinicPatientLink[] = [];

  async insert(_trx: FakeTrx, link: ClinicPatientLink): Promise<void> {
    if (this.links.some((l) => l.clinicPatientId === link.clinicPatientId || (l.clinicId === link.clinicId && l.memberId === link.memberId))) {
      throw new ConflictError({ detail: "Já existe uma ligação para este paciente ou membro." });
    }
    this.links.push(link);
    return Promise.resolve();
  }
  async findByPatient(_trx: FakeTrx, clinicId: string, patientId: string): Promise<ClinicPatientLink | null> {
    return Promise.resolve(this.links.find((l) => l.clinicId === clinicId && l.clinicPatientId === patientId) ?? null);
  }
  async findByMember(_trx: FakeTrx, clinicId: string, memberId: string): Promise<ClinicPatientLink | null> {
    return Promise.resolve(this.links.find((l) => l.clinicId === clinicId && l.memberId === memberId) ?? null);
  }
  async findByPatients(_trx: FakeTrx, clinicId: string, patientIds: string[]): Promise<ClinicPatientLink[]> {
    return Promise.resolve(this.links.filter((l) => l.clinicId === clinicId && patientIds.includes(l.clinicPatientId)));
  }
  async findByMembers(_trx: FakeTrx, clinicId: string, memberIds: string[]): Promise<ClinicPatientLink[]> {
    return Promise.resolve(this.links.filter((l) => l.clinicId === clinicId && memberIds.includes(l.memberId)));
  }
  async listByMember(_trx: FakeTrx, familyId: string, memberId: string): Promise<ClinicPatientLink[]> {
    return Promise.resolve(this.links.filter((l) => l.familyId === familyId && l.memberId === memberId));
  }
  async deleteByMember(_trx: FakeTrx, clinicId: string, memberId: string): Promise<boolean> {
    const index = this.links.findIndex((l) => l.clinicId === clinicId && l.memberId === memberId);
    if (index < 0) return Promise.resolve(false);
    this.links.splice(index, 1);
    return Promise.resolve(true);
  }
}

export class FakeConsentsRepository implements ConsentsRepository<FakeTrx> {
  readonly consents: ClinicConsent[] = [];

  async find(_trx: FakeTrx, clinicId: string, memberId: string): Promise<ClinicConsent | null> {
    return Promise.resolve(this.consents.find((c) => c.clinicId === clinicId && c.memberId === memberId) ?? null);
  }
  async findMany(_trx: FakeTrx, clinicId: string, memberIds: string[]): Promise<ClinicConsent[]> {
    return Promise.resolve(this.consents.filter((c) => c.clinicId === clinicId && memberIds.includes(c.memberId)));
  }
  async listByMember(_trx: FakeTrx, familyId: string, memberId: string): Promise<ClinicConsent[]> {
    return Promise.resolve(this.consents.filter((c) => c.familyId === familyId && c.memberId === memberId));
  }
  async upsert(_trx: FakeTrx, write: ConsentWrite): Promise<void> {
    const index = this.consents.findIndex((c) => c.clinicId === write.clinicId && c.memberId === write.memberId);
    const consent: ClinicConsent = { clinicId: write.clinicId, familyId: write.familyId, memberId: write.memberId, level: write.level, ...(write.historyValidUntil ? { historyValidUntil: write.historyValidUntil } : {}) };
    if (index >= 0) this.consents[index] = consent;
    else this.consents.push(consent);
    return Promise.resolve();
  }
  async insertBookingsIfMissing(_trx: FakeTrx, clinicId: string, familyId: string, memberId: string): Promise<boolean> {
    if (this.consents.some((c) => c.clinicId === clinicId && c.memberId === memberId)) return Promise.resolve(false);
    this.consents.push({ clinicId, familyId, memberId, level: "BOOKINGS" });
    return Promise.resolve(true);
  }
  async delete(_trx: FakeTrx, clinicId: string, memberId: string): Promise<boolean> {
    const index = this.consents.findIndex((c) => c.clinicId === clinicId && c.memberId === memberId);
    if (index < 0) return Promise.resolve(false);
    this.consents.splice(index, 1);
    return Promise.resolve(true);
  }
}

export class FakeLinkCodesRepository implements LinkCodesRepository<FakeTrx> {
  readonly codes: (LinkCodeRecord & { usedAt?: Date })[] = [];

  async invalidateActive(_trx: FakeTrx, memberId: string, now: Date): Promise<void> {
    for (const code of this.codes) if (code.memberId === memberId && !code.usedAt) code.usedAt = now;
    return Promise.resolve();
  }
  async insert(_trx: FakeTrx, record: LinkCodeRecord): Promise<void> {
    this.codes.push({ ...record });
    return Promise.resolve();
  }
  async listCreatedSince(_trx: FakeTrx, memberId: string, since: Date): Promise<Date[]> {
    return Promise.resolve(this.codes.filter((c) => c.memberId === memberId && c.createdAt.getTime() > since.getTime()).map((c) => c.createdAt).sort((a, b) => a.getTime() - b.getTime()));
  }
  async consume(_trx: FakeTrx, codeHash: string, now: Date): Promise<{ familyId: string; memberId: string } | null> {
    const code = this.codes.find((c) => c.codeHash === codeHash && !c.usedAt && c.expiresAt.getTime() > now.getTime());
    if (!code) return Promise.resolve(null);
    code.usedAt = now;
    return Promise.resolve({ familyId: code.familyId, memberId: code.memberId });
  }
  async purge(_trx: FakeTrx, olderThan: Date): Promise<number> {
    const before = this.codes.length;
    const keep = this.codes.filter((c) => !(c.expiresAt.getTime() < olderThan.getTime() || (c.usedAt && c.usedAt.getTime() < olderThan.getTime())));
    this.codes.length = 0;
    this.codes.push(...keep);
    return Promise.resolve(before - keep.length);
  }
}

export class FakeVisitsRepository implements VisitsRepository<FakeTrx> {
  readonly byId = new Map<string, ClinicVisit>();

  async insert(_trx: FakeTrx, record: NewVisitRecord): Promise<ClinicVisit> {
    if ([...this.byId.values()].some((v) => v.slotId === record.slotId && v.status === "SCHEDULED")) {
      throw new ConflictError({ detail: "Esse horário já tem uma marcação ativa." });
    }
    const visit: ClinicVisit = {
      id: record.id,
      clinicId: record.clinicId,
      clinicPatientId: record.clinicPatientId,
      slotId: record.slotId,
      scheduledAt: record.scheduledAt,
      durationMinutes: record.durationMinutes,
      status: "SCHEDULED",
      confirmationStatus: "PENDING",
      createdAt: record.createdAt,
      bookedByClinicAccountId: record.bookedByClinicAccountId,
      ...(record.notes ? { notes: record.notes } : {}),
    };
    this.byId.set(visit.id, visit);
    return Promise.resolve(visit);
  }
  async findById(_trx: FakeTrx, clinicId: string, visitId: string): Promise<ClinicVisit | null> {
    const visit = this.byId.get(visitId);
    return Promise.resolve(visit?.clinicId === clinicId ? visit : null);
  }
  async list(_trx: FakeTrx, clinicId: string, filter: VisitListFilter, limit?: number): Promise<ClinicVisit[]> {
    const rows = [...this.byId.values()]
      .filter((v) => v.clinicId === clinicId)
      .filter((v) => !filter.statuses || filter.statuses.includes(v.status))
      .filter((v) => !filter.from || v.scheduledAt.getTime() >= filter.from.getTime())
      .filter((v) => !filter.to || v.scheduledAt.getTime() < filter.to.getTime())
      .filter((v) => !filter.clinicPatientId || v.clinicPatientId === filter.clinicPatientId)
      .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
    return Promise.resolve(limit === undefined ? rows : rows.reverse().slice(0, limit));
  }
  async countScheduledBySlot(_trx: FakeTrx, slotIds: string[]): Promise<{ slotId: string; count: number }[]> {
    return Promise.resolve(slotIds.flatMap((slotId) => {
      const count = [...this.byId.values()].filter((v) => v.slotId === slotId && v.status === "SCHEDULED").length;
      return count > 0 ? [{ slotId, count }] : [];
    }));
  }
  async findScheduledOverlapping(_trx: FakeTrx, clinicPatientId: string, from: Date, to: Date): Promise<ClinicVisit[]> {
    return Promise.resolve([...this.byId.values()].filter((v) => v.clinicPatientId === clinicPatientId && v.status === "SCHEDULED" && v.scheduledAt.getTime() < to.getTime() && v.scheduledAt.getTime() + v.durationMinutes * 60_000 > from.getTime()));
  }
  async setStatus(_trx: FakeTrx, clinicId: string, visitId: string, change: { status: ClinicVisit["status"]; outcomeNote?: string | null; cancelNote?: string | null }): Promise<ClinicVisit> {
    const visit = this.byId.get(visitId);
    if (visit?.clinicId !== clinicId) throw new Error("visita inexistente no fake");
    const next: ClinicVisit = { ...visit, status: change.status };
    if (change.outcomeNote) next.outcomeNote = change.outcomeNote;
    if (change.cancelNote) next.cancelNote = change.cancelNote;
    if (change.status !== "COMPLETED") delete next.followUpDueOn;
    this.byId.set(visitId, next);
    return Promise.resolve(next);
  }
  private require(clinicId: string, visitId: string): ClinicVisit {
    const visit = this.byId.get(visitId);
    if (visit?.clinicId !== clinicId) throw new Error("visita inexistente no fake");
    return visit;
  }
  async applyConfirmation(_trx: FakeTrx, clinicId: string, visitId: string, confirmedAt: Date): Promise<ClinicVisit> {
    const next: ClinicVisit = { ...this.require(clinicId, visitId), confirmationStatus: "CONFIRMED", confirmedAt };
    this.byId.set(visitId, next);
    return Promise.resolve(next);
  }
  async applyDayFlow(_trx: FakeTrx, clinicId: string, visitId: string, change: VisitDayFlowChange): Promise<ClinicVisit> {
    const visit = this.require(clinicId, visitId);
    const next: ClinicVisit = { ...visit, ...(change.status ? { status: change.status } : {}), ...(change.arrivedAt ? { arrivedAt: change.arrivedAt } : {}), ...(change.startedAt ? { startedAt: change.startedAt } : {}) };
    this.byId.set(visitId, next);
    return Promise.resolve(next);
  }
  async setFollowUp(_trx: FakeTrx, clinicId: string, visitId: string, dueOn: string | null): Promise<ClinicVisit> {
    const next: ClinicVisit = { ...this.require(clinicId, visitId) };
    if (dueOn === null) delete next.followUpDueOn;
    else next.followUpDueOn = dueOn;
    this.byId.set(visitId, next);
    return Promise.resolve(next);
  }
  async listFollowUps(_trx: FakeTrx, clinicId: string, until: string, limit: number): Promise<ClinicVisit[]> {
    return Promise.resolve(
      [...this.byId.values()]
        .filter((v) => v.clinicId === clinicId && v.status === "COMPLETED" && v.followUpDueOn !== undefined && v.followUpDueOn <= until)
        .sort((a, b) => (a.followUpDueOn ?? "").localeCompare(b.followUpDueOn ?? "") || a.id.localeCompare(b.id))
        .slice(0, limit),
    );
  }
}

export class FakeMemberDirectory implements MemberDirectoryPort<FakeTrx> {
  readonly names = new Map<string, string>();
  async getMemberName(_trx: FakeTrx, _familyId: string, memberId: string): Promise<string | null> {
    return Promise.resolve(this.names.get(memberId) ?? null);
  }
}

export class FakeClinicDirectory implements ClinicDirectoryPort<FakeTrx> {
  readonly clinics = new Map<string, { id: string; name: string; active: boolean }>();
  async findPartnerClinic(_trx: FakeTrx, clinicId: string): Promise<{ id: string; name: string; active: boolean } | null> {
    return Promise.resolve(this.clinics.get(clinicId) ?? null);
  }
}

export class FakeSharedHistoryReader implements SharedHistoryReaderPort<FakeTrx> {
  medications: SharedMedication[] = [];
  exams: SharedExam[] = [];
  readonly calls: string[] = [];
  async listActiveMedications(): Promise<SharedMedication[]> {
    this.calls.push("meds");
    return Promise.resolve(this.medications);
  }
  async listExams(_trx: FakeTrx, _familyId: string, _memberId: string, since: string): Promise<SharedExam[]> {
    this.calls.push(`exams:${since}`);
    return Promise.resolve(this.exams);
  }
}

export class FakeCalendarSource implements CalendarSourcePort<FakeTrx>, ReportSourcePort<FakeTrx> {
  appointments: (AppointmentFact)[] = [];
  examinations: ExaminationFact[] = [];
  /** M14 Q: retornos Vita por tratar (a porta real é `appointments`; aqui semeados à mão). */
  followUps: (FollowUpFact & { clinicId?: string })[] = [];
  async listAppointmentFollowUps(_trx: FakeTrx, clinicId: string, until: string, limit: number): Promise<FollowUpFact[]> {
    return Promise.resolve(this.followUps.filter((f) => (f.clinicId ?? "clinic-a") === clinicId && f.dueOn <= until).sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.id.localeCompare(b.id)).slice(0, limit));
  }
  async listAppointments(_trx: FakeTrx, _clinicId: string, window: { from: Date; to: Date }): Promise<AppointmentFact[]> {
    return Promise.resolve(this.appointments.filter((a) => a.startsAt.getTime() >= window.from.getTime() && a.startsAt.getTime() < window.to.getTime()));
  }
  async listExaminations(_trx: FakeTrx, _clinicId: string, window: { from: Date; to: Date }): Promise<ExaminationFact[]> {
    return Promise.resolve(this.examinations.filter((e) => e.startsAt.getTime() >= window.from.getTime() && e.startsAt.getTime() < window.to.getTime()));
  }
  async listRecentAppointments(_trx: FakeTrx, _clinicId: string, _limit?: number): Promise<AppointmentFact[]> {
    return Promise.resolve(this.appointments);
  }
  async listRecentExaminations(_trx: FakeTrx, _clinicId: string, _limit?: number): Promise<ExaminationFact[]> {
    return Promise.resolve(this.examinations);
  }
  async listAppointmentsOfMember(_trx: FakeTrx, _clinicId: string, _familyId: string, memberId: string): Promise<AppointmentFact[]> {
    return Promise.resolve(this.appointments.filter((a) => a.memberId === memberId));
  }
  async listExaminationsOfMember(_trx: FakeTrx, _clinicId: string, _familyId: string, memberId: string): Promise<ExaminationFact[]> {
    return Promise.resolve(this.examinations.filter((e) => e.memberId === memberId));
  }
}

export class FakeRecommendationsSource implements RecommendationsSourcePort<FakeTrx> {
  items: (RecommendationFact & { memberId: string })[] = [];
  async listOfMember(_trx: FakeTrx, _clinicId: string, _familyId: string, memberId: string): Promise<RecommendationFact[]> {
    return Promise.resolve(this.items.filter((r) => r.memberId === memberId));
  }
}

export class FakeSlotReservation implements SlotReservationPort<FakeTrx> {
  readonly slots = new Map<string, SlotFacts>();
  /** Ocupação por consultas+exames (porta de `appointments`+`examinations`). */
  readonly occupancy = new Map<string, { requested: number; scheduled: number }>();
  readonly professionals = new Map<string, { id: string; clinicId: string; name: string }>();

  seed(slot: SlotFacts): void {
    this.slots.set(slot.id, slot);
  }
  async lockSlot(_trx: FakeTrx, slotId: string): Promise<SlotFacts | null> {
    return Promise.resolve(this.slots.get(slotId) ?? null);
  }
  async listSlots(_trx: FakeTrx, clinicId: string, window: { from: Date; to: Date }): Promise<SlotFacts[]> {
    return Promise.resolve([...this.slots.values()].filter((s) => s.clinicId === clinicId && s.startsAt.getTime() >= window.from.getTime() && s.startsAt.getTime() < window.to.getTime()).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()));
  }
  async findSlotsByIds(_trx: FakeTrx, clinicId: string, slotIds: string[]): Promise<SlotFacts[]> {
    return Promise.resolve(slotIds.flatMap((id) => { const s = this.slots.get(id); return s?.clinicId === clinicId ? [s] : []; }));
  }
  async countActiveBySlot(_trx: FakeTrx, slotIds: string[]): Promise<{ slotId: string; requested: number; scheduled: number }[]> {
    return Promise.resolve(slotIds.flatMap((slotId) => {
      const row = this.occupancy.get(slotId);
      return row ? [{ slotId, ...row }] : [];
    }));
  }
  async listProfessionalSlotsOverlapping(_trx: FakeTrx, professionalId: string, from: Date, to: Date, excludeSlotId: string): Promise<string[]> {
    return Promise.resolve(
      [...this.slots.values()]
        .filter((s) => s.professionalId === professionalId && s.id !== excludeSlotId && s.startsAt.getTime() < to.getTime() && s.startsAt.getTime() + s.durationMinutes * 60_000 > from.getTime())
        .map((s) => s.id),
    );
  }
  async findProfessional(_trx: FakeTrx, clinicId: string, professionalId: string): Promise<{ id: string; name: string } | null> {
    const p = this.professionals.get(professionalId);
    return Promise.resolve(p?.clinicId === clinicId ? { id: p.id, name: p.name } : null);
  }
}

export interface ClinicPatientsFixtures {
  deps: ClinicPatientsDeps<FakeTrx>;
  patientsRepo: FakePatientsRepository;
  linksRepo: FakeLinksRepository;
  consentsRepo: FakeConsentsRepository;
  codesRepo: FakeLinkCodesRepository;
  visitsRepo: FakeVisitsRepository;
  policy: FakeAccessPolicy;
  members: FakeMemberDirectory;
  clinics: FakeClinicDirectory;
  sharedHistory: FakeSharedHistoryReader;
  calendar: FakeCalendarSource;
  recommendations: FakeRecommendationsSource;
  slots: FakeSlotReservation;
  sharedLimiter: InMemoryRateLimiter;
  searchLimiter: InMemoryRateLimiter;
  reportLimiter: InMemoryRateLimiter;
  audit: FakeAuditPort;
}

export const TEST_LINK_CODE_SECRET = "test-secret-0123456789abcdef";

export function createClinicPatientsFixtures(clock: Clock): ClinicPatientsFixtures {
  const patientsRepo = new FakePatientsRepository();
  const linksRepo = new FakeLinksRepository();
  const consentsRepo = new FakeConsentsRepository();
  const codesRepo = new FakeLinkCodesRepository();
  const visitsRepo = new FakeVisitsRepository();
  const policy = new FakeAccessPolicy();
  const members = new FakeMemberDirectory();
  const clinics = new FakeClinicDirectory();
  const sharedHistory = new FakeSharedHistoryReader();
  const calendar = new FakeCalendarSource();
  const recommendations = new FakeRecommendationsSource();
  const slots = new FakeSlotReservation();
  const sharedLimiter = new InMemoryRateLimiter(clock);
  const searchLimiter = new InMemoryRateLimiter(clock);
  const reportLimiter = new InMemoryRateLimiter(clock);
  const audit = new FakeAuditPort();
  const deps: ClinicPatientsDeps<FakeTrx> = {
    patientsRepo,
    linksRepo,
    consentsRepo,
    codesRepo,
    visitsRepo,
    policy,
    members,
    clinics,
    sharedHistory,
    calendar,
    reports: calendar,
    recommendations,
    slots,
    searchLimiter,
    reportLimiter,
    sharedLimiter,
    audit,
    linkCodeSecret: TEST_LINK_CODE_SECRET,
    withTransaction: (fn) => fn(FAKE_TRX),
    clock,
  };
  return { deps, patientsRepo, linksRepo, consentsRepo, codesRepo, visitsRepo, policy, members, clinics, sharedHistory, calendar, recommendations, slots, sharedLimiter, searchLimiter, reportLimiter, audit };
}
