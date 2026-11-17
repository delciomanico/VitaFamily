// Integração real (testcontainers + PostgreSQL 16) da migração 0043 (MK1, ADR-037, migrations.md «MK1»):
//  - sobre uma BD existente em 0042 (com dados nas tabelas atuais): as linhas pré-existentes não mudam, a
//    migração só acrescenta estrutura (13 tabelas, `audit_logs.actor_professional_account_id`, o valor
//    PROFESSIONAL_ACCOUNT em actor_type) e não altera `documents`/`file_deletions` (TC-MKT-30/34);
//  - restrições de `professional_slots`: EXCLUDE sem sobreposição por profissional, UNIQUE (rule_id, starts_at),
//    CHECK de intervalo, FKs compostas que impedem cruzar profissionais, e cascatas na eliminação do profissional.
import { randomUUID } from "node:crypto";
import { copyFile, mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultMigrationsDir, runMigrations } from "../../db/migrate-runner.js";

/** Tabelas que já existiam antes de 0043 e cujas linhas têm de ficar exatamente iguais. */
const TABELAS_EXISTENTES = ["users", "families", "family_members", "clinics", "clinic_accounts", "audit_logs", "examinations", "documents", "file_deletions"];

/** As 13 tabelas novas do MK1 (0043). */
const TABELAS_NOVAS = [
  "professional_accounts",
  "professional_auth_tokens",
  "professional_sessions",
  "professionals",
  "specialties",
  "professional_specialties",
  "professional_file_deletions",
  "professional_credentials",
  "validation_cases",
  "professional_offers",
  "professional_schedule_rules",
  "professional_time_off",
  "professional_slots",
];

describe("integração: migração 0043 (MK1) e restrições de professional_slots", () => {
  let container: StartedTestContainer;
  let pool: Pool;
  /** Ligações às BDs "legadas" criadas pelos testes de migração; fecham-se no afterAll. */
  const abertas: Pool[] = [];

  const urlDe = (nomeBd: string) => `postgres://vita:vita@${container.getHost()}:${String(container.getMappedPort(5432))}/${nomeBd}`;

  /** BD nova com as migrações 0001..0042 aplicadas (a 0043 fica por aplicar). */
  async function bdAte0042(): Promise<Pool> {
    const dir = await mkdtemp(join(tmpdir(), "vita-mig43-"));
    for (const file of (await readdir(defaultMigrationsDir())).filter((f) => f.endsWith(".sql") && f < "0043_")) {
      await copyFile(join(defaultMigrationsDir(), file), join(dir, file));
    }
    const nomeBd = `legacy43_${randomUUID().replace(/-/g, "")}`;
    await pool.query(`CREATE DATABASE ${nomeBd}`);
    const legacy = new Pool({ connectionString: urlDe(nomeBd) });
    abertas.push(legacy);
    await runMigrations(legacy, dir);
    return legacy;
  }

  /** Dados realistas nas tabelas que já existem em 0042 (utilizador, família, clínica, conta, auditoria, documento). */
  async function semeiaDadosExistentes(legacy: Pool) {
    const [user, familia, membro, clinica, contaClinica] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    await legacy.query(
      "INSERT INTO users (id, email, password_hash, name, birth_date, timezone, terms_accepted_version, terms_accepted_at) VALUES ($1,$2,'x','Ana','1990-01-01','Europe/Lisbon','1',now())",
      [user, `ana-${user}@teste.pt`],
    );
    await legacy.query("INSERT INTO families (id, name) VALUES ($1,'Família existente')", [familia]);
    await legacy.query(
      "INSERT INTO family_members (id, family_id, user_id, name, birth_date, role) VALUES ($1,$2,$3,'Ana','1990-01-01','FAMILY_ADMIN')",
      [membro, familia, user],
    );
    await legacy.query("INSERT INTO clinics (id, type, name) VALUES ($1,'PARTNER','Clínica existente')", [clinica]);
    await legacy.query(
      "INSERT INTO clinic_accounts (id, clinic_id, email, password_hash, role) VALUES ($1,$2,$3,'x','CLINIC_ADMIN')",
      [contaClinica, clinica, `clinica-${contaClinica}@teste.pt`],
    );
    await legacy.query(
      "INSERT INTO audit_logs (actor_type, actor_user_id, action, resource_type, result, request_id, family_id) VALUES ('USER',$1,'LOGIN','USER','SUCCESS','req-legado',$2)",
      [user, familia],
    );
    const exame = randomUUID();
    await legacy.query("INSERT INTO examinations (id, family_id, member_id, name, exam_date) VALUES ($1,$2,$3,'Hemograma','2030-01-01')", [exame, familia, membro]);
    // documents_exactly_one_resource: exatamente um de prescription_id/examination_id.
    await legacy.query(
      "INSERT INTO documents (family_id, member_id, examination_id, storage_key, original_name, mime_type, size_bytes, checksum_sha256) VALUES ($1,$2,$3,'legado/doc-1','exame.pdf','application/pdf',1024,'abc')",
      [familia, membro, exame],
    );
    await legacy.query("INSERT INTO file_deletions (storage_key) VALUES ('legado/apagar-1')");
  }

  /** Conteúdo das tabelas pré-existentes (`to_jsonb`), sem a coluna nova de audit_logs, e contagens. */
  async function capturaDados(p: Pool) {
    const linhas: Record<string, string[]> = {};
    const contagens: Record<string, number> = {};
    for (const tabela of TABELAS_EXISTENTES) {
      const r = await p.query<{ row: Record<string, unknown> }>(`SELECT to_jsonb(t) - 'actor_professional_account_id' AS row FROM ${tabela} t`);
      linhas[tabela] = r.rows.map((x) => JSON.stringify(x.row)).sort();
      contagens[tabela] = linhas[tabela].length;
    }
    return { linhas, contagens };
  }

  /** Colunas (nome, tipo, nulidade, default) das tabelas indicadas, para comparar antes/depois. */
  async function colunas(p: Pool, tabelas: string[]) {
    const r = await p.query<{ table_name: string; column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
      `SELECT table_name, column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ANY($1)
        ORDER BY table_name, ordinal_position`,
      [tabelas],
    );
    return r.rows;
  }

  async function tabelasExistentes(p: Pool, tabelas: string[]): Promise<string[]> {
    const r = await p.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1) ORDER BY table_name",
      [tabelas],
    );
    return r.rows.map((x) => x.table_name);
  }

  beforeAll(async () => {
    container = await new GenericContainer("postgres:16-alpine")
      .withEnvironment({ POSTGRES_USER: "vita", POSTGRES_PASSWORD: "vita", POSTGRES_DB: "vita" })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start();
    pool = new Pool({ connectionString: urlDe("vita") });
    await runMigrations(pool, defaultMigrationsDir());
  }, 180_000);

  afterAll(async () => {
    for (const p of abertas) {
      await p.end();
    }
    await pool.end();
    await container.stop();
  });

  describe("migração 0043 sobre dados existentes (esquema 0042)", () => {
    it("preserva as linhas existentes: snapshot antes/depois idêntico, e audit_logs ganha só a coluna nova, a NULL", async () => {
      const legacy = await bdAte0042();
      await semeiaDadosExistentes(legacy);
      const antes = await capturaDados(legacy);
      expect(antes.contagens).toEqual({ users: 1, families: 1, family_members: 1, clinics: 1, clinic_accounts: 1, audit_logs: 1, examinations: 1, documents: 1, file_deletions: 1 });

      await runMigrations(legacy, defaultMigrationsDir());

      expect(await capturaDados(legacy)).toEqual(antes);
      const audit = await legacy.query<{ actor_type: string; actor_professional_account_id: string | null }>(
        "SELECT actor_type, actor_professional_account_id FROM audit_logs",
      );
      expect(audit.rows).toEqual([{ actor_type: "USER", actor_professional_account_id: null }]);
    }, 120_000);

    it("regista 0043 em schema_migrations e cria as 13 tabelas novas (que não existiam antes)", async () => {
      const legacy = await bdAte0042();
      await semeiaDadosExistentes(legacy);
      expect(await tabelasExistentes(legacy, TABELAS_NOVAS)).toEqual([]);

      await runMigrations(legacy, defaultMigrationsDir());

      const registadas = await legacy.query<{ version: string }>("SELECT version FROM schema_migrations WHERE version = '0043_professionals'");
      expect(registadas.rows).toEqual([{ version: "0043_professionals" }]);
      expect(await tabelasExistentes(legacy, TABELAS_NOVAS)).toEqual([...TABELAS_NOVAS].sort());
      expect(TABELAS_NOVAS).toHaveLength(13);
    }, 120_000);

    it("documents e file_deletions não ganham colunas (comparação de information_schema antes/depois)", async () => {
      const legacy = await bdAte0042();
      await semeiaDadosExistentes(legacy);
      const antes = await colunas(legacy, ["documents", "file_deletions"]);
      expect(antes.length).toBeGreaterThan(0);

      await runMigrations(legacy, defaultMigrationsDir());

      expect(await colunas(legacy, ["documents", "file_deletions"])).toEqual(antes);
    }, 120_000);

    it("'PROFESSIONAL_ACCOUNT' passa a existir em actor_type e é aceite em audit_logs com actor_professional_account_id preenchido", async () => {
      const legacy = await bdAte0042();
      await semeiaDadosExistentes(legacy);
      await runMigrations(legacy, defaultMigrationsDir());

      const valores = await legacy.query<{ valor: string }>("SELECT unnest(enum_range(NULL::actor_type))::text AS valor");
      expect(valores.rows.map((r) => r.valor)).toContain("PROFESSIONAL_ACCOUNT");

      const conta = randomUUID();
      await legacy.query(
        "INSERT INTO audit_logs (actor_type, actor_professional_account_id, action, resource_type, resource_id, result, request_id) VALUES ('PROFESSIONAL_ACCOUNT',$1,'LOGIN','PROFESSIONAL_ACCOUNT',$1,'SUCCESS','req-mk1')",
        [conta],
      );
      const inserida = await legacy.query<{ actor_type: string; actor_professional_account_id: string }>(
        "SELECT actor_type, actor_professional_account_id FROM audit_logs WHERE actor_type = 'PROFESSIONAL_ACCOUNT'",
      );
      expect(inserida.rows).toEqual([{ actor_type: "PROFESSIONAL_ACCOUNT", actor_professional_account_id: conta }]);
    }, 120_000);
  });

  describe("professional_slots (0043)", () => {
    const DIA = "2030-01-07";

    interface Semente { professionalId: string; especialidadeId: string; ofertaId: string; regraId: string }

    /** Profissional com conta, especialidade, uma oferta presencial de 30 min e uma regra de horário (seg–sex). */
    async function semeiaProfissional(): Promise<Semente> {
      const conta = await pool.query<{ id: string }>(
        "INSERT INTO professional_accounts (email, password_hash, terms_accepted_version, terms_accepted_at) VALUES ($1,'x','1',now()) RETURNING id",
        [`prof-${randomUUID()}@teste.pt`],
      );
      const professionalId = (await pool.query<{ id: string }>("INSERT INTO professionals (account_id) VALUES ($1) RETURNING id", [conta.rows[0]?.id])).rows[0]?.id ?? "";
      const especialidadeId = (
        await pool.query<{ id: string }>("INSERT INTO specialties (name, category) VALUES ($1,'HEALTH') RETURNING id", [`Especialidade ${randomUUID()}`])
      ).rows[0]?.id ?? "";
      await pool.query("INSERT INTO professional_specialties (professional_id, specialty_id) VALUES ($1,$2)", [professionalId, especialidadeId]);
      const ofertaId = (
        await pool.query<{ id: string }>(
          "INSERT INTO professional_offers (professional_id, specialty_id, method, duration_minutes, price_kz) VALUES ($1,$2,'IN_PERSON',30,5000) RETURNING id",
          [professionalId, especialidadeId],
        )
      ).rows[0]?.id ?? "";
      const regraId = (
        await pool.query<{ id: string }>(
          "INSERT INTO professional_schedule_rules (professional_id, offer_id, weekdays, start_time, end_time) VALUES ($1,$2,$3,'09:00','18:00') RETURNING id",
          [professionalId, ofertaId, [1, 2, 3, 4, 5]],
        )
      ).rows[0]?.id ?? "";
      return { professionalId, especialidadeId, ofertaId, regraId };
    }

    /** Oferta extra (por vídeo) do mesmo profissional e especialidade, sem regras associadas. */
    async function criaOfertaVideo(s: Semente): Promise<string> {
      return (
        await pool.query<{ id: string }>(
          "INSERT INTO professional_offers (professional_id, specialty_id, method, duration_minutes, price_kz) VALUES ($1,$2,'VIDEO',30,4000) RETURNING id",
          [s.professionalId, s.especialidadeId],
        )
      ).rows[0]?.id ?? "";
    }

    const hora = (h: string) => `${DIA}T${h}:00Z`;

    /** Insere um horário com a oferta e a regra indicadas (por omissão, as do próprio profissional). */
    async function insereSlot(
      professionalId: string,
      inicio: string,
      fim: string,
      alvo: { ofertaId: string; regraId: string },
    ) {
      return pool.query<{ id: string }>(
        "INSERT INTO professional_slots (professional_id, offer_id, rule_id, starts_at, ends_at) VALUES ($1,$2,$3,$4,$5) RETURNING id",
        [professionalId, alvo.ofertaId, alvo.regraId, inicio, fim],
      );
    }

    async function contaSlots(regraId: string): Promise<number> {
      const r = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM professional_slots WHERE rule_id = $1", [regraId]);
      return r.rows[0]?.n ?? -1;
    }

    it("slot sobreposto do mesmo profissional falha (EXCLUDE professional_slots_no_overlap, 23P01)", async () => {
      const s = await semeiaProfissional();
      await insereSlot(s.professionalId, hora("10:00"), hora("11:00"), s);

      await expect(insereSlot(s.professionalId, hora("10:30"), hora("11:30"), s)).rejects.toMatchObject({
        code: "23P01",
        constraint: "professional_slots_no_overlap",
      });
    }, 60_000);

    it("slot consecutivo (ends_at do anterior == starts_at do seguinte) passa, porque o intervalo é [starts, ends)", async () => {
      const s = await semeiaProfissional();
      await insereSlot(s.professionalId, hora("10:00"), hora("11:00"), s);

      await expect(insereSlot(s.professionalId, hora("11:00"), hora("11:30"), s)).resolves.toBeDefined();
      expect(await contaSlots(s.regraId)).toBe(2);
    }, 60_000);

    it("o mesmo horário noutro profissional passa (a EXCLUDE é por professional_id)", async () => {
      const a = await semeiaProfissional();
      const b = await semeiaProfissional();
      await insereSlot(a.professionalId, hora("10:00"), hora("11:00"), a);

      await expect(insereSlot(b.professionalId, hora("10:00"), hora("11:00"), b)).resolves.toBeDefined();
    }, 60_000);

    it("UNIQUE (rule_id, starts_at): segundo insert igual falha com 23505", async () => {
      const s = await semeiaProfissional();
      await insereSlot(s.professionalId, hora("09:00"), hora("09:30"), s);

      await expect(insereSlot(s.professionalId, hora("09:00"), hora("09:30"), s)).rejects.toMatchObject({
        code: "23505",
        constraint: "professional_slots_rule_starts_uq",
      });
      expect(await contaSlots(s.regraId)).toBe(1);
    }, 60_000);

    it("INSERT ... ON CONFLICT (rule_id, starts_at) DO NOTHING é idempotente: repetido não cria linhas novas", async () => {
      const s = await semeiaProfissional();
      const gera = () =>
        pool.query(
          `INSERT INTO professional_slots (professional_id, offer_id, rule_id, starts_at, ends_at)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (rule_id, starts_at) DO NOTHING`,
          [s.professionalId, s.ofertaId, s.regraId, hora("09:00"), hora("09:30")],
        );

      expect((await gera()).rowCount).toBe(1);
      expect((await gera()).rowCount).toBe(0);
      expect((await gera()).rowCount).toBe(0);
      expect(await contaSlots(s.regraId)).toBe(1);
    }, 60_000);

    it("ends_at igual a starts_at falha com CHECK professional_slots_range_check (23514)", async () => {
      const s = await semeiaProfissional();

      await expect(insereSlot(s.professionalId, hora("10:00"), hora("10:00"), s)).rejects.toMatchObject({
        code: "23514",
        constraint: "professional_slots_range_check",
      });
    }, 60_000);

    it("FK composta: a oferta de OUTRO profissional falha (23503 professional_slots_offer_fk)", async () => {
      const dono = await semeiaProfissional();
      const outro = await semeiaProfissional();

      await expect(
        insereSlot(outro.professionalId, hora("10:00"), hora("10:30"), { ofertaId: dono.ofertaId, regraId: outro.regraId }),
      ).rejects.toMatchObject({ code: "23503", constraint: "professional_slots_offer_fk" });
    }, 60_000);

    it("FK composta: a regra de OUTRO profissional falha (23503 professional_slots_rule_fk)", async () => {
      const dono = await semeiaProfissional();
      const outro = await semeiaProfissional();

      await expect(
        insereSlot(outro.professionalId, hora("10:00"), hora("10:30"), { ofertaId: outro.ofertaId, regraId: dono.regraId }),
      ).rejects.toMatchObject({ code: "23503", constraint: "professional_slots_rule_fk" });
    }, 60_000);

    it("UNIQUE (professional_id, id) existe em professional_slots (alvo das FKs compostas)", async () => {
      const r = await pool.query<{ contype: string }>(
        "SELECT contype FROM pg_constraint WHERE conrelid = 'professional_slots'::regclass AND conname = 'professional_slots_professional_id_uq'",
      );
      expect(r.rows).toEqual([{ contype: "u" }]);
      const colunas = await pool.query<{ attname: string }>(
        `SELECT a.attname FROM pg_constraint c JOIN LATERAL unnest(c.conkey) k(attnum) ON true
           JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
          WHERE c.conname = 'professional_slots_professional_id_uq' ORDER BY a.attname`,
      );
      expect(colunas.rows.map((x) => x.attname)).toEqual(["id", "professional_id"]);
    }, 60_000);

    it("apagar uma oferta referenciada por slots falha (23503), mesmo sem regras a apontar para ela", async () => {
      const s = await semeiaProfissional();
      const ofertaVideo = await criaOfertaVideo(s);
      // Slot com a oferta por vídeo e a regra da oferta presencial: a única referência a `ofertaVideo` é o slot.
      await insereSlot(s.professionalId, hora("10:00"), hora("10:30"), { ofertaId: ofertaVideo, regraId: s.regraId });

      await expect(pool.query("DELETE FROM professional_offers WHERE id = $1", [ofertaVideo])).rejects.toMatchObject({
        code: "23503",
        constraint: "professional_slots_offer_fk",
      });
    }, 60_000);

    it("apagar uma regra referenciada por slots falha (23503 professional_slots_rule_fk)", async () => {
      const s = await semeiaProfissional();
      await insereSlot(s.professionalId, hora("10:00"), hora("10:30"), s);

      await expect(pool.query("DELETE FROM professional_schedule_rules WHERE id = $1", [s.regraId])).rejects.toMatchObject({
        code: "23503",
        constraint: "professional_slots_rule_fk",
      });
    }, 60_000);

    it("apagar o profissional apaga slots, regras, ofertas e especialidades associadas (cascata); o catálogo de especialidades fica", async () => {
      const s = await semeiaProfissional();
      await insereSlot(s.professionalId, hora("10:00"), hora("10:30"), s);

      await pool.query("DELETE FROM professionals WHERE id = $1", [s.professionalId]);

      const contagem = await pool.query<{ slots: number; regras: number; ofertas: number; ligacoes: number; especialidades: number }>(
        `SELECT
           (SELECT count(*)::int FROM professional_slots WHERE professional_id = $1) AS slots,
           (SELECT count(*)::int FROM professional_schedule_rules WHERE professional_id = $1) AS regras,
           (SELECT count(*)::int FROM professional_offers WHERE professional_id = $1) AS ofertas,
           (SELECT count(*)::int FROM professional_specialties WHERE professional_id = $1) AS ligacoes,
           (SELECT count(*)::int FROM specialties WHERE id = $2) AS especialidades`,
        [s.professionalId, s.especialidadeId],
      );
      expect(contagem.rows[0]).toEqual({ slots: 0, regras: 0, ofertas: 0, ligacoes: 0, especialidades: 1 });
    }, 60_000);
  });
});
