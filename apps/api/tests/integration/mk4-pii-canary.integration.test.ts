/* eslint-disable @typescript-eslint/no-explicit-any -- corpos JSON de respostas HTTP lidos de forma dinâmica nos testes */
// Canário de PII e chaves proibidas de MK4 (S10; TC-MKT-139; TC-AZ-MKT-30; BR-MKT-75, 78, 81; privacy.md). Um fluxo completo (com a flag da receita
// ligada) com valores ÚNICOS: o conteúdo partilhado (alergias, condições, medicamentos), o `participantLabel`, as categorias lidas e o texto da receita
// (nomes, dosagens, observações), mais o nome do membro, o nome da família, o e-mail e a data de nascimento do titular. Nunca podem sair em logs
// técnicos, corpos de erro 4xx, `audit_logs` (todas as colunas, `metadata` incluída), alertas, avisos, e-mails nem *query string*. As respostas legítimas
// podem trazer cada valor ao seu destinatário (o profissional vê o conteúdo partilhado e a sua receita; a família vê a receita).
// TC-AZ-MKT-30: nenhuma resposta ao profissional tem as CHAVES proibidas (varrimento recursivo) nem os VALORES de identificação do membro.
// Os logs capturam-se com `logStream` do harness (logger `debug` real). A app não tem *log* de acesso (só `unhandled_error` em 5xx).
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SHARE_NOTICE_SUBJECT, SHARE_NOTICE_TEXT } from "../../src/modules/record-sharing/infrastructure/mailer-smtp.js";
import { API, nextIp, PROFESSIONAL_API, START } from "../support/professionals-harness.js";
import { startConsultationsHarness, type ConsultationsHarness, type OfferFixture, type UserFixture } from "../support/consultations-harness.js";

type Res = request.Response;

const HOUR = 3_600_000;
const DAY = 86_400_000;

const LABEL = "rotulo-canario-mk4";
const MEMBER_NAME = "Membro Secreto Canario MK4";
const FAMILY_NAME = "Familia Canario MK4";
const USER_NAME = "titular-canario-mk4";
const BIRTH = "1985-01-01";
const QUERY = "query-canario-mk4";
const RX_NAME = "rx-nome-canario-mk4";
const RX_DOSE = "rx-dose-canario-mk4";
const RX_NOTE = "rx-nota-canario-mk4";
const BAD_RX_NAME = "rx-invalido-canario-mk4";
/** Conteúdo partilhado: valores do leitor fixo do harness (alergia, condição, medicamento e dosagem). */
const CONTENT = ["Penicilina", "Asma", "Paracetamol", "500 mg"];
const CATEGORIES = ["ALLERGIES", "CONDITIONS", "MEDICATION", "APPOINTMENTS", "EXAMS"];
const MK4_ACTIONS = ["RECORD_SHARE_CREATE", "RECORD_SHARE_REVOKE", "PROFESSIONAL_SHARE_OPEN", "PRESCRIPTION_ISSUED_BY_PROFESSIONAL"];

interface Canary {
  label: string;
  value: string;
}
const canary = (label: string, value: string): Canary => ({ label, value });
const IDENTITY: Canary[] = [canary("participantLabel", LABEL), canary("nome do membro", MEMBER_NAME), canary("nome da família", FAMILY_NAME), canary("e-mail do titular", USER_NAME), canary("data de nascimento", BIRTH)];
const SHARED: Canary[] = CONTENT.map((v) => canary(`conteúdo partilhado (${v})`, v));
const RX: Canary[] = [canary("nome do medicamento", RX_NAME), canary("dosagem", RX_DOSE), canary("observações", RX_NOTE), canary("medicamento inválido", BAD_RX_NAME)];
const CATS: Canary[] = CATEGORIES.map((v) => canary(`categoria lida (${v})`, v));
const QRY = canary("query string", QUERY);
/** Tudo o que nunca pode sair em logs, erros, alertas, avisos e e-mails. */
const EVERYWHERE: Canary[] = [...IDENTITY, ...SHARED, ...RX, ...CATS, QRY];

const leaks = (source: string, text: string, canaries: Canary[]): string[] => canaries.filter((x) => text.includes(x.value)).map((x) => `${source}: ${x.label}`);

/** Chaves (recursivamente, em objetos e arrays) de um corpo de resposta. */
function keysOf(v: unknown): string[] {
  if (Array.isArray(v)) return v.flatMap(keysOf);
  if (v !== null && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => [k, ...keysOf(x)]);
  return [];
}

const authOf = (token?: string): Record<string, string> => (token === undefined ? {} : { Authorization: `Bearer ${token}` });
const bodyOf = (res: Res): Record<string, any> => res.body as Record<string, any>;
const sharesOf = (fam: string, m: string): string => `${API}/families/${fam}/members/${m}/record-shares`;
const proShares = `${API}/professional-portal/shares`;
const proBooking = (id: string): string => `${API}/professional-portal/bookings/${id}`;
const at = (ms: number): Date => new Date(START.getTime() + ms);
const medication = (name: string, extra: Record<string, unknown> = {}) => ({ name, dosage: RX_DOSE, scheduleType: "FIXED_TIMES", times: ["08:00"], startAt: at(DAY).toISOString(), endAt: at(8 * DAY).toISOString(), continuous: false, notes: RX_NOTE, ...extra });

let c: ConsultationsHarness;
const LOGS: string[] = [];
/** Corpo (JSON) de TODAS as respostas 4xx/5xx do fluxo. */
const ERROR_BODIES: string[] = [];
/** Corpos de TODAS as respostas ao profissional (sucesso e erro) e à família sobre partilhas (sem a receita, que é do dono). */
const PRO_BODIES: unknown[] = [];
const FAMILY_SHARE_BODIES: string[] = [];
const ids = { pro: "", u: "", fam: "", m: "", bk: "", done: "", share: "", once: "", gone: "" };

async function call(req: PromiseLike<Res>, kind: "pro" | "family" | "other" = "other"): Promise<Res> {
  const res = await req;
  if (res.status >= 400) ERROR_BODIES.push(JSON.stringify(res.body));
  if (kind === "pro") PRO_BODIES.push(res.body);
  if (kind === "family") FAMILY_SHARE_BODIES.push(JSON.stringify(res.body));
  return res;
}
async function ok(req: PromiseLike<Res>, status: number, kind: "pro" | "family" | "other" = "other"): Promise<Res> {
  const res = await call(req, kind);
  if (res.status !== status) throw new Error(`esperado ${String(status)}, recebido ${String(res.status)}: ${JSON.stringify(res.body)}`);
  return res;
}

let u: UserFixture;
let offerFx: OfferFixture;
let extraSeq = 0;
let proToken = "";
const fam = (): string => ids.fam;
const mem = (): string => ids.m;

describe("TC-MKT-139 / TC-AZ-MKT-30: canário de PII e chaves proibidas de MK4", () => {
  beforeAll(async () => {
    c = await startConsultationsHarness({ logStream: LOGS, digitalPrescription: true });
  }, 300_000);

  afterAll(async () => {
    await c.stop();
  });

  it("fluxo completo: opções, criar (repetível e visualização única), listar, abrir, vistas, revogar, receita; respostas legítimas levam os valores ao dono", async () => {
    c.h.clock.set(START);
    const pro = await c.professional({ name: "Dra. Canario MK4" });
    proToken = await c.professionalToken(pro.professionalId);
    ids.pro = pro.professionalId;
    const offer = await c.offer(pro, { method: "VIDEO", durationMinutes: 30, priceKz: 0 });
    offerFx = offer;
    u = await c.user(USER_NAME, { birth: BIRTH });
    ids.u = u.id;
    ids.fam = await c.family(FAMILY_NAME);
    ids.m = await c.member(fam(), { userId: u.id, role: "FAMILY_ADMIN", name: MEMBER_NAME });
    const seed = async (hours: number) => (await c.seedBooking({ familyId: fam(), memberId: mem(), offer, startsAt: at(hours * HOUR), status: "CONFIRMED", createdByUserId: u.id, label: LABEL })).bookingId;
    ids.bk = await seed(5);
    ids.done = await seed(8);
    await c.h.pool.query("UPDATE bookings SET status = 'COMPLETED', completed_at = $2 WHERE id = $1", [ids.done, at(-HOUR)]);

    // Família: opções, criar duas partilhas (todas as categorias), listar, detalhe.
    const options = await ok(request(c.h.app).get(`${sharesOf(fam(), mem())}/options`).query({ bookingId: ids.bk }).set(authOf(u.token)), 200, "family");
    expect(JSON.stringify(options.body)).toContain(CATEGORIES[0]); // as opções são da família: a lista de categorias possíveis é legítima
    const created = await ok(request(c.h.app).post(sharesOf(fam(), mem())).set(authOf(u.token)).send({ bookingId: ids.bk, categories: CATEGORIES, validity: "D7" }), 201, "family");
    ids.share = bodyOf(created).id as string;
    ids.once = bodyOf(await ok(request(c.h.app).post(sharesOf(fam(), mem())).set(authOf(u.token)).send({ bookingId: ids.bk, categories: ["ALLERGIES", "MEDICATION"], validity: "H24", viewOnce: true }), 201, "family")).id as string;
    ids.gone = bodyOf(await ok(request(c.h.app).post(sharesOf(fam(), mem())).set(authOf(u.token)).send({ bookingId: ids.bk, categories: ["CONDITIONS"], validity: "H24" }), 201, "family")).id as string;
    await ok(request(c.h.app).get(sharesOf(fam(), mem())).set(authOf(u.token)), 200, "family");
    await ok(request(c.h.app).get(`${sharesOf(fam(), mem())}/${ids.share}`).set(authOf(u.token)), 200, "family");

    // Aviso genérico ao profissional (texto fixo) por cada partilha.
    c.shareMails.length = 0;
    expect(c.shareNoticeCalls.length).toBeGreaterThanOrEqual(3);
    for (const call of c.shareNoticeCalls) expect(await c.shareMaintenance.notifyNewShare(call)).toBe("SENT");

    // Profissional: lista, detalhe (o `participantLabel` é seu), abrir (conteúdo seu), de novo, visualização única.
    const list = await ok(request(c.h.app).get(proShares).set(authOf(proToken)), 200, "pro");
    expect(JSON.stringify(list.body)).toContain(LABEL);
    await ok(request(c.h.app).get(`${proShares}/${ids.share}`).set(authOf(proToken)), 200, "pro");
    const open = await ok(request(c.h.app).post(`${proShares}/${ids.share}/open`).set(authOf(proToken)), 200, "pro");
    for (const v of SHARED) expect(JSON.stringify(open.body), v.label).toContain(v.value); // o dono do conteúdo partilhado vê-o
    expect(bodyOf(open).participantLabel).toBe(LABEL);
    await ok(request(c.h.app).post(`${proShares}/${ids.share}/open`).set(authOf(proToken)), 200, "pro");
    await ok(request(c.h.app).post(`${proShares}/${ids.once}/open`).set(authOf(proToken)), 200, "pro");
    await call(request(c.h.app).post(`${proShares}/${ids.once}/open`).set(authOf(proToken)), "pro"); // 403 SHARE_ALREADY_VIEWED

    // Família: quem viu o quê e quando; revogar; abrir a revogada (403).
    await ok(request(c.h.app).get(`${sharesOf(fam(), mem())}/${ids.share}/views`).set(authOf(u.token)), 200, "family");
    await ok(request(c.h.app).post(`${sharesOf(fam(), mem())}/${ids.gone}/revoke`).set(authOf(u.token)), 200, "family");
    expect((await call(request(c.h.app).post(`${proShares}/${ids.gone}/open`).set(authOf(proToken)), "pro")).status).toBe(403);
    expect((await call(request(c.h.app).post(`${sharesOf(fam(), mem())}/${ids.gone}/revoke`).set(authOf(u.token)), "family")).status).toBe(409);

    // Receita (flag ligada): o profissional escreve e lê; a família vê a receita e o plano (legítimo: são dela).
    const issued = await ok(request(c.h.app).post(`${proBooking(ids.done)}/prescriptions`).set(authOf(proToken)).send({ notes: RX_NOTE, medications: [medication(RX_NAME)] }), 201, "pro");
    expect(JSON.stringify(issued.body)).toContain(RX_NAME);
    await ok(request(c.h.app).get(`${proBooking(ids.done)}/prescription`).set(authOf(proToken)), 200, "pro");
    const prescriptions = await ok(request(c.h.app).get(`${API}/families/${fam()}/members/${mem()}/prescriptions`).set(authOf(u.token)), 200);
    expect(JSON.stringify(prescriptions.body)).toContain(RX_NAME);
    await ok(request(c.h.app).get(proBooking(ids.done)).set(authOf(proToken)), 200, "pro");
  }, 180_000);

  it("pedidos inválidos com canários (400/403/404/409/422): os corpos de erro não ecoam o texto recebido; a query string não é registada", async () => {
    // Família: categoria, prazo, marcação e campo desconhecido com canário; cursor e estado inválidos.
    const create = (payload: object) => request(c.h.app).post(sharesOf(fam(), mem())).set(authOf(u.token)).send(payload);
    for (const payload of [
      { bookingId: ids.bk, categories: [QUERY], validity: "D7" },
      { bookingId: ids.bk, categories: [], validity: "D7" },
      { bookingId: ids.bk, categories: CATEGORIES, validity: QUERY },
      { bookingId: QUERY, categories: CATEGORIES, validity: "D7" },
      { bookingId: ids.bk, categories: CATEGORIES, validity: "D7", campoExtra: LABEL },
      { bookingId: ids.bk, categories: CATEGORIES, validity: "D7", participantLabel: LABEL },
      { bookingId: randomUUID(), categories: CATEGORIES, validity: "D7" },
    ]) {
      const res = await call(create(payload));
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    }
    // Profissional: receita com canários inválida (nome em branco, horários vazios), duplicada, com campo extra, marcação alheia; abertura inexistente.
    const issue = (id: string, payload: object) => request(c.h.app).post(`${proBooking(id)}/prescriptions`).set(authOf(proToken)).send(payload);
    for (const payload of [
      { notes: RX_NOTE, medications: [medication(" ", { dosage: RX_DOSE })] },
      { notes: RX_NOTE, medications: [medication(BAD_RX_NAME, { times: [] })] },
      { notes: RX_NOTE, medications: [medication(BAD_RX_NAME)], campoExtra: RX_NAME },
      { notes: RX_NOTE.repeat(60), medications: [medication(BAD_RX_NAME)] },
    ]) {
      const fresh = await c.seedBooking({ familyId: fam(), memberId: mem(), offer: offerFx, startsAt: at((20 + extraSeq++) * HOUR), status: "CONFIRMED", createdByUserId: u.id, label: LABEL });
      await c.h.pool.query("UPDATE bookings SET status = 'COMPLETED', completed_at = $2 WHERE id = $1", [fresh.bookingId, at(-HOUR)]);
      const res = await call(issue(fresh.bookingId, payload), "pro");
      expect(res.status, JSON.stringify(res.body)).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    }
    expect((await call(issue(ids.done, { notes: RX_NOTE, medications: [medication(RX_NAME)] }), "pro")).status).toBe(409);
    expect((await call(issue(randomUUID(), { notes: RX_NOTE, medications: [medication(RX_NAME)] }), "pro")).status).toBe(404);
    expect((await call(request(c.h.app).post(`${proShares}/${randomUUID()}/open`).set(authOf(proToken)), "pro")).status).toBe(404);
    expect((await call(request(c.h.app).get(`${proBooking(randomUUID())}/prescription`).set(authOf(proToken)), "pro")).status).toBe(404);

    // Query string com canário em rotas de MK4 de todos os atores: parâmetro desconhecido e cursor/estado/marcação inválidos ⇒ 4xx sem eco nem registo.
    const routes: [string, string][] = [
      [sharesOf(fam(), mem()), u.token],
      [`${sharesOf(fam(), mem())}/options`, u.token],
      [`${sharesOf(fam(), mem())}/${ids.share}`, u.token],
      [`${sharesOf(fam(), mem())}/${ids.share}/views`, u.token],
      [proShares, proToken],
      [`${proShares}/${ids.share}`, proToken],
      [`${proBooking(ids.done)}/prescription`, proToken],
    ];
    for (const [url, token] of routes) {
      for (const q of [`x=${QUERY}`, `cursor=${QUERY}`, `status=${QUERY}`, `bookingId=${QUERY}`, `limit=${QUERY}`]) {
        const res = await call(request(c.h.app).get(`${url}?${q}`).set(authOf(token)), token === proToken ? "pro" : "family");
        expect([400, 404, 422], `${url}?${q} ⇒ ${String(res.status)}`).toContain(res.status);
      }
    }
    // POST com query string (abrir e revogar) e sem corpo.
    expect((await call(request(c.h.app).post(`${proShares}/${ids.share}/open?x=${QUERY}`).set(authOf(proToken)), "pro")).status).toBeGreaterThanOrEqual(400);
    expect((await call(request(c.h.app).post(`${sharesOf(fam(), mem())}/${ids.share}/revoke?x=${QUERY}`).set(authOf(u.token)), "family")).status).toBeGreaterThanOrEqual(400);
    expect(ERROR_BODIES.length).toBeGreaterThan(30);
  }, 120_000);

  it("recurso alheio e papéis sem relação: 401/403/404 sem eco de ids nem de texto livre", async () => {
    const other = await c.user("sem-relacao-mk4");
    await c.member(fam(), { userId: other.id, role: "FAMILY_MEMBER", name: "Sem relação" });
    const stranger = await c.user("estranho-mk4");
    const strangerFam = await c.family("Outra");
    await c.member(strangerFam, { userId: stranger.id, role: "FAMILY_ADMIN", name: "Estranho" });
    const otherPro = await c.professional({ name: "Dr. Outro" });
    const otherToken = await c.professionalToken(otherPro.professionalId);
    const fetches: Res[] = [];
    for (const [method, url, payload] of [
      ["get", `${sharesOf(fam(), mem())}/${ids.share}`],
      ["get", `${sharesOf(fam(), mem())}/${ids.share}/views`],
      ["post", `${sharesOf(fam(), mem())}/${ids.share}/revoke`, {}],
      ["post", sharesOf(fam(), mem()), { bookingId: ids.bk, categories: CATEGORIES, validity: "D7" }],
    ] as [string, string, object?][]) {
      for (const token of [other.token, stranger.token, otherToken, undefined]) {
        const req = method === "get" ? request(c.h.app).get(url) : request(c.h.app).post(url).send(payload ?? {});
        fetches.push(await call(req.set(authOf(token))));
      }
    }
    for (const [method, url, payload] of [
      ["post", `${proShares}/${ids.share}/open`],
      ["get", `${proShares}/${ids.share}`],
      ["post", `${proBooking(ids.done)}/prescriptions`, { medications: [medication(RX_NAME)] }],
      ["get", `${proBooking(ids.done)}/prescription`],
    ] as [string, string, object?][]) {
      for (const token of [otherToken, u.token, stranger.token, undefined]) {
        const req = method === "get" ? request(c.h.app).get(url) : request(c.h.app).post(url).send(payload ?? {});
        fetches.push(await call(req.set(authOf(token)), token === otherToken ? "pro" : "other"));
      }
    }
    expect(new Set(fetches.map((r) => r.status))).toEqual(new Set([401, 403, 404]));
    for (const res of fetches) {
      const text = JSON.stringify(res.body);
      for (const id of [ids.fam, ids.m, ids.bk, ids.done, ids.share, ids.once, ids.u, ids.pro]) expect(text).not.toContain(id);
      expect(leaks("corpo 401/403/404", text, EVERYWHERE)).toEqual([]);
    }
  }, 120_000);

  it("a captura de logs não está vazia: falha real do SMTP de MK1 aparece (prova de que um canário seria visto)", async () => {
    const falha = vi.spyOn(c.h.mailer, "send").mockRejectedValueOnce(new Error("smtp indisponivel"));
    await request(c.h.app).post(`${PROFESSIONAL_API}/auth/register`).set({ "X-Forwarded-For": nextIp() }).send({ email: "falha-smtp-mk4@exemplo.ao", password: "uma-palavra-passe-forte-123", termsVersion: "1.0" }).expect(202);
    expect(falha).toHaveBeenCalledTimes(1);
    falha.mockRestore();
    expect(LOGS.some((line) => line.includes('"professional_mailer_send_failed"'))).toBe(true);
  });

  it("(1) nenhum canário em logs técnicos (conteúdo, rótulo, categorias, receita, identificação, query string); sem log de corpo", () => {
    expect(LOGS.length).toBeGreaterThan(0);
    expect(leaks("logs técnicos", LOGS.join("\n"), EVERYWHERE)).toEqual([]);
    // Nenhuma linha de log menciona as rotas de MK4 com corpo: só `unhandled_error` (5xx) existiria, e não há 5xx.
    expect(LOGS.filter((l) => /"statusCode":5\d\d|unhandled_error/.test(l))).toEqual([]);
    expect(LOGS.filter((l) => /record-shares|professional-portal\/shares|\/prescription/.test(l))).toEqual([]);
  });

  it("(2) nenhum canário em corpos de erro 4xx (e há erros suficientes para o teste valer; nenhum 5xx)", () => {
    expect(ERROR_BODIES.length).toBeGreaterThan(60);
    for (const body of ERROR_BODIES) expect(leaks("corpo de erro", body, EVERYWHERE), body).toEqual([]);
    expect(ERROR_BODIES.some((b) => b.includes('"status":5'))).toBe(false);
  });

  it("(3) nenhum canário em audit_logs (SELECT * serializado, todas as colunas incl. metadata) e as ações de MK4 existem com metadata mínima", async () => {
    const { rows } = await c.h.pool.query<Record<string, unknown>>("SELECT * FROM audit_logs ORDER BY id");
    const found: string[] = [];
    for (const row of rows) found.push(...leaks(`audit_logs.id=${String(row.id)} (${String(row.action)})`, JSON.stringify(row), [...IDENTITY.filter((x) => x.value !== BIRTH), ...SHARED, ...RX, QRY]));
    expect(found).toEqual([]);
    const mk4 = rows.filter((r) => MK4_ACTIONS.includes(String(r.action)));
    expect(new Set(mk4.map((r) => String(r.action)))).toEqual(new Set(MK4_ACTIONS));
    // As categorias lidas nunca vão para a auditoria de MK4 (só contagens).
    for (const row of mk4) expect(leaks(`audit_logs.id=${String(row.id)}`, JSON.stringify(row), CATS), String(row.action)).toEqual([]);
    const metaKeys = (action: string, result: string): string[][] => mk4.filter((r) => r.action === action && r.result === result).map((r) => Object.keys(r.metadata ?? {}).sort());
    for (const keys of metaKeys("RECORD_SHARE_CREATE", "SUCCESS")) expect(keys).toEqual(["bookingId", "categoryCount", "professionalId", "validity", "viewOnce"]);
    for (const keys of metaKeys("RECORD_SHARE_REVOKE", "SUCCESS")) expect(keys).toEqual(["fromStatus"]);
    for (const keys of metaKeys("PROFESSIONAL_SHARE_OPEN", "SUCCESS")) expect(keys).toEqual(["categoryCount", "viewNo", "viewOnce"]);
    for (const keys of metaKeys("PROFESSIONAL_SHARE_OPEN", "DENIED")) expect(keys).toEqual(["reason"]);
    for (const keys of metaKeys("PRESCRIPTION_ISSUED_BY_PROFESSIONAL", "SUCCESS")) expect(keys).toEqual(["bookingId", "medicationCount"]);
    expect(metaKeys("PROFESSIONAL_SHARE_OPEN", "SUCCESS").length).toBeGreaterThanOrEqual(3);
    expect(metaKeys("PROFESSIONAL_SHARE_OPEN", "DENIED").length).toBeGreaterThanOrEqual(2);
    // A autoria da abertura é a conta do profissional (sem utilizador); a data de nascimento não está em nenhuma linha.
    for (const row of mk4.filter((r) => r.action === "PROFESSIONAL_SHARE_OPEN")) expect([row.actor_type, row.actor_user_id]).toEqual(["PROFESSIONAL_ACCOUNT", null]);
    expect(JSON.stringify(rows)).not.toContain(BIRTH);
  });

  it("(4) alertas à família e avisos ao profissional: só ids e tipos, nenhum canário", () => {
    expect(c.alertCalls.length).toBeGreaterThanOrEqual(1);
    expect(c.shareNoticeCalls.length).toBeGreaterThanOrEqual(3);
    expect(leaks("alertCalls", JSON.stringify(c.alertCalls), EVERYWHERE)).toEqual([]);
    expect(leaks("shareNoticeCalls", JSON.stringify(c.shareNoticeCalls), EVERYWHERE)).toEqual([]);
    for (const call of c.alertCalls) expect(Object.keys(call).sort()).toEqual(["bookingId", "familyId", "kind", "memberId", "stateVersion"]);
    for (const call of c.shareNoticeCalls) expect(Object.keys(call).sort()).toEqual(["professionalId", "shareId"]);
    expect(c.alertCalls.some((a) => a.kind === "BOOKING_UPDATED" && a.bookingId === ids.done)).toBe(true);
  });

  it("(5) e-mails ao profissional: texto fixo e genérico; só a conta recebe, nenhum canário", () => {
    expect(c.shareMails.length).toBeGreaterThanOrEqual(3);
    expect(leaks("e-mails (destinatários)", c.shareMails.join("\n"), EVERYWHERE)).toEqual([]);
    const text = `${SHARE_NOTICE_SUBJECT}\n${SHARE_NOTICE_TEXT}`;
    expect(leaks("e-mail (assunto e texto fixos)", text, EVERYWHERE)).toEqual([]);
    expect(text).not.toMatch(/\d{3}/); // sem horas, valores nem ids
  });

  it("(6) TC-AZ-MKT-30: nenhuma resposta ao profissional tem chaves proibidas (varrimento recursivo) nem os valores de identificação do membro", () => {
    expect(PRO_BODIES.length).toBeGreaterThan(25);
    const FORBIDDEN_KEYS = ["familyId", "memberId", "userId", "createdByUserId", "revokedByUserId", "issuedByProfessionalId", "birthDate", "dateOfBirth", "memberName", "familyName", "userName", "fullName", "email", "guardianId", "prescriptionId", "planId"];
    for (const body of PRO_BODIES) {
      const keys = keysOf(body);
      for (const key of FORBIDDEN_KEYS) expect(keys, `chave proibida ${key} em ${JSON.stringify(body).slice(0, 120)}`).not.toContain(key);
    }
    // Valores: nome, família, e-mail, nascimento e os ids de família/membro/utilizador nunca aparecem (o `participantLabel` e o `ageYears` sim).
    const dump = JSON.stringify(PRO_BODIES);
    for (const value of [MEMBER_NAME, FAMILY_NAME, USER_NAME, BIRTH, ids.fam, ids.m, ids.u]) expect(dump, value).not.toContain(value);
    expect(dump).toContain(LABEL);
    // O conteúdo aberto só leva as chaves do contrato (sem ids de registos de saúde).
    const opens = PRO_BODIES.filter((b) => typeof b === "object" && b !== null && "watermark" in b) as Record<string, any>[];
    expect(opens.length).toBeGreaterThanOrEqual(3);
    const allowed = new Set(["shareId", "participantLabel", "ageYears", "openedAt", "expiresAt", "viewOnce", "watermark", "allergies", "bloodType", "conditions", "medications", "appointments", "examinations"]);
    for (const open of opens) for (const key of Object.keys(open)) expect(allowed.has(key), key).toBe(true);
    for (const open of opens) for (const key of keysOf(open)) expect(key, "id de registo de saúde na abertura").not.toBe("id");
    // Metadados da partilha: só os campos do contrato.
    const shareItems = PRO_BODIES.filter((b) => typeof b === "object" && b !== null && "canOpen" in b) as Record<string, any>[];
    expect(shareItems.length).toBeGreaterThanOrEqual(1);
    for (const item of shareItems) expect(Object.keys(item).sort()).toEqual(["bookingId", "canOpen", "categories", "createdAt", "expiresAt", "id", "lastOpenedAt", "openCount", "participantLabel", "status", "validity", "viewOnce"]);
  });

  it("(7) as respostas da família sobre partilhas e vistas não levam conteúdo partilhado, nem rótulo, nem autoria", () => {
    expect(FAMILY_SHARE_BODIES.length).toBeGreaterThan(10);
    const dump = FAMILY_SHARE_BODIES.join("\n");
    expect(leaks("respostas da família", dump, [...SHARED, ...RX, QRY])).toEqual([]);
    expect(dump).not.toContain(LABEL);
    expect(dump).not.toContain(ids.u);
    for (const body of FAMILY_SHARE_BODIES) expect(body).not.toMatch(/createdByUserId|revokedByUserId/);
  });

  it("(8) armazenamento: record_shares e record_share_views não guardam conteúdo nem idade/nascimento (TC-MKT-142)", async () => {
    const shares = await c.h.pool.query("SELECT * FROM record_shares");
    const views = await c.h.pool.query("SELECT * FROM record_share_views");
    expect(shares.rowCount).toBeGreaterThanOrEqual(3);
    expect(views.rowCount).toBeGreaterThanOrEqual(3);
    expect(leaks("record_shares", JSON.stringify(shares.rows), [...SHARED, ...RX, canary("nome", MEMBER_NAME), canary("nascimento", BIRTH)])).toEqual([]);
    expect(leaks("record_share_views", JSON.stringify(views.rows), [...SHARED, ...RX, canary("nome", MEMBER_NAME), canary("nascimento", BIRTH)])).toEqual([]);
    const columns = await c.h.pool.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name IN ('record_shares', 'record_share_views')");
    expect(columns.rows.map((r) => r.column_name).filter((n) => /age|birth|content|snapshot|payload/i.test(n))).toEqual([]);
  });

  it("(9) o detetor de canários funciona (sem BD): apanha o valor, a categoria e a query string", () => {
    expect(leaks("teste", `{"x":"${LABEL}"}`, EVERYWHERE)).toEqual(["teste: participantLabel"]);
    expect(leaks("teste", `{"x":"${QUERY}"}`, EVERYWHERE)).toEqual(["teste: query string"]);
    expect(leaks("teste", `{"categories":["MEDICATION"]}`, EVERYWHERE)).toEqual(["teste: categoria lida (MEDICATION)"]);
    expect(leaks("teste", `{"ok":"sem dados"}`, EVERYWHERE)).toEqual([]);
    expect(keysOf({ a: [{ memberId: 1 }], b: { c: { userId: 2 } } }).sort()).toEqual(["a", "b", "c", "memberId", "userId"]);
  });
});
