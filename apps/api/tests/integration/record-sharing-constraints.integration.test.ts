// Integração real (testcontainers + PostgreSQL 16) da migração 0046 (MK4, ADR-037, schema.md §14; TC-MKT-115/116): partilhas de
// registos (CHECKs de prazo, estado, categorias, rótulo e contadores; UNIQUE de idempotência; trigger de imutabilidade e de estado
// terminal; abertura concorrente de visualização única; contador sem lacunas), vistas imutáveis, cascatas e receitas digitais
// (colunas aditivas em prescriptions: CHECK de origem, UNIQUE parcial por marcação, SET NULL).
import { randomUUID } from "node:crypto";
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

const DIA_MS = 86_400_000;

describe("integração: migração 0046 (MK4) — partilha de registos e receitas digitais", () => {
  let container: StartedTestContainer;
  let pool: Pool;
  const urlDe = (bd: string) =>
    `postgres://vita:vita@${container.getHost()}:${String(container.getMappedPort(5432))}/${bd}`;

  /** Hora única e distinta por chamada (cada profissional tem os seus horários; o `seq` evita colisões acidentais). */
  const hora = (offsetHoras: number) => new Date(Date.UTC(2031, 0, 6, 8 + offsetHoras)).toISOString();
  const horaFim = (offsetHoras: number) => new Date(Date.UTC(2031, 0, 6, 8 + offsetHoras, 30)).toISOString();

  async function utilizador(): Promise<string> {
    const userId = randomUUID();
    await pool.query(
      "INSERT INTO users (id, email, password_hash, name, birth_date, timezone, terms_accepted_version, terms_accepted_at) VALUES ($1, $2, 'x', 'U', '1980-01-01', 'Europe/Lisbon', 'v1', now())",
      [userId, `u-${userId}@teste.pt`],
    );
    return userId;
  }

  async function membro(): Promise<Membro> {
    const userId = await utilizador();
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

  /**
   * Insere uma partilha ACTIVE por omissão (rótulo 'Ana', HEALTH, ALLERGIES, H24, expira em 1 dia).
   * `extra` sobrepõe colunas; os nomes de coluna são fixos no código dos testes, nunca vêm do exterior.
   */
  async function partilha(m: Membro, p: Prof, bookingId: string, extra: Record<string, unknown> = {}): Promise<string> {
    const id = randomUUID();
    const valores: Record<string, unknown> = {
      id,
      family_id: m.familyId,
      member_id: m.memberId,
      professional_id: p.professionalId,
      booking_id: bookingId,
      participant_label: "Ana",
      professional_category: "HEALTH",
      categories: ["ALLERGIES"],
      validity: "H24",
      expires_at: new Date(Date.now() + DIA_MS),
      ...extra,
    };
    const colunas = Object.keys(valores);
    const marcas = colunas.map((_, i) => `$${String(i + 1)}`);
    await pool.query(`INSERT INTO record_shares (${colunas.join(", ")}) VALUES (${marcas.join(", ")})`, Object.values(valores));
    return id;
  }

  async function receita(m: Membro, issuedBy: string, profissionalId: string | null, bookingId: string | null): Promise<string> {
    const id = randomUUID();
    await pool.query(
      "INSERT INTO prescriptions (id, family_id, member_id, issued_on, issued_by, issued_by_professional_id, booking_id) VALUES ($1,$2,$3,current_date,$4,$5,$6)",
      [id, m.familyId, m.memberId, issuedBy, profissionalId, bookingId],
    );
    return id;
  }

  /** Abre a visualização única numa transação própria (BEGIN/UPDATE/COMMIT); devolve quantas linhas foram afetadas (0 ou 1). */
  async function abrirVistaUnica(id: string): Promise<number> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<{ id: string }>(
        "UPDATE record_shares SET status = 'CONSUMED', consumed_at = now(), view_count = 1, last_viewed_at = now() WHERE id = $1 AND status = 'ACTIVE' RETURNING id",
        [id],
      );
      await client.query("COMMIT");
      return rows.length;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
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

  describe("record_shares: defaults, CHECKs e UNIQUE (TC-MKT-115)", () => {
    it("aceita uma partilha válida e aplica os defeitos", async () => {
      const m = await membro();
      const p = await profissional();
      const b = await marcacao(m, p, { status: "CONFIRMED", offset: 0 });
      const id = await partilha(m, p, b);
      const { rows } = await pool.query<{ status: string; view_count: number; view_once: boolean; last_viewed_at: Date | null }>(
        "SELECT status, view_count, view_once, last_viewed_at FROM record_shares WHERE id = $1",
        [id],
      );
      expect(rows[0]).toMatchObject({ status: "ACTIVE", view_count: 0, view_once: false, last_viewed_at: null });
    });

    it("expires_at: > created_at + 30 dias falha; exatamente 30 dias aceita; <= created_at falha", async () => {
      const m = await membro();
      const p = await profissional();
      const b = await marcacao(m, p, { status: "CONFIRMED", offset: 1 });
      const criada = new Date("2031-02-01T00:00:00Z");
      const trintaDias = 30 * DIA_MS;

      const acima = await erroDe(partilha(m, p, b, { created_at: criada, expires_at: new Date(criada.getTime() + trintaDias + DIA_MS) }));
      expect(acima.code).toBe("23514");
      expect(acima.constraint).toBe("record_shares_expiry_check");

      await partilha(m, p, b, { created_at: criada, expires_at: new Date(criada.getTime() + trintaDias) });

      const igual = await erroDe(partilha(m, p, b, { created_at: criada, expires_at: criada }));
      expect(igual.code).toBe("23514");
      expect(igual.constraint).toBe("record_shares_expiry_check");

      const anterior = await erroDe(partilha(m, p, b, { created_at: criada, expires_at: new Date(criada.getTime() - DIA_MS) }));
      expect(anterior.code).toBe("23514");
      expect(anterior.constraint).toBe("record_shares_expiry_check");
    });

    it("estado: REVOKED exige revoked_at e ACTIVE não o admite; CONSUMED exige view_once, consumed_at e view_count 1", async () => {
      const m = await membro();
      const p = await profissional();
      const b = await marcacao(m, p, { status: "CONFIRMED", offset: 2 });
      const agora = new Date();

      const revogadaSem = await erroDe(partilha(m, p, b, { status: "REVOKED" }));
      expect(revogadaSem.code).toBe("23514");
      expect(revogadaSem.constraint).toBe("record_shares_revoked_check");

      const activaCom = await erroDe(partilha(m, p, b, { status: "ACTIVE", revoked_at: agora }));
      expect(activaCom.code).toBe("23514");
      expect(activaCom.constraint).toBe("record_shares_revoked_check");

      const consumidaSemViewOnce = await erroDe(
        partilha(m, p, b, { status: "CONSUMED", consumed_at: agora, view_count: 1, last_viewed_at: agora, view_once: false }),
      );
      expect(consumidaSemViewOnce.code).toBe("23514");
      expect(consumidaSemViewOnce.constraint).toBe("record_shares_consumed_view_once_check");

      await partilha(m, p, b, { status: "CONSUMED", consumed_at: agora, view_count: 1, last_viewed_at: agora, view_once: true });

      const consumidaSemContagem = await erroDe(
        partilha(m, p, b, { status: "CONSUMED", consumed_at: agora, view_count: 0, last_viewed_at: null, view_once: true }),
      );
      expect(consumidaSemContagem.code).toBe("23514");
      expect(consumidaSemContagem.constraint).toBe("record_shares_consumed_count_check");
    });

    it("categorias: vazio falha; duplicados falham; 6 elementos falham (só há 5 valores); 5 distintas aceita", async () => {
      const m = await membro();
      const p = await profissional();
      const b = await marcacao(m, p, { status: "CONFIRMED", offset: 3 });

      const vazio = await erroDe(partilha(m, p, b, { categories: [] }));
      expect(vazio.code).toBe("23514");
      expect(vazio.constraint).toBe("record_shares_categories_size_check");

      const duplicadas = await erroDe(partilha(m, p, b, { categories: ["ALLERGIES", "ALLERGIES"] }));
      expect(duplicadas.code).toBe("23514");
      expect(duplicadas.constraint).toBe("record_shares_categories_distinct_check");

      // Seis elementos (com repetições, já que só há 5 valores): falha pelo tamanho (o CHECK de distintos também falha).
      const seis = await erroDe(partilha(m, p, b, { categories: Array.from({ length: 6 }, () => "ALLERGIES") }));
      expect(seis.code).toBe("23514");

      const cincoDistintas = ["ALLERGIES", "CONDITIONS", "MEDICATION", "APPOINTMENTS", "EXAMS"];
      const id = await partilha(m, p, b, { categories: cincoDistintas });
      const { rows } = await pool.query<{ n: number }>("SELECT cardinality(categories) AS n FROM record_shares WHERE id = $1", [id]);
      expect(rows[0]?.n).toBe(5);
    });

    it("view_count negativo falha; view_count > 0 sem last_viewed_at falha", async () => {
      const m = await membro();
      const p = await profissional();
      const b = await marcacao(m, p, { status: "CONFIRMED", offset: 4 });

      const negativo = await erroDe(partilha(m, p, b, { view_count: -1, last_viewed_at: new Date() }));
      expect(negativo.code).toBe("23514");
      expect(negativo.constraint).toBe("record_shares_view_count_check");

      const semData = await erroDe(partilha(m, p, b, { view_count: 2, last_viewed_at: null }));
      expect(semData.code).toBe("23514");
      expect(semData.constraint).toBe("record_shares_last_viewed_check");
    });

    it("participant_label: vazio, só espaços e mais de 40 caracteres falham; 40 aceita", async () => {
      const m = await membro();
      const p = await profissional();
      const b = await marcacao(m, p, { status: "CONFIRMED", offset: 5 });

      for (const rotulo of ["", "   ", "x".repeat(41)]) {
        const e = await erroDe(partilha(m, p, b, { participant_label: rotulo }));
        expect(e.code).toBe("23514");
        expect(e.constraint).toBe("record_shares_label_check");
      }

      await partilha(m, p, b, { participant_label: "x".repeat(40) });
    });

    it("UNIQUE parcial (member_id, client_request_id): repetido falha; nulos aceitam; mesmo id noutro membro aceita", async () => {
      const m = await membro();
      const p = await profissional();
      const b = await marcacao(m, p, { status: "CONFIRMED", offset: 6 });
      const cid = randomUUID();

      await partilha(m, p, b, { client_request_id: cid });
      const repetido = await erroDe(partilha(m, p, b, { client_request_id: cid }));
      expect(repetido.code).toBe("23505");
      expect(repetido.constraint).toBe("record_shares_client_request_uq");

      await partilha(m, p, b);
      await partilha(m, p, b);
      expect(await conta("record_shares", "member_id = $1 AND client_request_id IS NULL", [m.memberId])).toBe(2);

      const outro = await membro();
      const bOutro = await marcacao(outro, p, { status: "CONFIRMED", offset: 7 });
      await partilha(outro, p, bOutro, { client_request_id: cid });
      expect(await conta("record_shares", "client_request_id = $1", [cid])).toBe(2);
    });
  });

  describe("record_shares: trigger de imutabilidade e estado terminal (TC-MKT-115)", () => {
    it("UPDATE de colunas imutáveis falha (23000)", async () => {
      const m = await membro();
      const p = await profissional();
      const p2 = await profissional();
      const b = await marcacao(m, p, { status: "CONFIRMED", offset: 0 });
      const b2 = await marcacao(m, p, { status: "CONFIRMED", offset: 1 });
      const s = await partilha(m, p, b);

      const erros = await Promise.all([
        erroDe(pool.query("UPDATE record_shares SET expires_at = now() + interval '2 days' WHERE id = $1", [s])),
        erroDe(pool.query("UPDATE record_shares SET categories = ARRAY['EXAMS']::data_category[] WHERE id = $1", [s])),
        erroDe(pool.query("UPDATE record_shares SET professional_id = $2 WHERE id = $1", [s, p2.professionalId])),
        erroDe(pool.query("UPDATE record_shares SET booking_id = $2 WHERE id = $1", [s, b2])),
        erroDe(pool.query("UPDATE record_shares SET participant_label = 'Outra' WHERE id = $1", [s])),
        erroDe(pool.query("UPDATE record_shares SET validity = 'D7' WHERE id = $1", [s])),
        erroDe(pool.query("UPDATE record_shares SET view_once = true WHERE id = $1", [s])),
      ]);
      expect(erros.map((e) => e.code)).toEqual(["23000", "23000", "23000", "23000", "23000", "23000", "23000"]);
    });

    it("ACTIVE -> REVOKED (revoked_at) aceita; depois de REVOKED, status/revoked_at/view_count não mudam", async () => {
      const m = await membro();
      const p = await profissional();
      const b = await marcacao(m, p, { status: "CONFIRMED", offset: 2 });
      const r = await partilha(m, p, b);

      await pool.query("UPDATE record_shares SET status = 'REVOKED', revoked_at = now() WHERE id = $1", [r]);
      const { rows } = await pool.query<{ status: string; revoked_at: Date | null }>("SELECT status, revoked_at FROM record_shares WHERE id = $1", [r]);
      expect(rows[0]).toMatchObject({ status: "REVOKED" });
      expect(rows[0]?.revoked_at).not.toBeNull();

      const depois = await Promise.all([
        erroDe(pool.query("UPDATE record_shares SET status = 'ACTIVE' WHERE id = $1", [r])),
        erroDe(pool.query("UPDATE record_shares SET revoked_at = NULL WHERE id = $1", [r])),
        erroDe(pool.query("UPDATE record_shares SET view_count = 1, last_viewed_at = now() WHERE id = $1", [r])),
      ]);
      expect(depois.map((e) => e.code)).toEqual(["23000", "23000", "23000"]);
    });

    it("ACTIVE -> CONSUMED (view_once) aceita e depois nada no estado muda", async () => {
      const m = await membro();
      const p = await profissional();
      const b = await marcacao(m, p, { status: "CONFIRMED", offset: 3 });
      const s = await partilha(m, p, b, { view_once: true });

      await pool.query(
        "UPDATE record_shares SET status = 'CONSUMED', consumed_at = now(), view_count = 1, last_viewed_at = now() WHERE id = $1",
        [s],
      );
      const { rows } = await pool.query<{ status: string; view_count: number }>("SELECT status, view_count FROM record_shares WHERE id = $1", [s]);
      expect(rows[0]).toMatchObject({ status: "CONSUMED", view_count: 1 });

      const depois = await Promise.all([
        erroDe(pool.query("UPDATE record_shares SET view_count = 2, last_viewed_at = now() WHERE id = $1", [s])),
        erroDe(pool.query("UPDATE record_shares SET status = 'REVOKED', revoked_at = now() WHERE id = $1", [s])),
      ]);
      expect(depois.map((e) => e.code)).toEqual(["23000", "23000"]);
    });

    it("incrementar view_count e last_viewed_at em ACTIVE aceita", async () => {
      const m = await membro();
      const p = await profissional();
      const b = await marcacao(m, p, { status: "CONFIRMED", offset: 4 });
      const s = await partilha(m, p, b);

      await pool.query("UPDATE record_shares SET view_count = view_count + 1, last_viewed_at = now() WHERE id = $1", [s]);
      const { rows } = await pool.query<{ view_count: number; last_viewed_at: Date | null }>(
        "SELECT view_count, last_viewed_at FROM record_shares WHERE id = $1",
        [s],
      );
      expect(rows[0]?.view_count).toBe(1);
      expect(rows[0]?.last_viewed_at).not.toBeNull();
    });

    it("abertura concorrente de visualização única: exatamente uma transação consegue o UPDATE", async () => {
      const m = await membro();
      const p = await profissional();
      const b = await marcacao(m, p, { status: "CONFIRMED", offset: 5 });
      const s = await partilha(m, p, b, { view_once: true });

      const resultados = await Promise.all([abrirVistaUnica(s), abrirVistaUnica(s)]);
      expect([...resultados].sort((x, y) => x - y)).toEqual([0, 1]);

      const { rows } = await pool.query<{ status: string; view_count: number }>("SELECT status, view_count FROM record_shares WHERE id = $1", [s]);
      expect(rows[0]).toMatchObject({ status: "CONSUMED", view_count: 1 });
    });

    it("view_count sem lacunas com 10 UPDATEs concorrentes; views com view_no 1..10 aceitam", async () => {
      const m = await membro();
      const p = await profissional();
      const b = await marcacao(m, p, { status: "CONFIRMED", offset: 6 });
      const s = await partilha(m, p, b);

      const valores = await Promise.all(
        Array.from({ length: 10 }, () =>
          pool
            .query<{ view_count: number }>(
              "UPDATE record_shares SET view_count = view_count + 1, last_viewed_at = now() WHERE id = $1 AND status = 'ACTIVE' RETURNING view_count",
              [s],
            )
            .then((r) => r.rows[0]?.view_count ?? 0),
        ),
      );
      expect([...valores].sort((x, y) => x - y)).toEqual(Array.from({ length: 10 }, (_, i) => i + 1));

      await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          pool.query("INSERT INTO record_share_views (share_id, view_no, categories) VALUES ($1, $2, $3)", [s, i + 1, ["ALLERGIES"]]),
        ),
      );
      expect(await conta("record_share_views", "share_id = $1", [s])).toBe(10);
    });
  });

  describe("cascatas de record_shares (TC-MKT-115)", () => {
    it("apagar o membro apaga partilhas e vistas", async () => {
      const m = await membro();
      const p = await profissional();
      const b = await marcacao(m, p, { status: "CONFIRMED", offset: 0 });
      const s = await partilha(m, p, b);
      await pool.query("INSERT INTO record_share_views (share_id, view_no, categories) VALUES ($1, 1, ARRAY['ALLERGIES']::data_category[])", [s]);

      await pool.query("DELETE FROM family_members WHERE id = $1", [m.memberId]);
      expect(await conta("record_shares", "id = $1", [s])).toBe(0);
      expect(await conta("record_share_views", "share_id = $1", [s])).toBe(0);
    });

    it("apagar a família apaga partilhas e vistas", async () => {
      const m = await membro();
      const p = await profissional();
      const b = await marcacao(m, p, { status: "CONFIRMED", offset: 1 });
      const s = await partilha(m, p, b);
      await pool.query("INSERT INTO record_share_views (share_id, view_no, categories) VALUES ($1, 1, ARRAY['ALLERGIES']::data_category[])", [s]);

      await pool.query("DELETE FROM families WHERE id = $1", [m.familyId]);
      expect(await conta("record_shares", "id = $1", [s])).toBe(0);
      expect(await conta("record_share_views", "share_id = $1", [s])).toBe(0);
    });

    it("apagar o profissional apaga partilhas e vistas", async () => {
      const m = await membro();
      const p = await profissional();
      const b = await marcacao(m, p, { status: "CONFIRMED", offset: 2 });
      const s = await partilha(m, p, b);
      await pool.query("INSERT INTO record_share_views (share_id, view_no, categories) VALUES ($1, 1, ARRAY['ALLERGIES']::data_category[])", [s]);

      await pool.query("DELETE FROM professionals WHERE id = $1", [p.professionalId]);
      expect(await conta("record_shares", "id = $1", [s])).toBe(0);
      expect(await conta("record_share_views", "share_id = $1", [s])).toBe(0);
    });

    it("apagar a marcação apaga partilhas e vistas", async () => {
      const m = await membro();
      const p = await profissional();
      const b = await marcacao(m, p, { status: "CONFIRMED", offset: 3 });
      const s = await partilha(m, p, b);
      await pool.query("INSERT INTO record_share_views (share_id, view_no, categories) VALUES ($1, 1, ARRAY['ALLERGIES']::data_category[])", [s]);

      await pool.query("DELETE FROM bookings WHERE id = $1", [b]);
      expect(await conta("record_shares", "id = $1", [s])).toBe(0);
      expect(await conta("record_share_views", "share_id = $1", [s])).toBe(0);
    });

    it("apagar o utilizador criador/revogador deixa autoria a NULL (também numa partilha REVOKED)", async () => {
      const autor = await utilizador();
      const m = await membro();
      const p = await profissional();
      const b1 = await marcacao(m, p, { status: "CONFIRMED", offset: 4 });
      const b2 = await marcacao(m, p, { status: "CONFIRMED", offset: 5 });
      const ativa = await partilha(m, p, b1, { created_by_user_id: autor });
      const revogada = await partilha(m, p, b2, {
        created_by_user_id: autor,
        status: "REVOKED",
        revoked_at: new Date(),
        revoked_by_user_id: autor,
      });

      await pool.query("DELETE FROM users WHERE id = $1", [autor]);

      const { rows } = await pool.query<{ id: string; status: string; created_by_user_id: string | null; revoked_by_user_id: string | null }>(
        "SELECT id, status, created_by_user_id, revoked_by_user_id FROM record_shares WHERE id = ANY($1::uuid[]) ORDER BY id",
        [[ativa, revogada]],
      );
      const porId = new Map(rows.map((r) => [r.id, r]));
      expect(porId.get(ativa)).toMatchObject({ status: "ACTIVE", created_by_user_id: null, revoked_by_user_id: null });
      expect(porId.get(revogada)).toMatchObject({ status: "REVOKED", created_by_user_id: null, revoked_by_user_id: null });
    });
  });

  describe("record_share_views (TC-MKT-115)", () => {
    it("UNIQUE (share_id, view_no), CHECKs de view_no e categorias; UPDATE falha; DELETE direto aceita", async () => {
      const m = await membro();
      const p = await profissional();
      const b = await marcacao(m, p, { status: "CONFIRMED", offset: 0 });
      const s = await partilha(m, p, b);

      await pool.query("INSERT INTO record_share_views (share_id, view_no, categories) VALUES ($1, 1, ARRAY['ALLERGIES']::data_category[])", [s]);

      const repetida = await erroDe(
        pool.query("INSERT INTO record_share_views (share_id, view_no, categories) VALUES ($1, 1, ARRAY['ALLERGIES']::data_category[])", [s]),
      );
      expect(repetida.code).toBe("23505");
      expect(repetida.constraint).toBe("record_share_views_uq");

      const zero = await erroDe(
        pool.query("INSERT INTO record_share_views (share_id, view_no, categories) VALUES ($1, 0, ARRAY['ALLERGIES']::data_category[])", [s]),
      );
      expect(zero.code).toBe("23514");
      expect(zero.constraint).toBe("record_share_views_no_check");

      const semCategorias = await erroDe(pool.query("INSERT INTO record_share_views (share_id, view_no, categories) VALUES ($1, 2, $2)", [s, []]));
      expect(semCategorias.code).toBe("23514");
      expect(semCategorias.constraint).toBe("record_share_views_categories_check");

      const alterada = await erroDe(pool.query("UPDATE record_share_views SET categories = ARRAY['EXAMS']::data_category[] WHERE share_id = $1", [s]));
      expect(alterada.code).toBe("23000");

      await pool.query("DELETE FROM record_share_views WHERE share_id = $1", [s]);
      expect(await conta("record_share_views", "share_id = $1", [s])).toBe(0);
    });
  });

  describe("prescriptions: receita digital (TC-MKT-116)", () => {
    it("CHECK de origem: PROFESSIONAL com profissional e marcação aceita; FAMILY (ou omitido) com marcação ou profissional falha", async () => {
      const m = await membro();
      const p = await profissional();
      const b = await marcacao(m, p, { status: "CONFIRMED", offset: 0 });
      await receita(m, "PROFESSIONAL", p.professionalId, b);

      const bFamilia = await marcacao(m, p, { status: "CONFIRMED", offset: 1 });
      const familiaComMarcacao = await erroDe(receita(m, "FAMILY", null, bFamilia));
      expect(familiaComMarcacao.code).toBe("23514");
      expect(familiaComMarcacao.constraint).toBe("prescriptions_professional_origin_check");

      const omitidoComMarcacao = await erroDe(
        pool.query("INSERT INTO prescriptions (id, family_id, member_id, issued_on, booking_id) VALUES ($1,$2,$3,current_date,$4)", [
          randomUUID(),
          m.familyId,
          m.memberId,
          bFamilia,
        ]),
      );
      expect(omitidoComMarcacao.code).toBe("23514");
      expect(omitidoComMarcacao.constraint).toBe("prescriptions_professional_origin_check");

      const familiaComProfissional = await erroDe(receita(m, "FAMILY", p.professionalId, null));
      expect(familiaComProfissional.code).toBe("23514");
      expect(familiaComProfissional.constraint).toBe("prescriptions_professional_origin_check");
    });

    it("UNIQUE parcial por marcação: segunda receita da mesma marcação falha; apagada a primeira, aceita de novo; NULLs aceitam", async () => {
      const m = await membro();
      const p = await profissional();
      const b = await marcacao(m, p, { status: "CONFIRMED", offset: 2 });
      const primeira = await receita(m, "PROFESSIONAL", p.professionalId, b);

      const segunda = await erroDe(receita(m, "PROFESSIONAL", p.professionalId, b));
      expect(segunda.code).toBe("23505");
      expect(segunda.constraint).toBe("prescriptions_booking_uq");

      await pool.query("DELETE FROM prescriptions WHERE id = $1", [primeira]);
      await receita(m, "PROFESSIONAL", p.professionalId, b);

      await receita(m, "FAMILY", null, null);
      await receita(m, "FAMILY", null, null);
      expect(await conta("prescriptions", "member_id = $1 AND booking_id IS NULL", [m.memberId])).toBe(2);
    });

    it("apagar o profissional mantém a receita com colunas novas a NULL e issued_by PROFESSIONAL", async () => {
      const m = await membro();
      const p = await profissional();
      const b = await marcacao(m, p, { status: "CONFIRMED", offset: 3 });
      const id = await receita(m, "PROFESSIONAL", p.professionalId, b);

      await pool.query("DELETE FROM professionals WHERE id = $1", [p.professionalId]);

      const { rows } = await pool.query<{ issued_by: string; issued_by_professional_id: string | null; booking_id: string | null }>(
        "SELECT issued_by::text AS issued_by, issued_by_professional_id, booking_id FROM prescriptions WHERE id = $1",
        [id],
      );
      expect(rows[0]).toMatchObject({ issued_by: "PROFESSIONAL", issued_by_professional_id: null, booking_id: null });
    });

    it("apagar a marcação faz SET NULL de booking_id e mantém o profissional e issued_by PROFESSIONAL", async () => {
      const m = await membro();
      const p = await profissional();
      const b = await marcacao(m, p, { status: "CONFIRMED", offset: 4 });
      const id = await receita(m, "PROFESSIONAL", p.professionalId, b);

      await pool.query("DELETE FROM bookings WHERE id = $1", [b]);

      const { rows } = await pool.query<{ issued_by: string; issued_by_professional_id: string | null; booking_id: string | null }>(
        "SELECT issued_by::text AS issued_by, issued_by_professional_id, booking_id FROM prescriptions WHERE id = $1",
        [id],
      );
      expect(rows[0]).toMatchObject({ issued_by: "PROFESSIONAL", issued_by_professional_id: p.professionalId, booking_id: null });
    });

    it("receitas existentes: INSERT sem as colunas novas aceita (issued_by FAMILY, colunas novas NULL)", async () => {
      const m = await membro();
      const id = randomUUID();
      await pool.query("INSERT INTO prescriptions (id, family_id, member_id, issued_on) VALUES ($1,$2,$3,current_date)", [id, m.familyId, m.memberId]);

      const { rows } = await pool.query<{ issued_by: string; issued_by_professional_id: string | null; booking_id: string | null }>(
        "SELECT issued_by::text AS issued_by, issued_by_professional_id, booking_id FROM prescriptions WHERE id = $1",
        [id],
      );
      expect(rows[0]).toMatchObject({ issued_by: "FAMILY", issued_by_professional_id: null, booking_id: null });
    });
  });
});
