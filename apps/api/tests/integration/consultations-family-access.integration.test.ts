/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- corpos JSON de respostas HTTP lidos de forma dinâmica nos testes (convenção de mk2-flow) */
// Integração (PostgreSQL real, app real com validação de pedidos E respostas) do ACESSO e da LEITURA do lado da família (MK3 S6):
// matriz de autorização (authorization.md §12.1; TC-AZ-MKT-17/24), IDOR (TC-AZ-MKT-18), listagem/detalhe com paginação e instruções de
// pagamento (TC-MKT-79/80), cancelamento (TC-MKT-81), horários livres (TC-MKT-84/77) e canário de PII (BR-MKT-63; TC-MKT-52/69).
// Cada teste monta o seu mundo (profissional, famílias e membros) para não haver interferências; o relógio volta a `START` antes de cada teste.
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { API, START } from "../support/professionals-harness.js";
import { startConsultationsHarness, type ConsultationsHarness, type OfferFixture, type ProfessionalFixture, type UserFixture } from "../support/consultations-harness.js";

const HOUR = 3_600_000;
const DAY = 86_400_000;
const MIN = 60_000;
/** Canários de PII (BR-MKT-63): nunca em auditoria nem em logs; as instruções de pagamento só no detalhe (BR-MKT-26/56). */
const LABEL = "canario-s6-rotulo";
const NOTE = "canario-s6-nota";
const IBAN = "iban-canario-s6";
const INSTRUCTIONS = `Transferência para o IBAN AO06 0000 0000 0000 0000 0000 0 (${IBAN}). Envie o comprovativo em 48 horas.`;
const LOGS: string[] = [];

let c: ConsultationsHarness;

const at = (ms: number): Date => new Date(START.getTime() + ms);
const bookingsOf = (familyId: string, memberId: string): string => `${API}/families/${familyId}/members/${memberId}/bookings`;
const bodyOf = (res: { body: unknown }): Record<string, any> => res.body as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
/** Campos de transporte (pedido/instância) variam por pedido; o resto tem de ser idêntico para não haver enumeração. */
const stripTransport = (body: unknown): unknown => ({ ...(body as object), requestId: 0, instance: 0 });
const authOf = (token?: string): Record<string, string> => (token === undefined ? {} : { Authorization: `Bearer ${token}` });

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await c.h.pool.query<{ n: string }>(sql, params);
  return Number(rows[0]?.n ?? 0);
}

const list = (token: string | undefined, f: string, m: string, query = "") => request(c.h.app).get(`${bookingsOf(f, m)}${query}`).set(authOf(token));
const detail = (token: string | undefined, f: string, m: string, id: string) => request(c.h.app).get(`${bookingsOf(f, m)}/${id}`).set(authOf(token));
const create = (token: string | undefined, f: string, m: string, body: unknown) => request(c.h.app).post(bookingsOf(f, m)).set(authOf(token)).send(body as object);
const cancel = (token: string | undefined, f: string, m: string, id: string, body: unknown = {}) => request(c.h.app).post(`${bookingsOf(f, m)}/${id}/cancel`).set(authOf(token)).send(body as object);

interface World {
  pro: ProfessionalFixture;
  offerA: OfferFixture;
  offerB: OfferFixture;
  /** Titular adulto de `m1` (SELF) e tutor de `d` (TUTOR_OF). */
  u1: UserFixture;
  /** Segundo tutor de `d` (TUTOR_OF). */
  u2: UserFixture;
  /** Membro sem relação com `m1`, com `SharingGrant` APPOINTMENTS de `m1` (OTHER com partilha). */
  u3: UserFixture;
  /** Dependente com conta própria (DEPENDENT_SELF). */
  u4: UserFixture;
  /** Family Admin de `fam` que não é o titular de `m1` (OTHER). */
  u5: UserFixture;
  /** Utilizador de outra família (`fg`). */
  ug: UserFixture;
  fam: string;
  fg: string;
  m1: string;
  m2: string;
  m3: string;
  m5: string;
  d: string;
  d4: string;
  dBlocked: string;
  mg: string;
}

/** Profissional APPROVED (instruções com o canário), duas famílias e os papéis de `authorization.md` §12.1. */
async function world(): Promise<World> {
  const pro = await c.professional({ name: "Dra. Acesso", paymentInstructions: INSTRUCTIONS });
  const offerA = await c.offer(pro, { method: "VIDEO", durationMinutes: 30, priceKz: 5000 });
  const offerB = await c.offer(pro, { method: "IN_PERSON", durationMinutes: 45, priceKz: 0 });
  const u1 = await c.user("titular");
  const u2 = await c.user("segundo-tutor");
  const u3 = await c.user("outro");
  const u4 = await c.user("dependente", { birth: "2012-01-01" });
  const u5 = await c.user("admin-outro");
  const ug = await c.user("alheia");
  const fam = await c.family("Acesso F");
  const fg = await c.family("Acesso G");
  const m1 = await c.member(fam, { userId: u1.id, role: "FAMILY_ADMIN", name: "Titular" });
  const m2 = await c.member(fam, { userId: u2.id, role: "FAMILY_MEMBER", name: "Segundo tutor" });
  const m3 = await c.member(fam, { userId: u3.id, role: "FAMILY_MEMBER", name: "Outro" });
  const m5 = await c.member(fam, { userId: u5.id, role: "FAMILY_ADMIN", name: "Admin" });
  const d = await c.member(fam, { dependent: true, guardians: [m1, m2], name: "Dependente" });
  const d4 = await c.member(fam, { dependent: true, userId: u4.id, guardians: [m1], name: "Dependente com conta" });
  const dBlocked = await c.member(fam, { dependent: true, blocked: true, guardians: [m1], name: "Bloqueado" });
  const mg = await c.member(fg, { userId: ug.id, role: "FAMILY_ADMIN", name: "Alheia" });
  await c.sharing(fam, m1, m3, "APPOINTMENTS");
  return { pro, offerA, offerB, u1, u2, u3, u4, u5, ug, fam, fg, m1, m2, m3, m5, d, d4, dBlocked, mg };
}

describe("integração: acesso, leitura e cancelamento de marcações pela família (MK3 S6)", () => {
  beforeAll(async () => {
    c = await startConsultationsHarness({ logStream: LOGS });
  }, 300_000);

  afterAll(async () => {
    await c.stop();
  });

  beforeEach(() => {
    c.h.clock.set(START);
  });

  describe("matriz de autorização (authorization.md §12.1; TC-AZ-MKT-17/24)", () => {
    it("SELF adulto e TUTOR_OF ⇒ listar, ver, marcar e cancelar (200/201)", async () => {
      const w = await world();
      const mine = await c.seedBooking({ familyId: w.fam, memberId: w.m1, offer: w.offerA, startsAt: at(3 * DAY) });
      const tutored = await c.seedBooking({ familyId: w.fam, memberId: w.d, offer: w.offerA, startsAt: at(4 * DAY) });

      expect((await list(w.u1.token, w.fam, w.m1)).status).toBe(200);
      expect((await detail(w.u1.token, w.fam, w.m1, mine.bookingId)).status).toBe(200);
      const created = await create(w.u1.token, w.fam, w.m1, { offerId: w.offerA.id, slotId: await c.slot(w.offerA, at(5 * DAY)), participantLabel: "Ana" });
      expect(created.status).toBe(201);
      expect((await cancel(w.u1.token, w.fam, w.m1, bodyOf(created).id)).status).toBe(200);

      expect((await list(w.u1.token, w.fam, w.d)).status).toBe(200);
      expect((await detail(w.u1.token, w.fam, w.d, tutored.bookingId)).status).toBe(200);
      const tutoredCreate = await create(w.u1.token, w.fam, w.d, { offerId: w.offerA.id, slotId: await c.slot(w.offerA, at(6 * DAY)), participantLabel: "Dep." });
      expect(tutoredCreate.status).toBe(201);
      expect((await cancel(w.u1.token, w.fam, w.d, bodyOf(tutoredCreate).id)).status).toBe(200);

      // o segundo tutor também é TUTOR_OF
      expect((await list(w.u2.token, w.fam, w.d)).status).toBe(200);
    });

    it("DEPENDENT_SELF (dependente com conta) ⇒ 403 em tudo e nada criado", async () => {
      const w = await world();
      const b = await c.seedBooking({ familyId: w.fam, memberId: w.d4, offer: w.offerA, startsAt: at(3 * DAY) });
      const slotId = await c.slot(w.offerA, at(5 * DAY));
      for (const r of [
        await list(w.u4.token, w.fam, w.d4),
        await detail(w.u4.token, w.fam, w.d4, b.bookingId),
        await create(w.u4.token, w.fam, w.d4, { offerId: w.offerA.id, slotId, participantLabel: "Eu" }),
        await cancel(w.u4.token, w.fam, w.d4, b.bookingId),
      ]) {
        expect(r.status).toBe(403);
        expect(bodyOf(r).code).toBe("FORBIDDEN");
      }
      expect(await count("SELECT count(*) AS n FROM bookings WHERE member_id = $1", [w.d4])).toBe(1);
      expect((await c.h.pool.query("SELECT booking_id FROM professional_slots WHERE id = $1", [slotId])).rows[0]).toEqual({ booking_id: null });
    });

    it("OTHER com SharingGrant de APPOINTMENTS ⇒ 403 (a partilha não dá marcações)", async () => {
      const w = await world();
      expect(await count("SELECT count(*) AS n FROM sharing_grants WHERE owner_member_id = $1 AND grantee_member_id = $2 AND category = 'APPOINTMENTS'", [w.m1, w.m3])).toBe(1);
      const b = await c.seedBooking({ familyId: w.fam, memberId: w.m1, offer: w.offerA, startsAt: at(3 * DAY) });
      const slotId = await c.slot(w.offerA, at(5 * DAY));
      for (const r of [
        await list(w.u3.token, w.fam, w.m1),
        await detail(w.u3.token, w.fam, w.m1, b.bookingId),
        await create(w.u3.token, w.fam, w.m1, { offerId: w.offerA.id, slotId, participantLabel: "Ana" }),
        await cancel(w.u3.token, w.fam, w.m1, b.bookingId),
      ]) {
        expect(r.status).toBe(403);
        expect(bodyOf(r).code).toBe("FORBIDDEN");
      }
      expect(await count("SELECT count(*) AS n FROM bookings WHERE member_id = $1 AND status = 'REQUESTED'", [w.m1])).toBe(1);
    });

    it("Family Admin como OTHER (não é o titular do membro) ⇒ 403", async () => {
      const w = await world();
      const b = await c.seedBooking({ familyId: w.fam, memberId: w.m1, offer: w.offerA, startsAt: at(3 * DAY) });
      expect((await list(w.u5.token, w.fam, w.m1)).status).toBe(403);
      expect((await detail(w.u5.token, w.fam, w.m1, b.bookingId)).status).toBe(403);
      expect((await create(w.u5.token, w.fam, w.m1, { offerId: w.offerA.id, slotId: await c.slot(w.offerA, at(5 * DAY)), participantLabel: "Ana" })).status).toBe(403);
      expect((await cancel(w.u5.token, w.fam, w.m1, b.bookingId)).status).toBe(403);
    });

    it("utilizador de outra família, família inexistente e membro inexistente ⇒ 404 idêntico", async () => {
      const w = await world();
      // Visto de fora (sem relação com a família), membro real e inexistente, e família inexistente, são indistinguíveis.
      const alien = await list(w.ug.token, w.fam, w.m1);
      const alienGhostMember = await list(w.ug.token, w.fam, randomUUID());
      const noFamily = await list(w.ug.token, randomUUID(), randomUUID());
      for (const r of [alien, alienGhostMember, noFamily]) expect(r.status).toBe(404);
      expect(stripTransport(bodyOf(alien))).toEqual(stripTransport(bodyOf(noFamily)));
      expect(stripTransport(bodyOf(alienGhostMember))).toEqual(stripTransport(bodyOf(noFamily)));
      // Membro da própria família com id inexistente: 404 NOT_FOUND (a família é a dele, nada de outra família se revela).
      const ownGhostMember = await list(w.u1.token, w.fam, randomUUID());
      expect(ownGhostMember.status).toBe(404);
      expect(bodyOf(ownGhostMember).code).toBe("NOT_FOUND");
      const alienCreate = await create(w.ug.token, w.fam, w.m1, { offerId: w.offerA.id, slotId: await c.slot(w.offerA, at(5 * DAY)), participantLabel: "Ana" });
      expect(alienCreate.status).toBe(404);
      expect(await count("SELECT count(*) AS n FROM bookings WHERE family_id = $1", [w.fam])).toBe(0);
    });

    it("membro BLOCKED ⇒ 423 MEMBER_BLOCKED (mesmo para o tutor) em tudo", async () => {
      const w = await world();
      const b = await c.seedBooking({ familyId: w.fam, memberId: w.dBlocked, offer: w.offerA, startsAt: at(3 * DAY) });
      for (const r of [
        await list(w.u1.token, w.fam, w.dBlocked),
        await detail(w.u1.token, w.fam, w.dBlocked, b.bookingId),
        await create(w.u1.token, w.fam, w.dBlocked, { offerId: w.offerA.id, slotId: await c.slot(w.offerA, at(5 * DAY)), participantLabel: "Dep." }),
        await cancel(w.u1.token, w.fam, w.dBlocked, b.bookingId),
      ]) {
        expect(r.status).toBe(423);
        expect(bodyOf(r).code).toBe("MEMBER_BLOCKED");
      }
    });

    it("sem token ⇒ 401; token de ProfessionalAccount ⇒ 401 (TC-AZ-MKT-24)", async () => {
      const w = await world();
      const b = await c.seedBooking({ familyId: w.fam, memberId: w.m1, offer: w.offerA, startsAt: at(3 * DAY) });
      const pro = await c.h.newProfessional();
      const slotId = await c.slot(w.offerA, at(5 * DAY));
      for (const token of [undefined, pro.token]) {
        expect((await list(token, w.fam, w.m1)).status).toBe(401);
        expect((await detail(token, w.fam, w.m1, b.bookingId)).status).toBe(401);
        expect((await create(token, w.fam, w.m1, { offerId: w.offerA.id, slotId, participantLabel: "Ana" })).status).toBe(401);
        expect((await cancel(token, w.fam, w.m1, b.bookingId)).status).toBe(401);
      }
      expect(await count("SELECT count(*) AS n FROM bookings WHERE member_id = $1", [w.m1])).toBe(1);
    });
  });

  describe("IDOR (TC-AZ-MKT-18)", () => {
    it("marcação de outro membro da mesma família ou de outra família ⇒ 404 idêntico ao inexistente (GET e cancel)", async () => {
      const w = await world();
      const ofD = await c.seedBooking({ familyId: w.fam, memberId: w.d, offer: w.offerA, startsAt: at(3 * DAY) });
      const ofG = await c.seedBooking({ familyId: w.fg, memberId: w.mg, offer: w.offerA, startsAt: at(4 * DAY) });
      const ghost = randomUUID();

      // Referência: marcação inexistente numa família/membro do próprio utilizador; e família inexistente (o caso de família alheia).
      const reference = stripTransport(bodyOf(await detail(w.u1.token, w.fam, w.m1, ghost)));
      const foreignFamilyReference = stripTransport(bodyOf(await detail(w.u1.token, randomUUID(), randomUUID(), ghost)));
      const get = [await detail(w.u1.token, w.fam, w.m1, ofD.bookingId), await detail(w.u1.token, w.fam, w.m1, ofG.bookingId)];
      for (const r of get) {
        expect(r.status).toBe(404);
        expect(stripTransport(bodyOf(r))).toEqual(reference);
      }
      const otherFamily = await detail(w.u1.token, w.fg, w.mg, ofG.bookingId);
      expect(otherFamily.status).toBe(404);
      expect(stripTransport(bodyOf(otherFamily))).toEqual(foreignFamilyReference);
      const cancels = [await cancel(w.u1.token, w.fam, w.m1, ofD.bookingId), await cancel(w.u1.token, w.fam, w.m1, ofG.bookingId), await cancel(w.u1.token, w.fam, w.m1, ghost)];
      for (const r of cancels) {
        expect(r.status).toBe(404);
        expect(stripTransport(bodyOf(r))).toEqual(reference);
      }
      expect((await c.h.pool.query("SELECT status FROM bookings WHERE id = $1", [ofD.bookingId])).rows[0]).toEqual({ status: "REQUESTED" });
      expect((await c.h.pool.query("SELECT status FROM bookings WHERE id = $1", [ofG.bookingId])).rows[0]).toEqual({ status: "REQUESTED" });
    });

    it("a listagem de um membro só mostra as marcações desse membro", async () => {
      const w = await world();
      const mine = await c.seedBooking({ familyId: w.fam, memberId: w.m1, offer: w.offerA, startsAt: at(3 * DAY) });
      await c.seedBooking({ familyId: w.fam, memberId: w.d, offer: w.offerA, startsAt: at(4 * DAY) });
      const page = bodyOf(await list(w.u1.token, w.fam, w.m1));
      expect(page.items.map((i: { id: string }) => i.id)).toEqual([mine.bookingId]);
    });
  });

  describe("listagem e detalhe (TC-MKT-79/80)", () => {
    /** Mundo com 5 marcações: R1 +1 d, R2 +10 d (0 Kz), R3 +20 d (confirmada), R4 +30 d (cancelada pela família), R5 −2 d (concluída). */
    async function listWorld() {
      const w = await world();
      const r1 = await c.seedBooking({ familyId: w.fam, memberId: w.m1, offer: w.offerA, startsAt: at(1 * DAY), label: LABEL });
      const r2 = await c.seedBooking({ familyId: w.fam, memberId: w.m1, offer: w.offerB, startsAt: at(10 * DAY) });
      const r3 = await c.seedBooking({ familyId: w.fam, memberId: w.m1, offer: w.offerA, startsAt: at(20 * DAY), status: "CONFIRMED" });
      await c.h.pool.query("UPDATE bookings SET meeting_info = 'Sala 3, piso 2' WHERE id = $1", [r3.bookingId]);
      const r4 = await c.seedBooking({ familyId: w.fam, memberId: w.m1, offer: w.offerA, startsAt: at(30 * DAY) });
      expect((await cancel(w.u1.token, w.fam, w.m1, r4.bookingId)).status).toBe(200);
      const r5 = await c.seedBooking({ familyId: w.fam, memberId: w.m1, offer: w.offerA, startsAt: at(-2 * DAY) });
      await c.h.pool.query("UPDATE bookings SET status = 'COMPLETED', confirmed_at = $2, completed_at = $2, payment_status = 'CONFIRMED' WHERE id = $1", [r5.bookingId, START.toISOString()]);
      return { w, r1, r2, r3, r4, r5 };
    }

    it("lista por startsAt desc, com paginação por cursor (limit=2) e sem o canário das instruções", async () => {
      const { w, r1, r2, r3, r4, r5 } = await listWorld();
      const ordered = [r4, r3, r2, r1, r5].map((r) => r.bookingId);

      const first = await list(w.u1.token, w.fam, w.m1, "?limit=2");
      expect(first.status).toBe(200);
      expect(bodyOf(first).items.map((i: { id: string }) => i.id)).toEqual(ordered.slice(0, 2));
      expect(bodyOf(first).nextCursor).toEqual(expect.any(String));

      const second = await list(w.u1.token, w.fam, w.m1, `?limit=2&cursor=${encodeURIComponent(bodyOf(first).nextCursor as string)}`);
      expect(bodyOf(second).items.map((i: { id: string }) => i.id)).toEqual(ordered.slice(2, 4));
      expect(bodyOf(second).nextCursor).toEqual(expect.any(String));

      const third = await list(w.u1.token, w.fam, w.m1, `?limit=2&cursor=${encodeURIComponent(bodyOf(second).nextCursor as string)}`);
      expect(bodyOf(third).items.map((i: { id: string }) => i.id)).toEqual(ordered.slice(4));
      expect(bodyOf(third).nextCursor).toBeNull();

      const all = await list(w.u1.token, w.fam, w.m1);
      expect(all.status).toBe(200);
      expect(bodyOf(all).items.map((i: { id: string }) => i.id)).toEqual(ordered);
      expect(bodyOf(all).nextCursor).toBeNull();
      expect(JSON.stringify(all.body)).not.toContain(IBAN);
      expect(JSON.stringify(all.body)).not.toContain(NOTE);
    });

    it("filtro status: só as marcações desse estado", async () => {
      const { w, r1, r2, r4, r5 } = await listWorld();
      const ids = async (status: string): Promise<string[]> => (bodyOf(await list(w.u1.token, w.fam, w.m1, `?status=${status}`)).items as { id: string }[]).map((i) => i.id);
      expect(await ids("REQUESTED")).toEqual([r2.bookingId, r1.bookingId]);
      expect(await ids("CANCELLED")).toEqual([r4.bookingId]);
      expect(await ids("COMPLETED")).toEqual([r5.bookingId]);
      expect(await ids("NO_SHOW")).toEqual([]);
    });

    it("parâmetros inválidos ⇒ 400 MALFORMED_REQUEST (cursor, status, limit)", async () => {
      const { w } = await listWorld();
      for (const query of ["?cursor=isto-nao-e-um-cursor", "?status=FALTOU", "?limit=0", "?limit=101", "?limit=dois"]) {
        const res = await list(w.u1.token, w.fam, w.m1, query);
        expect(res.status, query).toBe(400);
        expect(bodyOf(res).code, query).toBe("MALFORMED_REQUEST");
      }
    });

    it("detalhe: instruções só com CONFIRMED/COMPLETED e preço > 0; meetingInfo só com CONFIRMED/COMPLETED; canCancel/canSendProof/canReview coerentes", async () => {
      const w = await world();
      const req = await c.seedBooking({ familyId: w.fam, memberId: w.m1, offer: w.offerA, startsAt: at(2 * DAY) });
      const conf = await c.seedBooking({ familyId: w.fam, memberId: w.m1, offer: w.offerA, startsAt: at(5 * DAY), status: "CONFIRMED" });
      await c.h.pool.query("UPDATE bookings SET meeting_info = 'Sala 3, piso 2' WHERE id = $1", [conf.bookingId]);
      const free = await c.seedBooking({ familyId: w.fam, memberId: w.m1, offer: w.offerB, startsAt: at(8 * DAY), status: "CONFIRMED" });
      await c.h.pool.query("UPDATE bookings SET meeting_info = 'Encontro no balcão' WHERE id = $1", [free.bookingId]);
      const doneAwaiting = await c.seedBooking({ familyId: w.fam, memberId: w.m1, offer: w.offerA, startsAt: at(-3 * DAY) });
      const donePaid = await c.seedBooking({ familyId: w.fam, memberId: w.m1, offer: w.offerA, startsAt: at(-5 * DAY) });
      for (const id of [doneAwaiting.bookingId, donePaid.bookingId]) {
        await c.h.pool.query("UPDATE bookings SET status = 'COMPLETED', confirmed_at = $2, completed_at = $2, meeting_info = 'Consulta concluída' WHERE id = $1", [id, START.toISOString()]);
      }
      await c.h.pool.query("UPDATE bookings SET payment_status = 'CONFIRMED' WHERE id = $1", [donePaid.bookingId]);
      const canc = await c.seedBooking({ familyId: w.fam, memberId: w.m1, offer: w.offerA, startsAt: at(6 * DAY) });
      expect((await cancel(w.u1.token, w.fam, w.m1, canc.bookingId)).status).toBe(200);

      const read = async (id: string): Promise<Record<string, unknown>> => bodyOf(await detail(w.u1.token, w.fam, w.m1, id));

      expect(await read(req.bookingId)).toMatchObject({ status: "REQUESTED", paymentStatus: "AWAITING_PROOF", paymentInstructions: null, meetingInfo: null, canCancel: true, canSendProof: false, canReview: false });

      expect(await read(conf.bookingId)).toMatchObject({ status: "CONFIRMED", paymentInstructions: INSTRUCTIONS, meetingInfo: "Sala 3, piso 2", canCancel: true, canSendProof: true, canReview: false });

      // preço 0: nunca há instruções de pagamento, mesmo confirmada
      expect(await read(free.bookingId)).toMatchObject({ status: "CONFIRMED", priceKz: 0, paymentStatus: "NOT_REQUIRED", paymentInstructions: null, meetingInfo: "Encontro no balcão", canSendProof: false });

      expect(await read(doneAwaiting.bookingId)).toMatchObject({ status: "COMPLETED", paymentInstructions: INSTRUCTIONS, canCancel: false, canSendProof: true, canReview: false, hasReview: false });

      expect(await read(donePaid.bookingId)).toMatchObject({ status: "COMPLETED", paymentStatus: "CONFIRMED", canCancel: false, canSendProof: false, canReview: true, hasReview: false });

      expect(await read(canc.bookingId)).toMatchObject({ status: "CANCELLED", paymentInstructions: null, meetingInfo: null, canCancel: false, canSendProof: false, canReview: false });
    });

    it("o canário das instruções NUNCA aparece nas marketplace (pesquisa, perfil, horários) nem na lista da família", async () => {
      const w = await world();
      await c.seedBooking({ familyId: w.fam, memberId: w.m1, offer: w.offerA, startsAt: at(5 * DAY), status: "CONFIRMED" });
      const profile = await request(c.h.app).get(`${API}/marketplace/professionals/${w.pro.professionalId}`).set(authOf(w.u1.token));
      const search = await request(c.h.app).get(`${API}/marketplace/professionals?specialtyId=${w.pro.specialtyId}`).set(authOf(w.u1.token));
      const slots = await request(c.h.app).get(`${API}/marketplace/professionals/${w.pro.professionalId}/slots?offerId=${w.offerA.id}`).set(authOf(w.u1.token));
      const family = await list(w.u1.token, w.fam, w.m1);
      for (const res of [profile, search, slots, family]) {
        expect(res.status).toBe(200);
        expect(JSON.stringify(res.body)).not.toContain(IBAN);
      }
    });
  });

  describe("cancelamento pela família (TC-MKT-81; BR-MKT-52)", () => {
    it("REQUESTED: 200 CANCELLED por FAMILY, nota em statusReason, cancelledLate (< 24 h), horário libertado e de volta em /slots", async () => {
      const w = await world();
      const slotStart = at(3 * HOUR);
      const b = await c.seedBooking({ familyId: w.fam, memberId: w.m1, offer: w.offerA, startsAt: slotStart });
      const res = await cancel(w.u1.token, w.fam, w.m1, b.bookingId, { note: `  ${NOTE}  ` });
      expect(res.status).toBe(200);
      expect(bodyOf(res)).toMatchObject({ status: "CANCELLED", cancelledBy: "FAMILY", statusReason: NOTE, cancelledLate: true, canCancel: false, canSendProof: false, meetingInfo: null, paymentInstructions: null });

      expect((await c.h.pool.query("SELECT status, cancelled_by, cancelled_at, slot_id FROM bookings WHERE id = $1", [b.bookingId])).rows[0]).toEqual({ status: "CANCELLED", cancelled_by: "FAMILY", cancelled_at: START, slot_id: null });
      expect((await c.h.pool.query("SELECT booking_id FROM professional_slots WHERE id = $1", [b.slotId])).rows[0]).toEqual({ booking_id: null });

      const free = await request(c.h.app).get(`${API}/marketplace/professionals/${w.pro.professionalId}/slots?offerId=${w.offerA.id}`).set(authOf(w.u1.token));
      expect(bodyOf(free).map((s: { id: string }) => s.id)).toContain(b.slotId);

      const audit = (await c.h.pool.query("SELECT metadata FROM audit_logs WHERE action = 'BOOKING_CANCEL' AND resource_id = $1", [b.bookingId])).rows;
      expect(audit).toEqual([{ metadata: { fromStatus: "REQUESTED" } }]);
      expect(JSON.stringify(audit)).not.toContain(NOTE);
    });

    it("cancelledLate false com mais de 24 h; nota vazia ⇒ statusReason nulo", async () => {
      const w = await world();
      const b = await c.seedBooking({ familyId: w.fam, memberId: w.m1, offer: w.offerA, startsAt: at(10 * DAY) });
      const res = await cancel(w.u1.token, w.fam, w.m1, b.bookingId, { note: "   " });
      expect(res.status).toBe(200);
      expect(bodyOf(res)).toMatchObject({ status: "CANCELLED", cancelledLate: false, statusReason: null });
    });

    it("CONFIRMED antes da hora ⇒ 200 CANCELLED; a consulta gerada passa a CANCELLED", async () => {
      const w = await world();
      const created = await create(w.u1.token, w.fam, w.m1, { offerId: w.offerA.id, slotId: await c.slot(w.offerA, at(7 * DAY)), participantLabel: LABEL });
      expect(created.status).toBe(201);
      const bookingId = bodyOf(created).id as string;
      await c.h.pool.query("UPDATE bookings SET status = 'CONFIRMED', confirmed_at = $2, meeting_info = NULL WHERE id = $1", [bookingId, START.toISOString()]);
      const appointmentId = await c.appointments.createFromBooking(c.h.db, {
        bookingId,
        processId: bodyOf(created).processId as string,
        familyId: w.fam,
        memberId: w.m1,
        startsAt: at(7 * DAY),
        professionalName: "Dra. Acesso",
        specialty: "Especialidade",
        durationMinutes: 30,
      });
      expect((await c.h.pool.query("SELECT status FROM appointments WHERE id = $1", [appointmentId.appointmentId])).rows[0]).toEqual({ status: "SCHEDULED" });

      const res = await cancel(w.u1.token, w.fam, w.m1, bookingId);
      expect(res.status).toBe(200);
      expect(bodyOf(res)).toMatchObject({ status: "CANCELLED", appointmentId: appointmentId.appointmentId });
      expect((await c.h.pool.query("SELECT status FROM appointments WHERE id = $1", [appointmentId.appointmentId])).rows[0]).toEqual({ status: "CANCELLED" });
      expect(await count("SELECT count(*) AS n FROM audit_logs WHERE action = 'BOOKING_CANCEL' AND resource_id = $1 AND metadata->>'fromStatus' = 'CONFIRMED'", [bookingId])).toBe(1);
    });

    it("segundo cancelamento ⇒ 409 INVALID_STATE_TRANSITION (terminal)", async () => {
      const w = await world();
      const b = await c.seedBooking({ familyId: w.fam, memberId: w.m1, offer: w.offerA, startsAt: at(10 * DAY) });
      expect((await cancel(w.u1.token, w.fam, w.m1, b.bookingId)).status).toBe(200);
      const again = await cancel(w.u1.token, w.fam, w.m1, b.bookingId);
      expect(again.status).toBe(409);
      expect(bodyOf(again).code).toBe("INVALID_STATE_TRANSITION");
      expect(await count("SELECT count(*) AS n FROM audit_logs WHERE action = 'BOOKING_CANCEL' AND resource_id = $1", [b.bookingId])).toBe(1);
    });

    it("depois de startsAt ⇒ 409 INVALID_STATE_TRANSITION e nada muda", async () => {
      const w = await world();
      const b = await c.seedBooking({ familyId: w.fam, memberId: w.m1, offer: w.offerA, startsAt: at(3 * HOUR) });
      c.h.clock.set(at(3 * HOUR + MIN));
      const res = await cancel(w.u1.token, w.fam, w.m1, b.bookingId);
      expect(res.status).toBe(409);
      expect(bodyOf(res).code).toBe("INVALID_STATE_TRANSITION");
      expect((await c.h.pool.query("SELECT status, slot_id FROM bookings WHERE id = $1", [b.bookingId])).rows[0]).toEqual({ status: "REQUESTED", slot_id: b.slotId });
    });

    it("nota acima de 300 caracteres ou com controlo ⇒ 422 e nada cancelado", async () => {
      const w = await world();
      const b = await c.seedBooking({ familyId: w.fam, memberId: w.m1, offer: w.offerA, startsAt: at(10 * DAY) });
      const long = await cancel(w.u1.token, w.fam, w.m1, b.bookingId, { note: "a".repeat(301) });
      const control = await cancel(w.u1.token, w.fam, w.m1, b.bookingId, { note: "a\u0007b" });
      for (const r of [long, control]) {
        expect(r.status).toBe(422);
        expect(bodyOf(r).code).toBe("VALIDATION_ERROR");
      }
      expect((await c.h.pool.query("SELECT status FROM bookings WHERE id = $1", [b.bookingId])).rows[0]).toEqual({ status: "REQUESTED" });
    });
  });

  describe("horários livres (TC-MKT-84 / TC-MKT-77 / TC-AZ-MKT-23)", () => {
    /** Profissional com oferta A (livre e ocupada), oferta B, oferta inativa C, um profissional alheio e um SUSPENDED. */
    async function slotWorld() {
      const w = await world();
      const freeA = {
        past: await c.slot(w.offerA, at(-HOUR)),
        h3: await c.slot(w.offerA, at(3 * HOUR)),
        d1: await c.slot(w.offerA, at(1 * DAY)),
        d10: await c.slot(w.offerA, at(10 * DAY)),
        d20: await c.slot(w.offerA, at(20 * DAY)),
        d60: await c.slot(w.offerA, at(60 * DAY)),
      };
      const busy = await c.seedBooking({ familyId: w.fam, memberId: w.m1, offer: w.offerA, startsAt: at(5 * DAY) });
      const otherOffer = await c.slot(w.offerB, at(2 * DAY));
      const inactive = await c.offer(w.pro, { method: "PHONE", durationMinutes: 15, priceKz: 1000, active: false });
      const inactiveSlot = await c.slot(inactive, at(4 * DAY));
      const alien = await c.professional({ name: "Dra. Alheia" });
      const alienOffer = await c.offer(alien, { method: "VIDEO", durationMinutes: 30, priceKz: 5000 });
      await c.slot(alienOffer, at(3 * HOUR));
      const suspended = await c.professional({ status: "SUSPENDED", name: "Dra. Suspensa" });
      const suspendedOffer = await c.offer(suspended, { method: "VIDEO", durationMinutes: 30, priceKz: 5000 });
      await c.slot(suspendedOffer, at(3 * HOUR));
      return { w, freeA, busy, otherOffer, inactive, inactiveSlot, alien, alienOffer, suspended, suspendedOffer };
    }
    const slotsOf = (token: string | undefined, professionalId: string, query: string) => request(c.h.app).get(`${API}/marketplace/professionals/${professionalId}/slots${query}`).set(authOf(token));
    const ids = (res: { body: unknown }): string[] => (res.body as { id: string }[]).map((s) => s.id);

    it("só horários futuros, livres e da oferta pedida; ordenados por início; janela de 62 dias pelo from/to", async () => {
      const { w, freeA } = await slotWorld();
      const wide = await slotsOf(w.u1.token, w.pro.professionalId, `?offerId=${w.offerA.id}&from=${encodeURIComponent(START.toISOString())}&to=${encodeURIComponent(at(62 * DAY).toISOString())}`);
      expect(wide.status).toBe(200);
      expect(ids(wide)).toEqual([freeA.h3, freeA.d1, freeA.d10, freeA.d20, freeA.d60]);
      expect(bodyOf(wide)[0]).toEqual({ id: freeA.h3, offerId: w.offerA.id, startsAt: at(3 * HOUR).toISOString(), endsAt: at(3 * HOUR + 30 * MIN).toISOString() });
    });

    it("sem from/to a janela é de 14 dias a partir de agora; from/to estreitos respeitam o intervalo semiaberto", async () => {
      const { w, freeA } = await slotWorld();
      const def = await slotsOf(w.u1.token, w.pro.professionalId, `?offerId=${w.offerA.id}`);
      expect(ids(def)).toEqual([freeA.h3, freeA.d1, freeA.d10]);
      const narrow = await slotsOf(w.u1.token, w.pro.professionalId, `?offerId=${w.offerA.id}&from=${encodeURIComponent(at(1 * DAY).toISOString())}&to=${encodeURIComponent(at(10 * DAY).toISOString())}`);
      expect(ids(narrow)).toEqual([freeA.d1]);
    });

    it("intervalo acima de 62 dias ou to <= from ⇒ 422", async () => {
      const { w } = await slotWorld();
      const tooWide = await slotsOf(w.u1.token, w.pro.professionalId, `?offerId=${w.offerA.id}&from=${encodeURIComponent(START.toISOString())}&to=${encodeURIComponent(at(63 * DAY).toISOString())}`);
      const reversed = await slotsOf(w.u1.token, w.pro.professionalId, `?offerId=${w.offerA.id}&from=${encodeURIComponent(at(DAY).toISOString())}&to=${encodeURIComponent(START.toISOString())}`);
      for (const r of [tooWide, reversed]) {
        expect(r.status).toBe(422);
        expect(bodyOf(r).code).toBe("VALIDATION_ERROR");
      }
    });

    it("oferta alheia, inativa, de profissional SUSPENDED ou profissional inexistente ⇒ 404 idêntico", async () => {
      const { w, alienOffer, alien, inactive, suspended, suspendedOffer } = await slotWorld();
      const cases = [
        await slotsOf(w.u1.token, w.pro.professionalId, `?offerId=${alienOffer.id}`),
        await slotsOf(w.u1.token, w.pro.professionalId, `?offerId=${inactive.id}`),
        await slotsOf(w.u1.token, suspended.professionalId, `?offerId=${suspendedOffer.id}`),
        await slotsOf(w.u1.token, randomUUID(), `?offerId=${w.offerA.id}`),
        await slotsOf(w.u1.token, alien.professionalId, `?offerId=${w.offerA.id}`),
      ];
      const reference = stripTransport(bodyOf(cases[3] ?? (() => { throw new Error("sem caso de referência"); })()));
      for (const r of cases) {
        expect(r.status).toBe(404);
        expect(stripTransport(bodyOf(r))).toEqual(reference);
      }
    });

    it("sem offerId ⇒ 400 MALFORMED_REQUEST", async () => {
      const { w } = await slotWorld();
      const res = await slotsOf(w.u1.token, w.pro.professionalId, "");
      expect(res.status).toBe(400);
      expect(bodyOf(res).code).toBe("MALFORMED_REQUEST");
    });

    it("sem sessão ou com token de profissional ⇒ 401", async () => {
      const { w } = await slotWorld();
      const pro = await c.h.newProfessional();
      expect((await slotsOf(undefined, w.pro.professionalId, `?offerId=${w.offerA.id}`)).status).toBe(401);
      expect((await slotsOf(pro.token, w.pro.professionalId, `?offerId=${w.offerA.id}`)).status).toBe(401);
    });

    it("o 61.º pedido do mesmo utilizador no mesmo minuto ⇒ 429 RATE_LIMITED com Retry-After; passado 1 min volta a passar", async () => {
      const { w } = await slotWorld();
      const limited = await c.user("limite-horarios");
      for (let i = 0; i < 60; i++) {
        const ok = await slotsOf(limited.token, w.pro.professionalId, `?offerId=${w.offerA.id}`);
        expect(ok.status, `pedido ${String(i + 1)}`).toBe(200);
      }
      const blocked = await slotsOf(limited.token, w.pro.professionalId, `?offerId=${w.offerA.id}`);
      expect(blocked.status).toBe(429);
      expect(bodyOf(blocked).code).toBe("RATE_LIMITED");
      expect(blocked.headers["retry-after"]).toBe("60");
      c.h.clock.advance(MIN + 1);
      expect((await slotsOf(limited.token, w.pro.professionalId, `?offerId=${w.offerA.id}`)).status).toBe(200);
    });
  });

  it("canário de PII: rótulo e nota ausentes de auditoria e de logs; instruções de pagamento ausentes de auditoria e de logs", async () => {
    const w = await world();
    const b = await c.seedBooking({ familyId: w.fam, memberId: w.m1, offer: w.offerA, startsAt: at(3 * DAY), label: LABEL });
    expect((await detail(w.u1.token, w.fam, w.m1, b.bookingId)).status).toBe(200);
    expect((await cancel(w.u1.token, w.fam, w.m1, b.bookingId, { note: NOTE })).status).toBe(200);
    await list(w.u1.token, w.fam, w.m1);

    const audit = (await c.h.pool.query<{ t: string }>("SELECT row_to_json(a)::text AS t FROM audit_logs a")).rows.map((r) => r.t).join("\n");
    const dump = [audit, LOGS.join("\n")].join("\n");
    for (const canary of [LABEL, NOTE, IBAN]) expect(dump, canary).not.toContain(canary);
    const actions = (await c.h.pool.query<{ action: string }>("SELECT DISTINCT action FROM audit_logs")).rows.map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["BOOKING_CANCEL"]));
    expect(actions).not.toContain("BOOKING_LIST");
    expect(actions).not.toContain("BOOKING_VIEW");
  });
});
