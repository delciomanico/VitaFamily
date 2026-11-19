// Casos de uso do lado do PROFISSIONAL (UC-MKT-30..33; BR-MKT-50, 52, 53, 54, 55, 63, 65). A marcação procura-se SEMPRE por
// (`professionalId` do token, id): de outro profissional ou inexistente ⇒ `NOT_FOUND` idêntico (antes de qualquer outro erro). Leituras em
// qualquer estado de validação; confirmar/recusar/cancelar/concluir/falta só `APPROVED` (lido AGORA, sem cache; senão `PROFESSIONAL_LOCKED`).
// Transições: `checkBookingAction` (estado e regra horária) sob `FOR UPDATE` da marcação; os efeitos (libertar o horário, criar/atualizar a
// consulta gerada) correm NA mesma transação. Ordem dos bloqueios: linha da marcação < slot (como o cancelamento da família).
// Privacidade (BR-MKT-63): nunca ids de família/membro/utilizador nas vistas, nem texto livre (motivo, ligação) em erros e auditoria; a
// auditoria do profissional não leva `family_id`/`subject_member_id`.
import { DomainError, NotFoundError, ValidationError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import type { AuditEvent } from "../../audit/index.js";
import { checkBookingAction, isRequestExpired, meetingInfoRequired, transitionEffects, type BookingAction, type BookingStatus } from "../domain/booking.js";
import { TEXT_LIMITS, validateOptionalFreeText, validateRequiredFreeText, type TextError } from "../domain/text.js";
import { decodeBookingCursor, encodeBookingCursor } from "./cursor.js";
import type { BookingRecord, ConsultationsDeps, ProfessionalActor, RequestContext } from "./ports.js";
import { toProofView } from "./proof-views.js";
import { toProfessionalBookingView, type ProfessionalBookingView } from "./professional-views.js";

export interface ProfessionalPage<T> {
  items: T[];
  nextCursor: string | null;
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const FIELD_ERRORS: Record<TextError, string> = { EMPTY: "não pode ser vazio", TOO_LONG: "excede o tamanho máximo", CONTROL_CHARACTER: "contém caracteres de controlo" };
const invalid = (field: string, message: string): ValidationError => new ValidationError([{ field, message }], { detail: "Dados inválidos." });

export function createProfessionalBookings<Trx>(deps: ConsultationsDeps<Trx>) {
  const now = (): Date => deps.clock.now();

  async function present(trx: Trx, records: BookingRecord[]): Promise<ProfessionalBookingView[]> {
    if (records.length === 0) return [];
    const specialties = await deps.agenda.findSpecialties([...new Set(records.map((r) => r.specialtyId))]);
    const latestProofs = await deps.proofs.latestForBookings(trx, records.map((r) => r.id));
    const views: ProfessionalBookingView[] = [];
    for (const record of records) {
      // O profissional vê o id da conversa do par, nunca o par (família/membro ficam no servidor).
      const conversationId = (await deps.conversations.findConversationIds(trx, record.familyId, record.memberId, [record.professionalId])).get(record.professionalId) ?? null;
      const specialty = specialties.find((s) => s.id === record.specialtyId);
      const latest = latestProofs.get(record.id);
      views.push(toProfessionalBookingView(record, { specialty: specialty ? { name: specialty.name, category: specialty.category } : undefined, conversationId, proof: latest ? toProofView(latest) : undefined }));
    }
    return views;
  }

  async function load(trx: Trx, actor: ProfessionalActor, bookingId: string, forUpdate: boolean): Promise<BookingRecord> {
    const record = await deps.bookings.findForProfessional(trx, actor.professionalId, bookingId, forUpdate);
    if (!record) throw new NotFoundError({ detail: "Marcação não encontrada." });
    return record;
  }

  async function assertApproved(actor: ProfessionalActor): Promise<void> {
    const identity = (await deps.agenda.findIdentities([actor.professionalId]))[0];
    if (!identity?.approved) throw new DomainError("PROFESSIONAL_LOCKED", { detail: "O seu perfil não está aprovado: só pode consultar as marcações." });
  }

  function audit(trx: Trx, actor: ProfessionalActor, context: RequestContext, action: AuditEvent["action"], bookingId: string, at: Date, from: BookingStatus, to: BookingStatus): Promise<void> {
    return deps.audit.record(trx, {
      occurredAt: at,
      actorType: "PROFESSIONAL_ACCOUNT",
      actorProfessionalAccountId: actor.professionalAccountId,
      action,
      resourceType: "Booking",
      resourceId: bookingId,
      result: "SUCCESS",
      requestId: context.requestId,
      metadata: { fromStatus: from, toStatus: to },
      ...auditContextFields(context),
    });
  }

  function transition(current: BookingRecord, action: BookingAction, at: Date): BookingStatus {
    const check = checkBookingAction({ status: current.status, startsAtMs: current.startsAt.getTime() }, action, at.getTime());
    if (!check.ok) throw new DomainError("INVALID_STATE_TRANSITION", { detail: "A marcação não pode mudar para esse estado agora." });
    // UC-MKT-31: um pedido expirado (48 h sem resposta ou hora já passada) já não se confirma nem recusa (o job `reconcile-bookings` cancela-o).
    if ((action === "CONFIRM" || action === "REJECT") && isRequestExpired({ status: current.status, createdAtMs: current.createdAt.getTime(), startsAtMs: current.startsAt.getTime() }, at.getTime())) {
      throw new DomainError("INVALID_STATE_TRANSITION", { detail: "O pedido expirou." });
    }
    return check.to;
  }

  /** Efeitos comuns da transição (BR-MKT-53/55): liberta o horário e sincroniza a consulta gerada. */
  async function applyEffects(trx: Trx, current: BookingRecord, to: BookingStatus): Promise<void> {
    const effects = transitionEffects(to);
    if (effects.releaseSlot) await deps.agenda.releaseSlot(trx, current.id);
    if (effects.updateAppointment && (to === "COMPLETED" || to === "NO_SHOW" || to === "CANCELLED")) await deps.appointments.syncFromBooking(trx, { bookingId: current.id, status: to });
  }

  async function reload(trx: Trx, actor: ProfessionalActor, bookingId: string): Promise<ProfessionalBookingView> {
    const [view] = await present(trx, [await load(trx, actor, bookingId, false)]);
    if (!view) throw new NotFoundError({ detail: "Marcação não encontrada." });
    return view;
  }

  return {
    /** UC-MKT-30: omissão `REQUESTED` e `CONFIRMED` futuras; `startsAt` asc; em qualquer estado de validação. */
    async listBookings(actor: ProfessionalActor, query: { status?: BookingStatus; from?: Date; to?: Date; limit?: number; cursor?: string }): Promise<ProfessionalPage<ProfessionalBookingView>> {
      const limit = query.limit ?? DEFAULT_LIMIT;
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new DomainError("MALFORMED_REQUEST", { detail: "Limite inválido." });
      if ((query.from && Number.isNaN(query.from.getTime())) || (query.to && Number.isNaN(query.to.getTime())) || (query.from && query.to && query.to.getTime() <= query.from.getTime())) {
        // O contrato de `listProfessionalBookings` só documenta 400/401 (sem 422): intervalo inválido ⇒ MALFORMED_REQUEST.
        throw new DomainError("MALFORMED_REQUEST", { detail: "Intervalo inválido." });
      }
      const after = query.cursor === undefined ? undefined : decodeBookingCursor(query.cursor);
      const defaults = query.status === undefined && query.from === undefined && query.to === undefined;
      return deps.withTransaction(async (trx) => {
        const from = defaults ? now() : query.from;
        const rows = await deps.bookings.listForProfessional(trx, actor.professionalId, {
          statuses: defaults ? ["REQUESTED", "CONFIRMED"] : query.status ? [query.status] : [],
          limit: limit + 1,
          ...(from ? { from } : {}),
          ...(query.to ? { to: query.to } : {}),
          ...(after ? { after } : {}),
        });
        const page = rows.slice(0, limit);
        const last = page.at(-1);
        return { items: await present(trx, page), nextCursor: rows.length > limit && last ? encodeBookingCursor(last.startsAt, last.id) : null };
      });
    },

    async getBooking(actor: ProfessionalActor, bookingId: string): Promise<ProfessionalBookingView> {
      return deps.withTransaction((trx) => reload(trx, actor, bookingId));
    },

    /** UC-MKT-31: `REQUESTED → CONFIRMED`; `VIDEO`/`PHONE` exigem `meetingInfo`; cria a consulta no membro na mesma transação. */
    async confirmBooking(actor: ProfessionalActor, bookingId: string, input: { meetingInfo?: string | null }, context: RequestContext): Promise<ProfessionalBookingView> {
      const info = validateOptionalFreeText(input.meetingInfo, TEXT_LIMITS.meetingInfo);
      if (!info.ok) throw invalid("meetingInfo", FIELD_ERRORS[info.error]);
      return deps.withTransaction(async (trx) => {
        const current = await load(trx, actor, bookingId, true);
        await assertApproved(actor);
        const at = now();
        const to = transition(current, "CONFIRM", at);
        if (meetingInfoRequired(current.method) && info.text === null) throw invalid("meetingInfo", "obrigatório em vídeo e telefone");
        await deps.bookings.markConfirmed(trx, current.id, { at, meetingInfo: info.text });
        if (transitionEffects(to).createAppointment && current.processId) {
          const [identity, specialty] = await Promise.all([deps.agenda.findIdentities([current.professionalId]), deps.agenda.findSpecialties([current.specialtyId])]);
          await deps.appointments.createFromBooking(trx, {
            bookingId: current.id,
            processId: current.processId,
            familyId: current.familyId,
            memberId: current.memberId,
            startsAt: current.startsAt,
            professionalName: identity[0]?.displayName ?? "Profissional",
            specialty: specialty[0]?.name ?? "Consulta",
            durationMinutes: current.durationMinutes,
          });
        }
        await audit(trx, actor, context, "PROFESSIONAL_BOOKING_CONFIRM", current.id, at, current.status, to);
        // O alerta `BOOKING_UPDATED` à família liga-se na fatia S11.
        return reload(trx, actor, bookingId);
      });
    },

    /** UC-MKT-31: `REQUESTED → REJECTED` com motivo; liberta o horário. */
    async rejectBooking(actor: ProfessionalActor, bookingId: string, input: { reason: string }, context: RequestContext): Promise<ProfessionalBookingView> {
      const reason = validateRequiredFreeText(input.reason, TEXT_LIMITS.reason);
      if (!reason.ok) throw invalid("reason", FIELD_ERRORS[reason.error]);
      return deps.withTransaction(async (trx) => {
        const current = await load(trx, actor, bookingId, true);
        await assertApproved(actor);
        const at = now();
        const to = transition(current, "REJECT", at);
        await deps.bookings.markRejected(trx, current.id, { at, reason: reason.text });
        await applyEffects(trx, current, to);
        await audit(trx, actor, context, "PROFESSIONAL_BOOKING_REJECT", current.id, at, current.status, to);
        return reload(trx, actor, bookingId);
      });
    },

    /** UC-MKT-32: `REQUESTED`/`CONFIRMED → CANCELLED` antes da hora, com motivo; liberta o horário e atualiza a consulta. */
    async cancelBooking(actor: ProfessionalActor, bookingId: string, input: { reason: string }, context: RequestContext): Promise<ProfessionalBookingView> {
      const reason = validateRequiredFreeText(input.reason, TEXT_LIMITS.reason);
      if (!reason.ok) throw invalid("reason", FIELD_ERRORS[reason.error]);
      return deps.withTransaction(async (trx) => {
        const current = await load(trx, actor, bookingId, true);
        await assertApproved(actor);
        const at = now();
        const to = transition(current, "CANCEL_BY_PROFESSIONAL", at);
        await deps.bookings.markCancelled(trx, current.id, { cancelledBy: "PROFESSIONAL", at, statusReason: reason.text });
        await applyEffects(trx, current, to);
        await audit(trx, actor, context, "PROFESSIONAL_BOOKING_CANCEL", current.id, at, current.status, to);
        return reload(trx, actor, bookingId);
      });
    },

    /** UC-MKT-33: `CONFIRMED → COMPLETED` só com `agora ≥ startsAt`; terminal (OP-108). */
    async completeBooking(actor: ProfessionalActor, bookingId: string, context: RequestContext): Promise<ProfessionalBookingView> {
      return finish(actor, bookingId, "COMPLETE", "COMPLETED", "PROFESSIONAL_BOOKING_COMPLETE", context);
    },

    /** UC-MKT-33: `CONFIRMED → NO_SHOW` só com `agora ≥ startsAt`; terminal (OP-108). */
    async markNoShow(actor: ProfessionalActor, bookingId: string, context: RequestContext): Promise<ProfessionalBookingView> {
      return finish(actor, bookingId, "NO_SHOW", "NO_SHOW", "PROFESSIONAL_BOOKING_NO_SHOW", context);
    },
  };

  async function finish(actor: ProfessionalActor, bookingId: string, action: "COMPLETE" | "NO_SHOW", status: "COMPLETED" | "NO_SHOW", auditAction: AuditEvent["action"], context: RequestContext): Promise<ProfessionalBookingView> {
    return deps.withTransaction(async (trx) => {
      const current = await load(trx, actor, bookingId, true);
      await assertApproved(actor);
      const at = now();
      const to = transition(current, action, at);
      await deps.bookings.markFinished(trx, current.id, { status, at });
      await applyEffects(trx, current, to);
      await audit(trx, actor, context, auditAction, current.id, at, current.status, to);
      return reload(trx, actor, bookingId);
    });
  }
}

export type ProfessionalBookings = ReturnType<typeof createProfessionalBookings<unknown>>;
