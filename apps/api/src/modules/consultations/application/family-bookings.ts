// Casos de uso do lado da FAMÍLIA (UC-MKT-26..29; BR-MKT-50..53, 55, 62, 65, 66). Todos (exceto a consulta de horários públicos) começam
// por `BookingAccess.assertCanBook` (ação `BOOK_PROFESSIONALS`: só `SELF`/`TUTOR_OF`) e procuram a marcação por (família, membro, id):
// qualquer outra ⇒ `NOT_FOUND` sem enumeração.
// Concorrência: a criação serializa-se por bloqueio consultivo do membro (limites, sobreposição e `clientRequestId` sem corridas; a BD tem
// `EXCLUDE` e UNIQUE como rede) e a posse do horário decide-se por UM `UPDATE` condicional (`ProfessionalAgenda.reserveSlot`); a
// marcação, a reserva e o `Process` partilham a transação (falha ⇒ nada existe). Ordem dos bloqueios: consultivo do membro < slot <
// linha da marcação; o cancelamento bloqueia a marcação e depois liberta o horário (sem ciclo).
// Privacidade (BR-MKT-63): erros e auditoria nunca levam rótulo, nota, ligação, preço nem horário; os erros de validação só nomeiam o campo.
import { sendProfessionalNotice } from "./notices.js";
import { ConflictError, DomainError, NotFoundError, RateLimitedError, ValidationError } from "../../../platform/errors/index.js";
import { newId } from "../../../platform/ids/index.js";
import { auditContextFields } from "../../audit/index.js";
import { BOOKING_LIMITS, checkBookingAction, checkBookingLead, initialPaymentStatus, intervalsOverlap } from "../domain/booking.js";
import { TEXT_LIMITS, validateOptionalFreeText, validateParticipantLabel, type TextError } from "../domain/text.js";
import { decodeBookingCursor, encodeBookingCursor } from "./cursor.js";
import type { ActorIdentity, BookingRecord, ConsultationsDeps, RequestContext } from "./ports.js";
import { SlidingWindowLimiter } from "./rate-limiter.js";
import { toFamilyBookingView, type FamilyBookingView } from "./views.js";

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface CreateBookingInput {
  offerId: string;
  slotId: string;
  participantLabel: string;
  clientRequestId?: string;
}

export interface BookableSlotView {
  id: string;
  offerId: string;
  startsAt: string;
  endsAt: string;
}

const DAY_MS = 86_400_000;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const DEFAULT_SLOT_WINDOW_MS = 14 * DAY_MS;
const MAX_SLOT_WINDOW_MS = 62 * DAY_MS;
const FIELD_ERRORS: Record<TextError, string> = { EMPTY: "não pode ser vazio", TOO_LONG: "excede o tamanho máximo", CONTROL_CHARACTER: "contém caracteres de controlo" };

const invalid = (field: string, message: string): ValidationError => new ValidationError([{ field, message }], { detail: "Dados inválidos." });

export function createFamilyBookings<Trx>(deps: ConsultationsDeps<Trx>) {
  const now = (): Date => deps.clock.now();
  const slotLimiter = new SlidingWindowLimiter(deps.clock, 60, 60_000);
  setInterval(() => {
    slotLimiter.prune();
  }, 10 * 60_000).unref();

  async function authorize(trx: Trx, actor: ActorIdentity, familyId: string, memberId: string): Promise<void> {
    await deps.access.assertCanBook(trx, { userId: actor.userId, platformAdmin: actor.platformAdmin, familyId, memberId });
  }

  /** Junta profissional, especialidade, consulta gerada, conversa e avaliação em lote (sem N+1). */
  async function present(trx: Trx, records: BookingRecord[], withInstructions: boolean): Promise<FamilyBookingView[]> {
    if (records.length === 0) return [];
    const at = now();
    const professionalIds = [...new Set(records.map((r) => r.professionalId))];
    const [identities, specialties, appointmentIds, conversationIds, reviewed] = await Promise.all([
      deps.agenda.findIdentities(professionalIds),
      deps.agenda.findSpecialties([...new Set(records.map((r) => r.specialtyId))]),
      deps.appointments.findAppointmentIds(trx, records.map((r) => r.id)),
      // O par é (membro, profissional): as marcações da lista são todas do mesmo membro.
      deps.conversations.findConversationIds(trx, records[0]?.familyId ?? "", records[0]?.memberId ?? "", professionalIds),
      deps.bookings.bookingIdsWithReview(trx, records.map((r) => r.id)),
    ]);
    const views: FamilyBookingView[] = [];
    for (const record of records) {
      const identity = identities.find((i) => i.id === record.professionalId);
      const specialty = specialties.find((s) => s.id === record.specialtyId);
      views.push(
        toFamilyBookingView(record, {
          now: at,
          professional: identity ? { displayName: identity.displayName, city: identity.city } : undefined,
          specialty: specialty ? { name: specialty.name, category: specialty.category } : undefined,
          appointmentId: appointmentIds.get(record.id) ?? null,
          conversationId: conversationIds.get(record.professionalId) ?? null,
          hasReview: reviewed.has(record.id),
          paymentInstructions: withInstructions ? await deps.agenda.readPaymentInstructions(record.professionalId) : null,
        }),
      );
    }
    return views;
  }

  return {
    /** UC-MKT-26: horários futuros LIVRES de uma oferta ativa de um profissional `APPROVED` (dados públicos; sem `AccessPolicy`). */
    async listBookableSlots(actor: ActorIdentity, professionalId: string, query: { offerId: string; from?: Date; to?: Date }): Promise<BookableSlotView[]> {
      const wait = slotLimiter.hit(actor.userId);
      if (wait !== null) throw new RateLimitedError(wait);
      const at = now();
      const from = query.from ?? at;
      const to = query.to ?? new Date(from.getTime() + DEFAULT_SLOT_WINDOW_MS);
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to.getTime() <= from.getTime() || to.getTime() - from.getTime() > MAX_SLOT_WINDOW_MS) {
        throw invalid("to", "intervalo inválido (to > from, máx. 62 dias)");
      }
      const offerIds = await deps.agenda.listApprovedOfferIds(professionalId);
      // Profissional inexistente/não APPROVED ou oferta alheia/inativa ⇒ o mesmo 404 (sem distinguir).
      if (!offerIds?.includes(query.offerId)) throw new NotFoundError({ detail: "Profissional ou oferta não encontrados." });
      const slots = await deps.agenda.listBookableSlots(professionalId, from, to);
      return slots.filter((s) => s.offerId === query.offerId).map((s) => ({ id: s.id, offerId: s.offerId, startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString() }));
    },

    /** UC-MKT-27: cria a marcação numa só transação (ver cabeçalho). Devolve `created=false` se `clientRequestId` repetido. */
    async createBooking(actor: ActorIdentity, familyId: string, memberId: string, input: CreateBookingInput, context: RequestContext): Promise<{ created: boolean; booking: FamilyBookingView }> {
      const result = await deps.withTransaction(async (trx) => {
        await authorize(trx, actor, familyId, memberId);
        const label = validateParticipantLabel(input.participantLabel);
        if (!label.ok) throw invalid("participantLabel", FIELD_ERRORS[label.error]);

        await deps.bookings.acquireLocks(trx, [`booking-create:${memberId}`]);
        if (input.clientRequestId) {
          const replay = await deps.bookings.findByClientRequestId(trx, memberId, input.clientRequestId);
          if (replay) return { created: false, record: replay };
        }

        // (2) factos lidos agora; profissional/oferta/horário inexistentes ou não APPROVED ⇒ 404 indistinguíveis.
        const facts = await deps.agenda.getBookingFacts(input.offerId, input.slotId);
        const slot = facts?.slot;
        if (!facts || !slot) throw new NotFoundError({ detail: "Profissional, oferta ou horário não encontrados." });
        // (1) BR-MKT-62 (divergência reportada ao proprietário: aplicada depois de os factos confirmarem profissional APPROVED, para não distinguir contas não aprovadas): nunca com o próprio profissional (mesmo e-mail); resposta genérica, sem revelar e-mails.
        if (await deps.selfDealing.isSamePerson(facts.professionalId, actor.userId)) throw new DomainError("SELF_BOOKING_NOT_ALLOWED", { detail: "Não pode marcar uma consulta consigo próprio." });
        if (slot.offerId !== facts.offer.id) throw invalid("slotId", "o horário não pertence à oferta");

        // (3) antecedência e janela.
        const at = now();
        const lead = checkBookingLead(slot.startsAt.getTime(), at.getTime());
        if (lead === "TOO_SOON") throw invalid("slotId", "antecedência mínima de 2 horas");
        if (lead === "TOO_FAR") throw invalid("slotId", "fora da janela de 8 semanas");

        // (4) limites e sobreposição do membro (sob o bloqueio do membro; a BD é a rede).
        const active = await deps.bookings.listActiveForMember(trx, memberId);
        if (active.some((a) => intervalsOverlap(a.startsAt.getTime(), a.endsAt.getTime(), slot.startsAt.getTime(), slot.endsAt.getTime()))) {
          throw new ConflictError({ detail: "O membro já tem uma marcação nesse período." });
        }
        if (active.length >= BOOKING_LIMITS.maxActivePerMember) throw new DomainError("LIMIT_EXCEEDED", { detail: `Máximo de ${String(BOOKING_LIMITS.maxActivePerMember)} marcações ativas por membro.` });
        const recent = (await deps.bookings.createTimesByUser(trx, actor.userId, new Date(at.getTime() - DAY_MS))).map((d) => d.getTime()).sort((a, b) => a - b);
        if (recent.length >= BOOKING_LIMITS.maxCreatesPerDay) throw new RateLimitedError(Math.max(1, (recent[recent.length - BOOKING_LIMITS.maxCreatesPerDay] ?? at.getTime()) + DAY_MS - at.getTime()));

        // (5) reserva atómica do horário (perdida ⇒ SLOT_UNAVAILABLE; sem revelar quem o ocupou).
        const bookingId = newId();
        const reserved = await deps.agenda.reserveSlot(trx, { bookingId, slotId: slot.id, offerId: facts.offer.id, minStart: new Date(at.getTime() + BOOKING_LIMITS.minLeadMs) });
        if (!reserved) throw new DomainError("SLOT_UNAVAILABLE", { detail: "Este horário já não está disponível." });

        // (7) Process BOOKING na mesma transação; (6) marcação com cópia do preço e da oferta.
        const { processId } = await deps.processes.open(trx, {
          familyId,
          memberId,
          originType: "BOOKING",
          originId: bookingId,
          by: { actorType: "USER", actorUserId: actor.userId, requestId: context.requestId, ...auditContextFields(context) },
        });
        const record: BookingRecord = {
          id: bookingId,
          familyId,
          memberId,
          professionalId: facts.professionalId,
          offerId: facts.offer.id,
          specialtyId: facts.offer.specialtyId,
          method: facts.offer.method,
          durationMinutes: facts.offer.durationMinutes,
          priceKz: facts.offer.priceKz,
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          slotId: slot.id,
          status: "REQUESTED",
          paymentStatus: initialPaymentStatus(facts.offer.priceKz),
          participantLabel: label.text,
          statusReason: null,
          cancelledBy: null,
          systemReason: null,
          confirmedAt: null,
          completedAt: null,
          cancelledAt: null,
          meetingInfo: null,
          processId,
          createdByUserId: actor.userId,
          clientRequestId: input.clientRequestId ?? null,
          createdAt: at,
          updatedAt: at,
        };
        await deps.bookings.insert(trx, record);
        await deps.audit.record(trx, {
          occurredAt: at,
          actorType: "USER",
          actorUserId: actor.userId,
          action: "BOOKING_CREATE",
          resourceType: "Booking",
          resourceId: bookingId,
          familyId,
          subjectMemberId: memberId,
          result: "SUCCESS",
          requestId: context.requestId,
          metadata: { professionalId: facts.professionalId, method: facts.offer.method },
          ...auditContextFields(context),
        });
        // (8) o aviso ao profissional (e-mail genérico por fila) enfileira-se depois do commit (abaixo).
        return { created: true, record };
      });
      if (result.created) await sendProfessionalNotice(deps.notices, { professionalId: result.record.professionalId, bookingId: result.record.id, event: "BOOKING_REQUESTED" });
      const [booking] = await deps.withTransaction((trx) => present(trx, [result.record], false));
      if (!booking) throw new NotFoundError({ detail: "Marcação não encontrada." });
      return { created: result.created, booking };
    },

    /** UC-MKT-28: marcações do membro, `startsAt` desc; não auditado. */
    async listBookings(actor: ActorIdentity, familyId: string, memberId: string, query: { status?: BookingRecord["status"]; limit?: number; cursor?: string }): Promise<Page<FamilyBookingView>> {
      const limit = query.limit ?? DEFAULT_LIMIT;
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new DomainError("MALFORMED_REQUEST", { detail: "Limite inválido." });
      const after = query.cursor === undefined ? undefined : decodeBookingCursor(query.cursor);
      return deps.withTransaction(async (trx) => {
        await authorize(trx, actor, familyId, memberId);
        const rows = await deps.bookings.listForMember(trx, familyId, memberId, { limit: limit + 1, ...(query.status ? { status: query.status } : {}), ...(after ? { after } : {}) });
        const page = rows.slice(0, limit);
        const last = page.at(-1);
        return { items: await present(trx, page, false), nextCursor: rows.length > limit && last ? encodeBookingCursor(last.startsAt, last.id) : null };
      });
    },

    /** UC-MKT-28: detalhe (acrescenta as instruções de pagamento se o estado o permitir); não auditado. */
    async getBooking(actor: ActorIdentity, familyId: string, memberId: string, bookingId: string): Promise<FamilyBookingView> {
      return deps.withTransaction(async (trx) => {
        await authorize(trx, actor, familyId, memberId);
        const record = await deps.bookings.findForFamily(trx, familyId, memberId, bookingId, false);
        if (!record) throw new NotFoundError({ detail: "Marcação não encontrada." });
        const [view] = await present(trx, [record], true);
        if (!view) throw new NotFoundError({ detail: "Marcação não encontrada." });
        return view;
      });
    },

    /** UC-MKT-29: cancela `REQUESTED`/`CONFIRMED` antes da hora; liberta o horário e atualiza a consulta gerada. */
    async cancelBooking(actor: ActorIdentity, familyId: string, memberId: string, bookingId: string, input: { note?: string | null }, context: RequestContext): Promise<FamilyBookingView> {
      const note = validateOptionalFreeText(input.note, TEXT_LIMITS.note);
      if (!note.ok) throw invalid("note", FIELD_ERRORS[note.error]);
      let professionalId = "";
      const view = await deps.withTransaction(async (trx) => {
        await authorize(trx, actor, familyId, memberId);
        const current = await deps.bookings.findForFamily(trx, familyId, memberId, bookingId, true);
        if (!current) throw new NotFoundError({ detail: "Marcação não encontrada." });
        professionalId = current.professionalId;
        const at = now();
        const check = checkBookingAction({ status: current.status, startsAtMs: current.startsAt.getTime() }, "CANCEL_BY_FAMILY", at.getTime());
        if (!check.ok) throw new DomainError("INVALID_STATE_TRANSITION", { detail: "A marcação já não pode ser cancelada." });
        await deps.bookings.markCancelled(trx, current.id, { cancelledBy: "FAMILY", at, statusReason: note.text });
        await deps.agenda.releaseSlot(trx, current.id);
        await deps.appointments.syncFromBooking(trx, { bookingId: current.id, status: "CANCELLED" });
        await deps.audit.record(trx, {
          occurredAt: at,
          actorType: "USER",
          actorUserId: actor.userId,
          action: "BOOKING_CANCEL",
          resourceType: "Booking",
          resourceId: current.id,
          familyId,
          subjectMemberId: memberId,
          result: "SUCCESS",
          requestId: context.requestId,
          metadata: { fromStatus: current.status },
          ...auditContextFields(context),
        });
        const updated = await deps.bookings.findForFamily(trx, familyId, memberId, current.id, false);
        const [view] = await present(trx, updated ? [updated] : [], false);
        if (!view) throw new NotFoundError({ detail: "Marcação não encontrada." });
        return view;
      });
      await sendProfessionalNotice(deps.notices, { professionalId, bookingId, event: "BOOKING_CANCELLED" });
      return view;
    },
  };
}

export type FamilyBookings = ReturnType<typeof createFamilyBookings<unknown>>;
