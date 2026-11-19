/* eslint-disable @typescript-eslint/no-unsafe-member-access -- corpos JSON de respostas HTTP lidos de forma dinâmica nos testes */
// Integração (PostgreSQL real, app real com validação de pedidos E respostas) do ACESSO, da LISTAGEM e da PRIVACIDADE do lado do profissional
// (MK3 S7): bloqueio por estado de validação (authorization.md §10.2/§12.2; TC-AZ-MKT-19), IDOR e tokens cruzados (TC-AZ-MKT-20), chaves
// proibidas em todas as respostas (TC-AZ-MKT-21; BR-MKT-63), listagem com filtros, ordem e paginação (UC-MKT-30) e canário de PII (BR-MKT-63).
// As ações de estado (matriz, confirmar, recusar, cancelar, concluir e falta) estão em `consultations-professional.integration.test.ts`.
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { API, START } from "../support/professionals-harness.js";
import { startConsultationsHarness, type ConsultationsHarness, type OfferFixture, type ProfessionalFixture, type UserFixture } from "../support/consultations-harness.js";

const HOUR = 3_600_000;
const DAY = 86_400_000;
const MIN = 60_000;
/** Canários de PII (BR-MKT-63): nunca em auditoria nem em logs técnicos. */
const REASON_CANARY = "canario-s7-motivo";
const MEETING_CANARY = "canario-s7-ligacao";
const INSTRUCTIONS = "Transferência para o IBAN AO06 0000 0000 0000 0000 0000 0 (instrucoes-s7).";
const LOGS: string[] = [];

let c: ConsultationsHarness;

type Action = "confirm" | "reject" | "cancel" | "complete" | "no-show";
const ACTIONS: Action[] = ["confirm", "reject", "cancel", "complete", "no-show"];
/** Estados de validação em que o profissional só lê (authorization.md §10.2). */
const NON_APPROVED = ["DRAFT", "PENDING_REVIEW", "NEEDS_INFO", "REJECTED", "SUSPENDED"] as const;

const at = (ms: number): Date => new Date(START.getTime() + ms);
const bookingsOf = (familyId: string, memberId: string): string => `${API}/families/${familyId}/members/${memberId}/bookings`;
const proBase = `${API}/professional-portal/bookings`;
const bodyOf = (res: { body: unknown }): Record<string, any> => res.body as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
/** Campos de transporte (pedido/instância) variam por pedido; o resto tem de ser idêntico para não haver enumeração. */
const stripTransport = (body: unknown): unknown => ({ ...(body as object), requestId: 0, instance: 0 });
const authOf = (token?: string): Record<string, string> => (token === undefined ? {} : { Authorization: `Bearer ${token}` });

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await c.h.pool.query<{ n: number }>(sql, params);
  return rows[0]?.n ?? 0;
}

/** Início único por profissional (dias 1 a 51, horas 3 a 17, passos de 2 h). */
let slotSeq = 0;
function nextStart(): Date {
  const i = slotSeq++;
  return at((1 + Math.floor(i / 8)) * DAY + (3 + (i % 8) * 2) * HOUR);
}
const afterStart = (startsAt: Date): Date => new Date(startsAt.getTime() + MIN);

/** Corpo válido de cada ação (sem corpo em concluir e falta). */
const DEFAULT_BODY: Record<Action, object | undefined> = {
  confirm: { meetingInfo: "Sala virtual" },
  reject: { reason: "Motivo da recusa." },
  cancel: { reason: "Motivo do cancelamento." },
  complete: undefined,
  "no-show": undefined,
};
function act(action: Action, token: string | undefined, id: string, body: object | undefined = DEFAULT_BODY[action]) {
  const req = request(c.h.app).post(`${proBase}/${id}/${action}`).set(authOf(token));
  return body === undefined ? req : req.send(body);
}
const get = (token: string | undefined, id: string) => request(c.h.app).get(`${proBase}/${id}`).set(authOf(token));
const list = (token: string | undefined, query = "") => request(c.h.app).get(`${proBase}${query}`).set(authOf(token));

async function must(req: PromiseLike<request.Response>, status: number): Promise<request.Response> {
  const res = await req;
  if (res.status !== status) throw new Error(`esperado ${String(status)}, obtido ${String(res.status)}: ${JSON.stringify(res.body)}`);
  return res;
}

interface Pro {
  pro: ProfessionalFixture;
  token: string;
  accountId: string;
  video: OfferFixture;
  inPerson: OfferFixture;
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
  };
}

async function setValidation(p: Pro, status: string): Promise<void> {
  await c.h.pool.query("UPDATE professionals SET validation_status = $2::professional_validation_status WHERE id = $1", [p.pro.professionalId, status]);
}

interface Patient {
  u: UserFixture;
  fam: string;
  m: string;
}

let patientSeq = 0;
async function patient(): Promise<Patient> {
  const n = ++patientSeq;
  const u = await c.user(`acesso${String(n)}`);
  const fam = await c.family(`Família acesso ${String(n)}`);
  const m = await c.member(fam, { userId: u.id, role: "FAMILY_ADMIN", name: `Acesso ${String(n)}` });
  return { u, fam, m };
}

interface Placed {
  id: string;
  processId: string;
  slotId: string;
  startsAt: Date;
  pt: Patient;
  offer: OfferFixture;
}

/** Marcação criada pela API da família (com Process). O relógio volta a `START` para a criação. */
async function placed(offer: OfferFixture, startsAt: Date = nextStart(), label = "Paciente"): Promise<Placed> {
  c.h.clock.set(START);
  const pt = await patient();
  const slotId = await c.slot(offer, startsAt);
  const res = await request(c.h.app).post(bookingsOf(pt.fam, pt.m)).set(authOf(pt.u.token)).send({ offerId: offer.id, slotId, participantLabel: label });
  if (res.status !== 201) throw new Error(`criação da marcação falhou: ${String(res.status)} ${JSON.stringify(res.body)}`);
  return { id: bodyOf(res).id as string, processId: bodyOf(res).processId as string, slotId, startsAt, pt, offer };
}

/** Estado observável: linha, horário ligado, consulta gerada e nº de auditorias do recurso. */
async function snapshot(id: string) {
  const booking = (await c.h.pool.query("SELECT status, payment_status, slot_id, status_reason, cancelled_by, completed_at, meeting_info, updated_at FROM bookings WHERE id = $1", [id])).rows;
  const slots = (await c.h.pool.query("SELECT id FROM professional_slots WHERE booking_id = $1", [id])).rows;
  const appointments = (await c.h.pool.query("SELECT status FROM appointments WHERE booking_id = $1", [id])).rows;
  const audit = await count("SELECT count(*)::int AS n FROM audit_logs WHERE resource_id = $1", [id]);
  return { booking, slots, appointments, audit };
}

/** Recolhe todas as chaves e todos os valores de texto de um JSON, em qualquer profundidade. */
function walk(value: unknown, keys: string[] = [], strings: string[] = []): { keys: string[]; strings: string[] } {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, keys, strings);
  } else if (typeof value === "object" && value !== null) {
    for (const [key, inner] of Object.entries(value)) {
      keys.push(key);
      walk(inner, keys, strings);
    }
  } else if (typeof value === "string") {
    strings.push(value);
  }
  return { keys, strings };
}

/** Chaves que o profissional nunca pode receber (BR-MKT-63; TC-AZ-MKT-21). */
const FORBIDDEN_KEYS = ["familyId", "memberId", "userId", "createdByUserId", "processId", "subjectMemberId", "family_id", "member_id", "user_id", "email", "name"];

describe("integração: acesso, listagem e privacidade das marcações do profissional (MK3 S7)", () => {
  beforeAll(async () => {
    c = await startConsultationsHarness({ logStream: LOGS });
  }, 300_000);

  afterAll(async () => {
    await c.stop();
  });

  beforeEach(() => {
    c.h.clock.set(START);
  });

  describe("bloqueio por estado de validação (authorization.md §10.2, §12.2; TC-AZ-MKT-19; TC-MKT-86)", () => {
    for (const status of NON_APPROVED) {
      it(`${status}: leitura e listagem continuam; confirmar, recusar, cancelar, concluir e falta ⇒ 409 PROFESSIONAL_LOCKED sem alterar nada; APPROVED volta a poder`, async () => {
        const p = await proWorld(`Dra. ${status}`);
        const toConfirm = await placed(p.video);
        const toReject = await placed(p.inPerson);
        const toCancel = await placed(p.inPerson);
        const confirmed = await placed(p.inPerson);
        await must(act("confirm", p.token, confirmed.id, {}), 200);

        await setValidation(p, status);
        const ids = [toConfirm.id, toReject.id, toCancel.id, confirmed.id];
        const before = await Promise.all(ids.map((id) => snapshot(id)));

        expect((await get(p.token, toConfirm.id)).status).toBe(200);
        expect((await list(p.token)).status).toBe(200);

        for (const [action, id] of [
          ["confirm", toConfirm.id],
          ["reject", toReject.id],
          ["cancel", toCancel.id],
        ] as const) {
          const res = await act(action, p.token, id);
          expect(res.status, action).toBe(409);
          expect(bodyOf(res).code, action).toBe("PROFESSIONAL_LOCKED");
        }
        c.h.clock.set(afterStart(confirmed.startsAt));
        for (const action of ["complete", "no-show"] as const) {
          const res = await act(action, p.token, confirmed.id);
          expect(res.status, action).toBe(409);
          expect(bodyOf(res).code, action).toBe("PROFESSIONAL_LOCKED");
        }
        expect(await Promise.all(ids.map((id) => snapshot(id)))).toEqual(before);

        // Reativado (APPROVED): as mesmas ações voltam a ser aceites, a partir do estado que ficou.
        // O relógio volta a `START` (antes de todas as marcações pedidas) e só depois avança para concluir.
        await setValidation(p, "APPROVED");
        c.h.clock.set(START);
        expect((await act("confirm", p.token, toConfirm.id, { meetingInfo: "Sala virtual" })).status).toBe(200);
        expect((await act("reject", p.token, toReject.id, { reason: "Sem vaga." })).status).toBe(200);
        expect((await act("cancel", p.token, toCancel.id, { reason: "Sem vaga." })).status).toBe(200);
        c.h.clock.set(afterStart(confirmed.startsAt));
        expect((await act("complete", p.token, confirmed.id)).status).toBe(200);
      });
    }
  });

  describe("IDOR e tokens cruzados (authorization.md §10.1/§12.2; TC-AZ-MKT-20)", () => {
    it("marcação de outro profissional ⇒ 404 idêntico ao inexistente em GET e em cada ação; nada muda na marcação alheia", async () => {
      const mine = await proWorld("Dra. Dona");
      const other = await proWorld("Dra. Alheia IDOR");
      const foreign = await placed(other.video);
      const missing = randomUUID();
      const before = await snapshot(foreign.id);

      const attempts: Record<string, (id: string) => PromiseLike<request.Response>> = {
        GET: (id) => get(mine.token, id),
        confirm: (id) => act("confirm", mine.token, id, { meetingInfo: "Sala" }),
        reject: (id) => act("reject", mine.token, id, { reason: "Motivo" }),
        cancel: (id) => act("cancel", mine.token, id, { reason: "Motivo" }),
        complete: (id) => act("complete", mine.token, id),
        "no-show": (id) => act("no-show", mine.token, id),
      };
      const reference = await get(mine.token, missing);
      expect(reference.status).toBe(404);
      expect(bodyOf(reference).code).toBe("NOT_FOUND");
      const refBody = stripTransport(bodyOf(reference));

      for (const [name, attempt] of Object.entries(attempts)) {
        const foreignRes = await attempt(foreign.id);
        const missingRes = await attempt(missing);
        expect(foreignRes.status, name).toBe(404);
        expect(bodyOf(foreignRes).code, name).toBe("NOT_FOUND");
        expect(stripTransport(bodyOf(foreignRes)), name).toEqual(stripTransport(bodyOf(missingRes)));
        expect(stripTransport(bodyOf(foreignRes)), name).toEqual(refBody);
      }
      expect(await snapshot(foreign.id)).toEqual(before);
    });

    it("sem token, token de User (família), token de clínica e token de User de sistema ⇒ 401 em todas as rotas do portal", async () => {
      const p = await proWorld("Dra. Tokens");
      const b = await placed(p.video);
      const familyUser = await c.user("tokens-familia");
      const tokens: { name: string; token: string | undefined }[] = [
        { name: "sem token", token: undefined },
        { name: "User da família", token: familyUser.token },
        { name: "clínica", token: await c.h.clinicToken() },
        { name: "User de sistema", token: await c.h.userToken() },
      ];
      const before = await snapshot(b.id);
      for (const { name, token } of tokens) {
        expect((await list(token)).status, `${name} lista`).toBe(401);
        expect((await get(token, b.id)).status, `${name} detalhe`).toBe(401);
        for (const action of ACTIONS) {
          expect((await act(action, token, b.id)).status, `${name} ${action}`).toBe(401);
        }
      }
      expect(await snapshot(b.id)).toEqual(before);
    });
  });

  describe("privacidade: nenhuma resposta do profissional leva chaves ou valores proibidos (BR-MKT-63; TC-AZ-MKT-21)", () => {
    it("lista e detalhe percorrem todo o JSON: sem familyId, memberId, userId, processId nem e-mail; proof ausente sem comprovativo", async () => {
      const p = await proWorld("Dra. Privacidade");
      const b = await placed(p.video, nextStart(), "Rótulo Ana");
      await must(act("confirm", p.token, b.id, { meetingInfo: "Sala privada" }), 200);
      const forbiddenValues = [b.pt.fam, b.pt.m, b.pt.u.id, b.processId, b.pt.u.email, "@"];

      const detail = await must(get(p.token, b.id), 200);
      const listed = await must(list(p.token), 200);
      for (const body of [detail.body, listed.body]) {
        const { keys, strings } = walk(body);
        expect(keys.filter((k) => FORBIDDEN_KEYS.includes(k))).toEqual([]);
        const dump = strings.join("\n");
        for (const value of forbiddenValues) expect(dump).not.toContain(value);
      }
      expect(bodyOf(detail)).not.toHaveProperty("proof");
      expect(bodyOf(detail).participantLabel).toBe("Rótulo Ana");
      expect(bodyOf(listed).items[0]).not.toHaveProperty("proof");
    });

    it("a ação de confirmar e a de recusar também não devolvem chaves proibidas", async () => {
      const p = await proWorld("Dra. Privacidade Ações");
      const a = await placed(p.inPerson);
      const r = await placed(p.inPerson);
      const responses = [await must(act("confirm", p.token, a.id, {}), 200), await must(act("reject", p.token, r.id, { reason: "Motivo" }), 200)];
      for (const res of responses) {
        const { keys, strings } = walk(res.body);
        expect(keys.filter((k) => FORBIDDEN_KEYS.includes(k))).toEqual([]);
        expect(strings.join("\n")).not.toContain(a.pt.fam);
      }
    });
  });

  describe("listagem (UC-MKT-30; BR-MKT-50; TC-AZ-MKT-20)", () => {
    /**
     * Mundo de listagem: E (REJECTED, dia 5), D (CONFIRMED, dia 4), C (REQUESTED, dia 3), B (CONFIRMED, dia 2) e A (REQUESTED, dia 1),
     * criadas fora de ordem. Depois o relógio avança para depois de A: A deixa de ser «futura».
     */
    async function listWorld() {
      const p = await proWorld("Dra. Lista");
      const other = await proWorld("Dra. Lista Alheia");
      const e = await placed(p.inPerson, at(5 * DAY + 3 * HOUR), "E");
      const d = await placed(p.inPerson, at(4 * DAY + 3 * HOUR), "D");
      const cc = await placed(p.inPerson, at(3 * DAY + 3 * HOUR), "C");
      const b = await placed(p.inPerson, at(2 * DAY + 3 * HOUR), "B");
      const a = await placed(p.inPerson, at(1 * DAY + 3 * HOUR), "A");
      const alien = await placed(other.inPerson, at(2 * DAY + 3 * HOUR), "Alheia");
      c.h.clock.set(START);
      await must(act("reject", p.token, e.id, { reason: "Sem vaga." }), 200);
      await must(act("confirm", p.token, d.id, {}), 200);
      await must(act("confirm", p.token, b.id, {}), 200);
      // Relógio entre A (dia 1, passada) e B (dia 2, futura).
      c.h.clock.set(at(1 * DAY + 4 * HOUR));
      return { p, e, d, cc, b, a, alien };
    }
    const ids = (res: request.Response): string[] => (bodyOf(res).items as { id: string }[]).map((i) => i.id);

    it("omissão = REQUESTED e CONFIRMED futuras, por startsAt ascendente; sem REJECTED/passadas nem marcações de outro profissional", async () => {
      const w = await listWorld();
      const res = await must(list(w.p.token), 200);
      expect(ids(res)).toEqual([w.b.id, w.cc.id, w.d.id]);
      expect(ids(res)).not.toContain(w.alien.id);
      expect(bodyOf(res).nextCursor).toBeNull();
      expect(await count("SELECT count(*)::int AS n FROM bookings WHERE professional_id = $1", [w.p.pro.professionalId])).toBe(5);
    });

    it("filtro status: só as marcações desse estado (REJECTED ⇒ E; CONFIRMED ⇒ B e D, incluindo a passada)", async () => {
      const w = await listWorld();
      const rejected = await must(list(w.p.token, "?status=REJECTED"), 200);
      expect(ids(rejected)).toEqual([w.e.id]);
      const confirmed = await must(list(w.p.token, "?status=CONFIRMED"), 200);
      expect(ids(confirmed)).toEqual([w.b.id, w.d.id]);
      const requested = await must(list(w.p.token, "?status=REQUESTED"), 200);
      expect(ids(requested)).toEqual(expect.arrayContaining([w.cc.id]));
      const requestedItems = bodyOf(requested).items as { status: string }[];
      expect(requestedItems.every((i) => i.status === "REQUESTED")).toBe(true);
    });

    it("from/to filtram por startsAt com início inclusivo e fim exclusivo; sem from/to e com estado omisso, a janela é só de futuras", async () => {
      const w = await listWorld();
      const q = (from: Date, to: Date) => `?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
      expect(ids(await must(list(w.p.token, q(w.b.startsAt, w.cc.startsAt)), 200))).toEqual([w.b.id]);
      expect(ids(await must(list(w.p.token, q(w.b.startsAt, afterStart(w.cc.startsAt))), 200))).toEqual([w.b.id, w.cc.id]);
      // Com uma janela explícita, a omissão de estados deixa de limitar: a REJECTED aparece.
      expect(ids(await must(list(w.p.token, q(new Date(w.e.startsAt.getTime() - HOUR), afterStart(w.e.startsAt))), 200))).toEqual([w.e.id]);
    });

    it("from/to em intervalo vazio ou invertido ⇒ 400 MALFORMED_REQUEST (o contrato não documenta 422); limit fora de 1..100 ou não inteiro ⇒ 400 MALFORMED_REQUEST", async () => {
      const w = await listWorld();
      const inverted = await list(w.p.token, `?from=${encodeURIComponent(w.b.startsAt.toISOString())}&to=${encodeURIComponent(w.b.startsAt.toISOString())}`);
      expect(inverted.status).toBe(400);
      expect(bodyOf(inverted).code).toBe("MALFORMED_REQUEST");
      for (const limit of ["0", "101", "abc"]) {
        const res = await list(w.p.token, `?limit=${limit}`);
        expect(res.status, `limit=${limit}`).toBe(400);
        expect(bodyOf(res).code, `limit=${limit}`).toBe("MALFORMED_REQUEST");
      }
      const badStatus = await list(w.p.token, "?status=FOO");
      expect(badStatus.status).toBe(400);
    });

    it("paginação por cursor: limit=2 devolve duas, o cursor devolve o resto sem repetir nem saltar; cursor inválido ⇒ 400 MALFORMED_REQUEST", async () => {
      const w = await listWorld();
      const first = await must(list(w.p.token, "?limit=2"), 200);
      expect(ids(first)).toEqual([w.b.id, w.cc.id]);
      expect(typeof bodyOf(first).nextCursor).toBe("string");
      const second = await must(list(w.p.token, `?limit=2&cursor=${encodeURIComponent(bodyOf(first).nextCursor as string)}`), 200);
      expect(ids(second)).toEqual([w.d.id]);
      expect(bodyOf(second).nextCursor).toBeNull();

      const garbage = ["lixo", Buffer.from(JSON.stringify({ s: "não-é-data", id: randomUUID() })).toString("base64url"), Buffer.from(JSON.stringify({ s: START.toISOString(), id: "x" })).toString("base64url")];
      for (const cursor of garbage) {
        const res = await list(w.p.token, `?cursor=${encodeURIComponent(cursor)}`);
        expect(res.status, cursor).toBe(400);
        expect(bodyOf(res).code, cursor).toBe("MALFORMED_REQUEST");
      }
    });

    it("listagem e detalhe com corpo de marcação alheia nunca aparecem: o profissional só vê as suas", async () => {
      const w = await listWorld();
      expect((await get(w.p.token, w.alien.id)).status).toBe(404);
      const all = await must(list(w.p.token, "?status=REQUESTED"), 200);
      expect(ids(all)).not.toContain(w.alien.id);
    });
  });

  describe("canário de PII (BR-MKT-63): o motivo e a ligação nunca vão para a auditoria nem para os logs", () => {
    it("reason e meetingInfo canário ausentes de audit_logs e dos logs técnicos capturados (as respostas podem trazê-los)", async () => {
      const p = await proWorld("Dra. Canário");
      const logsBefore = LOGS.length;
      const v = await placed(p.video);
      await must(act("confirm", p.token, v.id, { meetingInfo: MEETING_CANARY }), 200);
      const r = await placed(p.inPerson);
      await must(act("reject", p.token, r.id, { reason: REASON_CANARY }), 200);
      const cn = await placed(p.inPerson);
      await must(act("confirm", p.token, cn.id, {}), 200);
      await must(act("cancel", p.token, cn.id, { reason: REASON_CANARY }), 200);
      await must(get(p.token, v.id), 200);
      await must(list(p.token), 200);

      const audit = (await c.h.pool.query<{ t: string }>("SELECT row_to_json(a)::text AS t FROM audit_logs a")).rows.map((row) => row.t).join("\n");
      // Hoje as rotas HTTP não escrevem logs de acesso (só erros não tratados ≥ 500, `error-middleware.ts`): a metade dos logs é uma
      // verificação negativa que passa por omissão até existirem logs de acesso (BR-MKT-63 pressupõe-nos).
      const dump = [audit, LOGS.slice(logsBefore).join("\n")].join("\n");
      for (const canary of [REASON_CANARY, MEETING_CANARY]) expect(dump, canary).not.toContain(canary);
      const actions = (await c.h.pool.query<{ action: string }>("SELECT DISTINCT action FROM audit_logs WHERE actor_type = 'PROFESSIONAL_ACCOUNT'")).rows.map((row) => row.action);
      expect(actions).toEqual(expect.arrayContaining(["PROFESSIONAL_BOOKING_CONFIRM", "PROFESSIONAL_BOOKING_REJECT", "PROFESSIONAL_BOOKING_CANCEL"]));
      expect(await count("SELECT count(*)::int AS n FROM audit_logs WHERE actor_type = 'PROFESSIONAL_ACCOUNT' AND (family_id IS NOT NULL OR subject_member_id IS NOT NULL OR actor_user_id IS NOT NULL)")).toBe(0);
    });
  });
});
