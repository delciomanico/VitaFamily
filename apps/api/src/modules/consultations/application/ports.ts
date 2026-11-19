// Portas da `application` de `consultations` (ADR-016; modules.md nota 37). `consultations` NÃO importa `auth`, `access`, `families`,
// `users`, `professionals`, `appointments`, `processes`, `alerts`, `notifications`, `messaging`, `discovery`, `admin`, `lifecycle` nem
// módulos de saúde: tudo o que vem de fora entra por estas portas, ligadas em `main/api.ts`. Só `audit` e `platform`.
// Texto livre (rótulo, notas, motivos, ligação) nunca sai por estas portas para logs, auditoria nem alertas (BR-MKT-63).
import type { Readable } from "node:stream";
import type { AuditEvent } from "../../audit/index.js";
import type { BookingCancelledBy, BookingPaymentStatus, BookingStatus, BookingSystemReason } from "../domain/booking.js";
import type { ProofStatus } from "../domain/payment.js";
import type { BookingHint, BookingPhase } from "../domain/projection.js";
import type { ReviewRepository } from "./review-ports.js";

export interface ConsultationsClock {
  now(): Date;
}

export interface ActorIdentity {
  userId: string;
  platformAdmin: boolean;
}

/** Ator do portal do profissional (token de `ProfessionalAccount`); o estado de validação NÃO vem do token (lê-se por pedido). */
export interface ProfessionalActor {
  professionalId: string;
  professionalAccountId: string;
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

export interface ProfessionalBookingListFilter {
  statuses: BookingStatus[];
  from?: Date;
  to?: Date;
  limit: number;
  /** Mantém só as que vêm DEPOIS (ordem `startsAt ASC, id ASC`). */
  after?: { startsAt: Date; id: string };
}

export interface BookingCancellation {
  cancelledBy: BookingCancelledBy;
  /** Só com `cancelledBy = SYSTEM` (job `reconcile-bookings`). */
  systemReason?: BookingSystemReason;
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
  /** Lado do PROFISSIONAL: procurada SEMPRE por (`professionalId` do token, id); de outro ⇒ `null`. */
  findForProfessional(trx: Trx, professionalId: string, bookingId: string, forUpdate: boolean): Promise<BookingRecord | null>;
  /** Ordem `startsAt ASC, id ASC`; `from`/`to` sobre `startsAt` (`from` inclusive, `to` exclusive); `statuses` vazio = todos. */
  listForProfessional(trx: Trx, professionalId: string, filter: ProfessionalBookingListFilter): Promise<BookingRecord[]>;
  /** `REQUESTED → CONFIRMED` (grava `confirmed_at` e a ligação/número). */
  markConfirmed(trx: Trx, bookingId: string, change: { at: Date; meetingInfo: string | null }): Promise<void>;
  /** `REQUESTED → REJECTED` com o motivo; liberta `slot_id` (a libertação do horário é da porta `ProfessionalAgenda`). */
  markRejected(trx: Trx, bookingId: string, change: { at: Date; reason: string }): Promise<void>;
  /** `CONFIRMED → COMPLETED | NO_SHOW` (`completed_at` só em `COMPLETED`). */
  markFinished(trx: Trx, bookingId: string, change: { status: "COMPLETED" | "NO_SHOW"; at: Date }): Promise<void>;
  /** Candidatas do job `reconcile-bookings` (BR-MKT-54): `REQUESTED`/`CONFIRMED` ainda por começar e `REQUESTED` já vencidas; ordem `starts_at ASC, id ASC`; sem bloqueio. */
  listReconcileCandidates(trx: Trx, now: Date, limit: number, after?: { startsAt: Date; id: string }): Promise<BookingRecord[]>;
  /** Marcações que já têm avaliação (para `hasReview`/`REVIEW_DUE`). */
  bookingIdsWithReview(trx: Trx, bookingIds: string[]): Promise<Set<string>>;
  /** Por id (jobs/admin, sem contexto de família); `forUpdate` bloqueia a linha. */
  findById(trx: Trx, bookingId: string, forUpdate: boolean): Promise<BookingRecord | null>;
  /** `payment_status` da marcação (a marcação já está bloqueada pelo chamador). */
  setPaymentStatus(trx: Trx, bookingId: string, paymentStatus: BookingPaymentStatus, at: Date): Promise<void>;
  /** Factos de `Process` (`phase`/`hint`) das marcações da família. */
  findStateRows(trx: Trx, familyId: string, bookingIds: string[]): Promise<{ id: string; status: BookingStatus; paymentStatus: BookingPaymentStatus; startsAt: Date; completedAt: Date | null; updatedAt: Date; hasReview: boolean }[]>;
}

export type ProofScanStatus = "PENDING" | "CLEAN" | "INFECTED";
export type ProofDisputeDecision = "CONFIRM_PAYMENT" | "UPHOLD_REJECTION";

/** Comprovativo de pagamento (BR-MKT-57/58). `storageKey` NUNCA sai da `application` para as vistas. */
export interface ProofRecord {
  id: string;
  bookingId: string;
  uploadedByUserId: string | null;
  storageKey: string;
  contentType: "application/pdf" | "image/jpeg" | "image/png";
  sizeBytes: number;
  scanStatus: ProofScanStatus;
  scannedAt: Date | null;
  status: ProofStatus;
  decidedAt: Date | null;
  decisionReason: string | null;
  disputedAt: Date | null;
  disputeNote: string | null;
  disputeDecision: ProofDisputeDecision | null;
  disputeDecidedAt: Date | null;
  purgedAt: Date | null;
  createdAt: Date;
}

export interface ProofRepository<Trx> {
  insert(trx: Trx, record: ProofRecord): Promise<void>;
  /** Procurado SEMPRE por (marcação, id); `forUpdate` bloqueia a linha. */
  findForBooking(trx: Trx, bookingId: string, proofId: string, forUpdate: boolean): Promise<ProofRecord | null>;
  /** Mais recentes primeiro. */
  listForBooking(trx: Trx, bookingId: string): Promise<ProofRecord[]>;
  /** O comprovativo mais recente de cada marcação (para a vista do profissional). */
  latestForBookings(trx: Trx, bookingIds: string[]): Promise<Map<string, ProofRecord>>;
  /** Job de antivírus: por id, SEM bloqueio (para saber a marcação e bloqueá-la primeiro: ordem marcação < comprovativo). */
  findForScan(trx: Trx, proofId: string): Promise<ProofRecord | null>;
  markClean(trx: Trx, proofId: string, storageKey: string, at: Date): Promise<void>;
  /** Infetado conta como NÃO enviado (BR-MKT-57): a linha apaga-se (o trigger de BD enfileira o ficheiro na outbox). */
  deleteProof(trx: Trx, proofId: string): Promise<void>;
  markDecided(trx: Trx, proofId: string, change: { status: "CONFIRMED" | "REJECTED"; at: Date; reason: string | null }): Promise<void>;
  /** Comprovativos `PENDING` criados antes de `before` (job `requeue-pending-proofs`, OP-114 iii); mais antigos primeiro. */
  listPendingBefore(trx: Trx, before: Date, limit: number): Promise<string[]>;
  /** `REJECTED → DISPUTED` (uma vez por comprovativo). */
  markDisputed(trx: Trx, proofId: string, change: { at: Date; note: string | null }): Promise<void>;
  /** Decisão do admin: `CONFIRM_PAYMENT` ⇒ `CONFIRMED`; `UPHOLD_REJECTION` ⇒ `REJECTION_UPHELD`. */
  markDisputeDecided(trx: Trx, proofId: string, change: { decision: ProofDisputeDecision; at: Date; decidedBy: string }): Promise<void>;
  /** Fila do admin: só comprovativos com disputa; `DISPUTED` (por decidir) ou `DECIDED`; `disputed_at ASC, id ASC`. */
  listDisputes(trx: Trx, filter: DisputeListFilter): Promise<DisputeRow[]>;
  /** Disputa (com a marcação) por id do comprovativo; `null` se nunca foi disputado. NÃO bloqueia. */
  findDispute(trx: Trx, proofId: string): Promise<DisputeRow | null>;
}

export interface DisputeListFilter {
  status: "DISPUTED" | "DECIDED";
  limit: number;
  after?: { disputedAt: Date; id: string };
}

/** Comprovativo disputado com os factos da marcação que o admin pode ver (BR-MKT-63): NUNCA família, membro nem rótulo. */
export interface DisputeRow {
  proof: ProofRecord;
  booking: { id: string; professionalId: string; specialtyId: string; method: OfferMethod; durationMinutes: number; startsAt: Date; priceKz: number; status: BookingStatus; paymentStatus: BookingPaymentStatus };
}

export interface FileDeletionRepository<Trx> {
  enqueue(trx: Trx, storageKey: string): Promise<void>;
  listPending(trx: Trx, limit: number, maxAttempts: number): Promise<{ id: string; storageKey: string }[]>;
  markDeleted(trx: Trx, id: string, now: Date): Promise<void>;
  recordFailure(trx: Trx, id: string): Promise<void>;
}

/** Armazenamento dos comprovativos (quarentena → final), sobre `Storage` (OP-99: infraestrutura própria, sem `documents`). */
export interface ProofFileStore {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Readable>;
  copy(sourceKey: string, destKey: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Antivírus (ClamAV INSTREAM na `infrastructure`). */
export interface ProofScanner {
  scan(buffer: Buffer): Promise<"CLEAN" | "INFECTED">;
}

/** Fila `consultations.scan-proof` (pg-boss na `infrastructure`). */
export interface ProofScanQueue {
  enqueueScan(job: { proofId: string }): Promise<void>;
}

/** Dependências dos jobs de ficheiros (processo worker): sem portas de família/profissional. */
export interface ProcessorFileDeps<Trx> {
  withTransaction: WithTransaction<Trx>;
  clock: ConsultationsClock;
  bookings: BookingRepository<Trx>;
  proofs: ProofRepository<Trx>;
  fileDeletions: FileDeletionRepository<Trx>;
  fileStore: ProofFileStore;
  scanner: ProofScanner;
}

/** Tudo o que os casos de uso precisam (ligado em `index.ts`). */
export type FamilyAlertKind = "BOOKING_UPDATED" | "PAYMENT_UPDATED";

/** Alerta à família (BR-MKT-65), criado NA transação da mudança (implementada sobre `alerts` em `main/`); genérico, sem dados da marcação. */
export interface BookingAlerts<Trx> {
  raise(trx: Trx, input: { kind: FamilyAlertKind; bookingId: string; familyId: string; memberId: string; stateVersion: string }): Promise<void>;
}

export type ProfessionalNoticeEvent = "BOOKING_REQUESTED" | "BOOKING_CANCELLED" | "PROOF_UPLOADED" | "DISPUTE_OPENED" | "DISPUTE_DECIDED" | "REVIEW_CREATED";

/** Fila do aviso GENÉRICO por e-mail ao profissional (job `consultations.notify-professional`); chamada DEPOIS do commit, melhor esforço. */
export interface ProfessionalNotices {
  enqueue(input: { professionalId: string; bookingId: string; event: ProfessionalNoticeEvent }): Promise<void>;
}

/** E-mail da conta do profissional, SÓ para o aviso genérico (BR-MKT-65); ligada em `main/` à raiz `professionals`. */
export interface ProfessionalContact {
  getNotificationEmail(professionalId: string): Promise<string | null>;
}

/** Texto FIXO («Tem uma atualização no Vita»), sem conteúdo, nomes nem ids. */
export interface ProfessionalMailer {
  sendNotice(to: string): Promise<void>;
}

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
  alerts: BookingAlerts<Trx>;
  notices: ProfessionalNotices;
  bookings: BookingRepository<Trx>;
  proofs: ProofRepository<Trx>;
  reviews: ReviewRepository<Trx>;
  fileStore: ProofFileStore;
  scanQueue: ProofScanQueue;
}

export type { BookingHint, BookingPhase };
