// Fakes em memória das portas de `prescriptions` (mesmo padrão de `health-records`/`medications`
// `application/fixtures.ts`). Não é ficheiro de teste.
import { decodeCursor, encodeCursor } from "../../../platform/page/index.js";
import type { Clock } from "../../../platform/clock/index.js";
import type { AccessContext, CanInput, Relation } from "../../access/index.js";
import type { AuditEvent } from "../../audit/index.js";
import type { Document, ResourceType } from "../../documents/index.js";
import type { CreateMedicationPlanInput, CreateMedicationPlanOptions, MedicationPlan } from "../../medications/index.js";
import type { Prescription, PrescriptionStatus } from "../domain/prescription.js";
import type {
  AccessPolicyPort,
  ActorIdentity,
  AuditPort,
  CursorPage,
  DocumentsPort,
  MedicationsPort,
  NewPrescriptionRecord,
  PrescriptionChanges,
  PrescriptionListFilter,
  PrescriptionsDeps,
  PrescriptionsRepository,
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

/** Fake simplificado de `medications` (criação sempre bem-sucedida, sem gerar ocorrências — a
 * geração já está testada em `medications/application/create-plan.test.ts`; aqui só se verifica
 * que `prescriptions` chama a API pública com os parâmetros certos). */
export class FakeMedicationsPort implements MedicationsPort<FakeTrx> {
  readonly plans = new Map<string, MedicationPlan>();
  readonly createCalls: { familyId: string; memberId: string; input: CreateMedicationPlanInput; options?: CreateMedicationPlanOptions }[] = [];
  readonly endCalls: { familyId: string; memberId: string; prescriptionId: string; endedAt: Date }[] = [];
  private counter = 0;

  async createPlan(
    _trx: FakeTrx,
    _actor: ActorIdentity,
    familyId: string,
    memberId: string,
    input: CreateMedicationPlanInput,
    _context: RequestContext,
    options?: CreateMedicationPlanOptions,
  ): Promise<MedicationPlan> {
    this.counter += 1;
    const plan: MedicationPlan = {
      id: `plan-${this.counter.toString()}`,
      familyId,
      memberId,
      name: input.name,
      dosage: input.dosage,
      scheduleType: input.scheduleType,
      startAt: new Date(input.startAt),
      continuous: input.continuous ?? false,
      status: "ACTIVE",
      createdAt: new Date(input.startAt),
      ...(options?.prescriptionId ? { prescriptionId: options.prescriptionId } : {}),
    };
    this.createCalls.push({ familyId, memberId, input, ...(options ? { options } : {}) });
    this.plans.set(plan.id, plan);
    return Promise.resolve(plan);
  }

  async listPlansForPrescription(_trx: FakeTrx, familyId: string, memberId: string, prescriptionId: string): Promise<MedicationPlan[]> {
    return Promise.resolve([...this.plans.values()].filter((plan) => plan.familyId === familyId && plan.memberId === memberId && plan.prescriptionId === prescriptionId));
  }

  async endPlansForPrescription(_trx: FakeTrx, familyId: string, memberId: string, prescriptionId: string, endedAt: Date): Promise<void> {
    this.endCalls.push({ familyId, memberId, prescriptionId, endedAt });
    for (const plan of this.plans.values()) {
      if (plan.familyId === familyId && plan.memberId === memberId && plan.prescriptionId === prescriptionId && plan.status === "ACTIVE") {
        this.plans.set(plan.id, { ...plan, status: "ENDED", endedAt });
      }
    }
    return Promise.resolve();
  }
}

export class FakeDocumentsPort implements DocumentsPort<FakeTrx> {
  readonly byResource = new Map<string, Document[]>();
  readonly deleteCalls: { resourceType: ResourceType; resourceId: string }[] = [];

  async listForResource(_trx: FakeTrx, _familyId: string, _memberId: string, resourceType: ResourceType, resourceId: string): Promise<Document[]> {
    return Promise.resolve(this.byResource.get(`${resourceType}|${resourceId}`) ?? []);
  }

  async deleteAllForResource(_trx: FakeTrx, _familyId: string, _memberId: string, resourceType: ResourceType, resourceId: string): Promise<void> {
    this.deleteCalls.push({ resourceType, resourceId });
    this.byResource.delete(`${resourceType}|${resourceId}`);
    return Promise.resolve();
  }

  seed(resourceType: ResourceType, resourceId: string, documents: Document[]): void {
    this.byResource.set(`${resourceType}|${resourceId}`, documents);
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

export class FakePrescriptionsRepository implements PrescriptionsRepository<FakeTrx> {
  readonly byId = new Map<string, Prescription>();

  async insert(_trx: FakeTrx, record: NewPrescriptionRecord): Promise<Prescription> {
    const prescription: Prescription = {
      id: record.id,
      familyId: record.familyId,
      memberId: record.memberId,
      issuedOn: record.issuedOn,
      status: "ACTIVE",
      createdAt: record.createdAt,
      ...(record.doctorName !== undefined ? { doctorName: record.doctorName } : {}),
      ...(record.notes !== undefined ? { notes: record.notes } : {}),
    };
    this.byId.set(prescription.id, prescription);
    return Promise.resolve(prescription);
  }

  async findById(_trx: FakeTrx, familyId: string, memberId: string, prescriptionId: string): Promise<Prescription | null> {
    const prescription = this.byId.get(prescriptionId);
    return Promise.resolve(prescription?.familyId === familyId && prescription.memberId === memberId ? prescription : null);
  }

  async listByMember(_trx: FakeTrx, familyId: string, memberId: string, filter: PrescriptionListFilter, limit: number, cursor?: string): Promise<CursorPage<Prescription>> {
    const items = [...this.byId.values()].filter(
      (prescription) => prescription.familyId === familyId && prescription.memberId === memberId && (!filter.status || prescription.status === filter.status),
    );
    return Promise.resolve(paginate(items, limit, cursor));
  }

  async update(_trx: FakeTrx, familyId: string, memberId: string, prescriptionId: string, changes: PrescriptionChanges): Promise<Prescription> {
    const prescription = this.requireOwned(familyId, memberId, prescriptionId);
    const updated: Prescription = { ...prescription };
    if (changes.issuedOn !== undefined) updated.issuedOn = changes.issuedOn;
    if (changes.doctorName === null) delete updated.doctorName;
    else if (changes.doctorName !== undefined) updated.doctorName = changes.doctorName;
    if (changes.notes === null) delete updated.notes;
    else if (changes.notes !== undefined) updated.notes = changes.notes;
    this.byId.set(prescriptionId, updated);
    return Promise.resolve(updated);
  }

  async updateStatus(_trx: FakeTrx, familyId: string, memberId: string, prescriptionId: string, status: PrescriptionStatus): Promise<Prescription> {
    const prescription = this.requireOwned(familyId, memberId, prescriptionId);
    const updated: Prescription = { ...prescription, status };
    this.byId.set(prescriptionId, updated);
    return Promise.resolve(updated);
  }

  async delete(_trx: FakeTrx, familyId: string, memberId: string, prescriptionId: string): Promise<void> {
    const prescription = this.byId.get(prescriptionId);
    if (prescription?.familyId === familyId && prescription.memberId === memberId) {
      this.byId.delete(prescriptionId);
    }
    return Promise.resolve();
  }

  private requireOwned(familyId: string, memberId: string, prescriptionId: string): Prescription {
    const prescription = this.byId.get(prescriptionId);
    if (!prescription) {
      throw new Error("receita inexistente no fake");
    }
    if (prescription.familyId !== familyId || prescription.memberId !== memberId) {
      throw new Error("receita inexistente no fake");
    }
    return prescription;
  }

  seed(prescription: Prescription): void {
    this.byId.set(prescription.id, prescription);
  }
}

export interface PrescriptionsFixtures {
  deps: PrescriptionsDeps<FakeTrx>;
  prescriptionsRepo: FakePrescriptionsRepository;
  policy: FakeAccessPolicy;
  medications: FakeMedicationsPort;
  documents: FakeDocumentsPort;
  audit: FakeAuditPort;
}

export function createPrescriptionsFixtures(clock: Clock): PrescriptionsFixtures {
  const prescriptionsRepo = new FakePrescriptionsRepository();
  const policy = new FakeAccessPolicy();
  const medications = new FakeMedicationsPort();
  const documents = new FakeDocumentsPort();
  const audit = new FakeAuditPort();
  const deps: PrescriptionsDeps<FakeTrx> = {
    prescriptionsRepo,
    policy,
    medications,
    documents,
    audit,
    db: FAKE_TRX,
    withTransaction: (fn) => fn(FAKE_TRX),
    clock,
  };
  return { deps, prescriptionsRepo, policy, medications, documents, audit };
}
