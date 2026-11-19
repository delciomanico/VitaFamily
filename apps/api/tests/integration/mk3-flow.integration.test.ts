/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return -- respostas HTTP/linhas SQL de teste sem tipagem (supertest devolve `any`). */
// Fluxo ponta a ponta de MK3 (TC-MKT-112; AC-MKT-44): PostgreSQL real, app real (validação de pedidos E respostas contra o openapi.yaml) e o
// relógio injetável do harness. A família marca, o profissional confirma (consulta gerada no registo do membro + alerta BOOKING_UPDATED),
// conclui, a família carrega o comprovativo (antivírus simulado), o profissional confirma, a família avalia, o profissional responde e o
// ranking v2 de `discovery` reflete as avaliações (3 marcações distintas ⇒ RATED). Variantes: disputa decidida pelo admin (CONFIRM_PAYMENT ⇒
// elegível para avaliação, OP-101) e profissional suspenso a meio (reconcile cancela as futuras; a leitura mantém-se). O harness não monta
// `GET /families/.../processes`: a fase do `Process` BOOKING lê-se da BD e deriva-se com as funções puras reais (`projectBookingPhase`,
// `deriveBookingHint`, `deriveFamilyStatus`), exatamente como `getActFacts` + `processes` fazem em produção.
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { deriveBookingHint, projectBookingPhase, type BookingPaymentStatus, type BookingStatus } from "../../src/modules/consultations/domain/index.js";
import { deriveFamilyStatus } from "../../src/modules/processes/domain/derive-family-status.js";
import { API, START } from "../support/professionals-harness.js";
import { startConsultationsHarness, type ConsultationsHarness, type OfferFixture, type ProfessionalFixture, type UserFixture } from "../support/consultations-harness.js";

type Res = request.Response;

const DAY = 86_400_000;
const HOUR = 3_600_000;

let c: ConsultationsHarness;
let admin: UserFixture;

const authOf = (token?: string): Record<string, string> => (token === undefined ? {} : { Authorization: `Bearer ${token}` });
const bookingsOf = (familyId: string, memberId: string): string => `${API}/families/${familyId}/members/${memberId}/bookings`;
const proBookings = `${API}/professional-portal/bookings`;
const bodyOf = (res: Res): Record<string, any> => res.body as Record<string, any>;
const pdf = (tag: string): Buffer => Buffer.from(`%PDF-1.4\n${tag}\n%%EOF\n`, "utf8");

async function ok(req: PromiseLike<Res>, status = 200): Promise<Res> {
  const res = await req;
  if (res.status !== status) throw new Error(`esperado ${String(status)}, recebido ${String(res.status)}: ${JSON.stringify(res.body)}`);
  return res;
}

interface Patient {
  u: UserFixture;
  fam: string;
  m: string;
}

let patientSeq = 0;
async function patient(): Promise<Patient> {
  const n = ++patientSeq;
  const u = await c.user(`fluxo${String(n)}`);
  const fam = await c.family(`Família fluxo ${String(n)}`);
  const m = await c.member(fam, { userId: u.id, role: "FAMILY_ADMIN", name: `Fluxo ${String(n)}` });
  return { u, fam, m };
}

interface World {
  pro: ProfessionalFixture;
  token: string;
  video: OfferFixture;
}

async function world(): Promise<World> {
  const pro = await c.professional({ paymentInstructions: "Transferência para a conta de teste (fluxo)." });
  return { pro, token: await c.professionalToken(pro.professionalId), video: await c.offer(pro, { method: "VIDEO", durationMinutes: 30, priceKz: 5000 }) };
}

/** Um dia por marcação (horas fixas): nunca há sobreposições no mesmo profissional nem no mesmo membro. Máximo 13 (janela de 14 dias dos horários). */
const startOf = (day: number): Date => new Date(START.getTime() + day * DAY + 3 * HOUR);

const proPost = (w: World, bookingId: string, action: string, payload: object = {}) => request(c.h.app).post(`${proBookings}/${bookingId}/${action}`).set(authOf(w.token)).send(payload);
const famGet = (pt: Patient, bookingId: string) => request(c.h.app).get(`${bookingsOf(pt.fam, pt.m)}/${bookingId}`).set(authOf(pt.u.token));
const putReview = (pt: Patient, bookingId: string, payload: object) => request(c.h.app).put(`${bookingsOf(pt.fam, pt.m)}/${bookingId}/review`).set(authOf(pt.u.token)).send(payload);
const upload = (pt: Patient, bookingId: string, tag: string) =>
  request(c.h.app).post(`${bookingsOf(pt.fam, pt.m)}/${bookingId}/payment-proofs`).set(authOf(pt.u.token)).attach("file", pdf(tag), { filename: "comprovativo.pdf", contentType: "application/pdf" });

/** Marca pela API: o horário aparece em `listBookableSlots` e a criação devolve `REQUESTED`. */
async function book(pt: Patient, w: World, day: number): Promise<{ id: string; slotId: string; body: Record<string, any> }> {
  const slotId = await c.slot(w.video, startOf(day));
  const slots = await ok(request(c.h.app).get(`${API}/marketplace/professionals/${w.pro.professionalId}/slots`).query({ offerId: w.video.id }).set(authOf(pt.u.token)));
  expect((slots.body as { id: string }[]).map((s) => s.id)).toContain(slotId);
  const created = await ok(request(c.h.app).post(bookingsOf(pt.fam, pt.m)).set(authOf(pt.u.token)).send({ offerId: w.video.id, slotId, participantLabel: "Ana (fluxo)" }), 201);
  return { id: bodyOf(created).id as string, slotId, body: bodyOf(created) };
}

interface BookingRow {
  status: BookingStatus;
  payment_status: BookingPaymentStatus;
  completed_at: Date | null;
  process_id: string | null;
  slot_id: string | null;
}

async function row(bookingId: string): Promise<BookingRow> {
  const { rows } = await c.h.pool.query<BookingRow>("SELECT status, payment_status, completed_at, process_id, slot_id FROM bookings WHERE id = $1", [bookingId]);
  const found = rows[0];
  if (!found) throw new Error("marcação inexistente");
  return found;
}

/** `phase`, `hint` e «o que falta» do `Process` BOOKING, a partir da BD com as funções puras de produção (state-machines.md 1b/2b). */
async function processView(bookingId: string): Promise<{ phase: string; hint: string | null; code: string; actor: string; familyStatus: string }> {
  const b = await row(bookingId);
  const review = await c.h.pool.query("SELECT 1 FROM reviews WHERE booking_id = $1", [bookingId]);
  const phase = projectBookingPhase(b.status);
  const hint = deriveBookingHint({ status: b.status, paymentStatus: b.payment_status, completedAtMs: b.completed_at?.getTime() ?? null, hasReview: review.rowCount === 1 }, c.h.clock.now().getTime());
  const view = deriveFamilyStatus({ act: { phase, source: "BOOKING", hint } });
  return { phase, hint, code: view.nextStep.code, actor: view.nextStep.actor, familyStatus: view.familyStatus };
}

async function audit(action: string, resourceId: string): Promise<{ actor_type: string; family_id: string | null; subject_member_id: string | null; metadata: Record<string, unknown> | null; result: string }[]> {
  const { rows } = await c.h.pool.query("SELECT actor_type, family_id, subject_member_id, metadata, result FROM audit_logs WHERE action = $1 AND resource_id = $2", [action, resourceId]);
  return rows;
}

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await c.h.pool.query<{ n: string }>(sql, params);
  return Number(rows[0]?.n ?? 0);
}

const lastAlert = (): ConsultationsHarness["alertCalls"][number] | undefined => c.alertCalls.at(-1);

/** Ciclo completo de uma marcação paga até ao comprovativo confirmado e à avaliação; verifica cada passo. */
async function fullCycle(w: World, day: number, rating: number, reply: boolean): Promise<{ pt: Patient; bookingId: string; reviewId: string }> {
  const pt = await patient();
  c.h.clock.set(START);
  c.alertCalls.length = 0;
  const { id: b, slotId, body } = await book(pt, w, day);

  // Marcação feita: REQUESTED, a pagar, Process BOOKING aberto na mesma transação, horário ocupado, aviso genérico ao profissional.
  expect(body).toMatchObject({ status: "REQUESTED", paymentStatus: "AWAITING_PROOF", priceKz: 5000, canCancel: true, canSendProof: false, canReview: false, appointmentId: null });
  expect(body.processId).toBeTruthy();
  expect(await count("SELECT count(*) AS n FROM processes WHERE origin_type = 'BOOKING' AND origin_id = $1 AND id = $2 AND family_id = $3 AND member_id = $4", [b, body.processId, pt.fam, pt.m])).toBe(1);
  expect((await c.h.pool.query("SELECT booking_id FROM professional_slots WHERE id = $1", [slotId])).rows[0]).toEqual({ booking_id: b });
  expect(c.noticeCalls.at(-1)).toEqual({ professionalId: w.pro.professionalId, bookingId: b, event: "BOOKING_REQUESTED" });
  expect(await processView(b)).toMatchObject({ phase: "PENDING", code: "AWAIT_PROFESSIONAL_RESPONSE", actor: "PROFESSIONAL" });
  const created = await audit("BOOKING_CREATE", b);
  expect(created).toHaveLength(1);
  expect(created[0]).toMatchObject({ actor_type: "USER", family_id: pt.fam, subject_member_id: pt.m, result: "SUCCESS", metadata: { professionalId: w.pro.professionalId, method: "VIDEO" } });

  // O profissional vê o pedido (só o rótulo, sem ids da família) e confirma com a ligação.
  const listed = await ok(request(c.h.app).get(proBookings).set(authOf(w.token)));
  expect((listed.body.items as { id: string }[]).map((i) => i.id)).toContain(b);
  const confirmed = await ok(proPost(w, b, "confirm", { meetingInfo: "https://meet.exemplo.ao/sala-fluxo" }));
  expect(bodyOf(confirmed)).toMatchObject({ status: "CONFIRMED", meetingInfo: "https://meet.exemplo.ao/sala-fluxo" });
  expect(JSON.stringify(confirmed.body)).not.toContain(pt.fam);
  expect(lastAlert()).toMatchObject({ kind: "BOOKING_UPDATED", bookingId: b, familyId: pt.fam, memberId: pt.m });
  const confirmAudit = await audit("PROFESSIONAL_BOOKING_CONFIRM", b);
  expect(confirmAudit).toHaveLength(1);
  expect(confirmAudit[0]).toMatchObject({ actor_type: "PROFESSIONAL_ACCOUNT", family_id: null, subject_member_id: null, metadata: { fromStatus: "REQUESTED", toStatus: "CONFIRMED" } });

  // Consulta criada no registo do membro (BR-MKT-55), ligada ao mesmo Process; a família vê o appointmentId e as instruções de pagamento.
  const appointment = await c.h.pool.query("SELECT family_id, member_id, status, process_id, scheduled_at FROM appointments WHERE booking_id = $1", [b]);
  expect(appointment.rows).toHaveLength(1);
  expect(appointment.rows[0]).toMatchObject({ family_id: pt.fam, member_id: pt.m, status: "SCHEDULED", process_id: body.processId });
  expect((appointment.rows[0].scheduled_at as Date).toISOString()).toBe(startOf(day).toISOString());
  const detail = bodyOf(await ok(famGet(pt, b)));
  expect(detail).toMatchObject({ status: "CONFIRMED", canSendProof: true, canCancel: true, paymentInstructions: "Transferência para a conta de teste (fluxo)." });
  expect(detail.appointmentId).toBeTruthy();
  expect(await processView(b)).toMatchObject({ phase: "SCHEDULED", hint: "PAYMENT_PROOF_DUE", code: "SEND_PAYMENT_PROOF", actor: "FAMILY" });

  // Chega a hora: o profissional conclui; a consulta gerada segue o estado da marcação.
  c.h.clock.set(new Date(startOf(day).getTime() + HOUR));
  await ok(proPost(w, b, "complete"));
  expect((await c.h.pool.query("SELECT status FROM appointments WHERE booking_id = $1", [b])).rows[0]).toEqual({ status: "COMPLETED" });
  expect((await row(b)).status).toBe("COMPLETED");
  expect(await processView(b)).toMatchObject({ phase: "DONE", hint: "PAYMENT_PROOF_DUE", code: "SEND_PAYMENT_PROOF", actor: "FAMILY" });
  expect((await audit("PROFESSIONAL_BOOKING_COMPLETE", b))[0]).toMatchObject({ metadata: { fromStatus: "CONFIRMED", toStatus: "COMPLETED" } });

  // Sem pagamento satisfeito não se avalia (BR-MKT-59); o comprovativo é aceite depois de concluída (BR-MKT-56).
  const early = await putReview(pt, b, { rating });
  expect(early.status).toBe(409);
  expect(bodyOf(early).code).toBe("REVIEW_NOT_ALLOWED");
  const proof = await ok(upload(pt, b, `fluxo-${String(day)}`), 201);
  const proofId = bodyOf(proof).id as string;
  expect(bodyOf(proof)).toMatchObject({ status: "SUBMITTED", scanStatus: "PENDING" });
  expect(c.noticeCalls.at(-1)).toEqual({ professionalId: w.pro.professionalId, bookingId: b, event: "PROOF_UPLOADED" });
  expect((await row(b)).payment_status).toBe("PROOF_SUBMITTED");
  expect(await processView(b)).toMatchObject({ hint: "PAYMENT_UNDER_REVIEW", code: "AWAIT_PAYMENT_CONFIRMATION", actor: "PROFESSIONAL" });
  // Antes do antivírus o profissional não pode decidir nem descarregar (fail-closed).
  const premature = await proPost(w, b, `payment-proofs/${proofId}/decision`, { decision: "CONFIRM" });
  expect(premature.status).toBe(409);
  expect(bodyOf(premature).code).toBe("DOCUMENT_NOT_AVAILABLE");
  await c.runProofScans();
  expect(bodyOf(await ok(request(c.h.app).get(`${bookingsOf(pt.fam, pt.m)}/${b}/payment-proofs`).set(authOf(pt.u.token))))[0]).toMatchObject({ id: proofId, scanStatus: "CLEAN" });

  await ok(proPost(w, b, `payment-proofs/${proofId}/decision`, { decision: "CONFIRM" }));
  expect(lastAlert()).toMatchObject({ kind: "PAYMENT_UPDATED", bookingId: b, familyId: pt.fam });
  expect((await row(b)).payment_status).toBe("CONFIRMED");
  expect((await audit("PROFESSIONAL_PAYMENT_PROOF_DECIDE", proofId))[0]).toMatchObject({ metadata: { bookingId: b, decision: "CONFIRM" } });
  expect((await audit("PAYMENT_PROOF_UPLOAD", proofId))[0]).toMatchObject({ actor_type: "USER", family_id: pt.fam, subject_member_id: pt.m, metadata: { bookingId: b } });
  expect(await processView(b)).toMatchObject({ phase: "DONE", hint: "REVIEW_DUE", code: "LEAVE_REVIEW", actor: "FAMILY" });
  expect(bodyOf(await ok(famGet(pt, b)))).toMatchObject({ paymentStatus: "CONFIRMED", canReview: true, hasReview: false });

  // Avaliação (anónima), resposta do profissional.
  const review = await ok(putReview(pt, b, { rating, comment: `Atendimento ${String(day)}` }), 201);
  expect(bodyOf(review)).toMatchObject({ bookingId: b, rating });
  const reviewId = (await c.h.pool.query<{ id: string }>("SELECT id FROM reviews WHERE booking_id = $1", [b])).rows[0]?.id ?? "";
  expect(c.noticeCalls.at(-1)).toEqual({ professionalId: w.pro.professionalId, bookingId: b, event: "REVIEW_CREATED" });
  expect((await audit("REVIEW_CREATE", reviewId))[0]).toMatchObject({ actor_type: "USER", family_id: pt.fam, metadata: { bookingId: b } });
  expect(await processView(b)).toMatchObject({ phase: "DONE", hint: null, code: "NOTHING_PENDING", actor: "NONE" });
  expect(bodyOf(await ok(famGet(pt, b)))).toMatchObject({ canReview: false, hasReview: true });
  if (reply) {
    const replied = await ok(request(c.h.app).post(`${API}/professional-portal/reviews/${reviewId}/reply`).set(authOf(w.token)).send({ text: "Obrigada pela confiança." }), 201);
    expect(bodyOf(replied).reply.text).toBe("Obrigada pela confiança.");
    expect((await audit("PROFESSIONAL_REVIEW_REPLY", reviewId))[0]).toMatchObject({ actor_type: "PROFESSIONAL_ACCOUNT", family_id: null });
  }
  c.h.clock.set(START);
  return { pt, bookingId: b, reviewId };
}

async function discoveryItem(token: string, w: World): Promise<Record<string, any>> {
  const res = await ok(request(c.h.app).get(`${API}/marketplace/professionals`).query({ specialtyId: w.video.specialtyId }).set(authOf(token)));
  const item = (res.body.items as Record<string, any>[]).find((i) => i.id === w.pro.professionalId);
  if (!item) throw new Error("profissional ausente da descoberta");
  return item;
}

beforeAll(async () => {
  c = await startConsultationsHarness();
  admin = await c.admin();
}, 300_000);

afterAll(async () => {
  await c.stop();
});

beforeEach(() => {
  c.h.clock.set(START);
  c.proofQueue.splice(0);
});

describe("TC-MKT-112 / AC-MKT-44: fluxo feliz com relógio injetável e ranking v2", () => {
  it("marcar → confirmar → concluir → comprovativo → confirmar → avaliar → responder; 3 marcações distintas ⇒ RATED na descoberta", async () => {
    const w = await world();
    const reader = await c.user("leitor-fluxo");
    const first = await fullCycle(w, 3, 5, true);

    // Com 1 avaliação: «Novo» e sem média pública (BR-MKT-61); o resumo conta a avaliação.
    let item = await discoveryItem(reader.token, w);
    expect(item.reviewSummary).toEqual({ count: 1, averageRating: null });
    expect(item.ranking).toMatchObject({ version: "v2", label: "NEW" });
    expect(item.ranking.signals.reviews).toBe(0.5);

    await fullCycle(w, 5, 4, false);
    item = await discoveryItem(reader.token, w);
    expect(item.reviewSummary.count).toBe(2);
    expect(item.ranking.label).toBe("NEW");

    await fullCycle(w, 7, 5, false);
    item = await discoveryItem(reader.token, w);
    expect(item.reviewSummary).toEqual({ count: 3, averageRating: 4.7 });
    expect(item.ranking).toMatchObject({ version: "v2", label: "RATED" });
    expect(item.ranking.signals.reviews).toBeGreaterThan(0.5);

    // A resposta aparece na lista pública e na do profissional; o autor da avaliação não é identificável.
    const publicList = await ok(request(c.h.app).get(`${API}/marketplace/professionals/${w.pro.professionalId}/reviews`).set(authOf(reader.token)));
    expect(publicList.body.summary).toEqual({ count: 3, averageRating: 4.7 });
    const answered = (publicList.body.items as Record<string, any>[]).find((i) => i.id === first.reviewId);
    expect(answered?.reply?.text).toBe("Obrigada pela confiança.");
    for (const forbidden of [first.pt.fam, first.pt.m, first.pt.u.id, first.bookingId]) expect(JSON.stringify(publicList.body)).not.toContain(forbidden);
    const own = await ok(request(c.h.app).get(`${API}/professional-portal/reviews`).query({ unanswered: true }).set(authOf(w.token)));
    expect((own.body.items as unknown[]).length).toBe(2);

    // Marcação de outro profissional/família não altera o resumo deste (isolamento do agregado).
    const other = await world();
    expect((await discoveryItem(reader.token, other)).reviewSummary).toEqual({ count: 0, averageRating: null });
  }, 240_000);
});

describe("TC-MKT-112: variante com disputa decidida pelo admin (OP-101)", () => {
  it("comprovativo rejeitado → disputa → marcação concluída sem pagamento satisfeito (não avalia) → CONFIRM_PAYMENT ⇒ elegível e avaliada", async () => {
    const w = await world();
    const pt = await patient();
    const { id: b } = await book(pt, w, 3);
    await ok(proPost(w, b, "confirm", { meetingInfo: "ligar +244 900 000 000" }));
    const proofId = bodyOf(await ok(upload(pt, b, "disputa"), 201)).id as string;
    await c.runProofScans();
    await ok(proPost(w, b, `payment-proofs/${proofId}/decision`, { decision: "REJECT", reason: "Valor diferente do combinado." }));
    expect(await processView(b)).toMatchObject({ phase: "SCHEDULED", hint: "PAYMENT_PROOF_DUE", code: "SEND_PAYMENT_PROOF" });
    const disputed = await ok(request(c.h.app).post(`${bookingsOf(pt.fam, pt.m)}/${b}/payment-proofs/${proofId}/dispute`).set(authOf(pt.u.token)).send({ note: "Paguei o valor certo." }));
    expect(bodyOf(disputed)).toMatchObject({ status: "DISPUTED", disputeNote: "Paguei o valor certo.", decisionReason: "Valor diferente do combinado." });
    expect(c.noticeCalls.at(-1)).toEqual({ professionalId: w.pro.professionalId, bookingId: b, event: "DISPUTE_OPENED" });
    expect(await processView(b)).toMatchObject({ hint: "PAYMENT_DISPUTED", code: "AWAIT_PAYMENT_DISPUTE_DECISION", actor: "PLATFORM" });

    // A consulta realiza-se com a disputa em aberto: concluir não depende do pagamento, mas avaliar sim.
    c.h.clock.set(new Date(startOf(3).getTime() + HOUR));
    await ok(proPost(w, b, "complete"));
    const blocked = await putReview(pt, b, { rating: 5 });
    expect(blocked.status).toBe(409);
    expect(bodyOf(blocked).code).toBe("REVIEW_NOT_ALLOWED");
    expect(await count("SELECT count(*) AS n FROM reviews WHERE booking_id = $1", [b])).toBe(0);

    // O admin vê a disputa, descarrega o ficheiro (auditado) e confirma o pagamento.
    expect(bodyOf(await ok(request(c.h.app).get(`/api/v1/admin/payment-disputes/${proofId}`).set(authOf(admin.token))))).toMatchObject({ status: "DISPUTED", familyNote: "Paguei o valor certo." });
    await ok(request(c.h.app).get(`/api/v1/admin/payment-disputes/${proofId}/file`).set(authOf(admin.token)).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (d: Buffer) => {
        chunks.push(d);
      });
      res.on("end", () => {
        cb(null, Buffer.concat(chunks));
      });
    }));
    await ok(request(c.h.app).post(`/api/v1/admin/payment-disputes/${proofId}/decisions`).set(authOf(admin.token)).send({ decision: "CONFIRM_PAYMENT" }));
    expect(lastAlert()).toMatchObject({ kind: "PAYMENT_UPDATED", bookingId: b, familyId: pt.fam });
    expect(c.noticeCalls.at(-1)).toEqual({ professionalId: w.pro.professionalId, bookingId: b, event: "DISPUTE_DECIDED" });
    expect((await row(b)).payment_status).toBe("CONFIRMED");
    expect(await processView(b)).toMatchObject({ phase: "DONE", hint: "REVIEW_DUE", code: "LEAVE_REVIEW" });
    for (const action of ["PAYMENT_PROOF_DISPUTE", "ADMIN_PAYMENT_DISPUTE_VIEW", "ADMIN_PAYMENT_PROOF_DOWNLOAD", "ADMIN_PAYMENT_DISPUTE_DECIDE"]) {
      expect((await audit(action, proofId)).length, action).toBeGreaterThanOrEqual(1);
    }
    expect((await audit("ADMIN_PAYMENT_DISPUTE_DECIDE", proofId))[0]).toMatchObject({ actor_type: "PLATFORM_ADMIN", metadata: { bookingId: b, decision: "CONFIRM_PAYMENT" } });

    // OP-101: agora a marcação é elegível e a avaliação cria-se.
    expect(bodyOf(await ok(famGet(pt, b)))).toMatchObject({ canReview: true });
    await ok(putReview(pt, b, { rating: 3, comment: "Resolvido." }), 201);
    expect(await processView(b)).toMatchObject({ hint: null, code: "NOTHING_PENDING" });
  }, 180_000);
});

describe("TC-MKT-112: variante com profissional suspenso a meio", () => {
  it("o reconcile cancela as marcações futuras (REQUESTED e CONFIRMED), liberta horários e a leitura da família mantém-se", async () => {
    const w = await world();
    const pt = await patient();
    const requested = await book(pt, w, 3);
    const confirmed = await book(pt, w, 4);
    await ok(proPost(w, confirmed.id, "confirm", { meetingInfo: "sala fluxo" }));
    const done = await book(pt, w, 2);
    await ok(proPost(w, done.id, "confirm", { meetingInfo: "sala fluxo 2" }));
    c.h.clock.set(new Date(startOf(2).getTime() + HOUR));
    await ok(proPost(w, done.id, "complete"));
    c.h.clock.set(START);

    // Suspensão pelo admin (estado de MK1): o profissional deixa de poder alterar marcações mas continua a lê-las.
    await c.h.pool.query("UPDATE professionals SET validation_status = 'SUSPENDED' WHERE id = $1", [w.pro.professionalId]);
    const locked = await proPost(w, requested.id, "confirm", { meetingInfo: "x" });
    expect(locked.status).toBe(409);
    expect(bodyOf(locked).code).toBe("PROFESSIONAL_LOCKED");
    expect((await ok(request(c.h.app).get(`${proBookings}/${requested.id}`).set(authOf(w.token)))).body.status).toBe("REQUESTED");

    c.alertCalls.length = 0;
    c.h.clock.set(new Date(START.getTime() + HOUR));
    expect(await c.maintenance.reconcileBookings()).toBe(2);
    expect(await c.maintenance.reconcileBookings()).toBe(0); // idempotente

    for (const b of [requested, confirmed]) {
      expect(await row(b.id)).toMatchObject({ status: "CANCELLED", slot_id: null });
      expect((await c.h.pool.query("SELECT cancelled_by, system_reason FROM bookings WHERE id = $1", [b.id])).rows[0]).toEqual({ cancelled_by: "SYSTEM", system_reason: "PROFESSIONAL_UNAVAILABLE" });
      expect((await c.h.pool.query("SELECT booking_id FROM professional_slots WHERE id = $1", [b.slotId])).rows[0]).toEqual({ booking_id: null });
      const a = await audit("BOOKING_AUTO_CANCEL", b.id);
      expect(a).toHaveLength(1);
      expect(a[0]).toMatchObject({ actor_type: "SYSTEM", family_id: pt.fam, subject_member_id: pt.m, metadata: { systemReason: "PROFESSIONAL_UNAVAILABLE" } });
      expect(c.alertCalls.filter((x) => x.bookingId === b.id)).toMatchObject([{ kind: "BOOKING_UPDATED", familyId: pt.fam, memberId: pt.m }]);
      expect(await processView(b.id)).toMatchObject({ phase: "CANCELLED", code: "NOTHING_PENDING" });
    }
    expect((await c.h.pool.query("SELECT status FROM appointments WHERE booking_id = $1", [confirmed.id])).rows[0]).toEqual({ status: "CANCELLED" });
    // A marcação já concluída não é tocada.
    expect((await row(done.id)).status).toBe("COMPLETED");

    // Leitura mantida para a família (detalhe e lista), com o motivo do sistema.
    const detail = bodyOf(await ok(famGet(pt, confirmed.id)));
    expect(detail).toMatchObject({ status: "CANCELLED", cancelledBy: "SYSTEM", systemReason: "PROFESSIONAL_UNAVAILABLE", canCancel: false });
    const list = await ok(request(c.h.app).get(bookingsOf(pt.fam, pt.m)).set(authOf(pt.u.token)));
    expect((list.body.items as { id: string }[]).map((i) => i.id).sort()).toEqual([requested.id, confirmed.id, done.id].sort());
    // O profissional suspenso continua a ler as suas marcações e a nova marcação deste profissional já não é possível (404 indistinguível).
    expect((await ok(request(c.h.app).get(proBookings).query({ status: "CANCELLED" }).set(authOf(w.token)))).body.items).toHaveLength(2);
    const another = await patient();
    const freeSlot = await c.slot(w.video, startOf(9));
    const refused = await request(c.h.app).post(bookingsOf(another.fam, another.m)).set(authOf(another.u.token)).send({ offerId: w.video.id, slotId: freeSlot, participantLabel: "Outra" });
    expect(refused.status).toBe(404);
  }, 180_000);
});
