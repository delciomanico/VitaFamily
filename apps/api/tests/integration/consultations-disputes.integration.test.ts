// Corpos JSON de respostas HTTP lidos de forma dinâmica nos testes (`unknown` com casts explícitos).
// Integração (PostgreSQL real, app real com validação de pedidos E respostas) das DISPUTAS DE PAGAMENTO (UC-MKT-37/38; BR-MKT-57/58/63/66):
// disputa da família sobre comprovativo REJECTED (estados, autorização, validação, concorrência), fila e detalhe do admin (privacidade,
// auditoria por abertura), download do admin (cabeçalhos, auditoria, estados, limite de 60/min), decisão única do admin (CONFIRM_PAYMENT
// | UPHOLD_REJECTION, concorrência), marcação cancelada depois da disputa e vista `proof` do profissional. Ficheiros fake em memória; BD real.
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { API, START } from "../support/professionals-harness.js";
import { startConsultationsHarness, type ConsultationsHarness, type OfferFixture, type ProfessionalFixture, type UserFixture } from "../support/consultations-harness.js";

const DAY = 86_400_000;
const HOUR = 3_600_000;
/** Textos canário (BR-MKT-63): o motivo e a nota são texto livre; o rótulo do participante é dado do profissional. */
const REASON = "Transferência não encontrada no extrato.";
const REASON_CANARY = "motivo-canario-s9";
const NOTE_CANARY = "nota-canario-s9";
const LABEL_CANARY = "rotulo-canario-s9";

let c: ConsultationsHarness;
let admin: UserFixture;
let plain: UserFixture;

const bodyOf = (res: { body: unknown }): Record<string, unknown> => res.body as Record<string, unknown>;
const authOf = (token?: string): Record<string, string> => (token === undefined ? {} : { Authorization: `Bearer ${token}` });
const proofsOf = (familyId: string, memberId: string, bookingId: string): string => `${API}/families/${familyId}/members/${memberId}/bookings/${bookingId}/payment-proofs`;
const proBookings = `${API}/professional-portal/bookings`;
const adminBase = `${API}/admin/payment-disputes`;

/** Corpo binário: devolve `Buffer` (ficheiros) ou o JSON de erro, como em `consultations-proofs`. */
const binaryParser = (res: NodeJS.ReadableStream & { headers: Record<string, string | undefined> }, callback: (err: Error | null, body: unknown) => void): void => {
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

/** Conteúdo PDF válido (assinatura `%PDF-`) com uma marca para distinguir ficheiros. */
const pdf = (tag: string): Buffer => Buffer.from(`%PDF-1.4\n${tag}\n%%EOF\n`, "utf8");

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await c.h.pool.query<{ n: number }>(sql, params);
  return rows[0]?.n ?? 0;
}

async function paymentStatusOf(bookingId: string): Promise<string> {
  const { rows } = await c.h.pool.query<{ payment_status: string }>("SELECT payment_status FROM bookings WHERE id = $1", [bookingId]);
  return rows[0]?.payment_status ?? "";
}

interface DisputeDbRow {
  status: string;
  scan_status: string;
  disputed_at: Date | null;
  dispute_note: string | null;
  dispute_decision: string | null;
  dispute_decided_by: string | null;
}

async function disputeRow(proofId: string): Promise<DisputeDbRow | undefined> {
  const { rows } = await c.h.pool.query<DisputeDbRow>(
    "SELECT status, scan_status, disputed_at, dispute_note, dispute_decision, dispute_decided_by FROM payment_proofs WHERE id = $1",
    [proofId],
  );
  return rows[0];
}

async function auditCount(action: string, proofId: string): Promise<number> {
  return count("SELECT count(*)::int AS n FROM audit_logs WHERE action = $1 AND resource_id = $2", [action, proofId]);
}

/** Início único por marcação (um dia por marcação, horas distintas): nunca há sobreposições no mesmo profissional nem no mesmo membro. */
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
  const pro = await c.professional({ paymentInstructions: "Transferência para a conta de teste (disputas)." });
  return {
    pro,
    token: await c.professionalToken(pro.professionalId),
    video: await c.offer(pro, { method: "VIDEO", durationMinutes: 30, priceKz: 5000 }),
    free: await c.offer(pro, { method: "CHAT", durationMinutes: 20, priceKz: 0 }),
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
  const u = await c.user(`disputante${String(n)}`);
  const fam = await c.family(`Família S9 ${String(n)}`);
  const m = await c.member(fam, { userId: u.id, role: "FAMILY_ADMIN", name: `Disputante ${String(n)}` });
  return { u, fam, m };
}

/** Marcação gerada por SQL (sem Process) no estado pedido; o rótulo do participante é configurável (canário). */
async function booking(pt: Patient, offer: OfferFixture, status: "REQUESTED" | "CONFIRMED" = "CONFIRMED", label?: string): Promise<string> {
  const { bookingId } = await c.seedBooking({
    familyId: pt.fam,
    memberId: pt.m,
    offer,
    startsAt: nextStart(),
    status,
    createdByUserId: pt.u.id,
    ...(label !== undefined ? { label } : {}),
  });
  return bookingId;
}

/** Upload pela família (multipart campo `file`). */
function upload(pt: Patient, bookingId: string, file: Buffer) {
  return request(c.h.app)
    .post(proofsOf(pt.fam, pt.m, bookingId))
    .set(authOf(pt.u.token))
    .attach("file", file, { filename: "comprovativo.pdf", contentType: "application/pdf" });
}

/** Upload que tem de ser aceite (201) seguido do antivírus; devolve o id do comprovativo CLEAN. */
async function uploadClean(pt: Patient, bookingId: string, tag = "comprovativo"): Promise<string> {
  const res = await upload(pt, bookingId, pdf(tag));
  if (res.status !== 201) throw new Error(`upload falhou: ${String(res.status)} ${JSON.stringify(res.body)}`);
  const proofId = bodyOf(res).id as string;
  await c.runProofScans();
  return proofId;
}

function decide(w: World, bookingId: string, proofId: string, payload: object, token: string | undefined = w.token) {
  return request(c.h.app).post(`${proBookings}/${bookingId}/payment-proofs/${proofId}/decision`).set(authOf(token)).send(payload);
}

/** Disputa da família: `familyId`/`memberId` no caminho (o token pode pertencer a outro utilizador). */
function disputeAs(familyId: string, memberId: string, bookingId: string, proofId: string, token: string | undefined, payload: object = {}) {
  return request(c.h.app).post(`${proofsOf(familyId, memberId, bookingId)}/${proofId}/dispute`).set(authOf(token)).send(payload);
}

function disputeFamily(pt: Patient, bookingId: string, proofId: string, payload: object = {}) {
  return disputeAs(pt.fam, pt.m, bookingId, proofId, pt.u.token, payload);
}

/** Comprovativo REJECTED pelo profissional (upload aceite, antivírus, rejeição com motivo). */
async function rejectedProof(w: World, pt: Patient, bookingId: string, reason = REASON): Promise<string> {
  const p = await uploadClean(pt, bookingId);
  const res = await decide(w, bookingId, p, { decision: "REJECT", reason });
  if (res.status !== 200) throw new Error(`rejeição falhou: ${String(res.status)} ${JSON.stringify(res.body)}`);
  return p;
}

/** Comprovativo REJECTED e já em disputa da família. */
async function disputedProof(w: World, pt: Patient, bookingId: string, note?: string): Promise<string> {
  const p = await rejectedProof(w, pt, bookingId);
  const res = await disputeFamily(pt, bookingId, p, note === undefined ? {} : { note });
  if (res.status !== 200) throw new Error(`disputa falhou: ${String(res.status)} ${JSON.stringify(res.body)}`);
  return p;
}

function adminGet(path = "", token: string | undefined = admin.token) {
  return request(c.h.app).get(`${adminBase}${path}`).set(authOf(token));
}

function adminFile(proofId: string, token: string | undefined = admin.token) {
  return request(c.h.app).get(`${adminBase}/${proofId}/file`).set(authOf(token)).buffer(true).parse(binaryParser);
}

function adminDecide(proofId: string, decision: string, token: string | undefined = admin.token) {
  return request(c.h.app).post(`${adminBase}/${proofId}/decisions`).set(authOf(token)).send({ decision });
}

/** Percorre a fila inteira (`nextCursor` até ao fim) com o `limit` pedido. */
async function listAll(query: { status?: string } = {}, limit = 100): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 1000; i++) {
    const res = await request(c.h.app)
      .get(adminBase)
      .query({ limit, ...query, ...(cursor !== null ? { cursor } : {}) })
      .set(authOf(admin.token));
    if (res.status !== 200) throw new Error(`lista falhou: ${String(res.status)} ${JSON.stringify(res.body)}`);
    const page = bodyOf(res);
    items.push(...(page.items as Record<string, unknown>[]));
    cursor = page.nextCursor as string | null;
    if (cursor === null) return items;
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
  plain = await c.user("comum-s9");
});

afterAll(async () => {
  await c.stop();
});

beforeEach(() => {
  c.h.clock.set(START);
  c.proofQueue.splice(0);
});

describe("disputa feliz da família (UC-MKT-37)", () => {
  it("REJECTED → DISPUTED com nota; pagamento DISPUTED; auditoria só com bookingId; canários fora da auditoria", async () => {
    const w = await world();
    const pt = await patient();
    const b = await booking(pt, w.video);
    const p = await uploadClean(pt, b);
    expect((await decide(w, b, p, { decision: "REJECT", reason: REASON_CANARY })).status).toBe(200);

    const res = await disputeFamily(pt, b, p, { note: NOTE_CANARY });
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(bodyOf(res)).toMatchObject({ id: p, bookingId: b, status: "DISPUTED", disputeNote: NOTE_CANARY, decisionReason: REASON_CANARY });
    expect(typeof bodyOf(res).disputedAt).toBe("string");

    expect(await paymentStatusOf(b)).toBe("DISPUTED");
    expect((await disputeRow(p))?.status).toBe("DISPUTED");

    const audit = await c.h.pool.query<{ metadata: unknown; family_id: string; subject_member_id: string }>(
      "SELECT metadata, family_id, subject_member_id FROM audit_logs WHERE action = 'PAYMENT_PROOF_DISPUTE' AND resource_id = $1",
      [p],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({ family_id: pt.fam, subject_member_id: pt.m });
    expect(audit.rows[0]?.metadata).toEqual({ bookingId: b });

    expect(await count("SELECT count(*)::int AS n FROM audit_logs a WHERE a::text LIKE '%' || $1 || '%' OR a::text LIKE '%' || $2 || '%'", [NOTE_CANARY, REASON_CANARY])).toBe(0);
  });
});

describe("disputa inválida da família (UC-MKT-37)", () => {
  it("comprovativo SUBMITTED (não rejeitado) => 409 INVALID_STATE_TRANSITION, sem alterações", async () => {
    const w = await world();
    const pt = await patient();
    const b = await booking(pt, w.video);
    const p = await uploadClean(pt, b);

    const res = await disputeFamily(pt, b, p, {});
    expect(res.status).toBe(409);
    expect(bodyOf(res).code).toBe("INVALID_STATE_TRANSITION");
    expect((await disputeRow(p))?.status).toBe("SUBMITTED");
    expect(await paymentStatusOf(b)).toBe("PROOF_SUBMITTED");
    expect(await auditCount("PAYMENT_PROOF_DISPUTE", p)).toBe(0);
  });

  it("comprovativo CONFIRMED => 409 INVALID_STATE_TRANSITION", async () => {
    const w = await world();
    const pt = await patient();
    const b = await booking(pt, w.video);
    const p = await uploadClean(pt, b);
    expect((await decide(w, b, p, { decision: "CONFIRM" })).status).toBe(200);

    const res = await disputeFamily(pt, b, p, {});
    expect(res.status).toBe(409);
    expect(bodyOf(res).code).toBe("INVALID_STATE_TRANSITION");
    expect((await disputeRow(p))?.status).toBe("CONFIRMED");
    expect(await paymentStatusOf(b)).toBe("CONFIRMED");
  });

  it("segunda disputa do mesmo comprovativo => 409; uma única auditoria", async () => {
    const w = await world();
    const pt = await patient();
    const b = await booking(pt, w.video);
    const p = await rejectedProof(w, pt, b);
    expect((await disputeFamily(pt, b, p, {})).status).toBe(200);

    const again = await disputeFamily(pt, b, p, { note: "segunda vez" });
    expect(again.status).toBe(409);
    expect(bodyOf(again).code).toBe("INVALID_STATE_TRANSITION");
    expect(await auditCount("PAYMENT_PROOF_DISPUTE", p)).toBe(1);
    expect((await disputeRow(p))?.dispute_note).toBeNull();
  });

  it("REJECTION_UPHELD (depois do admin manter a rejeição) => 409", async () => {
    const w = await world();
    const pt = await patient();
    const b = await booking(pt, w.video);
    const p = await rejectedProof(w, pt, b);
    expect((await disputeFamily(pt, b, p, {})).status).toBe(200);
    expect((await adminDecide(p, "UPHOLD_REJECTION")).status).toBe(200);

    const res = await disputeFamily(pt, b, p, {});
    expect(res.status).toBe(409);
    expect(bodyOf(res).code).toBe("INVALID_STATE_TRANSITION");
    expect((await disputeRow(p))?.status).toBe("REJECTION_UPHELD");
    expect(await paymentStatusOf(b)).toBe("REJECTED");
  });

  it("comprovativo antigo rejeitado com um novo em curso => 409 (não se disputa o antigo)", async () => {
    const w = await world();
    const pt = await patient();
    const b = await booking(pt, w.video);
    const old = await rejectedProof(w, pt, b);
    const next = await upload(pt, b, pdf("novo-em-curso"));
    expect(next.status).toBe(201);
    expect(await paymentStatusOf(b)).toBe("PROOF_SUBMITTED");

    const res = await disputeFamily(pt, b, old, {});
    expect(res.status).toBe(409);
    expect(bodyOf(res).code).toBe("INVALID_STATE_TRANSITION");
    expect((await disputeRow(old))?.status).toBe("REJECTED");
    expect(await paymentStatusOf(b)).toBe("PROOF_SUBMITTED");
  });

  it("nota com mais de 300 caracteres => 422 VALIDATION_ERROR; o comprovativo continua REJECTED", async () => {
    const w = await world();
    const pt = await patient();
    const b = await booking(pt, w.video);
    const p = await rejectedProof(w, pt, b);

    const res = await disputeFamily(pt, b, p, { note: "x".repeat(301) });
    expect(res.status).toBe(422);
    expect(bodyOf(res).code).toBe("VALIDATION_ERROR");
    expect((await disputeRow(p))?.status).toBe("REJECTED");
    expect(await paymentStatusOf(b)).toBe("REJECTED");
  });

  it("membro de outra família => 404", async () => {
    const w = await world();
    const pt = await patient();
    const b = await booking(pt, w.video);
    const p = await rejectedProof(w, pt, b);

    const stranger = await patient();
    const res = await disputeAs(pt.fam, pt.m, b, p, stranger.u.token, {});
    expect(res.status).toBe(404);
    expect((await disputeRow(p))?.status).toBe("REJECTED");
  });

  it("membro sem relação (OTHER) => 403", async () => {
    const w = await world();
    const pt = await patient();
    const b = await booking(pt, w.video);
    const p = await rejectedProof(w, pt, b);

    const outsider = await c.user("sem-relacao-s9");
    await c.member(pt.fam, { userId: outsider.id, role: "FAMILY_MEMBER", name: "Sem relação S9" });
    const res = await disputeAs(pt.fam, pt.m, b, p, outsider.token, {});
    expect(res.status).toBe(403);
    expect((await disputeRow(p))?.status).toBe("REJECTED");
  });

  it("sem token => 401", async () => {
    const w = await world();
    const pt = await patient();
    const b = await booking(pt, w.video);
    const p = await rejectedProof(w, pt, b);

    const res = await disputeAs(pt.fam, pt.m, b, p, undefined, {});
    expect(res.status).toBe(401);
    expect((await disputeRow(p))?.status).toBe("REJECTED");
  });

  it("duas disputas concorrentes do mesmo comprovativo => exatamente um 200 e um 409", async () => {
    const w = await world();
    const pt = await patient();
    const b = await booking(pt, w.video);
    const p = await rejectedProof(w, pt, b);

    const [first, second] = await Promise.all([disputeFamily(pt, b, p, { note: "a" }), disputeFamily(pt, b, p, { note: "b" })]);
    expect([first.status, second.status].sort((x, y) => x - y)).toEqual([200, 409]);
    const loser = first.status === 409 ? first : second;
    expect(bodyOf(loser).code).toBe("INVALID_STATE_TRANSITION");
    expect((await disputeRow(p))?.status).toBe("DISPUTED");
    expect(await auditCount("PAYMENT_PROOF_DISPUTE", p)).toBe(1);
  });
});

describe("fila do admin (UC-MKT-38)", () => {
  it("omissão DISPUTED, mais antigas primeiro, paginação com limit=1 e chaves exatas do item", async () => {
    const w = await world();
    const pt = await patient();
    const b1 = await booking(pt, w.video);
    const b2 = await booking(pt, w.video);
    const p1 = await rejectedProof(w, pt, b1);
    const p2 = await rejectedProof(w, pt, b2);

    // Disputa de p1 primeiro, mas com `disputedAt` mais recente: a ordem da fila é por `disputedAt`, não por criação.
    c.h.clock.set(new Date(START.getTime() + 40 * DAY));
    expect((await disputeFamily(pt, b1, p1, {})).status).toBe(200);
    c.h.clock.set(new Date(START.getTime() + 39 * DAY));
    expect((await disputeFamily(pt, b2, p2, {})).status).toBe(200);

    const first = await adminGet("?limit=1");
    expect(first.status).toBe(200);
    expect((bodyOf(first).items as unknown[]).length).toBe(1);
    expect(typeof bodyOf(first).nextCursor).toBe("string");

    const ids = (await listAll({}, 1)).map((item) => item.proofId);
    const expected = await c.h.pool.query<{ id: string }>("SELECT id FROM payment_proofs WHERE disputed_at IS NOT NULL AND dispute_decision IS NULL ORDER BY disputed_at ASC, id ASC");
    expect(ids).toEqual(expected.rows.map((r) => r.id));
    expect(ids.indexOf(p2)).toBeLessThan(ids.indexOf(p1));

    const items = await listAll({}, 1);
    const item = items.find((i) => i.proofId === p2);
    expect(item).toMatchObject({ proofId: p2, status: "DISPUTED", specialtyName: w.pro.specialtyName, priceKz: 5000 });
    expect(item?.professional).toEqual({ id: w.pro.professionalId, displayName: "Dra. Consulta", city: "Luanda" });
    expect(Object.keys(item ?? {}).sort()).toEqual(["disputedAt", "priceKz", "professional", "proofId", "specialtyName", "startsAt", "status"]);
    for (const forbidden of ["familyId", "memberId", "userId", "storageKey", "familyNote", "professionalReason", "disputeNote"]) expect(keysOf(items)).not.toContain(forbidden);
  });

  it("status=DECIDED lista só as decididas; a omissão não as inclui", async () => {
    const w = await world();
    const pt = await patient();
    const b = await booking(pt, w.video);
    const decided = await disputedProof(w, pt, b);
    expect((await adminDecide(decided, "CONFIRM_PAYMENT")).status).toBe(200);

    const decidedItems = await listAll({ status: "DECIDED" });
    expect(decidedItems.every((i) => i.status === "DECIDED")).toBe(true);
    expect(decidedItems.map((i) => i.proofId)).toContain(decided);

    const open = await listAll();
    expect(open.every((i) => i.status === "DISPUTED")).toBe(true);
    expect(open.map((i) => i.proofId)).not.toContain(decided);
  });

  it("não-admin => 403; token de profissional => 401; sem token => 401; limit=0 e limit=101 => 400", async () => {
    const w = await world();
    expect((await adminGet("", plain.token)).status).toBe(403);
    expect((await adminGet("", w.token)).status).toBe(401);
    expect((await request(c.h.app).get(adminBase)).status).toBe(401);
    expect((await adminGet("?limit=0")).status).toBe(400);
    expect((await adminGet("?limit=101")).status).toBe(400);
  });
});

describe("detalhe do admin (UC-MKT-38; BR-MKT-63)", () => {
  it("200 com marcação e comprovativo; sem ids nem rótulo da família; auditado por abertura", async () => {
    const w = await world();
    const pt = await patient();
    const b = await booking(pt, w.video, "CONFIRMED", LABEL_CANARY);
    const p = await uploadClean(pt, b, "detalhe");
    expect((await decide(w, b, p, { decision: "REJECT", reason: REASON })).status).toBe(200);
    expect((await disputeFamily(pt, b, p, { note: NOTE_CANARY })).status).toBe(200);

    const res = await adminGet(`/${p}`);
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const body = bodyOf(res);
    expect(body).toMatchObject({
      proofId: p,
      status: "DISPUTED",
      booking: {
        professional: { id: w.pro.professionalId, displayName: "Dra. Consulta", city: "Luanda" },
        specialtyName: w.pro.specialtyName,
        method: "VIDEO",
        durationMinutes: 30,
        priceKz: 5000,
        status: "CONFIRMED",
        paymentStatus: "DISPUTED",
      },
      proof: { contentType: "application/pdf", sizeBytes: pdf("detalhe").length, scanStatus: "CLEAN" },
      professionalReason: REASON,
      familyNote: NOTE_CANARY,
    });
    expect(Object.keys(body.booking as Record<string, unknown>).sort()).toEqual(
      ["durationMinutes", "method", "paymentStatus", "priceKz", "professional", "specialtyName", "startsAt", "status"].sort(),
    );
    expect(Object.keys(body.proof as Record<string, unknown>).sort()).toEqual(["contentType", "scanStatus", "sizeBytes", "submittedAt"].sort());

    const json = JSON.stringify(body);
    for (const id of [pt.fam, pt.m, pt.u.id]) expect(json).not.toContain(id);
    expect(json).not.toContain(LABEL_CANARY);
    expect(json).not.toContain("consultation-proofs/");
    for (const key of ["familyId", "memberId", "userId", "participantLabel", "storageKey", "uploadedByUserId", "createdByUserId"]) expect(keysOf(body)).not.toContain(key);

    expect(await auditCount("ADMIN_PAYMENT_DISPUTE_VIEW", p)).toBe(1);
    expect((await adminGet(`/${p}`)).status).toBe(200);
    expect(await auditCount("ADMIN_PAYMENT_DISPUTE_VIEW", p)).toBe(2);
  });

  it("inexistente ou comprovativo nunca disputado => 404; não-admin => 403", async () => {
    const w = await world();
    const pt = await patient();
    const b = await booking(pt, w.video);
    const p = await uploadClean(pt, b);

    expect((await adminGet("/00000000-0000-4000-8000-000000000000")).status).toBe(404);
    const never = await adminGet(`/${p}`);
    expect(never.status).toBe(404);
    expect(await auditCount("ADMIN_PAYMENT_DISPUTE_VIEW", p)).toBe(0);

    expect((await adminGet(`/${p}`, plain.token)).status).toBe(403);
    expect((await adminGet(`/${p}`, w.token)).status).toBe(401);
  });
});

describe("download do admin (UC-MKT-38; BR-MKT-57)", () => {
  it("200 com no-store e attachment, corpo igual ao enviado, uma auditoria por download", async () => {
    const w = await world();
    const pt = await patient();
    const b = await booking(pt, w.video);
    const p = await disputedProof(w, pt, b);

    const res = await adminFile(p);
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(res.headers["content-disposition"]).toMatch(/^attachment/);
    expect((res.body as Buffer).equals(pdf("comprovativo"))).toBe(true);
    expect(await auditCount("ADMIN_PAYMENT_PROOF_DOWNLOAD", p)).toBe(1);

    await adminFile(p);
    expect(await auditCount("ADMIN_PAYMENT_PROOF_DOWNLOAD", p)).toBe(2);
  });

  it("comprovativo nunca disputado => 404; depois de decidida => 409 DOCUMENT_NOT_AVAILABLE; não-admin => 403", async () => {
    const w = await world();
    const pt = await patient();
    const b = await booking(pt, w.video);
    const bOther = await booking(pt, w.video);
    const never = await uploadClean(pt, b, "nunca-disputado");
    const notDisputed = await adminFile(never);
    expect(notDisputed.status).toBe(404);
    expect(await auditCount("ADMIN_PAYMENT_PROOF_DOWNLOAD", never)).toBe(0);

    const p = await disputedProof(w, pt, bOther);
    expect((await adminFile(p, plain.token)).status).toBe(403);
    expect((await adminDecide(p, "UPHOLD_REJECTION")).status).toBe(200);
    const decided = await adminFile(p);
    expect(decided.status).toBe(409);
    expect(bodyOf(decided).code).toBe("DOCUMENT_NOT_AVAILABLE");
  });
});

describe("decisão do admin (UC-MKT-38)", () => {
  it("CONFIRM_PAYMENT: 200 DECIDED, comprovativo CONFIRMED, pagamento CONFIRMED, decidido por o admin; auditoria; segunda decisão => 409; decisão inválida => 4xx", async () => {
    const w = await world();
    const pt = await patient();
    const b = await booking(pt, w.video);
    const p = await disputedProof(w, pt, b);

    const res = await adminDecide(p, "CONFIRM_PAYMENT");
    expect(res.status).toBe(200);
    expect(bodyOf(res)).toMatchObject({ proofId: p, status: "DECIDED", decision: "CONFIRM_PAYMENT" });
    expect(typeof bodyOf(res).decidedAt).toBe("string");

    const detail = await adminGet(`/${p}`);
    expect(bodyOf(detail)).toMatchObject({ status: "DECIDED", decision: "CONFIRM_PAYMENT" });

    const row = await disputeRow(p);
    expect(row).toMatchObject({ status: "CONFIRMED", dispute_decision: "CONFIRM_PAYMENT", dispute_decided_by: admin.id });
    expect(await paymentStatusOf(b)).toBe("CONFIRMED");

    const audit = await c.h.pool.query<{ metadata: unknown }>("SELECT metadata FROM audit_logs WHERE action = 'ADMIN_PAYMENT_DISPUTE_DECIDE' AND resource_id = $1", [p]);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.metadata).toEqual({ bookingId: b, decision: "CONFIRM_PAYMENT" });

    const again = await adminDecide(p, "UPHOLD_REJECTION");
    expect(again.status).toBe(409);
    expect(bodyOf(again).code).toBe("INVALID_STATE_TRANSITION");
    const againSame = await adminDecide(p, "CONFIRM_PAYMENT");
    expect(againSame.status).toBe(409);
    expect(bodyOf(againSame).code).toBe("INVALID_STATE_TRANSITION");
    expect((await disputeRow(p))?.status).toBe("CONFIRMED");

    const q = await disputedProof(w, pt, await booking(pt, w.video));
    const invalid = await adminDecide(q, "APPROVE");
    expect(invalid.status).toBeGreaterThanOrEqual(400);
    expect(invalid.status).toBeLessThan(500);
    expect((await disputeRow(q))?.status).toBe("DISPUTED");
    expect((await disputeRow(q))?.dispute_decision).toBeNull();
  });
});

describe("decisão UPHOLD_REJECTION e novo ciclo (UC-MKT-38/37)", () => {
  it("manter a rejeição: REJECTION_UPHELD, pagamento REJECTED; nova submissão 201; disputar o mesmo outra vez => 409; novo ciclo completo funciona", async () => {
    const w = await world();
    const pt = await patient();
    const b = await booking(pt, w.video);
    const p1 = await disputedProof(w, pt, b);

    const res = await adminDecide(p1, "UPHOLD_REJECTION");
    expect(res.status).toBe(200);
    expect(bodyOf(res)).toMatchObject({ status: "DECIDED", decision: "UPHOLD_REJECTION" });
    expect((await disputeRow(p1))?.status).toBe("REJECTION_UPHELD");
    expect(await paymentStatusOf(b)).toBe("REJECTED");

    const next = await upload(pt, b, pdf("nova-tentativa"));
    expect(next.status).toBe(201);
    expect(bodyOf(next).status).toBe("SUBMITTED");
    const p2 = bodyOf(next).id as string;
    expect(await paymentStatusOf(b)).toBe("PROOF_SUBMITTED");
    await c.runProofScans();

    const again = await disputeFamily(pt, b, p1, {});
    expect(again.status).toBe(409);
    expect(bodyOf(again).code).toBe("INVALID_STATE_TRANSITION");

    expect((await decide(w, b, p2, { decision: "REJECT", reason: REASON })).status).toBe(200);
    expect((await disputeFamily(pt, b, p2, { note: "segunda rodada" })).status).toBe(200);
    const decided = await adminDecide(p2, "CONFIRM_PAYMENT");
    expect(decided.status).toBe(200);
    expect((await disputeRow(p2))?.status).toBe("CONFIRMED");
    expect(await paymentStatusOf(b)).toBe("CONFIRMED");
  });
});

describe("concorrência de decisões do admin", () => {
  it("CONFIRM_PAYMENT e UPHOLD_REJECTION em paralelo => um 200 e um 409; estado final coerente", async () => {
    const w = await world();
    const pt = await patient();
    const b = await booking(pt, w.video);
    const p = await disputedProof(w, pt, b);

    const [first, second] = await Promise.all([adminDecide(p, "CONFIRM_PAYMENT"), adminDecide(p, "UPHOLD_REJECTION")]);
    expect([first.status, second.status].sort((x, y) => x - y)).toEqual([200, 409]);
    const loser = first.status === 409 ? first : second;
    expect(bodyOf(loser).code).toBe("INVALID_STATE_TRANSITION");

    const winner = first.status === 200 ? "CONFIRM_PAYMENT" : "UPHOLD_REJECTION";
    const row = await disputeRow(p);
    expect(row?.dispute_decision).toBe(winner);
    expect(row?.status).toBe(winner === "CONFIRM_PAYMENT" ? "CONFIRMED" : "REJECTION_UPHELD");
    expect(await paymentStatusOf(b)).toBe(winner === "CONFIRM_PAYMENT" ? "CONFIRMED" : "REJECTED");
    expect(await count("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'ADMIN_PAYMENT_DISPUTE_DECIDE' AND resource_id = $1", [p])).toBe(1);
  });
});

describe("marcação cancelada depois da disputa", () => {
  it("sai da fila (OP-114): lista sem ela, detalhe 404, ficheiro 409 DOCUMENT_NOT_AVAILABLE, decisão 409; o comprovativo fica DISPUTED", async () => {
    const w = await world();
    const pt = await patient();
    const b = await booking(pt, w.video);
    const p = await disputedProof(w, pt, b);

    await c.h.pool.query("UPDATE bookings SET status = 'CANCELLED', cancelled_by = 'FAMILY', cancelled_at = now(), slot_id = NULL WHERE id = $1", [b]);

    const res = await adminDecide(p, "CONFIRM_PAYMENT");
    expect(res.status).toBe(409);
    expect(bodyOf(res).code).toBe("INVALID_STATE_TRANSITION");
    expect((await disputeRow(p))?.status).toBe("DISPUTED");
    expect((await disputeRow(p))?.dispute_decision).toBeNull();

    const open = await listAll();
    expect(open.map((i) => i.proofId)).not.toContain(p);
    expect((await adminGet(`/${p}`)).status).toBe(404);
    const file = await adminFile(p);
    expect(file.status).toBe(409);
    expect(bodyOf(file).code).toBe("DOCUMENT_NOT_AVAILABLE");
    expect(await auditCount("ADMIN_PAYMENT_PROOF_DOWNLOAD", p)).toBe(0);
  });
});

describe("privacidade do profissional na disputa (BR-MKT-63)", () => {
  it("a marcação do profissional traz proof com disputeNote e disputeDecision, sem chaves proibidas", async () => {
    const w = await world();
    const pt = await patient();
    const b = await booking(pt, w.video);
    const p = await rejectedProof(w, pt, b);
    expect((await disputeFamily(pt, b, p, { note: NOTE_CANARY })).status).toBe(200);

    const before = await request(c.h.app).get(`${proBookings}/${b}`).set(authOf(w.token));
    expect(before.status).toBe(200);
    expect(bodyOf(before).proof).toMatchObject({ id: p, status: "DISPUTED", disputeNote: NOTE_CANARY, disputeDecision: null });
    expect(Object.keys(bodyOf(before).proof as Record<string, unknown>).sort()).toEqual(
      ["bookingId", "contentType", "createdAt", "decidedAt", "decisionReason", "disputeDecision", "disputeNote", "disputedAt", "id", "purged", "scanStatus", "sizeBytes", "status"].sort(),
    );

    expect((await adminDecide(p, "CONFIRM_PAYMENT")).status).toBe(200);
    const after = await request(c.h.app).get(`${proBookings}/${b}`).set(authOf(w.token));
    expect(bodyOf(after).proof).toMatchObject({ id: p, status: "CONFIRMED", disputeNote: NOTE_CANARY, disputeDecision: "CONFIRM_PAYMENT" });

    const keys = keysOf(after.body);
    for (const forbidden of ["familyId", "memberId", "userId", "uploadedBy", "uploadedByUserId", "storageKey", "createdByUserId", "decidedBy", "dispute_decided_by"]) {
      expect(keys).not.toContain(forbidden);
    }
    const json = JSON.stringify(after.body);
    for (const id of [pt.fam, pt.m, pt.u.id]) expect(json).not.toContain(id);
    expect(json).not.toContain("consultation-proofs/");
  });
});

describe("limite de downloads do admin (último: avança o relógio para esvaziar a janela)", () => {
  it("61.º download em 1 minuto => 429 RATE_LIMITED", async () => {
    const w = await world();
    const pt = await patient();
    const b = await booking(pt, w.video);
    c.h.clock.set(new Date(START.getTime() + HOUR));
    const p = await disputedProof(w, pt, b);

    for (let i = 0; i < 60; i++) {
      const res = await adminFile(p);
      if (res.status !== 200) throw new Error(`download ${String(i + 1)} falhou: ${String(res.status)}`);
    }
    const limited = await adminFile(p);
    expect(limited.status).toBe(429);
    expect(bodyOf(limited).code).toBe("RATE_LIMITED");
  });
});
