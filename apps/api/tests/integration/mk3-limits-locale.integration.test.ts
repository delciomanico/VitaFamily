/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any -- corpos JSON de respostas HTTP lidos de forma dinâmica nos testes */
// Limites, rate limiting e locale de MK3 (S13): TC-MKT-111 (BR-MKT-66) e TC-MKT-110 (BR-MKT-02/31/59). PostgreSQL real + API real validada contra o
// openapi.yaml; relógio injetável do harness (os limitadores de consultations usam o relógio da aplicação, por isso os testes avançam o tempo em vez de esperar).
//   Limites (TC-MKT-111): 10 marcações ativas por membro ⇒ 409 LIMIT_EXCEEDED; 10 criações/dia (as canceladas contam) ⇒ 429 RATE_LIMITED com Retry-After;
//   5 comprovativos por marcação ⇒ 409 LIMIT_EXCEEDED; uploads 20/h ⇒ 429; avaliações 20/dia e denúncias 10/dia (marcações concluídas semeadas por SQL);
//   downloads e listas 60/min (horários, avaliações públicas, lista e download de comprovativos da família, download do profissional e do admin)
//   ⇒ 429 com Retry-After de 1 a 60 s, por utilizador, e a janela esvazia-se ao avançar o relógio.
//   Locale (TC-MKT-110): `priceKz` inteiro em todas as respostas (e nenhum outro campo de preço/moeda); datas-hora em UTC («Z») e `consultedMonth` date-only
//   calculado em Africa/Luanda na fronteira de mês (marcação a 2026-12-31T23:30Z ⇒ 2027-01-01); TODAS as respostas de erro do ficheiro (cada 4xx provocado
//   nos testes) têm `title`/`detail`/`errors[]` em pt-PT, sem dados do utilizador (rótulo, nota, comentário, e-mail, ids) nem causas distinguíveis.
// NÃO coberto aqui, com justificação:
//   - «falha FECHADA se o limitador estiver indisponível» (TC-MKT-111 «S»): os limitadores de `consultations` são em memória, por processo
//     (`SlidingWindowLimiter`, sem dependência externa que possa ficar indisponível), pelo que não existe caminho «aberto» a testar; os limites
//     por BD (10 ativas, 10 criações/dia) são aplicados na transação. Fica `it.skip` abaixo com a justificação. Consequência de segurança (reportada):
//     o limite 20/h, 20/dia, 10/dia e 60/min é por processo e perde-se num reinício; só o de 10 criações/dia e as 10 ativas assentam na BD.
//   - Os avisos de UI («Não escreva dados de saúde», aviso de categoria BR-MKT-02, aviso do comprovativo) são constantes da UI (apps/web): fora de apps/api.
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { binaryParser, pdf } from "../support/mk3-ops.js";
import { API, START } from "../support/professionals-harness.js";
import { startConsultationsHarness, type ConsultationsHarness, type OfferFixture, type ProfessionalFixture, type UserFixture } from "../support/consultations-harness.js";

const HOUR = 3_600_000;
const DAY = 86_400_000;
const MIN = 60_000;
/** Canários de PII (BR-MKT-63): nunca em corpos de erro. */
const LABEL = "canario-rotulo-s13";
const NOTE = "canario-nota-s13";
const COMMENT = "canario-comentario-s13";
const MEETING = "canario-ligacao-s13";

let c: ConsultationsHarness;
let admin: UserFixture;
const bodyOf = (res: { body: unknown }): Record<string, any> => res.body as Record<string, any>;
const authOf = (token?: string): Record<string, string> => (token === undefined ? {} : { Authorization: `Bearer ${token}` });
const bookingsOf = (familyId: string, memberId: string): string => `${API}/families/${familyId}/members/${memberId}/bookings`;
const proBase = `${API}/professional-portal`;
const now = (): Date => c.h.clock.now();
const rel = (ms: number): Date => new Date(now().getTime() + ms);

/** Todas as respostas de erro (4xx) do ficheiro e os valores de utilizador que nunca podem aparecer nelas. */
const errorSamples: { label: string; res: request.Response }[] = [];
const userSecrets = new Set<string>([LABEL, NOTE, COMMENT, MEETING]);
/** Respostas 2xx de JSON (para a verificação de preços e datas). */
const okSamples: { label: string; body: unknown }[] = [];

function track(label: string, res: request.Response): request.Response {
  if (res.status >= 400) errorSamples.push({ label: `${label} ⇒ ${String(res.status)}`, res });
  else if (res.headers["content-type"]?.includes("json")) okSamples.push({ label, body: res.body });
  return res;
}

const get = async (label: string, url: string, token?: string, query?: Record<string, string>): Promise<request.Response> => track(label, await request(c.h.app).get(url).query(query ?? {}).set(authOf(token)));
const post = async (label: string, url: string, token: string | undefined, body: object = {}): Promise<request.Response> => track(label, await request(c.h.app).post(url).set(authOf(token)).send(body));
const put = async (label: string, url: string, token: string | undefined, body: object): Promise<request.Response> => track(label, await request(c.h.app).put(url).set(authOf(token)).send(body));
const upload = async (label: string, url: string, token: string, file: Buffer): Promise<request.Response> => track(label, await request(c.h.app).post(url).set(authOf(token)).attach("file", file, { filename: "comprovativo.pdf", contentType: "application/pdf" }));
const download = async (label: string, url: string, token: string): Promise<request.Response> => track(label, await request(c.h.app).get(url).set(authOf(token)).buffer(true).parse(binaryParser as never));

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await c.h.pool.query<{ n: number }>(sql, params);
  return rows[0]?.n ?? 0;
}

let seq = 0;
interface World {
  pro: ProfessionalFixture;
  token: string;
  video: OfferFixture;
  free: OfferFixture;
}
async function world(): Promise<World> {
  const pro = await c.professional({ name: "Dra. Limites", paymentInstructions: "Transferência para a conta de teste (limites)." });
  return {
    pro,
    token: await c.professionalToken(pro.professionalId),
    video: await c.offer(pro, { method: "VIDEO", durationMinutes: 30, priceKz: 5000 }),
    free: await c.offer(pro, { method: "CHAT", durationMinutes: 20, priceKz: 0 }),
  };
}
interface Patient {
  u: UserFixture;
  fam: string;
  m: string;
}
async function patient(): Promise<Patient> {
  const n = ++seq;
  const u = await c.user(`limites${String(n)}`);
  userSecrets.add(u.email);
  userSecrets.add(u.id);
  const fam = await c.family(`Família limites ${String(n)}`);
  const m = await c.member(fam, { userId: u.id, role: "FAMILY_ADMIN", name: `Limites ${String(n)}` });
  return { u, fam, m };
}

/** Início único por marcação a partir do instante atual do relógio (um dia por marcação). */
let startSeq = 0;
/** Dentro da janela de 8 semanas da criação; cíclico (nenhum teste usa mais de 40 horários). */
const nextStart = (): Date => rel((2 + (startSeq++ % 40)) * DAY + 3 * HOUR);

async function seeded(pt: Patient, offer: OfferFixture, status: "REQUESTED" | "CONFIRMED" = "CONFIRMED", startsAt: Date = nextStart(), countsAsCreation = true): Promise<string> {
  return (await c.seedBooking({ familyId: pt.fam, memberId: pt.m, offer, startsAt, status, createdByUserId: countsAsCreation ? pt.u.id : null })).bookingId;
}

/** Marcação concluída (e paga) agora: elegível para avaliar. */
async function completedBooking(pt: Patient, offer: OfferFixture, startsAt: Date = nextStart()): Promise<string> {
  const id = await seeded(pt, offer, "CONFIRMED", startsAt);
  await c.h.pool.query("UPDATE bookings SET status = 'COMPLETED', completed_at = $2, payment_status = CASE WHEN price_kz = 0 THEN 'NOT_REQUIRED'::booking_payment_status ELSE 'CONFIRMED'::booking_payment_status END WHERE id = $1", [id, now().toISOString()]);
  return id;
}

/** Comprovativo recusado e disputado (descarregável por família, profissional e admin). */
async function disputedProof(w: World, pt: Patient): Promise<{ bookingId: string; proofId: string }> {
  const bookingId = await seeded(pt, w.video);
  const up = await upload("upload", `${bookingsOf(pt.fam, pt.m)}/${bookingId}/payment-proofs`, pt.u.token, pdf("limites"));
  if (up.status !== 201) throw new Error(`upload falhou: ${String(up.status)} ${JSON.stringify(up.body)}`);
  const proofId = bodyOf(up).id as string;
  await c.runProofScans();
  const decided = await post("decisão", `${proBase}/bookings/${bookingId}/payment-proofs/${proofId}/decision`, w.token, { decision: "REJECT", reason: "Não encontrei a transferência." });
  if (decided.status !== 200) throw new Error(`rejeição falhou: ${String(decided.status)}`);
  const disputed = await post("disputa", `${bookingsOf(pt.fam, pt.m)}/${bookingId}/payment-proofs/${proofId}/dispute`, pt.u.token, { note: NOTE });
  if (disputed.status !== 200) throw new Error(`disputa falhou: ${String(disputed.status)}`);
  return { bookingId, proofId };
}

/** Cada teste começa num instante próprio (janelas dos limitadores independentes), com tokens de vida longa (120 dias a partir de START). */
let testNo = 0;
beforeEach(() => {
  c.h.clock.set(new Date(START.getTime() + ++testNo * 2 * DAY));
});

beforeAll(async () => {
  c = await startConsultationsHarness();
  admin = await c.admin();
}, 300_000);

afterAll(async () => {
  await c.stop();
});

const RETRY_AFTER = /^[1-9]\d*$/;

describe("limites de MK3 (TC-MKT-111; BR-MKT-66)", () => {
  it("10 marcações ativas por membro: a 11.ª ⇒ 409 LIMIT_EXCEEDED, nada criado nem reservado", async () => {
    const w = await world();
    const pt = await patient();
    // sem `createdByUserId`: não contam para as 10 criações/dia, só o limite de 10 ativas está em causa
    for (let i = 0; i < 10; i++) await seeded(pt, w.video, i % 2 === 0 ? "REQUESTED" : "CONFIRMED", nextStart(), false);
    expect(await count("SELECT count(*)::int AS n FROM bookings WHERE member_id = $1 AND status IN ('REQUESTED','CONFIRMED')", [pt.m])).toBe(10);

    const slotId = await c.slot(w.video, nextStart());
    const res = await post("11.ª ativa", bookingsOf(pt.fam, pt.m), pt.u.token, { offerId: w.video.id, slotId, participantLabel: LABEL });
    expect(res.status).toBe(409);
    expect(bodyOf(res).code).toBe("LIMIT_EXCEEDED");
    expect(res.headers["retry-after"]).toBeUndefined();
    expect(await count("SELECT count(*)::int AS n FROM bookings WHERE member_id = $1", [pt.m])).toBe(10);
    expect((await c.h.pool.query("SELECT booking_id FROM professional_slots WHERE id = $1", [slotId])).rows[0]).toEqual({ booking_id: null });

    // libertar uma (cancelar) volta a permitir: o limite conta só as ativas
    const first = (await c.h.pool.query<{ id: string }>("SELECT id FROM bookings WHERE member_id = $1 ORDER BY created_at, id LIMIT 1", [pt.m])).rows[0]?.id ?? "";
    expect((await post("cancelar", `${bookingsOf(pt.fam, pt.m)}/${first}/cancel`, pt.u.token)).status).toBe(200);
    expect((await post("11.ª agora cabe", bookingsOf(pt.fam, pt.m), pt.u.token, { offerId: w.video.id, slotId, participantLabel: "Ana" })).status).toBe(201);
  });

  it("10 criações por dia (as canceladas contam): a 11.ª ⇒ 429 RATE_LIMITED com Retry-After de 24 h; passado o dia volta a ser aceite", async () => {
    const w = await world();
    const pt = await patient();
    for (let k = 0; k < 10; k++) {
      const slotId = await c.slot(w.video, rel(3 * HOUR + k * HOUR));
      const created = await post(`criação ${String(k + 1)}`, bookingsOf(pt.fam, pt.m), pt.u.token, { offerId: w.video.id, slotId, participantLabel: "Ana" });
      expect(created.status, `criação ${String(k + 1)}`).toBe(201);
      expect((await post("cancelar", `${bookingsOf(pt.fam, pt.m)}/${bodyOf(created).id as string}/cancel`, pt.u.token)).status).toBe(200);
    }
    const slotId = await c.slot(w.video, rel(20 * HOUR));
    const res = await post("11.ª criação", bookingsOf(pt.fam, pt.m), pt.u.token, { offerId: w.video.id, slotId, participantLabel: LABEL });
    expect(res.status).toBe(429);
    expect(res.headers["content-type"]).toMatch(/application\/problem\+json/);
    expect(bodyOf(res).code).toBe("RATE_LIMITED");
    expect(res.headers["retry-after"]).toBe("86400");
    expect((await c.h.pool.query("SELECT booking_id FROM professional_slots WHERE id = $1", [slotId])).rows[0]).toEqual({ booking_id: null });

    c.h.clock.set(rel(DAY + MIN));
    const later = await c.slot(w.video, rel(3 * HOUR));
    expect((await post("depois de 24 h", bookingsOf(pt.fam, pt.m), pt.u.token, { offerId: w.video.id, slotId: later, participantLabel: "Ana" })).status).toBe(201);
  });

  it("5 comprovativos por marcação (terminais): o 6.º ⇒ 409 LIMIT_EXCEEDED, nada gravado", async () => {
    const w = await world();
    const pt = await patient();
    const b = await seeded(pt, w.video);
    await c.h.pool.query(
      `INSERT INTO payment_proofs (booking_id, storage_key, content_type, size_bytes, scan_status, scanned_at, status, decided_at, decision_reason, disputed_at, dispute_decision, dispute_decided_at)
       SELECT $1, 'consultation-proofs/final/' || gen_random_uuid()::text || '.pdf', 'application/pdf', 100, 'CLEAN', now(), 'REJECTION_UPHELD', now(), 'Motivo da recusa.', now(), 'UPHOLD_REJECTION', now()
       FROM generate_series(1, 5)`,
      [b],
    );
    await c.h.pool.query("UPDATE bookings SET payment_status = 'REJECTED' WHERE id = $1", [b]);
    const res = await upload("6.º comprovativo", `${bookingsOf(pt.fam, pt.m)}/${b}/payment-proofs`, pt.u.token, pdf("sexto"));
    expect(res.status).toBe(409);
    expect(bodyOf(res).code).toBe("LIMIT_EXCEEDED");
    expect(await count("SELECT count(*)::int AS n FROM payment_proofs WHERE booking_id = $1", [b])).toBe(5);
  });

  it("uploads 20 por hora e por utilizador: o 21.º ⇒ 429 RATE_LIMITED com Retry-After; passada a hora volta a chegar à lógica (409 em curso, não 429)", async () => {
    const w = await world();
    const pt = await patient();
    const b = await seeded(pt, w.video);
    const url = `${bookingsOf(pt.fam, pt.m)}/${b}/payment-proofs`;
    const results: request.Response[] = [];
    for (let i = 0; i < 21; i++) results.push(await upload(`upload ${String(i + 1)}`, url, pt.u.token, pdf(`u${String(i)}`)));
    expect(results[0]?.status).toBe(201);
    for (const res of results.slice(1, 20)) expect(res.status).toBe(409);
    expect(results[20]?.status).toBe(429);
    expect(bodyOf(results[20] ?? { body: {} }).code).toBe("RATE_LIMITED");
    expect(results[20]?.headers["retry-after"]).toMatch(RETRY_AFTER);
    expect(Number(results[20]?.headers["retry-after"])).toBeLessThanOrEqual(3600);
    c.h.clock.set(rel(HOUR + MIN));
    expect((await upload("depois de 1 h", url, pt.u.token, pdf("depois"))).status).toBe(409);
  });

  it("avaliações 20 por dia e por utilizador (21 marcações concluídas semeadas): a 21.ª ⇒ 429 com Retry-After; passado o dia é aceite (201)", async () => {
    const w = await world();
    const pt = await patient();
    const ids: string[] = [];
    for (let i = 0; i < 21; i++) ids.push(await completedBooking(pt, w.free));
    for (let i = 0; i < 20; i++) {
      const res = await put(`avaliação ${String(i + 1)}`, `${bookingsOf(pt.fam, pt.m)}/${ids[i] ?? ""}/review`, pt.u.token, { rating: 4 });
      expect(res.status, `avaliação ${String(i + 1)}`).toBe(201);
    }
    const limited = await put("21.ª avaliação", `${bookingsOf(pt.fam, pt.m)}/${ids[20] ?? ""}/review`, pt.u.token, { rating: 4, comment: COMMENT });
    expect(limited.status).toBe(429);
    expect(bodyOf(limited).code).toBe("RATE_LIMITED");
    expect(limited.headers["retry-after"]).toMatch(RETRY_AFTER);
    expect(Number(limited.headers["retry-after"])).toBeLessThanOrEqual(86_400);
    expect(await count("SELECT count(*)::int AS n FROM reviews WHERE booking_id = $1", [ids[20] ?? ""])).toBe(0);
    c.h.clock.set(rel(DAY + MIN));
    expect((await put("depois de 24 h", `${bookingsOf(pt.fam, pt.m)}/${ids[20] ?? ""}/review`, pt.u.token, { rating: 4 })).status).toBe(201);
  });

  it("denúncias de avaliações 10 por dia e por profissional: a 11.ª ⇒ 429 com Retry-After; nada gravado; passado o dia é aceite", async () => {
    const w = await world();
    const pt = await patient();
    const reviews: string[] = [];
    for (let i = 0; i < 11; i++) {
      const b = await completedBooking(pt, w.free);
      expect((await put("avaliar", `${bookingsOf(pt.fam, pt.m)}/${b}/review`, pt.u.token, { rating: 4 })).status).toBe(201);
      reviews.push((await c.h.pool.query<{ id: string }>("SELECT id FROM reviews WHERE booking_id = $1", [b])).rows[0]?.id ?? "");
    }
    for (let i = 0; i < 10; i++) expect((await post(`denúncia ${String(i + 1)}`, `${proBase}/reviews/${reviews[i] ?? ""}/reports`, w.token, { reason: "OTHER" })).status, `denúncia ${String(i + 1)}`).toBe(201);
    const limited = await post("11.ª denúncia", `${proBase}/reviews/${reviews[10] ?? ""}/reports`, w.token, { reason: "OTHER", note: NOTE });
    expect(limited.status).toBe(429);
    expect(bodyOf(limited).code).toBe("RATE_LIMITED");
    expect(limited.headers["retry-after"]).toMatch(RETRY_AFTER);
    expect(await count("SELECT count(*)::int AS n FROM review_reports WHERE review_id = $1", [reviews[10] ?? ""])).toBe(0);
    c.h.clock.set(rel(DAY + MIN));
    expect((await post("depois de 24 h", `${proBase}/reviews/${reviews[10] ?? ""}/reports`, w.token, { reason: "OTHER" })).status).toBe(201);
  });

  describe("downloads e listas: 60 por minuto e por utilizador, 429 RATE_LIMITED com Retry-After de 1 a 60 s (relógio injetável)", () => {
    /** 60 pedidos aceites, o 61.º ⇒ 429; avançar 1 min liberta; outro utilizador não é afetado. */
    async function sixty(label: string, fire: (token: string) => Promise<request.Response>, token: string, other?: () => Promise<request.Response>): Promise<void> {
      for (let i = 0; i < 60; i++) {
        const res = await fire(token);
        if (res.status !== 200) throw new Error(`${label}: pedido ${String(i + 1)} ⇒ ${String(res.status)} ${JSON.stringify(res.body)}`);
      }
      const limited = await fire(token);
      expect(limited.status, `${label} 61.º`).toBe(429);
      expect(limited.headers["content-type"], label).toMatch(/application\/problem\+json/);
      expect(bodyOf(limited).code, label).toBe("RATE_LIMITED");
      expect(limited.headers["retry-after"], label).toMatch(RETRY_AFTER);
      expect(Number(limited.headers["retry-after"]), label).toBeLessThanOrEqual(60);
      if (other !== undefined) expect((await other()).status, `${label}: outro utilizador`).toBe(200);
      c.h.clock.set(rel(MIN + 1000));
      expect((await fire(token)).status, `${label}: depois de 1 min`).toBe(200);
    }

    it("horários livres (listBookableSlots) e avaliações públicas (listProfessionalReviews)", async () => {
      const w = await world();
      const a = await c.user("leitor-a");
      const b = await c.user("leitor-b");
      await sixty("slots", (t) => get("slots", `${API}/marketplace/professionals/${w.pro.professionalId}/slots`, t, { offerId: w.video.id }), a.token, () => get("slots", `${API}/marketplace/professionals/${w.pro.professionalId}/slots`, b.token, { offerId: w.video.id }));
      const reader = await c.user("leitor-c");
      const reader2 = await c.user("leitor-d");
      await sixty("avaliações públicas", (t) => get("avaliações públicas", `${API}/marketplace/professionals/${w.pro.professionalId}/reviews`, t), reader.token, () => get("avaliações públicas", `${API}/marketplace/professionals/${w.pro.professionalId}/reviews`, reader2.token));
    });

    it("lista de comprovativos e download do comprovativo (família), download do profissional e download do admin", async () => {
      const w = await world();
      const pt = await patient();
      const { bookingId, proofId } = await disputedProof(w, pt);
      const base = `${bookingsOf(pt.fam, pt.m)}/${bookingId}/payment-proofs`;
      const stranger = await patient();
      const strangerBooking = await seeded(stranger, w.video);
      await sixty("lista de comprovativos", (t) => get("lista de comprovativos", base, t), pt.u.token, () => get("lista de comprovativos", `${bookingsOf(stranger.fam, stranger.m)}/${strangerBooking}/payment-proofs`, stranger.u.token));
      c.h.clock.set(rel(2 * MIN));
      await sixty("download da família", (t) => download("download da família", `${base}/${proofId}/file`, t), pt.u.token);
      c.h.clock.set(rel(2 * MIN));
      await sixty("download do profissional", (t) => download("download do profissional", `${proBase}/bookings/${bookingId}/payment-proofs/${proofId}/file`, t), w.token);
      c.h.clock.set(rel(2 * MIN));
      await sixty("download do admin", (t) => download("download do admin", `${API}/admin/payment-disputes/${proofId}/file`, t), admin.token);
    });
  });

  it.skip("falha FECHADA se o limitador estiver indisponível — não aplicável: SlidingWindowLimiter é em memória por processo e não tem dependência externa (cabeçalho do ficheiro)", () => undefined);
});

describe("locale e formatos (TC-MKT-110; BR-MKT-02/31/59)", () => {
  const ENGLISH = /\b(not found|forbidden|unauthori[sz]ed|invalid|error|too many|conflict|failed|already|must|required|please|rate limit|denied)\b/i;
  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

  function walk(value: unknown, visit: (key: string, v: unknown) => void): void {
    if (Array.isArray(value)) for (const item of value) walk(item, visit);
    else if (typeof value === "object" && value !== null) {
      for (const [k, v] of Object.entries(value)) {
        visit(k, v);
        walk(v, visit);
      }
    }
  }

  it("provoca os erros de MK3 mais representativos (para a verificação de pt-PT abaixo): 400, 401, 403, 404, 409×6, 422, 423", async () => {
    const w = await world();
    const pt = await patient();
    const other = await patient();
    const fa = await c.user("fa-locale");
    userSecrets.add(fa.email);
    await c.member(pt.fam, { userId: fa.id, role: "FAMILY_ADMIN", name: "Admin Locale" });
    const blocked = await c.member(pt.fam, { dependent: true, blocked: true, guardians: [pt.m], name: "Bloqueado" });
    const slotId = await c.slot(w.video, nextStart());
    const reqBk = await seeded(pt, w.video, "REQUESTED");

    // 400 (parâmetros), 401, 403, 404, 422 com o canário no valor inválido
    expect((await get("cursor inválido", bookingsOf(pt.fam, pt.m), pt.u.token, { cursor: "!!" })).status).toBe(400);
    expect((await get("sem token", `${bookingsOf(pt.fam, pt.m)}/${reqBk}`)).status).toBe(401);
    expect((await get("Family Admin sem relação", `${bookingsOf(pt.fam, pt.m)}/${reqBk}`, fa.token)).status).toBe(403);
    expect((await get("alheia", `${bookingsOf(pt.fam, pt.m)}/${reqBk}`, other.u.token)).status).toBe(404);
    expect((await get("inexistente", `${bookingsOf(pt.fam, pt.m)}/${randomUUID()}`, pt.u.token)).status).toBe(404);
    expect((await post("rótulo longo", bookingsOf(pt.fam, pt.m), pt.u.token, { offerId: w.video.id, slotId, participantLabel: `${LABEL}${"x".repeat(40)}` })).status).toBeGreaterThanOrEqual(400);
    expect((await post("nota longa", `${bookingsOf(pt.fam, pt.m)}/${reqBk}/cancel`, pt.u.token, { note: `${NOTE}${"x".repeat(300)}` })).status).toBeGreaterThanOrEqual(400);
    expect((await post("motivo em falta", `${proBase}/bookings/${reqBk}/reject`, w.token, { reason: "" })).status).toBeGreaterThanOrEqual(400);
    expect((await post("confirmar sem ligação (vídeo)", `${proBase}/bookings/${reqBk}/confirm`, w.token, {})).status).toBe(422);
    // 409: SLOT_UNAVAILABLE, SELF_BOOKING_NOT_ALLOWED, REVIEW_NOT_ALLOWED, INVALID_STATE_TRANSITION, PROFESSIONAL_LOCKED, CONFLICT
    expect((await post("reservar", bookingsOf(other.fam, other.m), other.u.token, { offerId: w.video.id, slotId, participantLabel: LABEL })).status).toBe(201);
    expect(bodyOf(await post("horário ocupado", bookingsOf(pt.fam, pt.m), pt.u.token, { offerId: w.video.id, slotId, participantLabel: LABEL })).code).toBe("SLOT_UNAVAILABLE");
    const own = await c.professional({ email: "dra.locale@exemplo.ao", name: "Dra. Locale" });
    userSecrets.add("dra.locale@exemplo.ao");
    const ownOffer = await c.offer(own, { method: "CHAT", durationMinutes: 20, priceKz: 3000 });
    const self = await c.user("locale-self", { email: "dra.locale@exemplo.ao" });
    const selfFam = await c.family("Locale self");
    const selfMember = await c.member(selfFam, { userId: self.id, role: "FAMILY_ADMIN" });
    expect(bodyOf(await post("automarcação", bookingsOf(selfFam, selfMember), self.token, { offerId: ownOffer.id, slotId: await c.slot(ownOffer, nextStart()), participantLabel: LABEL })).code).toBe("SELF_BOOKING_NOT_ALLOWED");
    expect(bodyOf(await put("avaliar sem concluir", `${bookingsOf(pt.fam, pt.m)}/${reqBk}/review`, pt.u.token, { rating: 5, comment: COMMENT })).code).toBe("REVIEW_NOT_ALLOWED");
    expect(bodyOf(await post("concluir antes da hora", `${proBase}/bookings/${reqBk}/complete`, w.token)).code).toBe("INVALID_STATE_TRANSITION");
    const twice = await seeded(pt, w.video, "REQUESTED");
    expect((await post("cancelar", `${bookingsOf(pt.fam, pt.m)}/${twice}/cancel`, pt.u.token, { note: NOTE })).status).toBe(200);
    expect(bodyOf(await post("cancelar outra vez", `${bookingsOf(pt.fam, pt.m)}/${twice}/cancel`, pt.u.token, { note: NOTE })).code).toBe("INVALID_STATE_TRANSITION");
    const lockBk = await seeded(pt, w.video, "REQUESTED");
    await c.h.pool.query("UPDATE professionals SET validation_status = 'SUSPENDED' WHERE id = $1", [w.pro.professionalId]);
    expect(bodyOf(await post("profissional suspenso", `${proBase}/bookings/${lockBk}/reject`, w.token, { reason: "Sem vaga." })).code).toBe("PROFESSIONAL_LOCKED");
    // 423 (membro bloqueado); os 429 vêm dos testes de limites acima (as amostras acumulam-se)
    expect((await get("membro bloqueado", bookingsOf(pt.fam, blocked), pt.u.token)).status).toBe(423);
  }, 120_000);

  it("TODAS as respostas de erro do ficheiro: problem+json, title/detail/errors[] em pt-PT, sem dados do utilizador (rótulo, nota, comentário, ligação, e-mails, ids) e sem causas inglesas", () => {
    expect(errorSamples.length).toBeGreaterThan(40);
    const statuses = new Set(errorSamples.map((e) => e.res.status));
    for (const status of [400, 401, 403, 404, 409, 422, 423, 429]) expect(statuses.has(status), `sem amostra ${String(status)}`).toBe(true);
    const codes = new Set(errorSamples.map((e) => bodyOf(e.res).code as string));
    for (const code of ["SLOT_UNAVAILABLE", "SELF_BOOKING_NOT_ALLOWED", "REVIEW_NOT_ALLOWED", "LIMIT_EXCEEDED", "RATE_LIMITED", "NOT_FOUND", "FORBIDDEN", "UNAUTHENTICATED", "MEMBER_BLOCKED"]) expect(codes.has(code), `sem amostra ${code}`).toBe(true);

    for (const { label, res } of errorSamples) {
      const body = bodyOf(res);
      expect(res.headers["content-type"], label).toMatch(/application\/problem\+json/);
      const texts: string[] = [String(body.title ?? ""), String(body.detail ?? ""), ...((body.errors as { field?: string; message?: string }[] | undefined) ?? []).map((e) => e.message ?? "")];
      for (const text of texts) {
        expect(text, `${label}: ${text}`).not.toMatch(ENGLISH);
        expect(text, `${label}: ${text}`).not.toMatch(UUID);
        expect(text, `${label}: ${text}`).not.toContain("@");
        for (const secret of userSecrets) expect(text, `${label} contém ${secret}`).not.toContain(secret);
      }
      // o JSON inteiro (menos requestId) também não repete valores do utilizador
      const dump = JSON.stringify({ ...body, requestId: undefined, instance: undefined });
      for (const secret of userSecrets) expect(dump, `${label} contém ${secret}`).not.toContain(secret);
      expect(typeof body.title, label).toBe("string");
      expect(String(body.detail ?? "x").length, label).toBeGreaterThan(0);
    }
    // REVIEW_NOT_ALLOWED e SLOT_UNAVAILABLE: detail genérico (a causa/quem ocupou não se revela)
    for (const { label, res } of errorSamples.filter((e) => bodyOf(e.res).code === "REVIEW_NOT_ALLOWED")) expect(String(bodyOf(res).detail), label).not.toMatch(/pagamento|falta|prazo|dias|estado|conclu/i);
  });

  it("preços: `priceKz` é sempre um inteiro ≥ 0 em Kz e nenhuma resposta tem outro campo de preço/moeda; datas-hora em UTC (Z)", async () => {
    const w = await world();
    const pt = await patient();
    const cheap = await c.offer(w.pro, { method: "PHONE", durationMinutes: 15, priceKz: 1 });
    const dear = await c.offer(w.pro, { method: "IN_PERSON", durationMinutes: 60, priceKz: 100_000_000 });
    for (const offer of [w.video, w.free, cheap, dear]) {
      const slotId = await c.slot(offer, nextStart());
      const res = await post("criar", bookingsOf(pt.fam, pt.m), pt.u.token, { offerId: offer.id, slotId, participantLabel: "Ana" });
      expect(res.status, `${offer.method} ${JSON.stringify(res.body)}`).toBe(201);
      expect(bodyOf(res).priceKz, offer.method).toBe(offer.priceKz);
      expect(Number.isInteger(bodyOf(res).priceKz)).toBe(true);
    }
    const { bookingId } = await disputedProof(w, pt);
    await get("lista da família", bookingsOf(pt.fam, pt.m), pt.u.token);
    await get("detalhe da família", `${bookingsOf(pt.fam, pt.m)}/${bookingId}`, pt.u.token);
    await get("lista do profissional", `${proBase}/bookings`, w.token, { status: "CONFIRMED" });
    await get("detalhe do profissional", `${proBase}/bookings/${bookingId}`, w.token);
    await get("fila de disputas", `${API}/admin/payment-disputes`, admin.token);
    const proofId = (await c.h.pool.query<{ id: string }>("SELECT id FROM payment_proofs WHERE booking_id = $1", [bookingId])).rows[0]?.id ?? "";
    await get("detalhe da disputa", `${API}/admin/payment-disputes/${proofId}`, admin.token);

    let prices = 0;
    const isoDateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
    for (const { label, body } of okSamples) {
      walk(body, (key, v) => {
        if (/price|amount|currency|valor|kwanza/i.test(key)) {
          expect(key, label).toBe("priceKz");
          expect(typeof v, `${label} priceKz`).toBe("number");
          expect(Number.isInteger(v), `${label} priceKz inteiro`).toBe(true);
          expect(v as number, `${label} priceKz`).toBeGreaterThanOrEqual(0);
          prices++;
        }
        if (/(At|Until)$/.test(key) && typeof v === "string") expect(v, `${label} ${key}`).toMatch(isoDateTime);
        if (key === "consultedMonth" || key === "createdOn") expect(v, `${label} ${key}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      });
    }
    expect(prices).toBeGreaterThan(10);
  });

  describe("consultedMonth calculado em Africa/Luanda (UTC+1) na fronteira de mês (BR-MKT-59; entities.md: «primeiro dia do mês da consulta, Luanda»)", () => {
    /** Marcação com a consulta em `startsAt`, concluída logo depois; avalia pela API real e lê o mês em todas as vistas (família, pública, profissional, admin). */
    async function reviewMonth(startsAt: string): Promise<{ family: string; publicView: string; professional: string }> {
      const w = await world();
      const pt = await patient();
      const start = new Date(startsAt);
      c.h.clock.set(new Date(start.getTime() + 20 * MIN));
      const id = await seeded(pt, w.free, "CONFIRMED", start);
      await c.h.pool.query("UPDATE bookings SET status = 'COMPLETED', completed_at = $2, payment_status = 'NOT_REQUIRED' WHERE id = $1", [id, now().toISOString()]);
      const res = await put("avaliar", `${bookingsOf(pt.fam, pt.m)}/${id}/review`, pt.u.token, { rating: 5 });
      expect(res.status, startsAt).toBe(201);
      const reader = await c.user("leitor-mes");
      const pub = await get("avaliações públicas", `${API}/marketplace/professionals/${w.pro.professionalId}/reviews`, reader.token);
      const own = await get("avaliações do profissional", `${proBase}/reviews`, w.token);
      return { family: bodyOf(res).consultedMonth as string, publicView: bodyOf(pub).items[0].consultedMonth as string, professional: bodyOf(own).items[0].consultedMonth as string };
    }

    it.each([
      ["2026-12-31T23:30:00.000Z", "2027-01-01"], // 00:30 de 1 de janeiro em Luanda
      ["2026-12-31T22:59:59.000Z", "2026-12-01"], // 23:59:59 de 31 de dezembro em Luanda
      ["2026-12-31T23:00:00.000Z", "2027-01-01"], // exatamente a meia-noite em Luanda
      ["2026-11-30T23:30:00.000Z", "2026-12-01"],
      ["2026-11-15T12:00:00.000Z", "2026-11-01"],
    ])("consulta a %s (UTC) ⇒ consultedMonth %s em todas as vistas", async (startsAt, expected) => {
      const views = await reviewMonth(startsAt);
      expect(views).toEqual({ family: expected, publicView: expected, professional: expected });
    });

    it("o mês é o da CONSULTA (startsAt), não o da conclusão: consulta a 2026-12-31T22:30Z concluída já em janeiro (Luanda) ⇒ 2026-12-01", async () => {
      const w = await world();
      const pt = await patient();
      const start = new Date("2026-12-31T22:30:00.000Z");
      c.h.clock.set(new Date("2027-01-02T10:00:00.000Z"));
      const id = await seeded(pt, w.free, "CONFIRMED", start);
      await c.h.pool.query("UPDATE bookings SET status = 'COMPLETED', completed_at = $2, payment_status = 'NOT_REQUIRED' WHERE id = $1", [id, now().toISOString()]);
      const res = await put("avaliar", `${bookingsOf(pt.fam, pt.m)}/${id}/review`, pt.u.token, { rating: 5 });
      expect(res.status).toBe(201);
      expect(bodyOf(res).consultedMonth).toBe("2026-12-01");
      expect((await c.h.pool.query<{ m: string }>("SELECT to_char(consulted_month, 'YYYY-MM-DD') AS m FROM reviews WHERE booking_id = $1", [id])).rows[0]?.m).toBe("2026-12-01");
    });
  });
});
