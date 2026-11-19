// Avaliações verificadas (UC-MKT-39..43; BR-MKT-59/60/61/62/63/66). A avaliação é ANÓNIMA: não tem família, membro nem utilizador; a autoria
// prova-se pela marcação (`COMPLETED` + pagamento satisfeito, 30 dias). Criar/editar serializa-se bloqueando a marcação (o `UNIQUE(booking_id)`
// é a rede). O profissional só vê/responde/denuncia as suas (outra ou inexistente ⇒ `NOT_FOUND` idêntico). O admin vê só a avaliação
// denunciada. A nota conta SEMPRE (o comentário oculto sai como `commentHidden` sem texto). Texto livre nunca em auditoria, logs nem erros.
import { sendProfessionalNotice } from "./notices.js";
import { ConflictError, DomainError, ForbiddenError, NotFoundError, RateLimitedError, ValidationError } from "../../../platform/errors/index.js";
import { newId } from "../../../platform/ids/index.js";
import { auditContextFields } from "../../audit/index.js";
import { BOOKING_LIMITS } from "../domain/booking.js";
import { canEditReview, checkReviewCreate, isPlainText, isValidRating, publicComment, REVIEW_LIMITS, REVIEW_REPORT_REASONS, type ReviewReportReason } from "../domain/review.js";
import { decodeBookingCursor, encodeBookingCursor } from "./cursor.js";
import type { ActorIdentity, ConsultationsDeps, ProfessionalActor, RequestContext } from "./ports.js";
import { SlidingWindowLimiter } from "./rate-limiter.js";
import type { ReviewRecord, ReviewReportDecision, ReviewReportRecord, ReviewReportRow } from "./review-ports.js";

const DAY_MS = 24 * 60 * 60_000;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const LUANDA = "Africa/Luanda";
const invalid = (field: string, message: string): ValidationError => new ValidationError([{ field, message }], { detail: "Dados inválidos." });

const monthFormat = new Intl.DateTimeFormat("en-CA", { timeZone: LUANDA, year: "numeric", month: "2-digit" });
const dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: LUANDA, year: "numeric", month: "2-digit", day: "2-digit" });

/** Primeiro dia do mês (`YYYY-MM-01`) de um instante no fuso `Africa/Luanda`. */
export function consultedMonthOf(instant: Date): string {
  return `${monthFormat.format(instant)}-01`;
}

const dayOf = (instant: Date): string => dayFormat.format(instant);

export interface ReplyView {
  text: string;
  repliedAt: string;
}

export interface FamilyReviewView {
  bookingId: string;
  rating: number;
  comment: string | null;
  commentHidden: boolean;
  reply?: ReplyView;
  consultedMonth: string;
  createdAt: string;
  updatedAt: string;
  editableUntil: string;
}

export interface PublicReviewView {
  id: string;
  rating: number;
  comment: string | null;
  commentHidden: boolean;
  reply?: ReplyView;
  specialty: { id: string; name: string };
  method: string;
  consultedMonth: string;
  createdOn: string;
}

export interface ProfessionalReviewView extends PublicReviewView {
  reported: boolean;
}

export interface ReviewSummaryView {
  count: number;
  averageRating: number | null;
}

export interface ReviewReportView {
  id: string;
  reviewId: string;
  status: "OPEN" | "DECIDED";
  reason: ReviewReportReason;
  createdAt: string;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** O campo `reply` é OMITIDO quando não há resposta (o schema usa `allOf` + `nullable`, que rejeita `null`). */
const replyOf = (r: ReviewRecord): { reply?: ReplyView } => (r.replyText !== null && r.repliedAt !== null ? { reply: { text: r.replyText, repliedAt: r.repliedAt.toISOString() } } : {});

export function summaryView(agg: { count: number; sum: number }): ReviewSummaryView {
  return { count: agg.count, averageRating: agg.count >= 3 ? Math.round((agg.sum / agg.count) * 10) / 10 : null };
}

function limitOf(raw: number | undefined): number {
  const limit = raw ?? DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new DomainError("MALFORMED_REQUEST", { detail: "Limite inválido." });
  return limit;
}

/** `comment`: aparado, vazio ⇒ `null`, ≤ 500 pontos de código, texto simples (sem controlo nem HTML). */
function validateComment(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") throw invalid("comment", "tem de ser texto");
  const text = raw.trim();
  if (text === "") return null;
  if (!isPlainText(text, REVIEW_LIMITS.maxComment)) throw invalid("comment", "excede o tamanho máximo ou contém caracteres não permitidos");
  return text;
}

export function createReviews<Trx>(deps: ConsultationsDeps<Trx>) {
  const reviewLimiter = new SlidingWindowLimiter(deps.clock, 20, DAY_MS);
  const publicLimiter = new SlidingWindowLimiter(deps.clock, 60, 60_000);
  const reportLimiter = new SlidingWindowLimiter(deps.clock, 10, DAY_MS);
  setInterval(() => {
    reviewLimiter.prune();
    publicLimiter.prune();
    reportLimiter.prune();
  }, 10 * 60_000).unref();

  const notFound = (): NotFoundError => new NotFoundError({ detail: "Não encontrado." });

  async function presentOwn(reviews: { review: ReviewRecord; reported: boolean }[]): Promise<ProfessionalReviewView[]> {
    const names = new Map((await deps.agenda.findSpecialties([...new Set(reviews.map((r) => r.review.specialtyId))])).map((s) => [s.id, s.name]));
    return reviews.map(({ review, reported }) => ({ ...publicView(review, names), reported }));
  }

  function publicView(review: ReviewRecord, names: Map<string, string>): PublicReviewView {
    const { comment, commentHidden } = publicComment({ comment: review.comment, commentHiddenAtMs: review.commentHiddenAt?.getTime() ?? null });
    return {
      id: review.id,
      rating: review.rating,
      comment,
      commentHidden,
      ...replyOf(review),
      specialty: { id: review.specialtyId, name: names.get(review.specialtyId) ?? "" },
      method: review.method,
      consultedMonth: review.consultedMonth,
      createdOn: dayOf(review.createdAt),
    };
  }

  function familyView(review: ReviewRecord, bookingId: string): FamilyReviewView {
    const { comment, commentHidden } = publicComment({ comment: review.comment, commentHiddenAtMs: review.commentHiddenAt?.getTime() ?? null });
    return {
      bookingId,
      rating: review.rating,
      comment,
      commentHidden,
      ...replyOf(review),
      consultedMonth: review.consultedMonth,
      createdAt: review.createdAt.toISOString(),
      updatedAt: review.updatedAt.toISOString(),
      editableUntil: new Date(review.createdAt.getTime() + BOOKING_LIMITS.reviewEditWindowMs).toISOString(),
    };
  }

  async function assertApproved(actor: ProfessionalActor): Promise<void> {
    const identity = (await deps.agenda.findIdentities([actor.professionalId]))[0];
    if (!identity?.approved) throw new DomainError("PROFESSIONAL_LOCKED", { detail: "O seu perfil não está aprovado." });
  }

  function reportView(report: ReviewReportRecord): ReviewReportView {
    return { id: report.id, reviewId: report.reviewId, status: report.status, reason: report.reason, createdAt: report.createdAt.toISOString() };
  }

  async function adminPresent(row: ReviewReportRow): Promise<{ professional: { id: string; displayName: string; city: string | null }; specialtyName: string }> {
    const [identity] = await deps.agenda.findIdentities([row.review.professionalId]);
    const [specialty] = await deps.agenda.findSpecialties([row.review.specialtyId]);
    return {
      professional: identity ? { id: identity.id, displayName: identity.displayName, city: identity.city } : { id: row.review.professionalId, displayName: "Profissional", city: null },
      specialtyName: specialty?.name ?? "",
    };
  }

  function adminDetail(row: ReviewReportRow, ctx: Awaited<ReturnType<typeof adminPresent>>) {
    const { report, review } = row;
    return {
      id: report.id,
      status: report.status,
      reason: report.reason,
      note: report.note,
      professional: ctx.professional,
      review: {
        rating: review.rating,
        // O admin vê o texto original mesmo se já estiver oculto.
        comment: review.comment,
        commentHidden: review.commentHiddenAt !== null,
        ...replyOf(review),
        specialtyName: ctx.specialtyName,
        method: review.method,
        consultedMonth: review.consultedMonth,
      },
      decision: report.decision,
      decidedAt: report.decidedAt?.toISOString() ?? null,
      createdAt: report.createdAt.toISOString(),
    };
  }

  return {
    // ---------------------------------------------------------------- família (UC-MKT-39)
    async getReview(actor: ActorIdentity, familyId: string, memberId: string, bookingId: string): Promise<FamilyReviewView> {
      return deps.withTransaction(async (trx) => {
        await deps.access.assertCanBook(trx, { userId: actor.userId, platformAdmin: actor.platformAdmin, familyId, memberId });
        const booking = await deps.bookings.findForFamily(trx, familyId, memberId, bookingId, false);
        if (!booking) throw notFound();
        const review = await deps.reviews.findByBooking(trx, bookingId, false);
        if (!review) throw notFound();
        return familyView(review, bookingId);
      });
    },

    /** `201` ao criar, `200` ao editar (até 7 dias depois da criação). */
    async putReview(
      actor: ActorIdentity,
      familyId: string,
      memberId: string,
      bookingId: string,
      input: { rating: unknown; comment?: unknown },
      context: RequestContext,
    ): Promise<{ review: FamilyReviewView; created: boolean }> {
      if (typeof input.rating !== "number" || !isValidRating(input.rating)) throw invalid("rating", "tem de ser um inteiro de 1 a 5");
      const rating = input.rating;
      const comment = validateComment(input.comment);
      const wait = reviewLimiter.hit(actor.userId);
      if (wait !== null) throw new RateLimitedError(wait);
      const result = await deps.withTransaction(async (trx): Promise<{ review: FamilyReviewView; created: boolean; professionalId?: string }> => {
        await deps.access.assertCanBook(trx, { userId: actor.userId, platformAdmin: actor.platformAdmin, familyId, memberId });
        // Bloqueio da marcação: serializa duas avaliações (ou criar/editar) da mesma marcação.
        const booking = await deps.bookings.findForFamily(trx, familyId, memberId, bookingId, true);
        if (!booking) throw notFound();
        if (await deps.selfDealing.isSamePerson(booking.professionalId, actor.userId)) throw new DomainError("SELF_BOOKING_NOT_ALLOWED", { detail: "Não pode avaliar o próprio profissional." });
        const at = deps.clock.now();
        const existing = await deps.reviews.findByBooking(trx, bookingId, true);
        const base = { occurredAt: at, actorType: "USER" as const, actorUserId: actor.userId, resourceType: "Review", familyId, subjectMemberId: memberId, result: "SUCCESS" as const, requestId: context.requestId, ...auditContextFields(context) };
        if (existing) {
          if (!canEditReview(existing.createdAt.getTime(), at.getTime())) throw new DomainError("REVIEW_NOT_ALLOWED", { detail: "A avaliação já não pode ser editada." });
          await deps.reviews.update(trx, existing.id, { rating, comment, at });
          await deps.audit.record(trx, { ...base, action: "REVIEW_UPDATE", resourceId: existing.id, metadata: { bookingId } });
          const updated = await deps.reviews.findByBooking(trx, bookingId, false);
          if (!updated) throw notFound();
          return { review: familyView(updated, bookingId), created: false };
        }
        const eligibility = checkReviewCreate({ status: booking.status, paymentStatus: booking.paymentStatus, completedAtMs: booking.completedAt?.getTime() ?? null }, at.getTime());
        if (!eligibility.allowed) throw new DomainError("REVIEW_NOT_ALLOWED", { detail: "Esta marcação não pode ser avaliada." });
        const record: ReviewRecord = {
          id: newId(),
          bookingId,
          professionalId: booking.professionalId,
          specialtyId: booking.specialtyId,
          method: booking.method,
          consultedMonth: consultedMonthOf(booking.startsAt),
          rating,
          comment,
          commentHiddenAt: null,
          replyText: null,
          repliedAt: null,
          createdAt: at,
          updatedAt: at,
        };
        await deps.reviews.insert(trx, record);
        await deps.audit.record(trx, { ...base, action: "REVIEW_CREATE", resourceId: record.id, metadata: { bookingId } });
        return { review: familyView(record, bookingId), created: true, professionalId: booking.professionalId };
      });
      if (result.created && result.professionalId) await sendProfessionalNotice(deps.notices, { professionalId: result.professionalId, bookingId, event: "REVIEW_CREATED" });
      return { review: result.review, created: result.created };
    },

    // ---------------------------------------------------------------- pública (UC-MKT-40)
    async listPublic(actor: ActorIdentity, professionalId: string, query: { specialtyId?: string; limit?: number; cursor?: string }): Promise<Page<PublicReviewView> & { summary: ReviewSummaryView }> {
      const wait = publicLimiter.hit(actor.userId);
      if (wait !== null) throw new RateLimitedError(wait);
      const limit = limitOf(query.limit);
      const after = query.cursor === undefined ? undefined : decodeBookingCursor(query.cursor);
      const identity = (await deps.agenda.findIdentities([professionalId]))[0];
      if (!identity?.approved) throw notFound();
      return deps.withTransaction(async (trx) => {
        const rows = await deps.reviews.listForProfessional(trx, {
          professionalId,
          ...(query.specialtyId ? { specialtyId: query.specialtyId } : {}),
          limit: limit + 1,
          ...(after ? { after: { createdAt: after.startsAt, id: after.id } } : {}),
        });
        const page = rows.slice(0, limit);
        const names = new Map((await deps.agenda.findSpecialties([...new Set(page.map((r) => r.review.specialtyId))])).map((s) => [s.id, s.name]));
        const last = page.at(-1);
        return {
          summary: summaryView(await deps.reviews.summary(trx, professionalId, query.specialtyId)),
          items: page.map((r) => publicView(r.review, names)),
          nextCursor: rows.length > limit && last ? encodeBookingCursor(last.review.createdAt, last.review.id) : null,
        };
      });
    },

    // ---------------------------------------------------------------- profissional (UC-MKT-41/42)
    async listOwn(actor: ProfessionalActor, query: { unanswered?: boolean; limit?: number; cursor?: string }): Promise<Page<ProfessionalReviewView>> {
      const limit = limitOf(query.limit);
      const after = query.cursor === undefined ? undefined : decodeBookingCursor(query.cursor);
      return deps.withTransaction(async (trx) => {
        const rows = await deps.reviews.listForProfessional(trx, {
          professionalId: actor.professionalId,
          ...(query.unanswered ? { unanswered: true } : {}),
          limit: limit + 1,
          ...(after ? { after: { createdAt: after.startsAt, id: after.id } } : {}),
        });
        const page = rows.slice(0, limit);
        const last = page.at(-1);
        return { items: await presentOwn(page), nextCursor: rows.length > limit && last ? encodeBookingCursor(last.review.createdAt, last.review.id) : null };
      });
    },

    /** Uma resposta por avaliação (`CONFLICT` se já houve); só `APPROVED`. */
    async reply(actor: ProfessionalActor, reviewId: string, input: { text: unknown }, context: RequestContext): Promise<ProfessionalReviewView> {
      return deps.withTransaction(async (trx) => {
        const found = await deps.reviews.findOfProfessional(trx, actor.professionalId, reviewId, true);
        if (!found) throw notFound();
        await assertApproved(actor);
        if (typeof input.text !== "string") throw invalid("text", "tem de ser texto");
        const text = input.text.trim();
        if (text === "" || !isPlainText(text, REVIEW_LIMITS.maxReply)) throw invalid("text", "tem de ter 1 a 500 caracteres de texto simples");
        if (found.review.replyText !== null) throw new ConflictError({ detail: "Já respondeu a esta avaliação." });
        const at = deps.clock.now();
        if (!(await deps.reviews.setReply(trx, reviewId, text, at))) throw new ConflictError({ detail: "Já respondeu a esta avaliação." });
        await deps.audit.record(trx, {
          occurredAt: at,
          actorType: "PROFESSIONAL_ACCOUNT",
          actorProfessionalAccountId: actor.professionalAccountId,
          action: "PROFESSIONAL_REVIEW_REPLY",
          resourceType: "Review",
          resourceId: reviewId,
          result: "SUCCESS",
          requestId: context.requestId,
          ...auditContextFields(context),
        });
        const updated = await deps.reviews.findOfProfessional(trx, actor.professionalId, reviewId, false);
        if (!updated) throw notFound();
        const [view] = await presentOwn([updated]);
        if (!view) throw notFound();
        return view;
      });
    },

    /** Uma denúncia por avaliação, para sempre: repetir ⇒ a existente (`created=false`). */
    async report(actor: ProfessionalActor, reviewId: string, input: { reason: unknown; note?: unknown }, context: RequestContext): Promise<{ report: ReviewReportView; created: boolean }> {
      if (typeof input.reason !== "string" || !(REVIEW_REPORT_REASONS as readonly string[]).includes(input.reason)) throw invalid("reason", "motivo inválido");
      const reason = input.reason as ReviewReportReason;
      let note: string | null = null;
      if (input.note !== undefined && input.note !== null) {
        if (typeof input.note !== "string") throw invalid("note", "tem de ser texto");
        const trimmed = input.note.trim();
        if (trimmed !== "") {
          if (!isPlainText(trimmed, REVIEW_LIMITS.maxReportNote)) throw invalid("note", "excede o tamanho máximo ou contém caracteres não permitidos");
          note = trimmed;
        }
      }
      return deps.withTransaction(async (trx) => {
        const found = await deps.reviews.findOfProfessional(trx, actor.professionalId, reviewId, true);
        if (!found) throw notFound();
        await assertApproved(actor);
        const existing = await deps.reviews.findReportByReview(trx, reviewId);
        if (existing) return { report: reportView(existing), created: false };
        const wait = reportLimiter.hit(actor.professionalAccountId);
        if (wait !== null) throw new RateLimitedError(wait);
        const at = deps.clock.now();
        const report: ReviewReportRecord = { id: newId(), reviewId, reason, note, status: "OPEN", decision: null, decidedAt: null, createdAt: at };
        if (!(await deps.reviews.insertReport(trx, report))) {
          const raced = await deps.reviews.findReportByReview(trx, reviewId);
          if (!raced) throw notFound();
          return { report: reportView(raced), created: false };
        }
        await deps.audit.record(trx, {
          occurredAt: at,
          actorType: "PROFESSIONAL_ACCOUNT",
          actorProfessionalAccountId: actor.professionalAccountId,
          action: "PROFESSIONAL_REVIEW_REPORT_CREATE",
          resourceType: "Review",
          resourceId: reviewId,
          result: "SUCCESS",
          requestId: context.requestId,
          metadata: { reason },
          ...auditContextFields(context),
        });
        return { report: reportView(report), created: true };
      });
    },

    // ---------------------------------------------------------------- admin (UC-MKT-43)
    async listReports(actor: ActorIdentity, query: { status?: "OPEN" | "DECIDED"; limit?: number; cursor?: string }) {
      if (!actor.platformAdmin) throw new ForbiddenError();
      const limit = limitOf(query.limit);
      const after = query.cursor === undefined ? undefined : decodeBookingCursor(query.cursor);
      return deps.withTransaction(async (trx) => {
        const rows = await deps.reviews.listReports(trx, { status: query.status ?? "OPEN", limit: limit + 1, ...(after ? { after: { createdAt: after.startsAt, id: after.id } } : {}) });
        const page = rows.slice(0, limit);
        const identities = new Map((await deps.agenda.findIdentities([...new Set(page.map((r) => r.review.professionalId))])).map((i) => [i.id, { id: i.id, displayName: i.displayName, city: i.city }]));
        const last = page.at(-1);
        return {
          items: page.map((row) => ({
            id: row.report.id,
            status: row.report.status,
            reason: row.report.reason,
            professional: identities.get(row.review.professionalId) ?? { id: row.review.professionalId, displayName: "Profissional", city: null },
            rating: row.review.rating,
            createdAt: row.report.createdAt.toISOString(),
          })),
          nextCursor: rows.length > limit && last ? encodeBookingCursor(last.report.createdAt, last.report.id) : null,
        };
      });
    },

    /** Detalhe AUDITADO (`ADMIN_REVIEW_REPORT_VIEW`, sem textos) na mesma transação. */
    async getReport(actor: ActorIdentity, reportId: string, context: RequestContext) {
      if (!actor.platformAdmin) throw new ForbiddenError();
      return deps.withTransaction(async (trx) => {
        const row = await deps.reviews.findReport(trx, reportId, false);
        if (!row) throw notFound();
        const view = adminDetail(row, await adminPresent(row));
        await deps.audit.record(trx, {
          occurredAt: deps.clock.now(),
          actorType: "PLATFORM_ADMIN",
          actorUserId: actor.userId,
          action: "ADMIN_REVIEW_REPORT_VIEW",
          resourceType: "ReviewReport",
          resourceId: reportId,
          result: "SUCCESS",
          requestId: context.requestId,
          ...auditContextFields(context),
        });
        return view;
      });
    },

    /** `DISMISS` arquiva; `HIDE_COMMENT` oculta o comentário (a nota continua a contar). Já decidida ⇒ `INVALID_STATE_TRANSITION`. */
    async decideReport(actor: ActorIdentity, reportId: string, input: { decision: unknown }, context: RequestContext) {
      if (!actor.platformAdmin) throw new ForbiddenError();
      const decision: ReviewReportDecision | undefined = input.decision === "DISMISS" || input.decision === "HIDE_COMMENT" ? input.decision : undefined;
      if (!decision) throw invalid("decision", "decisão inválida");
      return deps.withTransaction(async (trx) => {
        const row = await deps.reviews.findReport(trx, reportId, true);
        if (!row) throw notFound();
        if (row.report.status !== "OPEN") throw new DomainError("INVALID_STATE_TRANSITION", { detail: "A denúncia já foi decidida." });
        const at = deps.clock.now();
        await deps.reviews.decideReport(trx, reportId, { decision, at, decidedBy: actor.userId });
        if (decision === "HIDE_COMMENT") await deps.reviews.hideComment(trx, row.review.id, at);
        await deps.audit.record(trx, {
          occurredAt: at,
          actorType: "PLATFORM_ADMIN",
          actorUserId: actor.userId,
          action: "ADMIN_REVIEW_REPORT_DECIDE",
          resourceType: "ReviewReport",
          resourceId: reportId,
          result: "SUCCESS",
          requestId: context.requestId,
          metadata: { decision },
          ...auditContextFields(context),
        });
        const updated = await deps.reviews.findReport(trx, reportId, false);
        if (!updated) throw notFound();
        return adminDetail(updated, await adminPresent(updated));
      });
    },

    // ---------------------------------------------------------------- porta `ReviewStats` de `discovery` (BR-MKT-61)
    stats: {
      forSpecialty: (specialtyId: string) => deps.withTransaction((trx) => deps.reviews.aggregateForSpecialty(trx, specialtyId)),
      forProfessionals: (ids: readonly string[]) => deps.withTransaction((trx) => deps.reviews.aggregateForProfessionals(trx, ids)),
    },
  };
}

export type Reviews = ReturnType<typeof createReviews<unknown>>;
