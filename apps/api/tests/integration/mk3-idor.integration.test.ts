/* eslint-disable @typescript-eslint/no-explicit-any -- corpos JSON de respostas HTTP lidos de forma dinâmica nos testes */
// Matriz IDOR e de autorização de TODAS as rotas MK3 com id no caminho (S13; TC-AZ-MKT-17..25; BR-MKT-50/63; authorization.md §10.1..§10.3, §12).
// PostgreSQL real + API real validada contra o openapi.yaml. Duas famílias (A, B), dois profissionais (P1 em A, P2 em B), um terceiro profissional
// (suspenso depois de montado), o admin, um utilizador sem família, um Family Admin e um membro sem relação com o titular, e um dependente com conta.
//   - Família (/families/{f}/members/{m}/bookings*): tabela ops × atores. Sem token ⇒ 401; token de profissional ⇒ 401; outra família, família sem
//     membros do utilizador, família/membro/marcação inexistente, marcação de outro membro da mesma família ⇒ 404; Family Admin sem relação, membro sem
//     relação e DEPENDENT_SELF ⇒ 403 (membro existente na própria família).
//   - Profissional (/professional-portal/*): sem token/User/clínica/admin ⇒ 401; recurso de outro profissional ou inexistente ⇒ 404; não APPROVED:
//     leitura 200 e escritas 409 PROFESSIONAL_LOCKED; comprovativo só através da sua marcação.
//   - Admin (/admin/payment-disputes*, /admin/review-reports*): User não-admin ⇒ 403; profissional/clínica ⇒ 401; inexistente ⇒ 404.
//   - Em TODOS os 404 de recurso alheio o corpo é IDÊNTICO ao de inexistente (menos requestId/instance) e não contém nenhum id do cenário.
//   - Profissional não APPROVED nas rotas de família/públicas ⇒ 404 indistinguível (TC-AZ-MKT-23); o profissional não altera nota nem estado da avaliação
//     por nenhuma rota (TC-AZ-MKT-25). `listBookableSlots`/`listProfessionalReviews` e a criação de marcação entram na tabela de não APPROVED.
// A matriz «gerada» (TC-AZ-MKT-17/19) também falha se uma operação MK3 com `bookingId`/`proofId`/`reviewId`/`reportId` no caminho não estiver na tabela.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openApiSpecPath } from "../support/openapi-spec.js";
import { binaryParser, parseAllOps, pdf } from "../support/mk3-ops.js";
import { API, START } from "../support/professionals-harness.js";
import { startConsultationsHarness, type ConsultationsHarness, type OfferFixture, type ProfessionalFixture, type UserFixture } from "../support/consultations-harness.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const HOUR = 3_600_000;
const DAY = 86_400_000;
const OPS = new Map(parseAllOps(readFileSync(openApiSpecPath(REPO_ROOT), "utf8")).map((op) => [op.id, op] as const));

let c: ConsultationsHarness;

const at = (ms: number): Date => new Date(START.getTime() + ms);
const bodyOf = (res: { body: unknown }): Record<string, any> => res.body as Record<string, any>;
const authOf = (token?: string): Record<string, string> => (token === undefined ? {} : { Authorization: `Bearer ${token}` });
/** Campos de transporte (pedido/instância) variam por pedido; o resto tem de ser idêntico para não haver enumeração. */
const stripTransport = (body: unknown): unknown => ({ ...(body as object), requestId: 0, instance: 0 });

interface CallOptions {
  params?: Record<string, string>;
  query?: Record<string, string>;
  token?: string | undefined;
  body?: unknown;
  file?: Buffer;
}

/** Pede a operação pelo `operationId`; os parâmetros de caminho em falta ficam com um UUID inexistente (novo por parâmetro). */
function call(opId: string, o: CallOptions = {}): Promise<request.Response> {
  const op = OPS.get(opId);
  if (!op) throw new Error(`operação desconhecida: ${opId}`);
  const url = `${API}${op.path.replace(/\{(\w+)\}/g, (_m, k: string) => o.params?.[k] ?? randomUUID())}`;
  let req = request(c.h.app)[op.method](url).set(authOf(o.token));
  if (o.query) req = req.query(o.query);
  if (o.file) req = req.attach("file", o.file, { filename: "comprovativo.pdf", contentType: "application/pdf" });
  else if (o.body !== undefined) req = req.send(o.body as object);
  if (opId.includes("ownload")) req = req.buffer(true).parse(binaryParser as never);
  return Promise.resolve(req);
}

async function must(opId: string, status: number, o: CallOptions = {}): Promise<request.Response> {
  const res = await call(opId, o);
  if (res.status !== status) throw new Error(`${opId}: esperado ${String(status)}, obtido ${String(res.status)}: ${JSON.stringify(res.body)}`);
  return res;
}

/** Tudo o que um cenário cria (ids que nunca podem aparecer num 404). */
interface Scene {
  pro: ProfessionalFixture;
  proToken: string;
  video: OfferFixture;
  u: UserFixture;
  fam: string;
  m: string;
  /** Marcação REQUESTED (ações do profissional e da família). */
  reqBk: string;
  /** Marcação concluída e paga, com avaliação e denúncia da avaliação. */
  doneBk: string;
  reviewId: string;
  reportId: string;
  /** Marcação CONFIRMED com comprovativo recusado e disputado (fila do admin). */
  disBk: string;
  proofId: string;
}

let seq = 0;
/** Cenário completo (profissional, família, marcações, comprovativo disputado, avaliação e denúncia), tudo pela API/semeado como nos outros testes. */
async function scene(label: string, family?: { u: UserFixture; fam: string; m: string }): Promise<Scene> {
  c.h.clock.set(START);
  const n = ++seq;
  const pro = await c.professional({ name: `Dra. ${label}`, paymentInstructions: `Transferência (${label}).` });
  const proToken = await c.professionalToken(pro.professionalId);
  const video = await c.offer(pro, { method: "VIDEO", durationMinutes: 30, priceKz: 5000 });
  const u = family?.u ?? (await c.user(`idor${String(n)}`));
  const fam = family?.fam ?? (await c.family(`Família ${label}`));
  const m = family?.m ?? (await c.member(fam, { userId: u.id, role: "FAMILY_ADMIN", name: `Titular ${label}` }));
  const seed = (days: number, status: "REQUESTED" | "CONFIRMED") => c.seedBooking({ familyId: fam, memberId: m, offer: video, startsAt: at(days * DAY + 3 * HOUR), status, createdByUserId: u.id });
  const fp = { familyId: fam, memberId: m };

  const reqBk = (await seed(20, "REQUESTED")).bookingId;

  const doneBk = (await seed(1, "CONFIRMED")).bookingId;
  await c.h.pool.query("UPDATE bookings SET status = 'COMPLETED', completed_at = $2, payment_status = 'CONFIRMED' WHERE id = $1", [doneBk, START.toISOString()]);
  await must("putFamilyBookingReview", 201, { params: { ...fp, bookingId: doneBk }, token: u.token, body: { rating: 4, comment: "Boa consulta." } });
  const reviewId = (await c.h.pool.query<{ id: string }>("SELECT id FROM reviews WHERE booking_id = $1", [doneBk])).rows[0]?.id ?? "";
  const reportId = bodyOf(await must("reportReview", 201, { params: { reviewId }, token: proToken, body: { reason: "OTHER" } })).id as string;

  const disBk = (await seed(2, "CONFIRMED")).bookingId;
  const proofId = bodyOf(await must("uploadPaymentProof", 201, { params: { ...fp, bookingId: disBk }, token: u.token, file: pdf(`idor-${label}`) })).id as string;
  await c.runProofScans();
  await must("decidePaymentProof", 200, { params: { bookingId: disBk, proofId }, token: proToken, body: { decision: "REJECT", reason: "Não encontrei a transferência." } });
  await must("disputePaymentProof", 200, { params: { ...fp, bookingId: disBk, proofId }, token: u.token, body: { note: "Foi feita." } });
  return { pro, proToken, video, u, fam, m, reqBk, doneBk, reviewId, reportId, disBk, proofId };
}

interface Ctx {
  a: Scene;
  b: Scene;
  /** Profissional suspenso depois de montado. */
  s: Scene;
  admin: UserFixture;
  clinicToken: string;
  /** Utilizador sem qualquer família. */
  none: UserFixture;
  /** Family Admin de A sem relação com o membro `a.m` (tem o seu membro `faMember`). */
  fa: UserFixture;
  faMember: string;
  /** Membro comum de A (FAMILY_MEMBER) sem relação com `a.m`. */
  other: UserFixture;
  /** Dependente com conta (DEPENDENT_SELF) de A, tutelado por `a.m`, e uma marcação sua. */
  dep: UserFixture;
  depMember: string;
  depBk: string;
  /** Comprovativo existente mas nunca disputado (marcação concluída de A). */
  plainProof: string;
}
let ctx: Ctx;

beforeAll(async () => {
  c = await startConsultationsHarness();
  const a = await scene("A");
  const b = await scene("B");
  const s = await scene("S");
  await c.h.pool.query("UPDATE professionals SET validation_status = 'SUSPENDED' WHERE id = $1", [s.pro.professionalId]);
  const fa = await c.user("family-admin");
  const faMember = await c.member(a.fam, { userId: fa.id, role: "FAMILY_ADMIN", name: "Admin sem relação" });
  const other = await c.user("membro-outro");
  await c.member(a.fam, { userId: other.id, role: "FAMILY_MEMBER", name: "Membro sem relação" });
  const dep = await c.user("dependente", { birth: "2012-01-01" });
  const depMember = await c.member(a.fam, { dependent: true, userId: dep.id, guardians: [a.m], name: "Dependente com conta" });
  const depBk = (await c.seedBooking({ familyId: a.fam, memberId: depMember, offer: a.video, startsAt: at(30 * DAY), createdByUserId: a.u.id })).bookingId;
  const plain = await c.h.pool.query<{ id: string }>(
    `INSERT INTO payment_proofs (booking_id, storage_key, content_type, size_bytes, scan_status, scanned_at) VALUES ($1,'consultation-proofs/final/' || gen_random_uuid()::text || '.pdf','application/pdf',100,'CLEAN',now()) RETURNING id`,
    [a.doneBk],
  );
  ctx = { a, b, s, admin: await c.admin(), clinicToken: await c.h.clinicToken(), none: await c.user("sem-familia"), fa, faMember, other, dep, depMember, depBk, plainProof: plain.rows[0]?.id ?? "" };
}, 300_000);

afterAll(async () => {
  await c.stop();
});

/** Todos os ids dos cenários: nenhum pode aparecer em corpos de erro. */
function allIds(): string[] {
  const ids: string[] = [];
  for (const sc of [ctx.a, ctx.b, ctx.s]) ids.push(sc.fam, sc.m, sc.reqBk, sc.doneBk, sc.reviewId, sc.reportId, sc.disBk, sc.proofId, sc.pro.professionalId, sc.u.id);
  ids.push(ctx.faMember, ctx.depMember, ctx.depBk, ctx.plainProof, ctx.fa.id, ctx.dep.id, ctx.other.id, ctx.none.id);
  return ids;
}

/** Corpo de erro `application/problem+json` sem nenhum id do cenário (nem dados pessoais). */
function expectCleanProblem(res: request.Response, label: string): void {
  expect(res.headers["content-type"], label).toMatch(/application\/problem\+json/);
  const dump = JSON.stringify(res.body);
  for (const id of allIds()) expect(dump, `${label} contém ${id}`).not.toContain(id);
  expect(dump, label).not.toMatch(/@exemplo\.ao|Dra\. |Titular |Família [ABS]\b/);
}

type Kind = "member" | "booking" | "famReview" | "proof" | "proReview" | "report";
interface RouteDef {
  op: string;
  kind: Kind;
  /** GET sem efeitos: tem controlo positivo (200) para o dono. */
  read?: boolean;
  body?: object;
  file?: boolean;
}

/** Ids de caminho de um recurso de `sc` conforme o tipo da rota (família: sempre com `familyId`/`memberId` de `sc`). */
function resourceParams(sc: Scene, kind: Kind): Record<string, string> {
  switch (kind) {
    case "member":
      return {};
    case "booking":
      return { bookingId: sc.reqBk };
    case "famReview":
      return { bookingId: sc.doneBk };
    case "proof":
      return { bookingId: sc.disBk, proofId: sc.proofId };
    case "proReview":
      return { reviewId: sc.reviewId };
    case "report":
      return { reportId: sc.reportId };
  }
}

function opts(def: RouteDef, params: Record<string, string>, token: string | undefined): CallOptions {
  return { params, token, ...(def.file ? { file: pdf("idor") } : {}), ...(def.body !== undefined ? { body: def.body } : {}) };
}

// ---------------------------------------------------------------------------------------------------------------------
describe("família: matriz de atores × operações com ids no caminho (TC-AZ-MKT-17/18/24/25; authorization.md §12.1)", () => {
  const FAMILY_ROUTES: RouteDef[] = [
    { op: "listFamilyBookings", kind: "member", read: true },
    { op: "createBooking", kind: "member", body: { offerId: randomUUID(), slotId: randomUUID(), participantLabel: "Ana" } },
    { op: "getFamilyBooking", kind: "booking", read: true },
    { op: "cancelFamilyBooking", kind: "booking", body: {} },
    { op: "listFamilyPaymentProofs", kind: "booking", read: true },
    { op: "uploadPaymentProof", kind: "booking", file: true },
    { op: "downloadFamilyPaymentProof", kind: "proof", read: true },
    { op: "disputePaymentProof", kind: "proof", body: {} },
    { op: "getFamilyBookingReview", kind: "famReview", read: true },
    { op: "putFamilyBookingReview", kind: "famReview", body: { rating: 3 } },
  ];

  /** `kind: "member"` não tem recurso: os cenários de «recurso alheio» não se aplicam (a lista/criação não referem ids alheios). */
  interface Scenario {
    name: string;
    resourceOnly?: boolean;
    expected: { status: number; code: string };
    /**
     * 404 de recurso alheio: o «gémeo» inexistente é o mesmo ator no mesmo caminho com ids que não existem (`all`: família, membro e recurso;
     * `resource`: só o recurso, porque a família/membro são os do próprio ator). A comparação é entre iguais (nunca entre atores diferentes).
     */
    twin?: "all" | "resource";
    /** Quem pede, em que família/membro, e que recurso (de A, ou inexistente). */
    build(def: RouteDef): CallOptions;
  }
  const A = (): Scene => ctx.a;
  const own = (def: RouteDef, token: string | undefined, fam: string, m: string, params = resourceParams(A(), def.kind)): CallOptions => opts(def, { familyId: fam, memberId: m, ...params }, token);
  const missing = (def: RouteDef): Record<string, string> => Object.fromEntries(Object.keys(resourceParams(A(), def.kind)).map((k) => [k, randomUUID()]));

  const SCENARIOS: Scenario[] = [
    { name: "sem token", expected: { status: 401, code: "UNAUTHENTICATED" }, build: (d) => own(d, undefined, A().fam, A().m) },
    { name: "token de profissional", expected: { status: 401, code: "UNAUTHENTICATED" }, build: (d) => own(d, A().proToken, A().fam, A().m) },
    { name: "token de clínica", expected: { status: 401, code: "UNAUTHENTICATED" }, build: (d) => own(d, ctx.clinicToken, A().fam, A().m) },
    { name: "utilizador da família B nos ids de A", twin: "all", expected: { status: 404, code: "NOT_FOUND" }, build: (d) => own(d, ctx.b.u.token, A().fam, A().m) },
    { name: "utilizador sem família nos ids de A", twin: "all", expected: { status: 404, code: "NOT_FOUND" }, build: (d) => own(d, ctx.none.token, A().fam, A().m) },
    { name: "utilizador de B na sua família/membro com a marcação/comprovativo de A", twin: "resource", resourceOnly: true, expected: { status: 404, code: "NOT_FOUND" }, build: (d) => own(d, ctx.b.u.token, ctx.b.fam, ctx.b.m) },
    { name: "Family Admin sem relação (OTHER) no membro do titular", expected: { status: 403, code: "FORBIDDEN" }, build: (d) => own(d, ctx.fa.token, A().fam, A().m) },
    { name: "membro sem relação (OTHER) no membro do titular", expected: { status: 403, code: "FORBIDDEN" }, build: (d) => own(d, ctx.other.token, A().fam, A().m) },
    { name: "DEPENDENT_SELF no seu próprio membro", expected: { status: 403, code: "FORBIDDEN" }, build: (d) => own(d, ctx.dep.token, A().fam, ctx.depMember) },
    { name: "marcação do membro do titular pedida através de outro membro da mesma família", twin: "resource", resourceOnly: true, expected: { status: 404, code: "NOT_FOUND" }, build: (d) => own(d, ctx.fa.token, A().fam, ctx.faMember) },
    { name: "titular com marcação/comprovativo/avaliação inexistente", resourceOnly: true, expected: { status: 404, code: "NOT_FOUND" }, build: (d) => own(d, A().u.token, A().fam, A().m, missing(d)) },
    { name: "titular com família inexistente", expected: { status: 404, code: "NOT_FOUND" }, build: (d) => own(d, A().u.token, randomUUID(), A().m) },
    { name: "titular com membro inexistente", expected: { status: 404, code: "NOT_FOUND" }, build: (d) => own(d, A().u.token, A().fam, randomUUID()) },
  ];

  const ROWS = FAMILY_ROUTES.flatMap((def) => SCENARIOS.filter((s) => !s.resourceOnly || def.kind !== "member").map((s) => [`${def.op} — ${s.name}`, def, s] as const));

  it.each(ROWS)("%s", async (label, def, s) => {
    const res = await call(def.op, s.build(def));
    expect(res.status, `${label}: ${JSON.stringify(res.body)}`).toBe(s.expected.status);
    expect(bodyOf(res).code, label).toBe(s.expected.code);
    expectCleanProblem(res, label);
  });

  it("os 404 de recurso alheio têm corpo IDÊNTICO ao do mesmo pedido com ids inexistentes, em todas as rotas (sem oráculo de existência)", async () => {
    const randomised = (o: CallOptions, only?: string[]): CallOptions => ({ ...o, params: Object.fromEntries(Object.entries(o.params ?? {}).map(([k, v]) => [k, only === undefined || only.includes(k) ? randomUUID() : v])) });
    for (const def of FAMILY_ROUTES) {
      for (const s of SCENARIOS.filter((x) => x.twin !== undefined && (!x.resourceOnly || def.kind !== "member"))) {
        const real = s.build(def);
        const twin = s.twin === "all" ? randomised(real) : randomised(real, Object.keys(resourceParams(A(), def.kind)));
        const res = await call(def.op, real);
        const ref = await call(def.op, twin);
        expect(res.status, `${def.op} — ${s.name}`).toBe(404);
        expect(ref.status, `${def.op} — ${s.name} (gémeo)`).toBe(404);
        expect(stripTransport(res.body), `${def.op} — ${s.name}`).toEqual(stripTransport(ref.body));
      }
    }
  });

  it("os 403 também são todos idênticos entre si (Family Admin, membro sem relação, DEPENDENT_SELF): sem revelar o motivo", async () => {
    const forbidden = SCENARIOS.filter((x) => x.expected.status === 403);
    const reference = stripTransport((await call("getFamilyBooking", forbidden[0]?.build({ op: "getFamilyBooking", kind: "booking" }) ?? {})).body);
    for (const def of FAMILY_ROUTES) {
      for (const s of forbidden) expect(stripTransport((await call(def.op, s.build(def))).body), `${def.op} — ${s.name}`).toEqual(reference);
    }
  });

  it("controlos positivos: o titular (SELF) lê o seu recurso (200) e o tutor (TUTOR_OF) lê o do dependente; o DEPENDENT_SELF não lê o seu (403)", async () => {
    for (const def of FAMILY_ROUTES.filter((d) => d.read)) {
      const res = await call(def.op, own(def, ctx.a.u.token, ctx.a.fam, ctx.a.m));
      expect(res.status, def.op).toBe(200);
    }
    const tutor = await call("getFamilyBooking", { params: { familyId: ctx.a.fam, memberId: ctx.depMember, bookingId: ctx.depBk }, token: ctx.a.u.token });
    expect(tutor.status).toBe(200);
    const depSelf = await call("getFamilyBooking", { params: { familyId: ctx.a.fam, memberId: ctx.depMember, bookingId: ctx.depBk }, token: ctx.dep.token });
    expect(depSelf.status).toBe(403);
  });

  it("a listagem de B nunca contém marcações de A e vice-versa; a de um membro não mostra as de outro", async () => {
    const ids = async (token: string, fam: string, m: string): Promise<string[]> => (bodyOf(await must("listFamilyBookings", 200, { params: { familyId: fam, memberId: m }, token })).items as { id: string }[]).map((i) => i.id);
    const ofA = await ids(ctx.a.u.token, ctx.a.fam, ctx.a.m);
    const ofB = await ids(ctx.b.u.token, ctx.b.fam, ctx.b.m);
    expect(ofA).toEqual(expect.arrayContaining([ctx.a.reqBk, ctx.a.doneBk, ctx.a.disBk]));
    expect(ofA).not.toContain(ctx.depBk);
    expect(ofB).toEqual(expect.arrayContaining([ctx.b.reqBk, ctx.b.doneBk, ctx.b.disBk]));
    for (const id of ofB) expect(ofA).not.toContain(id);
  });

  it("comprovativo e avaliação só se alcançam através da sua marcação: marcação própria com comprovativo de outra marcação/família ⇒ 404 idêntico", async () => {
    const own1 = { familyId: ctx.a.fam, memberId: ctx.a.m };
    const reference = await call("downloadFamilyPaymentProof", { params: { ...own1, bookingId: ctx.a.disBk, proofId: randomUUID() }, token: ctx.a.u.token });
    expect(reference.status).toBe(404);
    for (const proofId of [ctx.plainProof, ctx.b.proofId]) {
      for (const op of ["downloadFamilyPaymentProof", "disputePaymentProof"] as const) {
        const res = await call(op, { params: { ...own1, bookingId: ctx.a.disBk, proofId }, token: ctx.a.u.token, ...(op === "disputePaymentProof" ? { body: {} } : {}) });
        expect(res.status, `${op} ${proofId}`).toBe(404);
        expect(stripTransport(res.body)).toEqual(stripTransport(reference.body));
      }
    }
    // o comprovativo da marcação de A com a marcação concluída de A (outra marcação): 404
    const crossed = await call("downloadFamilyPaymentProof", { params: { ...own1, bookingId: ctx.a.doneBk, proofId: ctx.a.proofId }, token: ctx.a.u.token });
    expect(crossed.status).toBe(404);
    expect(stripTransport(crossed.body)).toEqual(stripTransport(reference.body));
  });

  it("TC-AZ-MKT-25: forjar o bookingId de outra família numa avaliação ⇒ 404; marcação própria não concluída ⇒ 409 REVIEW_NOT_ALLOWED; DEPENDENT_SELF ⇒ 403; nada criado", async () => {
    const before = (await c.h.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM reviews")).rows[0]?.n;
    const forged = await call("putFamilyBookingReview", { params: { familyId: ctx.b.fam, memberId: ctx.b.m, bookingId: ctx.a.doneBk }, token: ctx.b.u.token, body: { rating: 1, comment: "Falsa." } });
    expect(forged.status).toBe(404);
    const notDone = await call("putFamilyBookingReview", { params: { familyId: ctx.a.fam, memberId: ctx.a.m, bookingId: ctx.a.reqBk }, token: ctx.a.u.token, body: { rating: 5 } });
    expect(notDone.status).toBe(409);
    expect(bodyOf(notDone).code).toBe("REVIEW_NOT_ALLOWED");
    const dep = await call("putFamilyBookingReview", { params: { familyId: ctx.a.fam, memberId: ctx.depMember, bookingId: ctx.depBk }, token: ctx.dep.token, body: { rating: 5 } });
    expect(dep.status).toBe(403);
    expect((await c.h.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM reviews")).rows[0]?.n).toBe(before);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("profissional: matriz de atores × operações com ids no caminho (TC-AZ-MKT-19/20/24/25; authorization.md §10.1, §12.2)", () => {
  const PRO_ROUTES: RouteDef[] = [
    { op: "getProfessionalBooking", kind: "booking", read: true },
    { op: "confirmBooking", kind: "booking", body: {} },
    { op: "rejectBooking", kind: "booking", body: { reason: "Sem vaga." } },
    { op: "cancelProfessionalBooking", kind: "booking", body: { reason: "Imprevisto." } },
    { op: "completeBooking", kind: "booking" },
    { op: "markBookingNoShow", kind: "booking" },
    { op: "downloadProfessionalPaymentProof", kind: "proof", read: true },
    { op: "decidePaymentProof", kind: "proof", body: { decision: "CONFIRM" } },
    { op: "replyToReview", kind: "proReview", body: { text: "Obrigada." } },
    { op: "reportReview", kind: "proReview", body: { reason: "OTHER" } },
  ];
  const LISTS = ["listProfessionalBookings", "listProfessionalReviewsOwn"];

  const missingFor = (def: RouteDef): Record<string, string> => Object.fromEntries(Object.keys(resourceParams(ctx.a, def.kind)).map((k) => [k, randomUUID()]));

  interface Scenario {
    name: string;
    expected: { status: number; code: string };
    token(): string | undefined;
    params(def: RouteDef): Record<string, string>;
  }
  const SCENARIOS: Scenario[] = [
    { name: "sem token", expected: { status: 401, code: "UNAUTHENTICATED" }, token: () => undefined, params: (d) => resourceParams(ctx.a, d.kind) },
    { name: "token de User (titular da família)", expected: { status: 401, code: "UNAUTHENTICATED" }, token: () => ctx.a.u.token, params: (d) => resourceParams(ctx.a, d.kind) },
    { name: "token de User administrador da plataforma", expected: { status: 401, code: "UNAUTHENTICATED" }, token: () => ctx.admin.token, params: (d) => resourceParams(ctx.a, d.kind) },
    { name: "token de clínica", expected: { status: 401, code: "UNAUTHENTICATED" }, token: () => ctx.clinicToken, params: (d) => resourceParams(ctx.a, d.kind) },
    { name: "outro profissional (P2) no recurso de P1", expected: { status: 404, code: "NOT_FOUND" }, token: () => ctx.b.proToken, params: (d) => resourceParams(ctx.a, d.kind) },
    { name: "P1 com recurso inexistente", expected: { status: 404, code: "NOT_FOUND" }, token: () => ctx.a.proToken, params: (d) => missingFor(d) },
  ];
  const ROWS = PRO_ROUTES.flatMap((def) => SCENARIOS.map((s) => [`${def.op} — ${s.name}`, def, s] as const));

  it.each(ROWS)("%s", async (label, def, s) => {
    const res = await call(def.op, opts(def, s.params(def), s.token()));
    expect(res.status, `${label}: ${JSON.stringify(res.body)}`).toBe(s.expected.status);
    expect(bodyOf(res).code, label).toBe(s.expected.code);
    expectCleanProblem(res, label);
  });

  it.each(LISTS.flatMap((op) => ["sem token", "User", "admin", "clínica"].map((who) => [`${op} — ${who}`, op, who] as const)))("%s ⇒ 401", async (_l, op, who) => {
    const token = who === "sem token" ? undefined : who === "User" ? ctx.a.u.token : who === "admin" ? ctx.admin.token : ctx.clinicToken;
    const res = await call(op, { token });
    expect(res.status).toBe(401);
  });

  it("os 404 de recurso alheio têm corpo IDÊNTICO ao de inexistente em todas as rotas do portal", async () => {
    for (const def of PRO_ROUTES) {
      const reference = await call(def.op, opts(def, missingFor(def), ctx.b.proToken));
      expect(reference.status, def.op).toBe(404);
      const alien = await call(def.op, opts(def, resourceParams(ctx.a, def.kind), ctx.b.proToken));
      expect(stripTransport(alien.body), def.op).toEqual(stripTransport(reference.body));
    }
  });

  it("o comprovativo só se alcança através da marcação do profissional: (marcação própria, comprovativo de outra marcação/profissional) ⇒ 404 idêntico", async () => {
    const reference = await call("downloadProfessionalPaymentProof", { params: { bookingId: ctx.a.disBk, proofId: randomUUID() }, token: ctx.a.proToken });
    expect(reference.status).toBe(404);
    const crossed = [
      { bookingId: ctx.a.reqBk, proofId: ctx.a.proofId }, // comprovativo da outra marcação do mesmo profissional
      { bookingId: ctx.a.disBk, proofId: ctx.plainProof }, // comprovativo de outra marcação
      { bookingId: ctx.a.disBk, proofId: ctx.b.proofId }, // comprovativo de outro profissional
      { bookingId: ctx.b.disBk, proofId: ctx.a.proofId }, // marcação de outro profissional
    ];
    for (const params of crossed) {
      const dl = await call("downloadProfessionalPaymentProof", { params, token: ctx.a.proToken });
      expect(dl.status, JSON.stringify(params)).toBe(404);
      expect(stripTransport(dl.body)).toEqual(stripTransport(reference.body));
      const decision = await call("decidePaymentProof", { params, token: ctx.a.proToken, body: { decision: "CONFIRM" } });
      expect(decision.status, JSON.stringify(params)).toBe(404);
      expect(stripTransport(decision.body)).toEqual(stripTransport(reference.body));
    }
  });

  it("controlos positivos: o profissional dono lê a marcação (200) e descarrega o comprovativo CLEAN (200); as listas só trazem o que é seu", async () => {
    expect((await call("getProfessionalBooking", { params: { bookingId: ctx.a.reqBk }, token: ctx.a.proToken })).status).toBe(200);
    expect((await call("downloadProfessionalPaymentProof", { params: { bookingId: ctx.a.disBk, proofId: ctx.a.proofId }, token: ctx.a.proToken })).status).toBe(200);
    const bookings = (bodyOf(await must("listProfessionalBookings", 200, { token: ctx.b.proToken, query: { status: "REQUESTED" } })).items as { id: string }[]).map((i) => i.id);
    expect(bookings).toContain(ctx.b.reqBk);
    expect(bookings).not.toContain(ctx.a.reqBk);
    const reviews = (bodyOf(await must("listProfessionalReviewsOwn", 200, { token: ctx.b.proToken })).items as { id: string }[]).map((i) => i.id);
    expect(reviews).toEqual([ctx.b.reviewId]);
  });

  it("não APPROVED (SUSPENDED): leitura 200; confirmar, recusar, cancelar, concluir, falta, decidir, responder e denunciar ⇒ 409 PROFESSIONAL_LOCKED sem alterar nada", async () => {
    const before = await c.h.pool.query("SELECT (SELECT status FROM bookings WHERE id = $1) AS b, (SELECT status FROM payment_proofs WHERE id = $2) AS p, (SELECT reply_text FROM reviews WHERE id = $3) AS r, (SELECT count(*)::int FROM review_reports WHERE review_id = $3) AS n", [ctx.s.reqBk, ctx.s.proofId, ctx.s.reviewId]);
    c.h.clock.set(at(30 * DAY));
    for (const def of PRO_ROUTES) {
      const res = await call(def.op, opts(def, resourceParams(ctx.s, def.kind), ctx.s.proToken));
      if (def.read) {
        expect(res.status, def.op).toBe(200);
      } else {
        expect(res.status, `${def.op}: ${JSON.stringify(res.body)}`).toBe(409);
        expect(bodyOf(res).code, def.op).toBe("PROFESSIONAL_LOCKED");
      }
    }
    c.h.clock.set(START);
    for (const op of LISTS) expect((await call(op, { token: ctx.s.proToken })).status, op).toBe(200);
    const after = await c.h.pool.query("SELECT (SELECT status FROM bookings WHERE id = $1) AS b, (SELECT status FROM payment_proofs WHERE id = $2) AS p, (SELECT reply_text FROM reviews WHERE id = $3) AS r, (SELECT count(*)::int FROM review_reports WHERE review_id = $3) AS n", [ctx.s.reqBk, ctx.s.proofId, ctx.s.reviewId]);
    expect(after.rows).toEqual(before.rows);
  });

  it("TC-AZ-MKT-25: o profissional não altera nota nem estado de uma avaliação por nenhuma rota (o contrato não tem PUT/PATCH/DELETE em /professional-portal/reviews/{id})", async () => {
    const reviewOps = [...OPS.values()].filter((op) => op.path.startsWith("/professional-portal/reviews"));
    expect(reviewOps.map((op) => `${op.method} ${op.path}`).sort()).toEqual(["get /professional-portal/reviews", "post /professional-portal/reviews/{reviewId}/reply", "post /professional-portal/reviews/{reviewId}/reports"]);
    const before = (await c.h.pool.query("SELECT rating, comment, comment_hidden_at FROM reviews WHERE id = $1", [ctx.a.reviewId])).rows;
    for (const method of ["put", "patch", "delete"] as const) {
      for (const suffix of ["", "/reply", "/reports"]) {
        const res = await request(c.h.app)[method](`${API}/professional-portal/reviews/${ctx.a.reviewId}${suffix}`).set(authOf(ctx.a.proToken)).send({ rating: 1, status: "HIDDEN", commentHidden: true });
        expect(res.status, `${method} ${suffix}`).toBeGreaterThanOrEqual(400);
        expect(res.status, `${method} ${suffix}`).toBeLessThan(500);
      }
    }
    expect((await c.h.pool.query("SELECT rating, comment, comment_hidden_at FROM reviews WHERE id = $1", [ctx.a.reviewId])).rows).toEqual(before);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("admin: atores × operações (TC-AZ-MKT-22; authorization.md §10.3, §12.3)", () => {
  const ADMIN_ROUTES: RouteDef[] = [
    { op: "adminListPaymentDisputes", kind: "member", read: true },
    { op: "adminGetPaymentDispute", kind: "proof", read: true },
    { op: "adminDownloadPaymentProof", kind: "proof", read: true },
    { op: "adminDecidePaymentDispute", kind: "proof", body: { decision: "CONFIRM_PAYMENT" } },
    { op: "adminListReviewReports", kind: "member", read: true },
    { op: "adminGetReviewReport", kind: "report", read: true },
    { op: "adminDecideReviewReport", kind: "report", body: { decision: "DISMISS" } },
  ];
  const params = (def: RouteDef): Record<string, string> => (def.kind === "proof" ? { proofId: ctx.a.proofId } : def.kind === "report" ? { reportId: ctx.a.reportId } : {});
  const ACTORS = [
    { name: "sem token", token: (): string | undefined => undefined, status: 401, code: "UNAUTHENTICATED" },
    { name: "User não administrador (titular)", token: (): string | undefined => ctx.a.u.token, status: 403, code: "FORBIDDEN" },
    { name: "User não administrador (Family Admin)", token: (): string | undefined => ctx.fa.token, status: 403, code: "FORBIDDEN" },
    { name: "token de profissional", token: (): string | undefined => ctx.a.proToken, status: 401, code: "UNAUTHENTICATED" },
    { name: "token de clínica", token: (): string | undefined => ctx.clinicToken, status: 401, code: "UNAUTHENTICATED" },
  ];
  const ROWS = ADMIN_ROUTES.flatMap((def) => ACTORS.map((a) => [`${def.op} — ${a.name}`, def, a] as const));

  it.each(ROWS)("%s", async (label, def, actor) => {
    const before = (await c.h.pool.query("SELECT (SELECT status FROM payment_proofs WHERE id = $1) AS p, (SELECT status FROM review_reports WHERE id = $2) AS r", [ctx.a.proofId, ctx.a.reportId])).rows;
    const res = await call(def.op, opts(def, params(def), actor.token()));
    expect(res.status, `${label}: ${JSON.stringify(res.body)}`).toBe(actor.status);
    expect(bodyOf(res).code, label).toBe(actor.code);
    expectCleanProblem(res, label);
    // nenhuma decisão é aplicada por quem não é admin
    expect((await c.h.pool.query("SELECT (SELECT status FROM payment_proofs WHERE id = $1) AS p, (SELECT status FROM review_reports WHERE id = $2) AS r", [ctx.a.proofId, ctx.a.reportId])).rows).toEqual(before);
  });

  it("admin com id inexistente ⇒ 404 idêntico em todas as rotas com id; controlos positivos 200 com o id real", async () => {
    for (const def of ADMIN_ROUTES.filter((d) => d.kind !== "member")) {
      const fake = Object.fromEntries(Object.keys(params(def)).map((k) => [k, randomUUID()]));
      const res = await call(def.op, opts(def, fake, ctx.admin.token));
      expect(res.status, def.op).toBe(404);
      expect(bodyOf(res).code, def.op).toBe("NOT_FOUND");
      expectCleanProblem(res, def.op);
    }
    for (const def of ADMIN_ROUTES.filter((d) => d.read)) expect((await call(def.op, opts(def, params(def), ctx.admin.token))).status, def.op).toBe(200);
  });

  it("comprovativo existente mas nunca disputado: detalhe e ficheiro ⇒ 404 (como inexistente, sem oráculo) e a decisão não o altera", async () => {
    // Interpretação do contrato (OP-114): o 409 DOCUMENT_NOT_AVAILABLE é para disputas já decididas/fora da fila (cobertas em consultations-disputes);
    // «outros ou inexistente ⇒ NOT_FOUND» para o que nunca foi disputado.
    for (const op of ["adminGetPaymentDispute", "adminDownloadPaymentProof"] as const) {
      const missingRes = await call(op, { params: { proofId: randomUUID() }, token: ctx.admin.token });
      const plain = await call(op, { params: { proofId: ctx.plainProof }, token: ctx.admin.token });
      expect(plain.status, op).toBe(404);
      expect(stripTransport(plain.body), op).toEqual(stripTransport(missingRes.body));
    }
    const before = (await c.h.pool.query("SELECT status FROM payment_proofs WHERE id = $1", [ctx.plainProof])).rows;
    const decision = await call("adminDecidePaymentDispute", { params: { proofId: ctx.plainProof }, token: ctx.admin.token, body: { decision: "UPHOLD_REJECTION" } });
    expect([404, 409]).toContain(decision.status);
    expect((await c.h.pool.query("SELECT status FROM payment_proofs WHERE id = $1", [ctx.plainProof])).rows).toEqual(before);
  });

  it("inventário: o admin só tem rotas de leitura/decisão sobre disputas e denúncias; nenhuma lê marcações, comprovativos ou avaliações fora delas nem altera preço/estado/nota/ranking", () => {
    const adminOps = [...OPS.values()].filter((op) => op.path.startsWith("/admin/") && /payment|review|booking|proof|dispute/i.test(op.path));
    expect(adminOps.map((op) => `${op.method} ${op.path}`).sort()).toEqual([
      "get /admin/payment-disputes",
      "get /admin/payment-disputes/{proofId}",
      "get /admin/payment-disputes/{proofId}/file",
      "get /admin/review-reports",
      "get /admin/review-reports/{reportId}",
      "post /admin/payment-disputes/{proofId}/decisions",
      "post /admin/review-reports/{reportId}/decisions",
    ]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("profissional não APPROVED: horários, avaliações e criação ⇒ 404 indistinguível de inexistente (TC-AZ-MKT-23; authorization.md §10.2)", () => {
  const STATUSES = ["DRAFT", "PENDING_REVIEW", "NEEDS_INFO", "REJECTED", "SUSPENDED"] as const;

  it.each(STATUSES)("%s", async (status) => {
    c.h.clock.set(START);
    const pro = await c.professional({ status: "DRAFT", name: `Dra. ${status}` });
    await c.h.pool.query("UPDATE professionals SET validation_status = $2::professional_validation_status WHERE id = $1", [pro.professionalId, status]);
    const offer = await c.offer(pro, { method: "VIDEO", durationMinutes: 30, priceKz: 5000 });
    const slotId = await c.slot(offer, at(3 * HOUR));
    const u = ctx.a.u;
    const fp = { familyId: ctx.a.fam, memberId: ctx.a.m };

    const cases: [string, CallOptions, CallOptions][] = [
      ["listBookableSlots", { params: { professionalId: pro.professionalId }, query: { offerId: offer.id }, token: u.token }, { params: { professionalId: randomUUID() }, query: { offerId: randomUUID() }, token: u.token }],
      ["listProfessionalReviews", { params: { professionalId: pro.professionalId }, token: u.token }, { params: { professionalId: randomUUID() }, token: u.token }],
      ["createBooking", { params: fp, token: u.token, body: { offerId: offer.id, slotId, participantLabel: "Ana" } }, { params: fp, token: u.token, body: { offerId: randomUUID(), slotId: randomUUID(), participantLabel: "Ana" } }],
    ];
    for (const [op, real, fake] of cases) {
      const res = await call(op, real);
      const ref = await call(op, fake);
      expect(ref.status, `${op} inexistente`).toBe(404);
      expect(res.status, `${op} ${status}: ${JSON.stringify(res.body)}`).toBe(404);
      expect(stripTransport(res.body), `${op} ${status}`).toEqual(stripTransport(ref.body));
      expectCleanProblem(res, `${op} ${status}`);
    }
    expect((await c.h.pool.query("SELECT booking_id FROM professional_slots WHERE id = $1", [slotId])).rows[0]).toEqual({ booking_id: null });
  });

  it("controlo: o mesmo pedido com o profissional APPROVED passa (200)", async () => {
    const res = await call("listBookableSlots", { params: { professionalId: ctx.a.pro.professionalId }, query: { offerId: ctx.a.video.id }, token: ctx.a.u.token });
    expect(res.status).toBe(200);
    expect((await call("listProfessionalReviews", { params: { professionalId: ctx.a.pro.professionalId }, token: ctx.a.u.token })).status).toBe(200);
  });
});

describe("tokens cruzados nas rotas públicas e de família de MK3 (TC-AZ-MKT-24)", () => {
  it("token de profissional, de clínica e sem token em /marketplace/.../{slots,reviews} e em /families/*/bookings ⇒ 401; User (também sem família) ⇒ 200 nas públicas", async () => {
    const pid = ctx.a.pro.professionalId;
    for (const token of [undefined, ctx.a.proToken, ctx.clinicToken]) {
      expect((await call("listBookableSlots", { params: { professionalId: pid }, query: { offerId: ctx.a.video.id }, token })).status).toBe(401);
      expect((await call("listProfessionalReviews", { params: { professionalId: pid }, token })).status).toBe(401);
      expect((await call("listFamilyBookings", { params: { familyId: ctx.a.fam, memberId: ctx.a.m }, token })).status).toBe(401);
    }
    expect((await call("listBookableSlots", { params: { professionalId: pid }, query: { offerId: ctx.a.video.id }, token: ctx.none.token })).status).toBe(200);
    expect((await call("listProfessionalReviews", { params: { professionalId: pid }, token: ctx.none.token })).status).toBe(200);
  });

  it("o mesmo e-mail em users e professional_accounts não dá acesso cruzado", async () => {
    const email = `dupla-${randomUUID()}@exemplo.ao`;
    const pro = await c.professional({ email });
    const user = await c.user("dupla", { email });
    const proToken = await c.professionalToken(pro.professionalId);
    expect((await call("listProfessionalBookings", { token: user.token })).status).toBe(401);
    expect((await call("listFamilyBookings", { params: { familyId: ctx.a.fam, memberId: ctx.a.m }, token: proToken })).status).toBe(401);
    expect((await call("adminListPaymentDisputes", { token: proToken })).status).toBe(401);
  });
});

describe("matriz gerada: toda operação MK3 com id de recurso no caminho está na tabela (TC-AZ-MKT-17/19)", () => {
  it("as operações de família, portal e admin com bookingId/proofId/reviewId/reportId estão cobertas por uma das tabelas acima", () => {
    const covered = new Set([
      "getFamilyBooking", "cancelFamilyBooking", "listFamilyPaymentProofs", "uploadPaymentProof", "downloadFamilyPaymentProof", "disputePaymentProof", "getFamilyBookingReview", "putFamilyBookingReview",
      "getProfessionalBooking", "confirmBooking", "rejectBooking", "cancelProfessionalBooking", "completeBooking", "markBookingNoShow", "downloadProfessionalPaymentProof", "decidePaymentProof", "replyToReview", "reportReview",
      "adminGetPaymentDispute", "adminDownloadPaymentProof", "adminDecidePaymentDispute", "adminGetReviewReport", "adminDecideReviewReport",
    ]);
    const withResourceId = [...OPS.values()].filter((op) => /\{(bookingId|proofId|reviewId|reportId)\}/.test(op.path) && !op.path.includes("message-reports") && !op.path.includes("conversations")).map((op) => op.id);
    expect(withResourceId.filter((id) => !covered.has(id))).toEqual([]);
    expect(withResourceId).toHaveLength(covered.size);
  });
});
