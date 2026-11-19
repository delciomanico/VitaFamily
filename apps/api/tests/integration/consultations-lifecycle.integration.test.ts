// Integração (PostgreSQL real) do ciclo de vida de `consultations` (MK3 S12; BR-MKT-64, OP-105): TC-MKT-101 (apagar família ⇒ cascata,
// ficheiros enfileirados pelo trigger de outbox e escoados, avaliação anónima sem comentário, exportação do titular sem ficheiros) e
// TC-MKT-102 (retenção de 24 meses de `consultations.purge-expired`: fronteira exata, idempotência, metadados e avaliações intactos,
// descarregar um purgado ⇒ DOCUMENT_NOT_AVAILABLE, auditoria só com a contagem).
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { API, START } from "../support/professionals-harness.js";
import { startConsultationsHarness, type ConsultationsHarness, type OfferFixture, type ProfessionalFixture } from "../support/consultations-harness.js";

/** `START` (2026-11-16T10:00Z) menos 24 meses de calendário. */
const CUTOFF = new Date("2024-11-16T10:00:00.000Z");
const COMMENT = "comentario-canario-s12";

let c: ConsultationsHarness;
let pro: ProfessionalFixture;
let offer: OfferFixture;

async function proofRow(bookingId: string, key: string, status = "SUBMITTED"): Promise<string> {
  const { rows } = await c.h.pool.query<{ id: string }>(
    `INSERT INTO payment_proofs (booking_id, storage_key, content_type, size_bytes, scan_status, scanned_at, status, decided_at, decision_reason)
     VALUES ($1,$2,'application/pdf',100,'CLEAN',now(),$3::payment_proof_status, CASE WHEN $3 = 'SUBMITTED' THEN NULL ELSE now() END, CASE WHEN $3 = 'SUBMITTED' THEN NULL ELSE 'Motivo.' END) RETURNING id`,
    [bookingId, key, status],
  );
  return rows[0]?.id ?? "";
}

async function reviewRow(bookingId: string): Promise<string> {
  const { rows } = await c.h.pool.query<{ id: string }>(
    `INSERT INTO reviews (booking_id, professional_id, specialty_id, method, consulted_month, rating, comment, reply_text, replied_at)
     VALUES ($1,$2,$3,'IN_PERSON','2031-01-01',4,$4,'Obrigado.',now()) RETURNING id`,
    [bookingId, pro.professionalId, pro.specialtyId, COMMENT],
  );
  return rows[0]?.id ?? "";
}

describe("integração: ciclo de vida de consultations (MK3 S12)", () => {
  beforeAll(async () => {
    c = await startConsultationsHarness();
    pro = await c.professional();
    offer = await c.offer(pro, { method: "IN_PERSON", durationMinutes: 30, priceKz: 5000 });
  }, 240_000);
  afterAll(async () => {
    await c.stop();
  });
  beforeEach(() => {
    c.h.clock.set(START);
  });

  it("TC-MKT-101: apagar a família apaga marcações e comprovativos, enfileira só os ficheiros por trigger, liberta o horário e anonimiza a avaliação", async () => {
    const owner = await c.user("titular");
    const familyId = await c.family();
    const memberId = await c.member(familyId, { userId: owner.id, role: "FAMILY_ADMIN" });
    const { bookingId, slotId } = await c.seedBooking({ familyId, memberId, offer, startsAt: new Date(START.getTime() + 5 * 86_400_000), status: "CONFIRMED" });
    const liveKey = `consultation-proofs/final/${randomUUID()}.pdf`;
    const purgedKey = `consultation-proofs/final/${randomUUID()}.pdf`;
    await proofRow(bookingId, liveKey, "REJECTED");
    const purgedId = await proofRow(bookingId, purgedKey, "REJECTED");
    await c.h.pool.query("UPDATE payment_proofs SET purged_at = now() WHERE id = $1", [purgedId]);
    const reviewId = await reviewRow(bookingId);

    await c.h.pool.query("DELETE FROM families WHERE id = $1", [familyId]);

    expect((await c.h.pool.query("SELECT 1 FROM bookings WHERE id = $1", [bookingId])).rowCount).toBe(0);
    expect((await c.h.pool.query("SELECT 1 FROM payment_proofs WHERE booking_id = $1", [bookingId])).rowCount).toBe(0);
    const outbox = (await c.h.pool.query<{ storage_key: string }>("SELECT storage_key FROM consultation_file_deletions WHERE storage_key = ANY($1)", [[liveKey, purgedKey]])).rows;
    expect(outbox.map((r) => r.storage_key)).toEqual([liveKey]);
    expect((await c.h.pool.query<{ booking_id: string | null }>("SELECT booking_id FROM professional_slots WHERE id = $1", [slotId])).rows[0]?.booking_id).toBeNull();
    const review = (await c.h.pool.query<{ booking_id: string | null; comment: string | null; rating: number; reply_text: string | null }>("SELECT booking_id, comment, rating, reply_text FROM reviews WHERE id = $1", [reviewId])).rows[0];
    expect(review).toEqual({ booking_id: null, comment: null, rating: 4, reply_text: "Obrigado." });

    const drained = await c.runDeleteFiles();
    expect(drained.failed).toBe(0);
    expect((await c.h.pool.query("SELECT 1 FROM consultation_file_deletions WHERE storage_key = $1 AND deleted_at IS NOT NULL", [liveKey])).rowCount).toBe(1);
  });

  it("TC-MKT-101: a exportação do titular inclui as marcações (metadados dos comprovativos, sem ficheiros) e é negada a quem não é SELF/TUTOR_OF", async () => {
    const owner = await c.user("titular-exp");
    const other = await c.user("outro-exp");
    const familyId = await c.family();
    const memberId = await c.member(familyId, { userId: owner.id, role: "FAMILY_ADMIN" });
    await c.member(familyId, { userId: other.id });
    const { bookingId } = await c.seedBooking({ familyId, memberId, offer, startsAt: new Date(START.getTime() + 6 * 86_400_000), label: "Rótulo exportado" });
    const key = `consultation-proofs/final/${randomUUID()}.pdf`;
    await proofRow(bookingId, key);
    await reviewRow(bookingId);

    const items = await c.exportBookings({ userId: owner.id, platformAdmin: false }, familyId, memberId);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: bookingId, participantLabel: "Rótulo exportado", priceKz: 5000, review: { rating: 4, comment: COMMENT } });
    expect((items[0] as { paymentProofs: unknown[] }).paymentProofs).toHaveLength(1);
    expect(JSON.stringify(items)).not.toContain(key);
    await expect(c.exportBookings({ userId: other.id, platformAdmin: false }, familyId, memberId)).rejects.toThrow();
  });

  it("TC-MKT-102: purge-expired só toca nos ficheiros com startsAt há mais de 24 meses (fronteira exata), é idempotente e conserva metadados e avaliações", async () => {
    const owner = await c.user("titular-purge");
    const familyId = await c.family();
    const fixtures: { bookingId: string; proofId: string; key: string; startsAt: Date }[] = [];
    for (const startsAt of [new Date(CUTOFF.getTime() - 1000), CUTOFF, new Date(CUTOFF.getTime() + 1000)]) {
      const memberId = await c.member(familyId, fixtures.length === 0 ? { userId: owner.id, role: "FAMILY_ADMIN" } : {});
      // Um profissional por marcação: os horários de 30 min de instantes a 1 s de distância sobrepor-se-iam (EXCLUDE).
      const p = await c.professional();
      const o = await c.offer(p, { method: "IN_PERSON", durationMinutes: 30, priceKz: 5000 });
      const { bookingId } = await c.seedBooking({ familyId, memberId, offer: o, startsAt });
      const key = `consultation-proofs/final/${randomUUID()}.pdf`;
      fixtures.push({ bookingId, proofId: await proofRow(bookingId, key), key, startsAt });
    }
    const [old, boundary, recent] = fixtures;
    if (!old || !boundary || !recent) throw new Error("fixtures");
    const reviewId = await reviewRow(old.bookingId);

    expect(await c.maintenance.purgeExpired()).toEqual({ count: 1 });
    const purged = async (id: string): Promise<boolean> => (await c.h.pool.query<{ p: Date | null }>("SELECT purged_at AS p FROM payment_proofs WHERE id = $1", [id])).rows[0]?.p != null;
    expect([await purged(old.proofId), await purged(boundary.proofId), await purged(recent.proofId)]).toEqual([true, false, false]);
    expect((await c.h.pool.query("SELECT 1 FROM consultation_file_deletions WHERE storage_key = $1 AND deleted_at IS NULL", [old.key])).rowCount).toBe(1);
    expect((await c.h.pool.query("SELECT 1 FROM consultation_file_deletions WHERE storage_key = ANY($1)", [[boundary.key, recent.key]])).rowCount).toBe(0);
    expect((await c.h.pool.query("SELECT 1 FROM bookings WHERE id = $1", [old.bookingId])).rowCount).toBe(1);
    expect((await c.h.pool.query("SELECT 1 FROM reviews WHERE id = $1 AND comment = $2", [reviewId, COMMENT])).rowCount).toBe(1);

    // idempotente: a repetição não volta a enfileirar nem a contar.
    expect(await c.maintenance.purgeExpired()).toEqual({ count: 0 });
    expect((await c.h.pool.query("SELECT 1 FROM consultation_file_deletions WHERE storage_key = $1", [old.key])).rowCount).toBe(1);

    // a fronteira avança com o relógio: um segundo depois a marcação do limite também expira.
    c.h.clock.set(new Date(START.getTime() + 1000));
    expect(await c.maintenance.purgeExpired()).toEqual({ count: 1 });

    // auditoria SYSTEM só com a contagem.
    const audits = (await c.h.pool.query<{ actor_type: string; metadata: Record<string, unknown> }>("SELECT actor_type, metadata FROM audit_logs WHERE action = 'PROOF_FILES_PURGED' ORDER BY occurred_at")).rows;
    expect(audits.length).toBeGreaterThanOrEqual(3);
    for (const a of audits) {
      expect(a.actor_type).toBe("SYSTEM");
      expect(Object.keys(a.metadata)).toEqual(["count"]);
    }

    // descarregar um purgado ⇒ DOCUMENT_NOT_AVAILABLE (409).
    const memberId = (await c.h.pool.query<{ member_id: string }>("SELECT member_id FROM bookings WHERE id = $1", [old.bookingId])).rows[0]?.member_id ?? "";
    const res = await request(c.h.app).get(`${API}/families/${familyId}/members/${memberId}/bookings/${old.bookingId}/payment-proofs/${old.proofId}/file`).set("Authorization", `Bearer ${owner.token}`);
    expect(res.status).toBe(409);
    expect((res.body as { code?: string }).code).toBe("DOCUMENT_NOT_AVAILABLE");
  });
});
