// Corpos JSON de respostas HTTP lidos de forma dinâmica nos testes (`unknown` com casts explícitos).
// Integração (PostgreSQL real, app real com validação de pedidos E respostas) dos COMPROVATIVOS DE PAGAMENTO (UC-MKT-35/36; BR-MKT-56..58, 63, 66):
// upload da família (tipo por conteúdo, estados, limites, autorização, limite de pedidos), antivírus (CLEAN e INFECTED), decisão do profissional
// (CONFIRM/REJECT, concorrência), downloads (cabeçalhos, auditoria, leitura em todos os estados, limite de 60/min), vista `proof` da marcação
// do profissional e cascata/trigger para a outbox de ficheiros. Os ficheiros são fakes em memória; a BD é real.
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createProofUploadGuard } from "../../src/modules/consultations/index.js";
import { API, INFECTED_MARKER, START } from "../support/professionals-harness.js";
import { startConsultationsHarness, type ConsultationsHarness, type OfferFixture, type ProfessionalFixture, type UserFixture } from "../support/consultations-harness.js";

const DAY = 86_400_000;
const HOUR = 3_600_000;
/** Nome de ficheiro canário (BR-MKT-63): nunca em auditoria, corpos de resposta nem erros. */
const CANARY_FILE = "canario-ficheiro.pdf";
const REASON = "Transferência não encontrada no extrato.";

let c: ConsultationsHarness;

const bodyOf = (res: { body: unknown }): Record<string, unknown> => res.body as Record<string, unknown>;
const authOf = (token?: string): Record<string, string> => (token === undefined ? {} : { Authorization: `Bearer ${token}` });
const proofsOf = (familyId: string, memberId: string, bookingId: string): string => `${API}/families/${familyId}/members/${memberId}/bookings/${bookingId}/payment-proofs`;
const proBookings = `${API}/professional-portal/bookings`;
const finalKeyOf = (proofId: string): string => `consultation-proofs/final/${proofId}.pdf`;
const quarantineKeyOf = (proofId: string): string => `consultation-proofs/quarantine/${proofId}.pdf`;

/** Corpo binário: devolve `Buffer` (ficheiros) ou o JSON de erro, como em `professionals-credentials`. */
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

/** Conteúdo PDF válido (assinatura `%PDF-`) com uma marca para distinguir ficheiros nos downloads. */
const pdf = (tag: string): Buffer => Buffer.from(`%PDF-1.4\n${tag}\n%%EOF\n`, "utf8");
/** Conteúdo PNG válido (assinatura de 8 bytes) mais lixo. */
const png = (): Buffer => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("lixo-png")]);

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await c.h.pool.query<{ n: number }>(sql, params);
  return rows[0]?.n ?? 0;
}

async function paymentStatusOf(bookingId: string): Promise<string> {
  const { rows } = await c.h.pool.query<{ payment_status: string }>("SELECT payment_status FROM bookings WHERE id = $1", [bookingId]);
  return rows[0]?.payment_status ?? "";
}

interface ProofRow {
  status: string;
  scan_status: string;
  storage_key: string;
  decision_reason: string | null;
}

async function proofRow(proofId: string): Promise<ProofRow | undefined> {
  const { rows } = await c.h.pool.query<ProofRow>("SELECT status, scan_status, storage_key, decision_reason FROM payment_proofs WHERE id = $1", [proofId]);
  return rows[0];
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
  const pro = await c.professional({ paymentInstructions: "Transferência para a conta de teste (proofs)." });
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
  const u = await c.user(`pagador${String(n)}`);
  const fam = await c.family(`Família S8 ${String(n)}`);
  const m = await c.member(fam, { userId: u.id, role: "FAMILY_ADMIN", name: `Pagador ${String(n)}` });
  return { u, fam, m };
}

/** Marcação gerada por SQL (sem Process) no estado pedido; o pagamento fica como o serviço o deixaria. */
async function booking(pt: Patient, offer: OfferFixture, status: "REQUESTED" | "CONFIRMED" = "CONFIRMED"): Promise<string> {
  const { bookingId } = await c.seedBooking({ familyId: pt.fam, memberId: pt.m, offer, startsAt: nextStart(), status, createdByUserId: pt.u.id });
  return bookingId;
}

/** Upload pela família (multipart campo `file`). */
function upload(pt: Patient, bookingId: string, file: Buffer, extra: { filename?: string; contentType?: string } = {}) {
  return request(c.h.app)
    .post(proofsOf(pt.fam, pt.m, bookingId))
    .set(authOf(pt.u.token))
    .attach("file", file, { filename: extra.filename ?? "comprovativo.pdf", contentType: extra.contentType ?? "application/pdf" });
}

/** Upload que tem de ser aceite (201) seguido do antivírus; devolve o id do comprovativo CLEAN. */
async function uploadClean(pt: Patient, bookingId: string, tag = "comprovativo"): Promise<string> {
  const res = await upload(pt, bookingId, pdf(tag));
  if (res.status !== 201) throw new Error(`upload falhou: ${String(res.status)} ${JSON.stringify(res.body)}`);
  const proofId = bodyOf(res).id as string;
  await c.runProofScans();
  return proofId;
}

function familyFile(pt: Patient, bookingId: string, proofId: string, token: string | undefined = pt.u.token) {
  return request(c.h.app).get(`${proofsOf(pt.fam, pt.m, bookingId)}/${proofId}/file`).set(authOf(token)).buffer(true).parse(binaryParser);
}

function proFile(w: World, bookingId: string, proofId: string, token: string | undefined = w.token) {
  return request(c.h.app).get(`${proBookings}/${bookingId}/payment-proofs/${proofId}/file`).set(authOf(token)).buffer(true).parse(binaryParser);
}

function decide(w: World, bookingId: string, proofId: string, payload: object, token: string | undefined = w.token) {
  return request(c.h.app).post(`${proBookings}/${bookingId}/payment-proofs/${proofId}/decision`).set(authOf(token)).send(payload);
}

/** Todas as chaves de um JSON (em profundidade), para varrer ids proibidos. */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((item: unknown) => keysOf(item));
  if (value && typeof value === "object") return Object.entries(value as Record<string, unknown>).flatMap(([key, inner]) => [key, ...keysOf(inner)]);
  return [];
}

beforeAll(async () => {
  c = await startConsultationsHarness();
});

afterAll(async () => {
  await c.stop();
});

beforeEach(() => {
  c.h.clock.set(START);
  c.proofQueue.splice(0);
});

describe("upload da família (UC-MKT-35)", () => {
  it("upload feliz: 201 sem storageKey, PROOF_SUBMITTED, auditoria sem nome de ficheiro, antivírus CLEAN e quarentena apagada", async () => {
    const w = await world();
    const pt = await patient();
    const b = await booking(pt, w.video);
    const before = c.h.storage.objects.size;

    const res = await upload(pt, b, pdf("feliz"), { filename: CANARY_FILE });
    expect(res.status).toBe(201);
    const body = bodyOf(res);
    const proofId = body.id as string;
    expect(body).toMatchObject({ bookingId: b, status: "SUBMITTED", scanStatus: "PENDING", contentType: "application/pdf" });
    expect(body).not.toHaveProperty("storageKey");
    expect(JSON.stringify(body)).not.toContain(CANARY_FILE);
    expect(await paymentStatusOf(b)).toBe("PROOF_SUBMITTED");

    const audit = await c.h.pool.query<{ action: string; resource_id: string; family_id: string; subject_member_id: string; metadata: unknown }>(
      "SELECT action, resource_id, family_id, subject_member_id, metadata FROM audit_logs WHERE action = 'PAYMENT_PROOF_UPLOAD' AND resource_id = $1",
      [body.id],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({ family_id: pt.fam, subject_member_id: pt.m, metadata: { bookingId: b } });
    expect(await count("SELECT count(*)::int AS n FROM audit_logs WHERE metadata::text LIKE '%' || $1 || '%' OR action::text LIKE '%' || $1 || '%'", [CANARY_FILE])).toBe(0);

    expect(c.proofQueue).toEqual([{ proofId: proofId }]);
    // Antes do antivírus o objeto está só em quarentena.
    expect(c.h.storage.objects.has(quarantineKeyOf(proofId))).toBe(true);

    await c.runProofScans();
    const row = await proofRow(proofId);
    expect(row).toMatchObject({ scan_status: "CLEAN", storage_key: finalKeyOf(proofId), status: "SUBMITTED" });
    expect(c.h.storage.objects.has(finalKeyOf(proofId))).toBe(true);
    expect(c.h.storage.objects.get(finalKeyOf(proofId))?.body.equals(pdf("feliz"))).toBe(true);

    await c.runDeleteFiles();
    expect(c.h.storage.objects.has(quarantineKeyOf(proofId))).toBe(false);
    expect(c.h.storage.objects.has(finalKeyOf(proofId))).toBe(true);
    expect(await count("SELECT count(*)::int AS n FROM consultation_file_deletions WHERE storage_key = $1 AND deleted_at IS NOT NULL", [quarantineKeyOf(proofId)])).toBe(1);
    expect(c.h.storage.objects.size).toBe(before + 1);
  });
});

describe("tipo e tamanho por conteúdo", () => {
  it("texto com nome .pdf, ficheiro vazio e acima de 10 MB são rejeitados sem linha nem objeto", async () => {
    const w = await world();
    const pt = await patient();
    const b = await booking(pt, w.video);
    const before = c.h.storage.objects.size;

    const text = await upload(pt, b, Buffer.from("isto é texto simples, não é um PDF"), { filename: "falso.pdf", contentType: "application/pdf" });
    expect(text.status).toBe(415);
    expect(bodyOf(text).code).toBe("FILE_TYPE_NOT_ALLOWED");

    const empty = await upload(pt, b, Buffer.alloc(0));
    expect(empty.status).toBe(415);
    expect(bodyOf(empty).code).toBe("FILE_TYPE_NOT_ALLOWED");

    const big = Buffer.alloc(10 * 1024 * 1024 + 1, 0x20);
    big.write("%PDF-", 0, "latin1");
    const huge = await upload(pt, b, big);
    expect(huge.status).toBe(413);
    expect(bodyOf(huge).code).toBe("FILE_TOO_LARGE");

    expect(await count("SELECT count(*)::int AS n FROM payment_proofs WHERE booking_id = $1", [b])).toBe(0);
    expect(c.h.storage.objects.size).toBe(before);
    expect(c.proofQueue).toHaveLength(0);
    expect(await paymentStatusOf(b)).toBe("AWAITING_PROOF");
  });

  it("PNG válido por assinatura é aceite (201) com contentType image/png", async () => {
    const w = await world();
    const pt = await patient();
    const b = await booking(pt, w.video);
    const res = await upload(pt, b, png(), { filename: "foto.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(201);
    expect(bodyOf(res).contentType).toBe("image/png");
  });
});

describe("estados e limites", () => {
  it("marcação REQUESTED, preço 0 e CANCELLED não aceitam comprovativo: 409 INVALID_STATE_TRANSITION", async () => {
    const w = await world();
    const pt = await patient();

    const requested = await booking(pt, w.video, "REQUESTED");
    const r1 = await upload(pt, requested, pdf("pedido"));
    expect(r1.status).toBe(409);
    expect(bodyOf(r1).code).toBe("INVALID_STATE_TRANSITION");

    const free = await booking(pt, w.free);
    expect(await paymentStatusOf(free)).toBe("NOT_REQUIRED");
    const r2 = await upload(pt, free, pdf("gratis"));
    expect(r2.status).toBe(409);
    expect(bodyOf(r2).code).toBe("INVALID_STATE_TRANSITION");

    const cancelled = await booking(pt, w.video);
    await c.h.pool.query("UPDATE bookings SET status = 'CANCELLED', cancelled_by = 'FAMILY', cancelled_at = now(), slot_id = NULL WHERE id = $1", [cancelled]);
    const r3 = await upload(pt, cancelled, pdf("cancelada"));
    expect(r3.status).toBe(409);
    expect(bodyOf(r3).code).toBe("INVALID_STATE_TRANSITION");

    expect(await count("SELECT count(*)::int AS n FROM payment_proofs WHERE booking_id = ANY($1::uuid[])", [[requested, free, cancelled]])).toBe(0);
  });

  it("segundo upload com o primeiro em curso => 409 CONFLICT", async () => {
    const w = await world();
    const pt = await patient();
    const b = await booking(pt, w.video);
    const first = await upload(pt, b, pdf("primeiro"));
    expect(first.status).toBe(201);
    const second = await upload(pt, b, pdf("segundo"));
    expect(second.status).toBe(409);
    expect(bodyOf(second).code).toBe("CONFLICT");
    expect(await count("SELECT count(*)::int AS n FROM payment_proofs WHERE booking_id = $1", [b])).toBe(1);
  });

  it("sexto comprovativo (cinco terminais já existentes) => 409 LIMIT_EXCEEDED", async () => {
    const w = await world();
    const pt = await patient();
    const b = await booking(pt, w.video);
    // Cinco comprovativos terminais (REJECTION_UPHELD cumpre os CHECK da migração 0045), sem nenhum em curso.
    await c.h.pool.query(
      `INSERT INTO payment_proofs (booking_id, storage_key, content_type, size_bytes, scan_status, scanned_at, status, decided_at, decision_reason,
         disputed_at, dispute_decision, dispute_decided_at)
       SELECT $1, 'consultation-proofs/final/' || gen_random_uuid()::text || '.pdf', 'application/pdf', 100, 'CLEAN', now(), 'REJECTION_UPHELD',
         now(), 'Motivo da recusa.', now(), 'UPHOLD_REJECTION', now()
       FROM generate_series(1, 5)`,
      [b],
    );
    await c.h.pool.query("UPDATE bookings SET payment_status = 'REJECTED' WHERE id = $1", [b]);

    const res = await upload(pt, b, pdf("sexto"));
    expect(res.status).toBe(409);
    expect(bodyOf(res).code).toBe("LIMIT_EXCEEDED");
    expect(await count("SELECT count(*)::int AS n FROM payment_proofs WHERE booking_id = $1", [b])).toBe(5);
    expect(await paymentStatusOf(b)).toBe("REJECTED");
  });

  it("autorização: outra família => 404; membro OTHER sem relação => 403; sem token => 401", async () => {
    const w = await world();
    const pt = await patient();
    const b = await booking(pt, w.video);

    const stranger = await patient();
    const otherFamily = await upload({ ...pt, u: stranger.u }, b, pdf("alheio"));
    expect(otherFamily.status).toBe(404);

    const outsider = await c.user("sem-relacao");
    await c.member(pt.fam, { userId: outsider.id, role: "FAMILY_MEMBER", name: "Sem relação" });
    const other = await request(c.h.app)
      .post(proofsOf(pt.fam, pt.m, b))
      .set(authOf(outsider.token))
      .attach("file", pdf("outro-membro"), { filename: "comprovativo.pdf", contentType: "application/pdf" });
    expect(other.status).toBe(403);

    const anon = await request(c.h.app).post(proofsOf(pt.fam, pt.m, b)).attach("file", pdf("anonimo"), { filename: "comprovativo.pdf", contentType: "application/pdf" });
    expect(anon.status).toBe(401);

    expect(await count("SELECT count(*)::int AS n FROM payment_proofs WHERE booking_id = $1", [b])).toBe(0);
  });
});

describe("antivírus", () => {
  it("ficheiro INFECTED: a linha desaparece, o pagamento volta a AWAITING_PROOF, a quarentena entra na outbox, o download é 404 e um upload limpo é aceite", async () => {
    const w = await world();
    const pt = await patient();
    const b = await booking(pt, w.video);

    const res = await upload(pt, b, pdf(`conteúdo ${INFECTED_MARKER}`));
    expect(res.status).toBe(201);
    const id = bodyOf(res).id as string;

    await c.runProofScans();
    expect(await proofRow(id)).toBeUndefined();
    expect(await paymentStatusOf(b)).toBe("AWAITING_PROOF");
    expect(await count("SELECT count(*)::int AS n FROM consultation_file_deletions WHERE storage_key = $1", [quarantineKeyOf(id)])).toBe(1);
    expect(c.h.storage.objects.has(quarantineKeyOf(id))).toBe(true);

    const download = await familyFile(pt, b, id);
    expect(download.status).toBe(404);

    const clean = await upload(pt, b, pdf("limpo"));
    expect(clean.status).toBe(201);
    expect(await paymentStatusOf(b)).toBe("PROOF_SUBMITTED");
  });
});

describe("limite de pedidos", () => {
  it("21 uploads rápidos do mesmo utilizador: o 21.º devolve 429 RATE_LIMITED", async () => {
    const w = await world();
    const pt = await patient();
    const b = await booking(pt, w.video);

    const results: { status: number; body: unknown }[] = [];
    for (let i = 0; i < 21; i++) results.push(await upload(pt, b, pdf(`rapido-${String(i)}`)));

    expect(results[0]?.status).toBe(201);
    for (const res of results.slice(1, 20)) expect(res.status).toBe(409);
    expect(results[20]?.status).toBe(429);
    expect(bodyOf(results[20] ?? { body: undefined }).code).toBe("RATE_LIMITED");
  });
});

describe("decisão do profissional (UC-MKT-36)", () => {
  it("antes do antivírus (PENDING) => 409 DOCUMENT_NOT_AVAILABLE e nada muda", async () => {
    const w = await world();
    const pt = await patient();
    const b = await booking(pt, w.video);
    const res = await upload(pt, b, pdf("pendente"));
    const p = bodyOf(res).id as string;

    const decided = await decide(w, b, p, { decision: "CONFIRM" });
    expect(decided.status).toBe(409);
    expect(bodyOf(decided).code).toBe("DOCUMENT_NOT_AVAILABLE");
    expect((await proofRow(p))?.status).toBe("SUBMITTED");
    expect(await paymentStatusOf(b)).toBe("PROOF_SUBMITTED");
  });

  it("CONFIRM depois do antivírus => 200 CONFIRMED, pagamento CONFIRMED, auditoria; segunda decisão => 409 INVALID_STATE_TRANSITION", async () => {
    const w = await world();
    const pt = await patient();
    const b = await booking(pt, w.video);
    const p = await uploadClean(pt, b);

    const res = await decide(w, b, p, { decision: "CONFIRM" });
    expect(res.status).toBe(200);
    expect(bodyOf(res)).toMatchObject({ id: p, status: "CONFIRMED", scanStatus: "CLEAN" });
    expect(await paymentStatusOf(b)).toBe("CONFIRMED");

    const audit = await c.h.pool.query<{ metadata: { decision: string; bookingId: string } }>(
      "SELECT metadata FROM audit_logs WHERE action = 'PROFESSIONAL_PAYMENT_PROOF_DECIDE' AND resource_id = $1",
      [p],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.metadata).toMatchObject({ decision: "CONFIRM", bookingId: b });

    const again = await decide(w, b, p, { decision: "REJECT", reason: REASON });
    expect(again.status).toBe(409);
    expect(bodyOf(again).code).toBe("INVALID_STATE_TRANSITION");
    expect((await proofRow(p))?.status).toBe("CONFIRMED");
  });

  it("REJECT sem motivo => 422 e o comprovativo continua SUBMITTED", async () => {
    const w = await world();
    const pt = await patient();
    const b = await booking(pt, w.video);
    const p = await uploadClean(pt, b);

    const missing = await decide(w, b, p, { decision: "REJECT" });
    expect(missing.status).toBe(422);
    expect(bodyOf(missing).code).toBe("VALIDATION_ERROR");
    expect((await proofRow(p))?.status).toBe("SUBMITTED");
    expect(await paymentStatusOf(b)).toBe("PROOF_SUBMITTED");
  });

  it("REJECT com motivo => REJECTED, motivo visível na lista da família; novo upload => 201 e PROOF_SUBMITTED", async () => {
    const w = await world();
    const pt = await patient();
    const b = await booking(pt, w.video);
    const p = await uploadClean(pt, b);

    const res = await decide(w, b, p, { decision: "REJECT", reason: REASON });
    expect(res.status).toBe(200);
    expect(bodyOf(res)).toMatchObject({ id: p, status: "REJECTED", decisionReason: REASON });
    expect(await paymentStatusOf(b)).toBe("REJECTED");

    const list = await request(c.h.app).get(proofsOf(pt.fam, pt.m, b)).set(authOf(pt.u.token));
    expect(list.status).toBe(200);
    const items = list.body as Record<string, unknown>[];
    expect(items.find((item) => item.id === p)).toMatchObject({ status: "REJECTED", decisionReason: REASON });

    const next = await upload(pt, b, pdf("segunda-tentativa"));
    expect(next.status).toBe(201);
    expect(await paymentStatusOf(b)).toBe("PROOF_SUBMITTED");
  });

  it("profissional de outra conta => 404 (não 403)", async () => {
    const w = await world();
    const pt = await patient();
    const b = await booking(pt, w.video);
    const p = await uploadClean(pt, b);

    const intruder = await world();
    const res = await decide(intruder, b, p, { decision: "CONFIRM" });
    expect(res.status).toBe(404);
    expect((await proofRow(p))?.status).toBe("SUBMITTED");
  });

  it("profissional SUSPENDED => 409 PROFESSIONAL_LOCKED", async () => {
    const w = await world();
    const pt = await patient();
    const b = await booking(pt, w.video);
    const p = await uploadClean(pt, b);

    await c.h.pool.query("UPDATE professionals SET validation_status = 'SUSPENDED' WHERE id = $1", [w.pro.professionalId]);
    const res = await decide(w, b, p, { decision: "CONFIRM" });
    expect(res.status).toBe(409);
    expect(bodyOf(res).code).toBe("PROFESSIONAL_LOCKED");
    expect((await proofRow(p))?.status).toBe("SUBMITTED");
  });

  it("duas decisões concorrentes: exatamente um 200 e um 409 INVALID_STATE_TRANSITION, estado final coerente", async () => {
    const w = await world();
    const pt = await patient();
    const b = await booking(pt, w.video);
    const p = await uploadClean(pt, b);

    const [confirm, reject] = await Promise.all([decide(w, b, p, { decision: "CONFIRM" }), decide(w, b, p, { decision: "REJECT", reason: REASON })]);
    const statuses = [confirm.status, reject.status].sort((x, y) => x - y);
    expect(statuses).toEqual([200, 409]);
    const loser = confirm.status === 409 ? confirm : reject;
    expect(bodyOf(loser).code).toBe("INVALID_STATE_TRANSITION");

    const winner = confirm.status === 200 ? "CONFIRMED" : "REJECTED";
    expect((await proofRow(p))?.status).toBe(winner);
    expect(await paymentStatusOf(b)).toBe(winner);
    // Coerência: só existe uma decisão auditada.
    expect(await count("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'PROFESSIONAL_PAYMENT_PROOF_DECIDE' AND resource_id = $1", [p])).toBe(1);
  });
});

describe("downloads", () => {
  it("família e profissional descarregam com cabeçalhos, corpo igual ao enviado e uma auditoria por download", async () => {
    const w = await world();
    const pt = await patient();
    const b = await booking(pt, w.video);
    const sent = pdf("descarga");
    const res = await upload(pt, b, sent);
    const p = bodyOf(res).id as string;
    await c.runProofScans();

    const family = await familyFile(pt, b, p);
    expect(family.status).toBe(200);
    expect(family.headers["cache-control"]).toBe("private, no-store");
    expect(family.headers["content-type"]).toContain("application/pdf");
    expect(family.headers["content-disposition"]).toMatch(/^attachment/);
    expect((family.body as Buffer).equals(sent)).toBe(true);

    const professional = await proFile(w, b, p);
    expect(professional.status).toBe(200);
    expect(professional.headers["cache-control"]).toBe("private, no-store");
    expect(professional.headers["content-type"]).toContain("application/pdf");
    expect(professional.headers["content-disposition"]).toMatch(/^attachment/);
    expect((professional.body as Buffer).equals(sent)).toBe(true);

    expect(await count("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'PAYMENT_PROOF_DOWNLOAD' AND resource_id = $1", [p])).toBe(1);
    expect(await count("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'PROFESSIONAL_PAYMENT_PROOF_DOWNLOAD' AND resource_id = $1", [p])).toBe(1);

    await familyFile(pt, b, p);
    expect(await count("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'PAYMENT_PROOF_DOWNLOAD' AND resource_id = $1", [p])).toBe(2);
  });

  it("outra família => 404; outro profissional => 404", async () => {
    const w = await world();
    const pt = await patient();
    const b = await booking(pt, w.video);
    const p = await uploadClean(pt, b);

    const stranger = await patient();
    expect((await familyFile(pt, b, p, stranger.u.token)).status).toBe(404);

    const intruder = await world();
    expect((await proFile(intruder, b, p)).status).toBe(404);
  });

  it("PENDING => 409 DOCUMENT_NOT_AVAILABLE (família e profissional)", async () => {
    const w = await world();
    const pt = await patient();
    const b = await booking(pt, w.video);
    const p = bodyOf(await upload(pt, b, pdf("pendente-download"))).id as string;

    const family = await familyFile(pt, b, p);
    expect(family.status).toBe(409);
    expect(bodyOf(family).code).toBe("DOCUMENT_NOT_AVAILABLE");

    const professional = await proFile(w, b, p);
    expect(professional.status).toBe(409);
    expect(bodyOf(professional).code).toBe("DOCUMENT_NOT_AVAILABLE");
  });

  it("profissional SUSPENDED continua a poder descarregar (leitura em todos os estados)", async () => {
    const w = await world();
    const pt = await patient();
    const b = await booking(pt, w.video);
    const p = await uploadClean(pt, b);

    await c.h.pool.query("UPDATE professionals SET validation_status = 'SUSPENDED' WHERE id = $1", [w.pro.professionalId]);
    const res = await proFile(w, b, p);
    expect(res.status).toBe(200);
    expect((res.body as Buffer).equals(pdf("comprovativo"))).toBe(true);
  });

  it("61.º download em 1 minuto => 429 RATE_LIMITED", async () => {
    const w = await world();
    const pt = await patient();
    const b = await booking(pt, w.video);
    const p = await uploadClean(pt, b);

    for (let i = 0; i < 60; i++) {
      const res = await familyFile(pt, b, p);
      if (res.status !== 200) throw new Error(`download ${String(i + 1)} falhou: ${String(res.status)}`);
    }
    const limited = await familyFile(pt, b, p);
    expect(limited.status).toBe(429);
    expect(bodyOf(limited).code).toBe("RATE_LIMITED");
  });
});

describe("vista da marcação do profissional (ProfessionalBooking.proof)", () => {
  it("sem comprovativo não tem a chave proof; depois tem status/scanStatus, sem ids de família, membro ou utilizador", async () => {
    const w = await world();
    const pt = await patient();
    const b = await booking(pt, w.video);

    const before = await request(c.h.app).get(`${proBookings}/${b}`).set(authOf(w.token));
    expect(before.status).toBe(200);
    expect(bodyOf(before)).not.toHaveProperty("proof");

    const p = bodyOf(await upload(pt, b, pdf("vista"))).id as string;
    const pending = await request(c.h.app).get(`${proBookings}/${b}`).set(authOf(w.token));
    expect(bodyOf(pending).proof).toMatchObject({ id: p, status: "SUBMITTED", scanStatus: "PENDING" });

    await c.runProofScans();
    const clean = await request(c.h.app).get(`${proBookings}/${b}`).set(authOf(w.token));
    expect(clean.status).toBe(200);
    expect(bodyOf(clean).proof).toMatchObject({ id: p, status: "SUBMITTED", scanStatus: "CLEAN" });

    const keys = keysOf(clean.body);
    for (const forbidden of ["familyId", "memberId", "userId", "uploadedBy", "storageKey"]) expect(keys).not.toContain(forbidden);
    expect(JSON.stringify(clean.body)).not.toContain("consultation-proofs/");
  });
});

describe("cascata e outbox de ficheiros", () => {
  it("apagar a marcação por SQL: o trigger enfileira a chave final e runDeleteFiles remove o objeto", async () => {
    const w = await world();
    const pt = await patient();
    const b = await booking(pt, w.video);
    const p = await uploadClean(pt, b);
    const finalKey = finalKeyOf(p);
    expect(c.h.storage.objects.has(finalKey)).toBe(true);

    await c.h.pool.query("DELETE FROM bookings WHERE id = $1", [b]);
    expect(await count("SELECT count(*)::int AS n FROM payment_proofs WHERE id = $1", [p])).toBe(0);
    expect(await count("SELECT count(*)::int AS n FROM consultation_file_deletions WHERE storage_key = $1 AND deleted_at IS NULL", [finalKey])).toBe(1);

    await c.runDeleteFiles();
    expect(c.h.storage.objects.has(finalKey)).toBe(false);
    expect(await count("SELECT count(*)::int AS n FROM consultation_file_deletions WHERE storage_key = $1 AND deleted_at IS NOT NULL", [finalKey])).toBe(1);
  });

  it("apagar o membro por SQL: a cascata da marcação e do comprovativo enfileira a chave final", async () => {
    const w = await world();
    const pt = await patient();
    const b = await booking(pt, w.video);
    const p = await uploadClean(pt, b);
    const finalKey = finalKeyOf(p);

    await c.h.pool.query("DELETE FROM family_members WHERE id = $1", [pt.m]);
    expect(await count("SELECT count(*)::int AS n FROM bookings WHERE id = $1", [b])).toBe(0);
    expect(await count("SELECT count(*)::int AS n FROM consultation_file_deletions WHERE storage_key = $1 AND deleted_at IS NULL", [finalKey])).toBe(1);

    await c.runDeleteFiles();
    expect(c.h.storage.objects.has(finalKey)).toBe(false);
  });
});

describe("guarda de Content-Length (antes do parse multipart)", () => {
  const front = (): express.Express => express().use(createProofUploadGuard({ maxFileBytes: 10 * 1024 * 1024 })).use(c.h.app);

  it("acima do teto ⇒ 413 FILE_TOO_LARGE sem criar nada; normal passa; sem token continua 401", async () => {
    const w = await world();
    const pt = await patient();
    const b = await booking(pt, w.video);
    const url = proofsOf(pt.fam, pt.m, b);
    const before = c.h.storage.objects.size;

    const huge = Buffer.alloc(10 * 1024 * 1024 + 200 * 1024, 0x20);
    huge.write("%PDF-", 0, "latin1");
    const tooBig = await request(front()).post(url).set(authOf(pt.u.token)).attach("file", huge, { filename: "x.pdf", contentType: "application/pdf" });
    expect(tooBig.status).toBe(413);
    expect(tooBig.headers["content-type"]).toContain("application/problem+json");
    expect(bodyOf(tooBig).code).toBe("FILE_TOO_LARGE");
    expect(await count("SELECT count(*)::int AS n FROM payment_proofs WHERE booking_id = $1", [b])).toBe(0);
    expect(c.h.storage.objects.size).toBe(before);

    const anon = await request(front()).post(url).attach("file", pdf("anon"), { filename: "x.pdf", contentType: "application/pdf" });
    expect(anon.status).toBe(401);

    const ok = await request(front()).post(url).set(authOf(pt.u.token)).attach("file", pdf("normal"), { filename: "x.pdf", contentType: "application/pdf" });
    expect(ok.status).toBe(201);
  });

  it("sem Content-Length (chunked) ⇒ 422 VALIDATION_ERROR; outras rotas não são afetadas", async () => {
    const w = await world();
    const pt = await patient();
    const b = await booking(pt, w.video);
    const server = front().listen(0);
    try {
      const { port } = server.address() as AddressInfo;
      const status = await new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = httpRequest({ port, host: "127.0.0.1", method: "POST", path: proofsOf(pt.fam, pt.m, b), headers: { Authorization: `Bearer ${pt.u.token}`, "Content-Type": "multipart/form-data; boundary=x", "Transfer-Encoding": "chunked" } }, (res) => {
          let data = "";
          res.on("data", (d: Buffer) => { data += d.toString("utf8"); });
          res.on("end", () => { resolve({ status: res.statusCode ?? 0, body: data }); });
        });
        req.on("error", reject);
        req.write("--x--\r\n");
        req.end();
      });
      expect(status.status).toBe(422);
      expect((JSON.parse(status.body) as { code: string }).code).toBe("VALIDATION_ERROR");
    } finally {
      server.close();
    }
    const list = await request(front()).get(proofsOf(pt.fam, pt.m, b)).set(authOf(pt.u.token));
    expect(list.status).toBe(200);
  });
});
