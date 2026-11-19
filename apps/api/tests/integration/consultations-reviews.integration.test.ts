// Corpos JSON de respostas HTTP lidos de forma dinâmica nos testes (`unknown` com casts explícitos).
// Integração (PostgreSQL real, app real com validação de pedidos E respostas) das AVALIAÇÕES VERIFICADAS (UC-MKT-39..43; BR-MKT-59/60/61/62/63):
// criar/editar/ler pela família (elegibilidade, janelas, validação, autorização, concorrência), lista pública (resumo, paginação, filtro,
// privacidade, limite de 60/min), portal do profissional (resposta única, denúncia única, limite diário), fila e decisão do admin (ocultar
// comentário sem apagar a nota, auditoria por abertura). Ranking v2 (cenário 11) omitido: o harness não liga `reviewStats` ao discovery.
// Ficheiros fake em memória; BD real.
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { API, START } from "../support/professionals-harness.js";
import { startConsultationsHarness, type ConsultationsHarness, type OfferFixture, type ProfessionalFixture, type UserFixture } from "../support/consultations-harness.js";

const DAY = 86_400_000;
const HOUR = 3_600_000;
/** Textos canário (BR-MKT-59/63): comentário, resposta e nota da denúncia são texto livre e nunca entram em auditoria. */
const COMMENT_CANARY = "comentario-canario-s10";
const REPLY_CANARY = "resposta-canario-s10";
const NOTE_CANARY = "nota-canario-s10";
/** Rótulo do participante (dado do profissional): nunca sai na fila nem no detalhe do admin. */
const LABEL_CANARY = "rotulo-canario-s10";

let c: ConsultationsHarness;
let admin: UserFixture;
let plain: UserFixture;

const bodyOf = (res: { body: unknown }): Record<string, unknown> => res.body as Record<string, unknown>;
const itemsOf = (res: { body: unknown }): Record<string, unknown>[] => bodyOf(res).items as Record<string, unknown>[];
const idsOf = (items: Record<string, unknown>[]): string[] => items.map((item) => String(item.id));
const authOf = (token?: string): Record<string, string> => (token === undefined ? {} : { Authorization: `Bearer ${token}` });
const reviewOf = (familyId: string, memberId: string, bookingId: string): string => `${API}/families/${familyId}/members/${memberId}/bookings/${bookingId}/review`;
const publicOf = (professionalId: string): string => `${API}/marketplace/professionals/${professionalId}/reviews`;
const portalOf = `${API}/professional-portal/reviews`;
const adminOf = `${API}/admin/review-reports`;

/** Instante `days` dias depois de START. */
const at = (days: number): Date => new Date(START.getTime() + days * DAY);

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await c.h.pool.query<{ n: number }>(sql, params);
  return rows[0]?.n ?? 0;
}

/** Textos canário que apareceram em algum registo de auditoria (deve dar sempre 0). */
const canaryIn = (text: string): Promise<number> => count("SELECT count(*)::int AS n FROM audit_logs a WHERE a::text LIKE '%' || $1 || '%'", [text]);

async function auditCount(action: string, resourceId: string): Promise<number> {
  return count("SELECT count(*)::int AS n FROM audit_logs WHERE action = $1 AND resource_id = $2", [action, resourceId]);
}

interface ReviewDbRow {
  id: string;
  rating: number;
  comment: string | null;
  comment_hidden_at: Date | null;
  reply_text: string | null;
}

async function reviewRowOf(bookingId: string): Promise<ReviewDbRow | undefined> {
  const { rows } = await c.h.pool.query<ReviewDbRow>("SELECT id, rating, comment, comment_hidden_at, reply_text FROM reviews WHERE booking_id = $1", [bookingId]);
  return rows[0];
}

async function reviewIdOf(bookingId: string): Promise<string> {
  return (await reviewRowOf(bookingId))?.id ?? "";
}

/** Início único por marcação (um dia por marcação, horas distintas): nunca há sobreposições. */
let slotSeq = 0;
function nextStart(): Date {
  const i = slotSeq++;
  return new Date(START.getTime() + (1 + i) * DAY + 3 * HOUR);
}

/** Profissional APPROVED com token de vida longa, uma oferta paga (vídeo, 5000 Kz) e uma gratuita (chat, 0 Kz). */
interface World {
  pro: ProfessionalFixture;
  token: string;
  video: OfferFixture;
  free: OfferFixture;
}

async function world(): Promise<World> {
  const pro = await c.professional();
  return {
    pro,
    token: await c.professionalToken(pro.professionalId),
    video: await c.offer(pro, { method: "VIDEO", durationMinutes: 30, priceKz: 5000 }),
    free: await c.offer(pro, { method: "CHAT", durationMinutes: 20, priceKz: 0 }),
  };
}

/** Segunda especialidade do mesmo profissional, com oferta própria (para o filtro `specialtyId`). */
let specSeq = 0;
async function secondSpecialty(w: World): Promise<OfferFixture> {
  const n = ++specSeq;
  const name = `Especialidade S10 extra ${String(n)}`;
  const { rows } = await c.h.pool.query<{ id: string }>("INSERT INTO specialties (name, category, active) VALUES ($1,'HEALTH',true) RETURNING id", [name]);
  const specialtyId = rows[0]?.id ?? "";
  await c.h.pool.query("INSERT INTO professional_specialties (professional_id, specialty_id) VALUES ($1,$2)", [w.pro.professionalId, specialtyId]);
  return c.offer({ ...w.pro, specialtyId, specialtyName: name }, { method: "CHAT", durationMinutes: 20, priceKz: 3000 });
}

/** Membro-sujeito SELF (adulto com conta), numa família própria. */
interface Patient {
  u: UserFixture;
  fam: string;
  m: string;
}

let patientSeq = 0;
async function patient(email?: string): Promise<Patient> {
  const n = ++patientSeq;
  const u = await c.user(`avaliador${String(n)}`, email === undefined ? {} : { email });
  const fam = await c.family(`Família S10 ${String(n)}`);
  const m = await c.member(fam, { userId: u.id, role: "FAMILY_ADMIN", name: `Avaliador ${String(n)}` });
  return { u, fam, m };
}

/** Marcação gerada por SQL (sem Process) no estado pedido; o rótulo do participante é configurável (canário). */
async function booking(pt: Patient, offer: OfferFixture, status: "REQUESTED" | "CONFIRMED" = "CONFIRMED"): Promise<string> {
  const { bookingId } = await c.seedBooking({ familyId: pt.fam, memberId: pt.m, offer, startsAt: nextStart(), status, createdByUserId: pt.u.id });
  return bookingId;
}

type PaymentSeed = "CONFIRMED" | "AWAITING_PROOF" | "NOT_REQUIRED";

/** Marcação concluída em `completedAt` (por omissão, o relógio atual) com o pagamento pedido; oferta gratuita ⇒ `NOT_REQUIRED`. */
async function completed(pt: Patient, offer: OfferFixture, completedAt: Date = c.h.clock.now(), payment?: PaymentSeed): Promise<string> {
  const bookingId = await booking(pt, offer);
  const paymentStatus = payment ?? (offer.priceKz === 0 ? "NOT_REQUIRED" : "CONFIRMED");
  await c.h.pool.query("UPDATE bookings SET status = 'COMPLETED', completed_at = $2, payment_status = $3::booking_payment_status WHERE id = $1", [bookingId, completedAt.toISOString(), paymentStatus]);
  return bookingId;
}

function putReview(pt: Patient, bookingId: string, payload: object, token: string | undefined = pt.u.token) {
  return request(c.h.app).put(reviewOf(pt.fam, pt.m, bookingId)).set(authOf(token)).send(payload);
}

function getReview(pt: Patient, bookingId: string, token: string | undefined = pt.u.token) {
  return request(c.h.app).get(reviewOf(pt.fam, pt.m, bookingId)).set(authOf(token));
}

/** Avaliação criada no instante `when` (o relógio avança para lá); devolve o id da avaliação. */
async function reviewAt(pt: Patient, bookingId: string, when: Date, payload: { rating: number; comment?: string }): Promise<string> {
  c.h.clock.set(when);
  const res = await putReview(pt, bookingId, payload);
  if (res.status !== 201) throw new Error(`avaliação falhou: ${String(res.status)} ${JSON.stringify(res.body)}`);
  return reviewIdOf(bookingId);
}

/** Leitor público com token próprio: o limite de 60/min é por utilizador, por isso cada cenário tem o seu. */
async function reader(): Promise<string> {
  return (await c.user("leitor-s10")).token;
}

function publicReviews(professionalId: string, query: Record<string, string | number> = {}, token: string | undefined) {
  return request(c.h.app).get(publicOf(professionalId)).query(query).set(authOf(token));
}

function portalList(token: string | undefined, query: Record<string, string> = {}) {
  return request(c.h.app).get(portalOf).query(query).set(authOf(token));
}

function postReply(reviewId: string, text: unknown, token: string | undefined) {
  return request(c.h.app).post(`${portalOf}/${reviewId}/reply`).set(authOf(token)).send({ text });
}

function postReport(reviewId: string, payload: object, token: string | undefined) {
  return request(c.h.app).post(`${portalOf}/${reviewId}/reports`).set(authOf(token)).send(payload);
}

/** Denúncia feita no instante `when` (o relógio avança para lá); devolve o id da denúncia. */
async function reportAt(reviewId: string, when: Date, token: string, payload: object = { reason: "OTHER" }): Promise<string> {
  c.h.clock.set(when);
  const res = await postReport(reviewId, payload, token);
  if (res.status !== 201) throw new Error(`denúncia falhou: ${String(res.status)} ${JSON.stringify(res.body)}`);
  return String(bodyOf(res).id);
}

function adminList(query: Record<string, string | number> = {}, token: string | undefined = admin.token) {
  return request(c.h.app).get(adminOf).query(query).set(authOf(token));
}

function adminGetReport(reportId: string, token: string | undefined = admin.token) {
  return request(c.h.app).get(`${adminOf}/${reportId}`).set(authOf(token));
}

function adminDecide(reportId: string, decision: unknown, token: string | undefined = admin.token) {
  return request(c.h.app).post(`${adminOf}/${reportId}/decisions`).set(authOf(token)).send({ decision });
}

/** Percorre a fila inteira (`nextCursor` até ao fim) com o `limit` pedido. */
async function listAllReports(status?: string, limit = 100): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 1000; i++) {
    const query: Record<string, string | number> = { limit, ...(status !== undefined ? { status } : {}), ...(cursor !== undefined ? { cursor } : {}) };
    const res = await adminList(query);
    if (res.status !== 200) throw new Error(`lista falhou: ${String(res.status)} ${JSON.stringify(res.body)}`);
    items.push(...itemsOf(res));
    const next = bodyOf(res).nextCursor;
    if (typeof next !== "string") return items;
    cursor = next;
  }
  throw new Error("paginação sem fim");
}

/** Todas as chaves de um JSON (em profundidade), para varrer ids proibidos. */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((item: unknown) => keysOf(item));
  if (value && typeof value === "object") return Object.entries(value as Record<string, unknown>).flatMap(([key, inner]) => [key, ...keysOf(inner)]);
  return [];
}

beforeAll(async () => {
  c = await startConsultationsHarness();
  admin = await c.admin();
  plain = await c.user("comum-s10");
});

afterAll(async () => {
  await c.stop();
});

beforeEach(() => {
  c.h.clock.set(START);
});

describe("criar e ler a avaliação (UC-MKT-39; BR-MKT-59)", () => {
  it("201 com chaves exatas (sem reply), editableUntil = createdAt + 7 dias, auditoria sem texto; GET devolve a mesma; GET sem avaliação ⇒ 404", async () => {
    const w = await world();
    const pt = await patient();
    const b = await completed(pt, w.video);

    const none = await getReview(pt, b);
    expect(none.status).toBe(404);
    expect(bodyOf(none).code).toBe("NOT_FOUND");

    const res = await putReview(pt, b, { rating: 5, comment: COMMENT_CANARY });
    expect(res.status).toBe(201);
    expect(res.headers["cache-control"]).toBe("no-store");
    const body = bodyOf(res);
    expect(Object.keys(body).sort()).toEqual(["bookingId", "comment", "commentHidden", "consultedMonth", "createdAt", "editableUntil", "rating", "updatedAt"].sort());
    expect(body).toMatchObject({ bookingId: b, rating: 5, comment: COMMENT_CANARY, commentHidden: false });
    expect(String(body.consultedMonth)).toMatch(/^\d{4}-\d{2}-01$/);
    expect(new Date(String(body.editableUntil)).getTime()).toBe(new Date(String(body.createdAt)).getTime() + 7 * DAY);

    const id = await reviewIdOf(b);
    const audit = await c.h.pool.query<{ family_id: string; subject_member_id: string; metadata: unknown }>(
      "SELECT family_id, subject_member_id, metadata FROM audit_logs WHERE action = 'REVIEW_CREATE' AND resource_id = $1",
      [id],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({ family_id: pt.fam, subject_member_id: pt.m });
    expect(audit.rows[0]?.metadata).toEqual({ bookingId: b });
    expect(await canaryIn(COMMENT_CANARY)).toBe(0);

    const got = await getReview(pt, b);
    expect(got.status).toBe(200);
    expect(bodyOf(got)).toEqual(body);
  });
});

describe("editar a avaliação (UC-MKT-39; BR-MKT-59)", () => {
  it("segundo PUT ⇒ 200 e auditoria REVIEW_UPDATE, uma só linha; depois de mais de 7 dias ⇒ 409 REVIEW_NOT_ALLOWED sem alterar", async () => {
    const w = await world();
    const pt = await patient();
    const b = await completed(pt, w.video);
    expect((await putReview(pt, b, { rating: 3 })).status).toBe(201);
    const id = await reviewIdOf(b);

    const edit = await putReview(pt, b, { rating: 2, comment: "Texto editado s10." });
    expect(edit.status).toBe(200);
    expect(bodyOf(edit)).toMatchObject({ rating: 2, comment: "Texto editado s10.", commentHidden: false });
    expect(await auditCount("REVIEW_UPDATE", id)).toBe(1);
    expect(await count("SELECT count(*)::int AS n FROM reviews WHERE booking_id = $1", [b])).toBe(1);

    c.h.clock.set(new Date(START.getTime() + 8 * DAY));
    const late = await putReview(pt, b, { rating: 1 });
    expect(late.status).toBe(409);
    expect(bodyOf(late).code).toBe("REVIEW_NOT_ALLOWED");
    expect((await reviewRowOf(b))?.rating).toBe(2);
    expect(await auditCount("REVIEW_UPDATE", id)).toBe(1);
    expect(await count("SELECT count(*)::int AS n FROM reviews WHERE booking_id = $1", [b])).toBe(1);
  });
});

describe("elegibilidade (BR-MKT-59)", () => {
  it("não elegíveis ⇒ 409 REVIEW_NOT_ALLOWED sem criar: por concluir, NO_SHOW, pagamento por comprovar, concluída há mais de 30 dias", async () => {
    const w = await world();
    const pt = await patient();
    const confirmed = await booking(pt, w.video);
    const noShow = await completed(pt, w.video);
    await c.h.pool.query("UPDATE bookings SET status = 'NO_SHOW', completed_at = NULL WHERE id = $1", [noShow]);
    const awaiting = await completed(pt, w.video, c.h.clock.now(), "AWAITING_PROOF");
    const old = await completed(pt, w.video, new Date(START.getTime() - 31 * DAY));

    for (const b of [confirmed, noShow, awaiting, old]) {
      const res = await putReview(pt, b, { rating: 4 });
      expect(res.status).toBe(409);
      expect(bodyOf(res).code).toBe("REVIEW_NOT_ALLOWED");
      expect(await count("SELECT count(*)::int AS n FROM reviews WHERE booking_id = $1", [b])).toBe(0);
    }
  });

  it("oferta gratuita concluída (NOT_REQUIRED) é elegível ⇒ 201", async () => {
    const w = await world();
    const pt = await patient();
    const b = await completed(pt, w.free);
    const res = await putReview(pt, b, { rating: 5 });
    expect(res.status).toBe(201);
    expect(bodyOf(res).rating).toBe(5);
  });
});

describe("validação do conteúdo (BR-MKT-59)", () => {
  it("nota fora de 1..5, não inteira, texto ou ausente, comentário longo, com < ou com controlo ⇒ 422 VALIDATION_ERROR sem criar", async () => {
    const w = await world();
    const pt = await patient();
    const b = await completed(pt, w.video);
    const invalid: object[] = [
      { rating: 0 },
      { rating: 6 },
      { rating: 3.5 },
      { rating: "4" },
      {},
      { rating: 4, comment: "x".repeat(501) },
      { rating: 4, comment: "Bom <b>" },
      { rating: 4, comment: "Bom\u0007" },
    ];
    for (const payload of invalid) {
      const res = await putReview(pt, b, payload);
      expect(res.status, JSON.stringify(payload)).toBe(422);
      expect(bodyOf(res).code).toBe("VALIDATION_ERROR");
    }
    expect(await count("SELECT count(*)::int AS n FROM reviews WHERE booking_id = $1", [b])).toBe(0);
  });

  it("comentário só com espaços ⇒ 201 e guardado como null", async () => {
    const w = await world();
    const pt = await patient();
    const b = await completed(pt, w.video);
    const res = await putReview(pt, b, { rating: 4, comment: "   " });
    expect(res.status).toBe(201);
    expect(bodyOf(res).comment).toBeNull();
    expect((await reviewRowOf(b))?.comment).toBeNull();
  });
});

describe("autorização da avaliação (BR-MKT-59/62)", () => {
  it("sem token ⇒ 401; membro de outra família ⇒ 404; sem relação (OTHER) ⇒ 403; nada criado", async () => {
    const w = await world();
    const pt = await patient();
    const b = await completed(pt, w.video);

    // Sem token explícito: os helpers têm token por omissão (o de `pt`), por isso o pedido é feito direto.
    expect((await request(c.h.app).put(reviewOf(pt.fam, pt.m, b)).send({ rating: 4 })).status).toBe(401);
    expect((await request(c.h.app).get(reviewOf(pt.fam, pt.m, b))).status).toBe(401);

    const stranger = await patient();
    expect((await putReview(pt, b, { rating: 4 }, stranger.u.token)).status).toBe(404);
    expect((await getReview(pt, b, stranger.u.token)).status).toBe(404);

    const outsider = await c.user("sem-relacao-s10");
    await c.member(pt.fam, { userId: outsider.id, role: "FAMILY_MEMBER", name: "Sem relação S10" });
    expect((await putReview(pt, b, { rating: 4 }, outsider.token)).status).toBe(403);

    expect(await count("SELECT count(*)::int AS n FROM reviews WHERE booking_id = $1", [b])).toBe(0);
  });

  it("o utilizador é o próprio profissional (e-mail normalizado igual) ⇒ 409 SELF_BOOKING_NOT_ALLOWED sem revelar e-mails; nada criado", async () => {
    // O registo guarda o e-mail em minúsculas; a variação (maiúsculas, espaços) fica do lado do utilizador.
    const pro = await c.professional({ email: "ana.revisao@exemplo.ao", name: "Dra. Revisão" });
    const offer = await c.offer(pro, { method: "VIDEO", durationMinutes: 30, priceKz: 5000 });
    const same = await c.user("auto-avaliacao", { email: "  ANA.Revisao@exemplo.ao " });
    const fam = await c.family("Auto-avaliação S10");
    const m = await c.member(fam, { userId: same.id, role: "FAMILY_ADMIN" });
    const pt: Patient = { u: same, fam, m };
    const b = await completed(pt, offer);

    const res = await putReview(pt, b, { rating: 5 });
    expect(res.status).toBe(409);
    expect(bodyOf(res).code).toBe("SELF_BOOKING_NOT_ALLOWED");
    const dump = JSON.stringify(res.body);
    for (const secret of ["Revisao", "revisao", "exemplo", "@"]) expect(dump).not.toContain(secret);
    expect(await count("SELECT count(*)::int AS n FROM reviews WHERE booking_id = $1", [b])).toBe(0);
  });
});

describe("concorrência da avaliação (BR-MKT-59)", () => {
  it("duas avaliações paralelas da mesma marcação ⇒ um 201 e um 200 (a segunda edita); uma linha", async () => {
    const w = await world();
    const pt = await patient();
    const b = await completed(pt, w.video);

    const [first, second] = await Promise.all([putReview(pt, b, { rating: 4, comment: "Primeira tentativa." }), putReview(pt, b, { rating: 5, comment: "Segunda tentativa." })]);
    expect([first.status, second.status].sort((x, y) => x - y)).toEqual([200, 201]);
    expect(await count("SELECT count(*)::int AS n FROM reviews WHERE booking_id = $1", [b])).toBe(1);
  });
});

describe("lista pública (UC-MKT-40; BR-MKT-61/63)", () => {
  it("resumo com 3 avaliações (média com 1 casa), mais recentes primeiro, chaves públicas, sem ids nem rótulo, createdOn é data", async () => {
    const w = await world();
    const pt = await patient();
    const bA = await completed(pt, w.video);
    const bB = await completed(pt, w.video);
    const bC = await completed(pt, w.video);
    await c.h.pool.query("UPDATE bookings SET participant_label = $2 WHERE id = $1", [bC, LABEL_CANARY]);
    const idA = await reviewAt(pt, bA, at(1), { rating: 5, comment: "Primeira consulta." });
    const idB = await reviewAt(pt, bB, at(2), { rating: 4 });
    const idC = await reviewAt(pt, bC, at(3), { rating: 4, comment: "Terceira consulta." });

    const token = await reader();
    const res = await publicReviews(w.pro.professionalId, {}, token);
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const page = bodyOf(res);
    expect(page.summary).toEqual({ count: 3, averageRating: 4.3 });
    const items = itemsOf(res);
    expect(idsOf(items)).toEqual([idC, idB, idA]);
    expect(items[0]).toMatchObject({ rating: 4, comment: "Terceira consulta.", commentHidden: false, method: "VIDEO", createdOn: "2026-11-19", specialty: { id: w.pro.specialtyId, name: w.pro.specialtyName } });
    expect(Object.keys(items[0] ?? {}).sort()).toEqual(["comment", "commentHidden", "consultedMonth", "createdOn", "id", "method", "rating", "specialty"].sort());
    expect(String(items[0]?.consultedMonth)).toMatch(/^\d{4}-\d{2}-01$/);

    const json = JSON.stringify(page);
    for (const key of ["familyId", "memberId", "userId", "bookingId", "participantLabel", "createdAt", "updatedAt", "professionalId"]) expect(keysOf(page)).not.toContain(key);
    for (const id of [pt.fam, pt.m, pt.u.id, bA, bC]) expect(json).not.toContain(id);
    expect(json).not.toContain(LABEL_CANARY);
  });

  it("paginação com limit=1 e nextCursor até ao fim, mesmo resumo em cada página", async () => {
    const w = await world();
    const pt = await patient();
    const idA = await reviewAt(pt, await completed(pt, w.video), at(1), { rating: 5 });
    const idB = await reviewAt(pt, await completed(pt, w.video), at(2), { rating: 4 });
    const idC = await reviewAt(pt, await completed(pt, w.video), at(3), { rating: 4 });
    const token = await reader();

    const p1 = bodyOf(await publicReviews(w.pro.professionalId, { limit: 1 }, token));
    expect(idsOf(p1.items as Record<string, unknown>[])).toEqual([idC]);
    expect(typeof p1.nextCursor).toBe("string");
    const p2 = bodyOf(await publicReviews(w.pro.professionalId, { limit: 1, cursor: String(p1.nextCursor) }, token));
    expect(idsOf(p2.items as Record<string, unknown>[])).toEqual([idB]);
    expect(p2.summary).toEqual({ count: 3, averageRating: 4.3 });
    const p3 = bodyOf(await publicReviews(w.pro.professionalId, { limit: 1, cursor: String(p2.nextCursor) }, token));
    expect(idsOf(p3.items as Record<string, unknown>[])).toEqual([idA]);
    expect(p3.nextCursor).toBeNull();
  });

  it("averageRating nulo com menos de 3 avaliações; filtro specialtyId limita items e resumo", async () => {
    const w = await world();
    const other = await secondSpecialty(w);
    const pt = await patient();
    const idA = await reviewAt(pt, await completed(pt, w.video), at(1), { rating: 5 });
    const idB = await reviewAt(pt, await completed(pt, w.video), at(2), { rating: 3 });
    const idO = await reviewAt(pt, await completed(pt, other), at(3), { rating: 1 });
    const token = await reader();

    const two = bodyOf(await publicReviews(w.pro.professionalId, { specialtyId: w.pro.specialtyId }, token));
    expect(two.summary).toEqual({ count: 2, averageRating: null });
    expect(idsOf(two.items as Record<string, unknown>[])).toEqual([idB, idA]);

    const all = bodyOf(await publicReviews(w.pro.professionalId, {}, token));
    expect(all.summary).toEqual({ count: 3, averageRating: 3 });

    const only = bodyOf(await publicReviews(w.pro.professionalId, { specialtyId: other.specialtyId }, token));
    expect(only.summary).toEqual({ count: 1, averageRating: null });
    expect(idsOf(only.items as Record<string, unknown>[])).toEqual([idO]);
    expect(itemsOf({ body: only })[0]?.specialty).toMatchObject({ id: other.specialtyId });
  });

  it("profissional inexistente, SUSPENDED ou DRAFT ⇒ 404; limit=0 e limit=101 ⇒ 400; sem token ⇒ 401", async () => {
    const w = await world();
    const token = await reader();
    const suspended = await c.professional({ status: "SUSPENDED" });
    const draft = await c.professional({ status: "DRAFT" });
    for (const id of [suspended.professionalId, draft.professionalId, "00000000-0000-4000-8000-000000000000"]) {
      expect((await publicReviews(id, {}, token)).status).toBe(404);
    }
    expect((await publicReviews(w.pro.professionalId, { limit: 0 }, token)).status).toBe(400);
    expect((await publicReviews(w.pro.professionalId, { limit: 101 }, token)).status).toBe(400);
    expect((await publicReviews(w.pro.professionalId, {}, undefined)).status).toBe(401);
  });
});

describe("portal do profissional (UC-MKT-41/42; BR-MKT-59/60)", () => {
  it("lista só as suas avaliações; unanswered=true filtra; item com reported; resposta 201 com reply; 2.ª resposta ⇒ 409; de outro profissional ⇒ 404", async () => {
    const w = await world();
    const other = await world();
    const pt = await patient();
    const ptO = await patient();
    const bA1 = await completed(pt, w.video);
    const bA2 = await completed(pt, w.video);
    const bB = await completed(ptO, other.video);
    const rA1 = await reviewAt(pt, bA1, at(1), { rating: 5, comment: "Primeira consulta." });
    const rA2 = await reviewAt(pt, bA2, at(2), { rating: 4 });
    const rB = await reviewAt(ptO, bB, at(2), { rating: 2 });

    const list = await portalList(w.token);
    expect(list.status).toBe(200);
    expect(list.headers["cache-control"]).toBe("no-store");
    expect(idsOf(itemsOf(list))).toEqual([rA2, rA1]);
    expect(itemsOf(list)[0]).toHaveProperty("reported", false);
    expect(JSON.stringify(list.body)).not.toContain(rB);

    const replyText = `Obrigado pela avaliação. ${REPLY_CANARY}`;
    const replied = await postReply(rA1, `  ${replyText}  `, w.token);
    expect(replied.status).toBe(201);
    expect(bodyOf(replied)).toMatchObject({ id: rA1, rating: 5, reply: { text: replyText } });
    const reply = bodyOf(replied).reply as Record<string, unknown>;
    expect(Object.keys(reply).sort()).toEqual(["repliedAt", "text"]);
    expect(typeof reply.repliedAt).toBe("string");

    const again = await postReply(rA1, "Segunda resposta", w.token);
    expect(again.status).toBe(409);
    expect(bodyOf(again).code).toBe("CONFLICT");

    const family = await getReview(pt, bA1);
    expect(bodyOf(family)).toMatchObject({ reply: { text: replyText } });

    const alien = await postReply(rB, "Resposta alheia", w.token);
    expect(alien.status).toBe(404);
    expect(bodyOf(alien).code).toBe("NOT_FOUND");

    for (const text of ["   ", "x".repeat(501), "Olá <b>"]) {
      expect((await postReply(rA2, text, w.token)).status).toBe(422);
    }
    expect(await auditCount("PROFESSIONAL_REVIEW_REPLY", rA2)).toBe(0);

    expect((await portalList(undefined)).status).toBe(401);
    expect((await portalList(pt.u.token)).status).toBe(401);
    expect((await postReply(rA2, "Resposta", pt.u.token)).status).toBe(401);

    expect(await auditCount("PROFESSIONAL_REVIEW_REPLY", rA1)).toBe(1);
    expect(await canaryIn(REPLY_CANARY)).toBe(0);
  });

  it("unanswered=true devolve só as avaliações sem resposta do profissional (BR-MKT-59)", async () => {
    const w = await world();
    const pt = await patient();
    const rA1 = await reviewAt(pt, await completed(pt, w.video), at(1), { rating: 5 });
    const rA2 = await reviewAt(pt, await completed(pt, w.video), at(2), { rating: 4 });
    expect((await postReply(rA1, "Obrigado.", w.token)).status).toBe(201);

    const unanswered = await portalList(w.token, { unanswered: "true" });
    expect(unanswered.status).toBe(200);
    expect(idsOf(itemsOf(unanswered))).toEqual([rA2]);
  });

  it.each(["SUSPENDED", "NEEDS_INFO"] as const)("profissional %s ⇒ resposta 409 PROFESSIONAL_LOCKED sem gravar", async (status) => {
    const w = await world();
    const pt = await patient();
    const b = await completed(pt, w.video);
    const r = await reviewAt(pt, b, at(1), { rating: 3 });
    await c.h.pool.query("UPDATE professionals SET validation_status = $2::professional_validation_status WHERE id = $1", [w.pro.professionalId, status]);

    const res = await postReply(r, "Resposta", w.token);
    expect(res.status).toBe(409);
    expect(bodyOf(res).code).toBe("PROFESSIONAL_LOCKED");
    expect((await reviewRowOf(b))?.reply_text).toBeNull();
    expect(await auditCount("PROFESSIONAL_REVIEW_REPLY", r)).toBe(0);
  });
});

describe("denúncia de avaliação (UC-MKT-42; BR-MKT-60/63)", () => {
  it("201 {id, reviewId, status OPEN, reason, createdAt}; repetir ⇒ 200 com o mesmo id; motivo ou nota inválidos ⇒ 422; de outro profissional ⇒ 404; auditoria sem a nota; continua pública e marcada", async () => {
    const w = await world();
    const other = await world();
    const pt = await patient();
    const b = await completed(pt, w.video);
    const r = await reviewAt(pt, b, at(1), { rating: 2, comment: "Comentário visível." });

    const res = await postReport(r, { reason: "ABUSE", note: NOTE_CANARY }, w.token);
    expect(res.status).toBe(201);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(Object.keys(bodyOf(res)).sort()).toEqual(["createdAt", "id", "reason", "reviewId", "status"].sort());
    expect(bodyOf(res)).toMatchObject({ reviewId: r, status: "OPEN", reason: "ABUSE" });
    const reportId = String(bodyOf(res).id);

    const again = await postReport(r, { reason: "OTHER" }, w.token);
    expect(again.status).toBe(200);
    expect(bodyOf(again).id).toBe(reportId);
    expect(await count("SELECT count(*)::int AS n FROM review_reports WHERE review_id = $1", [r])).toBe(1);

    expect((await postReport(r, { reason: "INVENTADO" }, w.token)).status).toBe(422);
    expect((await postReport(r, { reason: "OTHER", note: "x".repeat(301) }, w.token)).status).toBe(422);

    const alien = await postReport(r, { reason: "ABUSE" }, other.token);
    expect(alien.status).toBe(404);
    expect(bodyOf(alien).code).toBe("NOT_FOUND");

    const audit = await c.h.pool.query<{ metadata: unknown }>("SELECT metadata FROM audit_logs WHERE action = 'PROFESSIONAL_REVIEW_REPORT_CREATE' AND resource_id = $1", [r]);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.metadata).toEqual({ reason: "ABUSE" });
    expect(await canaryIn(NOTE_CANARY)).toBe(0);

    const pub = bodyOf(await publicReviews(w.pro.professionalId, {}, await reader()));
    expect(itemsOf({ body: pub })).toEqual([expect.objectContaining({ id: r, comment: "Comentário visível.", commentHidden: false })]);

    expect(itemsOf(await portalList(w.token))[0]).toHaveProperty("reported", true);
  });

  it("11.ª denúncia de avaliações diferentes no mesmo dia ⇒ 429 RATE_LIMITED (10 por dia por profissional)", async () => {
    const w = await world();
    const pt = await patient();
    const ids: string[] = [];
    for (let i = 0; i < 11; i++) ids.push(await reviewAt(pt, await completed(pt, w.video), at(1), { rating: 4 }));

    for (let i = 0; i < 10; i++) {
      const res = await postReport(ids[i] ?? "", { reason: "OTHER" }, w.token);
      expect(res.status, `denúncia ${String(i + 1)}`).toBe(201);
    }
    const limited = await postReport(ids[10] ?? "", { reason: "OTHER" }, w.token);
    expect(limited.status).toBe(429);
    expect(bodyOf(limited).code).toBe("RATE_LIMITED");
    expect(await count("SELECT count(*)::int AS n FROM review_reports WHERE review_id = $1", [ids[10] ?? ""])).toBe(0);
  });
});

describe("fila e detalhe do admin (UC-MKT-43; BR-MKT-60/63)", () => {
  it("fila OPEN por omissão, mais antigas primeiro, paginação, chaves exatas sem comentário; não-admin 403; profissional 401; sem token 401; limit inválido 400", async () => {
    const w = await world();
    const pt = await patient();
    const r1 = await reviewAt(pt, await completed(pt, w.video), at(1), { rating: 5, comment: "fila-canario-s10" });
    const r2 = await reviewAt(pt, await completed(pt, w.video), at(1), { rating: 2 });
    // A denúncia de r1 é feita no dia 5 e a de r2 no dia 1: a fila ordena por `createdAt` da denúncia (a mais antiga primeiro), não pela criação da avaliação.
    const rep1 = await reportAt(r1, at(5), w.token, { reason: "ABUSE" });
    const rep2 = await reportAt(r2, at(1), w.token, { reason: "OFF_TOPIC" });

    const res = await adminList();
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const items = itemsOf(res);
    expect(Object.keys(items.find((i) => i.id === rep2) ?? {}).sort()).toEqual(["createdAt", "id", "professional", "rating", "reason", "status"].sort());
    expect(items.find((i) => i.id === rep2)).toMatchObject({ status: "OPEN", reason: "OFF_TOPIC", rating: 2, professional: { id: w.pro.professionalId, displayName: "Dra. Consulta", city: "Luanda" } });
    expect(keysOf(items)).not.toContain("comment");
    expect(JSON.stringify(res.body)).not.toContain("fila-canario-s10");

    const ids = idsOf(await listAllReports(undefined, 1));
    const expected = await c.h.pool.query<{ id: string }>("SELECT id FROM review_reports WHERE status = 'OPEN' ORDER BY created_at ASC, id ASC");
    expect(ids).toEqual(expected.rows.map((row) => row.id));
    expect(ids.indexOf(rep2)).toBeLessThan(ids.indexOf(rep1));

    expect((await adminList({ limit: 1 })).status).toBe(200);
    expect((await adminList({}, plain.token)).status).toBe(403);
    expect((await adminList({}, w.token)).status).toBe(401);
    expect((await request(c.h.app).get(adminOf)).status).toBe(401);
    expect((await adminList({ limit: 0 })).status).toBe(400);
    expect((await adminList({ limit: 101 })).status).toBe(400);
  });

  it("DISMISS ⇒ DECIDED e o comentário continua público; segunda decisão ⇒ 409; decisão inválida ⇒ 422; status=DECIDED lista-a; auditoria com decision", async () => {
    const w = await world();
    const pt = await patient();
    const r = await reviewAt(pt, await completed(pt, w.video), at(1), { rating: 3, comment: "Comentário que continua público." });
    const rep = await reportAt(r, at(2), w.token, { reason: "OFF_TOPIC" });

    const dec = await adminDecide(rep, "DISMISS");
    expect(dec.status).toBe(200);
    expect(bodyOf(dec)).toMatchObject({ id: rep, status: "DECIDED", decision: "DISMISS" });
    expect(typeof bodyOf(dec).decidedAt).toBe("string");

    const again = await adminDecide(rep, "HIDE_COMMENT");
    expect(again.status).toBe(409);
    expect(bodyOf(again).code).toBe("INVALID_STATE_TRANSITION");
    expect((await adminDecide(rep, "APPROVE")).status).toBe(422);

    const decided = await listAllReports("DECIDED");
    expect(decided.every((i) => i.status === "DECIDED")).toBe(true);
    expect(idsOf(decided)).toContain(rep);
    const open = await listAllReports();
    expect(open.every((i) => i.status === "OPEN")).toBe(true);
    expect(idsOf(open)).not.toContain(rep);

    const pub = bodyOf(await publicReviews(w.pro.professionalId, {}, await reader()));
    expect(itemsOf({ body: pub })).toEqual([expect.objectContaining({ id: r, comment: "Comentário que continua público.", commentHidden: false })]);

    expect(await count("SELECT count(*)::int AS n FROM review_reports WHERE id = $1 AND decision = 'DISMISS' AND decided_by = $2", [rep, admin.id])).toBe(1);
    const audit = await c.h.pool.query<{ metadata: unknown }>("SELECT metadata FROM audit_logs WHERE action = 'ADMIN_REVIEW_REPORT_DECIDE' AND resource_id = $1", [rep]);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.metadata).toEqual({ decision: "DISMISS" });
  });

  it("HIDE_COMMENT ⇒ no público e na família commentHidden=true com comment null; admin vê o original; o resumo continua a contar a nota", async () => {
    const w = await world();
    const pt = await patient();
    const b1 = await completed(pt, w.video);
    const b2 = await completed(pt, w.video);
    const b3 = await completed(pt, w.video);
    const r1 = await reviewAt(pt, b1, at(1), { rating: 5, comment: COMMENT_CANARY });
    await reviewAt(pt, b2, at(2), { rating: 4 });
    await reviewAt(pt, b3, at(3), { rating: 4 });
    const rep1 = await reportAt(r1, at(4), w.token, { reason: "ABUSE" });

    const dec = await adminDecide(rep1, "HIDE_COMMENT");
    expect(dec.status).toBe(200);
    expect(bodyOf(dec)).toMatchObject({ status: "DECIDED", decision: "HIDE_COMMENT" });

    const pub = bodyOf(await publicReviews(w.pro.professionalId, {}, await reader()));
    expect(pub.summary).toEqual({ count: 3, averageRating: 4.3 });
    expect(itemsOf({ body: pub }).find((i) => i.id === r1)).toMatchObject({ rating: 5, commentHidden: true, comment: null });
    expect(JSON.stringify(pub)).not.toContain(COMMENT_CANARY);

    const family = await getReview(pt, b1);
    expect(bodyOf(family)).toMatchObject({ rating: 5, commentHidden: true, comment: null });
    expect(JSON.stringify(family.body)).not.toContain(COMMENT_CANARY);

    const detail = await adminGetReport(rep1);
    expect(bodyOf(detail).review).toMatchObject({ rating: 5, comment: COMMENT_CANARY, commentHidden: true });

    const row = await reviewRowOf(b1);
    expect(row?.comment).toBe(COMMENT_CANARY);
    expect(row?.comment_hidden_at).not.toBeNull();
  });

  it("detalhe 200 com comentário original, auditado por abertura, sem família/membro/marcação/rótulo; não-admin 403; profissional 401; inexistente 404", async () => {
    const w = await world();
    const pt = await patient();
    const b = await completed(pt, w.video);
    await c.h.pool.query("UPDATE bookings SET participant_label = $2 WHERE id = $1", [b, LABEL_CANARY]);
    const r = await reviewAt(pt, b, at(1), { rating: 3, comment: COMMENT_CANARY });
    const rep = await reportAt(r, at(2), w.token, { reason: "PERSONAL_DATA", note: NOTE_CANARY });

    const res = await adminGetReport(rep);
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const body = bodyOf(res);
    expect(Object.keys(body).sort()).toEqual(["createdAt", "decidedAt", "decision", "id", "note", "professional", "reason", "review", "status"].sort());
    expect(body).toMatchObject({
      id: rep,
      status: "OPEN",
      reason: "PERSONAL_DATA",
      note: NOTE_CANARY,
      professional: { id: w.pro.professionalId, displayName: "Dra. Consulta", city: "Luanda" },
      review: { rating: 3, comment: COMMENT_CANARY, commentHidden: false, specialtyName: w.pro.specialtyName, method: "VIDEO" },
    });
    expect(Object.keys(body.review as Record<string, unknown>).sort()).toEqual(["comment", "commentHidden", "consultedMonth", "method", "rating", "specialtyName"].sort());

    const json = JSON.stringify(body);
    for (const id of [pt.fam, pt.m, pt.u.id, b]) expect(json).not.toContain(id);
    expect(json).not.toContain(LABEL_CANARY);
    for (const key of ["familyId", "memberId", "userId", "bookingId", "participantLabel", "createdByUserId"]) expect(keysOf(body)).not.toContain(key);

    expect(await auditCount("ADMIN_REVIEW_REPORT_VIEW", rep)).toBe(1);
    expect((await adminGetReport(rep)).status).toBe(200);
    expect(await auditCount("ADMIN_REVIEW_REPORT_VIEW", rep)).toBe(2);
    expect(await canaryIn(COMMENT_CANARY)).toBe(0);
    expect(await canaryIn(NOTE_CANARY)).toBe(0);
    expect(await canaryIn(LABEL_CANARY)).toBe(0);

    expect((await adminGetReport(rep, plain.token)).status).toBe(403);
    expect((await adminGetReport(rep, w.token)).status).toBe(401);
    expect((await adminGetReport("00000000-0000-4000-8000-000000000000")).status).toBe(404);
  });

  it("duas decisões concorrentes ⇒ um 200 e um 409 INVALID_STATE_TRANSITION; estado final coerente; uma auditoria", async () => {
    const w = await world();
    const pt = await patient();
    const b = await completed(pt, w.video);
    const r = await reviewAt(pt, b, at(1), { rating: 4, comment: "Concorrência." });
    const rep = await reportAt(r, at(2), w.token);

    const [first, second] = await Promise.all([adminDecide(rep, "DISMISS"), adminDecide(rep, "HIDE_COMMENT")]);
    expect([first.status, second.status].sort((x, y) => x - y)).toEqual([200, 409]);
    const loser = first.status === 409 ? first : second;
    expect(bodyOf(loser).code).toBe("INVALID_STATE_TRANSITION");

    const winner = first.status === 200 ? "DISMISS" : "HIDE_COMMENT";
    expect(await count("SELECT count(*)::int AS n FROM review_reports WHERE id = $1 AND status = 'DECIDED' AND decision = $2", [rep, winner])).toBe(1);
    expect(Boolean((await reviewRowOf(b))?.comment_hidden_at)).toBe(winner === "HIDE_COMMENT");
    expect(await auditCount("ADMIN_REVIEW_REPORT_DECIDE", rep)).toBe(1);
  });
});

describe("ranking v2 com avaliações verificadas (BR-MKT-61)", () => {
  it("3 avaliações ⇒ RATED com reviewSummary; sem avaliações ⇒ NEW", async () => {
    const rated = await world();
    const plainPro = await world();
    // O segundo profissional passa a oferecer a especialidade do primeiro (mesma coorte).
    await c.h.pool.query("INSERT INTO professional_specialties (professional_id, specialty_id) VALUES ($1,$2)", [plainPro.pro.professionalId, rated.video.specialtyId]);
    await c.offer({ ...plainPro.pro, specialtyId: rated.video.specialtyId, specialtyName: rated.pro.specialtyName }, { method: "CHAT", durationMinutes: 20, priceKz: 3000 });
    for (let i = 0; i < 3; i++) {
      const pt = await patient();
      await reviewAt(pt, await completed(pt, rated.video), at(1), { rating: 5 });
    }
    const token = await reader();
    const res = await request(c.h.app).get(`${API}/marketplace/professionals?specialtyId=${rated.video.specialtyId}`).set(authOf(token));
    expect(res.status).toBe(200);
    const items = itemsOf(res);
    const find = (id: string): Record<string, unknown> | undefined => items.find((item) => item.id === id);
    const first = find(rated.pro.professionalId);
    const second = find(plainPro.pro.professionalId);
    expect(first?.reviewSummary).toEqual({ count: 3, averageRating: 5 });
    expect((first?.ranking as Record<string, unknown> | null)?.version).toBe("v2");
    expect((first?.ranking as Record<string, unknown> | null)?.label).toBe("RATED");
    expect((second?.ranking as Record<string, unknown> | null)?.label).toBe("NEW");
  });
});

describe("limite de leitura pública (último: avança o relógio para esvaziar a janela)", () => {
  it("61.º pedido público em 1 minuto ⇒ 429 RATE_LIMITED", async () => {
    const w = await world();
    c.h.clock.set(new Date(START.getTime() + HOUR));
    const token = await reader();

    for (let i = 0; i < 60; i++) {
      const res = await publicReviews(w.pro.professionalId, {}, token);
      if (res.status !== 200) throw new Error(`pedido ${String(i + 1)} falhou: ${String(res.status)}`);
    }
    const limited = await publicReviews(w.pro.professionalId, {}, token);
    expect(limited.status).toBe(429);
    expect(bodyOf(limited).code).toBe("RATE_LIMITED");
  });
});
