// Corpos JSON de respostas HTTP lidos de forma dinâmica nos testes (`unknown` com casts explícitos).
// Integração (PostgreSQL real, app real com validação de pedidos E respostas) das NOTIFICAÇÕES de `consultations` (MK3 S11; BR-MKT-54/65):
// alertas à família na MESMA transação (`BOOKING_UPDATED`/`PAYMENT_UPDATED`, só ids e versão), avisos genéricos ao profissional DEPOIS do
// commit (`ProfessionalNoticeEvent`), job `notify-professional` (envio, SKIPPED, falha sem vazar e-mail, retry), reconciliação das marcações
// (pedido caducado, profissional indisponível, OP-97, idempotência, concorrência) e reenfileiramento do antivírus (OP-114 iii).
// O relógio do harness começa em `START` e cada `it` volta a ele. Ficheiros fake em memória; BD real (partilhada pelos `it` do ficheiro).
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { API, START } from "../support/professionals-harness.js";
import { startConsultationsHarness, type ConsultationsHarness, type OfferFixture, type ProfessionalFixture, type UserFixture } from "../support/consultations-harness.js";

const HOUR = 3_600_000;
const DAY = 86_400_000;
const MIN = 60_000;
/** Rótulo do participante (dado do profissional, texto livre): nunca sai nos alertas nem nos avisos (BR-MKT-63/65). */
const LABEL_CANARY = "rotulo-canario-s11";
const REASON = "Transferência não encontrada no extrato.";

let c: ConsultationsHarness;
let admin: UserFixture;

const bodyOf = (res: { body: unknown }): Record<string, unknown> => res.body as Record<string, unknown>;
const authOf = (token?: string): Record<string, string> => (token === undefined ? {} : { Authorization: `Bearer ${token}` });
const bookingsOf = (familyId: string, memberId: string): string => `${API}/families/${familyId}/members/${memberId}/bookings`;
const proofsOf = (familyId: string, memberId: string, bookingId: string): string => `${bookingsOf(familyId, memberId)}/${bookingId}/payment-proofs`;
const reviewOf = (familyId: string, memberId: string, bookingId: string): string => `${bookingsOf(familyId, memberId)}/${bookingId}/review`;
const proBookings = `${API}/professional-portal/bookings`;
const adminDisputes = `${API}/admin/payment-disputes`;

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await c.h.pool.query<{ n: number }>(sql, params);
  return rows[0]?.n ?? 0;
}

/** Marcações canceladas pelo sistema (conta global; a BD é partilhada, por isso as contagens são sempre por delta). */
const systemCancels = (): Promise<number> => count("SELECT count(*)::int AS n FROM bookings WHERE cancelled_by = 'SYSTEM'");

interface BookingDb {
  status: string;
  cancelled_by: string | null;
  system_reason: string | null;
  slot_id: string | null;
}

async function bookingRow(id: string): Promise<BookingDb> {
  const { rows } = await c.h.pool.query<BookingDb>("SELECT status, cancelled_by, system_reason, slot_id FROM bookings WHERE id = $1", [id]);
  const row = rows[0];
  if (!row) throw new Error(`marcação ${id} inexistente`);
  return row;
}

/** `booking_id` do horário (`null` ⇒ libertado). */
async function slotOwner(slotId: string): Promise<string | null | undefined> {
  const { rows } = await c.h.pool.query<{ booking_id: string | null }>("SELECT booking_id FROM professional_slots WHERE id = $1", [slotId]);
  return rows[0]?.booking_id;
}

async function appointmentStatuses(bookingId: string): Promise<string[]> {
  const { rows } = await c.h.pool.query<{ status: string }>("SELECT status FROM appointments WHERE booking_id = $1", [bookingId]);
  return rows.map((r) => r.status);
}

async function auditOf(action: string, resourceId: string): Promise<{ actor_type: string; metadata: unknown }[]> {
  const { rows } = await c.h.pool.query<{ actor_type: string; metadata: unknown }>("SELECT actor_type, metadata FROM audit_logs WHERE action = $1 AND resource_id = $2", [action, resourceId]);
  return rows;
}

async function scanStatusOf(proofId: string): Promise<string> {
  const { rows } = await c.h.pool.query<{ scan_status: string }>("SELECT scan_status FROM payment_proofs WHERE id = $1", [proofId]);
  return rows[0]?.scan_status ?? "";
}

/** Corre o job de reconciliação e confirma que a contagem devolvida é exatamente o que ele cancelou. */
async function reconcile(): Promise<number> {
  const before = await systemCancels();
  const returned = await c.maintenance.reconcileBookings();
  expect(returned).toBe((await systemCancels()) - before);
  return returned;
}

/** Início distinto por marcação (3 a 47 dias depois de START, às 3 h): dentro da janela máxima de 8 semanas e sem sobreposições. */
let daySeq = 0;
function startsAtSlot(): Date {
  const i = daySeq++;
  return new Date(START.getTime() + (3 + (i % 45)) * DAY + 3 * HOUR);
}

/** Profissional APPROVED com token de vida longa; ofertas gratuitas (presencial, sem comprovativo) e paga (vídeo, 5000 Kz). */
interface World {
  pro: ProfessionalFixture;
  token: string;
  inPerson: OfferFixture;
  video: OfferFixture;
}

async function world(): Promise<World> {
  const pro = await c.professional();
  return {
    pro,
    token: await c.professionalToken(pro.professionalId),
    inPerson: await c.offer(pro, { method: "IN_PERSON", durationMinutes: 45, priceKz: 0 }),
    video: await c.offer(pro, { method: "VIDEO", durationMinutes: 30, priceKz: 5000 }),
  };
}

/** Membro-sujeito SELF (adulto com conta), numa família própria. */
interface Patient {
  u: UserFixture;
  fam: string;
  m: string;
}

let patientSeq = 0;
async function patient(): Promise<Patient> {
  const n = ++patientSeq;
  const u = await c.user(`notificado${String(n)}`);
  const fam = await c.family(`Família S11 ${String(n)}`);
  const m = await c.member(fam, { userId: u.id, role: "FAMILY_ADMIN", name: `Notificado ${String(n)}` });
  return { u, fam, m };
}

/** Marcação criada PELA API da família (REQUESTED); o pedido leva o rótulo canário. */
async function createdId(pt: Patient, offer: OfferFixture, startsAt: Date = startsAtSlot()): Promise<string> {
  const slotId = await c.slot(offer, startsAt);
  const res = await request(c.h.app)
    .post(bookingsOf(pt.fam, pt.m))
    .set(authOf(pt.u.token))
    .send({ offerId: offer.id, slotId, participantLabel: LABEL_CANARY });
  if (res.status !== 201) throw new Error(`criação falhou: ${String(res.status)} ${JSON.stringify(res.body)}`);
  return String(bodyOf(res).id);
}

/** Marcação paga CONFIRMED gerada por SQL (sem Process), para comprovativos e disputas. */
async function paidBooking(pt: Patient, offer: OfferFixture): Promise<string> {
  const { bookingId } = await c.seedBooking({ familyId: pt.fam, memberId: pt.m, offer, startsAt: startsAtSlot(), status: "CONFIRMED", createdByUserId: pt.u.id, label: LABEL_CANARY });
  return bookingId;
}

/** Marcação gratuita concluída (elegível a avaliação) em `START`. */
async function completedBooking(pt: Patient, offer: OfferFixture): Promise<string> {
  const { bookingId } = await c.seedBooking({ familyId: pt.fam, memberId: pt.m, offer, startsAt: startsAtSlot(), status: "CONFIRMED", createdByUserId: pt.u.id });
  await c.h.pool.query("UPDATE bookings SET status = 'COMPLETED', completed_at = $2 WHERE id = $1", [bookingId, c.h.clock.now().toISOString()]);
  return bookingId;
}

type ProAction = "confirm" | "reject" | "cancel";
function proAct(w: World, id: string, action: ProAction) {
  const body = action === "confirm" ? {} : { reason: "Motivo do profissional." };
  return request(c.h.app).post(`${proBookings}/${id}/${action}`).set(authOf(w.token)).send(body);
}

function familyCancel(pt: Patient, id: string) {
  return request(c.h.app).post(`${bookingsOf(pt.fam, pt.m)}/${id}/cancel`).set(authOf(pt.u.token)).send({});
}

function upload(pt: Patient, bookingId: string, file: Buffer) {
  return request(c.h.app)
    .post(proofsOf(pt.fam, pt.m, bookingId))
    .set(authOf(pt.u.token))
    .attach("file", file, { filename: "comprovativo.pdf", contentType: "application/pdf" });
}

/** Conteúdo PDF válido (assinatura `%PDF-`) com uma marca para distinguir ficheiros. */
const pdf = (tag: string): Buffer => Buffer.from(`%PDF-1.4\n${tag}\n%%EOF\n`, "utf8");

/** Upload aceite (201) sem correr o antivírus: o comprovativo fica `PENDING`. */
async function uploadOnly(pt: Patient, bookingId: string, tag: string): Promise<string> {
  const res = await upload(pt, bookingId, pdf(tag));
  if (res.status !== 201) throw new Error(`upload falhou: ${String(res.status)} ${JSON.stringify(res.body)}`);
  return String(bodyOf(res).id);
}

/** Upload seguido do antivírus: o comprovativo fica `CLEAN`. */
async function uploadClean(pt: Patient, bookingId: string, tag: string): Promise<string> {
  const proofId = await uploadOnly(pt, bookingId, tag);
  await c.runProofScans();
  return proofId;
}

function decide(w: World, bookingId: string, proofId: string, payload: object) {
  return request(c.h.app).post(`${proBookings}/${bookingId}/payment-proofs/${proofId}/decision`).set(authOf(w.token)).send(payload);
}

/** Comprovativo REJECTED pelo profissional (upload, antivírus e rejeição). */
async function rejectedProof(w: World, pt: Patient, bookingId: string): Promise<string> {
  const p = await uploadClean(pt, bookingId, "rejeitado");
  const res = await decide(w, bookingId, p, { decision: "REJECT", reason: REASON });
  if (res.status !== 200) throw new Error(`rejeição falhou: ${String(res.status)} ${JSON.stringify(res.body)}`);
  return p;
}

function disputeFamily(pt: Patient, bookingId: string, proofId: string) {
  return request(c.h.app).post(`${proofsOf(pt.fam, pt.m, bookingId)}/${proofId}/dispute`).set(authOf(pt.u.token)).send({});
}

/** Comprovativo REJECTED e já em disputa da família. */
async function disputedProof(w: World, pt: Patient, bookingId: string): Promise<string> {
  const p = await rejectedProof(w, pt, bookingId);
  const res = await disputeFamily(pt, bookingId, p);
  if (res.status !== 200) throw new Error(`disputa falhou: ${String(res.status)} ${JSON.stringify(res.body)}`);
  return p;
}

function adminDecide(proofId: string, decision: string) {
  return request(c.h.app).post(`${adminDisputes}/${proofId}/decisions`).set(authOf(admin.token)).send({ decision });
}

function putReview(pt: Patient, bookingId: string, payload: object) {
  return request(c.h.app).put(reviewOf(pt.fam, pt.m, bookingId)).set(authOf(pt.u.token)).send(payload);
}

/** Erro lançado por uma promessa (ou `undefined` se resolver), para inspecionar a mensagem. */
async function errorOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return undefined;
  } catch (error: unknown) {
    return error;
  }
}

/** Alerta sem a versão (`stateVersion`, instante gerado pelo relógio, verificado à parte): só ids e tipo. */
const alertView = (a: { kind: string; bookingId: string; familyId: string; memberId: string }) => ({ kind: a.kind, bookingId: a.bookingId, familyId: a.familyId, memberId: a.memberId });

beforeAll(async () => {
  c = await startConsultationsHarness();
  admin = await c.admin();
}, 300_000);

afterAll(async () => {
  await c.stop();
});

beforeEach(() => {
  c.h.clock.set(START);
  c.alertCalls.length = 0;
  c.noticeCalls.length = 0;
  c.mails.length = 0;
  c.failMail.value = false;
});

describe("alertas à família na mesma transação (BR-MKT-65; TC-MKT-87)", () => {
  it("profissional CONFIRMA ⇒ 1 alerta BOOKING_UPDATED com bookingId, familyId e memberId certos; criar pela família não alerta", async () => {
    const w = await world();
    const pt = await patient();
    const b = await createdId(pt, w.inPerson);
    expect(c.alertCalls).toEqual([]);

    expect((await proAct(w, b, "confirm")).status).toBe(200);
    expect(c.alertCalls.map(alertView)).toEqual([{ kind: "BOOKING_UPDATED", bookingId: b, familyId: pt.fam, memberId: pt.m }]);
    expect(typeof c.alertCalls[0]?.stateVersion).toBe("string");
  });

  it("profissional RECUSA ⇒ 1 alerta BOOKING_UPDATED", async () => {
    const w = await world();
    const pt = await patient();
    const b = await createdId(pt, w.inPerson);

    expect((await proAct(w, b, "reject")).status).toBe(200);
    expect(c.alertCalls.map(alertView)).toEqual([{ kind: "BOOKING_UPDATED", bookingId: b, familyId: pt.fam, memberId: pt.m }]);
  });

  it("profissional CANCELA (pedido e confirmada) ⇒ um alerta BOOKING_UPDATED por marcação", async () => {
    const w = await world();
    const pt = await patient();
    const requested = await createdId(pt, w.inPerson);
    const confirmed = await createdId(pt, w.inPerson);
    expect((await proAct(w, confirmed, "confirm")).status).toBe(200);
    c.alertCalls.length = 0;

    expect((await proAct(w, requested, "cancel")).status).toBe(200);
    expect((await proAct(w, confirmed, "cancel")).status).toBe(200);
    expect(c.alertCalls.map((a) => [a.kind, a.bookingId])).toEqual([
      ["BOOKING_UPDATED", requested],
      ["BOOKING_UPDATED", confirmed],
    ]);
  });

  it("profissional rejeita e depois confirma um comprovativo ⇒ PAYMENT_UPDATED em cada decisão; o upload da família não alerta", async () => {
    const w = await world();
    const pt = await patient();
    const b = await paidBooking(pt, w.video);

    const p1 = await uploadClean(pt, b, "primeiro");
    expect(c.alertCalls).toEqual([]);
    expect((await decide(w, b, p1, { decision: "REJECT", reason: REASON })).status).toBe(200);
    expect(c.alertCalls.map((a) => a.kind)).toEqual(["PAYMENT_UPDATED"]);

    const p2 = await uploadClean(pt, b, "segundo");
    expect((await decide(w, b, p2, { decision: "CONFIRM" })).status).toBe(200);
    expect(c.alertCalls.map((a) => a.kind)).toEqual(["PAYMENT_UPDATED", "PAYMENT_UPDATED"]);
    expect(c.alertCalls.every((a) => a.bookingId === b && a.familyId === pt.fam && a.memberId === pt.m)).toBe(true);
  });

  it("admin decide a disputa ⇒ PAYMENT_UPDATED; a abertura da disputa pela família não alerta", async () => {
    const w = await world();
    const pt = await patient();
    const b = await paidBooking(pt, w.video);
    const p = await rejectedProof(w, pt, b);
    c.alertCalls.length = 0;

    expect((await disputeFamily(pt, b, p)).status).toBe(200);
    expect(c.alertCalls).toEqual([]);

    expect((await adminDecide(p, "UPHOLD_REJECTION")).status).toBe(200);
    expect(c.alertCalls.map(alertView)).toEqual([{ kind: "PAYMENT_UPDATED", bookingId: b, familyId: pt.fam, memberId: pt.m }]);
  });

  it("ações da própria família (criar, cancelar, upload, disputar, avaliar) NÃO geram alerta à família", async () => {
    const w = await world();
    const pt = await patient();
    const b = await createdId(pt, w.inPerson);
    expect(c.alertCalls).toEqual([]);

    expect((await familyCancel(pt, b)).status).toBe(200);
    expect(c.alertCalls).toEqual([]);

    const paid = await paidBooking(pt, w.video);
    const p = await uploadClean(pt, paid, "familia");
    expect(c.alertCalls).toEqual([]);
    expect((await decide(w, paid, p, { decision: "REJECT", reason: REASON })).status).toBe(200);
    c.alertCalls.length = 0;

    expect((await disputeFamily(pt, paid, p)).status).toBe(200);
    expect(c.alertCalls).toEqual([]);

    const done = await completedBooking(pt, w.inPerson);
    expect((await putReview(pt, done, { rating: 4 })).status).toBe(201);
    expect(c.alertCalls).toEqual([]);
  });

  it("pedido que falha (409 INVALID_STATE_TRANSITION) não deixa alerta: a transação não chega a alertar", async () => {
    const w = await world();
    const pt = await patient();
    const b = await createdId(pt, w.inPerson);
    expect((await familyCancel(pt, b)).status).toBe(200);

    const confirm = await proAct(w, b, "confirm");
    expect(confirm.status).toBe(409);
    expect(bodyOf(confirm).code).toBe("INVALID_STATE_TRANSITION");
    const reject = await proAct(w, b, "reject");
    expect(reject.status).toBe(409);
    expect(c.alertCalls).toEqual([]);
  });

  it("o alerta só leva as 5 chaves do contrato (sem texto livre nem rótulo)", async () => {
    const w = await world();
    const pt = await patient();
    const b = await createdId(pt, w.inPerson);
    expect((await proAct(w, b, "confirm")).status).toBe(200);

    expect(c.alertCalls).toHaveLength(1);
    expect(Object.keys(c.alertCalls[0] ?? {}).sort()).toEqual(["bookingId", "familyId", "kind", "memberId", "stateVersion"]);
    expect(JSON.stringify(c.alertCalls)).not.toContain(LABEL_CANARY);
  });
});

describe("avisos ao profissional depois do commit (BR-MKT-65; TC-MKT-103)", () => {
  it("criar marcação ⇒ BOOKING_REQUESTED com o professionalId certo; replay idempotente (mesmo clientRequestId, 200) NÃO enfileira de novo", async () => {
    const w = await world();
    const pt = await patient();
    const slotId = await c.slot(w.inPerson, startsAtSlot());
    const clientRequestId = randomUUID();
    const body = { offerId: w.inPerson.id, slotId, participantLabel: LABEL_CANARY, clientRequestId };

    const first = await request(c.h.app).post(bookingsOf(pt.fam, pt.m)).set(authOf(pt.u.token)).send(body);
    expect(first.status).toBe(201);
    const b = String(bodyOf(first).id);
    expect(c.noticeCalls).toEqual([{ professionalId: w.pro.professionalId, bookingId: b, event: "BOOKING_REQUESTED" }]);

    const replay = await request(c.h.app).post(bookingsOf(pt.fam, pt.m)).set(authOf(pt.u.token)).send(body);
    expect(replay.status).toBe(200);
    expect(String(bodyOf(replay).id)).toBe(b);
    expect(c.noticeCalls).toHaveLength(1);
    expect(JSON.stringify(c.noticeCalls)).not.toContain(LABEL_CANARY);
  });

  it("cancelar pela família ⇒ BOOKING_CANCELLED", async () => {
    const w = await world();
    const pt = await patient();
    const b = await createdId(pt, w.inPerson);
    c.noticeCalls.length = 0;

    expect((await familyCancel(pt, b)).status).toBe(200);
    expect(c.noticeCalls).toEqual([{ professionalId: w.pro.professionalId, bookingId: b, event: "BOOKING_CANCELLED" }]);
  });

  it("upload de comprovativo ⇒ PROOF_UPLOADED", async () => {
    const w = await world();
    const pt = await patient();
    const b = await paidBooking(pt, w.video);

    await uploadOnly(pt, b, "aviso");
    expect(c.noticeCalls).toEqual([{ professionalId: w.pro.professionalId, bookingId: b, event: "PROOF_UPLOADED" }]);
  });

  it("disputa da família ⇒ DISPUTE_OPENED", async () => {
    const w = await world();
    const pt = await patient();
    const b = await paidBooking(pt, w.video);
    const p = await rejectedProof(w, pt, b);
    c.noticeCalls.length = 0;

    expect((await disputeFamily(pt, b, p)).status).toBe(200);
    expect(c.noticeCalls).toEqual([{ professionalId: w.pro.professionalId, bookingId: b, event: "DISPUTE_OPENED" }]);
  });

  it("decisão do admin sobre a disputa ⇒ DISPUTE_DECIDED", async () => {
    const w = await world();
    const pt = await patient();
    const b = await paidBooking(pt, w.video);
    const p = await disputedProof(w, pt, b);
    c.noticeCalls.length = 0;

    expect((await adminDecide(p, "CONFIRM_PAYMENT")).status).toBe(200);
    expect(c.noticeCalls).toEqual([{ professionalId: w.pro.professionalId, bookingId: b, event: "DISPUTE_DECIDED" }]);
  });

  it("nova avaliação (201) ⇒ REVIEW_CREATED; editar (200) NÃO gera aviso", async () => {
    const w = await world();
    const pt = await patient();
    const b = await completedBooking(pt, w.inPerson);

    expect((await putReview(pt, b, { rating: 3 })).status).toBe(201);
    expect(c.noticeCalls).toEqual([{ professionalId: w.pro.professionalId, bookingId: b, event: "REVIEW_CREATED" }]);

    const edit = await putReview(pt, b, { rating: 5, comment: "Editada." });
    expect(edit.status).toBe(200);
    expect(c.noticeCalls).toHaveLength(1);
  });

  it("pedido falhado não enfileira: cancelar outra vez ⇒ 409 e nenhum aviso", async () => {
    const w = await world();
    const pt = await patient();
    const b = await createdId(pt, w.inPerson);
    expect((await familyCancel(pt, b)).status).toBe(200);
    c.noticeCalls.length = 0;

    const again = await familyCancel(pt, b);
    expect(again.status).toBe(409);
    expect(bodyOf(again).code).toBe("INVALID_STATE_TRANSITION");
    expect(c.noticeCalls).toEqual([]);
  });
});

describe("job notify-professional (BR-MKT-65)", () => {
  it("profissional com conta ⇒ SENT e o e-mail da conta vai para c.mails", async () => {
    const w = await world();
    expect(await c.maintenance.notifyProfessional({ professionalId: w.pro.professionalId })).toBe("SENT");
    expect(c.mails).toEqual([w.pro.email]);
  });

  it("profissional inexistente ⇒ SKIPPED sem e-mail", async () => {
    expect(await c.maintenance.notifyProfessional({ professionalId: randomUUID() })).toBe("SKIPPED");
    expect(c.mails).toEqual([]);
  });

  it("falha do envio ⇒ erro 'professional_notice_failed' sem e-mail nem 'smtp' na mensagem, sem causa, e nada registado", async () => {
    const w = await world();
    c.failMail.value = true;
    try {
      const error = await errorOf(c.maintenance.notifyProfessional({ professionalId: w.pro.professionalId }));
      expect(error).toBeInstanceOf(Error);
      const message = error instanceof Error ? error.message : "";
      expect(message).toBe("professional_notice_failed");
      expect(message).not.toContain(w.pro.email);
      expect(message.toLowerCase()).not.toContain("smtp");
      expect(error instanceof Error ? error.cause : undefined).toBeUndefined();
      expect(c.mails).toEqual([]);
    } finally {
      c.failMail.value = false;
    }
  });

  it("repor o envio e voltar a executar ⇒ SENT (retry)", async () => {
    const w = await world();
    c.failMail.value = true;
    expect(await errorOf(c.maintenance.notifyProfessional({ professionalId: w.pro.professionalId }))).toBeInstanceOf(Error);
    c.failMail.value = false;

    expect(await c.maintenance.notifyProfessional({ professionalId: w.pro.professionalId })).toBe("SENT");
    expect(c.mails).toEqual([w.pro.email]);
  });
});

describe("reconciliação das marcações (BR-MKT-54; OP-97; TC-MKT-113)", () => {
  it("REQUESTED sem resposta há mais de 48 h ⇒ CANCELLED/SYSTEM/REQUEST_EXPIRED, horário libertado, consulta cancelada se existir, auditoria SYSTEM e 1 alerta; devolve a contagem", async () => {
    const w = await world();
    const pt = await patient();
    const b = await createdId(pt, w.inPerson);
    const slotId = (await bookingRow(b)).slot_id ?? "";
    expect(slotId).not.toBe("");
    c.alertCalls.length = 0;

    c.h.clock.set(new Date(START.getTime() + 49 * HOUR));
    expect(await reconcile()).toBeGreaterThanOrEqual(1);

    expect(await bookingRow(b)).toEqual({ status: "CANCELLED", cancelled_by: "SYSTEM", system_reason: "REQUEST_EXPIRED", slot_id: null });
    expect(await slotOwner(slotId)).toBeNull();
    expect(await appointmentStatuses(b)).toEqual([]);

    const audit = await auditOf("BOOKING_AUTO_CANCEL", b);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actor_type).toBe("SYSTEM");
    expect(audit[0]?.metadata).toEqual({ fromStatus: "REQUESTED", systemReason: "REQUEST_EXPIRED" });

    expect(c.alertCalls.filter((a) => a.bookingId === b).map(alertView)).toEqual([{ kind: "BOOKING_UPDATED", bookingId: b, familyId: pt.fam, memberId: pt.m }]);
  });

  it("REQUESTED com startsAt já passado (pedido com menos de 48 h) ⇒ REQUEST_EXPIRED", async () => {
    const w = await world();
    const pt = await patient();
    const b = await createdId(pt, w.inPerson, new Date(START.getTime() + 5 * HOUR));

    c.h.clock.set(new Date(START.getTime() + 6 * HOUR));
    await reconcile();
    expect(await bookingRow(b)).toMatchObject({ status: "CANCELLED", cancelled_by: "SYSTEM", system_reason: "REQUEST_EXPIRED" });
  });

  it("REQUESTED com menos de 48 h e futura de profissional APPROVED ⇒ intacta", async () => {
    const w = await world();
    const pt = await patient();
    const b = await createdId(pt, w.inPerson);
    const before = await bookingRow(b);

    c.h.clock.set(new Date(START.getTime() + 47 * HOUR));
    await reconcile();
    expect(await bookingRow(b)).toEqual(before);
    expect(c.alertCalls.filter((a) => a.bookingId === b)).toEqual([]);
  });

  it("profissional deixou de estar APPROVED ⇒ CONFIRMED futura e REQUESTED futura são canceladas com PROFESSIONAL_UNAVAILABLE; horário libertado; consulta CANCELLED; 1 alerta cada", async () => {
    const w = await world();
    const pt = await patient();
    const confirmed = await createdId(pt, w.inPerson);
    expect((await proAct(w, confirmed, "confirm")).status).toBe(200);
    const requested = await createdId(pt, w.inPerson);
    const slotOfConfirmed = (await bookingRow(confirmed)).slot_id ?? "";
    const slotOfRequested = (await bookingRow(requested)).slot_id ?? "";
    expect(await appointmentStatuses(confirmed)).toEqual(["SCHEDULED"]);
    c.alertCalls.length = 0;

    await c.h.pool.query("UPDATE professionals SET validation_status = 'SUSPENDED' WHERE id = $1", [w.pro.professionalId]);
    await reconcile();

    for (const b of [confirmed, requested]) {
      expect(await bookingRow(b)).toEqual({ status: "CANCELLED", cancelled_by: "SYSTEM", system_reason: "PROFESSIONAL_UNAVAILABLE", slot_id: null });
      expect(c.alertCalls.filter((a) => a.bookingId === b)).toHaveLength(1);
    }
    expect(await slotOwner(slotOfConfirmed)).toBeNull();
    expect(await slotOwner(slotOfRequested)).toBeNull();
    expect(await appointmentStatuses(confirmed)).toEqual(["CANCELLED"]);
  });

  it("CONFIRMED PASSADA de profissional não APPROVED ⇒ NÃO se toca (OP-97)", async () => {
    const w = await world();
    const pt = await patient();
    const b = await createdId(pt, w.inPerson, new Date(START.getTime() + 3 * DAY + 3 * HOUR));
    expect((await proAct(w, b, "confirm")).status).toBe(200);
    const before = await bookingRow(b);
    const slot = before.slot_id ?? "";
    const appointmentBefore = await appointmentStatuses(b);
    c.alertCalls.length = 0;

    await c.h.pool.query("UPDATE professionals SET validation_status = 'SUSPENDED' WHERE id = $1", [w.pro.professionalId]);
    c.h.clock.set(new Date(START.getTime() + 4 * DAY));
    await reconcile();

    expect(await bookingRow(b)).toEqual(before);
    expect(await slotOwner(slot)).toBe(b);
    expect(await appointmentStatuses(b)).toEqual(appointmentBefore);
    expect(c.alertCalls.filter((a) => a.bookingId === b)).toEqual([]);
  });

  it("reativar o profissional (volta a APPROVED) não repõe as marcações canceladas", async () => {
    const w = await world();
    const pt = await patient();
    const b = await createdId(pt, w.inPerson);
    expect((await proAct(w, b, "confirm")).status).toBe(200);
    const slot = (await bookingRow(b)).slot_id ?? "";

    await c.h.pool.query("UPDATE professionals SET validation_status = 'SUSPENDED' WHERE id = $1", [w.pro.professionalId]);
    await reconcile();
    expect((await bookingRow(b)).status).toBe("CANCELLED");

    await c.h.pool.query("UPDATE professionals SET validation_status = 'APPROVED' WHERE id = $1", [w.pro.professionalId]);
    expect(await reconcile()).toBe(0);
    expect(await bookingRow(b)).toMatchObject({ status: "CANCELLED", cancelled_by: "SYSTEM", system_reason: "PROFESSIONAL_UNAVAILABLE" });
    expect(await slotOwner(slot)).toBeNull();
    expect(await auditOf("BOOKING_AUTO_CANCEL", b)).toHaveLength(1);
  });

  it("idempotência: a segunda execução devolve 0 e não duplica auditoria nem alerta", async () => {
    const w = await world();
    const pt = await patient();
    const b = await createdId(pt, w.inPerson);
    c.h.clock.set(new Date(START.getTime() + 49 * HOUR));

    expect(await reconcile()).toBeGreaterThanOrEqual(1);
    expect(await reconcile()).toBe(0);
    expect(await auditOf("BOOKING_AUTO_CANCEL", b)).toHaveLength(1);
    expect(c.alertCalls.filter((a) => a.bookingId === b)).toHaveLength(1);
  });

  it("profissional APPROVED com CONFIRMED futura ⇒ intacta", async () => {
    const w = await world();
    const pt = await patient();
    const b = await createdId(pt, w.inPerson);
    expect((await proAct(w, b, "confirm")).status).toBe(200);
    const before = await bookingRow(b);
    const appointmentBefore = await appointmentStatuses(b);
    c.alertCalls.length = 0;

    c.h.clock.set(new Date(START.getTime() + HOUR));
    await reconcile();
    expect(await bookingRow(b)).toEqual(before);
    expect(await appointmentStatuses(b)).toEqual(appointmentBefore);
    expect(c.alertCalls.filter((a) => a.bookingId === b)).toEqual([]);
  });

  it("concorrência: o profissional confirma ao mesmo tempo que o job corre sobre um pedido vencido ⇒ estado coerente", async () => {
    const w = await world();
    const pt = await patient();
    const b = await createdId(pt, w.inPerson);
    c.h.clock.set(new Date(START.getTime() + 49 * HOUR));

    const [confirm] = await Promise.all([proAct(w, b, "confirm"), c.maintenance.reconcileBookings()]);
    expect([200, 409]).toContain(confirm.status);

    const row = await bookingRow(b);
    const audit = await auditOf("BOOKING_AUTO_CANCEL", b);
    if (row.status === "CANCELLED") {
      expect(row.cancelled_by).toBe("SYSTEM");
      expect(row.slot_id).toBeNull();
      expect(audit).toHaveLength(1);
    } else {
      expect(row.status).toBe("CONFIRMED");
      expect(row.cancelled_by).toBeNull();
      expect(audit).toHaveLength(0);
    }
  });
});

describe("reenfileiramento do antivírus (OP-114 iii)", () => {
  /** Comprovativo PENDING (upload sem antivírus) numa marcação paga; a fila fica com o job do envio. */
  async function pendingProof(): Promise<string> {
    const w = await world();
    const pt = await patient();
    return uploadOnly(pt, await paidBooking(pt, w.video), "pendente");
  }

  it("PENDING há menos de 15 min ⇒ não reenfileira (0) e a fila não cresce", async () => {
    await c.runProofScans();
    const p = await pendingProof();
    const queued = c.proofQueue.length;

    c.h.clock.set(new Date(START.getTime() + 14 * MIN));
    expect(await c.maintenance.requeuePendingProofs()).toBe(0);
    expect(c.proofQueue).toHaveLength(queued);
    expect(await scanStatusOf(p)).toBe("PENDING");
  });

  it("PENDING há mais de 15 min ⇒ devolve 1 e a fila ganha um job com o proofId", async () => {
    await c.runProofScans();
    const p = await pendingProof();
    const queued = c.proofQueue.length;

    c.h.clock.set(new Date(START.getTime() + 16 * MIN));
    expect(await c.maintenance.requeuePendingProofs()).toBe(1);
    expect(c.proofQueue.slice(queued)).toEqual([{ proofId: p }]);
  });

  it("correr duas vezes é seguro: 1 enquanto PENDING; depois de runProofScans, 0", async () => {
    await c.runProofScans();
    const p = await pendingProof();
    const queued = c.proofQueue.length;

    c.h.clock.set(new Date(START.getTime() + 16 * MIN));
    expect(await c.maintenance.requeuePendingProofs()).toBe(1);
    expect(await c.maintenance.requeuePendingProofs()).toBe(1);
    expect(c.proofQueue.slice(queued)).toEqual([{ proofId: p }, { proofId: p }]);

    await c.runProofScans();
    expect(await scanStatusOf(p)).toBe("CLEAN");
    expect(await c.maintenance.requeuePendingProofs()).toBe(0);
  });

  it("comprovativo já CLEAN ⇒ não reenfileira", async () => {
    await c.runProofScans();
    const w = await world();
    const pt = await patient();
    const p = await uploadClean(pt, await paidBooking(pt, w.video), "limpo");
    expect(await scanStatusOf(p)).toBe("CLEAN");

    c.h.clock.set(new Date(START.getTime() + 16 * MIN));
    const queued = c.proofQueue.length;
    expect(await c.maintenance.requeuePendingProofs()).toBe(0);
    expect(c.proofQueue).toHaveLength(queued);
  });
});
