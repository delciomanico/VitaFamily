/* eslint-disable @typescript-eslint/no-unsafe-member-access -- respostas HTTP/linhas SQL de teste sem tipagem (supertest devolve `any`). */
// Integração do canário de PII de MK3 (TC-MKT-104; BR-MKT-63; privacy.md): um fluxo completo com valores ÚNICOS («canários») no texto livre
// (`participantLabel`, `reason`, `note`, `meetingInfo`, comentário/resposta/nota da denúncia, nome do ficheiro do comprovativo, instruções de
// pagamento e preço) que nunca podem sair em logs técnicos, corpos de erro 4xx, `audit_logs` (todas as colunas, `metadata` incluída), alertas à
// família, avisos ao profissional, e-mails nem chaves de armazenamento. As respostas HTTP legítimas podem trazer os valores ao dono.
// Os logs são capturados com `logStream` do harness (logger `debug` real). A app não tem *log* de acesso (só `unhandled_error` em 5xx): o teste
// confirma-o e envia `?x=<canário>` e `cursor=<canário>` às rotas de MK3. Um contentor PostgreSQL real por ficheiro.
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NOTICE_SUBJECT, NOTICE_TEXT } from "../../src/modules/consultations/infrastructure/mailer-smtp.js";
import { API, nextIp, PROFESSIONAL_API, START } from "../support/professionals-harness.js";
import { startConsultationsHarness, type ConsultationsHarness, type OfferFixture, type ProfessionalFixture, type UserFixture } from "../support/consultations-harness.js";

type Res = request.Response;

const DAY = 86_400_000;
const HOUR = 3_600_000;

const LABEL = "rotulo-canario-mk3";
const REFUSE_REASON = "recusa-canario-mk3";
const PROOF_REASON = "motivo-comprovativo-canario-mk3";
const FAMILY_CANCEL_NOTE = "nota-cancelamento-canario-mk3";
const PRO_CANCEL_REASON = "motivo-cancelamento-pro-canario-mk3";
const DISPUTE_NOTE = "nota-disputa-canario-mk3";
const MEETING = "reuniao-canario-mk3";
const REVIEW_COMMENT = "comentario-canario-mk3";
const REVIEW_REPLY = "resposta-canario-mk3";
const REPORT_NOTE = "nota-denuncia-canario-mk3";
const FILE_NAME = "ficheiro-canario-mk3.pdf";
const PAYMENT = "iban-canario-mk3-ao06";
const PRICE = 7654321;
const QUERY = "query-canario-mk3";
const REJECTED_LABEL = "rotulo-rejeitado-canario-mk3";

interface Canary {
  label: string;
  value: string;
  /** Procura-se como token isolado (preço), para não casar dentro de UUIDs. */
  boundary: boolean;
}

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const occurs = (text: string, c: Canary): boolean => (c.boundary ? new RegExp(`(?<![0-9A-Za-z])${escapeRegex(c.value)}(?![0-9A-Za-z])`).test(text) : text.includes(c.value));

const CANARIES: Canary[] = [
  { label: "participantLabel", value: LABEL, boundary: false },
  { label: "participantLabel (pedido rejeitado)", value: REJECTED_LABEL, boundary: false },
  { label: "reason (recusa da marcação)", value: REFUSE_REASON, boundary: false },
  { label: "reason (recusa do comprovativo)", value: PROOF_REASON, boundary: false },
  { label: "note (cancelamento da família)", value: FAMILY_CANCEL_NOTE, boundary: false },
  { label: "reason (cancelamento do profissional)", value: PRO_CANCEL_REASON, boundary: false },
  { label: "note (disputa)", value: DISPUTE_NOTE, boundary: false },
  { label: "meetingInfo", value: MEETING, boundary: false },
  { label: "comentário da avaliação", value: REVIEW_COMMENT, boundary: false },
  { label: "resposta à avaliação", value: REVIEW_REPLY, boundary: false },
  { label: "nota da denúncia", value: REPORT_NOTE, boundary: false },
  { label: "nome do ficheiro do comprovativo", value: FILE_NAME, boundary: false },
  { label: "nome do ficheiro (sem extensão)", value: "ficheiro-canario-mk3", boundary: false },
  { label: "instruções de pagamento", value: PAYMENT, boundary: false },
  { label: "preço (priceKz)", value: String(PRICE), boundary: true },
  { label: "query string", value: QUERY, boundary: false },
];

const leaks = (source: string, text: string, canaries: Canary[] = CANARIES): string[] => canaries.filter((c) => occurs(text, c)).map((c) => `${source}: ${c.label}`);

function need<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("o teste anterior não preparou o estado");
  return value;
}

const authOf = (token?: string): Record<string, string> => (token === undefined ? {} : { Authorization: `Bearer ${token}` });
const bookingsOf = (familyId: string, memberId: string): string => `${API}/families/${familyId}/members/${memberId}/bookings`;
const proBookings = `${API}/professional-portal/bookings`;
const adminDisputes = `${API}/admin/payment-disputes`;
const adminReports = `${API}/admin/review-reports`;

/** Corpo binário: devolve `Buffer` (ficheiros) ou o JSON de erro. */
const binaryParser = (response: Res, callback: (err: Error | null, body: unknown) => void): void => {
  const res = response as unknown as NodeJS.ReadableStream & { headers: Record<string, string | undefined> };
  const chunks: Buffer[] = [];
  res.on("data", (chunk: Buffer) => chunks.push(chunk));
  res.on("end", () => {
    const body = Buffer.concat(chunks);
    if (res.headers["content-type"]?.includes("json")) {
      callback(null, JSON.parse(body.toString("utf8")) as unknown);
      return;
    }
    callback(null, body);
  });
};

const pdf = (tag: string): Buffer => Buffer.from(`%PDF-1.4\n${tag}\n%%EOF\n`, "utf8");

let c: ConsultationsHarness;
let admin: UserFixture;
const LOGS: string[] = [];
/** Corpo (JSON) de TODAS as respostas 4xx/5xx do fluxo. */
const ERROR_BODIES: string[] = [];
/** Ids de recursos usados nos caminhos dos pedidos de recurso alheio (o 404/403 não os pode ecoar). */
const PATH_IDS: string[] = [];

/** Regista o corpo dos erros e devolve a resposta (o fluxo usa-o em todas as chamadas). */
async function call(req: PromiseLike<Res>): Promise<Res> {
  const res = await req;
  if (res.status >= 400) ERROR_BODIES.push(JSON.stringify(res.body));
  return res;
}

async function ok(req: PromiseLike<Res>, status = 200): Promise<Res> {
  const res = await call(req);
  if (res.status !== status) throw new Error(`esperado ${String(status)}, recebido ${String(res.status)}: ${JSON.stringify(res.body)}`);
  return res;
}

/** Pedido com o método HTTP dado (os caminhos de recurso alheio percorrem vários métodos). */
function withMethod(method: string, url: string): request.Test {
  const agent = request(c.h.app);
  if (method === "post") return agent.post(url);
  if (method === "put") return agent.put(url);
  return agent.get(url);
}

const bodyOf = (res: Res): Record<string, any> => res.body as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

interface Patient {
  u: UserFixture;
  fam: string;
  m: string;
}

let patientSeq = 0;
async function patient(): Promise<Patient> {
  const n = ++patientSeq;
  const u = await c.user(`canario${String(n)}`);
  const fam = await c.family(`Família canário ${String(n)}`);
  const m = await c.member(fam, { userId: u.id, role: "FAMILY_ADMIN", name: `Canário ${String(n)}` });
  return { u, fam, m };
}

interface World {
  pro: ProfessionalFixture;
  token: string;
  video: OfferFixture;
}

async function world(): Promise<World> {
  const pro = await c.professional({ paymentInstructions: PAYMENT });
  return { pro, token: await c.professionalToken(pro.professionalId), video: await c.offer(pro, { method: "VIDEO", durationMinutes: 30, priceKz: PRICE }) };
}

const startOf = (day: number): Date => new Date(START.getTime() + day * DAY + 3 * HOUR);

/** Cria uma marcação pela API (horário por SQL; `?x=` desconhecido é rejeitado antes, por isso a query vai noutros pedidos). */
async function create(pt: Patient, w: World, day: number, label = LABEL): Promise<string> {
  const slotId = await c.slot(w.video, startOf(day));
  const res = await ok(request(c.h.app).post(bookingsOf(pt.fam, pt.m)).set(authOf(pt.u.token)).send({ offerId: w.video.id, slotId, participantLabel: label }), 201);
  return bodyOf(res).id as string;
}

const proPost = (w: World, bookingId: string, action: string, payload: object = {}) => request(c.h.app).post(`${proBookings}/${bookingId}/${action}`).set(authOf(w.token)).send(payload);

describe("TC-MKT-104: canário de PII de MK3 (logs, erros 4xx, auditoria, alertas, avisos, e-mails, armazenamento)", () => {
  const seen = { a: "", proofId: "", reviewId: "", reportId: "", familyA: undefined as Patient | undefined, w: undefined as World | undefined };

  beforeAll(async () => {
    c = await startConsultationsHarness({ logStream: LOGS });
    admin = await c.admin();
  }, 300_000);

  afterAll(async () => {
    await c.stop();
  });

  it("fluxo completo: marcar, confirmar (meetingInfo), comprovativo, rejeitar, disputar, admin decide, concluir, avaliar, responder, denunciar, decidir a denúncia", async () => {
    const w = await world();
    const pt = await patient();
    seen.w = w;
    seen.familyA = pt;

    // A: marcação paga.
    const a = await create(pt, w, 5);
    seen.a = a;
    const confirmed = await ok(proPost(w, a, "confirm", { meetingInfo: MEETING }));
    expect(bodyOf(confirmed).meetingInfo).toBe(MEETING); // o dono vê o seu valor
    c.h.clock.set(START);

    const detail = await ok(request(c.h.app).get(`${bookingsOf(pt.fam, pt.m)}/${a}`).set(authOf(pt.u.token)));
    expect(JSON.stringify(detail.body)).toContain(MEETING);
    expect(JSON.stringify(detail.body)).toContain(PAYMENT);
    expect(JSON.stringify(detail.body)).toContain(LABEL);

    const upload = await ok(request(c.h.app).post(`${bookingsOf(pt.fam, pt.m)}/${a}/payment-proofs`).set(authOf(pt.u.token)).attach("file", pdf("canario-a"), { filename: FILE_NAME, contentType: "application/pdf" }), 201);
    const proofId = bodyOf(upload).id as string;
    seen.proofId = proofId;
    expect(JSON.stringify(upload.body)).not.toContain(FILE_NAME); // a API nunca devolve o nome do ficheiro
    await c.runProofScans();
    await ok(proPost(w, a, `payment-proofs/${proofId}/decision`, { decision: "REJECT", reason: PROOF_REASON }));
    await ok(request(c.h.app).post(`${bookingsOf(pt.fam, pt.m)}/${a}/payment-proofs/${proofId}/dispute`).set(authOf(pt.u.token)).send({ note: DISPUTE_NOTE }));

    // Admin: abre a disputa, descarrega o ficheiro e decide.
    const dispute = await ok(request(c.h.app).get(`${adminDisputes}/${proofId}`).set(authOf(admin.token)));
    expect(bodyOf(dispute).familyNote).toBe(DISPUTE_NOTE);
    const file = await ok(request(c.h.app).get(`${adminDisputes}/${proofId}/file`).set(authOf(admin.token)).buffer(true).parse(binaryParser));
    expect(file.headers["content-disposition"]).toBe('attachment; filename="comprovativo.pdf"');
    expect(file.headers["content-disposition"]).not.toContain("canario");
    await ok(request(c.h.app).post(`${adminDisputes}/${proofId}/decisions`).set(authOf(admin.token)).send({ decision: "CONFIRM_PAYMENT" }));

    // Downloads do comprovativo (família e profissional): cabeçalho fixo, nunca o nome original.
    const famFile = await ok(request(c.h.app).get(`${bookingsOf(pt.fam, pt.m)}/${a}/payment-proofs/${proofId}/file`).set(authOf(pt.u.token)).buffer(true).parse(binaryParser));
    expect(famFile.headers["content-disposition"]).not.toContain("canario");
    const proFile = await ok(request(c.h.app).get(`${proBookings}/${a}/payment-proofs/${proofId}/file`).set(authOf(w.token)).buffer(true).parse(binaryParser));
    expect(proFile.headers["content-disposition"]).not.toContain("canario");
    await ok(request(c.h.app).get(`${bookingsOf(pt.fam, pt.m)}/${a}/payment-proofs`).set(authOf(pt.u.token)));
    const proView = await ok(request(c.h.app).get(`${proBookings}/${a}`).set(authOf(w.token)));
    expect(bodyOf(proView).proof.disputeNote).toBe(DISPUTE_NOTE); // o profissional vê a nota da disputa
    expect(JSON.stringify(proView.body)).not.toContain(pt.fam);

    // Concluir (agora ≥ startsAt), avaliar, responder, denunciar, decidir a denúncia.
    c.h.clock.set(new Date(startOf(5).getTime() + HOUR));
    await ok(proPost(w, a, "complete"));
    const review = await ok(request(c.h.app).put(`${bookingsOf(pt.fam, pt.m)}/${a}/review`).set(authOf(pt.u.token)).send({ rating: 4, comment: REVIEW_COMMENT }), 201);
    expect(bodyOf(review).comment).toBe(REVIEW_COMMENT);
    const reviewId = (await c.h.pool.query<{ id: string }>("SELECT id FROM reviews WHERE booking_id = $1", [a])).rows[0]?.id ?? "";
    seen.reviewId = reviewId;
    await ok(request(c.h.app).post(`${API}/professional-portal/reviews/${reviewId}/reply`).set(authOf(w.token)).send({ text: REVIEW_REPLY }), 201);
    const report = await ok(request(c.h.app).post(`${API}/professional-portal/reviews/${reviewId}/reports`).set(authOf(w.token)).send({ reason: "OTHER", note: REPORT_NOTE }), 201);
    seen.reportId = bodyOf(report).id as string;
    const adminReport = await ok(request(c.h.app).get(`${adminReports}/${seen.reportId}`).set(authOf(admin.token)));
    expect(bodyOf(adminReport).note).toBe(REPORT_NOTE);
    await ok(request(c.h.app).post(`${adminReports}/${seen.reportId}/decisions`).set(authOf(admin.token)).send({ decision: "HIDE_COMMENT" }));
    await ok(request(c.h.app).get(`${API}/marketplace/professionals/${w.pro.professionalId}/reviews`).set(authOf(pt.u.token)));
    await ok(request(c.h.app).get(`${API}/professional-portal/reviews`).set(authOf(w.token)));
    c.h.clock.set(START);

    // B: recusa da marcação; C: cancelamento da família; D: cancelamento do profissional.
    const b = await create(await patient(), w, 6, REJECTED_LABEL);
    await ok(proPost(w, b, "reject", { reason: REFUSE_REASON }));
    const ptC = await patient();
    const cb = await create(ptC, w, 7);
    await ok(request(c.h.app).post(`${bookingsOf(ptC.fam, ptC.m)}/${cb}/cancel`).set(authOf(ptC.u.token)).send({ note: FAMILY_CANCEL_NOTE }));
    const d = await create(await patient(), w, 8);
    await ok(proPost(w, d, "confirm", { meetingInfo: MEETING }));
    await ok(proPost(w, d, "cancel", { reason: PRO_CANCEL_REASON }));
    const famCancelled = await ok(request(c.h.app).get(`${bookingsOf(ptC.fam, ptC.m)}/${cb}`).set(authOf(ptC.u.token)));
    expect(bodyOf(famCancelled).status).toBe("CANCELLED");
    const proCancelled = await ok(request(c.h.app).get(`${proBookings}/${d}`).set(authOf(w.token)));
    expect(bodyOf(proCancelled).statusReason).toBe(PRO_CANCEL_REASON); // o outro lado vê o motivo
  }, 180_000);

  it("pedidos inválidos com canários (422/400/409): os corpos de erro não ecoam o texto recebido; query string não é registada", async () => {
    const w = await world();
    const pt = await patient();
    const e = await create(pt, w, 10);
    const slotId = await c.slot(w.video, startOf(11));

    // Marcação: rótulo longo demais, vazio de controlo, slot de outra oferta.
    for (const label of [`${LABEL}${"x".repeat(60)}`, `${LABEL}\u0007`]) {
      const res = await call(request(c.h.app).post(bookingsOf(pt.fam, pt.m)).set(authOf(pt.u.token)).send({ offerId: w.video.id, slotId, participantLabel: label }));
      expect([400, 422]).toContain(res.status);
    }
    // Profissional: recusa e cancelamento com motivo longo; VIDEO sem meetingInfo; meetingInfo longo.
    for (const [action, payload] of [
      ["reject", { reason: `${REFUSE_REASON}${"y".repeat(400)}` }],
      ["cancel", { reason: `${PRO_CANCEL_REASON}${"y".repeat(400)}` }],
      ["confirm", {}],
      ["confirm", { meetingInfo: `${MEETING}${"z".repeat(400)}` }],
    ] as [string, object][]) {
      const res = await call(proPost(w, e, action, payload));
      expect([400, 422]).toContain(res.status);
    }
    // Família: nota de cancelamento e de disputa longas; comentário com HTML; resposta e denúncia inválidas.
    expect([400, 422]).toContain((await call(request(c.h.app).post(`${bookingsOf(pt.fam, pt.m)}/${e}/cancel`).set(authOf(pt.u.token)).send({ note: `${FAMILY_CANCEL_NOTE}${"n".repeat(400)}` }))).status);
    expect([400, 409, 422]).toContain((await call(request(c.h.app).post(`${bookingsOf(pt.fam, pt.m)}/${e}/payment-proofs/${randomUUID()}/dispute`).set(authOf(pt.u.token)).send({ note: `${DISPUTE_NOTE}${"n".repeat(400)}` }))).status);
    expect([400, 409, 422]).toContain((await call(request(c.h.app).put(`${bookingsOf(pt.fam, pt.m)}/${e}/review`).set(authOf(pt.u.token)).send({ rating: 5, comment: `<${REVIEW_COMMENT}>` }))).status);
    expect([400, 404, 422]).toContain((await call(request(c.h.app).post(`${API}/professional-portal/reviews/${seen.reviewId}/reply`).set(authOf(w.token)).send({ text: `<${REVIEW_REPLY}>` }))).status);
    expect([400, 404, 422]).toContain((await call(request(c.h.app).post(`${API}/professional-portal/reviews/${seen.reviewId}/reports`).set(authOf(w.token)).send({ reason: REPORT_NOTE, note: REPORT_NOTE }))).status);
    // Upload: conteúdo não permitido (o nome do ficheiro leva o canário) ⇒ FILE_TYPE_NOT_ALLOWED sem eco.
    const bad = await call(request(c.h.app).post(`${bookingsOf(pt.fam, pt.m)}/${e}/payment-proofs`).set(authOf(pt.u.token)).attach("file", Buffer.from("isto não é um PDF"), { filename: FILE_NAME, contentType: "application/pdf" }));
    expect(bad.status).toBe(415);
    expect(bodyOf(bad).code).toBe("FILE_TYPE_NOT_ALLOWED");
    // Decisão de comprovativo e admin com valores inválidos.
    expect([400, 404, 422]).toContain((await call(proPost(w, e, `payment-proofs/${randomUUID()}/decision`, { decision: PROOF_REASON, reason: PROOF_REASON }))).status);
    expect([400, 404, 422]).toContain((await call(request(c.h.app).post(`${adminDisputes}/${randomUUID()}/decisions`).set(authOf(admin.token)).send({ decision: DISPUTE_NOTE }))).status);
    expect([400, 404, 422]).toContain((await call(request(c.h.app).post(`${adminReports}/${seen.reportId}/decisions`).set(authOf(admin.token)).send({ decision: REPORT_NOTE }))).status);

    // Query string com canário (parâmetro desconhecido e cursor inválido) em rotas de MK3 de todos os atores: 400, sem eco nem registo.
    const queried: [string, string, string?][] = [
      [bookingsOf(pt.fam, pt.m), pt.u.token],
      [`${bookingsOf(pt.fam, pt.m)}/${e}`, pt.u.token],
      [`${bookingsOf(pt.fam, pt.m)}/${e}/payment-proofs`, pt.u.token],
      [`${API}/marketplace/professionals/${w.pro.professionalId}/slots?offerId=${w.video.id}`, pt.u.token],
      [`${API}/marketplace/professionals/${w.pro.professionalId}/reviews`, pt.u.token],
      [proBookings, w.token],
      [`${proBookings}/${e}`, w.token],
      [`${API}/professional-portal/reviews`, w.token],
      [adminDisputes, admin.token],
      [adminReports, admin.token],
    ];
    for (const [url, token] of queried) {
      const sep = url.includes("?") ? "&" : "?";
      const unknown = await call(request(c.h.app).get(`${url}${sep}x=${QUERY}`).set(authOf(token)));
      expect(unknown.status).toBeGreaterThanOrEqual(400);
      expect(unknown.status).toBeLessThan(500);
      if (!url.includes("/slots") && !/\/(bookings|payment-proofs)\/[0-9a-f-]{36}$/.test(url) && !url.endsWith("/payment-proofs")) {
        const cursor = await call(request(c.h.app).get(`${url}${sep}cursor=${QUERY}`).set(authOf(token)));
        expect(cursor.status).toBe(400);
      }
    }
    expect(ERROR_BODIES.length).toBeGreaterThan(10);
  }, 120_000);

  it("recurso alheio: 404/403 sem eco de ids nem de texto livre", async () => {
    const w = need(seen.w);
    const pt = need(seen.familyA);
    const a = seen.a;
    const stranger = await patient();
    const outsider = await c.user("sem-relacao-mk3");
    await c.member(pt.fam, { userId: outsider.id, role: "FAMILY_MEMBER", name: "Sem relação" });
    const other = await world();
    const otherToken = other.token;
    PATH_IDS.push(pt.fam, pt.m, a, seen.proofId, seen.reviewId, seen.reportId, w.pro.professionalId, pt.u.id);

    const familyPaths: [string, string, object?][] = [
      ["get", `${bookingsOf(pt.fam, pt.m)}/${a}`],
      ["post", `${bookingsOf(pt.fam, pt.m)}/${a}/cancel`, {}],
      ["get", `${bookingsOf(pt.fam, pt.m)}/${a}/payment-proofs`],
      ["get", `${bookingsOf(pt.fam, pt.m)}/${a}/payment-proofs/${seen.proofId}/file`],
      ["post", `${bookingsOf(pt.fam, pt.m)}/${a}/payment-proofs/${seen.proofId}/dispute`, {}],
      ["get", `${bookingsOf(pt.fam, pt.m)}/${a}/review`],
      ["put", `${bookingsOf(pt.fam, pt.m)}/${a}/review`, { rating: 5, comment: REVIEW_COMMENT }],
    ];
    const fetches: Res[] = [];
    for (const [method, url, payload] of familyPaths) {
      // Outra família ⇒ 404; membro da família sem relação com o sujeito (OTHER) ⇒ 403.
      const asStranger = await call(withMethod(method, url).set(authOf(stranger.u.token)).send(payload ?? {}));
      expect(asStranger.status, `${method} ${url} (estranho)`).toBe(404);
      fetches.push(asStranger);
      const asOutsider = await call(withMethod(method, url).set(authOf(outsider.token)).send(payload ?? {}));
      expect(asOutsider.status, `${method} ${url} (sem relação)`).toBe(403);
      fetches.push(asOutsider);
    }
    // Outro profissional: marcação, comprovativo, avaliação e denúncia da marcação A ⇒ 404 idêntico.
    const proPaths: [string, string, object?][] = [
      ["get", `${proBookings}/${a}`],
      ["post", `${proBookings}/${a}/confirm`, { meetingInfo: MEETING }],
      ["post", `${proBookings}/${a}/reject`, { reason: REFUSE_REASON }],
      ["post", `${proBookings}/${a}/cancel`, { reason: PRO_CANCEL_REASON }],
      ["post", `${proBookings}/${a}/complete`, {}],
      ["post", `${proBookings}/${a}/no-show`, {}],
      ["get", `${proBookings}/${a}/payment-proofs/${seen.proofId}/file`],
      ["post", `${proBookings}/${a}/payment-proofs/${seen.proofId}/decision`, { decision: "REJECT", reason: PROOF_REASON }],
      ["post", `${API}/professional-portal/reviews/${seen.reviewId}/reply`, { text: REVIEW_REPLY }],
      ["post", `${API}/professional-portal/reviews/${seen.reviewId}/reports`, { reason: "OTHER", note: REPORT_NOTE }],
    ];
    for (const [method, url, payload] of proPaths) {
      const res = await call(withMethod(method, url).set(authOf(otherToken)).send(payload ?? {}));
      expect(res.status, `${method} ${url} (outro profissional)`).toBe(404);
      fetches.push(res);
    }
    const bodies = fetches.map((r) => JSON.stringify(r.body));
    for (const text of bodies) {
      for (const id of PATH_IDS) expect(text).not.toContain(id);
      expect(leaks("corpo 404/403", text)).toEqual([]);
    }
    // As respostas de 404 de recurso alheio são idênticas entre si (sem oráculo de existência) fora do transporte.
    const strip = (r: Res): unknown => ({ ...(r.body as object), requestId: 0 });
    const notFounds = fetches.filter((r) => r.status === 404).map(strip);
    const uniqueDetails = new Set(notFounds.map((b) => JSON.stringify({ code: (b as Record<string, unknown>).code, status: (b as Record<string, unknown>).status })));
    expect(uniqueDetails.size).toBe(1);
    // Nada mudou: a marcação continua COMPLETED e a avaliação sem alterações do estranho.
    expect((await c.h.pool.query<{ status: string }>("SELECT status FROM bookings WHERE id = $1", [a])).rows[0]?.status).toBe("COMPLETED");
  }, 120_000);

  it("reconcile: pedido caducado e profissional suspenso cancelam-se sem texto livre nem tempo/valor no alerta", async () => {
    const w = await world();
    const w2 = await world();
    const ptE = await patient();
    const e = await create(ptE, w, 20, REJECTED_LABEL);
    const ptF = await patient();
    const slotId = await c.slot(w2.video, startOf(20));
    const f = bodyOf(await ok(request(c.h.app).post(bookingsOf(ptF.fam, ptF.m)).set(authOf(ptF.u.token)).send({ offerId: w2.video.id, slotId, participantLabel: LABEL }), 201)).id as string;
    await ok(proPost(w2, f, "confirm", { meetingInfo: MEETING }));
    await c.h.pool.query("UPDATE professionals SET validation_status = 'SUSPENDED' WHERE id = $1", [w2.pro.professionalId]);
    c.h.clock.set(new Date(START.getTime() + 3 * DAY));
    expect(await c.maintenance.reconcileBookings()).toBeGreaterThanOrEqual(2);
    expect((await c.h.pool.query<{ status: string; system_reason: string }>("SELECT status, system_reason FROM bookings WHERE id = ANY($1)", [[e, f]])).rows.map((r) => r.system_reason).sort()).toEqual(["PROFESSIONAL_UNAVAILABLE", "REQUEST_EXPIRED"]);
    c.h.clock.set(START);
    // A suspensão não apaga a leitura da família (o texto do dono continua visível ao dono).
    expect((await ok(request(c.h.app).get(`${bookingsOf(ptF.fam, ptF.m)}/${f}`).set(authOf(ptF.u.token)))).status).toBe(200);
  }, 120_000);

  it("a captura de logs não está vazia: falha real do SMTP de MK1 aparece (prova de que um canário seria visto)", async () => {
    const falha = vi.spyOn(c.h.mailer, "send").mockRejectedValueOnce(new Error("smtp indisponivel"));
    await request(c.h.app).post(`${PROFESSIONAL_API}/auth/register`).set({ "X-Forwarded-For": nextIp() }).send({ email: "falha-smtp-mk3@exemplo.ao", password: "uma-palavra-passe-forte-123", termsVersion: "1.0" }).expect(202);
    expect(falha).toHaveBeenCalledTimes(1);
    falha.mockRestore();
    expect(LOGS.some((line) => line.includes('"professional_mailer_send_failed"'))).toBe(true);
  });

  it("(1) nenhum canário em logs técnicos", () => {
    expect(LOGS.length).toBeGreaterThan(0);
    expect(leaks("logs técnicos", LOGS.join("\n"))).toEqual([]);
  });

  it("(2) nenhum canário em corpos de erro 4xx (e há erros suficientes para o teste valer)", () => {
    expect(ERROR_BODIES.length).toBeGreaterThan(30);
    expect(leaks("corpos de erro", ERROR_BODIES.join("\n"))).toEqual([]);
    // Todos os erros de MK3 usam Problem+JSON: nenhum 5xx (um 5xx indicaria falha real, não validação).
    expect(ERROR_BODIES.some((b) => b.includes('"status":5'))).toBe(false);
  });

  it("(3) nenhum canário em audit_logs (SELECT * serializado, todas as colunas incl. metadata) e as ações de MK3 existem", async () => {
    const { rows } = await c.h.pool.query<Record<string, unknown>>("SELECT * FROM audit_logs ORDER BY id");
    const found: string[] = [];
    for (const row of rows) {
      const text = JSON.stringify(row);
      for (const l of leaks(`audit_logs.id=${String(row.id)} (${String(row.action)})`, text)) found.push(l);
    }
    expect(found).toEqual([]);
    const actions = new Set(rows.map((r) => String(r.action)));
    for (const action of [
      "BOOKING_CREATE",
      "BOOKING_CANCEL",
      "BOOKING_AUTO_CANCEL",
      "PAYMENT_PROOF_UPLOAD",
      "PAYMENT_PROOF_DOWNLOAD",
      "PAYMENT_PROOF_DISPUTE",
      "REVIEW_CREATE",
      "PROFESSIONAL_BOOKING_CONFIRM",
      "PROFESSIONAL_BOOKING_REJECT",
      "PROFESSIONAL_BOOKING_CANCEL",
      "PROFESSIONAL_BOOKING_COMPLETE",
      "PROFESSIONAL_PAYMENT_PROOF_DOWNLOAD",
      "PROFESSIONAL_PAYMENT_PROOF_DECIDE",
      "PROFESSIONAL_REVIEW_REPLY",
      "PROFESSIONAL_REVIEW_REPORT_CREATE",
      "ADMIN_PAYMENT_DISPUTE_VIEW",
      "ADMIN_PAYMENT_PROOF_DOWNLOAD",
      "ADMIN_PAYMENT_DISPUTE_DECIDE",
      "ADMIN_REVIEW_REPORT_VIEW",
      "ADMIN_REVIEW_REPORT_DECIDE",
    ]) {
      expect(actions.has(action), `falta a ação ${action}`).toBe(true);
    }
    // Auditoria do profissional não leva família nem membro (BR-MKT-63).
    const proRows = rows.filter((r) => r.actor_type === "PROFESSIONAL_ACCOUNT" && String(r.action).startsWith("PROFESSIONAL_BOOKING_"));
    expect(proRows.length).toBeGreaterThan(0);
    expect(proRows.every((r) => r.family_id === null && r.subject_member_id === null)).toBe(true);
  });

  it("(4) alertas à família e avisos ao profissional: só ids e tipos, nenhum canário", () => {
    expect(c.alertCalls.length).toBeGreaterThan(5);
    expect(c.noticeCalls.length).toBeGreaterThan(5);
    expect(leaks("alertCalls", JSON.stringify(c.alertCalls))).toEqual([]);
    expect(leaks("noticeCalls", JSON.stringify(c.noticeCalls))).toEqual([]);
    for (const call of c.alertCalls) expect(Object.keys(call).sort()).toEqual(["bookingId", "familyId", "kind", "memberId", "stateVersion"]);
    for (const call of c.noticeCalls) expect(Object.keys(call).sort()).toEqual(["bookingId", "event", "professionalId"]);
    expect(new Set(c.alertCalls.map((x) => x.kind))).toEqual(new Set(["BOOKING_UPDATED", "PAYMENT_UPDATED"]));
  });

  it("(5) e-mails ao profissional: texto fixo e genérico; só a conta recebe, nenhum canário", async () => {
    const professionalIds = [...new Set(c.noticeCalls.map((n) => n.professionalId))];
    c.mails.length = 0;
    for (const professionalId of professionalIds) expect(await c.maintenance.notifyProfessional({ professionalId })).toBe("SENT");
    expect(c.mails.length).toBe(professionalIds.length);
    expect(leaks("e-mails (destinatários)", c.mails.join("\n"))).toEqual([]);
    expect(leaks("e-mail (assunto e texto fixos)", `${NOTICE_SUBJECT}\n${NOTICE_TEXT}`)).toEqual([]);
    expect(`${NOTICE_SUBJECT}\n${NOTICE_TEXT}`).not.toMatch(/\d{3}/); // sem horas, valores nem ids
  });

  it("(6) armazenamento: as chaves dos objetos derivam do id do comprovativo, nunca do nome do ficheiro", async () => {
    const keys = [...c.h.storage.objects.keys()].filter((k) => k.startsWith("consultation-proofs/"));
    expect(keys.length).toBeGreaterThan(0);
    expect(leaks("chaves de armazenamento", keys.join("\n"))).toEqual([]);
    const rows = await c.h.pool.query<{ storage_key: string }>("SELECT storage_key FROM payment_proofs");
    expect(leaks("payment_proofs.storage_key", rows.rows.map((r) => r.storage_key).join("\n"))).toEqual([]);
    for (const { storage_key } of rows.rows) expect(storage_key).toMatch(/^consultation-proofs\/(quarantine|final)\/[0-9a-f-]{36}\.(pdf|jpg|png)$/);
  });

  it("(7) o detetor de canários funciona (sem BD): apanha o valor e o preço isolado, mas não dígitos dentro de um UUID", () => {
    expect(leaks("teste", `{"x":"${LABEL}"}`)).toEqual(["teste: participantLabel"]);
    expect(leaks("teste", `{"priceKz":${String(PRICE)}}`)).toEqual(["teste: preço (priceKz)"]);
    expect(leaks("teste", `{"id":"0a${String(PRICE)}b-0000-4000-8000-000000000000"}`)).toEqual([]);
  });
});
