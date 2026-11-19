// Portas da `application` de `consultations` (ADR-016; modules.md nota 37). `consultations` NÃO importa `auth`, `access`, `families`,
// `users`, `professionals`, `appointments`, `processes`, `alerts`, `notifications`, `messaging`, `discovery`, `admin`, `lifecycle` nem
// módulos de saúde: tudo o que vem de fora entra por estas portas, ligadas em `main/api.ts`. Só `audit` e `platform`.
// Texto livre (rótulo, notas, motivos, ligação) nunca sai por estas portas para logs, auditoria nem alertas (BR-MKT-63).
import type { AuditEvent } from "../../audit/index.js";
import type { BookingCancelledBy, BookingPaymentStatus, BookingStatus, BookingSystemReason } from "../domain/booking.js";
import type { BookingHint, BookingPhase } from "../domain/projection.js";

export interface ConsultationsClock {
  now(): Date;
}

export interface ActorIdentity {
  userId: string;
  platformAdmin: boolean;
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

/** Decisão da família sobre a ação `BOOK_PROFESSIONALS` (só `SELF`/`TUTOR_OF`; implementada em `main/api.ts` sobre `access`). */
export interface BookingAccess<Trx> {
  /** Lança `NotFoundError`/`ForbiddenError`/`MEMBER_BLOCKED` em DENY. */
  assertCanBook(trx: Trx, input: { userId: string; platformAdmin: boolean; familyId: string; memberId: string }): Promise<{ relation: "SELF" | "TUTOR_OF" }>;
}

export type OfferMethod = "IN_PERSON" | "VIDEO" | "CHAT" | "PHONE";
export type SpecialtyCategory = "HEALTH" | "WELLNESS";

/** Factos da oferta e do horário lidos AGORA (só `APPROVED`, oferta ativa). `slot: null` ⇒ o horário não existe para este profissional. */
export interface BookingFacts {
  professionalId: string;
  displayName: string;
  city: string;
  offer: { id: string; specialtyId: string; method: OfferMethod; durationMinutes: number; priceKz: number };
  slot: { id: string; offerId: string; startsAt: Date; endsAt: Date; booked: boolean } | null;
}

export interface ProfessionalIdentity {
  id: string;
  displayName: string;
  city: string | null;
  /** `validation_status = APPROVED` lido AGORA, sem cache. */
  approved: boolean;
}

/** Sobre a raiz `ProfessionalDirectory`: a ocupação do horário é coluna de `professionals`, escrita só por `reserveSlot`/`releaseSlot`. */
export interface ProfessionalAgenda<Trx> {
  getBookingFacts(offerId: string, slotId: string): Promise<BookingFacts | null>;
  /** `UPDATE` condicional atómico NA transação do chamador; falso ⇒ `SLOT_UNAVAILABLE`. */
  reserveSlot(trx: Trx, input: { bookingId: string; slotId: string; offerId: string; minStart: Date }): Promise<boolean>;
  releaseSlot(trx: Trx, bookingId: string): Promise<boolean>;
  /** Ids das ofertas ativas de um profissional `APPROVED`; `null` se não existe ou não está `APPROVED`. */
  listApprovedOfferIds(professionalId: string): Promise<string[] | null>;
  listBookableSlots(professionalId: string, from: Date, to: Date): Promise<{ id: string; offerId: string; startsAt: Date; endsAt: Date }[]>;
  /** ÚNICA via por que `paymentInstructions` sai de `professionals` (BR-MKT-26/56). */
  readPaymentInstructions(professionalId: string): Promise<string | null>;
  findIdentities(ids: readonly string[]): Promise<ProfessionalIdentity[]>;
  findSpecialties(ids: readonly string[]): Promise<{ id: string; name: string; category: SpecialtyCategory }[]>;
}

/** BR-MKT-62: mesma pessoa (e-mail normalizado) entre o profissional e o utilizador; nunca revela o e-mail de ninguém. */
export interface SelfDealingGuard {
  isSamePerson(professionalId: string, userId: string): Promise<boolean>;
}

export interface ProcessActor {
  actorType: "USER";
  actorUserId: string;
  requestId: string;
  ip?: string;
  userAgent?: string;
}

/** `Process` `BOOKING` aberto NA transação da marcação (idempotente por `(BOOKING, bookingId)`). */
export interface ProcessLinker<Trx> {
  open(trx: Trx, input: { familyId: string; memberId: string; originType: "BOOKING"; originId: string; by: ProcessActor }): Promise<{ processId: string }>;
}

/** Consulta gerada no registo do membro (implementada por `appointments`). */
export interface FamilyAppointmentWriter<Trx> {
  createFromBooking(
    trx: Trx,
    input: { bookingId: string; processId: string; familyId: string; memberId: string; startsAt: Date; professionalName: string; specialty: string; durationMinutes?: number },
  ): Promise<{ appointmentId: string }>;
  syncFromBooking(trx: Trx, input: { bookingId: string; status: "COMPLETED" | "NO_SHOW" | "CANCELLED" }): Promise<void>;
  findAppointmentIds(trx: Trx, bookingIds: string[]): Promise<Map<string, string>>;
}

/** Conversa do par (membro, profissional), se existir (derivada, OP-106; implementada por `messaging`). */
export interface ConversationLookup<Trx> {
  findConversationIds(trx: Trx, familyId: string, memberId: string, professionalIds: string[]): Promise<Map<string, string>>;
}

export interface BookingRecord {
  id: string;
  familyId: string;
  memberId: string;
  professionalId: string;
  offerId: string;
  specialtyId: string;
  method: OfferMethod;
  durationMinutes: number;
  priceKz: number;
  startsAt: Date;
  endsAt: Date;
  slotId: string | null;
  status: BookingStatus;
  paymentStatus: BookingPaymentStatus;
  participantLabel: string;
  statusReason: string | null;
  cancelledBy: BookingCancelledBy | null;
  systemReason: BookingSystemReason | null;
  confirmedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  meetingInfo: string | null;
  processId: string | null;
  createdByUserId: string | null;
  clientRequestId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BookingListFilter {
  status?: BookingStatus;
  limit: number;
  /** Mantém só as que vêm DEPOIS (ordem `startsAt DESC, id DESC`). */
  after?: { startsAt: Date; id: string };
}

export interface BookingCancellation {
  cancelledBy: BookingCancelledBy;
  at: Date;
  statusReason: string | null;
}

export interface BookingRepository<Trx> {
  /** Serializa por chave (bloqueio consultivo transacional), adquirido por ordem de chave. */
  acquireLocks(trx: Trx, keys: readonly string[]): Promise<void>;
  /** Procurada SEMPRE por (família, membro, id): outra ⇒ `null` (BR-MKT-50). `forUpdate` bloqueia a linha. */
  findForFamily(trx: Trx, familyId: string, memberId: string, bookingId: string, forUpdate: boolean): Promise<BookingRecord | null>;
  findByClientRequestId(trx: Trx, memberId: string, clientRequestId: string): Promise<BookingRecord | null>;
  listForMember(trx: Trx, familyId: string, memberId: string, filter: BookingListFilter): Promise<BookingRecord[]>;
  /** Marcações `REQUESTED`/`CONFIRMED` do membro (para limite de 10 e sobreposição). */
  listActiveForMember(trx: Trx, memberId: string): Promise<{ startsAt: Date; endsAt: Date }[]>;
  /** Instantes das criações deste utilizador desde `since` (limite diário). */
  createTimesByUser(trx: Trx, userId: string, since: Date): Promise<Date[]>;
  /** Insere; a exclusão de sobreposição do membro (BD) ⇒ `ConflictError`. */
  insert(trx: Trx, record: BookingRecord): Promise<void>;
  /** `status = CANCELLED` com quem/quando/nota; liberta `slot_id` (a libertação do horário é da porta `ProfessionalAgenda`). */
  markCancelled(trx: Trx, bookingId: string, change: BookingCancellation): Promise<void>;
  /** Marcações que já têm avaliação (para `hasReview`/`REVIEW_DUE`). */
  bookingIdsWithReview(trx: Trx, bookingIds: string[]): Promise<Set<string>>;
  /** Factos de `Process` (`phase`/`hint`) das marcações da família. */
  findStateRows(trx: Trx, familyId: string, bookingIds: string[]): Promise<{ id: string; status: BookingStatus; paymentStatus: BookingPaymentStatus; startsAt: Date; completedAt: Date | null; updatedAt: Date; hasReview: boolean }[]>;
}

/** Tudo o que os casos de uso precisam (ligado em `index.ts`). */
export interface ConsultationsDeps<Trx> {
  withTransaction: WithTransaction<Trx>;
  clock: ConsultationsClock;
  audit: AuditPort<Trx>;
  access: BookingAccess<Trx>;
  agenda: ProfessionalAgenda<Trx>;
  selfDealing: SelfDealingGuard;
  processes: ProcessLinker<Trx>;
  appointments: FamilyAppointmentWriter<Trx>;
  conversations: ConversationLookup<Trx>;
  bookings: BookingRepository<Trx>;
}

export type { BookingHint, BookingPhase };
