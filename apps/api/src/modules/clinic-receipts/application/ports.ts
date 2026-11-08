// Portas do módulo `clinic-receipts` (conventions.md §3.2, modules.md §2 nota 26): definidas aqui, implementadas em
// `infrastructure` (Kysely) ou ligadas no composition root às APIs públicas de `appointments`/`examinations`/
// `clinic-patients`/`clinics`. O módulo NÃO importa módulos de saúde, `families`, `auth`, `insurance` nem `documents`.
// Genéricas em `Trx` para esta camada nunca importar "kysely" (conventions.md §3.9).
import type { Clock } from "../../../platform/clock/index.js";
import type { RateLimiter } from "../../../platform/rate-limit/index.js";
import type { AccessContext, CanInput } from "../../access/index.js";
import type { AuditEvent } from "../../audit/index.js";
import type { CatalogService, ClinicReceipt, PaymentMethod, ReceiptBookingKind, ReceiptIssuer, ReceiptLine, ReceiptStatus } from "../domain/receipt.js";

export interface ActorIdentity {
  userId: string;
  platformAdmin: boolean;
}

/** Ator do portal da clínica (`platform/actor.ClinicActorInfo`, ADR-020) — só o que esta camada precisa. */
export interface ClinicPortalActor {
  clinicAccountId: string;
  clinicId: string;
  role: "CLINIC_ADMIN" | "CLINIC_MANAGER" | "CLINIC_DOCTOR";
}

export interface RequestContext {
  requestId: string;
  ip?: string;
  userAgent?: string;
}

export type WithTransaction<Trx> = <T>(fn: (trx: Trx) => Promise<T>) => Promise<T>;

export interface AuditPort<Trx> {
  record(trx: Trx, event: AuditEvent): Promise<void>;
}

/** Subconjunto de `access.policy` (BR-CLN-35: só `SELF` adulto ou `TUTOR_OF`, via `VIEW_CLINIC_RECEIPTS`). */
export interface AccessPolicyPort<Trx> {
  can(trx: Trx, input: CanInput): Promise<AccessContext>;
}

// --- Portas para dados de outros módulos (ligadas no composition root) ---

/** Marcação da própria clínica vista pelo recibo; `vita` só existe para consultas/exames Vita e fica SÓ no servidor. */
export interface BookingFacts {
  status: string;
  patientName: string;
  /** Serviço do catálogo do horário da marcação (BR-CLN-11/12), se houver. */
  serviceTypeId?: string;
  vita?: { familyId: string; memberId: string };
}

export interface BookingSourcePort<Trx> {
  /** `null` se a marcação não existe ou é de outra clínica (404 sem enumeração). */
  find(trx: Trx, clinicId: string, kind: ReceiptBookingKind, bookingId: string): Promise<BookingFacts | null>;
}

export interface ConsentLookupPort<Trx> {
  /** BR-CLN-35: existe `ClinicConsent` (qualquer nível) da clínica para o membro. */
  hasConsent(trx: Trx, clinicId: string, memberId: string): Promise<boolean>;
}

export interface ClinicProfileSnapshot {
  issuer: ReceiptIssuer;
  currency: string;
}

export interface ClinicProfileReaderPort<Trx> {
  /** Cabeçalho (nome de apresentação ?? nome, morada, contactos) e moeda da clínica no momento. */
  get(trx: Trx, clinicId: string): Promise<ClinicProfileSnapshot>;
}

export interface ServiceCatalogReaderPort<Trx> {
  find(trx: Trx, clinicId: string, serviceTypeId: string): Promise<CatalogService | null>;
}

/** Pedidos de reembolso (não rejeitados) a que cada recibo está anexado — implementada por `insurance` (BR-CLN-36). */
export interface AttachedClaimsPort<Trx> {
  claimIdsByReceipt(trx: Trx, receiptIds: string[]): Promise<Map<string, string[]>>;
}

// --- Repositório (propriedade exclusiva deste módulo, schema.md §3f) ---

export interface NewReceiptRecord {
  id: string;
  clinicId: string;
  bookingKind: ReceiptBookingKind;
  bookingId: string;
  paymentMethod: PaymentMethod;
  currency: string;
  totalMinor: number;
  patientName: string;
  note: string | null;
  issuer: ReceiptIssuer;
  lines: ReceiptLine[];
  issuedAt: Date;
  issuedByClinicAccountId: string;
}

export interface ReceiptListFilter {
  from: Date;
  to: Date;
  status?: ReceiptStatus;
  after?: { issuedAt: Date; id: string };
}

export interface ReceiptPeriodSummary {
  issuedCount: number;
  issuedTotalMinor: number;
  voidedCount: number;
}

export interface ReceiptsRepository<Trx> {
  /** BR-CLN-32: `INSERT … ON CONFLICT (clinic_id) DO UPDATE SET last_number = last_number + 1 RETURNING` na transação do recibo. */
  nextNumber(trx: Trx, clinicId: string): Promise<number>;
  /** `UNIQUE parcial` violada (um `ISSUED` por marcação) => `ConflictError`. */
  insert(trx: Trx, record: NewReceiptRecord, number: number): Promise<ClinicReceipt>;
  insertLink(trx: Trx, receiptId: string, familyId: string, memberId: string, createdAt: Date): Promise<void>;
  /** Sempre filtrado por `clinicId` (isolamento, 404 sem enumeração). `lock` = `FOR UPDATE`. */
  findById(trx: Trx, clinicId: string, receiptId: string, lock?: boolean): Promise<ClinicReceipt | null>;
  findIssuedByBooking(trx: Trx, clinicId: string, kind: ReceiptBookingKind, bookingId: string): Promise<ClinicReceipt | null>;
  /** BR-CLN-31: `bookingId -> receiptId` do recibo `ISSUED` de cada marcação (decora `ClinicBooking.receiptId`). */
  findIssuedIdsByBookings(trx: Trx, clinicId: string, kind: ReceiptBookingKind, bookingIds: string[]): Promise<Map<string, string>>;
  markVoided(trx: Trx, clinicId: string, receiptId: string, reason: string, accountId: string, now: Date): Promise<ClinicReceipt>;
  list(trx: Trx, clinicId: string, filter: ReceiptListFilter, limit: number): Promise<ClinicReceipt[]>;
  /** Período inteiro (não só a página); os anulados não somam. */
  summarize(trx: Trx, clinicId: string, from: Date, to: Date): Promise<ReceiptPeriodSummary>;
  availableToPatient(trx: Trx, receiptIds: string[]): Promise<Set<string>>;
  // Lado família (BR-CLN-35): só recibos com ligação ao membro.
  listLinkedByMember(trx: Trx, familyId: string, memberId: string, after: { issuedAt: Date; id: string } | undefined, limit: number): Promise<ClinicReceipt[]>;
  findLinkedByMember(trx: Trx, familyId: string, memberId: string, receiptId: string, lock?: boolean): Promise<ClinicReceipt | null>;
  /** BR-CLN-36: recibos visíveis ao membro entre `receiptIds`, bloqueados (`FOR UPDATE`) para a anexação. */
  lockLinkedByMember(trx: Trx, familyId: string, memberId: string, receiptIds: string[]): Promise<ClinicReceipt[]>;
  findManyByIds(trx: Trx, receiptIds: string[]): Promise<ClinicReceipt[]>;
}

export interface ClinicReceiptsDeps<Trx> {
  receiptsRepo: ReceiptsRepository<Trx>;
  bookings: BookingSourcePort<Trx>;
  consents: ConsentLookupPort<Trx>;
  profile: ClinicProfileReaderPort<Trx>;
  services: ServiceCatalogReaderPort<Trx>;
  attachedClaims: AttachedClaimsPort<Trx>;
  policy: AccessPolicyPort<Trx>;
  audit: AuditPort<Trx>;
  withTransaction: WithTransaction<Trx>;
  listLimiter: RateLimiter;
  clock: Clock;
}
