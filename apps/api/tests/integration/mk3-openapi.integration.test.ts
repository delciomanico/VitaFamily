/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any -- corpos JSON de respostas HTTP lidos de forma dinâmica nos testes */
// Conformidade das 31 operações MK3 com o `openapi.yaml` (S13; TC-MKT-107; BR-MKT-63; AC-MKT-41): PostgreSQL real + API real, com validação de
// pedidos E respostas contra o contrato (o harness `startConsultationsHarness` já o faz: uma resposta fora do contrato rebenta com 500).
//   (a) cada operação tem rota montada (sem token ⇒ 401, nunca 404/405/500) e, num percurso feliz completo, pelo menos um pedido 2xx validado;
//   (b) `additionalProperties: false` nos corpos de pedido de MK3 (no yaml e na API real: campo desconhecido ⇒ 400/422);
//   (c) SLOT_UNAVAILABLE, SELF_BOOKING_NOT_ALLOWED e REVIEW_NOT_ALLOWED: em errors.md, no catálogo do código e devolvidos pela API com o status contratado;
//   (d) varrimento recursivo (por $ref) dos schemas de resposta do profissional, do admin e das avaliações públicas: nenhum com familyId/memberId/userId.
// Nota: `completeBooking` e `markBookingNoShow` não têm corpo de pedido no contrato (nada a fechar nelas) e `uploadPaymentProof` é multipart.
// As operações do contrato MK3 que `MK3_OPERATION_IDS` (tests/support/mk3-pending.ts) ainda não lista (uploadPaymentProof e as 4 do admin sobre
// disputas) completam-se aqui e verificam-se contra o yaml (a); a lista tem de coincidir com as rotas MK3 do yaml.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { errorCatalog } from "../../src/platform/errors/codes.js";
import { openApiSpecPath } from "../support/openapi-spec.js";
import { binaryParser, parseAllOps, pdf, type Op } from "../support/mk3-ops.js";
import { MK3_OPERATION_IDS, MK3_PENDING_OPERATION_IDS } from "../support/mk3-pending.js";
import { API, START } from "../support/professionals-harness.js";
import { startConsultationsHarness, type ConsultationsHarness, type OfferFixture, type ProfessionalFixture, type UserFixture } from "../support/consultations-harness.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const HOUR = 3_600_000;
const DAY = 86_400_000;
const ID = "00000000-0000-4000-8000-00000000abcd";
const yaml = readFileSync(openApiSpecPath(REPO_ROOT), "utf8");
const errorsMd = readFileSync(join(REPO_ROOT, "docs/05-api/errors.md"), "utf8");

/** As 31 operações MK3 (as 26 de `MK3_OPERATION_IDS` mais as 5 que lá faltam). */
const EXTRA_MK3 = ["uploadPaymentProof", "adminListPaymentDisputes", "adminGetPaymentDispute", "adminDownloadPaymentProof", "adminDecidePaymentDispute"];
const MK3_ALL = new Set<string>([...MK3_OPERATION_IDS, ...EXTRA_MK3]);

const ALL_OPS = parseAllOps(yaml);
/** Rota «de MK3» pelo caminho, independentemente da lista de ids (para a conferir). */
const isMk3Path = (path: string): boolean =>
  path.startsWith("/families/{familyId}/members/{memberId}/bookings") ||
  /^\/marketplace\/professionals\/\{professionalId\}\/(slots|reviews)$/.test(path) ||
  /^\/professional-portal\/(bookings|reviews)/.test(path) ||
  /^\/admin\/(payment-disputes|review-reports)/.test(path);
const OPS = ALL_OPS.filter((op) => MK3_ALL.has(op.id));
const OP_BY_ID = new Map(OPS.map((op) => [op.id, op] as const));
const keyOf = (op: Op): string => `${op.method.toUpperCase()} ${op.path}`;

let c: ConsultationsHarness;
let admin: UserFixture;

const bodyOf = (res: { body: unknown }): Record<string, any> => res.body as Record<string, any>;
const authOf = (token?: string): Record<string, string> => (token === undefined ? {} : { Authorization: `Bearer ${token}` });
interface CallOptions {
  params?: Record<string, string>;
  query?: Record<string, string>;
  token?: string | undefined;
  body?: unknown;
  file?: Buffer;
}

/** Operações com pelo menos uma resposta 2xx (validada contra o contrato pelo harness). */
const exercised = new Set<string>();

/** Pede a operação pelo `operationId`; os parâmetros de caminho em falta ficam com um UUID inexistente. */
async function call(opId: string, o: CallOptions = {}): Promise<request.Response> {
  const op = OP_BY_ID.get(opId);
  if (!op) throw new Error(`operação desconhecida: ${opId}`);
  const url = `${API}${op.path.replace(/\{(\w+)\}/g, (_m, k: string) => o.params?.[k] ?? ID)}`;
  let req = request(c.h.app)[op.method](url).set(authOf(o.token));
  if (o.query) req = req.query(o.query);
  if (o.file) req = req.attach("file", o.file, { filename: "comprovativo.pdf", contentType: "application/pdf" });
  else if (o.body !== undefined) req = req.send(o.body as object);
  if (opId.includes("ownload")) req = req.buffer(true).parse(binaryParser as never);
  const res = await req;
  if (res.status >= 200 && res.status < 300) exercised.add(opId);
  return res;
}

async function must(opId: string, status: number, o: CallOptions = {}): Promise<request.Response> {
  const res = await call(opId, o);
  if (res.status !== status) throw new Error(`${opId}: esperado ${String(status)}, obtido ${String(res.status)}: ${JSON.stringify(res.body)}`);
  return res;
}

let seq = 0;
interface Patient {
  u: UserFixture;
  fam: string;
  m: string;
}
async function patient(): Promise<Patient> {
  const n = ++seq;
  const u = await c.user(`conformidade${String(n)}`);
  const fam = await c.family(`Família conformidade ${String(n)}`);
  const m = await c.member(fam, { userId: u.id, role: "FAMILY_ADMIN", name: `Conformidade ${String(n)}` });
  return { u, fam, m };
}
const at = (ms: number): Date => new Date(START.getTime() + ms);

interface World {
  pro: ProfessionalFixture;
  token: string;
  video: OfferFixture;
}
async function world(): Promise<World> {
  const pro = await c.professional({ name: "Dra. Conformidade", paymentInstructions: "Transferência para a conta de teste (conformidade)." });
  return { pro, token: await c.professionalToken(pro.professionalId), video: await c.offer(pro, { method: "VIDEO", durationMinutes: 30, priceKz: 5000 }) };
}

describe("MK3: conformidade OpenAPI das 31 operações de consultations (TC-MKT-107)", () => {
  beforeAll(async () => {
    c = await startConsultationsHarness();
    admin = await c.admin();
  }, 300_000);

  afterAll(async () => {
    await c.stop();
  });

  describe("(a) rota montada, protegida e exercitada com resposta validada", () => {
    it("o inventário do yaml tem 31 operações MK3 e coincide com as de MK3_OPERATION_IDS completadas; MK3_PENDING_OPERATION_IDS está vazio", () => {
      expect(MK3_PENDING_OPERATION_IDS.size).toBe(0);
      const byPath = ALL_OPS.filter((op) => isMk3Path(op.path)).map((op) => op.id).sort();
      expect(byPath).toHaveLength(31);
      expect(byPath).toEqual([...MK3_ALL].sort());
      expect(OPS).toHaveLength(31);
      expect(new Set(OPS.map(keyOf)).size).toBe(31);
      for (const id of MK3_OPERATION_IDS) expect(OP_BY_ID.has(id), id).toBe(true);
    });

    it.each(OPS.map((op) => [keyOf(op), op] as const))("%s sem token ⇒ 401 (a rota existe: nunca 404/405/500)", async (_label, op) => {
      const body = op.method === "get" ? undefined : op.id === "uploadPaymentProof" ? undefined : {};
      const res = await call(op.id, op.id === "uploadPaymentProof" ? { file: pdf("sem-token") } : { body });
      expect(res.status).toBe(401);
      expect(bodyOf(res).code).toBe("UNAUTHENTICATED");
    });

    it("percurso feliz completo: cada uma das 31 operações tem pelo menos um pedido 2xx cuja resposta passa a validação contra o contrato", async () => {
      c.h.clock.set(START);
      const w = await world();
      const pt = await patient();
      const fam = { familyId: pt.fam, memberId: pt.m };
      const mkSlot = (ms: number): Promise<string> => c.slot(w.video, at(ms));
      const create = async (slotId: string): Promise<string> => bodyOf(await must("createBooking", 201, { params: fam, token: pt.u.token, body: { offerId: w.video.id, slotId, participantLabel: "Paciente" } })).id as string;

      // horários livres (pública, 60/min) e criação
      const s1 = await mkSlot(3 * HOUR);
      const slots = await must("listBookableSlots", 200, { params: { professionalId: w.pro.professionalId }, query: { offerId: w.video.id }, token: pt.u.token });
      expect((slots.body as { id: string }[]).map((s) => s.id)).toContain(s1);
      const b1 = await create(s1);
      const b2 = await create(await mkSlot(30 * HOUR));
      const b3 = await create(await mkSlot(50 * HOUR));
      const b4 = await create(await mkSlot(70 * HOUR));
      const b5 = await create(await mkSlot(5 * HOUR));

      // leitura da família e do profissional
      await must("listFamilyBookings", 200, { params: fam, token: pt.u.token });
      await must("getFamilyBooking", 200, { params: { ...fam, bookingId: b1 }, token: pt.u.token });
      await must("listProfessionalBookings", 200, { token: w.token });
      await must("getProfessionalBooking", 200, { params: { bookingId: b1 }, token: w.token });

      // ações do profissional
      await must("confirmBooking", 200, { params: { bookingId: b1 }, token: w.token, body: { meetingInfo: "https://sala.exemplo.ao/1" } });
      await must("confirmBooking", 200, { params: { bookingId: b4 }, token: w.token, body: { meetingInfo: "https://sala.exemplo.ao/4" } });
      await must("confirmBooking", 200, { params: { bookingId: b5 }, token: w.token, body: { meetingInfo: "https://sala.exemplo.ao/5" } });
      await must("rejectBooking", 200, { params: { bookingId: b2 }, token: w.token, body: { reason: "Sem vaga." } });
      await must("cancelProfessionalBooking", 200, { params: { bookingId: b4 }, token: w.token, body: { reason: "Imprevisto." } });
      await must("cancelFamilyBooking", 200, { params: { ...fam, bookingId: b3 }, token: pt.u.token, body: { note: "Já não preciso." } });

      // comprovativo: carregar, antivírus, listar, descarregar (família e profissional), rejeitar, disputar, admin (lista, detalhe, ficheiro, decisão)
      await must("listFamilyPaymentProofs", 200, { params: { ...fam, bookingId: b1 }, token: pt.u.token });
      const proof = await must("uploadPaymentProof", 201, { params: { ...fam, bookingId: b1 }, token: pt.u.token, file: pdf("conformidade") });
      const proofId = bodyOf(proof).id as string;
      await c.runProofScans();
      expect((await must("listFamilyPaymentProofs", 200, { params: { ...fam, bookingId: b1 }, token: pt.u.token })).body).toHaveLength(1);
      expect((await must("downloadFamilyPaymentProof", 200, { params: { ...fam, bookingId: b1, proofId }, token: pt.u.token })).body).toBeInstanceOf(Buffer);
      expect((await must("downloadProfessionalPaymentProof", 200, { params: { bookingId: b1, proofId }, token: w.token })).body).toBeInstanceOf(Buffer);
      await must("decidePaymentProof", 200, { params: { bookingId: b1, proofId }, token: w.token, body: { decision: "REJECT", reason: "Não encontrei a transferência." } });
      await must("disputePaymentProof", 200, { params: { ...fam, bookingId: b1, proofId }, token: pt.u.token, body: { note: "Foi feita ontem." } });
      await must("adminListPaymentDisputes", 200, { token: admin.token });
      await must("adminGetPaymentDispute", 200, { params: { proofId }, token: admin.token });
      expect((await must("adminDownloadPaymentProof", 200, { params: { proofId }, token: admin.token })).body).toBeInstanceOf(Buffer);
      await must("adminDecidePaymentDispute", 200, { params: { proofId }, token: admin.token, body: { decision: "CONFIRM_PAYMENT" } });

      // a hora das consultas chegou: concluir e falta
      c.h.clock.set(at(6 * HOUR));
      await must("completeBooking", 200, { params: { bookingId: b1 }, token: w.token });
      await must("markBookingNoShow", 200, { params: { bookingId: b5 }, token: w.token });

      // avaliações: criar, ler, pública, do profissional, resposta, denúncia, admin
      const review = await must("putFamilyBookingReview", 201, { params: { ...fam, bookingId: b1 }, token: pt.u.token, body: { rating: 5, comment: "Muito atenciosa." } });
      expect(bodyOf(review).rating).toBe(5);
      await must("getFamilyBookingReview", 200, { params: { ...fam, bookingId: b1 }, token: pt.u.token });
      await must("listProfessionalReviews", 200, { params: { professionalId: w.pro.professionalId }, token: pt.u.token });
      const own = await must("listProfessionalReviewsOwn", 200, { token: w.token });
      const reviewId = bodyOf(own).items[0].id as string;
      await must("replyToReview", 201, { params: { reviewId }, token: w.token, body: { text: "Obrigada." } });
      await must("reportReview", 201, { params: { reviewId }, token: w.token, body: { reason: "OTHER", note: "Não foi esta a consulta." } });
      await must("adminListReviewReports", 200, { token: admin.token });
      const reportId = bodyOf(await must("adminListReviewReports", 200, { token: admin.token })).items[0].id as string;
      await must("adminGetReviewReport", 200, { params: { reportId }, token: admin.token });
      await must("adminDecideReviewReport", 200, { params: { reportId }, token: admin.token, body: { decision: "HIDE_COMMENT" } });

      expect([...MK3_ALL].filter((id) => !exercised.has(id)).sort()).toEqual([]);
    }, 120_000);
  });

  describe("(b) additionalProperties: false nos corpos de pedido de MK3", () => {
    const CLOSED_SCHEMAS = ["CreateBookingRequest", "CancelBookingRequest", "ConfirmBookingRequest", "RejectBookingRequest", "ProofDecisionRequest", "DisputePaymentProofRequest", "ReviewInput", "ReviewReplyRequest", "ReviewReportRequest", "AdminPaymentDisputeDecisionRequest", "AdminReviewReportDecisionRequest"];

    it.each(CLOSED_SCHEMAS)("no yaml: %s declara additionalProperties: false", (name) => {
      expect(schemaBlock(name), name).toMatch(/\n {6}additionalProperties: false\b/);
    });

    it("na API real: um campo desconhecido em cada corpo de pedido ⇒ 400/422 de validação (e o corpo sem o campo é aceite pela validação)", async () => {
      const w = await world();
      const pt = await patient();
      const fam = { familyId: pt.fam, memberId: pt.m };
      const cases: { op: string; params: Record<string, string>; token: string; body: Record<string, unknown> }[] = [
        { op: "createBooking", params: fam, token: pt.u.token, body: { offerId: ID, slotId: ID, participantLabel: "Ana" } },
        { op: "cancelFamilyBooking", params: { ...fam, bookingId: ID }, token: pt.u.token, body: { note: "x" } },
        { op: "confirmBooking", params: { bookingId: ID }, token: w.token, body: { meetingInfo: "x" } },
        { op: "rejectBooking", params: { bookingId: ID }, token: w.token, body: { reason: "x" } },
        { op: "cancelProfessionalBooking", params: { bookingId: ID }, token: w.token, body: { reason: "x" } },
        { op: "decidePaymentProof", params: { bookingId: ID, proofId: ID }, token: w.token, body: { decision: "CONFIRM" } },
        { op: "disputePaymentProof", params: { ...fam, bookingId: ID, proofId: ID }, token: pt.u.token, body: { note: "x" } },
        { op: "putFamilyBookingReview", params: { ...fam, bookingId: ID }, token: pt.u.token, body: { rating: 4 } },
        { op: "replyToReview", params: { reviewId: ID }, token: w.token, body: { text: "x" } },
        { op: "reportReview", params: { reviewId: ID }, token: w.token, body: { reason: "OTHER" } },
        { op: "adminDecidePaymentDispute", params: { proofId: ID }, token: admin.token, body: { decision: "CONFIRM_PAYMENT" } },
        { op: "adminDecideReviewReport", params: { reportId: ID }, token: admin.token, body: { decision: "DISMISS" } },
      ];
      for (const k of ["extra", "userId", "familyId", "attachments"]) {
        for (const { op, params, token, body } of cases) {
          const res = await call(op, { params, token, body: { ...body, [k]: "x" } });
          expect([400, 422], `${op} + ${k} ⇒ ${String(res.status)} ${JSON.stringify(res.body)}`).toContain(res.status);
          expect(["MALFORMED_REQUEST", "VALIDATION_ERROR"], `${op} + ${k}`).toContain(bodyOf(res).code);
        }
      }
      // controlo: sem o campo a validação passa (404 de recurso inexistente, nunca 400/422 de forma)
      for (const { op, params, token, body } of cases) {
        const res = await call(op, { params, token, body });
        expect(res.status, `${op} sem campo extra`).toBe(404);
        expect(bodyOf(res).code).toBe("NOT_FOUND");
      }
    });
  });

  describe("(c) SLOT_UNAVAILABLE, SELF_BOOKING_NOT_ALLOWED, REVIEW_NOT_ALLOWED", () => {
    const CODES = ["SLOT_UNAVAILABLE", "SELF_BOOKING_NOT_ALLOWED", "REVIEW_NOT_ALLOWED"] as const;

    it.each(CODES)("%s: linha 409 em errors.md e no catálogo do código", (code) => {
      expect(errorsMd).toMatch(new RegExp(`\\| \`${code}\` \\| 409 \\|`));
      expect(errorCatalog[code].status).toBe(409);
    });

    it("a API real devolve cada código com status 409, problem+json, `code` e `detail` em pt-PT genérico e sem dados do utilizador", async () => {
      c.h.clock.set(START);
      const w = await world();
      const a = await patient();
      const b = await patient();
      const slotId = await c.slot(w.video, at(3 * HOUR));
      const book = (p: Patient, slot: string, label = "Paciente") => call("createBooking", { params: { familyId: p.fam, memberId: p.m }, token: p.u.token, body: { offerId: w.video.id, slotId: slot, participantLabel: label } });

      // SLOT_UNAVAILABLE: o mesmo horário pedido por dois membros
      expect((await book(a, slotId, "Rótulo Reservado")).status).toBe(201);
      const taken = await book(b, slotId, "Rótulo Perdedor");
      expect(taken.status).toBe(409);
      expect(taken.headers["content-type"]).toMatch(/application\/problem\+json/);
      expect(bodyOf(taken).code).toBe("SLOT_UNAVAILABLE");
      expect(bodyOf(taken).status).toBe(409);

      // SELF_BOOKING_NOT_ALLOWED: utilizador com o mesmo e-mail do profissional
      const own = await c.professional({ email: "dra.propria@exemplo.ao", name: "Dra. Própria" });
      const ownOffer = await c.offer(own, { method: "CHAT", durationMinutes: 20, priceKz: 3000 });
      const ownSlot = await c.slot(ownOffer, at(4 * HOUR));
      const selfUser = await c.user("propria", { email: "dra.propria@exemplo.ao" });
      const selfFam = await c.family("Própria");
      const selfMember = await c.member(selfFam, { userId: selfUser.id, role: "FAMILY_ADMIN" });
      const self = await call("createBooking", { params: { familyId: selfFam, memberId: selfMember }, token: selfUser.token, body: { offerId: ownOffer.id, slotId: ownSlot, participantLabel: "Eu" } });
      expect(self.status).toBe(409);
      expect(bodyOf(self).code).toBe("SELF_BOOKING_NOT_ALLOWED");
      expect(self.headers["content-type"]).toMatch(/application\/problem\+json/);

      // REVIEW_NOT_ALLOWED: marcação própria ainda não concluída
      const mine = await c.seedBooking({ familyId: a.fam, memberId: a.m, offer: w.video, startsAt: at(9 * DAY), createdByUserId: a.u.id });
      const review = await call("putFamilyBookingReview", { params: { familyId: a.fam, memberId: a.m, bookingId: mine.bookingId }, token: a.u.token, body: { rating: 4, comment: "Ainda não aconteceu." } });
      expect(review.status).toBe(409);
      expect(bodyOf(review).code).toBe("REVIEW_NOT_ALLOWED");

      for (const res of [taken, self, review]) {
        const dump = JSON.stringify(res.body);
        for (const secret of ["Rótulo", "propria", "exemplo.ao", "Própria", "@", a.u.id, b.u.id, selfUser.id]) expect(dump, secret).not.toContain(secret);
        expect(typeof bodyOf(res).detail).toBe("string");
      }
      // `detail` genérico (BR-MKT-59: a causa não é distinguida): nunca menciona pagamento, falta, prazo nem estado
      expect(bodyOf(review).detail).not.toMatch(/pagamento|falta|prazo|dias|conclu|estado/i);
    });

    // DIVERGÊNCIA contrato/código (reportada na S13): errors.md §«Três códigos novos» fixa o `detail` de REVIEW_NOT_ALLOWED como
    // «Esta consulta não pode ser avaliada neste momento.»; o código devolve «Esta marcação não pode ser avaliada.»
    // (src/modules/consultations/application/reviews.ts:240). `it.fails` passa enquanto divergir e fica vermelho quando for corrigido (então remover `.fails`).
    it.fails("DIVERGÊNCIA: o detail de REVIEW_NOT_ALLOWED é o texto contratado em errors.md", async () => {
      const w = await world();
      const a = await patient();
      const mine = await c.seedBooking({ familyId: a.fam, memberId: a.m, offer: w.video, startsAt: at(9 * DAY), createdByUserId: a.u.id });
      const review = await call("putFamilyBookingReview", { params: { familyId: a.fam, memberId: a.m, bookingId: mine.bookingId }, token: a.u.token, body: { rating: 4 } });
      expect(review.status).toBe(409);
      expect(bodyOf(review).detail).toBe("Esta consulta não pode ser avaliada neste momento.");
    });
  });

  describe("(d) nenhum schema do profissional, do admin ou das avaliações públicas expõe familyId/memberId/userId (BR-MKT-63; TC-AZ-MKT-21)", () => {
    const FORBIDDEN = ["familyId", "memberId", "userId", "createdByUserId", "uploadedByUserId"];
    // `participantLabel` só é permitido ao profissional (ProfessionalBooking), não ao admin nem às avaliações públicas.
    const ROOTS = ["BookingProfessional", "BookingOfferSummary", "ProfessionalBooking", "ProfessionalBookingPage", "PaymentProof", "ReviewReply", "ReviewSummary", "PublicReview", "PublicReviewPage", "ProfessionalReview", "ProfessionalReviewPage", "ReviewReport", "AdminPaymentDisputeItem", "AdminPaymentDisputePage", "AdminPaymentDisputeDetail", "AdminReviewReportItem", "AdminReviewReportPage", "AdminReviewReportDetail"];

    it("o varrimento tem controlo positivo: FamilyBooking (lado da família) tem memberId", () => {
      expect(collect("FamilyBooking").properties.has("memberId")).toBe(true);
    });

    it.each(ROOTS)("%s (e tudo o que referencia, recursivamente) não tem familyId/memberId/userId nem equivalentes", (root) => {
      const { properties, required, visited } = collect(root);
      expect(visited.has(root)).toBe(true);
      for (const key of FORBIDDEN) {
        expect(properties.has(key), `${root}.${key}`).toBe(false);
        expect(required.has(key), `${root} required ${key}`).toBe(false);
      }
    });

    it("as respostas 2xx das rotas do profissional, do admin e da lista pública de avaliações só referenciam schemas varridos ou neutros", () => {
      const refs = new Set<string>();
      for (const op of OPS.filter((o) => o.path.startsWith("/professional-portal/") || o.path.startsWith("/admin/") || o.path.endsWith("/reviews"))) {
        for (const ref of responseRefs(op)) refs.add(ref);
      }
      const neutral = new Set(["Problem", "FieldError"]);
      expect([...refs].filter((r) => !ROOTS.includes(r) && !neutral.has(r)).sort()).toEqual([]);
      for (const ref of refs) {
        const { properties } = collect(ref);
        for (const key of FORBIDDEN) expect(properties.has(key), `${ref}.${key}`).toBe(false);
      }
    });
  });
});

// --- Leitura do yaml (indentação do contrato: schemas a 4 espaços; propriedades a 8) ---

/** Texto do schema `name` em `components.schemas` (do cabeçalho de 4 espaços até ao seguinte). */
function schemaBlock(name: string): string {
  const lines = yaml.slice(yaml.indexOf("\ncomponents:")).split("\n");
  const start = lines.findIndex((l) => l === `    ${name}:`);
  if (start < 0) throw new Error(`schema inexistente: ${name}`);
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^ {0,4}\S/.test(line)) break;
    out.push(line);
  }
  return `\n${out.join("\n")}`;
}

/** Nomes de propriedade (qualquer profundidade), `required` e schemas alcançáveis por `$ref` a partir de `root`. */
function collect(root: string, acc = { properties: new Set<string>(), required: new Set<string>(), visited: new Set<string>() }) {
  if (acc.visited.has(root)) return acc;
  acc.visited.add(root);
  const stack: number[] = [];
  for (const line of schemaBlock(root).split("\n")) {
    const indent = line.length - line.trimStart().length;
    while (stack.length > 0 && indent <= (stack[stack.length - 1] ?? 0)) stack.pop();
    const key = /^\s*(\w+):/.exec(line)?.[1];
    if (stack.length > 0 && indent === (stack[stack.length - 1] ?? 0) + 2 && key !== undefined) acc.properties.add(key);
    if (/^\s*properties:\s*$/.test(line)) stack.push(indent);
    const req = /^\s*required:\s*\[(.*)\]/.exec(line);
    if (req) for (const k of (req[1] ?? "").split(",")) acc.required.add(k.trim());
    for (const ref of line.matchAll(/#\/components\/schemas\/(\w+)/g)) collect(ref[1] ?? "", acc);
  }
  return acc;
}

/** Schemas referenciados diretamente (`$ref`) nas respostas de uma operação (qualquer código). */
function responseRefs(op: Op): string[] {
  const lines = yaml.split("\n");
  const start = lines.findIndex((l) => l === `      operationId: ${op.id}`);
  const refs: string[] = [];
  let inResponses = false;
  for (const line of lines.slice(start + 1)) {
    if (/^ {2}\S/.test(line) || /^ {4}(get|post|put|patch|delete):/.test(line)) break;
    if (/^ {6}responses:/.test(line)) inResponses = true;
    else if (/^ {6}\S/.test(line)) inResponses = false;
    if (!inResponses) continue;
    for (const ref of line.matchAll(/#\/components\/schemas\/(\w+)/g)) refs.push(ref[1] ?? "");
  }
  return refs;
}
