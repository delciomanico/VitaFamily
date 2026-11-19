// Integração real (testcontainers + PostgreSQL 16) da migração 0045 (MK3, ADR-037, schema.md §13; TC-MKT-105/106): CHECKs de
// estado/cancelamento/slot/pagamento, UNIQUE e reservas concorrentes do mesmo horário, EXCLUDE do membro, trigger de
// imutabilidade, invariante slot.booking_id <=> bookings.slot_id, comprovativos (CHECK, UNIQUE parcial, trigger de outbox na
// cascata), avaliações (UNIQUE, CHECK, SET NULL e limpeza do comentário), denúncias, cascatas, valores novos de enum.
import { randomUUID } from "node:crypto";
import { copyFile, mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultMigrationsDir, runMigrations } from "../../db/migrate-runner.js";

interface PgError {
  code?: string;
  constraint?: string;
  message: string;
}

async function erroDe(promessa: Promise<unknown>): Promise<PgError> {
  try {
    await promessa;
  } catch (err) {
    return err as PgError;
  }
  throw new Error("esperava que a operação falhasse");
}

interface Membro { userId: string; familyId: string; memberId: string }
interface Prof { professionalId: string; specialtyId: string; offerId: string; ruleId: string }

describe("integração: migração 0045 (MK3) e restrições de consultations", () => {
  let container: StartedTestContainer;
  let pool: Pool;
  const urlDe = (bd: string) =>
    `postgres://vita:vita@${container.getHost()}:${String(container.getMappedPort(5432))}/${bd}`;

  /** Hora única e distinta por chamada (cada profissional tem os seus horários; o `seq` evita colisões acidentais). */
  const hora = (offsetHoras: number) => new Date(Date.UTC(2031, 0, 6, 8 + offsetHoras)).toISOString();
  const horaFim = (offsetHoras: number) => new Date(Date.UTC(2031, 0, 6, 8 + offsetHoras, 30)).toISOString();

  async function membro(): Promise<Membro> {
    const userId = randomUUID();
    await pool.query(
      "INSERT INTO users (id, email, password_hash, name, birth_date, timezone, terms_accepted_version, terms_accepted_at) VALUES ($1, $2, 'x', 'U', '1980-01-01', 'Europe/Lisbon', 'v1', now())",
      [userId, `u-${userId}@teste.pt`],
    );
    const familyId = randomUUID();
    const memberId = randomUUID();
    await pool.query("INSERT INTO families (id, name) VALUES ($1, 'F')", [familyId]);
    await pool.query(
      "INSERT INTO family_members (id, family_id, user_id, name, birth_date, role) VALUES ($1,$2,$3,'M','1990-01-01','FAMILY_ADMIN')",
      [memberId, familyId, userId],
    );
    return { userId, familyId, memberId };
  }

  async function profissional(preco = 5000): Promise<Prof> {
    const conta = await pool.query<{ id: string }>(
      "INSERT INTO professional_accounts (email, password_hash, terms_accepted_version, terms_accepted_at) VALUES ($1,'x','1',now()) RETURNING id",
      [`prof-${randomUUID()}@teste.pt`],
    );
    const professionalId = (await pool.query<{ id: string }>("INSERT INTO professionals (account_id) VALUES ($1) RETURNING id", [conta.rows[0]?.id])).rows[0]?.id ?? "";
    const specialtyId = (
      await pool.query<{ id: string }>("INSERT INTO specialties (name, category) VALUES ($1,'HEALTH') RETURNING id", [`Esp ${randomUUID()}`])
    ).rows[0]?.id ?? "";
    await pool.query("INSERT INTO professional_specialties (professional_id, specialty_id) VALUES ($1,$2)", [professionalId, specialtyId]);
    const offerId = (
      await pool.query<{ id: string }>(
        "INSERT INTO professional_offers (professional_id, specialty_id, method, duration_minutes, price_kz) VALUES ($1,$2,'IN_PERSON',30,$3) RETURNING id",
        [professionalId, specialtyId, preco],
      )
    ).rows[0]?.id ?? "";
    const ruleId = (
      await pool.query<{ id: string }>(
        "INSERT INTO professional_schedule_rules (professional_id, offer_id, weekdays, start_time, end_time) VALUES ($1,$2,$3,'09:00','18:00') RETURNING id",
        [professionalId, offerId, [1, 2, 3, 4, 5]],
      )
    ).rows[0]?.id ?? "";
    return { professionalId, specialtyId, offerId, ruleId };
  }

  async function horario(p: Prof, offset: number): Promise<string> {
    return (
      await pool.query<{ id: string }>(
        "INSERT INTO professional_slots (professional_id, offer_id, rule_id, starts_at, ends_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (rule_id, starts_at) DO UPDATE SET updated_at = now() RETURNING id",
        [p.professionalId, p.offerId, p.ruleId, hora(offset), horaFim(offset)],
      )
    ).rows[0]?.id ?? "";
  }

  interface Extra {
    status?: string;
    paymentStatus?: string;
    price?: number;
    slotId?: string | null;
    offset?: number;
    cols?: string;
    vals?: unknown[];
  }

  /** Insere uma marcação diretamente (sem reservar o horário); por omissão REQUESTED com horário novo. */
  async function marcacao(m: Membro, p: Prof, e: Extra = {}): Promise<string> {
    const offset = e.offset ?? 0;
    const status = e.status ?? "REQUESTED";
    const price = e.price ?? 5000;
    const libertada = status === "REJECTED" || status === "CANCELLED";
    const slotId = e.slotId !== undefined ? e.slotId : libertada ? null : await horario(p, offset);
    const id = randomUUID();
    await pool.query(
      `INSERT INTO bookings (id, family_id, member_id, professional_id, offer_id, specialty_id, method, duration_minutes, price_kz,
         starts_at, ends_at, slot_id, status, payment_status, participant_label, cancelled_by, cancelled_at, confirmed_at, completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,'IN_PERSON',30,$7,$8,$9,$10,$11,$12,'Ana',$13,$14,$15,$16)`,
      [
        id, m.familyId, m.memberId, p.professionalId, p.offerId, p.specialtyId, price, hora(offset), horaFim(offset), slotId, status,
        e.paymentStatus ?? (price === 0 ? "NOT_REQUIRED" : "AWAITING_PROOF"),
        status === "CANCELLED" ? "FAMILY" : null,
        status === "CANCELLED" ? new Date().toISOString() : null,
        ["CONFIRMED", "COMPLETED", "NO_SHOW"].includes(status) ? new Date().toISOString() : null,
        status === "COMPLETED" ? new Date().toISOString() : null,
      ],
    );
    if (slotId) await pool.query("UPDATE professional_slots SET booking_id = $1 WHERE id = $2", [id, slotId]);
    return id;
  }

  async function comprovativo(bookingId: string): Promise<string> {
    const id = randomUUID();
    await pool.query(
      "INSERT INTO payment_proofs (id, booking_id, storage_key, content_type, size_bytes) VALUES ($1,$2,$3,'application/pdf',1000)",
      [id, bookingId, `k-${id}`],
    );
    return id;
  }

  async function avaliacao(p: Prof, bookingId: string | null): Promise<string> {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO reviews (id, booking_id, professional_id, specialty_id, method, consulted_month, rating, comment)
       VALUES ($1,$2,$3,$4,'IN_PERSON','2031-01-01',4,'bom')`,
      [id, bookingId, p.professionalId, p.specialtyId],
    );
    return id;
  }

  async function conta(tabela: string, where: string, params: unknown[]): Promise<number> {
    const { rows } = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${tabela} WHERE ${where}`, params);
    return Number(rows[0]?.n);
  }

  beforeAll(async () => {
    container = await new GenericContainer("postgres:16-alpine")
      .withEnvironment({ POSTGRES_USER: "vita", POSTGRES_PASSWORD: "vita", POSTGRES_DB: "vita" })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start();
    pool = new Pool({ connectionString: urlDe("vita"), max: 10 });
    await runMigrations(pool, defaultMigrationsDir());
  }, 180_000);

  afterAll(async () => {
    await pool.end();
    await container.stop();
  });

  describe("bookings: CHECKs", () => {
    it("aceita uma marcação válida e aplica os defeitos", async () => {
      const m = await membro();
      const p = await profissional();
      const id = await marcacao(m, p);
      const { rows } = await pool.query("SELECT status, payment_status, cancelled_by FROM bookings WHERE id = $1", [id]);
      expect(rows[0]).toMatchObject({ status: "REQUESTED", payment_status: "AWAITING_PROOF", cancelled_by: null });
    });

    it("preço 0 <=> NOT_REQUIRED", async () => {
      const m = await membro();
      const p = await profissional();
      expect((await erroDe(marcacao(m, p, { price: 0, paymentStatus: "AWAITING_PROOF" }))).constraint).toBe("bookings_price_payment_check");
      expect((await erroDe(marcacao(m, p, { price: 100, paymentStatus: "NOT_REQUIRED", offset: 3 }))).constraint).toBe("bookings_price_payment_check");
      await marcacao(m, p, { price: 0, offset: 5 });
    });

    it("CANCELLED <=> cancelled_by + cancelled_at; system_reason só com SYSTEM", async () => {
      const m = await membro();
      const p = await profissional();
      const id = await marcacao(m, p, { status: "CANCELLED" });
      const livre = await horario(p, 7);
      expect((await erroDe(pool.query("UPDATE bookings SET cancelled_by = NULL WHERE id = $1", [id]))).constraint).toBe("bookings_cancelled_check");
      expect((await erroDe(pool.query("UPDATE bookings SET system_reason = 'REQUEST_EXPIRED' WHERE id = $1", [id]))).constraint).toBe("bookings_system_reason_check");
      const ok = await marcacao(m, p, { offset: 9 });
      expect((await erroDe(pool.query("UPDATE bookings SET status = 'CANCELLED', slot_id = NULL WHERE id = $1", [ok]))).constraint).toBe("bookings_cancelled_check");
      expect(livre).toBeTruthy();
    });

    it("REJECTED/CANCELLED <=> slot_id nulo", async () => {
      const m = await membro();
      const p = await profissional();
      const id = await marcacao(m, p);
      expect((await erroDe(pool.query("UPDATE bookings SET status = 'REJECTED' WHERE id = $1", [id]))).constraint).toBe("bookings_slot_released_check");
      const slot = await horario(p, 2);
      expect((await erroDe(marcacao(m, p, { status: "REJECTED", slotId: slot, offset: 2 }))).constraint).toBe("bookings_slot_released_check");
    });

    it("CONFIRMED/COMPLETED exigem confirmed_at; COMPLETED exige completed_at; REQUESTED só com pagamento por fazer", async () => {
      const m = await membro();
      const p = await profissional();
      const id = await marcacao(m, p);
      expect((await erroDe(pool.query("UPDATE bookings SET status = 'CONFIRMED' WHERE id = $1", [id]))).constraint).toBe("bookings_confirmed_at_check");
      expect((await erroDe(pool.query("UPDATE bookings SET status = 'COMPLETED', confirmed_at = now() WHERE id = $1", [id]))).constraint).toBe("bookings_completed_at_check");
      expect((await erroDe(pool.query("UPDATE bookings SET payment_status = 'CONFIRMED' WHERE id = $1", [id]))).constraint).toBe("bookings_requested_payment_check");
      await pool.query("UPDATE bookings SET status = 'CONFIRMED', confirmed_at = now(), payment_status = 'CONFIRMED' WHERE id = $1", [id]);
    });

    it.each([
      ["duração inválida", "duration_minutes = 25", "bookings_duration_check"],
      ["preço negativo", "price_kz = -1", "bookings_price_check"],
      ["fim antes do início", "ends_at = starts_at - interval '1 minute'", "bookings_range_check"],
      ["label vazia", "participant_label = '  '", "bookings_label_check"],
      ["motivo longo", "status_reason = repeat('x', 301)", "bookings_status_reason_check"],
      ["meeting_info longo", "meeting_info = repeat('x', 301)", "bookings_meeting_info_check"],
    ])("rejeita %s", async (_nome, set, constraint) => {
      const id = await marcacao(await membro(), await profissional());
      // O trigger de imutabilidade corre antes dos CHECK para campos copiados; aqui o erro esperado é o do CHECK ou do trigger.
      const erro = await erroDe(pool.query(`UPDATE bookings SET ${set} WHERE id = $1`, [id]));
      if (["bookings_duration_check", "bookings_price_check", "bookings_range_check"].includes(constraint)) {
        expect(erro.code).toBe("23000"); // trigger de imutabilidade (campos copiados) tem precedência
      } else {
        expect(erro.constraint).toBe(constraint);
      }
    });
  });

  describe("bookings: horário único, reservas concorrentes e EXCLUDE", () => {
    it("UNIQUE (slot_id): duas marcações no mesmo horário", async () => {
      const p = await profissional();
      const slot = await horario(p, 1);
      await marcacao(await membro(), p, { slotId: slot, offset: 1 });
      expect((await erroDe(marcacao(await membro(), p, { slotId: slot, offset: 1 }))).constraint).toBe("bookings_slot_uq");
    });

    it("reservas concorrentes do mesmo horário: uma só vence (UPDATE atómico) e a invariante mantém-se", async () => {
      const p = await profissional();
      const slot = await horario(p, 1);
      const membros = await Promise.all([membro(), membro(), membro(), membro(), membro()]);
      const resultados = await Promise.all(
        membros.map(async (m) => {
          const cx = await pool.connect();
          const id = randomUUID();
          try {
            await cx.query("BEGIN");
            const r = await cx.query("UPDATE professional_slots SET booking_id = $1 WHERE id = $2 AND booking_id IS NULL", [id, slot]);
            if (r.rowCount === 0) {
              await cx.query("ROLLBACK");
              return null;
            }
            await cx.query(
              `INSERT INTO bookings (id, family_id, member_id, professional_id, offer_id, specialty_id, method, duration_minutes, price_kz,
                 starts_at, ends_at, slot_id, payment_status, participant_label)
               VALUES ($1,$2,$3,$4,$5,$6,'IN_PERSON',30,5000,$7,$8,$9,'AWAITING_PROOF','Ana')`,
              [id, m.familyId, m.memberId, p.professionalId, p.offerId, p.specialtyId, hora(1), horaFim(1), slot],
            );
            await cx.query("COMMIT");
            return id;
          } catch (err) {
            await cx.query("ROLLBACK");
            throw err;
          } finally {
            cx.release();
          }
        }),
      );
      const vencedores = resultados.filter((r): r is string => r !== null);
      expect(vencedores).toHaveLength(1);
      const { rows } = await pool.query<{ booking_id: string }>("SELECT booking_id FROM professional_slots WHERE id = $1", [slot]);
      expect(rows[0]?.booking_id).toBe(vencedores[0]);
      expect(await conta("bookings", "slot_id = $1", [slot])).toBe(1);
    });

    it("a FK diferida de professional_slots.booking_id exige a marcação até ao COMMIT", async () => {
      const p = await profissional();
      const slot = await horario(p, 1);
      const cx = await pool.connect();
      try {
        await cx.query("BEGIN");
        await cx.query("UPDATE professional_slots SET booking_id = $1 WHERE id = $2", [randomUUID(), slot]);
        const erro = await erroDe(cx.query("COMMIT"));
        expect(erro.code).toBe("23503");
      } finally {
        cx.release();
      }
    });

    it("EXCLUDE: o mesmo membro não tem duas marcações ativas sobrepostas; consecutivas e terminais passam", async () => {
      const m = await membro();
      const p1 = await profissional();
      const p2 = await profissional();
      await marcacao(m, p1, { offset: 1 });
      expect((await erroDe(marcacao(m, p2, { offset: 1 }))).constraint).toBe("bookings_member_no_overlap");
      // consecutiva (09:30 não existe; usa outra hora sem sobreposição)
      await marcacao(m, p2, { offset: 2 });
      // terminal (cancelada) na mesma hora não conta
      await marcacao(m, p2, { status: "CANCELLED", offset: 1 });
      // outro membro na mesma hora passa
      await marcacao(await membro(), p2, { offset: 1 });
    });
  });

  describe("bookings: trigger de imutabilidade", () => {
    it("alterar o preço e os campos copiados falha; libertar o slot e mudar o estado passam", async () => {
      const m = await membro();
      const p = await profissional();
      const id = await marcacao(m, p);
      for (const set of ["price_kz = 1", "starts_at = starts_at + interval '1 hour'", "professional_id = gen_random_uuid()", "method = 'VIDEO'", "created_at = now() - interval '1 day'"]) {
        const erro = await erroDe(pool.query(`UPDATE bookings SET ${set} WHERE id = $1`, [id]));
        expect(erro.code).toBe("23000");
      }
      await pool.query("UPDATE bookings SET status = 'CANCELLED', slot_id = NULL, cancelled_by = 'FAMILY', cancelled_at = now() WHERE id = $1", [id]);
      expect(await conta("bookings", "id = $1 AND status = 'CANCELLED' AND slot_id IS NULL", [id])).toBe(1);
    });

    it("slot_id não pode mudar para outro horário", async () => {
      const m = await membro();
      const p = await profissional();
      const id = await marcacao(m, p);
      const outro = await horario(p, 4);
      expect((await erroDe(pool.query("UPDATE bookings SET slot_id = $1 WHERE id = $2", [outro, id]))).code).toBe("23000");
    });
  });

  describe("invariante slot.booking_id <=> bookings.slot_id e cascatas", () => {
    it("reservar, libertar e cascata do membro devolvem o horário", async () => {
      const m = await membro();
      const p = await profissional();
      const id = await marcacao(m, p);
      const slot = (await pool.query<{ slot_id: string }>("SELECT slot_id FROM bookings WHERE id = $1", [id])).rows[0]?.slot_id ?? "";
      expect(await conta("professional_slots", "id = $1 AND booking_id = $2", [slot, id])).toBe(1);
      // libertar (cancelar): a aplicação anula os dois lados
      await pool.query("UPDATE professional_slots SET booking_id = NULL WHERE id = $1", [slot]);
      await pool.query("UPDATE bookings SET status = 'CANCELLED', slot_id = NULL, cancelled_by = 'FAMILY', cancelled_at = now() WHERE id = $1", [id]);
      // cascata
      const id2 = await marcacao(m, p, { offset: 3 });
      const slot2 = (await pool.query<{ slot_id: string }>("SELECT slot_id FROM bookings WHERE id = $1", [id2])).rows[0]?.slot_id ?? "";
      await pool.query("DELETE FROM families WHERE id = $1", [m.familyId]);
      expect(await conta("bookings", "id = ANY($1)", [[id, id2]])).toBe(0);
      expect(await conta("professional_slots", "id = $1 AND booking_id IS NULL", [slot2])).toBe(1);
    });

    it("a cascata do profissional apaga marcações, horários e avaliações", async () => {
      const m = await membro();
      const p = await profissional();
      const id = await marcacao(m, p);
      const av = await avaliacao(p, id);
      await pool.query("DELETE FROM professionals WHERE id = $1", [p.professionalId]);
      expect(await conta("bookings", "id = $1", [id])).toBe(0);
      expect(await conta("reviews", "id = $1", [av])).toBe(0);
    });

    it("apagar o utilizador anula as referências de autoria", async () => {
      const m = await membro();
      const p = await profissional();
      const id = await marcacao(m, p);
      const autor = (await membro()).userId;
      await pool.query("UPDATE bookings SET created_by_user_id = $1 WHERE id = $2", [autor, id]);
      await pool.query("DELETE FROM users WHERE id = $1", [autor]);
      expect(await conta("bookings", "id = $1 AND created_by_user_id IS NULL", [id])).toBe(1);
    });

    it("a idempotência por client_request_id é por membro", async () => {
      const m = await membro();
      const p = await profissional();
      const cid = randomUUID();
      const id = await marcacao(m, p);
      await pool.query("UPDATE bookings SET client_request_id = $1 WHERE id = $2", [cid, id]);
      const id2 = await marcacao(m, p, { offset: 5 });
      expect((await erroDe(pool.query("UPDATE bookings SET client_request_id = $1 WHERE id = $2", [cid, id2]))).constraint).toBe("bookings_client_request_uq");
      const outro = await marcacao(await membro(), p, { offset: 6 });
      await pool.query("UPDATE bookings SET client_request_id = $1 WHERE id = $2", [cid, outro]);
    });
  });

  describe("payment_proofs", () => {
    it("aceita um comprovativo e aplica os defeitos; CHECK de tipo e tamanho", async () => {
      const b = await marcacao(await membro(), await profissional());
      const id = await comprovativo(b);
      const { rows } = await pool.query("SELECT status, scan_status FROM payment_proofs WHERE id = $1", [id]);
      expect(rows[0]).toMatchObject({ status: "SUBMITTED", scan_status: "PENDING" });
      expect((await erroDe(pool.query("UPDATE payment_proofs SET content_type = 'text/html' WHERE id = $1", [id]))).constraint).toBe("payment_proofs_content_type_check");
      expect((await erroDe(pool.query("UPDATE payment_proofs SET size_bytes = 10485761 WHERE id = $1", [id]))).constraint).toBe("payment_proofs_size_check");
      expect((await erroDe(pool.query("UPDATE payment_proofs SET size_bytes = 0 WHERE id = $1", [id]))).constraint).toBe("payment_proofs_size_check");
    });

    it("UNIQUE parcial: um só comprovativo em curso; um novo só depois de decidido", async () => {
      const b = await marcacao(await membro(), await profissional());
      const id = await comprovativo(b);
      expect((await erroDe(comprovativo(b))).constraint).toBe("payment_proofs_in_progress_uq");
      await pool.query("UPDATE payment_proofs SET status = 'REJECTED', decided_at = now(), decision_reason = 'ilegível' WHERE id = $1", [id]);
      await comprovativo(b);
    });

    it.each([
      ["SUBMITTED com decided_at", "UPDATE payment_proofs SET decided_at = now() WHERE id = $1", "payment_proofs_submitted_check"],
      ["CONFIRMED sem decided_at", "UPDATE payment_proofs SET status = 'CONFIRMED' WHERE id = $1", "payment_proofs_decided_check"],
      ["REJECTED sem motivo", "UPDATE payment_proofs SET status = 'REJECTED', decided_at = now() WHERE id = $1", "payment_proofs_reason_required_check"],
      ["DISPUTED sem disputed_at", "UPDATE payment_proofs SET status = 'DISPUTED', decided_at = now(), decision_reason = 'x' WHERE id = $1", "payment_proofs_disputed_check"],
      ["data de decisão sem decisão", "UPDATE payment_proofs SET dispute_decided_at = now() WHERE id = $1", "payment_proofs_dispute_pair_check"],
      [
        "REJECTION_UPHELD sem UPHOLD_REJECTION",
        "UPDATE payment_proofs SET status = 'REJECTION_UPHELD', decided_at = now(), decision_reason = 'x', disputed_at = now() WHERE id = $1",
        "payment_proofs_upheld_check",
      ],
      [
        "CONFIRM_PAYMENT com estado REJECTED",
        "UPDATE payment_proofs SET status = 'REJECTED', decided_at = now(), decision_reason = 'x', dispute_decision = 'CONFIRM_PAYMENT', dispute_decided_at = now() WHERE id = $1",
        "payment_proofs_confirm_check",
      ],
    ])("rejeita %s", async (_nome, sql, constraint) => {
      const b = await marcacao(await membro(), await profissional());
      const id = await comprovativo(b);
      expect((await erroDe(pool.query(sql, [id]))).constraint).toBe(constraint);
    });

    it("fluxo de disputa válido: DISPUTED -> CONFIRMED por CONFIRM_PAYMENT", async () => {
      const b = await marcacao(await membro(), await profissional());
      const id = await comprovativo(b);
      await pool.query("UPDATE payment_proofs SET status = 'DISPUTED', decided_at = now(), decision_reason = 'x', disputed_at = now() WHERE id = $1", [id]);
      await pool.query("UPDATE payment_proofs SET status = 'CONFIRMED', dispute_decision = 'CONFIRM_PAYMENT', dispute_decided_at = now() WHERE id = $1", [id]);
      expect(await conta("payment_proofs", "id = $1 AND status = 'CONFIRMED'", [id])).toBe(1);
    });

    it("trigger de outbox: apagar na cascata do membro enfileira o ficheiro (não o já purgado)", async () => {
      const m = await membro();
      const p = await profissional();
      const b = await marcacao(m, p);
      const a = await comprovativo(b);
      await pool.query("UPDATE payment_proofs SET status = 'REJECTED', decided_at = now(), decision_reason = 'x' WHERE id = $1", [a]);
      const purgado = await comprovativo(b);
      await pool.query("UPDATE payment_proofs SET purged_at = now() WHERE id = $1", [purgado]);
      await pool.query("DELETE FROM families WHERE id = $1", [m.familyId]);
      expect(await conta("payment_proofs", "booking_id = $1", [b])).toBe(0);
      expect(await conta("consultation_file_deletions", "storage_key = $1", [`k-${a}`])).toBe(1);
      expect(await conta("consultation_file_deletions", "storage_key = $1", [`k-${purgado}`])).toBe(0);
    });

    it("trigger de outbox também na cascata do profissional", async () => {
      const p = await profissional();
      const b = await marcacao(await membro(), p);
      const a = await comprovativo(b);
      await pool.query("DELETE FROM professionals WHERE id = $1", [p.professionalId]);
      expect(await conta("consultation_file_deletions", "storage_key = $1", [`k-${a}`])).toBe(1);
    });
  });

  describe("reviews e review_reports", () => {
    it("UNIQUE por marcação, CHECK de nota, comentário, mês e resposta", async () => {
      const p = await profissional();
      const b = await marcacao(await membro(), p);
      const id = await avaliacao(p, b);
      expect((await erroDe(avaliacao(p, b))).constraint).toBe("reviews_booking_id_key");
      expect((await erroDe(pool.query("UPDATE reviews SET rating = 6 WHERE id = $1", [id]))).constraint).toBe("reviews_rating_check");
      expect((await erroDe(pool.query("UPDATE reviews SET rating = 0 WHERE id = $1", [id]))).constraint).toBe("reviews_rating_check");
      expect((await erroDe(pool.query("UPDATE reviews SET comment = repeat('x', 501) WHERE id = $1", [id]))).constraint).toBe("reviews_comment_check");
      expect((await erroDe(pool.query("UPDATE reviews SET consulted_month = '2031-01-15' WHERE id = $1", [id]))).constraint).toBe("reviews_month_check");
      expect((await erroDe(pool.query("UPDATE reviews SET reply_text = 'ok' WHERE id = $1", [id]))).constraint).toBe("reviews_reply_pair_check");
      expect((await erroDe(pool.query("UPDATE reviews SET reply_text = '', replied_at = now() WHERE id = $1", [id]))).constraint).toBe("reviews_reply_check");
      await pool.query("UPDATE reviews SET reply_text = 'obrigado', replied_at = now() WHERE id = $1", [id]);
    });

    it("apagar a marcação anonimiza a avaliação (SET NULL) e o trigger limpa o comentário, mantendo a nota", async () => {
      const m = await membro();
      const p = await profissional();
      const b = await marcacao(m, p);
      const id = await avaliacao(p, b);
      await pool.query("DELETE FROM families WHERE id = $1", [m.familyId]);
      const { rows } = await pool.query("SELECT booking_id, comment, rating FROM reviews WHERE id = $1", [id]);
      expect(rows[0]).toMatchObject({ booking_id: null, comment: null, rating: 4 });
    });

    it("avaliações sem marcação coexistem (booking_id nulo não colide no UNIQUE)", async () => {
      const p = await profissional();
      await avaliacao(p, null);
      await avaliacao(p, null);
    });

    it("não tem colunas de autoria (anónimas)", async () => {
      const { rows } = await pool.query<{ column_name: string }>(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'reviews' AND column_name IN ('family_id','member_id','user_id')",
      );
      expect(rows).toHaveLength(0);
    });

    it("review_reports: uma por avaliação, CHECK de decisão e cascata", async () => {
      const p = await profissional();
      const av = await avaliacao(p, null);
      const id = randomUUID();
      await pool.query("INSERT INTO review_reports (id, review_id, reason) VALUES ($1,$2,'ABUSE')", [id, av]);
      expect((await erroDe(pool.query("INSERT INTO review_reports (review_id, reason) VALUES ($1,'OTHER')", [av]))).constraint).toBe("review_reports_review_id_key");
      expect((await erroDe(pool.query("UPDATE review_reports SET status = 'DECIDED', decision = 'DISMISS' WHERE id = $1", [id]))).constraint).toBe("review_reports_decided_check");
      expect((await erroDe(pool.query("UPDATE review_reports SET decision = 'DISMISS' WHERE id = $1", [id]))).constraint).toBe("review_reports_decided_check");
      expect((await erroDe(pool.query("UPDATE review_reports SET note = repeat('x', 301) WHERE id = $1", [id]))).constraint).toBe("review_reports_note_check");
      await pool.query("UPDATE review_reports SET status = 'DECIDED', decision = 'HIDE_COMMENT', decided_at = now() WHERE id = $1", [id]);
      await pool.query("DELETE FROM reviews WHERE id = $1", [av]);
      expect(await conta("review_reports", "id = $1", [id])).toBe(0);
    });
  });

  describe("appointments.booking_id e valores novos de enum", () => {
    it("UNIQUE parcial por booking_id e SET NULL ao apagar a marcação", async () => {
      const m = await membro();
      const p = await profissional();
      const b = await marcacao(m, p);
      const consulta = async () => {
        const id = randomUUID();
        await pool.query("INSERT INTO appointments (id, family_id, member_id, scheduled_at, booking_id) VALUES ($1,$2,$3,now(),$4)", [id, m.familyId, m.memberId, b]);
        return id;
      };
      const a = await consulta();
      expect((await erroDe(consulta())).constraint).toBe("appointments_booking_uq");
      await pool.query("DELETE FROM bookings WHERE id = $1", [b]);
      expect(await conta("appointments", "id = $1 AND booking_id IS NULL", [a])).toBe(1);
    });

    it("os valores novos de enum aceitam-se depois da migração", async () => {
      const { rows } = await pool.query<{ t: string; v: string }>(
        `SELECT t.typname AS t, e.enumlabel AS v FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
         WHERE (t.typname = 'process_origin_type' AND e.enumlabel = 'BOOKING')
            OR (t.typname = 'alert_type' AND e.enumlabel IN ('BOOKING_UPDATED', 'PAYMENT_UPDATED'))
            OR (t.typname = 'alert_source' AND e.enumlabel = 'BOOKING')`,
      );
      expect(rows).toHaveLength(4);
      await pool.query("SELECT 'BOOKING'::process_origin_type, 'BOOKING_UPDATED'::alert_type, 'PAYMENT_UPDATED'::alert_type, 'BOOKING'::alert_source");
    });
  });

  describe("migração sobre BD com dados", () => {
    it("a 0045 não altera linhas anteriores e deixa os horários livres", async () => {
      const c = await new GenericContainer("postgres:16-alpine")
        .withEnvironment({ POSTGRES_USER: "vita", POSTGRES_PASSWORD: "vita", POSTGRES_DB: "vita" })
        .withExposedPorts(5432)
        .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
        .start();
      const velho = new Pool({ connectionString: `postgres://vita:vita@${c.getHost()}:${String(c.getMappedPort(5432))}/vita` });
      try {
        const dir = await mkdtemp(join(tmpdir(), "mig-"));
        for (const f of (await readdir(defaultMigrationsDir())).filter((x) => x.endsWith(".sql") && Number(x.slice(0, 4)) < 45)) {
          await copyFile(join(defaultMigrationsDir(), f), join(dir, f));
        }
        await runMigrations(velho, dir);
        const conta1 = await velho.query<{ id: string }>(
          "INSERT INTO professional_accounts (email, password_hash, terms_accepted_version, terms_accepted_at) VALUES ('a@t.pt','x','1',now()) RETURNING id",
        );
        const prof = (await velho.query<{ id: string }>("INSERT INTO professionals (account_id) VALUES ($1) RETURNING id", [conta1.rows[0]?.id])).rows[0]?.id;
        const esp = (await velho.query<{ id: string }>("INSERT INTO specialties (name, category) VALUES ('Esp','HEALTH') RETURNING id")).rows[0]?.id;
        await velho.query("INSERT INTO professional_specialties VALUES ($1,$2)", [prof, esp]);
        const of = (await velho.query<{ id: string }>("INSERT INTO professional_offers (professional_id, specialty_id, method, duration_minutes, price_kz) VALUES ($1,$2,'VIDEO',30,0) RETURNING id", [prof, esp])).rows[0]?.id;
        const rg = (await velho.query<{ id: string }>("INSERT INTO professional_schedule_rules (professional_id, offer_id, weekdays, start_time, end_time) VALUES ($1,$2,'{1}','09:00','10:00') RETURNING id", [prof, of])).rows[0]?.id;
        await velho.query("INSERT INTO professional_slots (professional_id, offer_id, rule_id, starts_at, ends_at) VALUES ($1,$2,$3,'2031-01-06T09:00Z','2031-01-06T09:30Z')", [prof, of, rg]);
        const antes = await velho.query("SELECT * FROM professional_slots");
        await runMigrations(velho, defaultMigrationsDir());
        const depois = await velho.query("SELECT * FROM professional_slots");
        expect(depois.rows).toHaveLength(1);
        expect(depois.rows[0]).toMatchObject({ ...antes.rows[0], booking_id: null });
      } finally {
        await velho.end();
        await c.stop();
      }
    }, 240_000);
  });
});
