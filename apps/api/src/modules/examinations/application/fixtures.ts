// Fakes em memória das portas de `examinations` (mesmo padrão de `prescriptions`/`appointments`
// `application/fixtures.ts`). Não é ficheiro de teste.
import { decodeCursor, encodeCursor } from "../../../platform/page/index.js";
import type { Clock } from "../../../platform/clock/index.js";
import type { AccessContext, CanInput, Relation } from "../../access/index.js";
import type { AuditEvent } from "../../audit/index.js";
import type { Document, ResourceType } from "../../documents/index.js";
import type { ExamResult } from "../domain/exam-result.js";
import type { Examination, ExaminationStatus } from "../domain/examination.js";
import type {
  AccessPolicyPort,
  AuditPort,
  ClinicsPort,
  CursorPage,
  DocumentsPort,
  ExaminationChanges,
  ExaminationListFilter,
  ExaminationsDeps,
  ExaminationsRepository,
  ExamResultChanges,
  ExamResultHistoryItem,
  ExamResultsRepository,
  NewExaminationRecord,
  NewExamResultRecord,
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

export class FakeExaminationsRepository implements ExaminationsRepository<FakeTrx> {
  readonly byId = new Map<string, Examination>();

  async insert(_trx: FakeTrx, record: NewExaminationRecord): Promise<Examination> {
    const examination: Examination = {
      id: record.id,
      familyId: record.familyId,
      memberId: record.memberId,
      name: record.name,
      examDate: record.examDate,
      status: record.status,
      createdAt: record.createdAt,
      ...(record.clinicId !== undefined ? { clinicId: record.clinicId } : {}),
      ...(record.clinicName !== undefined ? { clinicName: record.clinicName } : {}),
      ...(record.notes !== undefined ? { notes: record.notes } : {}),
    };
    this.byId.set(examination.id, examination);
    return Promise.resolve(examination);
  }

  async findById(_trx: FakeTrx, familyId: string, memberId: string, examinationId: string): Promise<Examination | null> {
    const examination = this.byId.get(examinationId);
    return Promise.resolve(examination?.familyId === familyId && examination.memberId === memberId ? examination : null);
  }

  async listByMember(_trx: FakeTrx, familyId: string, memberId: string, filter: ExaminationListFilter, limit: number, cursor?: string): Promise<CursorPage<Examination>> {
    const items = [...this.byId.values()].filter((examination) => {
      if (examination.familyId !== familyId || examination.memberId !== memberId) return false;
      if (filter.status && examination.status !== filter.status) return false;
      if (filter.from && examination.examDate < filter.from) return false;
      if (filter.to && examination.examDate > filter.to) return false;
      return true;
    });
    return Promise.resolve(paginate(items, limit, cursor));
  }

  async update(_trx: FakeTrx, familyId: string, memberId: string, examinationId: string, changes: ExaminationChanges): Promise<Examination> {
    const examination = this.requireOwned(familyId, memberId, examinationId);
    const updated: Examination = { ...examination };
    if (changes.name !== undefined) updated.name = changes.name;
    if (changes.examDate !== undefined) updated.examDate = changes.examDate;
    if (changes.clinicId === null) delete updated.clinicId;
    else if (changes.clinicId !== undefined) updated.clinicId = changes.clinicId;
    if (changes.clinicName === null) delete updated.clinicName;
    else if (changes.clinicName !== undefined) updated.clinicName = changes.clinicName;
    if (changes.notes === null) delete updated.notes;
    else if (changes.notes !== undefined) updated.notes = changes.notes;
    this.byId.set(examinationId, updated);
    return Promise.resolve(updated);
  }

  async updateStatus(_trx: FakeTrx, familyId: string, memberId: string, examinationId: string, status: ExaminationStatus): Promise<Examination> {
    const examination = this.requireOwned(familyId, memberId, examinationId);
    const updated: Examination = { ...examination, status };
    this.byId.set(examinationId, updated);
    return Promise.resolve(updated);
  }

  async listReminderCandidates(_trx: FakeTrx, from: string, to: string, limit: number): Promise<Examination[]> {
    return Promise.resolve(
      [...this.byId.values()]
        .filter((examination) => examination.status === "SCHEDULED" && examination.examDate >= from && examination.examDate <= to)
        .sort((a, b) => a.examDate.localeCompare(b.examDate))
        .slice(0, limit),
    );
  }

  async delete(_trx: FakeTrx, familyId: string, memberId: string, examinationId: string): Promise<void> {
    const examination = this.byId.get(examinationId);
    if (examination?.familyId === familyId && examination.memberId === memberId) {
      this.byId.delete(examinationId);
    }
    return Promise.resolve();
  }

  private requireOwned(familyId: string, memberId: string, examinationId: string): Examination {
    const examination = this.byId.get(examinationId);
    if (!examination) {
      throw new Error("exame inexistente no fake");
    }
    if (examination.familyId !== familyId || examination.memberId !== memberId) {
      throw new Error("exame inexistente no fake");
    }
    return examination;
  }

  seed(examination: Examination): void {
    this.byId.set(examination.id, examination);
  }
}

export class FakeExamResultsRepository implements ExamResultsRepository<FakeTrx> {
  readonly byId = new Map<string, ExamResult>();

  constructor(private readonly examinations: FakeExaminationsRepository) {}

  async insert(_trx: FakeTrx, record: NewExamResultRecord): Promise<ExamResult> {
    const result: ExamResult = {
      id: record.id,
      examinationId: record.examinationId,
      parameter: record.parameter,
      createdAt: record.createdAt,
      ...(record.valueNumeric !== undefined ? { valueNumeric: record.valueNumeric } : {}),
      ...(record.valueText !== undefined ? { valueText: record.valueText } : {}),
      ...(record.unit !== undefined ? { unit: record.unit } : {}),
      ...(record.referenceMin !== undefined ? { referenceMin: record.referenceMin } : {}),
      ...(record.referenceMax !== undefined ? { referenceMax: record.referenceMax } : {}),
    };
    this.byId.set(result.id, result);
    return Promise.resolve(result);
  }

  async findById(_trx: FakeTrx, examinationId: string, resultId: string): Promise<ExamResult | null> {
    const result = this.byId.get(resultId);
    return Promise.resolve(result?.examinationId === examinationId ? result : null);
  }

  async listByExamination(_trx: FakeTrx, examinationId: string): Promise<ExamResult[]> {
    return Promise.resolve([...this.byId.values()].filter((r) => r.examinationId === examinationId));
  }

  async update(_trx: FakeTrx, examinationId: string, resultId: string, changes: ExamResultChanges): Promise<ExamResult> {
    const result = this.byId.get(resultId);
    if (!result) {
      throw new Error("resultado inexistente no fake");
    }
    if (result.examinationId !== examinationId) {
      throw new Error("resultado inexistente no fake");
    }
    const updated: ExamResult = { ...result };
    if (changes.parameter !== undefined) updated.parameter = changes.parameter;
    if (changes.valueNumeric === null) delete updated.valueNumeric;
    else if (changes.valueNumeric !== undefined) updated.valueNumeric = changes.valueNumeric;
    if (changes.valueText === null) delete updated.valueText;
    else if (changes.valueText !== undefined) updated.valueText = changes.valueText;
    if (changes.unit === null) delete updated.unit;
    else if (changes.unit !== undefined) updated.unit = changes.unit;
    if (changes.referenceMin === null) delete updated.referenceMin;
    else if (changes.referenceMin !== undefined) updated.referenceMin = changes.referenceMin;
    if (changes.referenceMax === null) delete updated.referenceMax;
    else if (changes.referenceMax !== undefined) updated.referenceMax = changes.referenceMax;
    this.byId.set(resultId, updated);
    return Promise.resolve(updated);
  }

  async delete(_trx: FakeTrx, examinationId: string, resultId: string): Promise<void> {
    const result = this.byId.get(resultId);
    if (result?.examinationId === examinationId) {
      this.byId.delete(resultId);
    }
    return Promise.resolve();
  }

  async historyByParameter(_trx: FakeTrx, familyId: string, memberId: string, parameter: string): Promise<ExamResultHistoryItem[]> {
    const items: ExamResultHistoryItem[] = [];
    for (const result of this.byId.values()) {
      if (result.parameter !== parameter) continue;
      const examination = this.examinations.byId.get(result.examinationId);
      if (!examination) continue;
      if (examination.familyId !== familyId || examination.memberId !== memberId) continue;
      items.push({
        examinationId: examination.id,
        examDate: examination.examDate,
        ...(result.valueNumeric !== undefined ? { valueNumeric: result.valueNumeric } : {}),
        ...(result.valueText !== undefined ? { valueText: result.valueText } : {}),
        ...(result.unit !== undefined ? { unit: result.unit } : {}),
        ...(result.referenceMin !== undefined ? { referenceMin: result.referenceMin } : {}),
        ...(result.referenceMax !== undefined ? { referenceMax: result.referenceMax } : {}),
      });
    }
    return Promise.resolve(items.sort((a, b) => a.examDate.localeCompare(b.examDate)));
  }

  seed(result: ExamResult): void {
    this.byId.set(result.id, result);
  }
}

export interface ExaminationsFixtures {
  deps: ExaminationsDeps<FakeTrx>;
  examinationsRepo: FakeExaminationsRepository;
  examResultsRepo: FakeExamResultsRepository;
  policy: FakeAccessPolicy;
  clinics: FakeClinicsPort;
  documents: FakeDocumentsPort;
  audit: FakeAuditPort;
}

export function createExaminationsFixtures(clock: Clock): ExaminationsFixtures {
  const examinationsRepo = new FakeExaminationsRepository();
  const examResultsRepo = new FakeExamResultsRepository(examinationsRepo);
  const policy = new FakeAccessPolicy();
  const clinics = new FakeClinicsPort();
  const documents = new FakeDocumentsPort();
  const audit = new FakeAuditPort();
  const deps: ExaminationsDeps<FakeTrx> = {
    examinationsRepo,
    examResultsRepo,
    policy,
    clinics,
    documents,
    audit,
    db: FAKE_TRX,
    withTransaction: (fn) => fn(FAKE_TRX),
    clock,
  };
  return { deps, examinationsRepo, examResultsRepo, policy, clinics, documents, audit };
}
