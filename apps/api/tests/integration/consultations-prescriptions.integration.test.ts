/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/restrict-template-expressions -- corpos JSON dinâmicos (convenção de mk2-flow) */
// Integração (PostgreSQL real, app real com validação de pedidos E respostas) da RECEITA DIGITAL do profissional (MK4 S9; BR-MKT-79..81, OP-125..127;
// TC-MKT-134..137, 143): flag desligada (404), elegibilidade, atomicidade, auditoria sem conteúdo, privacidade e conteúdo só leitura para a família.
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { API, START } from "../support/professionals-harness.js";
import { startConsultationsHarness, type ConsultationsHarness } from "../support/consultations-harness.js";

const DAY = 86_400_000;
const CANARY_NAME = "canario-rx-nome";
const CANARY_DOSE = "canario-rx-dose";
const CANARY_NOTE = "canario-rx-nota";
const bodyOf = (res: { body: unknown }): any => res.body;
const auth = (t: string): Record<string, string> => ({ Authorization: `Bearer ${t}` });
const medication = (name = CANARY_NAME) => ({ name, dosage: CANARY_DOSE, scheduleType: "FIXED_TIMES", times: ["08:00"], startAt: new Date(START.getTime() + DAY).toISOString(), endAt: new Date(START.getTime() + 8 * DAY).toISOString(), continuous: false, notes: CANARY_NOTE });

let on: ConsultationsHarness;
let off: ConsultationsHarness;

async function world(c: ConsultationsHarness, o: { status?: string; completedDaysAgo?: number; category?: "HEALTH" | "WELLNESS" } = {}) {
  const pro = await c.professional({ name: "Dr. Receita" });
  const offer = await c.offer(pro, { method: "PHONE", durationMinutes: 30, priceKz: 0 });
  if (o.category === "WELLNESS") await c.h.pool.query("UPDATE specialties SET category='WELLNESS' WHERE id=$1", [pro.specialtyId]);
  const user = await c.user("titular-rx");
  const fam = await c.family("Rx F");
  const member = await c.member(fam, { userId: user.id, role: "FAMILY_ADMIN", name: "Titular" });
  const { bookingId } = await c.seedBooking({ familyId: fam, memberId: member, offer, startsAt: new Date(START.getTime() - 2 * DAY) });
  const completedAt = new Date(START.getTime() - (o.completedDaysAgo ?? 1) * DAY);
  await c.h.pool.query("UPDATE bookings SET status=$2::booking_status, confirmed_at=$4, completed_at=$3 WHERE id=$1", [bookingId, o.status ?? "COMPLETED", (o.status ?? "COMPLETED") === "COMPLETED" ? completedAt : null, new Date(START.getTime() - 3 * DAY)]);
  return { pro, user, fam, member, bookingId };
}
const issue = (c: ConsultationsHarness, token: string, id: string, body: unknown) => request(c.h.app).post(`${API}/professional-portal/bookings/${id}/prescriptions`).set(auth(token)).send(body as object);
const read = (c: ConsultationsHarness, token: string, id: string) => request(c.h.app).get(`${API}/professional-portal/bookings/${id}/prescription`).set(auth(token));

describe("integração: receita digital do profissional (MK4 S9)", () => {
  beforeAll(async () => {
    on = await startConsultationsHarness({ digitalPrescription: true });
    off = await startConsultationsHarness();
  }, 600_000);
  afterAll(async () => {
    await on.stop();
    await off.stop();
  });

  it("flag desligada (omissão): POST e GET ⇒ 404, canPrescribe=false e nada criado", async () => {
    const w = await world(off);
    const post = await issue(off, w.pro.token, w.bookingId, { medications: [medication()] });
    expect(post.status).toBe(404);
    expect((await read(off, w.pro.token, w.bookingId)).status).toBe(404);
    const unknown = await request(off.h.app).post(`${API}/professional-portal/bookings/${w.bookingId}/inexistente`).set(auth(w.pro.token)).send({});
    expect(bodyOf(post).code).toBe(bodyOf(unknown).code);
    const view = await request(off.h.app).get(`${API}/professional-portal/bookings/${w.bookingId}`).set(auth(w.pro.token));
    expect(bodyOf(view).canPrescribe).toBe(false);
    const { rows } = await off.h.pool.query("SELECT count(*)::int AS n FROM prescriptions");
    expect(rows[0].n).toBe(0);
  });

  it("emite em marcação COMPLETED (método PHONE): receita PROFESSIONAL, planos, auditoria sem conteúdo, alerta; GET devolve o escrito; segunda ⇒ 409", async () => {
    const w = await world(on);
    const before = on.alertCalls.length;
    const res = await issue(on, w.pro.token, w.bookingId, { notes: CANARY_NOTE, medications: [medication(), medication("outro")] });
    expect(res.status).toBe(201);
    expect(Object.keys(bodyOf(res)).sort()).toEqual(["bookingId", "createdAt", "issuedOn", "medications", "notes"]);
    expect(bodyOf(res).medications).toHaveLength(2);
    const rx = await on.h.pool.query("SELECT id, issued_by, issued_by_professional_id, booking_id, doctor_name, issued_on::text AS d FROM prescriptions WHERE booking_id=$1", [w.bookingId]);
    expect(rx.rows[0]).toMatchObject({ issued_by: "PROFESSIONAL", issued_by_professional_id: w.pro.professionalId, doctor_name: "Dr. Receita" });
    expect((await on.h.pool.query("SELECT count(*)::int AS n FROM medication_plans WHERE prescription_id=$1", [rx.rows[0].id])).rows[0].n).toBe(2);
    expect(on.alertCalls.slice(before)).toEqual([expect.objectContaining({ kind: "BOOKING_UPDATED", bookingId: w.bookingId })]);
    const audit = await on.h.pool.query("SELECT action, actor_type, metadata::text AS m FROM audit_logs WHERE action='PRESCRIPTION_ISSUED_BY_PROFESSIONAL'");
    expect(audit.rows).toHaveLength(1);
    expect(JSON.parse(audit.rows[0].m)).toEqual({ bookingId: w.bookingId, medicationCount: 2 });
    const dump = JSON.stringify((await on.h.pool.query("SELECT * FROM audit_logs")).rows);
    for (const canary of [CANARY_NAME, CANARY_DOSE, CANARY_NOTE]) expect(dump).not.toContain(canary);
    const again = await read(on, w.pro.token, w.bookingId);
    expect(again.status).toBe(200);
    expect(bodyOf(again).medications.map((m: any) => m.name).sort()).toEqual([CANARY_NAME, "outro"].sort());
    expect((await issue(on, w.pro.token, w.bookingId, { medications: [medication()] })).status).toBe(409);
    const view = await request(on.h.app).get(`${API}/professional-portal/bookings/${w.bookingId}`).set(auth(w.pro.token));
    expect(bodyOf(view)).toMatchObject({ canPrescribe: false, hasPrescription: true });
    const fam = await request(on.h.app).get(`${API}/families/${w.fam}/members/${w.member}/bookings/${w.bookingId}`).set(auth(w.user.token));
    expect(bodyOf(fam).prescriptionId).toBe(rx.rows[0].id);
  });

  it("elegibilidade: não COMPLETED e >7 dias ⇒ 409; WELLNESS ⇒ 403; corpo inválido ⇒ 422; alheia/inexistente ⇒ 404 idêntico; sem efeito", async () => {
    const notDone = await world(on, { status: "CONFIRMED" });
    const old = await world(on, { completedDaysAgo: 8 });
    const wellness = await world(on, { category: "WELLNESS" });
    const fine = await world(on);
    const r1 = await issue(on, notDone.pro.token, notDone.bookingId, { medications: [medication()] });
    expect([r1.status, bodyOf(r1).code]).toEqual([409, "INVALID_STATE_TRANSITION"]);
    const r2 = await issue(on, old.pro.token, old.bookingId, { medications: [medication()] });
    expect([r2.status, bodyOf(r2).code]).toEqual([409, "INVALID_STATE_TRANSITION"]);
    expect((await issue(on, wellness.pro.token, wellness.bookingId, { medications: [medication()] })).status).toBe(403);
    expect((await issue(on, fine.pro.token, fine.bookingId, { medications: [] })).status).toBe(422);
    expect((await issue(on, fine.pro.token, fine.bookingId, { medications: Array.from({ length: 11 }, () => medication()) })).status).toBe(422);
    const other = await issue(on, fine.pro.token, notDone.bookingId, { medications: [medication()] });
    const missing = await issue(on, fine.pro.token, randomUUID(), { medications: [medication()] });
    expect(other.status).toBe(404);
    expect({ ...bodyOf(other), requestId: 0, instance: 0 }).toEqual({ ...bodyOf(missing), requestId: 0, instance: 0 });
    expect((await read(on, fine.pro.token, notDone.bookingId)).status).toBe(404);
    expect((await on.h.pool.query("SELECT count(*)::int AS n FROM prescriptions WHERE booking_id = ANY($1)", [[notDone.bookingId, old.bookingId, wellness.bookingId, fine.bookingId]])).rows[0].n).toBe(0);
  });

  it("profissional não APPROVED ⇒ PROFESSIONAL_LOCKED; falha a meio (horário inválido) não deixa receita nem planos (atómico)", async () => {
    const suspended = await world(on);
    await on.h.pool.query("UPDATE professionals SET validation_status='SUSPENDED' WHERE id=$1", [suspended.pro.professionalId]);
    const locked = await issue(on, suspended.pro.token, suspended.bookingId, { medications: [medication()] });
    expect([locked.status, bodyOf(locked).code]).toEqual([409, "PROFESSIONAL_LOCKED"]);
    const atomic = await world(on);
    const bad = { ...medication("segunda"), times: [] as string[] };
    const res = await issue(on, atomic.pro.token, atomic.bookingId, { medications: [medication(), bad] });
    expect(res.status).toBe(422);
    expect((await on.h.pool.query("SELECT count(*)::int AS n FROM prescriptions WHERE booking_id=$1", [atomic.bookingId])).rows[0].n).toBe(0);
    expect((await on.h.pool.query("SELECT count(*)::int AS n FROM medication_plans WHERE member_id=$1", [atomic.member])).rows[0].n).toBe(0);
  });

  it("concorrência: duas emissões simultâneas ⇒ uma 201 e uma 409; uma só receita", async () => {
    const w = await world(on);
    const rs = await Promise.all([issue(on, w.pro.token, w.bookingId, { medications: [medication()] }), issue(on, w.pro.token, w.bookingId, { medications: [medication()] })]);
    expect(rs.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await on.h.pool.query("SELECT count(*)::int AS n FROM prescriptions WHERE booking_id=$1", [w.bookingId])).rows[0].n).toBe(1);
  });

  it("família: conteúdo só leitura (409 CONFLICT, detail exato, sem efeito); cancelar, ajustar horários e apagar permitidos; issuedByProfessionalId nunca sai", async () => {
    const w = await world(on);
    expect((await issue(on, w.pro.token, w.bookingId, { medications: [medication()] })).status).toBe(201);
    const base = `${API}/families/${w.fam}/members/${w.member}`;
    const list = await request(on.h.app).get(`${base}/prescriptions`).set(auth(w.user.token));
    const rx = bodyOf(list).items[0];
    expect(rx).toMatchObject({ issuedBy: "PROFESSIONAL", bookingId: w.bookingId });
    expect(JSON.stringify(list.body)).not.toContain(w.pro.professionalId);
    const planId = rx.medications[0].id;
    const detail = "O conteúdo desta receita só pode ser lido.";
    for (const res of [
      await request(on.h.app).patch(`${base}/prescriptions/${rx.id}`).set(auth(w.user.token)).send({ notes: "x" }),
      await request(on.h.app).post(`${base}/prescriptions/${rx.id}/medications`).set(auth(w.user.token)).send(medication("extra")),
      await request(on.h.app).patch(`${base}/medication-plans/${planId}`).set(auth(w.user.token)).send({ dosage: "x" }),
      await request(on.h.app).patch(`${base}/medication-plans/${planId}`).set(auth(w.user.token)).send({ times: ["09:00"], name: "x" }),
    ]) {
      expect([res.status, bodyOf(res).code, bodyOf(res).detail]).toEqual([409, "CONFLICT", detail]);
    }
    const after = await on.h.pool.query("SELECT name, dosage, times FROM medication_plans WHERE id=$1", [planId]);
    expect(after.rows[0]).toMatchObject({ name: CANARY_NAME, dosage: CANARY_DOSE, times: ["08:00"] });
    expect((await request(on.h.app).patch(`${base}/medication-plans/${planId}`).set(auth(w.user.token)).send({ times: ["09:30"] })).status).toBe(200);
    expect((await request(on.h.app).put(`${base}/prescriptions/${rx.id}/status`).set(auth(w.user.token)).send({ status: "CANCELLED" })).status).toBe(200);
    expect((await request(on.h.app).delete(`${base}/prescriptions/${rx.id}`).set(auth(w.user.token))).status).toBe(204);
    expect((await read(on, w.pro.token, w.bookingId)).status).toBe(404);
  });
});
