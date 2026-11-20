/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return -- respostas HTTP/linhas SQL de teste sem tipagem (supertest devolve `any`). */
// Fluxo ponta a ponta de MK4 (TC-MKT-141; AC-MKT-56): PostgreSQL real, app real (validação de pedidos E respostas contra o openapi.yaml), relógio
// injetável do harness, antivírus e SMTP simulados, flag da receita LIGADA (só em testes). A família marca; o profissional confirma; a família
// partilha (repetível e `viewOnce`); o profissional abre (vista com marca de água); a família vê as vistas; revoga; a abertura é negada; a de visualização
// única só abre uma vez; o prazo termina. Depois: conclui, emite a receita e a família vê a receita e o plano de toma (só leitura quanto ao conteúdo).
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { API, START } from "../support/professionals-harness.js";
import { startConsultationsHarness, type ConsultationsHarness, type OfferFixture, type ProfessionalFixture, type UserFixture } from "../support/consultations-harness.js";

type Res = request.Response;

const DAY = 86_400_000;
const HOUR = 3_600_000;
const PRO_NAME = "Dra. Fluxo MK4";

const LOGS: string[] = [];
let c: ConsultationsHarness;
let pro: ProfessionalFixture;
let token: string;
let offer: OfferFixture;
let u: UserFixture;
let fam = "";
let m = "";

const authOf = (t?: string): Record<string, string> => (t === undefined ? {} : { Authorization: `Bearer ${t}` });
const bodyOf = (res: Res): Record<string, any> => res.body as Record<string, any>;
const bookings = (): string => `${API}/families/${fam}/members/${m}/bookings`;
const shares = (): string => `${API}/families/${fam}/members/${m}/record-shares`;
const proBookings = `${API}/professional-portal/bookings`;
const proShares = `${API}/professional-portal/shares`;
const startOf = (day: number): Date => new Date(START.getTime() + day * DAY + 3 * HOUR);
const medication = () => ({ name: "Amoxicilina fluxo", dosage: "500 mg", scheduleType: "FIXED_TIMES", times: ["08:00", "20:00"], startAt: new Date(startOf(0).getTime() + DAY).toISOString(), endAt: new Date(startOf(0).getTime() + 8 * DAY).toISOString(), continuous: false, notes: "Depois das refeições." });

async function ok(req: PromiseLike<Res>, status = 200): Promise<Res> {
  const res = await req;
  if (res.status !== status) throw new Error(`esperado ${String(status)}, recebido ${String(res.status)}: ${JSON.stringify(res.body)}${res.status >= 500 ? ` | logs: ${LOGS.slice(-3).join("")}` : ""}`);
  return res;
}
const create = (payload: object) => request(c.h.app).post(shares()).set(authOf(u.token)).send(payload);
const famShare = (id: string) => request(c.h.app).get(`${shares()}/${id}`).set(authOf(u.token));
const open = (id: string) => request(c.h.app).post(`${proShares}/${id}/open`).set(authOf(token));
const revoke = (id: string) => request(c.h.app).post(`${shares()}/${id}/revoke`).set(authOf(u.token));

async function audit(action: string, resourceId: string): Promise<{ result: string; actor_type: string; family_id: string | null; subject_member_id: string | null; metadata: Record<string, unknown> | null }[]> {
  const { rows } = await c.h.pool.query("SELECT result, actor_type, family_id, subject_member_id, metadata FROM audit_logs WHERE action = $1 AND resource_id = $2 ORDER BY id", [action, resourceId]);
  return rows;
}

describe("TC-MKT-141: fluxo ponta a ponta de MK4 (partilha com prazo, visualização única, revogação e receita digital)", () => {
  const seen = { bk: "", rep: "", once: "" };

  beforeAll(async () => {
    c = await startConsultationsHarness({ digitalPrescription: true, logStream: LOGS });
    pro = await c.professional({ name: PRO_NAME });
    token = await c.professionalToken(pro.professionalId);
    offer = await c.offer(pro, { method: "VIDEO", durationMinutes: 30, priceKz: 0 });
    u = await c.user("fluxo-mk4");
    fam = await c.family("Família fluxo MK4");
    m = await c.member(fam, { userId: u.id, role: "FAMILY_ADMIN", name: "Ana Fluxo" });
  }, 300_000);

  afterAll(async () => {
    await c.stop();
  });

  it("marca → só depois de confirmada se partilha (REQUESTED ⇒ 409) → o profissional confirma", async () => {
    c.h.clock.set(START);
    const slotId = await c.slot(offer, startOf(0));
    const created = await ok(request(c.h.app).post(bookings()).set(authOf(u.token)).send({ offerId: offer.id, slotId, participantLabel: "Ana (fluxo)" }), 201);
    seen.bk = bodyOf(created).id;
    expect(bodyOf(created)).toMatchObject({ status: "REQUESTED", paymentStatus: "NOT_REQUIRED" });

    // OP-117: antes de confirmada não há partilha (opções e criação ⇒ INVALID_STATE_TRANSITION), e nada se grava.
    const options = await request(c.h.app).get(`${shares()}/options`).query({ bookingId: seen.bk }).set(authOf(u.token));
    expect([options.status, bodyOf(options).code]).toEqual([409, "INVALID_STATE_TRANSITION"]);
    const early = await create({ bookingId: seen.bk, categories: ["MEDICATION"], validity: "H24" });
    expect([early.status, bodyOf(early).code]).toEqual([409, "INVALID_STATE_TRANSITION"]);
    expect((await c.h.pool.query("SELECT count(*)::int AS n FROM record_shares")).rows[0].n).toBe(0);

    const confirmed = await ok(request(c.h.app).post(`${proBookings}/${seen.bk}/confirm`).set(authOf(token)).send({ meetingInfo: "https://meet.exemplo.ao/sala-mk4" }));
    expect(bodyOf(confirmed).status).toBe("CONFIRMED");
  });

  it("a família partilha: opções, partilha repetível (D7) e de visualização única (H24); repetir o clientRequestId devolve a mesma (200)", async () => {
    const options = await ok(request(c.h.app).get(`${shares()}/options`).query({ bookingId: seen.bk }).set(authOf(u.token)));
    expect(bodyOf(options)).toMatchObject({ bookingId: seen.bk, professionalCategory: "HEALTH", viewOnceAllowed: true, maxActive: 20, activeCount: 0 });
    expect(bodyOf(options).allowedCategories).toEqual(["ALLERGIES", "CONDITIONS", "MEDICATION", "APPOINTMENTS", "EXAMS"]);
    expect((bodyOf(options).validities as { eligible: boolean }[]).every((v) => v.eligible)).toBe(true);

    const clientRequestId = "22222222-2222-4222-8222-222222222222";
    const rep = await ok(create({ bookingId: seen.bk, categories: ["ALLERGIES", "MEDICATION"], validity: "D7", clientRequestId }), 201);
    seen.rep = bodyOf(rep).id;
    expect(bodyOf(rep)).toMatchObject({ bookingId: seen.bk, categories: ["ALLERGIES", "MEDICATION"], validity: "D7", viewOnce: false, status: "ACTIVE", viewCount: 0, revokedAt: null, consumedAt: null });
    expect(bodyOf(rep).professional).toMatchObject({ id: pro.professionalId, displayName: PRO_NAME });
    expect(new Date(bodyOf(rep).expiresAt as string).getTime()).toBe(START.getTime() + 7 * DAY);
    const replay = await ok(create({ bookingId: seen.bk, categories: ["ALLERGIES", "MEDICATION"], validity: "D7", clientRequestId }), 200);
    expect(replay.body).toEqual(rep.body);

    const once = await ok(create({ bookingId: seen.bk, categories: ["CONDITIONS"], validity: "H24", viewOnce: true }), 201);
    seen.once = bodyOf(once).id;
    expect(bodyOf(once)).toMatchObject({ viewOnce: true, status: "ACTIVE", categories: ["CONDITIONS"] });
    expect((await c.h.pool.query("SELECT count(*)::int AS n FROM record_shares WHERE booking_id = $1", [seen.bk])).rows[0].n).toBe(2);
    // Um aviso genérico por partilha nova (o replay não enfileira outro) e o e-mail leva texto fixo.
    expect(c.shareNoticeCalls.filter((n) => n.professionalId === pro.professionalId).map((n) => n.shareId)).toEqual([seen.rep, seen.once]);
    c.shareMails.length = 0;
    for (const call of c.shareNoticeCalls) expect(await c.shareMaintenance.notifyNewShare(call)).toBe("SENT");
    expect(c.shareMails).toHaveLength(2);
    // Auditoria da criação com família e membro-sujeito, sem rótulo nem categorias.
    const created = await audit("RECORD_SHARE_CREATE", seen.rep);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ actor_type: "USER", result: "SUCCESS", family_id: fam, subject_member_id: m, metadata: { bookingId: seen.bk, categoryCount: 2, validity: "D7", viewOnce: false } });
  });

  it("o profissional vê as partilhas (só metadados) e abre a repetível duas vezes: marca de água, só as categorias concedidas, no-store e sem ETag", async () => {
    const list = await ok(request(c.h.app).get(proShares).set(authOf(token)));
    expect((bodyOf(list).items as { id: string }[]).map((i) => i.id).sort()).toEqual([seen.rep, seen.once].sort());
    expect((bodyOf(list).items as { canOpen: boolean }[]).every((i) => i.canOpen)).toBe(true);
    expect(JSON.stringify(list.body)).not.toMatch(new RegExp(`${fam}|${m}|${u.id}`));

    c.readerCalls.length = 0;
    const first = await ok(open(seen.rep));
    expect(first.headers["cache-control"]).toMatch(/no-store/);
    expect(first.headers.etag).toBeUndefined();
    expect(bodyOf(first)).toMatchObject({ shareId: seen.rep, participantLabel: "Ana (fluxo)", ageYears: 41, viewOnce: false, watermark: { professionalName: PRO_NAME, openedOn: "2026-11-16" } });
    expect(Object.keys(bodyOf(first)).sort()).toEqual(["ageYears", "allergies", "bloodType", "expiresAt", "medications", "openedAt", "participantLabel", "shareId", "viewOnce", "watermark"]);
    expect(c.readerCalls).toEqual([["ALLERGIES", "MEDICATION"]]);

    c.h.clock.set(new Date(START.getTime() + HOUR));
    const second = await ok(open(seen.rep));
    expect(bodyOf(second).openedAt).toBe(new Date(START.getTime() + HOUR).toISOString());
    c.h.clock.set(START);

    const meta = await ok(request(c.h.app).get(`${proShares}/${seen.rep}`).set(authOf(token)));
    expect(bodyOf(meta)).toMatchObject({ openCount: 2, status: "ACTIVE", canOpen: true });
    const opens = await audit("PROFESSIONAL_SHARE_OPEN", seen.rep);
    expect(opens).toHaveLength(2);
    for (const row of opens) expect(row).toMatchObject({ actor_type: "PROFESSIONAL_ACCOUNT", result: "SUCCESS", family_id: fam, subject_member_id: m, metadata: { viewOnce: false, categoryCount: 2 } });
  });

  it("a família vê cada acesso (quem, o quê e quando; nunca o conteúdo) e o contador da partilha", async () => {
    const detail = await ok(famShare(seen.rep));
    expect(bodyOf(detail)).toMatchObject({ status: "ACTIVE", viewCount: 2 });
    expect(bodyOf(detail).lastViewedAt).toBe(new Date(START.getTime() + HOUR).toISOString());
    const views = await ok(request(c.h.app).get(`${shares()}/${seen.rep}/views`).set(authOf(u.token)));
    expect(bodyOf(views).items).toEqual([
      { viewNo: 2, viewedAt: new Date(START.getTime() + HOUR).toISOString(), professionalName: PRO_NAME, categories: ["ALLERGIES", "MEDICATION"] },
      { viewNo: 1, viewedAt: START.toISOString(), professionalName: PRO_NAME, categories: ["ALLERGIES", "MEDICATION"] },
    ]);
    expect(JSON.stringify(views.body)).not.toMatch(/Penicilina|Paracetamol|Asma/);
    // Páginas: limit=1 devolve a mais recente e um cursor para a anterior.
    const page = await ok(request(c.h.app).get(`${shares()}/${seen.rep}/views`).query({ limit: "1" }).set(authOf(u.token)));
    expect((bodyOf(page).items as { viewNo: number }[]).map((v) => v.viewNo)).toEqual([2]);
    const next = await ok(request(c.h.app).get(`${shares()}/${seen.rep}/views`).query({ limit: "1", cursor: bodyOf(page).nextCursor }).set(authOf(u.token)));
    expect((bodyOf(next).items as { viewNo: number }[]).map((v) => v.viewNo)).toEqual([1]);
    expect(bodyOf(next).nextCursor).toBeNull();
  });

  it("visualização única: abre uma vez (CONSUMED); a seguinte ⇒ 403 SHARE_ALREADY_VIEWED, sem nova vista", async () => {
    const view = await ok(open(seen.once));
    expect(Object.keys(bodyOf(view)).sort()).toEqual(["ageYears", "conditions", "expiresAt", "openedAt", "participantLabel", "shareId", "viewOnce", "watermark"]);
    expect(bodyOf(view).viewOnce).toBe(true);
    const again = await open(seen.once);
    expect([again.status, bodyOf(again).code]).toEqual([403, "SHARE_ALREADY_VIEWED"]);
    const detail = await ok(famShare(seen.once));
    expect(bodyOf(detail)).toMatchObject({ status: "CONSUMED", viewCount: 1 });
    expect(bodyOf(detail).consumedAt).toBe(START.toISOString());
    expect((await c.h.pool.query("SELECT count(*)::int AS n FROM record_share_views WHERE share_id = $1", [seen.once])).rows[0].n).toBe(1);
    expect((await audit("PROFESSIONAL_SHARE_OPEN", seen.once)).map((r) => [r.result, r.metadata])).toEqual([
      ["SUCCESS", { viewNo: 1, viewOnce: true, categoryCount: 1 }],
      ["DENIED", { reason: "CONSUMED" }],
    ]);
    // Uma consumida não se revoga (INVALID_STATE_TRANSITION) e nada muda.
    const revoked = await revoke(seen.once);
    expect([revoked.status, bodyOf(revoked).code]).toEqual([409, "INVALID_STATE_TRANSITION"]);
  });

  it("a família revoga: efeito imediato (abertura negada, SHARE_NOT_AVAILABLE genérico), vistas anteriores mantêm-se e revogar de novo ⇒ 409", async () => {
    const revoked = await ok(revoke(seen.rep));
    expect(bodyOf(revoked)).toMatchObject({ status: "REVOKED", viewCount: 2 });
    expect(bodyOf(revoked).revokedAt).toBe(START.toISOString());
    const denied = await open(seen.rep);
    expect([denied.status, bodyOf(denied).code, bodyOf(denied).detail]).toEqual([403, "SHARE_NOT_AVAILABLE", "Esta partilha já não está disponível."]);
    expect((await ok(request(c.h.app).get(`${shares()}/${seen.rep}/views`).set(authOf(u.token)))).body.items).toHaveLength(2);
    const meta = await ok(request(c.h.app).get(`${proShares}/${seen.rep}`).set(authOf(token)));
    expect(bodyOf(meta)).toMatchObject({ status: "REVOKED", canOpen: false, openCount: 2 });
    expect((await revoke(seen.rep)).status).toBe(409);
    expect((await audit("RECORD_SHARE_REVOKE", seen.rep)).map((r) => [r.result, r.metadata])).toEqual([["SUCCESS", { fromStatus: "ACTIVE" }]]);
    expect((await audit("PROFESSIONAL_SHARE_OPEN", seen.rep)).map((r) => [r.result, r.metadata])).toEqual([
      ["SUCCESS", { viewNo: 1, viewOnce: false, categoryCount: 2 }],
      ["SUCCESS", { viewNo: 2, viewOnce: false, categoryCount: 2 }],
      ["DENIED", { reason: "REVOKED" }],
    ]);
    // A lista da família filtra por estado derivado.
    const list = async (status: string): Promise<string[]> => ((await ok(request(c.h.app).get(shares()).query({ status }).set(authOf(u.token)))).body.items as { id: string }[]).map((i) => i.id);
    expect(await list("REVOKED")).toEqual([seen.rep]);
    expect(await list("CONSUMED")).toEqual([seen.once]);
    expect(await list("ACTIVE")).toEqual([]);
  });

  it("o prazo termina: sem revogar, a abertura passa a ser negada e o estado derivado é EXPIRED (a revogação já não se aplica)", async () => {
    const short = bodyOf(await ok(create({ bookingId: seen.bk, categories: ["MEDICATION"], validity: "H24" }), 201)).id as string;
    await ok(open(short));
    c.h.clock.set(new Date(START.getTime() + 25 * HOUR));
    const denied = await open(short);
    expect([denied.status, bodyOf(denied).code]).toEqual([403, "SHARE_NOT_AVAILABLE"]);
    expect(bodyOf(await ok(famShare(short)))).toMatchObject({ status: "EXPIRED", viewCount: 1 });
    expect((await revoke(short)).status).toBe(409);
    expect((await audit("PROFESSIONAL_SHARE_OPEN", short)).map((r) => [r.result, r.metadata])).toEqual([
      ["SUCCESS", { viewNo: 1, viewOnce: false, categoryCount: 1 }],
      ["DENIED", { reason: "EXPIRED" }],
    ]);
    c.h.clock.set(START);
  });

  it("revogar antes de a abrir: a partilha de visualização única nunca chega a ser vista (sem vista, sem consumo)", async () => {
    const id = bodyOf(await ok(create({ bookingId: seen.bk, categories: ["ALLERGIES"], validity: "D7", viewOnce: true }), 201)).id as string;
    await ok(revoke(id));
    expect((await open(id)).status).toBe(403);
    expect(bodyOf(await ok(famShare(id)))).toMatchObject({ status: "REVOKED", viewCount: 0, consumedAt: null });
    expect((await c.h.pool.query("SELECT count(*)::int AS n FROM record_share_views WHERE share_id = $1", [id])).rows[0].n).toBe(0);
  });

  it("receita digital (flag ligada): conclui → emite → a família vê a receita e o plano de toma (conteúdo só leitura, horários ajustáveis)", async () => {
    c.h.clock.set(new Date(startOf(0).getTime() + HOUR));
    const before = await ok(request(c.h.app).get(`${proBookings}/${seen.bk}`).set(authOf(token)));
    expect(bodyOf(before).canPrescribe).toBe(false); // ainda CONFIRMED
    const noRx = await request(c.h.app).post(`${proBookings}/${seen.bk}/prescriptions`).set(authOf(token)).send({ medications: [medication()] });
    expect([noRx.status, bodyOf(noRx).code]).toEqual([409, "INVALID_STATE_TRANSITION"]);

    await ok(request(c.h.app).post(`${proBookings}/${seen.bk}/complete`).set(authOf(token)));
    const completed = await ok(request(c.h.app).get(`${proBookings}/${seen.bk}`).set(authOf(token)));
    expect(bodyOf(completed)).toMatchObject({ status: "COMPLETED", canPrescribe: true });

    // A partilha criada depois de concluída abre (COMPLETED também permite partilhar, BR-MKT-67).
    const post = bodyOf(await ok(create({ bookingId: seen.bk, categories: ["MEDICATION"], validity: "H24" }), 201)).id as string;
    expect((await ok(open(post))).body.medications).toHaveLength(1);

    c.alertCalls.length = 0;
    const issued = await ok(request(c.h.app).post(`${proBookings}/${seen.bk}/prescriptions`).set(authOf(token)).send({ notes: "Tomar com água.", medications: [medication()] }), 201);
    expect(Object.keys(bodyOf(issued)).sort()).toEqual(["bookingId", "createdAt", "issuedOn", "medications", "notes"]);
    expect(bodyOf(issued)).toMatchObject({ bookingId: seen.bk, issuedOn: "2026-11-16", notes: "Tomar com água." });
    expect(c.alertCalls).toEqual([expect.objectContaining({ kind: "BOOKING_UPDATED", bookingId: seen.bk, familyId: fam, memberId: m })]);
    expect((await ok(request(c.h.app).get(`${proBookings}/${seen.bk}/prescription`).set(authOf(token)))).body).toEqual(issued.body);
    const second = await request(c.h.app).post(`${proBookings}/${seen.bk}/prescriptions`).set(authOf(token)).send({ medications: [medication()] });
    expect([second.status, bodyOf(second).code]).toEqual([409, "CONFLICT"]);
    expect(bodyOf(await ok(request(c.h.app).get(`${proBookings}/${seen.bk}`).set(authOf(token))))).toMatchObject({ canPrescribe: false, hasPrescription: true });

    // A família vê: a marcação aponta para a receita; a receita é `PROFESSIONAL`; o plano de toma existe no registo do membro.
    const booking = await ok(request(c.h.app).get(`${bookings()}/${seen.bk}`).set(authOf(u.token)));
    const rx = (await ok(request(c.h.app).get(`${API}/families/${fam}/members/${m}/prescriptions`).set(authOf(u.token)))).body.items[0];
    expect(bodyOf(booking).prescriptionId).toBe(rx.id);
    expect(rx).toMatchObject({ issuedBy: "PROFESSIONAL", bookingId: seen.bk, doctorName: PRO_NAME });
    expect(JSON.stringify(rx)).not.toContain(pro.professionalId);
    const plans = (await ok(request(c.h.app).get(`${API}/families/${fam}/members/${m}/medication-plans`).set(authOf(u.token)))).body.items as any[];
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ name: "Amoxicilina fluxo", dosage: "500 mg", prescriptionId: rx.id, status: "ACTIVE" });
    // Conteúdo só leitura (OP-127): editar o nome ⇒ 409 CONFLICT; ajustar os horários ⇒ 200.
    const edit = await request(c.h.app).patch(`${API}/families/${fam}/members/${m}/medication-plans/${String(plans[0].id)}`).set(authOf(u.token)).send({ name: "Outro" });
    expect([edit.status, bodyOf(edit).code]).toEqual([409, "CONFLICT"]);
    expect((await ok(request(c.h.app).patch(`${API}/families/${fam}/members/${m}/medication-plans/${String(plans[0].id)}`).set(authOf(u.token)).send({ times: ["09:00"] }))).body.times).toEqual(["09:00"]);
    // A receita é mesmo atómica com a marcação: auditoria sem conteúdo.
    expect((await c.h.pool.query("SELECT metadata FROM audit_logs WHERE action = 'PRESCRIPTION_ISSUED_BY_PROFESSIONAL'")).rows.map((r) => r.metadata)).toEqual([{ bookingId: seen.bk, medicationCount: 1 }]);
  }, 60_000);

  // OP-129: entre as 23:00 e as 24:00 UTC já é amanhã em Luanda, mas a BD valida `issued_on <= current_date` (UTC): usa-se o dia UTC (antes: 500).
  it("emitir entre as 23:00 e as 24:00 UTC (já é amanhã em Luanda) devia dar 201, não 500 (CHECK issued_on <= current_date)", async () => {
    const today = (await c.h.pool.query<{ d: string }>("SELECT current_date::text AS d")).rows[0]?.d ?? "";
    c.h.clock.set(new Date(`${today}T23:30:00.000Z`));
    try {
      const p = await c.professional({ name: "Dra. Fuso" });
      const t = await c.professionalToken(p.professionalId);
      const o = await c.offer(p, { method: "VIDEO", durationMinutes: 30, priceKz: 0 });
      const user = await c.user("fuso");
      const f = await c.family("Fuso");
      const member = await c.member(f, { userId: user.id, role: "FAMILY_ADMIN" });
      const { bookingId } = await c.seedBooking({ familyId: f, memberId: member, offer: o, startsAt: new Date(c.h.clock.now().getTime() - 5 * HOUR), createdByUserId: user.id });
      await c.h.pool.query("UPDATE bookings SET status = 'COMPLETED', confirmed_at = $2, completed_at = $3 WHERE id = $1", [bookingId, new Date(c.h.clock.now().getTime() - 6 * HOUR), new Date(c.h.clock.now().getTime() - HOUR)]);
      await ok(request(c.h.app).post(`${proBookings}/${bookingId}/prescriptions`).set(authOf(t)).send({ medications: [medication()] }), 201);
    } finally {
      c.h.clock.set(START);
    }
  });

  it("a flag desligada (omissão) não monta as rotas da receita: o mesmo fluxo noutra instância responde 404 e `canPrescribe=false`", async () => {
    const off = await startConsultationsHarness();
    try {
      const p = await off.professional({ name: "Dra. Sem Receita" });
      const t = await off.professionalToken(p.professionalId);
      const o = await off.offer(p, { method: "VIDEO", durationMinutes: 30, priceKz: 0 });
      const user = await off.user("sem-flag");
      const f = await off.family("Sem flag");
      const member = await off.member(f, { userId: user.id, role: "FAMILY_ADMIN" });
      const { bookingId } = await off.seedBooking({ familyId: f, memberId: member, offer: o, startsAt: new Date(START.getTime() - 2 * DAY), createdByUserId: user.id });
      await off.h.pool.query("UPDATE bookings SET status = 'COMPLETED', confirmed_at = $2, completed_at = $3 WHERE id = $1", [bookingId, new Date(START.getTime() - 3 * DAY), new Date(START.getTime() - DAY)]);
      const post = await request(off.h.app).post(`${proBookings}/${bookingId}/prescriptions`).set(authOf(t)).send({ medications: [medication()] });
      const unknown = await request(off.h.app).post(`${proBookings}/${bookingId}/inexistente`).set(authOf(t)).send({});
      expect(post.status).toBe(404);
      expect(bodyOf(post).code).toBe(bodyOf(unknown).code);
      expect((await request(off.h.app).get(`${proBookings}/${bookingId}/prescription`).set(authOf(t))).status).toBe(404);
      expect(bodyOf(await request(off.h.app).get(`${proBookings}/${bookingId}`).set(authOf(t))).canPrescribe).toBe(false);
      // As partilhas continuam a funcionar sem a flag (são independentes da receita).
      expect((await request(off.h.app).get(proShares).set(authOf(t))).status).toBe(200);
    } finally {
      await off.stop();
    }
  }, 120_000);
});
