// Fakes em memória das portas de `medications` para testes de casos de uso (mesmo padrão de
// `health-records`/`documents` `application/fixtures.ts`). Não é ficheiro de teste.
import { decodeCursor, encodeCursor } from "../../../platform/page/index.js";
import type { Clock } from "../../../platform/clock/index.js";
import type { AccessContext, CanInput, Relation } from "../../access/index.js";
import type { AuditEvent } from "../../audit/index.js";
import type { DoseOccurrence, DoseStatus } from "../domain/dose-occurrence.js";
import type { MedicationPlan, PlanStatus } from "../domain/medication-plan.js";
import type {
  AccessPolicyPort,
  AdherenceItem,
  AuditPort,
  CursorPage,
  DoseListFilter,
  DoseOccurrencesRepository,
  MedicationPlanChanges,
  MedicationPlanListFilter,
  MedicationPlansRepository,
  MedicationsDeps,
  NewDoseOccurrenceRecord,
  NewMedicationPlanRecord,
  TimezonePort,
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

export class FakeTimezone implements TimezonePort<FakeTrx> {
  timezone = "Europe/Lisbon";
  readonly calls: { familyId: string; memberId: string }[] = [];

  async getEffectiveTimezone(_trx: FakeTrx, familyId: string, memberId: string): Promise<string> {
    this.calls.push({ familyId, memberId });
    return Promise.resolve(this.timezone);
  }
}

export class FakeAuditPort implements AuditPort<FakeTrx> {
  readonly events: AuditEvent[] = [];

  async record(_trx: FakeTrx, event: AuditEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
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

export class FakeMedicationPlansRepository implements MedicationPlansRepository<FakeTrx> {
  readonly byId = new Map<string, MedicationPlan>();

  async insert(_trx: FakeTrx, record: NewMedicationPlanRecord): Promise<MedicationPlan> {
    const plan: MedicationPlan = {
      id: record.id,
      familyId: record.familyId,
      memberId: record.memberId,
      name: record.name,
      dosage: record.dosage,
      scheduleType: record.scheduleType,
      startAt: record.startAt,
      continuous: record.continuous,
      status: "ACTIVE",
      createdAt: record.createdAt,
      ...(record.prescriptionId !== undefined ? { prescriptionId: record.prescriptionId } : {}),
      ...(record.times !== undefined ? { times: record.times } : {}),
      ...(record.daysOfWeek !== undefined ? { daysOfWeek: record.daysOfWeek } : {}),
      ...(record.intervalHours !== undefined ? { intervalHours: record.intervalHours } : {}),
      ...(record.endAt !== undefined ? { endAt: record.endAt } : {}),
      ...(record.notes !== undefined ? { notes: record.notes } : {}),
    };
    this.byId.set(plan.id, plan);
    return Promise.resolve(plan);
  }

  async findById(_trx: FakeTrx, familyId: string, memberId: string, planId: string): Promise<MedicationPlan | null> {
    const plan = this.byId.get(planId);
    return Promise.resolve(plan?.familyId === familyId && plan.memberId === memberId ? plan : null);
  }

  async listByMember(
    _trx: FakeTrx,
    familyId: string,
    memberId: string,
    filter: MedicationPlanListFilter,
    limit: number,
    cursor?: string,
  ): Promise<CursorPage<MedicationPlan>> {
    const items = [...this.byId.values()].filter(
      (plan) => plan.familyId === familyId && plan.memberId === memberId && (!filter.status || plan.status === filter.status),
    );
    return Promise.resolve(paginate(items, limit, cursor));
  }

  async listByPrescription(_trx: FakeTrx, familyId: string, memberId: string, prescriptionId: string): Promise<MedicationPlan[]> {
    return Promise.resolve(
      sortByCreatedAt(
        [...this.byId.values()].filter(
          (plan) => plan.familyId === familyId && plan.memberId === memberId && plan.prescriptionId === prescriptionId,
        ),
      ),
    );
  }

  async update(_trx: FakeTrx, familyId: string, memberId: string, planId: string, changes: MedicationPlanChanges): Promise<MedicationPlan> {
    const plan = this.requireOwned(familyId, memberId, planId);
    const updated: MedicationPlan = { ...plan };
    if (changes.name !== undefined) updated.name = changes.name;
    if (changes.dosage !== undefined) updated.dosage = changes.dosage;
    if (changes.scheduleType !== undefined) updated.scheduleType = changes.scheduleType;
    if (changes.times === null) delete updated.times;
    else if (changes.times !== undefined) updated.times = changes.times;
    if (changes.daysOfWeek === null) delete updated.daysOfWeek;
    else if (changes.daysOfWeek !== undefined) updated.daysOfWeek = changes.daysOfWeek;
    if (changes.intervalHours === null) delete updated.intervalHours;
    else if (changes.intervalHours !== undefined) updated.intervalHours = changes.intervalHours;
    if (changes.endAt === null) delete updated.endAt;
    else if (changes.endAt !== undefined) updated.endAt = changes.endAt;
    if (changes.continuous !== undefined) updated.continuous = changes.continuous;
    if (changes.notes === null) delete updated.notes;
    else if (changes.notes !== undefined) updated.notes = changes.notes;
    this.byId.set(planId, updated);
    return Promise.resolve(updated);
  }

  async updateStatus(_trx: FakeTrx, familyId: string, memberId: string, planId: string, status: PlanStatus, endedAt: Date | null): Promise<MedicationPlan> {
    const plan = this.requireOwned(familyId, memberId, planId);
    const updated: MedicationPlan = { ...plan, status };
    if (endedAt === null) delete updated.endedAt;
    else updated.endedAt = endedAt;
    this.byId.set(planId, updated);
    return Promise.resolve(updated);
  }

  async delete(_trx: FakeTrx, familyId: string, memberId: string, planId: string): Promise<void> {
    const plan = this.byId.get(planId);
    if (plan?.familyId === familyId && plan.memberId === memberId) {
      this.byId.delete(planId);
    }
    return Promise.resolve();
  }

  async listActiveForGeneration(_trx: FakeTrx, now: Date): Promise<MedicationPlan[]> {
    return Promise.resolve([...this.byId.values()].filter((plan) => plan.status === "ACTIVE" && (!plan.endAt || plan.endAt.getTime() > now.getTime())));
  }

  private requireOwned(familyId: string, memberId: string, planId: string): MedicationPlan {
    const plan = this.byId.get(planId);
    if (!plan) {
      throw new Error("plano inexistente no fake");
    }
    if (plan.familyId !== familyId || plan.memberId !== memberId) {
      throw new Error("plano inexistente no fake");
    }
    return plan;
  }

  seed(plan: MedicationPlan): void {
    this.byId.set(plan.id, plan);
  }
}

export class FakeDoseOccurrencesRepository implements DoseOccurrencesRepository<FakeTrx> {
  readonly byId = new Map<string, DoseOccurrence>();

  async insertMany(_trx: FakeTrx, records: NewDoseOccurrenceRecord[]): Promise<void> {
    const existingKeys = new Set([...this.byId.values()].map((d) => `${d.planId}|${d.scheduledAt.getTime().toString()}`));
    for (const record of records) {
      const key = `${record.planId}|${record.scheduledAt.getTime().toString()}`;
      if (existingKeys.has(key)) {
        continue;
      }
      existingKeys.add(key);
      this.byId.set(record.id, {
        id: record.id,
        familyId: record.familyId,
        memberId: record.memberId,
        planId: record.planId,
        medicationName: "",
        dosage: "",
        scheduledAt: record.scheduledAt,
        status: "PENDING",
        generationVersion: record.generationVersion,
        createdAt: record.createdAt,
      });
    }
    return Promise.resolve();
  }

  async listFutureByPlan(_trx: FakeTrx, planId: string, after: Date): Promise<DoseOccurrence[]> {
    return Promise.resolve(
      [...this.byId.values()].filter((d) => d.planId === planId && d.scheduledAt.getTime() > after.getTime()),
    );
  }

  async deletePendingNotIn(_trx: FakeTrx, planId: string, after: Date, keep: Date[]): Promise<void> {
    const keepTimes = new Set(keep.map((d) => d.getTime()));
    for (const [id, dose] of this.byId) {
      if (dose.planId === planId && dose.status === "PENDING" && dose.scheduledAt.getTime() > after.getTime() && !keepTimes.has(dose.scheduledAt.getTime())) {
        this.byId.delete(id);
      }
    }
    return Promise.resolve();
  }

  async deleteAllFuturePending(_trx: FakeTrx, planId: string, after: Date): Promise<void> {
    for (const [id, dose] of this.byId) {
      if (dose.planId === planId && dose.status === "PENDING" && dose.scheduledAt.getTime() > after.getTime()) {
        this.byId.delete(id);
      }
    }
    return Promise.resolve();
  }

  async findById(_trx: FakeTrx, familyId: string, memberId: string, doseId: string): Promise<DoseOccurrence | null> {
    const dose = this.byId.get(doseId);
    return Promise.resolve(dose?.familyId === familyId && dose.memberId === memberId ? dose : null);
  }

  async listByMember(_trx: FakeTrx, familyId: string, memberId: string, filter: DoseListFilter, limit: number, cursor?: string): Promise<CursorPage<DoseOccurrence>> {
    const items = [...this.byId.values()].filter((dose) => {
      if (dose.familyId !== familyId || dose.memberId !== memberId) return false;
      if (filter.from && dose.scheduledAt.getTime() < filter.from.getTime()) return false;
      if (filter.to && dose.scheduledAt.getTime() > filter.to.getTime()) return false;
      if (filter.status && dose.status !== filter.status) return false;
      if (filter.planId && dose.planId !== filter.planId) return false;
      return true;
    });
    return Promise.resolve(paginate(items, limit, cursor));
  }

  async updateStatus(
    _trx: FakeTrx,
    doseId: string,
    status: DoseStatus,
    actedAt: Date | null,
    actedByUserId: string | null,
    note: string | null,
  ): Promise<DoseOccurrence> {
    const dose = this.byId.get(doseId);
    if (!dose) {
      throw new Error("toma inexistente no fake");
    }
    const updated: DoseOccurrence = { ...dose, status };
    if (actedAt === null) delete updated.actedAt;
    else updated.actedAt = actedAt;
    if (actedByUserId === null) delete updated.actedByUserId;
    else updated.actedByUserId = actedByUserId;
    if (note === null) delete updated.note;
    else updated.note = note;
    this.byId.set(doseId, updated);
    return Promise.resolve(updated);
  }

  async listPendingBefore(_trx: FakeTrx, threshold: Date, limit: number): Promise<DoseOccurrence[]> {
    return Promise.resolve(
      [...this.byId.values()]
        .filter((d) => d.status === "PENDING" && d.scheduledAt.getTime() <= threshold.getTime())
        .slice(0, limit),
    );
  }

  async adherenceByMember(_trx: FakeTrx, familyId: string, memberId: string, from: Date, to: Date): Promise<AdherenceItem[]> {
    const byPlan = new Map<string, AdherenceItem>();
    for (const dose of this.byId.values()) {
      if (dose.familyId !== familyId || dose.memberId !== memberId) continue;
      if (dose.scheduledAt.getTime() < from.getTime() || dose.scheduledAt.getTime() > to.getTime()) continue;
      let item = byPlan.get(dose.planId);
      if (!item) {
        item = { planId: dose.planId, medicationName: dose.medicationName, taken: 0, notTaken: 0, unconfirmed: 0, pending: 0 };
        byPlan.set(dose.planId, item);
      }
      if (dose.status === "TAKEN") item.taken += 1;
      else if (dose.status === "NOT_TAKEN") item.notTaken += 1;
      else if (dose.status === "UNCONFIRMED") item.unconfirmed += 1;
      else item.pending += 1;
    }
    return Promise.resolve([...byPlan.values()]);
  }

  seed(dose: DoseOccurrence): void {
    this.byId.set(dose.id, dose);
  }
}

export interface MedicationsFixtures {
  deps: MedicationsDeps<FakeTrx>;
  plansRepo: FakeMedicationPlansRepository;
  dosesRepo: FakeDoseOccurrencesRepository;
  policy: FakeAccessPolicy;
  timezone: FakeTimezone;
  audit: FakeAuditPort;
}

export function createMedicationsFixtures(clock: Clock): MedicationsFixtures {
  const plansRepo = new FakeMedicationPlansRepository();
  const dosesRepo = new FakeDoseOccurrencesRepository();
  const policy = new FakeAccessPolicy();
  const timezone = new FakeTimezone();
  const audit = new FakeAuditPort();
  const deps: MedicationsDeps<FakeTrx> = {
    plansRepo,
    dosesRepo,
    policy,
    timezone,
    audit,
    db: FAKE_TRX,
    withTransaction: (fn) => fn(FAKE_TRX),
    clock,
  };
  return { deps, plansRepo, dosesRepo, policy, timezone, audit };
}
