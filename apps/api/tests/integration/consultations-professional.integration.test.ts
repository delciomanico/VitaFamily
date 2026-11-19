/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment -- corpos JSON de respostas HTTP lidos de forma dinâmica nos testes */
// Integração (PostgreSQL real, app real com validação de pedidos E respostas) das AÇÕES do profissional sobre a marcação (MK3 S7):
// matriz estado × ação × relógio (TC-MKT-82), confirmar (TC-MKT-83), recusar (TC-MKT-84), cancelar pelo profissional, concluir e falta
// (TC-MKT-86). Acesso, isolamento, listagem e canário estão em `consultations-professional-access.integration.test.ts`.
// O relógio do harness começa em `START` e cada teste volta a ele (`beforeEach`). Cada marcação ocupa um início próprio (sem sobreposições).
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { API, START } from "../support/professionals-harness.js";
import { startConsultationsHarness, type ConsultationsHarness, type OfferFixture, type ProfessionalFixture, type UserFixture } from "../support/consultations-harness.js";

const HOUR = 3_600_000;
const DAY = 86_400_000;
const MIN = 60_000;
/** Canários de PII (BR-MKT-63): nunca em auditoria nem em logs. */
const LOGS: string[] = [];
const INSTRUCTIONS = "Transferência para o IBAN AO06 0000 0000 0000 0000 0000 0 (instrucoes-s7). Envie o comprovativo em 48 horas.";

let c: ConsultationsHarness;

type State = "REQUESTED" | "CONFIRMED" | "REJECTED" | "CANCELLED" | "COMPLETED" | "NO_SHOW";
type Action = "confirm" | "reject" | "cancel" | "complete" | "no-show";
type Phase = "before" | "after";
const STATES: State[] = ["REQUESTED", "CONFIRMED", "REJECTED", "CANCELLED", "COMPLETED", "NO_SHOW"];
const ACTIONS: Action[] = ["confirm", "reject", "cancel", "complete", "no-show"];
const PHASES: Phase[] = ["before", "after"];

const at = (ms: number): Date => new Date(START.getTime() + ms);
const bookingsOf = (familyId: string, memberId: string): string => `${API}/families/${familyId}/members/${memberId}/bookings`;
const proBase = `${API}/professional-portal/bookings`;
const bodyOf = (res: { body: unknown }): Record<string, any> => res.body as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const authOf = (token?: string): Record<string, string> => (token === undefined ? {} : { Authorization: `Bearer ${token}` });

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await c.h.pool.query<{ n: number }>(sql, params);
  return rows[0]?.n ?? 0;
}

/** Início único: um dia por cada 8 marcações (dias 1 a 51, horas 3 a 17, passos de 2 h); nunca se sobrepõem no mesmo profissional. */
let slotSeq = 0;
function nextStart(): Date {
  const i = slotSeq++;
  return at((1 + Math.floor(i / 8)) * DAY + (3 + (i % 8) * 2) * HOUR);
}
const afterStart = (startsAt: Date): Date => new Date(startsAt.getTime() + MIN);

/** Profissional APPROVED com token de vida longa e uma oferta de cada método. */
interface Pro {
  pro: ProfessionalFixture;
  token: string;
  accountId: string;
  video: OfferFixture;
  inPerson: OfferFixture;
  phone: OfferFixture;
  chat: OfferFixture;
}

async function accountOf(professionalId: string): Promise<string> {
  const { rows } = await c.h.pool.query<{ account_id: string }>("SELECT account_id FROM professionals WHERE id = $1", [professionalId]);
  return rows[0]?.account_id ?? "";
}

async function proWorld(name: string): Promise<Pro> {
  const pro = await c.professional({ name, paymentInstructions: INSTRUCTIONS });
  return {
    pro,
    token: await c.professionalToken(pro.professionalId),
    accountId: await accountOf(pro.professionalId),
    video: await c.offer(pro, { method: "VIDEO", durationMinutes: 30, priceKz: 5000 }),
    inPerson: await c.offer(pro, { method: "IN_PERSON", durationMinutes: 45, priceKz: 0 }),
    phone: await c.offer(pro, { method: "PHONE", durationMinutes: 15, priceKz: 1000 }),
    chat: await c.offer(pro, { method: "CHAT", durationMinutes: 20, priceKz: 0 }),
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
  const u = await c.user(`paciente${String(n)}`);
  const fam = await c.family(`Família S7 ${String(n)}`);
  const m = await c.member(fam, { userId: u.id, role: "FAMILY_ADMIN", name: `Paciente ${String(n)}` });
  return { u, fam, m };
}

/** Marcação criada PELA API da família (com Process, como em produção). */
interface Placed {
  id: string;
  processId: string;
  slotId: string;
  startsAt: Date;
  pt: Patient;
  offer: OfferFixture;
}

async function placed(offer: OfferFixture, startsAt: Date = nextStart(), label = "Paciente"): Promise<Placed> {
  c.h.clock.set(START);
  const pt = await patient();
  const slotId = await c.slot(offer, startsAt);
  const res = await request(c.h.app)
    .post(bookingsOf(pt.fam, pt.m))
    .set(authOf(pt.u.token))
    .send({ offerId: offer.id, slotId, participantLabel: label });
  if (res.status !== 201) throw new Error(`criação da marcação falhou: ${String(res.status)} ${JSON.stringify(res.body)}`);
  return { id: bodyOf(res).id as string, processId: bodyOf(res).processId as string, slotId, startsAt, pt, offer };
}

/** Pedido do profissional. Por omissão, o corpo válido de cada ação (sem corpo em concluir e falta). */
const DEFAULT_BODY: Record<Action, object | undefined> = {
  confirm: {},
  reject: { reason: "Motivo da recusa." },
  cancel: { reason: "Motivo do cancelamento." },
  complete: undefined,
  "no-show": undefined,
};
function act(action: Action, token: string | undefined, id: string, body: object | undefined = DEFAULT_BODY[action]) {
  const req = request(c.h.app).post(`${proBase}/${id}/${action}`).set(authOf(token));
  return body === undefined ? req : req.send(body);
}

/** Pedido que tem de ter sucesso (usado na preparação dos cenários). */
async function must(req: PromiseLike<request.Response>, status: number): Promise<request.Response> {
  const res = await req;
  if (res.status !== status) throw new Error(`esperado ${String(status)}, obtido ${String(res.status)}: ${JSON.stringify(res.body)}`);
  return res;
}

/** Estado observável da marcação: linha, horário ligado, consulta gerada e nº de auditorias do recurso. */
async function snapshot(id: string) {
  const booking = (await c.h.pool.query("SELECT status, payment_status, slot_id, status_reason, cancelled_by, cancelled_at, completed_at, meeting_info, confirmed_at, updated_at FROM bookings WHERE id = $1", [id])).rows;
  const slots = (await c.h.pool.query("SELECT id FROM professional_slots WHERE booking_id = $1", [id])).rows;
  const appointments = (await c.h.pool.query("SELECT status FROM appointments WHERE booking_id = $1", [id])).rows;
  const audit = await count("SELECT count(*)::int AS n FROM audit_logs WHERE resource_id = $1", [id]);
  return { booking, slots, appointments, audit };
}

/** Estado esperado após a ação (`null` ⇒ `INVALID_STATE_TRANSITION`). */
function expectedOutcome(state: State, action: Action, phase: Phase): State | null {
  if (state === "REQUESTED") {
    if (action === "confirm") return phase === "before" ? "CONFIRMED" : null;
    if (action === "reject") return phase === "before" ? "REJECTED" : null;
    if (action === "cancel") return phase === "before" ? "CANCELLED" : null;
    return null;
  }
  if (state === "CONFIRMED") {
    if (action === "cancel") return phase === "before" ? "CANCELLED" : null;
    if (action === "complete") return phase === "after" ? "COMPLETED" : null;
    if (action === "no-show") return phase === "after" ? "NO_SHOW" : null;
  }
  return null;
}

/** Leva uma marcação (criada por SQL, sem Process: só para a matriz) ao estado pedido, com o relógio no momento certo. */
async function reach(state: State, p: Pro, pt: Patient, startsAt: Date): Promise<string> {
  c.h.clock.set(START);
  const { bookingId } = await c.seedBooking({ familyId: pt.fam, memberId: pt.m, offer: p.inPerson, startsAt });
  if (state === "REJECTED") await must(act("reject", p.token, bookingId), 200);
  if (state === "CANCELLED") await must(act("cancel", p.token, bookingId), 200);
  if (state === "CONFIRMED" || state === "COMPLETED" || state === "NO_SHOW") await must(act("confirm", p.token, bookingId), 200);
  if (state === "COMPLETED") {
    c.h.clock.set(afterStart(startsAt));
    await must(act("complete", p.token, bookingId), 200);
  }
  if (state === "NO_SHOW") {
    c.h.clock.set(afterStart(startsAt));
    await must(act("no-show", p.token, bookingId), 200);
  }
  return bookingId;
}

async function auditOf(id: string, action: string) {
  return (await c.h.pool.query<Record<string, unknown>>("SELECT action, result, resource_type, actor_type, actor_user_id, actor_professional_account_id, family_id, subject_member_id, metadata FROM audit_logs WHERE resource_id = $1 AND action = $2", [id, action])).rows;
}

async function appointmentOf(id: string) {
  return (await c.h.pool.query<Record<string, unknown>>("SELECT status, process_id, scheduled_at, professional_name, specialty, family_id, member_id, booking_id FROM appointments WHERE booking_id = $1", [id])).rows;
}

const familyDetail = (p: Placed, id: string) => request(c.h.app).get(`${bookingsOf(p.pt.fam, p.pt.m)}/${id}`).set(authOf(p.pt.u.token));
const familyCancel = (p: Placed, id: string, body: object = {}) => request(c.h.app).post(`${bookingsOf(p.pt.fam, p.pt.m)}/${id}/cancel`).set(authOf(p.pt.u.token)).send(body);
const slotsOf = (token: string, professionalId: string, offerId: string) =>
  request(c.h.app).get(`${API}/marketplace/professionals/${professionalId}/slots?offerId=${offerId}&from=${encodeURIComponent(START.toISOString())}&to=${encodeURIComponent(at(62 * DAY).toISOString())}`).set(authOf(token));

describe("integração: ações do profissional sobre a marcação (MK3 S7)", () => {
  beforeAll(async () => {
    c = await startConsultationsHarness({ logStream: LOGS });
  }, 300_000);

  afterAll(async () => {
    await c.stop();
  });

  beforeEach(() => {
    c.h.clock.set(START);
  });

  describe("matriz estado × ação × relógio (TC-MKT-82; state-machines.md «Booking»)", () => {
    let mx: Pro;
    let mxPt: Patient;
    beforeAll(async () => {
      mx = await proWorld("Dra. Matriz");
      mxPt = await patient();
    });

    for (const state of STATES) {
      for (const action of ACTIONS) {
        for (const phase of PHASES) {
          const expected = expectedOutcome(state, action, phase);
          it(`${state} × ${action} (relógio ${phase === "before" ? "antes" : "depois"} de startsAt) ⇒ ${expected ?? "INVALID_STATE_TRANSITION"}`, async () => {
            const startsAt = nextStart();
            const id = await reach(state, mx, mxPt, startsAt);
            c.h.clock.set(phase === "before" ? START : afterStart(startsAt));
            const before = await snapshot(id);
            const res = await act(action, mx.token, id);
            if (expected) {
              expect(res.status, JSON.stringify(res.body)).toBe(200);
              expect(bodyOf(res).status).toBe(expected);
              expect((await snapshot(id)).booking[0]?.status).toBe(expected);
            } else {
              expect(res.status, JSON.stringify(res.body)).toBe(409);
              expect(bodyOf(res).code).toBe("INVALID_STATE_TRANSITION");
              expect(await snapshot(id)).toEqual(before);
            }
          });
        }
      }
    }

    it("boundary: no instante exato de startsAt cancelar ⇒ 409, concluir ⇒ 200; 1 ms antes cancelar ⇒ 200, concluir ⇒ 409", async () => {
      const startsAt = nextStart();
      const cancelled = await reach("CONFIRMED", mx, mxPt, startsAt);
      c.h.clock.set(startsAt);
      expect((await act("cancel", mx.token, cancelled)).status).toBe(409);
      c.h.clock.set(new Date(startsAt.getTime() - 1));
      expect((await act("cancel", mx.token, cancelled)).status).toBe(200);

      const startsAt2 = nextStart();
      const completed = await reach("CONFIRMED", mx, mxPt, startsAt2);
      c.h.clock.set(new Date(startsAt2.getTime() - 1));
      expect((await act("complete", mx.token, completed)).status).toBe(409);
      c.h.clock.set(startsAt2);
      const res = await act("complete", mx.token, completed);
      expect(res.status).toBe(200);
      expect(bodyOf(res).status).toBe("COMPLETED");
    });

    it("terminais sem correção: REJECTED, CANCELLED, COMPLETED e NO_SHOW não saem com nenhuma ação, antes nem depois (OP-108)", async () => {
      for (const terminal of ["REJECTED", "CANCELLED", "COMPLETED", "NO_SHOW"] as State[]) {
        const startsAt = nextStart();
        const id = await reach(terminal, mx, mxPt, startsAt);
        for (const phase of PHASES) {
          c.h.clock.set(phase === "before" ? START : afterStart(startsAt));
          for (const action of ACTIONS) {
            const res = await act(action, mx.token, id);
            expect(res.status, `${terminal} × ${action} (${phase})`).toBe(409);
            expect(bodyOf(res).code).toBe("INVALID_STATE_TRANSITION");
          }
        }
        expect((await snapshot(id)).booking[0]?.status).toBe(terminal);
      }
    });

  });

  describe("confirmar (UC-MKT-31; BR-MKT-52/55; TC-MKT-83)", () => {
    it("REQUESTED → CONFIRMED em VIDEO com meetingInfo: 200, status CONFIRMED e o meetingInfo é devolvido ao profissional", async () => {
      const p = await proWorld("Dra. Confirma Vídeo");
      const b = await placed(p.video);
      const res = await act("confirm", p.token, b.id, { meetingInfo: "  https://ligacao.exemplo.ao/sala-7  " });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(bodyOf(res)).toMatchObject({ id: b.id, status: "CONFIRMED", meetingInfo: "https://ligacao.exemplo.ao/sala-7", paymentStatus: "AWAITING_PROOF" });
      const row = (await c.h.pool.query("SELECT status, meeting_info, confirmed_at FROM bookings WHERE id = $1", [b.id])).rows[0];
      expect(row).toMatchObject({ status: "CONFIRMED", meeting_info: "https://ligacao.exemplo.ao/sala-7" });
      expect(row?.confirmed_at).toEqual(START);
    });

    it("VIDEO e PHONE exigem meetingInfo: sem ele, vazio, só espaços, com controlo ou com 301 pontos ⇒ 422 VALIDATION_ERROR; a marcação continua REQUESTED", async () => {
      const p = await proWorld("Dra. Confirma Obrigatório");
      const bodies: object[] = [{}, { meetingInfo: null }, { meetingInfo: "" }, { meetingInfo: "   " }, { meetingInfo: "Ligação\u0001" }, { meetingInfo: "x".repeat(301) }];
      for (const offer of [p.video, p.phone]) {
        const b = await placed(offer);
        const before = await snapshot(b.id);
        for (const body of bodies) {
          const res = await act("confirm", p.token, b.id, body);
          expect(res.status, `${offer.method} ${JSON.stringify(body).slice(0, 40)}`).toBe(422);
          expect(bodyOf(res).code).toBe("VALIDATION_ERROR");
        }
        expect(await snapshot(b.id)).toEqual(before);
        expect((await act("confirm", p.token, b.id, { meetingInfo: "Número para ligar: +244 900 000 000" })).status).toBe(200);
      }
    });

    it("IN_PERSON e CHAT: meetingInfo opcional ⇒ 200 sem ele (null) e, se enviado, gravado", async () => {
      const p = await proWorld("Dra. Confirma Opcional");
      const a = await placed(p.inPerson);
      const resA = await act("confirm", p.token, a.id, {});
      expect(resA.status).toBe(200);
      expect(bodyOf(resA).meetingInfo).toBeNull();
      const b = await placed(p.chat);
      const resB = await act("confirm", p.token, b.id, { meetingInfo: "Sala 3, piso 1" });
      expect(resB.status).toBe(200);
      expect(bodyOf(resB).meetingInfo).toBe("Sala 3, piso 1");
    });

    it("cria a consulta no membro na mesma transação: SCHEDULED, booking_id, process_id = o da marcação, scheduled_at = startsAt, profissional e especialidade; processos do membro inalterados", async () => {
      const p = await proWorld("Dra. Consulta Gerada");
      const b = await placed(p.video);
      const processesBefore = await count("SELECT count(*)::int AS n FROM processes WHERE member_id = $1", [b.pt.m]);
      expect(processesBefore).toBe(1);
      expect((await must(act("confirm", p.token, b.id, { meetingInfo: "Sala virtual" }), 200)).status).toBe(200);

      const appts = await appointmentOf(b.id);
      expect(appts).toHaveLength(1);
      expect(appts[0]).toEqual({
        status: "SCHEDULED",
        process_id: b.processId,
        scheduled_at: b.startsAt,
        professional_name: "Dra. Consulta Gerada",
        specialty: p.pro.specialtyName,
        family_id: b.pt.fam,
        member_id: b.pt.m,
        booking_id: b.id,
      });
      expect(await count("SELECT count(*)::int AS n FROM processes WHERE member_id = $1", [b.pt.m])).toBe(processesBefore);
    });

    it("a família vê o meetingInfo e (preço > 0) as paymentInstructions no GET; preço 0 ⇒ paymentInstructions null", async () => {
      const p = await proWorld("Dra. Vista Família");
      const paid = await placed(p.video);
      await must(act("confirm", p.token, paid.id, { meetingInfo: "Ligação para a família" }), 200);
      const paidView = await familyDetail(paid, paid.id);
      expect(paidView.status).toBe(200);
      expect(bodyOf(paidView)).toMatchObject({ status: "CONFIRMED", meetingInfo: "Ligação para a família", paymentInstructions: INSTRUCTIONS, paymentStatus: "AWAITING_PROOF" });

      const free = await placed(p.inPerson);
      await must(act("confirm", p.token, free.id, {}), 200);
      const freeView = await familyDetail(free, free.id);
      expect(bodyOf(freeView)).toMatchObject({ status: "CONFIRMED", paymentStatus: "NOT_REQUIRED", paymentInstructions: null, meetingInfo: null });
    });

    it("auditoria PROFESSIONAL_BOOKING_CONFIRM: actor PROFESSIONAL_ACCOUNT, sem family_id, subject_member_id nem actor_user_id; metadata só {fromStatus, toStatus}", async () => {
      const p = await proWorld("Dra. Auditoria");
      const b = await placed(p.video);
      await must(act("confirm", p.token, b.id, { meetingInfo: "Sala de auditoria" }), 200);
      const rows = await auditOf(b.id, "PROFESSIONAL_BOOKING_CONFIRM");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({
        action: "PROFESSIONAL_BOOKING_CONFIRM",
        result: "SUCCESS",
        resource_type: "Booking",
        actor_type: "PROFESSIONAL_ACCOUNT",
        actor_user_id: null,
        actor_professional_account_id: p.accountId,
        family_id: null,
        subject_member_id: null,
        metadata: { fromStatus: "REQUESTED", toStatus: "CONFIRMED" },
      });
    });

    it("duas confirmações concorrentes ⇒ 1×200 e 1×409 INVALID_STATE_TRANSITION; uma só consulta e uma só auditoria", async () => {
      const p = await proWorld("Dra. Corrida Confirma");
      const b = await placed(p.video);
      const [r1, r2] = await Promise.all([act("confirm", p.token, b.id, { meetingInfo: "Sala A" }), act("confirm", p.token, b.id, { meetingInfo: "Sala B" })]);
      expect([r1.status, r2.status].sort()).toEqual([200, 409]);
      const loser = r1.status === 409 ? r1 : r2;
      expect(bodyOf(loser).code).toBe("INVALID_STATE_TRANSITION");
      expect(await appointmentOf(b.id)).toHaveLength(1);
      expect(await auditOf(b.id, "PROFESSIONAL_BOOKING_CONFIRM")).toHaveLength(1);
      expect((await snapshot(b.id)).booking[0]?.status).toBe("CONFIRMED");
    });

    it("confirmar vs cancelar pela família em corrida (3 repetições) ⇒ estado final único e coerente (marcação, horário e consulta)", async () => {
      const p = await proWorld("Dra. Corrida Família");
      for (let i = 0; i < 3; i++) {
        const b = await placed(p.inPerson);
        const [confirmed, cancelled] = await Promise.all([act("confirm", p.token, b.id, {}), familyCancel(b, b.id, { note: "Não consigo ir" })]);
        // A família cancela de REQUESTED ou CONFIRMED antes da hora: ganha sempre; a confirmação só ganha se correr primeiro.
        expect(cancelled.status, `repetição ${String(i)}`).toBe(200);
        expect([200, 409]).toContain(confirmed.status);
        if (confirmed.status === 409) expect(bodyOf(confirmed).code).toBe("INVALID_STATE_TRANSITION");
        const s = await snapshot(b.id);
        expect(s.booking[0]).toMatchObject({ status: "CANCELLED", cancelled_by: "FAMILY", slot_id: null });
        expect(s.slots).toEqual([]);
        // Se a confirmação ganhou, a consulta existe e segue a marcação (CANCELLED); se perdeu, não existe consulta.
        if (confirmed.status === 200) expect(s.appointments).toEqual([{ status: "CANCELLED" }]);
        else expect(s.appointments).toEqual([]);
      }
    });
  });

  describe("recusar (UC-MKT-31; BR-MKT-52/53; TC-MKT-84)", () => {
    it("motivo obrigatório: ausente, vazio, só espaços, com controlo ou com 301 pontos ⇒ 422; nada muda", async () => {
      const p = await proWorld("Dra. Recusa Motivo");
      const b = await placed(p.inPerson);
      const before = await snapshot(b.id);
      const bodies: object[] = [{}, { reason: "" }, { reason: "   " }, { reason: "Motivo\u0001" }, { reason: "x".repeat(301) }];
      for (const body of bodies) {
        const res = await act("reject", p.token, b.id, body);
        expect(res.status, JSON.stringify(body).slice(0, 40)).toBe(422);
        expect(bodyOf(res).code).toBe("VALIDATION_ERROR");
      }
      expect(await snapshot(b.id)).toEqual(before);
    });

    it("REQUESTED → REJECTED: 200, statusReason visível à família, horário libertado (professional_slots.booking_id e bookings.slot_id nulos) e de volta em /slots", async () => {
      const p = await proWorld("Dra. Recusa Libertar");
      const b = await placed(p.inPerson, nextStart(), "Ana");
      const offered = async (): Promise<string[]> => (bodyOf(await slotsOf(b.pt.u.token, p.pro.professionalId, p.inPerson.id)) as { id: string }[]).map((s) => s.id);
      expect(await offered()).not.toContain(b.slotId);

      const res = await act("reject", p.token, b.id, { reason: "Agenda cheia nesse dia." });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(bodyOf(res)).toMatchObject({ id: b.id, status: "REJECTED", statusReason: "Agenda cheia nesse dia.", cancelledBy: null, cancelledLate: false, meetingInfo: null });

      const s = await snapshot(b.id);
      expect(s.booking[0]).toMatchObject({ status: "REJECTED", slot_id: null, status_reason: "Agenda cheia nesse dia." });
      expect(s.slots).toEqual([]);
      expect((await c.h.pool.query("SELECT booking_id FROM professional_slots WHERE id = $1", [b.slotId])).rows[0]).toEqual({ booking_id: null });
      expect(s.appointments).toEqual([]);
      expect(await offered()).toContain(b.slotId);

      const family = await familyDetail(b, b.id);
      expect(bodyOf(family)).toMatchObject({ status: "REJECTED", statusReason: "Agenda cheia nesse dia.", canCancel: false, appointmentId: null });
    });

    it("auditoria PROFESSIONAL_BOOKING_REJECT: metadata só {fromStatus, toStatus} e sem o motivo", async () => {
      const p = await proWorld("Dra. Recusa Auditoria");
      const b = await placed(p.inPerson);
      await must(act("reject", p.token, b.id, { reason: "Motivo confidencial da recusa" }), 200);
      const rows = await auditOf(b.id, "PROFESSIONAL_BOOKING_REJECT");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ actor_type: "PROFESSIONAL_ACCOUNT", family_id: null, subject_member_id: null, metadata: { fromStatus: "REQUESTED", toStatus: "REJECTED" } });
      expect(JSON.stringify(rows)).not.toContain("Motivo confidencial");
    });
  });

  describe("cancelar pelo profissional (UC-MKT-32; BR-MKT-52/53/55)", () => {
    it("motivo obrigatório ⇒ 422 em REQUESTED e CONFIRMED; nada muda", async () => {
      const p = await proWorld("Dra. Cancela Motivo");
      const requested = await placed(p.inPerson);
      const confirmed = await placed(p.inPerson);
      await must(act("confirm", p.token, confirmed.id, {}), 200);
      for (const id of [requested.id, confirmed.id]) {
        const before = await snapshot(id);
        expect((await act("cancel", p.token, id, {})).status).toBe(422);
        expect((await act("cancel", p.token, id, { reason: "   " })).status).toBe(422);
        expect(await snapshot(id)).toEqual(before);
      }
    });

    it("REQUESTED → CANCELLED por PROFESSIONAL: 200, statusReason, horário libertado, sem consulta; cancelledLate false (só a família é tardia)", async () => {
      const p = await proWorld("Dra. Cancela Pedido");
      const b = await placed(p.inPerson);
      const res = await act("cancel", p.token, b.id, { reason: "Não há médico disponível." });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(bodyOf(res)).toMatchObject({ status: "CANCELLED", cancelledBy: "PROFESSIONAL", statusReason: "Não há médico disponível.", systemReason: null, cancelledLate: false });
      const s = await snapshot(b.id);
      expect(s.booking[0]).toMatchObject({ status: "CANCELLED", cancelled_by: "PROFESSIONAL", slot_id: null });
      expect(s.slots).toEqual([]);
      expect(s.appointments).toEqual([]);
      expect(await auditOf(b.id, "PROFESSIONAL_BOOKING_CANCEL")).toHaveLength(1);
      expect(bodyOf(await familyDetail(b, b.id))).toMatchObject({ status: "CANCELLED", cancelledBy: "PROFESSIONAL", statusReason: "Não há médico disponível.", canCancel: false });
    });

    it("CONFIRMED → CANCELLED antes da hora: a consulta gerada passa a CANCELLED e o horário fica livre", async () => {
      const p = await proWorld("Dra. Cancela Confirmada");
      const b = await placed(p.video);
      await must(act("confirm", p.token, b.id, { meetingInfo: "Sala" }), 200);
      const res = await act("cancel", p.token, b.id, { reason: "Emergência familiar." });
      expect(res.status).toBe(200);
      expect(bodyOf(res).status).toBe("CANCELLED");
      expect(await appointmentOf(b.id)).toEqual([expect.objectContaining({ status: "CANCELLED", booking_id: b.id, process_id: b.processId })]);
      expect((await snapshot(b.id)).slots).toEqual([]);
      expect(bodyOf(await familyDetail(b, b.id)).appointmentId).not.toBeNull();
    });
  });

  describe("concluir e marcar falta (UC-MKT-33; BR-MKT-52/55/59; TC-MKT-86)", () => {
    it("CONFIRMED → COMPLETED com agora ≥ startsAt: 200, completedAt gravado, consulta COMPLETED e avaliação possível com preço 0", async () => {
      const p = await proWorld("Dra. Conclui Grátis");
      const b = await placed(p.inPerson);
      await must(act("confirm", p.token, b.id, {}), 200);
      c.h.clock.set(afterStart(b.startsAt));
      const res = await act("complete", p.token, b.id);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(bodyOf(res)).toMatchObject({ status: "COMPLETED", paymentStatus: "NOT_REQUIRED" });
      const row = (await c.h.pool.query("SELECT completed_at FROM bookings WHERE id = $1", [b.id])).rows[0];
      expect(row).toEqual({ completed_at: afterStart(b.startsAt) });
      expect(await appointmentOf(b.id)).toEqual([expect.objectContaining({ status: "COMPLETED" })]);
      expect(await auditOf(b.id, "PROFESSIONAL_BOOKING_COMPLETE")).toHaveLength(1);

      const family = bodyOf(await familyDetail(b, b.id));
      expect(family).toMatchObject({ status: "COMPLETED", canReview: true, hasReview: false, paymentInstructions: null });
    });

    it("COMPLETED com preço > 0 e pagamento por satisfazer: a família não pode avaliar (canReview false) mas vê as instruções", async () => {
      const p = await proWorld("Dra. Conclui Paga");
      const b = await placed(p.video);
      await must(act("confirm", p.token, b.id, { meetingInfo: "Sala" }), 200);
      c.h.clock.set(afterStart(b.startsAt));
      await must(act("complete", p.token, b.id), 200);
      const family = bodyOf(await familyDetail(b, b.id));
      expect(family).toMatchObject({ status: "COMPLETED", paymentStatus: "AWAITING_PROOF", canReview: false, paymentInstructions: INSTRUCTIONS });
    });

    it("CONFIRMED → NO_SHOW com agora ≥ startsAt: 200, consulta NO_SHOW, sem completedAt, sem avaliação; auditoria PROFESSIONAL_BOOKING_NO_SHOW", async () => {
      const p = await proWorld("Dra. Falta");
      const b = await placed(p.inPerson);
      await must(act("confirm", p.token, b.id, {}), 200);
      c.h.clock.set(afterStart(b.startsAt));
      const res = await act("no-show", p.token, b.id);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(bodyOf(res).status).toBe("NO_SHOW");
      expect((await c.h.pool.query("SELECT completed_at FROM bookings WHERE id = $1", [b.id])).rows[0]).toEqual({ completed_at: null });
      expect(await appointmentOf(b.id)).toEqual([expect.objectContaining({ status: "NO_SHOW" })]);
      expect(await auditOf(b.id, "PROFESSIONAL_BOOKING_NO_SHOW")).toHaveLength(1);
      expect(bodyOf(await familyDetail(b, b.id))).toMatchObject({ status: "NO_SHOW", canReview: false });
    });

    it("depois de COMPLETED não há correção: confirmar, recusar, cancelar, concluir e falta ⇒ 409 e nada muda", async () => {
      const p = await proWorld("Dra. Sem Correção");
      const b = await placed(p.inPerson);
      await must(act("confirm", p.token, b.id, {}), 200);
      c.h.clock.set(afterStart(b.startsAt));
      await must(act("complete", p.token, b.id), 200);
      const before = await snapshot(b.id);
      for (const action of ACTIONS) {
        const res = await act(action, p.token, b.id);
        expect(res.status, action).toBe(409);
        expect(bodyOf(res).code, action).toBe("INVALID_STATE_TRANSITION");
      }
      expect(await snapshot(b.id)).toEqual(before);
    });
  });
});
