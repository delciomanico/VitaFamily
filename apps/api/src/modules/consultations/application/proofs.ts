// Comprovativos de pagamento (UC-MKT-35/36; BR-MKT-56..58, 63, 66). O Vita não valida dinheiro: o estado é declarativo.
// Concorrência: toda a escrita bloqueia PRIMEIRO a linha da marcação e depois a do comprovativo (a mesma ordem no upload, na decisão, no job
// de antivírus e na disputa/admin); o limite «um em curso» tem ainda o UNIQUE parcial da BD como rede.
// Ficheiros: tipo por CONTEÚDO, quarentena + antivírus (job), objeto só descarregável `CLEAN`; chave derivada do id (nunca do nome do ficheiro).
// Privacidade: erros e auditoria nunca levam nome de ficheiro, motivo, nota nem instruções; o download audita SEMPRE (antes de entregar o stream).
import { sendProfessionalNotice } from "./notices.js";
import type { Readable } from "node:stream";
import { ConflictError, DomainError, NotFoundError, RateLimitedError, ValidationError } from "../../../platform/errors/index.js";
import { newId } from "../../../platform/ids/index.js";
import { auditContextFields } from "../../audit/index.js";
import type { AuditEvent } from "../../audit/index.js";
import { checkProofUpload, nextPaymentStatus, nextProofStatus, PROOF_LIMITS, type PaymentEvent } from "../domain/payment.js";
import { detectFileKind, finalKey, MIME_BY_KIND, quarantineKey } from "../domain/file-type.js";
import { TEXT_LIMITS, validateOptionalFreeText, validateRequiredFreeText, type TextError } from "../domain/text.js";
import type { ActorIdentity, BookingRecord, ConsultationsDeps, ProcessorFileDeps, ProfessionalActor, ProofRecord, RequestContext } from "./ports.js";
import { isDownloadable, PROOF_EXTENSION, toProofView, type ProofView } from "./proof-views.js";
import { SlidingWindowLimiter } from "./rate-limiter.js";

export interface ProofDownload {
  contentType: string;
  extension: string;
  stream: Readable;
}

const HOUR_MS = 3_600_000;
const FIELD_ERRORS: Record<TextError, string> = { EMPTY: "não pode ser vazio", TOO_LONG: "excede o tamanho máximo", CONTROL_CHARACTER: "contém caracteres de controlo" };
const invalid = (field: string, message: string): ValidationError => new ValidationError([{ field, message }], { detail: "Dados inválidos." });
const notFound = (): NotFoundError => new NotFoundError({ detail: "Marcação ou comprovativo não encontrados." });

export function createFamilyProofs<Trx>(deps: ConsultationsDeps<Trx>) {
  const uploadLimiter = new SlidingWindowLimiter(deps.clock, 20, HOUR_MS);
  const downloadLimiter = new SlidingWindowLimiter(deps.clock, 60, 60_000);
  const listLimiter = new SlidingWindowLimiter(deps.clock, 60, 60_000);
  setInterval(() => {
    uploadLimiter.prune();
    downloadLimiter.prune();
    listLimiter.prune();
  }, 10 * 60_000).unref();

  async function authorize(trx: Trx, actor: ActorIdentity, familyId: string, memberId: string): Promise<void> {
    await deps.access.assertCanBook(trx, { userId: actor.userId, platformAdmin: actor.platformAdmin, familyId, memberId });
  }

  async function loadBooking(trx: Trx, familyId: string, memberId: string, bookingId: string, forUpdate: boolean): Promise<BookingRecord> {
    const booking = await deps.bookings.findForFamily(trx, familyId, memberId, bookingId, forUpdate);
    if (!booking) throw notFound();
    return booking;
  }

  return {
    /** Metadados dos comprovativos da marcação; não auditado. */
    async listProofs(actor: ActorIdentity, familyId: string, memberId: string, bookingId: string): Promise<ProofView[]> {
      const wait = listLimiter.hit(actor.userId);
      if (wait !== null) throw new RateLimitedError(wait);
      return deps.withTransaction(async (trx) => {
        await authorize(trx, actor, familyId, memberId);
        await loadBooking(trx, familyId, memberId, bookingId, false);
        return (await deps.proofs.listForBooking(trx, bookingId)).map(toProofView);
      });
    },

    /** UC-MKT-35: carrega o comprovativo (`SUBMITTED`/`PENDING`) e passa `paymentStatus` a `PROOF_SUBMITTED`. */
    async uploadProof(actor: ActorIdentity, familyId: string, memberId: string, bookingId: string, file: { buffer: Buffer }, context: RequestContext): Promise<ProofView> {
      const wait = uploadLimiter.hit(actor.userId);
      if (wait !== null) throw new RateLimitedError(wait);
      // BR-MKT-57: tipo verificado pelo CONTEÚDO, nunca pela extensão nem pelo Content-Type declarado.
      const kind = detectFileKind(file.buffer);
      if (!kind) throw new DomainError("FILE_TYPE_NOT_ALLOWED", { detail: "Tipo de ficheiro não permitido (só PDF, JPG, PNG)." });
      if (file.buffer.length > PROOF_LIMITS.maxFileBytes) throw new DomainError("FILE_TOO_LARGE", { detail: "Ficheiro acima do limite permitido (10 MB)." });

      const proofId = newId();
      const key = quarantineKey(proofId, kind);
      const state = { stored: false, professionalId: "" };
      let view: ProofView;
      try {
        view = await deps.withTransaction(async (trx) => {
          await authorize(trx, actor, familyId, memberId);
          const booking = await loadBooking(trx, familyId, memberId, bookingId, true);
          state.professionalId = booking.professionalId;
          const check = nextPaymentStatus(booking.status, booking.paymentStatus, "SUBMIT_PROOF");
          if (!check.ok) {
            const inFlight = booking.paymentStatus === "PROOF_SUBMITTED" || booking.paymentStatus === "DISPUTED";
            if (check.reason === "INVALID_STATE" && inFlight) throw new ConflictError({ detail: "Já existe um comprovativo em curso." });
            throw new DomainError("INVALID_STATE_TRANSITION", { detail: "Esta marcação não aceita comprovativos neste estado." });
          }
          const existing = await deps.proofs.listForBooking(trx, bookingId);
          const count = checkProofUpload(existing.map((p) => p.status));
          if (count === "PROOF_IN_PROGRESS") throw new ConflictError({ detail: "Já existe um comprovativo em curso." });
          if (count === "LIMIT_EXCEEDED") throw new DomainError("LIMIT_EXCEEDED", { detail: `Máximo de ${String(PROOF_LIMITS.maxPerBooking)} comprovativos por marcação.` });

          const at = deps.clock.now();
          const record: ProofRecord = {
            id: proofId,
            bookingId,
            uploadedByUserId: actor.userId,
            storageKey: key,
            contentType: MIME_BY_KIND[kind],
            sizeBytes: file.buffer.length,
            scanStatus: "PENDING",
            scannedAt: null,
            status: "SUBMITTED",
            decidedAt: null,
            decisionReason: null,
            disputedAt: null,
            disputeNote: null,
            disputeDecision: null,
            disputeDecidedAt: null,
            purgedAt: null,
            createdAt: at,
          };
          await deps.proofs.insert(trx, record);
          await deps.bookings.setPaymentStatus(trx, bookingId, check.to, at);
          await deps.fileStore.put(key, file.buffer, record.contentType);
          state.stored = true;
          await deps.audit.record(trx, {
            occurredAt: at,
            actorType: "USER",
            actorUserId: actor.userId,
            action: "PAYMENT_PROOF_UPLOAD",
            resourceType: "PaymentProof",
            resourceId: proofId,
            familyId,
            subjectMemberId: memberId,
            result: "SUCCESS",
            requestId: context.requestId,
            metadata: { bookingId },
            ...auditContextFields(context),
          });
          return toProofView(record);
        });
      } catch (error) {
        // Transação falhada depois de o objeto existir: apaga-o já (melhor esforço; sem linha não há trigger de outbox).
        if (state.stored) await deps.fileStore.delete(key).catch(() => undefined);
        throw error;
      }
      // Só depois do commit o antivírus tem sentido (sem job órfão se a transação falhasse).
      await deps.scanQueue.enqueueScan({ proofId });
      await sendProfessionalNotice(deps.notices, { professionalId: state.professionalId, bookingId, event: "PROOF_UPLOADED" });
      return view;
    },

    /** UC-MKT-37: disputa um comprovativo `REJECTED` (uma vez por comprovativo); `paymentStatus` passa a `DISPUTED`. */
    async disputeProof(actor: ActorIdentity, familyId: string, memberId: string, bookingId: string, proofId: string, input: { note?: string | null }, context: RequestContext): Promise<ProofView> {
      const note = validateOptionalFreeText(input.note, TEXT_LIMITS.note);
      if (!note.ok) throw invalid("note", FIELD_ERRORS[note.error]);
      let professionalId = "";
      const view = await deps.withTransaction(async (trx) => {
        await authorize(trx, actor, familyId, memberId);
        const booking = await loadBooking(trx, familyId, memberId, bookingId, true);
        professionalId = booking.professionalId;
        const proof = await deps.proofs.findForBooking(trx, bookingId, proofId, true);
        if (!proof) throw notFound();
        // Só `REJECTED`; já disputado (`DISPUTED`/`REJECTION_UPHELD`) ou noutro estado ⇒ o mesmo erro.
        const check = nextPaymentStatus(booking.status, booking.paymentStatus, "DISPUTE");
        if (nextProofStatus(proof.status, "DISPUTE") === null || !check.ok) throw new DomainError("INVALID_STATE_TRANSITION", { detail: "Este comprovativo não pode ser disputado." });
        const at = deps.clock.now();
        await deps.proofs.markDisputed(trx, proofId, { at, note: note.text });
        await deps.bookings.setPaymentStatus(trx, bookingId, check.to, at);
        await deps.audit.record(trx, {
          occurredAt: at,
          actorType: "USER",
          actorUserId: actor.userId,
          action: "PAYMENT_PROOF_DISPUTE",
          resourceType: "PaymentProof",
          resourceId: proofId,
          familyId,
          subjectMemberId: memberId,
          result: "SUCCESS",
          requestId: context.requestId,
          metadata: { bookingId },
          ...auditContextFields(context),
        });
        const updated = await deps.proofs.findForBooking(trx, bookingId, proofId, false);
        if (!updated) throw notFound();
        return toProofView(updated);
      });
      await sendProfessionalNotice(deps.notices, { professionalId, bookingId, event: "DISPUTE_OPENED" });
      return view;
    },

    /** Descarrega um comprovativo próprio (auditado SEMPRE; só `CLEAN`, não purgado). */
    async downloadProof(actor: ActorIdentity, familyId: string, memberId: string, bookingId: string, proofId: string, context: RequestContext): Promise<ProofDownload> {
      const wait = downloadLimiter.hit(actor.userId);
      if (wait !== null) throw new RateLimitedError(wait);
      const proof = await deps.withTransaction(async (trx) => {
        await authorize(trx, actor, familyId, memberId);
        await loadBooking(trx, familyId, memberId, bookingId, false);
        const found = await deps.proofs.findForBooking(trx, bookingId, proofId, false);
        if (!found) throw notFound();
        if (!isDownloadable(found)) throw new DomainError("DOCUMENT_NOT_AVAILABLE", { detail: "O comprovativo não está disponível." });
        await deps.audit.record(trx, {
          occurredAt: deps.clock.now(),
          actorType: "USER",
          actorUserId: actor.userId,
          action: "PAYMENT_PROOF_DOWNLOAD",
          resourceType: "PaymentProof",
          resourceId: proofId,
          familyId,
          subjectMemberId: memberId,
          result: "SUCCESS",
          requestId: context.requestId,
          metadata: { bookingId },
          ...auditContextFields(context),
        });
        return found;
      });
      return { contentType: proof.contentType, extension: PROOF_EXTENSION[proof.contentType], stream: await deps.fileStore.get(proof.storageKey) };
    },
  };
}

export function createProfessionalProofs<Trx>(deps: ConsultationsDeps<Trx>) {
  const downloadLimiter = new SlidingWindowLimiter(deps.clock, 60, 60_000);
  setInterval(() => {
    downloadLimiter.prune();
  }, 10 * 60_000).unref();

  async function assertApproved(actor: ProfessionalActor): Promise<void> {
    const identity = (await deps.agenda.findIdentities([actor.professionalId]))[0];
    if (!identity?.approved) throw new DomainError("PROFESSIONAL_LOCKED", { detail: "O seu perfil não está aprovado: só pode consultar as marcações." });
  }

  return {
    /** Descarrega o comprovativo da própria marcação (leitura em qualquer estado de validação; auditado SEMPRE). */
    async downloadProof(actor: ProfessionalActor, bookingId: string, proofId: string, context: RequestContext): Promise<ProofDownload> {
      const wait = downloadLimiter.hit(actor.professionalAccountId);
      if (wait !== null) throw new RateLimitedError(wait);
      const proof = await deps.withTransaction(async (trx) => {
        const booking = await deps.bookings.findForProfessional(trx, actor.professionalId, bookingId, false);
        if (!booking) throw notFound();
        const found = await deps.proofs.findForBooking(trx, bookingId, proofId, false);
        if (!found) throw notFound();
        if (!isDownloadable(found)) throw new DomainError("DOCUMENT_NOT_AVAILABLE", { detail: "O comprovativo não está disponível." });
        await deps.audit.record(trx, {
          occurredAt: deps.clock.now(),
          actorType: "PROFESSIONAL_ACCOUNT",
          actorProfessionalAccountId: actor.professionalAccountId,
          action: "PROFESSIONAL_PAYMENT_PROOF_DOWNLOAD",
          resourceType: "PaymentProof",
          resourceId: proofId,
          result: "SUCCESS",
          requestId: context.requestId,
          metadata: { bookingId },
          ...auditContextFields(context),
        });
        return found;
      });
      return { contentType: proof.contentType, extension: PROOF_EXTENSION[proof.contentType], stream: await deps.fileStore.get(proof.storageKey) };
    },

    /** UC-MKT-36: `CONFIRM` | `REJECT` (+ motivo obrigatório) sobre um comprovativo `SUBMITTED` e `CLEAN`. */
    async decideProof(actor: ProfessionalActor, bookingId: string, proofId: string, input: { decision: "CONFIRM" | "REJECT"; reason?: string | null }, context: RequestContext): Promise<ProofView> {
      let reason: string | null = null;
      if (input.decision === "REJECT") {
        const checked = validateRequiredFreeText(input.reason ?? "", TEXT_LIMITS.reason);
        if (!checked.ok) throw invalid("reason", FIELD_ERRORS[checked.error]);
        reason = checked.text;
      }
      return deps.withTransaction(async (trx) => {
        // 404 idêntico antes de qualquer outro erro (marcação de outro profissional, comprovativo de outra marcação).
        const booking = await deps.bookings.findForProfessional(trx, actor.professionalId, bookingId, true);
        if (!booking) throw notFound();
        await assertApproved(actor);
        const proof = await deps.proofs.findForBooking(trx, bookingId, proofId, true);
        if (!proof) throw notFound();
        if (proof.status !== "SUBMITTED") throw new DomainError("INVALID_STATE_TRANSITION", { detail: "O comprovativo já foi decidido." });
        if (proof.scanStatus !== "CLEAN" || proof.purgedAt !== null) throw new DomainError("DOCUMENT_NOT_AVAILABLE", { detail: "O comprovativo não está disponível." });
        const event: PaymentEvent = input.decision === "CONFIRM" ? "PROFESSIONAL_CONFIRM" : "PROFESSIONAL_REJECT";
        const check = nextPaymentStatus(booking.status, booking.paymentStatus, event);
        if (!check.ok) throw new DomainError("INVALID_STATE_TRANSITION", { detail: "A marcação não aceita esta decisão agora." });
        const at = deps.clock.now();
        await deps.proofs.markDecided(trx, proofId, { status: input.decision === "CONFIRM" ? "CONFIRMED" : "REJECTED", at, reason });
        await deps.bookings.setPaymentStatus(trx, bookingId, check.to, at);
        await deps.audit.record(trx, {
          occurredAt: at,
          actorType: "PROFESSIONAL_ACCOUNT",
          actorProfessionalAccountId: actor.professionalAccountId,
          action: "PROFESSIONAL_PAYMENT_PROOF_DECIDE",
          resourceType: "PaymentProof",
          resourceId: proofId,
          result: "SUCCESS",
          requestId: context.requestId,
          metadata: { bookingId, decision: input.decision },
          ...auditContextFields(context),
        } satisfies AuditEvent);
        await deps.alerts.raise(trx, { kind: "PAYMENT_UPDATED", bookingId, familyId: booking.familyId, memberId: booking.memberId, stateVersion: at.toISOString() });
        const updated = await deps.proofs.findForBooking(trx, bookingId, proofId, false);
        if (!updated) throw notFound();
        return toProofView(updated);
      });
    },
  };
}

/** Jobs (idempotentes; pg-boss pode entregar mais de uma vez). `PENDING → CLEAN | INFECTED` e a outbox `consultations.delete-files`. */
export const DELETE_FILES_BATCH = 50;
export const DELETE_FILES_MAX_ATTEMPTS = 10;

async function toBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}

export function createProofJobs<Trx>(deps: ProcessorFileDeps<Trx>) {
  return {
    /**
     * CLEAN: copia para a chave final; a quarentena apaga-se pela outbox. INFECTED conta como NÃO enviado (BR-MKT-57): o comprovativo apaga-se
     * (o trigger de BD enfileira o objeto) e, se o pagamento ainda estava em `PROOF_SUBMITTED` por causa dele, volta a `AWAITING_PROOF` (ou
     * `REJECTED` se houve rejeições antes) para a família poder carregar outro.
     */
    async scanProof(job: { proofId: string }): Promise<void> {
      await deps.withTransaction(async (trx) => {
        const peek = await deps.proofs.findForScan(trx, job.proofId);
        if (peek?.scanStatus !== "PENDING") return;
        // Ordem de bloqueios: marcação < comprovativo (igual ao upload e à decisão).
        const booking = await deps.bookings.findById(trx, peek.bookingId, true);
        const proof = await deps.proofs.findForBooking(trx, peek.bookingId, peek.id, true);
        if (proof?.scanStatus !== "PENDING") return; // idempotência: já tratado ou apagado entretanto
        const buffer = await toBuffer(await deps.fileStore.get(proof.storageKey));
        const at = deps.clock.now();
        if ((await deps.scanner.scan(buffer)) === "INFECTED") {
          await deps.proofs.deleteProof(trx, proof.id);
          if (booking?.paymentStatus === "PROOF_SUBMITTED") {
            const previous = (await deps.proofs.listForBooking(trx, proof.bookingId)).some((p) => p.status === "REJECTED" || p.status === "REJECTION_UPHELD");
            await deps.bookings.setPaymentStatus(trx, proof.bookingId, previous ? "REJECTED" : "AWAITING_PROOF", at);
          }
          return;
        }
        const kind = detectFileKind(buffer);
        if (!kind) throw new Error(`conteúdo deixou de corresponder a um tipo permitido: ${proof.id}`);
        const destination = finalKey(proof.id, kind);
        await deps.fileStore.copy(proof.storageKey, destination);
        await deps.proofs.markClean(trx, proof.id, destination, at);
        await deps.fileDeletions.enqueue(trx, proof.storageKey);
      });
    },

    async deleteFiles(): Promise<{ deleted: number; failed: number }> {
      return deps.withTransaction(async (trx) => {
        const pending = await deps.fileDeletions.listPending(trx, DELETE_FILES_BATCH, DELETE_FILES_MAX_ATTEMPTS);
        let deleted = 0;
        let failed = 0;
        for (const item of pending) {
          try {
            await deps.fileStore.delete(item.storageKey);
            await deps.fileDeletions.markDeleted(trx, item.id, deps.clock.now());
            deleted += 1;
          } catch {
            await deps.fileDeletions.recordFailure(trx, item.id);
            failed += 1;
          }
        }
        return { deleted, failed };
      });
    },
  };
}
