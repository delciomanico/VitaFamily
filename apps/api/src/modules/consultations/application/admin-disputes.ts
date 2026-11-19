// Disputas de pagamento no ADMIN (UC-MKT-38; BR-MKT-57/58/63). O admin vê SÓ a marcação (profissional pelo nome público, especialidade,
// método, hora, preço, estados) e o comprovativo (metadados; o ficheiro por rota própria): NUNCA família, membro, `participantLabel`,
// conversas nem utilizador que carregou — as consultas do repositório nem selecionam essas colunas. Abrir o detalhe e descarregar são AUDITADOS
// na mesma transação (falha ⇒ a leitura falha). A decisão é definitiva e serializa-se bloqueando a marcação e depois o comprovativo (a mesma
// ordem do upload, da decisão do profissional e da disputa); a segunda decisão ⇒ `INVALID_STATE_TRANSITION`. O admin não valida dinheiro.
import type { Readable } from "node:stream";
import { DomainError, ForbiddenError, NotFoundError, RateLimitedError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import { nextPaymentStatus, type PaymentEvent } from "../domain/payment.js";
import { decodeBookingCursor, encodeBookingCursor } from "./cursor.js";
import type { ActorIdentity, ConsultationsDeps, DisputeRow, ProofDisputeDecision, RequestContext } from "./ports.js";
import { isDownloadable, PROOF_EXTENSION } from "./proof-views.js";
import { SlidingWindowLimiter } from "./rate-limiter.js";

export interface AdminDisputeItemView {
  proofId: string;
  status: "DISPUTED" | "DECIDED";
  professional: { id: string; displayName: string; city: string | null };
  specialtyName: string;
  startsAt: string;
  priceKz: number;
  disputedAt: string;
}

export interface AdminDisputeDetailView {
  proofId: string;
  status: "DISPUTED" | "DECIDED";
  booking: { professional: { id: string; displayName: string; city: string | null }; specialtyName: string; method: string; durationMinutes: number; startsAt: string; priceKz: number; status: string; paymentStatus: string };
  proof: { contentType: string; sizeBytes: number; scanStatus: string; submittedAt: string };
  professionalReason: string | null;
  familyNote: string | null;
  disputedAt: string;
  decision: ProofDisputeDecision | null;
  decidedAt: string | null;
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const OUT_OF_QUEUE: readonly string[] = ["CANCELLED", "REJECTED", "NO_SHOW"];
const DECISIONS: readonly ProofDisputeDecision[] = ["CONFIRM_PAYMENT", "UPHOLD_REJECTION"];

function assertAdmin(actor: ActorIdentity): void {
  if (!actor.platformAdmin) throw new ForbiddenError();
}

export function createAdminDisputes<Trx>(deps: ConsultationsDeps<Trx>) {
  const downloadLimiter = new SlidingWindowLimiter(deps.clock, 60, 60_000);
  setInterval(() => {
    downloadLimiter.prune();
  }, 10 * 60_000).unref();

  const notFound = (): NotFoundError => new NotFoundError({ detail: "Disputa não encontrada." });

  async function present(rows: DisputeRow[]): Promise<{ identities: Map<string, { id: string; displayName: string; city: string | null }>; specialties: Map<string, string> }> {
    const [identities, specialties] = await Promise.all([
      deps.agenda.findIdentities([...new Set(rows.map((r) => r.booking.professionalId))]),
      deps.agenda.findSpecialties([...new Set(rows.map((r) => r.booking.specialtyId))]),
    ]);
    return { identities: new Map(identities.map((i) => [i.id, { id: i.id, displayName: i.displayName, city: i.city }])), specialties: new Map(specialties.map((s) => [s.id, s.name])) };
  }

  /** Disputa por decidir de uma marcação terminada sem consulta: fora da fila (OP-114). */
  const outOfQueue = (row: DisputeRow): boolean => row.proof.disputeDecision === null && OUT_OF_QUEUE.includes(row.booking.status);

  const statusOf = (row: DisputeRow): "DISPUTED" | "DECIDED" => (row.proof.disputeDecision === null ? "DISPUTED" : "DECIDED");

  function detail(row: DisputeRow, ctx: Awaited<ReturnType<typeof present>>): AdminDisputeDetailView {
    const { proof, booking } = row;
    return {
      proofId: proof.id,
      status: statusOf(row),
      booking: {
        professional: ctx.identities.get(booking.professionalId) ?? { id: booking.professionalId, displayName: "Profissional", city: null },
        specialtyName: ctx.specialties.get(booking.specialtyId) ?? "",
        method: booking.method,
        durationMinutes: booking.durationMinutes,
        startsAt: booking.startsAt.toISOString(),
        priceKz: booking.priceKz,
        status: booking.status,
        paymentStatus: booking.paymentStatus,
      },
      proof: { contentType: proof.contentType, sizeBytes: proof.sizeBytes, scanStatus: proof.scanStatus, submittedAt: proof.createdAt.toISOString() },
      professionalReason: proof.decisionReason,
      familyNote: proof.disputeNote,
      disputedAt: (proof.disputedAt ?? proof.createdAt).toISOString(),
      decision: proof.disputeDecision,
      decidedAt: proof.disputeDecidedAt?.toISOString() ?? null,
    };
  }

  return {
    /** Fila (mais antigas primeiro): sem ficheiros nem textos livres. */
    async listDisputes(actor: ActorIdentity, query: { status?: "DISPUTED" | "DECIDED"; limit?: number; cursor?: string }): Promise<{ items: AdminDisputeItemView[]; nextCursor: string | null }> {
      assertAdmin(actor);
      const limit = query.limit ?? DEFAULT_LIMIT;
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new DomainError("MALFORMED_REQUEST", { detail: "Limite inválido." });
      const after = query.cursor === undefined ? undefined : decodeBookingCursor(query.cursor);
      return deps.withTransaction(async (trx) => {
        const rows = await deps.proofs.listDisputes(trx, { status: query.status ?? "DISPUTED", limit: limit + 1, ...(after ? { after: { disputedAt: after.startsAt, id: after.id } } : {}) });
        const page = rows.slice(0, limit);
        const ctx = await present(page);
        const last = page.at(-1);
        return {
          items: page.map((row) => ({
            proofId: row.proof.id,
            status: statusOf(row),
            professional: ctx.identities.get(row.booking.professionalId) ?? { id: row.booking.professionalId, displayName: "Profissional", city: null },
            specialtyName: ctx.specialties.get(row.booking.specialtyId) ?? "",
            startsAt: row.booking.startsAt.toISOString(),
            priceKz: row.booking.priceKz,
            disputedAt: (row.proof.disputedAt ?? row.proof.createdAt).toISOString(),
          })),
          nextCursor: rows.length > limit && last?.proof.disputedAt ? encodeBookingCursor(last.proof.disputedAt, last.proof.id) : null,
        };
      });
    },

    /** Detalhe: AUDITADO (`ADMIN_PAYMENT_DISPUTE_VIEW`) na mesma transação. */
    async getDispute(actor: ActorIdentity, proofId: string, context: RequestContext): Promise<AdminDisputeDetailView> {
      assertAdmin(actor);
      return deps.withTransaction(async (trx) => {
        const row = await deps.proofs.findDispute(trx, proofId);
        if (!row || outOfQueue(row)) throw notFound();
        const view = detail(row, await present([row]));
        await deps.audit.record(trx, {
          occurredAt: deps.clock.now(),
          actorType: "PLATFORM_ADMIN",
          actorUserId: actor.userId,
          action: "ADMIN_PAYMENT_DISPUTE_VIEW",
          resourceType: "PaymentProof",
          resourceId: proofId,
          result: "SUCCESS",
          requestId: context.requestId,
          metadata: { bookingId: row.booking.id },
          ...auditContextFields(context),
        });
        return view;
      });
    },

    /** Download (BR-MKT-57): só com a disputa ABERTA (`DISPUTED`); decidida/inexistente/nunca disputada ⇒ negado. Auditado SEMPRE. */
    async downloadProof(actor: ActorIdentity, proofId: string, context: RequestContext): Promise<{ contentType: string; extension: string; stream: Readable }> {
      assertAdmin(actor);
      const wait = downloadLimiter.hit(actor.userId);
      if (wait !== null) throw new RateLimitedError(wait);
      const proof = await deps.withTransaction(async (trx) => {
        const row = await deps.proofs.findDispute(trx, proofId);
        if (!row) throw notFound();
        if (statusOf(row) !== "DISPUTED" || outOfQueue(row) || !isDownloadable(row.proof)) throw new DomainError("DOCUMENT_NOT_AVAILABLE", { detail: "O comprovativo não está disponível." });
        await deps.audit.record(trx, {
          occurredAt: deps.clock.now(),
          actorType: "PLATFORM_ADMIN",
          actorUserId: actor.userId,
          action: "ADMIN_PAYMENT_PROOF_DOWNLOAD",
          resourceType: "PaymentProof",
          resourceId: proofId,
          result: "SUCCESS",
          requestId: context.requestId,
          metadata: { bookingId: row.booking.id },
          ...auditContextFields(context),
        });
        return row.proof;
      });
      return { contentType: proof.contentType, extension: PROOF_EXTENSION[proof.contentType], stream: await deps.fileStore.get(proof.storageKey) };
    },

    /** Decisão única e definitiva (`CONFIRM_PAYMENT` | `UPHOLD_REJECTION`); auditoria `ADMIN_PAYMENT_DISPUTE_DECIDE`. */
    async decide(actor: ActorIdentity, proofId: string, input: { decision: string }, context: RequestContext): Promise<AdminDisputeDetailView> {
      assertAdmin(actor);
      const decision = DECISIONS.find((d) => d === input.decision);
      if (!decision) throw new DomainError("VALIDATION_ERROR", { detail: "Decisão inválida." });
      return deps.withTransaction(async (trx) => {
        // Ordem de bloqueios: marcação < comprovativo.
        const peek = await deps.proofs.findDispute(trx, proofId);
        if (!peek) throw notFound();
        const booking = await deps.bookings.findById(trx, peek.booking.id, true);
        const proof = await deps.proofs.findForBooking(trx, peek.booking.id, proofId, true);
        if (!booking || !proof) throw notFound();
        if (outOfQueue(peek)) throw new DomainError("INVALID_STATE_TRANSITION", { detail: "A disputa já não pode ser decidida." });
        const event: PaymentEvent = decision === "CONFIRM_PAYMENT" ? "ADMIN_CONFIRM_PAYMENT" : "ADMIN_UPHOLD_REJECTION";
        const check = nextPaymentStatus(booking.status, booking.paymentStatus, event);
        if (proof.status !== "DISPUTED" || !check.ok) throw new DomainError("INVALID_STATE_TRANSITION", { detail: "A disputa já foi decidida ou já não pode ser decidida." });
        const at = deps.clock.now();
        await deps.proofs.markDisputeDecided(trx, proofId, { decision, at, decidedBy: actor.userId });
        await deps.bookings.setPaymentStatus(trx, booking.id, check.to, at);
        await deps.audit.record(trx, {
          occurredAt: at,
          actorType: "PLATFORM_ADMIN",
          actorUserId: actor.userId,
          action: "ADMIN_PAYMENT_DISPUTE_DECIDE",
          resourceType: "PaymentProof",
          resourceId: proofId,
          result: "SUCCESS",
          requestId: context.requestId,
          metadata: { bookingId: booking.id, decision },
          ...auditContextFields(context),
        });
        // O alerta `PAYMENT_UPDATED` à família e o e-mail ao profissional ligam-se na fatia S11.
        const row = await deps.proofs.findDispute(trx, proofId);
        if (!row) throw notFound();
        return detail(row, await present([row]));
      });
    },
  };
}

export type AdminDisputes = ReturnType<typeof createAdminDisputes<unknown>>;
