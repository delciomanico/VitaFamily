// Fakes em memória das portas de `clinic-receipts` (mesmo padrão dos outros módulos). Não é ficheiro de teste.
import { ConflictError, ForbiddenError, NotFoundError } from "../../../platform/errors/index.js";
import type { Clock } from "../../../platform/clock/index.js";
import { InMemoryRateLimiter } from "../../../platform/rate-limit/index.js";
import type { AccessContext, CanInput } from "../../access/index.js";
import type { AuditEvent } from "../../audit/index.js";
import type { CatalogService, ClinicReceipt, ReceiptBookingKind } from "../domain/receipt.js";
import type {
  AccessPolicyPort,
  AttachedClaimsPort,
  AuditPort,
  BookingFacts,
  BookingSourcePort,
  ClinicProfileReaderPort,
  ClinicProfileSnapshot,
  ClinicReceiptsDeps,
  ConsentLookupPort,
  NewReceiptRecord,
  ReceiptListFilter,
  ReceiptPeriodSummary,
  ReceiptsRepository,
  ServiceCatalogReaderPort,
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

export class FakeReceiptsRepository implements ReceiptsRepository<FakeTrx> {
  readonly byId = new Map<string, ClinicReceipt>();
  readonly links = new Map<string, { familyId: string; memberId: string }>();
  readonly counters = new Map<string, number>();

  async nextNumber(_trx: FakeTrx, clinicId: string): Promise<number> {
    const next = (this.counters.get(clinicId) ?? 0) + 1;
    this.counters.set(clinicId, next);
    return Promise.resolve(next);
  }
  async insert(_trx: FakeTrx, record: NewReceiptRecord, number: number): Promise<ClinicReceipt> {
    if ([...this.byId.values()].some((r) => r.clinicId === record.clinicId && r.bookingKind === record.bookingKind && r.bookingId === record.bookingId && r.status === "ISSUED")) {
      throw new ConflictError({ detail: "Já existe um recibo emitido para esta marcação." });
    }
    const receipt: ClinicReceipt = { ...record, number, status: "ISSUED", voidedAt: null, voidReason: null, voidedByClinicAccountId: null };
    this.byId.set(receipt.id, receipt);
    return Promise.resolve(receipt);
  }
  async insertLink(_trx: FakeTrx, receiptId: string, familyId: string, memberId: string): Promise<void> {
    this.links.set(receiptId, { familyId, memberId });
    return Promise.resolve();
  }
  async findById(_trx: FakeTrx, clinicId: string, receiptId: string): Promise<ClinicReceipt | null> {
    const r = this.byId.get(receiptId);
    return Promise.resolve(r?.clinicId === clinicId ? r : null);
  }
  async findIssuedByBooking(_trx: FakeTrx, clinicId: string, kind: ReceiptBookingKind, bookingId: string): Promise<ClinicReceipt | null> {
    return Promise.resolve([...this.byId.values()].find((r) => r.clinicId === clinicId && r.bookingKind === kind && r.bookingId === bookingId && r.status === "ISSUED") ?? null);
  }
  async findIssuedIdsByBookings(_trx: FakeTrx, clinicId: string, kind: ReceiptBookingKind, bookingIds: string[]): Promise<Map<string, string>> {
    return Promise.resolve(new Map([...this.byId.values()].filter((r) => r.clinicId === clinicId && r.bookingKind === kind && r.status === "ISSUED" && bookingIds.includes(r.bookingId)).map((r) => [r.bookingId, r.id])));
  }
  async markVoided(_trx: FakeTrx, _clinicId: string, receiptId: string, reason: string, accountId: string, now: Date): Promise<ClinicReceipt> {
    const r = this.byId.get(receiptId);
    if (!r) throw new NotFoundError();
    const voided: ClinicReceipt = { ...r, status: "VOIDED", voidReason: reason, voidedAt: now, voidedByClinicAccountId: accountId };
    this.byId.set(receiptId, voided);
    return Promise.resolve(voided);
  }
  async list(_trx: FakeTrx, clinicId: string, filter: ReceiptListFilter, limit: number): Promise<ClinicReceipt[]> {
    return Promise.resolve(
      [...this.byId.values()]
        .filter((r) => r.clinicId === clinicId && r.issuedAt >= filter.from && r.issuedAt < filter.to && (!filter.status || r.status === filter.status))
        .sort((a, b) => b.issuedAt.getTime() - a.issuedAt.getTime() || b.id.localeCompare(a.id))
        .filter((r) => !filter.after || r.issuedAt < filter.after.issuedAt || (r.issuedAt.getTime() === filter.after.issuedAt.getTime() && r.id < filter.after.id))
        .slice(0, limit),
    );
  }
  async summarize(_trx: FakeTrx, clinicId: string, from: Date, to: Date): Promise<ReceiptPeriodSummary> {
    const rows = [...this.byId.values()].filter((r) => r.clinicId === clinicId && r.issuedAt >= from && r.issuedAt < to);
    const issued = rows.filter((r) => r.status === "ISSUED");
    return Promise.resolve({ issuedCount: issued.length, issuedTotalMinor: issued.reduce((s, r) => s + r.totalMinor, 0), voidedCount: rows.length - issued.length });
  }
  async availableToPatient(_trx: FakeTrx, receiptIds: string[]): Promise<Set<string>> {
    return Promise.resolve(new Set(receiptIds.filter((id) => this.links.has(id))));
  }
  async listLinkedByMember(_trx: FakeTrx, familyId: string, memberId: string, after: { issuedAt: Date; id: string } | undefined, limit: number): Promise<ClinicReceipt[]> {
    return Promise.resolve(
      [...this.byId.values()]
        .filter((r) => this.links.get(r.id)?.familyId === familyId && this.links.get(r.id)?.memberId === memberId)
        .sort((a, b) => b.issuedAt.getTime() - a.issuedAt.getTime() || b.id.localeCompare(a.id))
        .filter((r) => !after || r.issuedAt < after.issuedAt || (r.issuedAt.getTime() === after.issuedAt.getTime() && r.id < after.id))
        .slice(0, limit),
    );
  }
  async findLinkedByMember(_trx: FakeTrx, familyId: string, memberId: string, receiptId: string): Promise<ClinicReceipt | null> {
    const link = this.links.get(receiptId);
    return Promise.resolve(link?.familyId === familyId && link.memberId === memberId ? (this.byId.get(receiptId) ?? null) : null);
  }
  async lockLinkedByMember(_trx: FakeTrx, familyId: string, memberId: string, receiptIds: string[]): Promise<ClinicReceipt[]> {
    return Promise.resolve([...this.byId.values()].filter((r) => receiptIds.includes(r.id) && this.links.get(r.id)?.familyId === familyId && this.links.get(r.id)?.memberId === memberId));
  }
  async findManyByIds(_trx: FakeTrx, receiptIds: string[]): Promise<ClinicReceipt[]> {
    return Promise.resolve([...this.byId.values()].filter((r) => receiptIds.includes(r.id)));
  }
}

export class FakeBookingSource implements BookingSourcePort<FakeTrx> {
  /** `kind:bookingId` -> (clinicId, factos). */
  readonly bookings = new Map<string, { clinicId: string; facts: BookingFacts }>();
  async find(_trx: FakeTrx, clinicId: string, kind: ReceiptBookingKind, bookingId: string): Promise<BookingFacts | null> {
    const b = this.bookings.get(`${kind}:${bookingId}`);
    return Promise.resolve(b?.clinicId === clinicId ? b.facts : null);
  }
  seed(kind: ReceiptBookingKind, bookingId: string, clinicId: string, facts: BookingFacts): void {
    this.bookings.set(`${kind}:${bookingId}`, { clinicId, facts });
  }
}

export class FakeConsentLookup implements ConsentLookupPort<FakeTrx> {
  readonly consents = new Set<string>();
  async hasConsent(_trx: FakeTrx, clinicId: string, memberId: string): Promise<boolean> {
    return Promise.resolve(this.consents.has(`${clinicId}:${memberId}`));
  }
}

export class FakeProfileReader implements ClinicProfileReaderPort<FakeTrx> {
  snapshot: ClinicProfileSnapshot = { issuer: { name: "Clínica Sol", address: "Rua A", phone: "900", email: null }, currency: "AOA" };
  async get(): Promise<ClinicProfileSnapshot> {
    return Promise.resolve(this.snapshot);
  }
}

export class FakeServiceCatalog implements ServiceCatalogReaderPort<FakeTrx> {
  readonly services = new Map<string, CatalogService & { clinicId: string }>();
  async find(_trx: FakeTrx, clinicId: string, serviceTypeId: string): Promise<CatalogService | null> {
    const s = this.services.get(serviceTypeId);
    return Promise.resolve(s?.clinicId === clinicId ? s : null);
  }
}

export class FakeAttachedClaims implements AttachedClaimsPort<FakeTrx> {
  readonly byReceipt = new Map<string, string[]>();
  async claimIdsByReceipt(_trx: FakeTrx, receiptIds: string[]): Promise<Map<string, string[]>> {
    return Promise.resolve(new Map([...this.byReceipt].filter(([id]) => receiptIds.includes(id))));
  }
}

/** `VIEW_CLINIC_RECEIPTS`: `relations` mapeia `userId:memberId` -> relação; sem entrada => NOT_FOUND. */
export class FakeAccessPolicy implements AccessPolicyPort<FakeTrx> {
  readonly relations = new Map<string, "SELF" | "TUTOR_OF" | "OTHER" | "DEPENDENT_SELF">();
  async can(_trx: FakeTrx, input: CanInput): Promise<AccessContext> {
    const relation = this.relations.get(`${input.userId}:${input.subjectMemberId ?? ""}`);
    if (!relation) throw new NotFoundError();
    if (relation !== "SELF" && relation !== "TUTOR_OF") throw new ForbiddenError();
    return Promise.resolve({ relation } as AccessContext);
  }
}

export function createClinicReceiptsFixtures(clock: Clock) {
  const receiptsRepo = new FakeReceiptsRepository();
  const bookings = new FakeBookingSource();
  const consents = new FakeConsentLookup();
  const profile = new FakeProfileReader();
  const services = new FakeServiceCatalog();
  const attachedClaims = new FakeAttachedClaims();
  const policy = new FakeAccessPolicy();
  const audit = new FakeAuditPort();
  const deps: ClinicReceiptsDeps<FakeTrx> = {
    receiptsRepo,
    bookings,
    consents,
    profile,
    services,
    attachedClaims,
    policy,
    audit,
    withTransaction: (fn) => fn(FAKE_TRX),
    listLimiter: new InMemoryRateLimiter(clock),
    clock,
  };
  return { deps, receiptsRepo, bookings, consents, profile, services, attachedClaims, policy, audit };
}
