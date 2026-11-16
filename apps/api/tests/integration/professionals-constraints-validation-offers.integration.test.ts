// Integração real (testcontainers + PostgreSQL 16) da migração 0043 (MK1, ADR-037, schema.md §11): histórico de validação
// imutável (trigger + SET NULL em decided_by), CHECKs e FKs compostas das ofertas, horários e bloqueios, UNIQUE parcial das
// ofertas ativas e cascatas do profissional. Só SQL cru (pool.query), sem repositórios.
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultMigrationsDir, runMigrations } from "../../db/migrate-runner.js";

/** Erro devolvido pelo PostgreSQL (pg.DatabaseError): SQLSTATE em `code` e nome da restrição em `constraint`. */
interface PgError {
  code?: string;
  constraint?: string;
  message: string;
}

/** Espera que a promessa falhe e devolve o erro; falha o teste se a operação for aceite. */
async function erroDe(promessa: Promise<unknown>): Promise<PgError> {
  try {
    await promessa;
  } catch (err) {
    return err as PgError;
  }
  throw new Error("esperava que a operação falhasse");
}

describe("integração: validação, ofertas, horários, bloqueios e cascatas (migração 0043)", () => {
  let container: StartedTestContainer;
  let pool: Pool;

  /** Utilizador da plataforma (admin que decide a validação). Colunas NOT NULL de `users` preenchidas. */
  async function criarUtilizador(): Promise<string> {
    const id = randomUUID();
    await pool.query(
      "INSERT INTO users (id, email, password_hash, name, birth_date, timezone, terms_accepted_version, terms_accepted_at) VALUES ($1, $2, 'x', 'Admin', '1980-01-01', 'Europe/Lisbon', 'v1', now())",
      [id, `admin-${randomUUID()}@teste.pt`],
    );
    return id;
  }

  /** Conta e perfil de profissional (estado DRAFT). */
  async function criarProfissional(): Promise<{ accountId: string; professionalId: string }> {
    const accountId = randomUUID();
    await pool.query(
      "INSERT INTO professional_accounts (id, email, password_hash, terms_accepted_version, terms_accepted_at) VALUES ($1, $2, 'x', 'v1', now())",
      [accountId, `prof-${randomUUID()}@teste.pt`],
    );
    const professionalId = randomUUID();
    await pool.query("INSERT INTO professionals (id, account_id) VALUES ($1, $2)", [professionalId, accountId]);
    return { accountId, professionalId };
  }

  /** Especialidade do catálogo (nome único por construção). */
  async function criarEspecialidade(): Promise<string> {
    const id = randomUUID();
    await pool.query("INSERT INTO specialties (id, name, category) VALUES ($1, $2, 'HEALTH')", [id, `Esp ${randomUUID()}`]);
    return id;
  }

  /** Liga uma especialidade a um profissional (pré-requisito das ofertas). */
  async function ligarEspecialidade(professionalId: string, specialtyId: string): Promise<void> {
    await pool.query("INSERT INTO professional_specialties (professional_id, specialty_id) VALUES ($1, $2)", [professionalId, specialtyId]);
  }

  /** Oferta válida por defeito (presencial, 30 min, 5000 Kz), com a especialidade já ligada ao profissional. */
  async function criarOferta(professionalId: string, specialtyId: string, extra: { method?: string; durationMinutes?: number; active?: boolean } = {}): Promise<string> {
    const id = randomUUID();
    await pool.query(
      "INSERT INTO professional_offers (id, professional_id, specialty_id, method, duration_minutes, price_kz, active) VALUES ($1, $2, $3, $4, $5, 5000, $6)",
      [id, professionalId, specialtyId, extra.method ?? "IN_PERSON", extra.durationMinutes ?? 30, extra.active ?? true],
    );
    return id;
  }

  /** Regra de horário válida por defeito (seg/qua/sex, 09:00–12:00) para uma oferta do profissional. */
  async function criarRegra(professionalId: string, offerId: string, weekdays: number[] = [1, 3, 5]): Promise<string> {
    const id = randomUUID();
    await pool.query(
      "INSERT INTO professional_schedule_rules (id, professional_id, offer_id, weekdays, start_time, end_time) VALUES ($1, $2, $3, $4, '09:00', '12:00')",
      [id, professionalId, offerId, weekdays],
    );
    return id;
  }

  beforeAll(async () => {
    container = await new GenericContainer("postgres:16-alpine")
      .withEnvironment({ POSTGRES_USER: "vita", POSTGRES_PASSWORD: "vita", POSTGRES_DB: "vita" })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start();
    pool = new Pool({ connectionString: `postgres://vita:vita@${container.getHost()}:${String(container.getMappedPort(5432))}/vita` });
    await runMigrations(pool, defaultMigrationsDir());
  }, 180_000);

  afterAll(async () => {
    await pool.end();
    await container.stop();
  });

  describe("validation_cases: histórico imutável", () => {
    it("aceita uma linha válida de submissão feita pelo profissional", async () => {
      const { professionalId } = await criarProfissional();
      const result = await pool.query(
        "INSERT INTO validation_cases (professional_id, action, from_status, to_status, actor) VALUES ($1, 'SUBMITTED', 'DRAFT', 'PENDING_REVIEW', 'PROFESSIONAL') RETURNING id",
        [professionalId],
      );
      expect(result.rowCount).toBe(1);
    });

    it("rejeita UPDATE ao reason (SQLSTATE 23000, exceção do trigger)", async () => {
      const { professionalId } = await criarProfissional();
      const { rows } = await pool.query<{ id: string }>(
        "INSERT INTO validation_cases (professional_id, action, from_status, to_status, actor) VALUES ($1, 'SUBMITTED', 'DRAFT', 'PENDING_REVIEW', 'PROFESSIONAL') RETURNING id",
        [professionalId],
      );
      const err = await erroDe(pool.query("UPDATE validation_cases SET reason = 'alterado' WHERE id = $1", [rows[0]?.id]));
      expect(err.code).toBe("23000");
      expect(err.message).toContain("imutável");
    });

    it("rejeita UPDATE ao action (SQLSTATE 23000)", async () => {
      const { professionalId } = await criarProfissional();
      const { rows } = await pool.query<{ id: string }>(
        "INSERT INTO validation_cases (professional_id, action, from_status, to_status, actor) VALUES ($1, 'SUBMITTED', 'DRAFT', 'PENDING_REVIEW', 'PROFESSIONAL') RETURNING id",
        [professionalId],
      );
      const err = await erroDe(pool.query("UPDATE validation_cases SET action = 'APPROVED' WHERE id = $1", [rows[0]?.id]));
      expect(err.code).toBe("23000");
    });

    it("rejeita UPDATE ao to_status (SQLSTATE 23000)", async () => {
      const { professionalId } = await criarProfissional();
      const { rows } = await pool.query<{ id: string }>(
        "INSERT INTO validation_cases (professional_id, action, from_status, to_status, actor) VALUES ($1, 'SUBMITTED', 'DRAFT', 'PENDING_REVIEW', 'PROFESSIONAL') RETURNING id",
        [professionalId],
      );
      const err = await erroDe(pool.query("UPDATE validation_cases SET to_status = 'APPROVED' WHERE id = $1", [rows[0]?.id]));
      expect(err.code).toBe("23000");
    });

    it("rejeita UPDATE ao created_at (SQLSTATE 23000)", async () => {
      const { professionalId } = await criarProfissional();
      const { rows } = await pool.query<{ id: string }>(
        "INSERT INTO validation_cases (professional_id, action, from_status, to_status, actor) VALUES ($1, 'SUBMITTED', 'DRAFT', 'PENDING_REVIEW', 'PROFESSIONAL') RETURNING id",
        [professionalId],
      );
      const err = await erroDe(pool.query("UPDATE validation_cases SET created_at = created_at + interval '1 day' WHERE id = $1", [rows[0]?.id]));
      expect(err.code).toBe("23000");
    });

    it("permite o UPDATE que só põe decided_by a NULL (efeito de ON DELETE SET NULL) com o resto igual", async () => {
      const { professionalId } = await criarProfissional();
      const adminId = await criarUtilizador();
      const { rows } = await pool.query<{ id: string }>(
        "INSERT INTO validation_cases (professional_id, action, from_status, to_status, actor, decided_by) VALUES ($1, 'APPROVED', 'PENDING_REVIEW', 'APPROVED', 'PLATFORM_ADMIN', $2) RETURNING id",
        [professionalId, adminId],
      );
      const result = await pool.query("UPDATE validation_cases SET decided_by = NULL WHERE id = $1", [rows[0]?.id]);
      expect(result.rowCount).toBe(1);
    });

    it("rejeita trocar decided_by para OUTRO utilizador (SQLSTATE 23000)", async () => {
      const { professionalId } = await criarProfissional();
      const adminA = await criarUtilizador();
      const adminB = await criarUtilizador();
      const { rows } = await pool.query<{ id: string }>(
        "INSERT INTO validation_cases (professional_id, action, from_status, to_status, actor, decided_by) VALUES ($1, 'APPROVED', 'PENDING_REVIEW', 'APPROVED', 'PLATFORM_ADMIN', $2) RETURNING id",
        [professionalId, adminA],
      );
      const err = await erroDe(pool.query("UPDATE validation_cases SET decided_by = $2 WHERE id = $1", [rows[0]?.id, adminB]));
      expect(err.code).toBe("23000");
    });

    it("apagar o utilizador referenciado por decided_by põe decided_by a NULL sem erro (SET NULL)", async () => {
      const { professionalId } = await criarProfissional();
      const adminId = await criarUtilizador();
      const { rows } = await pool.query<{ id: string }>(
        "INSERT INTO validation_cases (professional_id, action, from_status, to_status, actor, decided_by) VALUES ($1, 'APPROVED', 'PENDING_REVIEW', 'APPROVED', 'PLATFORM_ADMIN', $2) RETURNING id",
        [professionalId, adminId],
      );
      await pool.query("DELETE FROM users WHERE id = $1", [adminId]);
      const { rows: after } = await pool.query<{ decided_by: string | null }>("SELECT decided_by FROM validation_cases WHERE id = $1", [rows[0]?.id]);
      expect(after[0]?.decided_by).toBeNull();
    });

    it("rejeita decided_by com actor diferente de PLATFORM_ADMIN (SQLSTATE 23514)", async () => {
      const { professionalId } = await criarProfissional();
      const adminId = await criarUtilizador();
      const err = await erroDe(
        pool.query(
          "INSERT INTO validation_cases (professional_id, action, from_status, to_status, actor, decided_by) VALUES ($1, 'SUBMITTED', 'DRAFT', 'PENDING_REVIEW', 'PROFESSIONAL', $2)",
          [professionalId, adminId],
        ),
      );
      expect(err.code).toBe("23514");
      expect(err.constraint).toBe("validation_cases_decided_by_actor_check");
    });

    for (const action of ["REJECTED", "NEEDS_INFO", "SUSPENDED", "EXPIRED"]) {
      it(`rejeita a ação ${action} sem reason (SQLSTATE 23514)`, async () => {
        const { professionalId } = await criarProfissional();
        const err = await erroDe(
          pool.query(
            "INSERT INTO validation_cases (professional_id, action, from_status, to_status, actor) VALUES ($1, $2, 'PENDING_REVIEW', 'REJECTED', 'SYSTEM')",
            [professionalId, action],
          ),
        );
        expect(err.code).toBe("23514");
        expect(err.constraint).toBe("validation_cases_reason_required_check");
      });
    }

    for (const action of ["APPROVED", "SUBMITTED", "REACTIVATED"]) {
      it(`aceita a ação ${action} sem reason`, async () => {
        const { professionalId } = await criarProfissional();
        const result = await pool.query(
          "INSERT INTO validation_cases (professional_id, action, from_status, to_status, actor) VALUES ($1, $2, 'DRAFT', 'PENDING_REVIEW', 'SYSTEM')",
          [professionalId, action],
        );
        expect(result.rowCount).toBe(1);
      });
    }

    it("rejeita reason com mais de 500 caracteres (SQLSTATE 23514)", async () => {
      const { professionalId } = await criarProfissional();
      const err = await erroDe(
        pool.query(
          "INSERT INTO validation_cases (professional_id, action, from_status, to_status, actor, reason) VALUES ($1, 'REJECTED', 'PENDING_REVIEW', 'REJECTED', 'SYSTEM', $2)",
          [professionalId, "x".repeat(501)],
        ),
      );
      expect(err.code).toBe("23514");
      expect(err.constraint).toBe("validation_cases_reason_check");
    });

    it("apagar o profissional apaga o histórico em cascata (o trigger só atua em UPDATE)", async () => {
      const { professionalId } = await criarProfissional();
      await pool.query(
        "INSERT INTO validation_cases (professional_id, action, from_status, to_status, actor) VALUES ($1, 'SUBMITTED', 'DRAFT', 'PENDING_REVIEW', 'PROFESSIONAL')",
        [professionalId],
      );
      await pool.query("DELETE FROM professionals WHERE id = $1", [professionalId]);
      const { rows } = await pool.query("SELECT 1 FROM validation_cases WHERE professional_id = $1", [professionalId]);
      expect(rows).toHaveLength(0);
    });

    it("não tem coluna updated_at (histórico sem atualização)", async () => {
      const { rows } = await pool.query(
        "SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'validation_cases' AND column_name = 'updated_at'",
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe("professional_offers: especialidade, duração, preço, nota e unicidade", () => {
    it("rejeita oferta com especialidade que não está ligada ao profissional (FK composta, SQLSTATE 23503)", async () => {
      const { professionalId } = await criarProfissional();
      const specialtyNaoLigada = await criarEspecialidade();
      const err = await erroDe(
        pool.query(
          "INSERT INTO professional_offers (professional_id, specialty_id, method, duration_minutes, price_kz) VALUES ($1, $2, 'IN_PERSON', 30, 5000)",
          [professionalId, specialtyNaoLigada],
        ),
      );
      expect(err.code).toBe("23503");
      expect(err.constraint).toBe("professional_offers_specialty_fk");
    });

    it("rejeita remover a ligação professional_specialties com oferta existente (SQLSTATE 23503)", async () => {
      const { professionalId } = await criarProfissional();
      const specialtyId = await criarEspecialidade();
      await ligarEspecialidade(professionalId, specialtyId);
      await criarOferta(professionalId, specialtyId);
      const err = await erroDe(
        pool.query("DELETE FROM professional_specialties WHERE professional_id = $1 AND specialty_id = $2", [professionalId, specialtyId]),
      );
      expect(err.code).toBe("23503");
    });

    for (const duracao of [10, 25, 90]) {
      it(`rejeita duration_minutes = ${String(duracao)} (fora de 15/20/30/45/60, SQLSTATE 23514)`, async () => {
        const { professionalId } = await criarProfissional();
        const specialtyId = await criarEspecialidade();
        await ligarEspecialidade(professionalId, specialtyId);
        const err = await erroDe(criarOferta(professionalId, specialtyId, { durationMinutes: duracao }));
        expect(err.code).toBe("23514");
        expect(err.constraint).toBe("professional_offers_duration_check");
      });
    }

    it("rejeita price_kz = -1 (SQLSTATE 23514)", async () => {
      const { professionalId } = await criarProfissional();
      const specialtyId = await criarEspecialidade();
      await ligarEspecialidade(professionalId, specialtyId);
      const err = await erroDe(
        pool.query("INSERT INTO professional_offers (professional_id, specialty_id, method, duration_minutes, price_kz) VALUES ($1, $2, 'VIDEO', 30, -1)", [professionalId, specialtyId]),
      );
      expect(err.code).toBe("23514");
      expect(err.constraint).toBe("professional_offers_price_check");
    });

    it("rejeita price_kz = 100000001 (SQLSTATE 23514)", async () => {
      const { professionalId } = await criarProfissional();
      const specialtyId = await criarEspecialidade();
      await ligarEspecialidade(professionalId, specialtyId);
      const err = await erroDe(
        pool.query("INSERT INTO professional_offers (professional_id, specialty_id, method, duration_minutes, price_kz) VALUES ($1, $2, 'VIDEO', 30, 100000001)", [professionalId, specialtyId]),
      );
      expect(err.code).toBe("23514");
    });

    for (const preco of [0, 100000000]) {
      it(`aceita price_kz = ${String(preco)} (limite inclusivo)`, async () => {
        const { professionalId } = await criarProfissional();
        const specialtyId = await criarEspecialidade();
        await ligarEspecialidade(professionalId, specialtyId);
        const result = await pool.query(
          "INSERT INTO professional_offers (professional_id, specialty_id, method, duration_minutes, price_kz) VALUES ($1, $2, 'CHAT', 15, $3)",
          [professionalId, specialtyId, preco],
        );
        expect(result.rowCount).toBe(1);
      });
    }

    it("rejeita note com mais de 200 caracteres (SQLSTATE 23514)", async () => {
      const { professionalId } = await criarProfissional();
      const specialtyId = await criarEspecialidade();
      await ligarEspecialidade(professionalId, specialtyId);
      const err = await erroDe(
        pool.query(
          "INSERT INTO professional_offers (professional_id, specialty_id, method, duration_minutes, price_kz, note) VALUES ($1, $2, 'PHONE', 20, 1000, $3)",
          [professionalId, specialtyId, "x".repeat(201)],
        ),
      );
      expect(err.code).toBe("23514");
      expect(err.constraint).toBe("professional_offers_note_check");
    });

    it("rejeita um duplicado ativo (profissional, especialidade, método, duração) (SQLSTATE 23505)", async () => {
      const { professionalId } = await criarProfissional();
      const specialtyId = await criarEspecialidade();
      await ligarEspecialidade(professionalId, specialtyId);
      await criarOferta(professionalId, specialtyId);
      const err = await erroDe(criarOferta(professionalId, specialtyId));
      expect(err.code).toBe("23505");
      expect(err.constraint).toBe("professional_offers_active_uq");
    });

    it("aceita um duplicado com active = false (UNIQUE parcial só para ativas)", async () => {
      const { professionalId } = await criarProfissional();
      const specialtyId = await criarEspecialidade();
      await ligarEspecialidade(professionalId, specialtyId);
      await criarOferta(professionalId, specialtyId);
      const result = await pool.query(
        "INSERT INTO professional_offers (professional_id, specialty_id, method, duration_minutes, price_kz, active) VALUES ($1, $2, 'IN_PERSON', 30, 5000, false)",
        [professionalId, specialtyId],
      );
      expect(result.rowCount).toBe(1);
    });

    it("rejeita reativar uma oferta inativa que duplicaria uma ativa (SQLSTATE 23505)", async () => {
      const { professionalId } = await criarProfissional();
      const specialtyId = await criarEspecialidade();
      await ligarEspecialidade(professionalId, specialtyId);
      await criarOferta(professionalId, specialtyId);
      const inativa = await criarOferta(professionalId, specialtyId, { active: false });
      const err = await erroDe(pool.query("UPDATE professional_offers SET active = true WHERE id = $1", [inativa]));
      expect(err.code).toBe("23505");
    });

    it("rejeita um valor inválido do enum method (SQLSTATE 22P02)", async () => {
      const { professionalId } = await criarProfissional();
      const specialtyId = await criarEspecialidade();
      await ligarEspecialidade(professionalId, specialtyId);
      const err = await erroDe(criarOferta(professionalId, specialtyId, { method: "FAX" }));
      expect(err.code).toBe("22P02");
    });
  });

  describe("professional_schedule_rules: oferta, dias, horas e validade", () => {
    it("rejeita regra cuja oferta pertence a outro profissional (FK composta, SQLSTATE 23503)", async () => {
      const profA = await criarProfissional();
      const profB = await criarProfissional();
      const specialtyB = await criarEspecialidade();
      await ligarEspecialidade(profB.professionalId, specialtyB);
      const ofertaDeB = await criarOferta(profB.professionalId, specialtyB);
      const err = await erroDe(criarRegra(profA.professionalId, ofertaDeB));
      expect(err.code).toBe("23503");
      expect(err.constraint).toBe("professional_schedule_rules_offer_fk");
    });

    for (const [nome, dias] of [
      ["vazio", [] as number[]],
      ["com 0", [0]],
      ["com 8", [8]],
    ] as const) {
      it(`rejeita weekdays ${nome} (SQLSTATE 23514)`, async () => {
        const { professionalId } = await criarProfissional();
        const specialtyId = await criarEspecialidade();
        await ligarEspecialidade(professionalId, specialtyId);
        const offerId = await criarOferta(professionalId, specialtyId);
        const err = await erroDe(criarRegra(professionalId, offerId, [...dias]));
        expect(err.code).toBe("23514");
        expect(err.constraint).toBe("professional_schedule_rules_weekdays_check");
      });
    }

    it("aceita weekdays {1,3,5}", async () => {
      const { professionalId } = await criarProfissional();
      const specialtyId = await criarEspecialidade();
      await ligarEspecialidade(professionalId, specialtyId);
      const offerId = await criarOferta(professionalId, specialtyId);
      const regraId = await criarRegra(professionalId, offerId, [1, 3, 5]);
      const { rows } = await pool.query<{ weekdays: number[] }>("SELECT weekdays FROM professional_schedule_rules WHERE id = $1", [regraId]);
      expect(rows[0]?.weekdays).toEqual([1, 3, 5]);
    });

    it("rejeita end_time <= start_time (SQLSTATE 23514)", async () => {
      const { professionalId } = await criarProfissional();
      const specialtyId = await criarEspecialidade();
      await ligarEspecialidade(professionalId, specialtyId);
      const offerId = await criarOferta(professionalId, specialtyId);
      const err = await erroDe(
        pool.query(
          "INSERT INTO professional_schedule_rules (professional_id, offer_id, weekdays, start_time, end_time) VALUES ($1, $2, '{2}', '10:00', '10:00')",
          [professionalId, offerId],
        ),
      );
      expect(err.code).toBe("23514");
      expect(err.constraint).toBe("professional_schedule_rules_time_check");
    });

    it("rejeita valid_until anterior a valid_from (SQLSTATE 23514)", async () => {
      const { professionalId } = await criarProfissional();
      const specialtyId = await criarEspecialidade();
      await ligarEspecialidade(professionalId, specialtyId);
      const offerId = await criarOferta(professionalId, specialtyId);
      const err = await erroDe(
        pool.query(
          "INSERT INTO professional_schedule_rules (professional_id, offer_id, weekdays, start_time, end_time, valid_from, valid_until) VALUES ($1, $2, '{2}', '09:00', '10:00', '2027-06-01', '2027-05-01')",
          [professionalId, offerId],
        ),
      );
      expect(err.code).toBe("23514");
      expect(err.constraint).toBe("professional_schedule_rules_valid_check");
    });

    it("aceita valid_from e valid_until nulos", async () => {
      const { professionalId } = await criarProfissional();
      const specialtyId = await criarEspecialidade();
      await ligarEspecialidade(professionalId, specialtyId);
      const offerId = await criarOferta(professionalId, specialtyId);
      const result = await pool.query(
        "INSERT INTO professional_schedule_rules (professional_id, offer_id, weekdays, start_time, end_time, valid_from, valid_until) VALUES ($1, $2, '{2}', '09:00', '10:00', NULL, NULL)",
        [professionalId, offerId],
      );
      expect(result.rowCount).toBe(1);
    });
  });

  describe("professional_time_off: intervalo e motivo", () => {
    it("rejeita ends_at <= starts_at (SQLSTATE 23514)", async () => {
      const { professionalId } = await criarProfissional();
      const err = await erroDe(
        pool.query("INSERT INTO professional_time_off (professional_id, starts_at, ends_at) VALUES ($1, '2027-06-10T10:00:00Z', '2027-06-10T10:00:00Z')", [professionalId]),
      );
      expect(err.code).toBe("23514");
      expect(err.constraint).toBe("professional_time_off_range_check");
    });

    it("rejeita um bloqueio com duração superior a 366 dias (SQLSTATE 23514)", async () => {
      const { professionalId } = await criarProfissional();
      const err = await erroDe(
        pool.query(
          "INSERT INTO professional_time_off (professional_id, starts_at, ends_at) VALUES ($1, '2027-06-10T00:00:00Z', '2027-06-10T00:00:00Z'::timestamptz + interval '366 days 1 second')",
          [professionalId],
        ),
      );
      expect(err.code).toBe("23514");
    });

    it("aceita um bloqueio de exatamente 366 dias (limite inclusivo)", async () => {
      const { professionalId } = await criarProfissional();
      const result = await pool.query(
        "INSERT INTO professional_time_off (professional_id, starts_at, ends_at) VALUES ($1, '2027-06-10T00:00:00Z', '2027-06-10T00:00:00Z'::timestamptz + interval '366 days')",
        [professionalId],
      );
      expect(result.rowCount).toBe(1);
    });

    it("rejeita reason com mais de 200 caracteres (SQLSTATE 23514)", async () => {
      const { professionalId } = await criarProfissional();
      const err = await erroDe(
        pool.query(
          "INSERT INTO professional_time_off (professional_id, starts_at, ends_at, reason) VALUES ($1, '2027-06-10T09:00:00Z', '2027-06-10T10:00:00Z', $2)",
          [professionalId, "x".repeat(201)],
        ),
      );
      expect(err.code).toBe("23514");
      expect(err.constraint).toBe("professional_time_off_reason_check");
    });
  });

  describe("cascatas do profissional e da conta", () => {
    it("apagar o profissional com todos os filhos não viola FKs e deixa as tabelas filhas vazias para esse id", async () => {
      const { professionalId } = await criarProfissional();
      const specialtyId = await criarEspecialidade();
      await ligarEspecialidade(professionalId, specialtyId);
      const offerId = await criarOferta(professionalId, specialtyId);
      const regraId = await criarRegra(professionalId, offerId);
      await pool.query("INSERT INTO professional_time_off (professional_id, starts_at, ends_at) VALUES ($1, '2027-06-10T09:00:00Z', '2027-06-10T10:00:00Z')", [professionalId]);
      await pool.query(
        "INSERT INTO professional_slots (professional_id, offer_id, rule_id, starts_at, ends_at) VALUES ($1, $2, $3, '2027-06-15T09:00:00Z', '2027-06-15T09:30:00Z')",
        [professionalId, offerId, regraId],
      );
      const adminId = await criarUtilizador();
      await pool.query(
        "INSERT INTO validation_cases (professional_id, action, from_status, to_status, actor, decided_by) VALUES ($1, 'APPROVED', 'PENDING_REVIEW', 'APPROVED', 'PLATFORM_ADMIN', $2)",
        [professionalId, adminId],
      );
      await pool.query(
        "INSERT INTO professional_credentials (professional_id, kind, storage_key, content_type, size_bytes) VALUES ($1, 'IDENTITY', $2, 'application/pdf', 1024)",
        [professionalId, `cred/${randomUUID()}`],
      );

      await pool.query("DELETE FROM professionals WHERE id = $1", [professionalId]);

      for (const tabela of ["professional_specialties", "professional_offers", "professional_schedule_rules", "professional_time_off", "professional_slots", "validation_cases", "professional_credentials"]) {
        const { rows } = await pool.query(`SELECT 1 FROM ${tabela} WHERE professional_id = $1`, [professionalId]);
        expect(rows, tabela).toHaveLength(0);
      }
    });

    it("apagar a conta do profissional apaga o perfil em cascata", async () => {
      const { accountId, professionalId } = await criarProfissional();
      await pool.query("DELETE FROM professional_accounts WHERE id = $1", [accountId]);
      const { rows } = await pool.query("SELECT 1 FROM professionals WHERE id = $1", [professionalId]);
      expect(rows).toHaveLength(0);
    });

    it("rejeita apagar uma oferta que tem regra a referi-la (SQLSTATE 23503)", async () => {
      const { professionalId } = await criarProfissional();
      const specialtyId = await criarEspecialidade();
      await ligarEspecialidade(professionalId, specialtyId);
      const offerId = await criarOferta(professionalId, specialtyId);
      await criarRegra(professionalId, offerId);
      const err = await erroDe(pool.query("DELETE FROM professional_offers WHERE id = $1", [offerId]));
      expect(err.code).toBe("23503");
    });
  });
});
