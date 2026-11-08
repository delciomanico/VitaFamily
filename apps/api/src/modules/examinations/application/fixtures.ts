// Fakes em memória das portas de `examinations` (mesmo padrão de `prescriptions`/`appointments`
// `application/fixtures.ts`). Não é ficheiro de teste.
import { decodeCursor, encodeCursor } from "../../../platform/page/index.js";
import { InMemoryRateLimiter } from "../../../platform/rate-limit/index.js";
import type { Clock } from "../../../platform/clock/index.js";
import type { AccessContext, CanInput, Relation } from "../../access/index.js";
import type { AuditEvent } from "../../audit/index.js";
import type { Document, ResourceType } from "../../documents/index.js";
import type { ExamResult } from "../domain/exam-result.js";
import type { Examination, ExaminationStatus } from "../domain/examination.js";
import type {
  AccessPolicyPort,
  AuditPort,
  ClinicExamCompletion,
  ClinicExamStatusChange,
  ClinicExamsFilter,
  ClinicSlotLite,
  ClinicsPort,
  CursorPage,
  DocumentsPort,
  ExamAlertsPort,
  ExamReportGeneratorPort,
  ExamReportRequest,
  ExamResultDraftItem,
  ExamResultsDraft,
  ExamResultsDraftRepository,
  SaveExamResultsDraft,
  ReceiptIdsPort,
  MemberNamesPort,
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

  readonly slots = new Map<string, ClinicSlotLite>();

  async lockSlot(_trx: FakeTrx, slotId: string): Promise<ClinicSlotLite | null> {
    return Promise.resolve(this.slots.get(slotId) ?? null);
  }

  seed(id: string, name: string, familyId: string, active = true): void {
    this.clinics.set(id, { id, name, familyId, active });
  }

  seedSlot(slot: ClinicSlotLite): void {
    this.slots.set(slot.id, slot);
  }

  async findSlotById(slotId: string): Promise<ClinicSlotLite | null> {
    return Promise.resolve(this.slots.get(slotId) ?? null);
  }
}

/** M14 R (BR-CLN-31): `bookingId -> receiptId` preparado pelos testes. */
export class FakeReceiptIdsPort implements ReceiptIdsPort<FakeTrx> {
  readonly issued = new Map<string, string>();

  async findIssuedReceiptIds(_trx: FakeTrx, _clinicId: string, _kind: "EXAM", bookingIds: string[]): Promise<Map<string, string>> {
    return Promise.resolve(new Map([...this.issued].filter(([id]) => bookingIds.includes(id))));
  }
}

export class FakeMemberNamesPort implements MemberNamesPort<FakeTrx> {
  readonly names = new Map<string, string>();

  async getMemberName(_trx: FakeTrx, familyId: string, memberId: string): Promise<string | null> {
    return Promise.resolve(this.names.get(`${familyId}:${memberId}`) ?? null);
  }
}

export class FakeExamAlertsPort implements ExamAlertsPort<FakeTrx> {
  readonly events: { type: string; examinationId: string; familyId: string; memberId: string }[] = [];

  async raiseExamEvent(_trx: FakeTrx, input: { type: "EXAM_CANCELLED" | "EXAM_RESULTS_AVAILABLE"; examinationId: string; familyId: string; memberId: string }): Promise<number> {
    this.events.push(input);
    return Promise.resolve(1);
  }
}

export class FakeDocumentsPort implements DocumentsPort<FakeTrx> {
  readonly byResource = new Map<string, Document[]>();
  readonly deleteCalls: { resourceType: ResourceType; resourceId: string }[] = [];
  /** BR-CLN-08: simula o `documents` real (a resolução do alvo corre "na transação" do chamador). */
  readonly clinicUploads: { clinicAccountId: string; examinationId: string; originalName: string }[] = [];
  readonly clinicDeletes: { clinicAccountId: string; examinationId: string; documentId: string }[] = [];

  async uploadClinicExamDocument(
    actor: { clinicAccountId: string },
    input: { examinationId: string; file: { buffer: Buffer; originalName: string } },
    resolveTarget: (trx: FakeTrx) => Promise<{ familyId: string; memberId: string }>,
    _context: unknown,
  ): Promise<Document> {
    const target = await resolveTarget(FAKE_TRX);
    this.clinicUploads.push({ clinicAccountId: actor.clinicAccountId, examinationId: input.examinationId, originalName: input.file.originalName });
    const document: Document = {
      id: `doc-${String(this.clinicUploads.length)}`,
      familyId: target.familyId,
      memberId: target.memberId,
      resourceType: "EXAMINATION",
      resourceId: input.examinationId,
      storageKey: `quarantine/doc-${String(this.clinicUploads.length)}`,
      originalName: input.file.originalName,
      mimeType: "application/pdf",
      sizeBytes: input.file.buffer.length,
      checksumSha256: "x",
      scanStatus: "PENDING",
      uploadedByClinic: true,
      uploadedByClinicAccountId: actor.clinicAccountId,
      generatedBySystem: false,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    };
    const key = `EXAMINATION|${input.examinationId}`;
    this.byResource.set(key, [...(this.byResource.get(key) ?? []), document]);
    return document;
  }

  async deleteClinicExamDocument(
    actor: { clinicAccountId: string },
    input: { examinationId: string; documentId: string },
    resolveTarget: (trx: FakeTrx) => Promise<{ familyId: string; memberId: string }>,
    _context: unknown,
  ): Promise<void> {
    await resolveTarget(FAKE_TRX);
    this.clinicDeletes.push({ clinicAccountId: actor.clinicAccountId, ...input });
    const key = `EXAMINATION|${input.examinationId}`;
    this.byResource.set(key, (this.byResource.get(key) ?? []).filter((d) => d.id !== input.documentId));
  }

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

  /** M15 T: simula `documents.storeGenerated` (laudo CLEAN, `generatedBySystem`). */
  readonly stored: { examinationId: string; bytes: Buffer; originalName: string }[] = [];
  readonly discarded: string[] = [];
  /** Se definido, `storeGenerated` falha (prova a reversão da conclusão). */
  failStore: Error | null = null;

  async storeGenerated(
    _trx: FakeTrx,
    input: { familyId: string; memberId: string; examinationId: string; originalName: string; bytes: Buffer; clinicAccountId: string },
  ): Promise<Document> {
    if (this.failStore) throw this.failStore;
    this.stored.push({ examinationId: input.examinationId, bytes: input.bytes, originalName: input.originalName });
    const document: Document = {
      id: `gen-${String(this.stored.length)}`,
      familyId: input.familyId,
      memberId: input.memberId,
      resourceType: "EXAMINATION",
      resourceId: input.examinationId,
      storageKey: `documents/gen-${String(this.stored.length)}.pdf`,
      originalName: input.originalName,
      mimeType: "application/pdf",
      sizeBytes: input.bytes.length,
      checksumSha256: "x",
      scanStatus: "CLEAN",
      uploadedByClinic: true,
      uploadedByClinicAccountId: input.clinicAccountId,
      generatedBySystem: true,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    };
    const key = `EXAMINATION|${input.examinationId}`;
    this.byResource.set(key, [...(this.byResource.get(key) ?? []), document]);
    return Promise.resolve(document);
  }

  async discardStored(storageKey: string): Promise<void> {
    this.discarded.push(storageKey);
    return Promise.resolve();
  }

  async readGeneratedExamReport(_trx: FakeTrx, _familyId: string, _memberId: string, examinationId: string): Promise<{ document: Document; bytes: Buffer } | null> {
    const document = (this.byResource.get(`EXAMINATION|${examinationId}`) ?? []).find((d) => d.generatedBySystem);
    const stored = this.stored.find((s) => s.examinationId === examinationId);
    return Promise.resolve(document && stored ? { document, bytes: stored.bytes } : null);
  }
}

export class FakeResultsDraftRepository implements ExamResultsDraftRepository<FakeTrx> {
  readonly byExam = new Map<string, ExamResultsDraft>();
  async find(_trx: FakeTrx, examinationId: string): Promise<ExamResultsDraft | null> {
    return Promise.resolve(this.byExam.get(examinationId) ?? null);
  }
  async upsert(_trx: FakeTrx, draft: SaveExamResultsDraft): Promise<ExamResultsDraft> {
    const saved: ExamResultsDraft = { examinationId: draft.examinationId, results: draft.results, resultNote: draft.resultNote, updatedAt: draft.now };
    this.byExam.set(draft.examinationId, saved);
    return Promise.resolve(saved);
  }
  async delete(_trx: FakeTrx, examinationId: string): Promise<boolean> {
    return Promise.resolve(this.byExam.delete(examinationId));
  }
  async existingIds(_trx: FakeTrx, examinationIds: string[]): Promise<Set<string>> {
    return Promise.resolve(new Set(examinationIds.filter((id) => this.byExam.has(id))));
  }
}

/** Fake de `ExamReportGeneratorPort`: devolve bytes fixos e a contagem aritmética real (`valor < min || valor > max`). */
export class FakeExamReportGenerator implements ExamReportGeneratorPort<FakeTrx> {
  readonly requests: ExamReportRequest[] = [];
  failWith: Error | null = null;
  async generate(_trx: FakeTrx, request: ExamReportRequest): Promise<{ bytes: Buffer; resultsCount: number; outOfReferenceCount: number }> {
    if (this.failWith) throw this.failWith;
    this.requests.push(request);
    const out = (r: ExamResultDraftItem) => typeof r.valueNumeric === "number" && ((typeof r.referenceMin === "number" && r.valueNumeric < r.referenceMin) || (typeof r.referenceMax === "number" && r.valueNumeric > r.referenceMax));
    return Promise.resolve({ bytes: Buffer.from("%PDF-1.4 fake"), resultsCount: request.results.length, outOfReferenceCount: request.results.filter(out).length });
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

function scheduledMs(examination: Examination): number {
  return examination.scheduledAt?.getTime() ?? 0;
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
      issuedBy: "FAMILY",
      createdAt: record.createdAt,
      ...(record.slotId !== undefined ? { slotId: record.slotId } : {}),
      ...(record.scheduledAt !== undefined ? { scheduledAt: record.scheduledAt } : {}),
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

  async countScheduledBySlot(_trx: FakeTrx, slotIds: string[]): Promise<{ slotId: string; count: number }[]> {
    const counts = new Map<string, number>();
    for (const e of this.byId.values()) {
      if (e.slotId !== undefined && slotIds.includes(e.slotId) && e.status === "SCHEDULED") counts.set(e.slotId, (counts.get(e.slotId) ?? 0) + 1);
    }
    return Promise.resolve([...counts].map(([slotId, count]) => ({ slotId, count })));
  }

  async existsScheduledForMember(_trx: FakeTrx, slotId: string, memberId: string): Promise<boolean> {
    return Promise.resolve([...this.byId.values()].some((e) => e.slotId === slotId && e.memberId === memberId && e.status === "SCHEDULED"));
  }

  async findByClinicId(_trx: FakeTrx, clinicId: string, examinationId: string): Promise<Examination | null> {
    const examination = this.byId.get(examinationId);
    return Promise.resolve(examination?.clinicId === clinicId && examination.scheduledAt !== undefined ? examination : null);
  }

  async listByClinicAndStatus(_trx: FakeTrx, clinicId: string, statuses: ExaminationStatus[], filter: { from?: Date; to?: Date }): Promise<Examination[]> {
    return Promise.resolve(
      [...this.byId.values()]
        .filter((e) => e.clinicId === clinicId && e.scheduledAt !== undefined && statuses.includes(e.status))
        .filter((e) => !filter.from || scheduledMs(e) >= filter.from.getTime())
        .filter((e) => !filter.to || scheduledMs(e) <= filter.to.getTime())
        .sort((a, b) => scheduledMs(a) - scheduledMs(b)),
    );
  }

  async listForClinic(_trx: FakeTrx, clinicId: string, filter: ClinicExamsFilter, limit?: number): Promise<Examination[]> {
    const rows = [...this.byId.values()]
      .filter((e) => e.clinicId === clinicId && e.scheduledAt !== undefined && (e.status === "SCHEDULED" || e.status === "COMPLETED"))
      .filter((e) => !filter.from || scheduledMs(e) >= filter.from.getTime())
      .filter((e) => !filter.to || scheduledMs(e) < filter.to.getTime())
      .filter((e) => !(filter.familyId && filter.memberId) || (e.familyId === filter.familyId && e.memberId === filter.memberId))
      .sort((a, b) => scheduledMs(a) - scheduledMs(b));
    return Promise.resolve(limit === undefined ? rows : rows.reverse().slice(0, limit));
  }

  async listSharedByMember(_trx: FakeTrx, familyId: string, memberId: string, since: string): Promise<Examination[]> {
    return Promise.resolve([...this.byId.values()].filter((e) => e.familyId === familyId && e.memberId === memberId && (e.status === "SCHEDULED" || e.status === "COMPLETED") && e.examDate >= since));
  }

  async updateStatusByClinic(_trx: FakeTrx, examinationId: string, change: ClinicExamStatusChange): Promise<Examination> {
    const examination = this.byId.get(examinationId);
    if (!examination) throw new Error("exame inexistente no fake");
    const updated: Examination = { ...examination, status: change.status };
    if (change.responseNote) updated.responseNote = change.responseNote;
    else if (change.responseNote === null) delete updated.responseNote;
    this.byId.set(examinationId, updated);
    return Promise.resolve(updated);
  }

  async completeByClinic(_trx: FakeTrx, examinationId: string, completion: ClinicExamCompletion): Promise<Examination> {
    const examination = this.byId.get(examinationId);
    if (!examination) throw new Error("exame inexistente no fake");
    const updated: Examination = {
      ...examination,
      status: "COMPLETED",
      issuedBy: "CLINIC",
      issuedByClinicAccountId: completion.clinicAccountId,
      resultsIssuedAt: completion.issuedAt,
      ...(completion.resultNote ? { clinicResultNote: completion.resultNote } : {}),
    };
    this.byId.set(examinationId, updated);
    return Promise.resolve(updated);
  }

  async isCompleted(_trx: FakeTrx, familyId: string, memberId: string, examinationId: string): Promise<boolean> {
    const examination = this.byId.get(examinationId);
    return Promise.resolve(examination?.familyId === familyId && examination.memberId === memberId && examination.status === "COMPLETED");
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
  memberNames: FakeMemberNamesPort;
  alerts: FakeExamAlertsPort;
  receipts: FakeReceiptIdsPort;
  drafts: FakeResultsDraftRepository;
  reportGenerator: FakeExamReportGenerator;
  audit: FakeAuditPort;
}

export function createExaminationsFixtures(clock: Clock): ExaminationsFixtures {
  const examinationsRepo = new FakeExaminationsRepository();
  const examResultsRepo = new FakeExamResultsRepository(examinationsRepo);
  const policy = new FakeAccessPolicy();
  const clinics = new FakeClinicsPort();
  const documents = new FakeDocumentsPort();
  const memberNames = new FakeMemberNamesPort();
  const alerts = new FakeExamAlertsPort();
  const receipts = new FakeReceiptIdsPort();
  const drafts = new FakeResultsDraftRepository();
  const reportGenerator = new FakeExamReportGenerator();
  const audit = new FakeAuditPort();
  const deps: ExaminationsDeps<FakeTrx> = {
    examinationsRepo,
    examResultsRepo,
    draftsRepo: drafts,
    reportGenerator,
    limiter: new InMemoryRateLimiter(clock),
    policy,
    memberNames,
    alerts,
    clinics,
    documents,
    receipts,
    audit,
    db: FAKE_TRX,
    withTransaction: (fn) => fn(FAKE_TRX),
    clock,
  };
  return { deps, examinationsRepo, examResultsRepo, policy, clinics, documents, memberNames, alerts, receipts, drafts, reportGenerator, audit };
}
