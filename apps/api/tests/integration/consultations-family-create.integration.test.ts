/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment -- corpos JSON de respostas HTTP lidos de forma dinâmica nos testes */
// Integração (PostgreSQL real, app real com validação de pedidos E respostas) da CRIAÇÃO de marcações do lado da família (MK3 S6):
// TC-MKT-77 (feliz, Process e auditoria), TC-MKT-78 (idempotência e corridas), TC-MKT-80 (validações e limites), TC-AZ-MKT-23 (404 indistinguíveis)
// e a automarcação (BR-MKT-62, TC-AZ-MKT-18). Relógio do harness fixo em `START`; cada teste volta a ele (`beforeEach`).
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { API, START } from "../support/professionals-harness.js";
import { startConsultationsHarness, type ConsultationsHarness, type OfferFixture, type ProfessionalFixture, type UserFixture } from "../support/consultations-harness.js";

const HOUR = 3_600_000;
const DAY = 86_400_000;
const MIN = 60_000;
/** Canários de PII (BR-MKT-63): nunca em auditoria nem em logs. */
const LABEL = "canario-s6-rotulo";
const LOGS: string[] = [];

let c: ConsultationsHarness;

const at = (ms: number): Date => new Date(START.getTime() + ms);
const bookingsOf = (familyId: string, memberId: string): string => `${API}/families/${familyId}/members/${memberId}/bookings`;
const bodyOf = (res: { body: unknown }): Record<string, any> => res.body as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
/** Campos de transporte (pedido/instância) que variam por pedido; o resto tem de ser idêntico para não haver enumeração. */
const stripTransport = (body: unknown): unknown => ({ ...(body as object), requestId: 0, instance: 0 });

function book(token: string, familyId: string, memberId: string, body: unknown) {
  return request(c.h.app).post(bookingsOf(familyId, memberId)).set("Authorization", `Bearer ${token}`).send(body as object);
}

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await c.h.pool.query<{ n: string }>(sql, params);
  return Number(rows[0]?.n ?? 0);
}

interface Scene {
  pro: ProfessionalFixture;
  offerA: OfferFixture;
  offerB: OfferFixture;
  u: UserFixture;
  fam: string;
  m: string;
}

/** Profissional APPROVED com oferta A (VIDEO, 30 min, 5000 Kz) e B (IN_PERSON, 45 min, 0 Kz) e uma família com um titular adulto. */
async function scene(): Promise<Scene> {
  const pro = await c.professional({ name: "Dra. Criação" });
  const offerA = await c.offer(pro, { method: "VIDEO", durationMinutes: 30, priceKz: 5000 });
  const offerB = await c.offer(pro, { method: "IN_PERSON", durationMinutes: 45, priceKz: 0 });
  const u = await c.user("ana");
  const fam = await c.family("Família Criação");
  const m = await c.member(fam, { userId: u.id, role: "FAMILY_ADMIN", name: "Ana" });
  return { pro, offerA, offerB, u, fam, m };
}

describe("integração: criação de marcações pela família (MK3 S6)", () => {
  beforeAll(async () => {
    c = await startConsultationsHarness({ logStream: LOGS });
  }, 300_000);

  afterAll(async () => {
    await c.stop();
  });

  beforeEach(() => {
    c.h.clock.set(START);
  });

  it("TC-MKT-77: 201 com REQUESTED, AWAITING_PROOF, preço/duração/método copiados, horário ocupado, Process BOOKING e auditoria sem rótulo nem preço", async () => {
    const s = await scene();
    const startsAt = at(3 * HOUR);
    const slotId = await c.slot(s.offerA, startsAt);
    const res = await book(s.u.token, s.fam, s.m, { offerId: s.offerA.id, slotId, participantLabel: LABEL });
    expect(res.status).toBe(201);
    const b = bodyOf(res);
    expect(b).toMatchObject({
      memberId: s.m,
      status: "REQUESTED",
      paymentStatus: "AWAITING_PROOF",
      priceKz: 5000,
      participantLabel: LABEL,
      startsAt: startsAt.toISOString(),
      endsAt: at(3 * HOUR + 30 * MIN).toISOString(),
      meetingInfo: null,
      paymentInstructions: null,
      statusReason: null,
      cancelledBy: null,
      cancelledLate: false,
      canCancel: true,
      canSendProof: false,
      canReview: false,
      hasReview: false,
      appointmentId: null,
      conversationId: null,
      professional: { id: s.pro.professionalId, displayName: "Dra. Criação", city: "Luanda" },
      offer: { specialtyId: s.pro.specialtyId, specialtyName: s.pro.specialtyName, method: "VIDEO", durationMinutes: 30 },
    });
    expect(b.processId).toEqual(expect.any(String));

    const row = (await c.h.pool.query("SELECT * FROM bookings WHERE id = $1", [b.id])).rows[0];
    expect(row).toMatchObject({ status: "REQUESTED", payment_status: "AWAITING_PROOF", price_kz: 5000, duration_minutes: 30, method: "VIDEO", slot_id: slotId, created_by_user_id: s.u.id, process_id: b.processId });
    expect((await c.h.pool.query<{ booking_id: string | null }>("SELECT booking_id FROM professional_slots WHERE id = $1", [slotId])).rows[0]?.booking_id).toBe(b.id);

    const procs = (await c.h.pool.query("SELECT id, origin_type, origin_id, family_id, member_id FROM processes WHERE origin_id = $1", [b.id])).rows;
    expect(procs).toEqual([{ id: b.processId, origin_type: "BOOKING", origin_id: b.id, family_id: s.fam, member_id: s.m }]);

    const audit = (await c.h.pool.query("SELECT action, result, resource_type, family_id, subject_member_id, actor_user_id, metadata FROM audit_logs WHERE action = 'BOOKING_CREATE' AND resource_id = $1", [b.id])).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ result: "SUCCESS", resource_type: "Booking", family_id: s.fam, subject_member_id: s.m, actor_user_id: s.u.id });
    expect(audit[0]?.metadata).toEqual({ professionalId: s.pro.professionalId, method: "VIDEO" });
    expect(JSON.stringify(audit)).not.toContain(LABEL);
  });

  it("TC-MKT-77: oferta de 0 Kz ⇒ paymentStatus NOT_REQUIRED e fim = início + duração da oferta (45 min)", async () => {
    const s = await scene();
    const startsAt = at(HOUR * 26);
    const slotId = await c.slot(s.offerB, startsAt);
    const res = await book(s.u.token, s.fam, s.m, { offerId: s.offerB.id, slotId, participantLabel: "Ana" });
    expect(res.status).toBe(201);
    expect(bodyOf(res)).toMatchObject({ priceKz: 0, paymentStatus: "NOT_REQUIRED", endsAt: new Date(startsAt.getTime() + 45 * MIN).toISOString(), offer: { method: "IN_PERSON", durationMinutes: 45 } });
    expect((await c.h.pool.query("SELECT payment_status FROM bookings WHERE id = $1", [bodyOf(res).id])).rows[0]).toEqual({ payment_status: "NOT_REQUIRED" });
  });

  it("clientRequestId repetido ⇒ 200 com a mesma marcação, uma só linha em bookings, horário reservado e Process/auditoria uma vez", async () => {
    const s = await scene();
    const slotId = await c.slot(s.offerA, at(3 * HOUR));
    const clientRequestId = randomUUID();
    const body = { offerId: s.offerA.id, slotId, participantLabel: "Ana", clientRequestId };
    const first = await book(s.u.token, s.fam, s.m, body);
    expect(first.status).toBe(201);
    const second = await book(s.u.token, s.fam, s.m, body);
    expect(second.status).toBe(200);
    expect(bodyOf(second).id).toBe(bodyOf(first).id);
    expect(bodyOf(second).processId).toBe(bodyOf(first).processId);

    const id = bodyOf(first).id as string;
    expect(await count("SELECT count(*) AS n FROM bookings WHERE client_request_id = $1", [clientRequestId])).toBe(1);
    expect(await count("SELECT count(*) AS n FROM processes WHERE origin_id = $1", [id])).toBe(1);
    expect(await count("SELECT count(*) AS n FROM audit_logs WHERE action = 'BOOKING_CREATE' AND resource_id = $1", [id])).toBe(1);
    expect((await c.h.pool.query("SELECT booking_id FROM professional_slots WHERE id = $1", [slotId])).rows[0]).toEqual({ booking_id: id });
  });

  it("TC-MKT-79: o mesmo clientRequestId em paralelo (mesmo membro) ⇒ uma só marcação: 201 e 200 com o mesmo id", async () => {
    const s = await scene();
    const slotId = await c.slot(s.offerA, at(3 * HOUR));
    const clientRequestId = randomUUID();
    const body = { offerId: s.offerA.id, slotId, participantLabel: "Ana", clientRequestId };
    const [r1, r2] = await Promise.all([book(s.u.token, s.fam, s.m, body), book(s.u.token, s.fam, s.m, body)]);
    expect([r1.status, r2.status].sort()).toEqual([200, 201]);
    expect(bodyOf(r1).id).toBe(bodyOf(r2).id);
    expect(await count("SELECT count(*) AS n FROM bookings WHERE client_request_id = $1", [clientRequestId])).toBe(1);
    expect(await count("SELECT count(*) AS n FROM processes WHERE member_id = $1", [s.m])).toBe(1);
    expect(await count("SELECT count(*) AS n FROM audit_logs WHERE action = 'BOOKING_CREATE' AND subject_member_id = $1", [s.m])).toBe(1);
  });

  it("replay com clientRequestId e slotId/offerId divergentes ⇒ 409 CONFLICT, sem reservar o novo horário; o pedido idêntico continua a dar 200", async () => {
    const s = await scene();
    const slot1 = await c.slot(s.offerA, at(3 * HOUR));
    const slot2 = await c.slot(s.offerA, at(6 * HOUR));
    const slot3 = await c.slot(s.offerB, at(9 * HOUR));
    const clientRequestId = randomUUID();
    const first = await book(s.u.token, s.fam, s.m, { offerId: s.offerA.id, slotId: slot1, participantLabel: "Ana", clientRequestId });
    expect(first.status).toBe(201);

    const otherSlot = await book(s.u.token, s.fam, s.m, { offerId: s.offerA.id, slotId: slot2, participantLabel: "Ana", clientRequestId });
    expect(otherSlot.status).toBe(409);
    expect(bodyOf(otherSlot).code).toBe("CONFLICT");
    const otherOffer = await book(s.u.token, s.fam, s.m, { offerId: s.offerB.id, slotId: slot3, participantLabel: "Ana", clientRequestId });
    expect(otherOffer.status).toBe(409);
    expect(bodyOf(otherOffer).code).toBe("CONFLICT");
    for (const slotId of [slot2, slot3]) expect((await c.h.pool.query("SELECT booking_id FROM professional_slots WHERE id = $1", [slotId])).rows[0]).toEqual({ booking_id: null });
    expect(await count("SELECT count(*) AS n FROM bookings WHERE member_id = $1", [s.m])).toBe(1);

    const same = await book(s.u.token, s.fam, s.m, { offerId: s.offerA.id, slotId: slot1, participantLabel: "Ana", clientRequestId });
    expect(same.status).toBe(200);
    expect(bodyOf(same).id).toBe(bodyOf(first).id);
  });

  it("BR-MKT-66 corrida: um tutor com vários membros não excede 10 criações/dia (limite por utilizador sob bloqueio): 9 feitas + 3 em paralelo ⇒ 1×201 e 2×429", async () => {
    const s = await scene();
    const d1 = await c.member(s.fam, { dependent: true, name: "Filho 1", guardians: [s.m] });
    const d2 = await c.member(s.fam, { dependent: true, name: "Filho 2", guardians: [s.m] });
    for (let k = 0; k < 9; k++) {
      const slotId = await c.slot(s.offerA, at(3 * HOUR + k * HOUR));
      expect((await book(s.u.token, s.fam, s.m, { offerId: s.offerA.id, slotId, participantLabel: "Ana" })).status, `criação ${String(k + 1)}`).toBe(201);
    }
    const slots = [await c.slot(s.offerA, at(20 * HOUR)), await c.slot(s.offerA, at(22 * HOUR)), await c.slot(s.offerA, at(24 * HOUR))];
    const members = [s.m, d1, d2];
    const results = await Promise.all(members.map((m, i) => book(s.u.token, s.fam, m, { offerId: s.offerA.id, slotId: slots[i], participantLabel: "Filho" })));
    expect(results.map((r) => r.status).sort()).toEqual([201, 429, 429]);
    for (const r of results.filter((x) => x.status === 429)) expect(bodyOf(r).code).toBe("RATE_LIMITED");
    expect(await count("SELECT count(*) AS n FROM bookings WHERE created_by_user_id = $1", [s.u.id])).toBe(10);
  });

  it("mesmo membro, mesmo horário, sem clientRequestId ⇒ 409 CONFLICT (sobreposição) e nada criado a mais", async () => {
    const s = await scene();
    const slotId = await c.slot(s.offerA, at(3 * HOUR));
    expect((await book(s.u.token, s.fam, s.m, { offerId: s.offerA.id, slotId, participantLabel: "Ana" })).status).toBe(201);
    const again = await book(s.u.token, s.fam, s.m, { offerId: s.offerA.id, slotId, participantLabel: "Ana" });
    expect(again.status).toBe(409);
    expect(bodyOf(again).code).toBe("CONFLICT");
    expect(await count("SELECT count(*) AS n FROM bookings WHERE member_id = $1", [s.m])).toBe(1);
  });

  it("TC-MKT-78 corrida: 8 membros distintos ao MESMO horário ⇒ 1×201 e 7×409 SLOT_UNAVAILABLE; 1 linha; perdedores sem Process nem auditoria", async () => {
    const pro = await c.professional({ name: "Dra. Corrida" });
    const offer = await c.offer(pro, { method: "VIDEO", durationMinutes: 30, priceKz: 5000 });
    const slotId = await c.slot(offer, at(4 * HOUR));
    const people: { u: UserFixture; fam: string; m: string }[] = [];
    for (let i = 0; i < 8; i++) {
      const u = await c.user(`corrida${String(i)}`);
      const fam = await c.family(`Corrida ${String(i)}`);
      const m = await c.member(fam, { userId: u.id, role: "FAMILY_ADMIN", name: `P${String(i)}` });
      people.push({ u, fam, m });
    }

    const responses = await Promise.all(people.map((p, i) => book(p.u.token, p.fam, p.m, { offerId: offer.id, slotId, participantLabel: `Pessoa ${String(i)}` })));

    const winners = responses.filter((r) => r.status === 201);
    const losers = responses.filter((r) => r.status !== 201);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(7);
    for (const r of losers) {
      expect(r.status).toBe(409);
      expect(bodyOf(r).code).toBe("SLOT_UNAVAILABLE");
    }
    const winnerId = bodyOf(winners[0] ?? (() => { throw new Error("sem vencedor"); })()).id as string;
    expect(await count("SELECT count(*) AS n FROM bookings WHERE slot_id = $1", [slotId])).toBe(1);
    expect((await c.h.pool.query("SELECT booking_id FROM professional_slots WHERE id = $1", [slotId])).rows[0]).toEqual({ booking_id: winnerId });

    const winnerIndex = responses.findIndex((r) => r.status === 201);
    const loserFamilies = people.filter((_, i) => i !== winnerIndex).map((p) => p.fam);
    expect(await count("SELECT count(*) AS n FROM processes WHERE family_id = ANY($1::uuid[])", [loserFamilies])).toBe(0);
    expect(await count("SELECT count(*) AS n FROM audit_logs WHERE action = 'BOOKING_CREATE' AND family_id = ANY($1::uuid[])", [loserFamilies])).toBe(0);
    expect(await count("SELECT count(*) AS n FROM audit_logs WHERE action = 'BOOKING_CREATE' AND resource_id = $1", [winnerId])).toBe(1);
    expect(await count("SELECT count(*) AS n FROM processes WHERE origin_id = $1", [winnerId])).toBe(1);
  });

  it("TC-MKT-78 corrida: 2 pedidos do MESMO membro, clientRequestId diferentes, horários sobrepostos (de profissionais distintos) ⇒ 1×201 e 1×409 CONFLICT", async () => {
    const s = await scene();
    const pro2 = await c.professional({ name: "Dra. Segunda" });
    const offer2 = await c.offer(pro2, { method: "VIDEO", durationMinutes: 30, priceKz: 5000 });
    const slot1 = await c.slot(s.offerA, at(5 * HOUR));
    const slot2 = await c.slot(offer2, at(5 * HOUR + 15 * MIN));

    const [r1, r2] = await Promise.all([
      book(s.u.token, s.fam, s.m, { offerId: s.offerA.id, slotId: slot1, participantLabel: "Ana", clientRequestId: randomUUID() }),
      book(s.u.token, s.fam, s.m, { offerId: offer2.id, slotId: slot2, participantLabel: "Ana", clientRequestId: randomUUID() }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
    const loser = r1.status === 409 ? r1 : r2;
    expect(bodyOf(loser).code).toBe("CONFLICT");
    expect(await count("SELECT count(*) AS n FROM bookings WHERE member_id = $1", [s.m])).toBe(1);
    expect(await count("SELECT count(*) AS n FROM processes WHERE member_id = $1", [s.m])).toBe(1);
    expect(await count("SELECT count(*) AS n FROM professional_slots WHERE booking_id IS NOT NULL AND id IN ($1, $2)", [slot1, slot2])).toBe(1);
  });

  it("TC-MKT-80: antecedência < 2 h e > 8 semanas, e horário de OUTRA oferta do mesmo profissional ⇒ 422 VALIDATION_ERROR; nada criado", async () => {
    const s = await scene();
    const tooSoon = await c.slot(s.offerA, at(2 * HOUR - MIN));
    const tooFar = await c.slot(s.offerA, at(56 * DAY + MIN));
    const otherOffer = await c.slot(s.offerB, at(3 * HOUR));

    const soon = await book(s.u.token, s.fam, s.m, { offerId: s.offerA.id, slotId: tooSoon, participantLabel: "Ana" });
    const far = await book(s.u.token, s.fam, s.m, { offerId: s.offerA.id, slotId: tooFar, participantLabel: "Ana" });
    const alien = await book(s.u.token, s.fam, s.m, { offerId: s.offerA.id, slotId: otherOffer, participantLabel: "Ana" });

    for (const r of [soon, far, alien]) {
      expect(r.status).toBe(422);
      expect(bodyOf(r).code).toBe("VALIDATION_ERROR");
    }
    expect(await count("SELECT count(*) AS n FROM bookings WHERE member_id = $1", [s.m])).toBe(0);
    expect(await count("SELECT count(*) AS n FROM professional_slots WHERE booking_id IS NOT NULL AND professional_id = $1", [s.pro.professionalId])).toBe(0);
  });

  it("limites exatos: início a exatamente 2 h e a exatamente 8 semanas são aceites (BR-MKT-51)", async () => {
    const s = await scene();
    const atTwoHours = await c.slot(s.offerA, at(2 * HOUR));
    const atEightWeeks = await c.slot(s.offerA, at(56 * DAY));
    expect((await book(s.u.token, s.fam, s.m, { offerId: s.offerA.id, slotId: atTwoHours, participantLabel: "Ana" })).status).toBe(201);
    expect((await book(s.u.token, s.fam, s.m, { offerId: s.offerA.id, slotId: atEightWeeks, participantLabel: "Ana" })).status).toBe(201);
  });

  it("TC-AZ-MKT-23: oferta/horário inexistentes, horário de outro profissional, profissional SUSPENDED e oferta inativa ⇒ 404 idêntico ao inexistente", async () => {
    const s = await scene();
    const other = await c.professional({ name: "Dra. Alheia" });
    const otherOffer = await c.offer(other, { method: "VIDEO", durationMinutes: 30, priceKz: 5000 });
    const otherSlot = await c.slot(otherOffer, at(3 * HOUR));
    const suspended = await c.professional({ status: "SUSPENDED", name: "Dra. Suspensa" });
    const suspendedOffer = await c.offer(suspended, { method: "VIDEO", durationMinutes: 30, priceKz: 5000 });
    const suspendedSlot = await c.slot(suspendedOffer, at(3 * HOUR));
    const inactive = await c.offer(s.pro, { method: "PHONE", durationMinutes: 15, priceKz: 1000, active: false });
    const inactiveSlot = await c.slot(inactive, at(6 * HOUR));

    const cases: Record<string, { offerId: string; slotId: string }> = {
      inexistente: { offerId: randomUUID(), slotId: randomUUID() },
      outroProfissional: { offerId: s.offerA.id, slotId: otherSlot },
      naoAprovado: { offerId: suspendedOffer.id, slotId: suspendedSlot },
      ofertaInativa: { offerId: inactive.id, slotId: inactiveSlot },
    };
    const responses: Record<string, request.Response> = {};
    for (const [name, body] of Object.entries(cases)) responses[name] = await book(s.u.token, s.fam, s.m, { ...body, participantLabel: LABEL });

    const reference = stripTransport(bodyOf(responses.inexistente ?? (() => { throw new Error("sem referência"); })()));
    for (const [name, r] of Object.entries(responses)) {
      expect(r.status, name).toBe(404);
      expect(bodyOf(r).code, name).toBe("NOT_FOUND");
      expect(stripTransport(bodyOf(r)), name).toEqual(reference);
    }
    expect(await count("SELECT count(*) AS n FROM bookings WHERE member_id = $1", [s.m])).toBe(0);
    expect(await count("SELECT count(*) AS n FROM professional_slots WHERE booking_id IS NOT NULL AND id = ANY($1::uuid[])", [[otherSlot, suspendedSlot, inactiveSlot]])).toBe(0);
  });

  it("participantLabel vazio, de 41 caracteres ou com controlo, e campo extra (reason) no corpo ⇒ 422 sem criar nada", async () => {
    const s = await scene();
    const slotId = await c.slot(s.offerA, at(3 * HOUR));
    const base = { offerId: s.offerA.id, slotId };
    const bad = [
      { ...base, participantLabel: "" },
      { ...base, participantLabel: "   " },
      { ...base, participantLabel: "A".repeat(41) },
      { ...base, participantLabel: "Ana\nSilva" },
      { ...base, participantLabel: "Ana\u0000" },
      { ...base, participantLabel: LABEL, reason: "motivo da consulta" },
      { ...base },
    ];
    for (const body of bad) {
      const r = await book(s.u.token, s.fam, s.m, body);
      expect(r.status, JSON.stringify(body)).toBe(422);
      expect(bodyOf(r).code).toBe("VALIDATION_ERROR");
      expect(JSON.stringify(bodyOf(r))).not.toContain(LABEL);
    }
    expect(await count("SELECT count(*) AS n FROM bookings WHERE member_id = $1", [s.m])).toBe(0);
    expect((await c.h.pool.query("SELECT booking_id FROM professional_slots WHERE id = $1", [slotId])).rows[0]).toEqual({ booking_id: null });
  });

  it("limite de 10 marcações ativas: sobreposição do membro ⇒ 409 CONFLICT; a 11.ª ativa ⇒ 409 LIMIT_EXCEEDED", async () => {
    const s = await scene();
    const pro2 = await c.professional({ name: "Dra. Limite" });
    const offer2 = await c.offer(pro2, { method: "VIDEO", durationMinutes: 30, priceKz: 5000 });
    await c.seedBooking({ familyId: s.fam, memberId: s.m, offer: s.offerA, startsAt: at(3 * HOUR), createdByUserId: null });

    const overlapping = await c.slot(offer2, at(3 * HOUR + 15 * MIN));
    const overlap = await book(s.u.token, s.fam, s.m, { offerId: offer2.id, slotId: overlapping, participantLabel: "Ana" });
    expect(overlap.status).toBe(409);
    expect(bodyOf(overlap).code).toBe("CONFLICT");

    for (let k = 1; k < 10; k++) await c.seedBooking({ familyId: s.fam, memberId: s.m, offer: s.offerA, startsAt: at(k * DAY + 20 * DAY), createdByUserId: null });
    expect(await count("SELECT count(*) AS n FROM bookings WHERE member_id = $1 AND status IN ('REQUESTED','CONFIRMED')", [s.m])).toBe(10);

    const eleventh = await c.slot(offer2, at(6 * HOUR));
    const res = await book(s.u.token, s.fam, s.m, { offerId: offer2.id, slotId: eleventh, participantLabel: "Ana" });
    expect(res.status).toBe(409);
    expect(bodyOf(res).code).toBe("LIMIT_EXCEEDED");
    expect(await count("SELECT count(*) AS n FROM bookings WHERE member_id = $1", [s.m])).toBe(10);
    expect((await c.h.pool.query("SELECT booking_id FROM professional_slots WHERE id = $1", [eleventh])).rows[0]).toEqual({ booking_id: null });
  });

  it("limite de 10 criações por dia (canceladas contam): a 11.ª ⇒ 429 RATE_LIMITED com Retry-After de 24 h", async () => {
    const s = await scene();
    for (let k = 0; k < 10; k++) {
      const slotId = await c.slot(s.offerA, at(3 * HOUR + k * HOUR));
      const created = await book(s.u.token, s.fam, s.m, { offerId: s.offerA.id, slotId, participantLabel: "Ana" });
      expect(created.status, `criação ${String(k + 1)}`).toBe(201);
      const cancelled = await request(c.h.app).post(`${bookingsOf(s.fam, s.m)}/${bodyOf(created).id as string}/cancel`).set("Authorization", `Bearer ${s.u.token}`).send({});
      expect(cancelled.status).toBe(200);
    }
    const slotId = await c.slot(s.offerA, at(3 * HOUR + 10 * HOUR));
    const res = await book(s.u.token, s.fam, s.m, { offerId: s.offerA.id, slotId, participantLabel: "Ana" });
    expect(res.status).toBe(429);
    expect(bodyOf(res).code).toBe("RATE_LIMITED");
    expect(res.headers["retry-after"]).toBe("86400");
    expect((await c.h.pool.query("SELECT booking_id FROM professional_slots WHERE id = $1", [slotId])).rows[0]).toEqual({ booking_id: null });
  });

  it("BR-MKT-62 / TC-MKT-81: o utilizador é o próprio profissional (e-mail normalizado igual) ⇒ 409 SELF_BOOKING_NOT_ALLOWED sem revelar e-mails; nada reservado", async () => {
    // O registo guarda o e-mail em minúsculas; a variação (maiúsculas, espaços) fica do lado do utilizador.
    const pro = await c.professional({ email: "ana.silva@exemplo.ao", name: "Dra. Ana" });
    const offer = await c.offer(pro, { method: "VIDEO", durationMinutes: 30, priceKz: 5000 });
    const slotId = await c.slot(offer, at(3 * HOUR));
    const same = await c.user("auto", { email: "  ana.silva@EXEMPLO.ao " });
    const fam = await c.family("Automarcação");
    const m = await c.member(fam, { userId: same.id, role: "FAMILY_ADMIN" });

    const res = await book(same.token, fam, m, { offerId: offer.id, slotId, participantLabel: LABEL });
    expect(res.status).toBe(409);
    expect(bodyOf(res).code).toBe("SELF_BOOKING_NOT_ALLOWED");
    const dump = JSON.stringify(res.body);
    for (const secret of ["Silva", "silva", "exemplo", "@"]) expect(dump).not.toContain(secret);
    expect((await c.h.pool.query("SELECT booking_id FROM professional_slots WHERE id = $1", [slotId])).rows[0]).toEqual({ booking_id: null });
    expect(await count("SELECT count(*) AS n FROM bookings WHERE member_id = $1", [m])).toBe(0);
    expect(await count("SELECT count(*) AS n FROM processes WHERE member_id = $1", [m])).toBe(0);

    // controlo: outro utilizador (e-mail diferente) do mesmo profissional marca normalmente
    const other = await c.user("outra");
    const otherFam = await c.family("Outra");
    const otherMember = await c.member(otherFam, { userId: other.id, role: "FAMILY_ADMIN" });
    expect((await book(other.token, otherFam, otherMember, { offerId: offer.id, slotId, participantLabel: "Ana" })).status).toBe(201);
  });
});
