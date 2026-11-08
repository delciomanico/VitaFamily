// Fakes em memória das portas de `clinics` (mesmo padrão de `prescriptions`/`health-records`
// `application/fixtures.ts`). Não é ficheiro de teste.
import type { Clock } from "../../../platform/clock/index.js";
import type { Logger } from "../../../platform/logger/index.js";
import type { AuditEvent } from "../../audit/index.js";
import type { Clinic, ClinicStatus } from "../domain/clinic.js";
import type { ClinicAccount, ClinicAccountRole, ClinicAccountStatus } from "../domain/clinic-account.js";
import { ClinicInMemoryRateLimiter } from "../domain/clinic-rate-limiter.js";
import type { ClinicSession } from "../domain/clinic-session.js";
import { slotEndsAt, slotsOverlap, type ClinicSlot } from "../domain/clinic-slot.js";
import { ConflictError } from "../../../platform/errors/index.js";
import type { ClinicProfessional, ClinicServiceType } from "../domain/clinic-catalog.js";
import type { ClinicScheduleRule, ClinicTimeOff } from "../domain/clinic-schedule.js";
import type {
  AccessPort,
  AuditPort,
  ClinicAccountCredentialsReset,
  ClinicAccountRepository,
  ClinicChanges,
  ClinicListFilter,
  ClinicMailer,
  ClinicSentEmail,
  ClinicSessionRepository,
  ClinicCatalogRepository,
  ClinicProfessionalChanges,
  ClinicScheduleRuleChanges,
  ClinicScheduleRulesRepository,
  ClinicServiceTypeChanges,
  ClinicTimeOffRepository,
  NewClinicProfessionalRecord,
  NewClinicScheduleRuleRecord,
  NewClinicServiceTypeRecord,
  NewClinicTimeOffRecord,
  ClinicSlotDuplicateCheck,
  ClinicSlotListFilter,
  ClinicSlotsRepository,
  ClinicsDeps,
  ClinicsRepository,
  MembershipFacts,
  NewClinicAccountRecord,
  NewClinicRecord,
  NewClinicSessionRecord,
  NewClinicSlotRecord,
} from "./ports.js";

export type FakeTrx = Record<string, never>;
const FAKE_TRX: FakeTrx = {};

export class FakeAccessPort implements AccessPort<FakeTrx> {
  readonly membersByFamily = new Map<string, MembershipFacts>();

  async getMembershipFacts(_trx: FakeTrx, familyId: string, userId: string): Promise<MembershipFacts | null> {
    return Promise.resolve(this.membersByFamily.get(`${familyId}|${userId}`) ?? null);
  }

  seed(familyId: string, userId: string, facts: MembershipFacts): void {
    this.membersByFamily.set(`${familyId}|${userId}`, facts);
  }
}

export class FakeAuditPort implements AuditPort<FakeTrx> {
  readonly events: AuditEvent[] = [];

  async record(_trx: FakeTrx, event: AuditEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }
}

export class FakeClinicsRepository implements ClinicsRepository<FakeTrx> {
  readonly byId = new Map<string, Clinic>();

  async insert(_trx: FakeTrx, record: NewClinicRecord): Promise<Clinic> {
    const clinic: Clinic = {
      id: record.id,
      type: record.type,
      name: record.name,
      status: "ACTIVE",
      createdAt: record.createdAt,
      ...(record.familyId !== undefined ? { familyId: record.familyId } : {}),
      ...(record.address !== undefined ? { address: record.address } : {}),
      ...(record.phone !== undefined ? { phone: record.phone } : {}),
      ...(record.email !== undefined ? { email: record.email } : {}),
      ...(record.createdBy !== undefined ? { createdBy: record.createdBy } : {}),
    };
    this.byId.set(clinic.id, clinic);
    return Promise.resolve(clinic);
  }

  async findById(_trx: FakeTrx, clinicId: string): Promise<Clinic | null> {
    return Promise.resolve(this.byId.get(clinicId) ?? null);
  }

  async listVisibleToFamily(_trx: FakeTrx, familyId: string, filter: ClinicListFilter): Promise<Clinic[]> {
    return Promise.resolve(
      [...this.byId.values()].filter(
        (clinic) => (clinic.type === "PARTNER" || clinic.familyId === familyId) && (!filter.status || clinic.status === filter.status),
      ),
    );
  }

  async listPartners(_trx: FakeTrx, filter: ClinicListFilter): Promise<Clinic[]> {
    return Promise.resolve([...this.byId.values()].filter((clinic) => clinic.type === "PARTNER" && (!filter.status || clinic.status === filter.status)));
  }

  async countPrivateByFamily(_trx: FakeTrx, familyId: string): Promise<number> {
    return Promise.resolve([...this.byId.values()].filter((clinic) => clinic.type === "PRIVATE" && clinic.familyId === familyId).length);
  }

  async update(_trx: FakeTrx, clinicId: string, changes: ClinicChanges): Promise<Clinic> {
    const clinic = this.requireClinic(clinicId);
    const updated: Clinic = { ...clinic };
    if (changes.name !== undefined) updated.name = changes.name;
    if (changes.address === null) delete updated.address;
    else if (changes.address !== undefined) updated.address = changes.address;
    if (changes.phone === null) delete updated.phone;
    else if (changes.phone !== undefined) updated.phone = changes.phone;
    if (changes.email === null) delete updated.email;
    else if (changes.email !== undefined) updated.email = changes.email;
    if (changes.displayName === null) delete updated.displayName;
    else if (changes.displayName !== undefined) updated.displayName = changes.displayName;
    if (changes.description === null) delete updated.description;
    else if (changes.description !== undefined) updated.description = changes.description;
    if (changes.openingHours === null) delete updated.openingHours;
    else if (changes.openingHours !== undefined) updated.openingHours = changes.openingHours;
    this.byId.set(clinicId, updated);
    return Promise.resolve(updated);
  }

  async updateStatus(_trx: FakeTrx, clinicId: string, status: ClinicStatus): Promise<Clinic> {
    const clinic = this.requireClinic(clinicId);
    const updated: Clinic = { ...clinic, status };
    this.byId.set(clinicId, updated);
    return Promise.resolve(updated);
  }

  async delete(_trx: FakeTrx, clinicId: string): Promise<void> {
    this.byId.delete(clinicId);
    return Promise.resolve();
  }

  private requireClinic(clinicId: string): Clinic {
    const clinic = this.byId.get(clinicId);
    if (!clinic) {
      throw new Error("clínica inexistente no fake");
    }
    return clinic;
  }

  seed(clinic: Clinic): void {
    this.byId.set(clinic.id, clinic);
  }
}

// --- Portal da clínica (D17/D18, ADR-020) ---

export class FakeClinicAccountRepository implements ClinicAccountRepository<FakeTrx> {
  readonly byId = new Map<string, ClinicAccount>();

  async insert(_trx: FakeTrx, record: NewClinicAccountRecord): Promise<ClinicAccount> {
    const account: ClinicAccount = {
      id: record.id,
      clinicId: record.clinicId,
      email: record.email,
      passwordHash: record.passwordHash,
      role: record.role,
      status: "ACTIVE",
      createdAt: record.createdAt,
      ...(record.professionalId !== undefined ? { professionalId: record.professionalId } : {}),
      ...(record.createdByPlatformAdmin !== undefined ? { createdByPlatformAdmin: record.createdByPlatformAdmin } : {}),
    };
    this.byId.set(account.id, account);
    return Promise.resolve(account);
  }

  async findById(_trx: FakeTrx, id: string): Promise<ClinicAccount | null> {
    return Promise.resolve(this.byId.get(id) ?? null);
  }

  async findByEmail(_trx: FakeTrx, email: string): Promise<ClinicAccount | null> {
    for (const account of this.byId.values()) {
      if (account.email === email) {
        return Promise.resolve(account);
      }
    }
    return Promise.resolve(null);
  }

  async findActiveAdminByClinic(_trx: FakeTrx, clinicId: string): Promise<ClinicAccount | null> {
    for (const account of this.byId.values()) {
      if (account.clinicId === clinicId && account.role === "CLINIC_ADMIN" && account.status === "ACTIVE") {
        return Promise.resolve(account);
      }
    }
    return Promise.resolve(null);
  }

  async resetCredentials(_trx: FakeTrx, id: string, changes: ClinicAccountCredentialsReset, _now: Date): Promise<ClinicAccount> {
    const account = this.byId.get(id);
    if (!account) {
      throw new Error("conta de clínica inexistente no fake");
    }
    const updated: ClinicAccount = { ...account, email: changes.email, passwordHash: changes.passwordHash };
    this.byId.set(id, updated);
    return Promise.resolve(updated);
  }

  async updateStatus(_trx: FakeTrx, id: string, status: ClinicAccountStatus, now: Date): Promise<ClinicAccount> {
    const account = this.byId.get(id);
    if (!account) {
      throw new Error("conta de clínica inexistente no fake");
    }
    const updated: ClinicAccount = { ...account, status, ...(status === "SUSPENDED" ? { suspendedAt: now } : {}) };
    if (status !== "SUSPENDED") {
      delete updated.suspendedAt;
    }
    this.byId.set(id, updated);
    return Promise.resolve(updated);
  }

  async findByProfessionalId(_trx: FakeTrx, professionalId: string): Promise<ClinicAccount | null> {
    return Promise.resolve([...this.byId.values()].find((account) => account.professionalId === professionalId) ?? null);
  }

  async listByClinic(_trx: FakeTrx, clinicId: string, roles?: ClinicAccountRole[]): Promise<ClinicAccount[]> {
    return Promise.resolve([...this.byId.values()].filter((account) => account.clinicId === clinicId && (!roles || roles.includes(account.role))));
  }

  /** Preparado por testes (o fake não conhece as sessões): último login por conta. */
  readonly lastLogins = new Map<string, Date>();

  async listByClinicWithLastLogin(trx: FakeTrx, clinicId: string): Promise<{ account: ClinicAccount; lastLoginAt: Date | null }[]> {
    const accounts = await this.listByClinic(trx, clinicId);
    return accounts.map((account) => ({ account, lastLoginAt: this.lastLogins.get(account.id) ?? null }));
  }

  async delete(_trx: FakeTrx, id: string): Promise<void> {
    this.byId.delete(id);
    return Promise.resolve();
  }

  seed(account: ClinicAccount): void {
    this.byId.set(account.id, account);
  }
}

/** Simula a ocupação de horários por consultas/exames ativos (BR-CLN-04). */
export class FakeSlotOccupancy {
  /** `slotId` -> marcações ativas por estado. */
  readonly counts = new Map<string, { requested: number; scheduled: number }>();

  /** Atalho dos testes: uma marcação `SCHEDULED` (ou `REQUESTED`) no horário. */
  book(slotId: string, state: "requested" | "scheduled" = "scheduled", times = 1): void {
    const current = this.counts.get(slotId) ?? { requested: 0, scheduled: 0 };
    this.counts.set(slotId, { ...current, [state]: current[state] + times });
  }

  async countActiveBySlot(_trx: FakeTrx, slotIds: string[]): Promise<{ slotId: string; requested: number; scheduled: number }[]> {
    return Promise.resolve(slotIds.flatMap((slotId) => (this.counts.has(slotId) ? [{ slotId, ...(this.counts.get(slotId) ?? { requested: 0, scheduled: 0 }) }] : [])));
  }
}

export class FakeClinicSlotsRepository implements ClinicSlotsRepository<FakeTrx> {
  readonly byId = new Map<string, ClinicSlot>();

  async insert(_trx: FakeTrx, record: NewClinicSlotRecord): Promise<ClinicSlot> {
    const slot: ClinicSlot = {
      id: record.id,
      clinicId: record.clinicId,
      kind: record.kind,
      specialty: record.specialty,
      startsAt: record.startsAt,
      durationMinutes: record.durationMinutes,
      capacity: record.capacity,
      createdAt: record.createdAt,
      ...(record.professionalName !== undefined ? { professionalName: record.professionalName } : {}),
      ...(record.professionalId !== undefined ? { professionalId: record.professionalId } : {}),
      ...(record.serviceTypeId !== undefined ? { serviceTypeId: record.serviceTypeId } : {}),
      ...(record.scheduleRuleId !== undefined ? { scheduleRuleId: record.scheduleRuleId } : {}),
    };
    if (this.conflicts(slot)) {
      throw new Error("violação da exclusão/unicidade no fake");
    }
    this.byId.set(slot.id, slot);
    return Promise.resolve(slot);
  }

  /** Emula a `EXCLUDE` (BR-CLN-13) e o UNIQUE `(schedule_rule_id, starts_at)` da BD. */
  private conflicts(slot: ClinicSlot): boolean {
    return [...this.byId.values()].some(
      (other) =>
        (slot.professionalId !== undefined && other.professionalId === slot.professionalId && slotsOverlap(slot, other)) ||
        (slot.scheduleRuleId !== undefined && other.scheduleRuleId === slot.scheduleRuleId && other.startsAt.getTime() === slot.startsAt.getTime()),
    );
  }

  async insertManyIgnoringConflicts(trx: FakeTrx, records: NewClinicSlotRecord[]): Promise<ClinicSlot[]> {
    const created: ClinicSlot[] = [];
    for (const record of records) {
      try {
        created.push(await this.insert(trx, record));
      } catch {
        // ON CONFLICT DO NOTHING
      }
    }
    return created;
  }

  async listByProfessional(_trx: FakeTrx, professionalId: string, filter: { endsAfter?: Date; startsBefore?: Date }): Promise<ClinicSlot[]> {
    return Promise.resolve(
      [...this.byId.values()]
        .filter((slot) => slot.professionalId === professionalId)
        .filter((slot) => !filter.endsAfter || slotEndsAt(slot).getTime() > filter.endsAfter.getTime())
        .filter((slot) => !filter.startsBefore || slot.startsAt.getTime() < filter.startsBefore.getTime())
        .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()),
    );
  }

  async listFutureByRule(_trx: FakeTrx, scheduleRuleId: string, after: Date): Promise<ClinicSlot[]> {
    return Promise.resolve([...this.byId.values()].filter((slot) => slot.scheduleRuleId === scheduleRuleId && slot.startsAt.getTime() > after.getTime()).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()));
  }

  async lockMany(_trx: FakeTrx, slotIds: string[]): Promise<ClinicSlot[]> {
    return Promise.resolve(slotIds.flatMap((id) => this.byId.get(id) ?? []));
  }

  async listByIds(_trx: FakeTrx, clinicId: string, slotIds: string[]): Promise<ClinicSlot[]> {
    return Promise.resolve(slotIds.flatMap((id) => {
      const slot = this.byId.get(id);
      return slot?.clinicId === clinicId ? [slot] : [];
    }));
  }

  async deleteMany(_trx: FakeTrx, slotIds: string[]): Promise<void> {
    for (const id of slotIds) this.byId.delete(id);
    return Promise.resolve();
  }

  async lockById(_trx: FakeTrx, slotId: string): Promise<ClinicSlot | null> {
    return Promise.resolve(this.byId.get(slotId) ?? null);
  }

  async updateCapacity(_trx: FakeTrx, slotId: string, capacity: number): Promise<ClinicSlot> {
    const slot = this.byId.get(slotId);
    if (!slot) throw new Error("horário inexistente no fake");
    const updated = { ...slot, capacity };
    this.byId.set(slotId, updated);
    return Promise.resolve(updated);
  }

  async findById(_trx: FakeTrx, slotId: string): Promise<ClinicSlot | null> {
    return Promise.resolve(this.byId.get(slotId) ?? null);
  }

  async listByClinic(_trx: FakeTrx, clinicId: string, filter: ClinicSlotListFilter): Promise<ClinicSlot[]> {
    return Promise.resolve(
      [...this.byId.values()]
        .filter((slot) => slot.clinicId === clinicId)
        .filter((slot) => !filter.kind || slot.kind === filter.kind)
        .filter((slot) => !filter.from || slot.startsAt.getTime() >= filter.from.getTime())
        .filter((slot) => !filter.to || slot.startsAt.getTime() <= filter.to.getTime())
        .filter((slot) => !filter.specialty || slot.specialty === filter.specialty)
        .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()),
    );
  }

  async existsDuplicate(_trx: FakeTrx, clinicId: string, slot: ClinicSlotDuplicateCheck): Promise<boolean> {
    return Promise.resolve(
      [...this.byId.values()].some(
        (existing) =>
          existing.clinicId === clinicId &&
          existing.kind === slot.kind &&
          existing.startsAt.getTime() === slot.startsAt.getTime() &&
          existing.specialty === slot.specialty &&
          (existing.professionalName ?? null) === (slot.professionalName ?? null),
      ),
    );
  }

  async delete(_trx: FakeTrx, slotId: string): Promise<void> {
    this.byId.delete(slotId);
    return Promise.resolve();
  }

  seed(slot: ClinicSlot): void {
    this.byId.set(slot.id, slot);
  }
}

/** Catálogo em memória (nome único entre ativos => `ConflictError`, como o UNIQUE parcial da BD). */
export class FakeClinicCatalogRepository implements ClinicCatalogRepository<FakeTrx> {
  readonly professionals = new Map<string, ClinicProfessional>();
  readonly services = new Map<string, ClinicServiceType>();
  currency = "AOA";
  /** Registo de `lockProfessional` (para verificar a ordem de bloqueio). */
  readonly locks: string[] = [];

  async lockClinic(): Promise<void> {
    return Promise.resolve();
  }

  async getCurrency(): Promise<string> {
    return Promise.resolve(this.currency);
  }

  private assertUniqueProfessional(candidate: ClinicProfessional): void {
    if (candidate.active && [...this.professionals.values()].some((p) => p.id !== candidate.id && p.clinicId === candidate.clinicId && p.active && p.name.toLowerCase() === candidate.name.toLowerCase())) {
      throw new ConflictError({ detail: "Já existe um profissional ativo com esse nome." });
    }
  }

  private assertUniqueService(candidate: ClinicServiceType): void {
    if (candidate.active && [...this.services.values()].some((s) => s.id !== candidate.id && s.clinicId === candidate.clinicId && s.kind === candidate.kind && s.active && s.name.toLowerCase() === candidate.name.toLowerCase())) {
      throw new ConflictError({ detail: "Já existe um serviço ativo com esse nome." });
    }
  }

  async insertProfessional(_trx: FakeTrx, record: NewClinicProfessionalRecord): Promise<ClinicProfessional> {
    const professional: ClinicProfessional = { id: record.id, clinicId: record.clinicId, name: record.name, specialty: record.specialty, active: true };
    this.assertUniqueProfessional(professional);
    this.professionals.set(professional.id, professional);
    return Promise.resolve(professional);
  }

  async findProfessional(_trx: FakeTrx, clinicId: string, professionalId: string): Promise<ClinicProfessional | null> {
    const found = this.professionals.get(professionalId);
    return Promise.resolve(found?.clinicId === clinicId ? found : null);
  }

  async lockProfessional(trx: FakeTrx, clinicId: string, professionalId: string): Promise<ClinicProfessional | null> {
    this.locks.push(professionalId);
    return this.findProfessional(trx, clinicId, professionalId);
  }

  async listProfessionals(_trx: FakeTrx, clinicId: string, filter: { active?: boolean }): Promise<ClinicProfessional[]> {
    return Promise.resolve([...this.professionals.values()].filter((p) => p.clinicId === clinicId && (filter.active === undefined || p.active === filter.active)).sort((a, b) => a.name.localeCompare(b.name)));
  }

  async countProfessionals(_trx: FakeTrx, clinicId: string): Promise<number> {
    return Promise.resolve([...this.professionals.values()].filter((p) => p.clinicId === clinicId).length);
  }

  async updateProfessional(_trx: FakeTrx, professionalId: string, changes: ClinicProfessionalChanges): Promise<ClinicProfessional> {
    const current = this.professionals.get(professionalId);
    if (!current) throw new Error("profissional inexistente no fake");
    const updated: ClinicProfessional = { ...current, ...(changes.name !== undefined ? { name: changes.name } : {}), ...(changes.specialty !== undefined ? { specialty: changes.specialty } : {}), ...(changes.active !== undefined ? { active: changes.active } : {}) };
    this.assertUniqueProfessional(updated);
    this.professionals.set(professionalId, updated);
    return Promise.resolve(updated);
  }

  async insertServiceType(_trx: FakeTrx, record: NewClinicServiceTypeRecord): Promise<ClinicServiceType> {
    const service: ClinicServiceType = { id: record.id, clinicId: record.clinicId, name: record.name, kind: record.kind, durationMinutes: record.durationMinutes, priceMinor: record.priceMinor, active: true };
    this.assertUniqueService(service);
    this.services.set(service.id, service);
    return Promise.resolve(service);
  }

  async findServiceType(_trx: FakeTrx, clinicId: string, serviceTypeId: string): Promise<ClinicServiceType | null> {
    const found = this.services.get(serviceTypeId);
    return Promise.resolve(found?.clinicId === clinicId ? found : null);
  }

  async listServiceTypes(_trx: FakeTrx, clinicId: string, filter: { active?: boolean; kind?: "APPOINTMENT" | "EXAM" }): Promise<ClinicServiceType[]> {
    return Promise.resolve(
      [...this.services.values()]
        .filter((s) => s.clinicId === clinicId && (filter.active === undefined || s.active === filter.active) && (!filter.kind || s.kind === filter.kind))
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
  }

  async countServiceTypes(_trx: FakeTrx, clinicId: string): Promise<number> {
    return Promise.resolve([...this.services.values()].filter((s) => s.clinicId === clinicId).length);
  }

  async updateServiceType(_trx: FakeTrx, serviceTypeId: string, changes: ClinicServiceTypeChanges): Promise<ClinicServiceType> {
    const current = this.services.get(serviceTypeId);
    if (!current) throw new Error("serviço inexistente no fake");
    const updated: ClinicServiceType = {
      ...current,
      ...(changes.name !== undefined ? { name: changes.name } : {}),
      ...(changes.durationMinutes !== undefined ? { durationMinutes: changes.durationMinutes } : {}),
      ...(changes.priceMinor !== undefined ? { priceMinor: changes.priceMinor } : {}),
      ...(changes.active !== undefined ? { active: changes.active } : {}),
    };
    this.assertUniqueService(updated);
    this.services.set(serviceTypeId, updated);
    return Promise.resolve(updated);
  }
}

export class FakeClinicScheduleRulesRepository implements ClinicScheduleRulesRepository<FakeTrx> {
  readonly byId = new Map<string, ClinicScheduleRule>();

  constructor(private readonly catalog: FakeClinicCatalogRepository) {}

  async insert(_trx: FakeTrx, record: NewClinicScheduleRuleRecord): Promise<ClinicScheduleRule> {
    const rule: ClinicScheduleRule = {
      id: record.id,
      clinicId: record.clinicId,
      professionalId: record.professionalId,
      serviceTypeId: record.serviceTypeId,
      weekdays: record.weekdays,
      startTime: record.startTime,
      endTime: record.endTime,
      validFrom: record.validFrom,
      validUntil: record.validUntil,
      capacity: record.capacity,
      active: true,
    };
    this.byId.set(rule.id, rule);
    return Promise.resolve(rule);
  }

  async findById(_trx: FakeTrx, clinicId: string, ruleId: string): Promise<ClinicScheduleRule | null> {
    const found = this.byId.get(ruleId);
    return Promise.resolve(found?.clinicId === clinicId ? found : null);
  }

  async list(_trx: FakeTrx, clinicId: string, filter: { professionalId?: string; active?: boolean }): Promise<ClinicScheduleRule[]> {
    return Promise.resolve(
      [...this.byId.values()].filter((r) => r.clinicId === clinicId && (!filter.professionalId || r.professionalId === filter.professionalId) && (filter.active === undefined || r.active === filter.active)),
    );
  }

  async count(_trx: FakeTrx, clinicId: string): Promise<number> {
    return Promise.resolve([...this.byId.values()].filter((r) => r.clinicId === clinicId).length);
  }

  async listActiveByProfessional(_trx: FakeTrx, professionalId: string): Promise<ClinicScheduleRule[]> {
    return Promise.resolve([...this.byId.values()].filter((r) => r.professionalId === professionalId && r.active));
  }

  async update(_trx: FakeTrx, ruleId: string, changes: ClinicScheduleRuleChanges): Promise<ClinicScheduleRule> {
    const current = this.byId.get(ruleId);
    if (!current) throw new Error("regra inexistente no fake");
    const updated: ClinicScheduleRule = { ...current, ...changes };
    this.byId.set(ruleId, updated);
    return Promise.resolve(updated);
  }

  async listActiveForGeneration(): Promise<ClinicScheduleRule[]> {
    return Promise.resolve(
      [...this.byId.values()].filter((r) => r.active && this.catalog.professionals.get(r.professionalId)?.active === true && this.catalog.services.get(r.serviceTypeId)?.active === true),
    );
  }
}

export class FakeClinicTimeOffRepository implements ClinicTimeOffRepository<FakeTrx> {
  readonly byId = new Map<string, ClinicTimeOff>();

  async insert(_trx: FakeTrx, record: NewClinicTimeOffRecord): Promise<ClinicTimeOff> {
    const timeOff: ClinicTimeOff = { id: record.id, clinicId: record.clinicId, professionalId: record.professionalId, startsAt: record.startsAt, endsAt: record.endsAt, reason: record.reason };
    this.byId.set(timeOff.id, timeOff);
    return Promise.resolve(timeOff);
  }

  async findById(_trx: FakeTrx, clinicId: string, timeOffId: string): Promise<ClinicTimeOff | null> {
    const found = this.byId.get(timeOffId);
    return Promise.resolve(found?.clinicId === clinicId ? found : null);
  }

  async list(_trx: FakeTrx, clinicId: string, filter: { professionalId?: string; endsAfter: Date; startsBefore?: Date }): Promise<ClinicTimeOff[]> {
    return Promise.resolve(
      [...this.byId.values()]
        .filter((t) => t.clinicId === clinicId && t.endsAt.getTime() > filter.endsAfter.getTime())
        .filter((t) => !filter.professionalId || t.professionalId === filter.professionalId)
        .filter((t) => !filter.startsBefore || t.startsAt.getTime() < filter.startsBefore.getTime())
        .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()),
    );
  }

  async listOverlapping(_trx: FakeTrx, professionalId: string, from: Date, to: Date): Promise<ClinicTimeOff[]> {
    return Promise.resolve([...this.byId.values()].filter((t) => t.professionalId === professionalId && t.startsAt.getTime() < to.getTime() && t.endsAt.getTime() > from.getTime()));
  }

  async delete(_trx: FakeTrx, timeOffId: string): Promise<void> {
    this.byId.delete(timeOffId);
    return Promise.resolve();
  }
}

export class FakeClinicSessionRepository implements ClinicSessionRepository<FakeTrx> {
  readonly sessions = new Map<string, ClinicSession>();

  async insert(_trx: FakeTrx, record: NewClinicSessionRecord): Promise<ClinicSession> {
    const session: ClinicSession = { ...record, lastUsedAt: record.createdAt };
    this.sessions.set(session.id, session);
    return Promise.resolve(session);
  }

  async findByRefreshTokenHash(_trx: FakeTrx, refreshTokenHash: string): Promise<ClinicSession | null> {
    for (const session of this.sessions.values()) {
      if (session.refreshTokenHash === refreshTokenHash) {
        return Promise.resolve(session);
      }
    }
    return Promise.resolve(null);
  }

  async revoke(_trx: FakeTrx, id: string, revokedAt: Date): Promise<void> {
    const session = this.sessions.get(id);
    if (session && !session.revokedAt) {
      this.sessions.set(id, { ...session, revokedAt });
    }
    return Promise.resolve();
  }

  async revokeAllForAccount(_trx: FakeTrx, clinicAccountId: string, revokedAt: Date): Promise<void> {
    for (const session of this.sessions.values()) {
      if (session.clinicAccountId === clinicAccountId && !session.revokedAt) {
        this.sessions.set(session.id, { ...session, revokedAt });
      }
    }
    return Promise.resolve();
  }

  async revokeChain(_trx: FakeTrx, tokenChainId: string, revokedAt: Date): Promise<void> {
    for (const session of this.sessions.values()) {
      if (session.tokenChainId === tokenChainId && !session.revokedAt) {
        this.sessions.set(session.id, { ...session, revokedAt });
      }
    }
    return Promise.resolve();
  }
}

export class FakeClinicMailer implements ClinicMailer {
  readonly sent: ClinicSentEmail[] = [];

  async send(email: ClinicSentEmail): Promise<void> {
    this.sent.push(email);
    return Promise.resolve();
  }
}

/** Só a parte do `pino.Logger` usada por `send-clinic-mail.ts`. */
export class FakeClinicLogger {
  readonly warnings: { obj: unknown; msg: string }[] = [];

  warn(obj: unknown, msg: string): void {
    this.warnings.push({ obj, msg });
  }
}

export interface ClinicsFixtures {
  deps: ClinicsDeps<FakeTrx>;
  clinicsRepo: FakeClinicsRepository;
  access: FakeAccessPort;
  audit: FakeAuditPort;
  clinicAccountRepo: FakeClinicAccountRepository;
  clinicSessionRepo: FakeClinicSessionRepository;
  clinicSlotsRepo: FakeClinicSlotsRepository;
  slotOccupancy: FakeSlotOccupancy;
  catalogRepo: FakeClinicCatalogRepository;
  scheduleRulesRepo: FakeClinicScheduleRulesRepository;
  timeOffRepo: FakeClinicTimeOffRepository;
  clinicMailer: FakeClinicMailer;
  clinicLogger: FakeClinicLogger;
}

export function createClinicsFixtures(clock: Clock): ClinicsFixtures {
  const clinicsRepo = new FakeClinicsRepository();
  const access = new FakeAccessPort();
  const audit = new FakeAuditPort();
  const clinicAccountRepo = new FakeClinicAccountRepository();
  const clinicSessionRepo = new FakeClinicSessionRepository();
  const clinicSlotsRepo = new FakeClinicSlotsRepository();
  const slotOccupancy = new FakeSlotOccupancy();
  const catalogRepo = new FakeClinicCatalogRepository();
  const scheduleRulesRepo = new FakeClinicScheduleRulesRepository(catalogRepo);
  const timeOffRepo = new FakeClinicTimeOffRepository();
  const clinicMailer = new FakeClinicMailer();
  const clinicLogger = new FakeClinicLogger();
  const deps: ClinicsDeps<FakeTrx> = {
    clinicsRepo,
    access,
    audit,
    db: FAKE_TRX,
    withTransaction: (fn) => fn(FAKE_TRX),
    clock,
    clinicAccountRepo,
    clinicSessionRepo,
    clinicSlotsRepo,
    slotOccupancy,
    catalogRepo,
    scheduleRulesRepo,
    timeOffRepo,
    clinicMailer,
    logger: clinicLogger as unknown as Logger,
    clinicRateLimiter: new ClinicInMemoryRateLimiter(clock),
    clinicSigningKeys: [{ kid: "test", secret: new TextEncoder().encode("a".repeat(32)) }],
    clinicAccessTtlSeconds: 900,
    clinicRefreshTtlMs: 30 * 24 * 60 * 60 * 1000,
  };
  return { deps, clinicsRepo, access, audit, clinicAccountRepo, clinicSessionRepo, clinicSlotsRepo, slotOccupancy, catalogRepo, scheduleRulesRepo, timeOffRepo, clinicMailer, clinicLogger };
}
