// Integração real (testcontainers + PostgreSQL 16) da migração 0043 (MK1, ADR-037, schema.md §11): identidade própria do
// profissional (contas, tokens, sessões), perfil e estado de validação, catálogo de especialidades, credenciais, outbox de
// ficheiros e audit_logs. Só pool.query com SQL cru: sem repositórios nem use cases. Erros verificados por SQLSTATE e,
// quando aplicável, pelo nome da constraint.
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultMigrationsDir, runMigrations } from "../../db/migrate-runner.js";

/** Erro devolvido pelo driver pg (SQLSTATE em `code`, nome da constraint em `constraint`). */
interface ErroPg {
  code?: string;
  constraint?: string;
  message: string;
}

function must<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error("esperava valor");
  }
  return value;
}

describe("integração: identidade, perfil, especialidades, credenciais e audit (migração 0043)", () => {
  let container: StartedTestContainer;
  let pool: Pool;

  /** Email único (case mantido) para evitar colisões entre testes. */
  const emailUnico = (prefixo = "prof") => `${prefixo}-${randomUUID()}@exemplo.pt`;
  /** Nome de especialidade único (minúsculas hexadecimais, portanto seguro para comparar em maiúsculas). */
  const nomeUnico = () => `Esp-${randomUUID()}`;

  /** Executa uma consulta que tem de falhar e devolve o erro pg; falha o teste se passar. */
  async function capturarErro(sql: string, params: unknown[] = []): Promise<ErroPg> {
    try {
      await pool.query(sql, params);
    } catch (err) {
      return err as ErroPg;
    }
    throw new Error("esperava erro SQL, mas a consulta passou");
  }

  /** Insere uma conta com o mínimo válido; `campos` sobrepõe colunas (nomes controlados pelos testes). */
  async function inserirConta(campos: Record<string, unknown> = {}): Promise<string> {
    const base: Record<string, unknown> = {
      email: emailUnico(),
      password_hash: "hash",
      terms_accepted_version: "1.0",
      terms_accepted_at: new Date(),
      ...campos,
    };
    const colunas = Object.keys(base);
    const placeholders = colunas.map((_, i) => `$${String(i + 1)}`).join(", ");
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO professional_accounts (${colunas.join(", ")}) VALUES (${placeholders}) RETURNING id`,
      Object.values(base),
    );
    return must(rows[0]).id;
  }

  /** Insere um perfil profissional ligado à conta; `campos` sobrepõe colunas. */
  async function inserirProfissional(accountId: string, campos: Record<string, unknown> = {}): Promise<string> {
    const base: Record<string, unknown> = { account_id: accountId, ...campos };
    const colunas = Object.keys(base);
    const placeholders = colunas.map((_, i) => `$${String(i + 1)}`).join(", ");
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO professionals (${colunas.join(", ")}) VALUES (${placeholders}) RETURNING id`,
      Object.values(base),
    );
    return must(rows[0]).id;
  }

  /** Conta + perfil (DRAFT) com o mínimo válido. */
  async function criarProfissionalComConta(): Promise<{ accountId: string; professionalId: string }> {
    const accountId = await inserirConta();
    const professionalId = await inserirProfissional(accountId);
    return { accountId, professionalId };
  }

  /** Especialidade com nome único. */
  async function inserirEspecialidade(campos: Record<string, unknown> = {}): Promise<string> {
    const base: Record<string, unknown> = { name: nomeUnico(), category: "HEALTH", ...campos };
    const colunas = Object.keys(base);
    const placeholders = colunas.map((_, i) => `$${String(i + 1)}`).join(", ");
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO specialties (${colunas.join(", ")}) VALUES (${placeholders}) RETURNING id`,
      Object.values(base),
    );
    return must(rows[0]).id;
  }

  /** Credencial com o mínimo válido (PDF de 1 KiB, chave de armazenamento única). */
  async function inserirCredencial(professionalId: string, campos: Record<string, unknown> = {}): Promise<string> {
    const base: Record<string, unknown> = {
      professional_id: professionalId,
      kind: "IDENTITY",
      storage_key: `credenciais/${randomUUID()}.pdf`,
      content_type: "application/pdf",
      size_bytes: 1024,
      ...campos,
    };
    const colunas = Object.keys(base);
    const placeholders = colunas.map((_, i) => `$${String(i + 1)}`).join(", ");
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO professional_credentials (${colunas.join(", ")}) VALUES (${placeholders}) RETURNING id`,
      Object.values(base),
    );
    return must(rows[0]).id;
  }

  async function contar(sql: string, params: unknown[]): Promise<number> {
    const { rows } = await pool.query<{ n: string }>(sql, params);
    return Number(must(rows[0]).n);
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

  describe("professional_accounts", () => {
    it("email é único sem distinguir maiúsculas (citext): A@x.pt e a@x.pt colidem (23505)", async () => {
      const base = `Dup-${randomUUID()}@exemplo.pt`;
      await inserirConta({ email: base.toUpperCase() });
      const erro = await capturarErro(
        "INSERT INTO professional_accounts (email, password_hash, terms_accepted_version, terms_accepted_at) VALUES ($1, 'hash', '1.0', now())",
        [base.toLowerCase()],
      );
      expect(erro.code).toBe("23505");
      expect(erro.constraint).toBe("professional_accounts_email_key");
    });

    it("status ACTIVE sem email_verified_at falha (23514, professional_accounts_active_verified_check)", async () => {
      const erro = await capturarErro(
        `INSERT INTO professional_accounts (email, password_hash, status, terms_accepted_version, terms_accepted_at)
         VALUES ($1, 'hash', 'ACTIVE', '1.0', now())`,
        [emailUnico()],
      );
      expect(erro.code).toBe("23514");
      expect(erro.constraint).toBe("professional_accounts_active_verified_check");
    });

    it("status ACTIVE com email_verified_at passa", async () => {
      const id = await inserirConta({ status: "ACTIVE", email_verified_at: new Date() });
      const { rows } = await pool.query<{ status: string }>("SELECT status FROM professional_accounts WHERE id = $1", [id]);
      expect(must(rows[0]).status).toBe("ACTIVE");
    });

    it("defaults: status PENDING_VERIFICATION, email_verified_at nulo, timestamps preenchidos", async () => {
      const id = await inserirConta();
      const { rows } = await pool.query<{
        status: string;
        email_verified_at: Date | null;
        last_login_at: Date | null;
        created_at: Date | null;
        updated_at: Date | null;
      }>("SELECT status, email_verified_at, last_login_at, created_at, updated_at FROM professional_accounts WHERE id = $1", [id]);
      expect(must(rows[0]).status).toBe("PENDING_VERIFICATION");
      expect(must(rows[0]).email_verified_at).toBeNull();
      expect(must(rows[0]).last_login_at).toBeNull();
      expect(must(rows[0]).created_at).not.toBeNull();
      expect(must(rows[0]).updated_at).not.toBeNull();
    });
  });

  describe("professional_auth_tokens e professional_sessions", () => {
    it("token_hash é único (23505, professional_auth_tokens_token_hash_key)", async () => {
      const accountId = await inserirConta();
      const hash = `hash-${randomUUID()}`;
      await pool.query(
        "INSERT INTO professional_auth_tokens (account_id, type, token_hash, expires_at) VALUES ($1, 'EMAIL_VERIFICATION', $2, now() + interval '1 day')",
        [accountId, hash],
      );
      const erro = await capturarErro(
        "INSERT INTO professional_auth_tokens (account_id, type, token_hash, expires_at) VALUES ($1, 'PASSWORD_RESET', $2, now() + interval '1 day')",
        [accountId, hash],
      );
      expect(erro.code).toBe("23505");
      expect(erro.constraint).toBe("professional_auth_tokens_token_hash_key");
    });

    it("aceita auth_token_type EMAIL_VERIFICATION e PASSWORD_RESET", async () => {
      const accountId = await inserirConta();
      await pool.query(
        "INSERT INTO professional_auth_tokens (account_id, type, token_hash, expires_at) VALUES ($1, 'EMAIL_VERIFICATION', $2, now() + interval '1 day'), ($1, 'PASSWORD_RESET', $3, now() + interval '1 day')",
        [accountId, `h-${randomUUID()}`, `h-${randomUUID()}`],
      );
      const n = await contar("SELECT count(*) AS n FROM professional_auth_tokens WHERE account_id = $1", [accountId]);
      expect(n).toBe(2);
    });

    it("token com account_id inexistente falha (23503, professional_auth_tokens_account_id_fkey)", async () => {
      const erro = await capturarErro(
        "INSERT INTO professional_auth_tokens (account_id, type, token_hash, expires_at) VALUES ($1, 'EMAIL_VERIFICATION', $2, now())",
        [randomUUID(), `h-${randomUUID()}`],
      );
      expect(erro.code).toBe("23503");
      expect(erro.constraint).toBe("professional_auth_tokens_account_id_fkey");
    });

    it("refresh_token_hash é único (23505, professional_sessions_refresh_token_hash_key)", async () => {
      const accountId = await inserirConta();
      const hash = `rt-${randomUUID()}`;
      const sessao = "INSERT INTO professional_sessions (account_id, refresh_token_hash, token_chain_id, expires_at) VALUES ($1, $2, $3, now() + interval '30 days')";
      await pool.query(sessao, [accountId, hash, randomUUID()]);
      const erro = await capturarErro(sessao, [accountId, hash, randomUUID()]);
      expect(erro.code).toBe("23505");
      expect(erro.constraint).toBe("professional_sessions_refresh_token_hash_key");
    });

    it("apagar a conta apaga em cascata tokens e sessões", async () => {
      const accountId = await inserirConta();
      await pool.query(
        "INSERT INTO professional_auth_tokens (account_id, type, token_hash, expires_at) VALUES ($1, 'EMAIL_VERIFICATION', $2, now())",
        [accountId, `h-${randomUUID()}`],
      );
      await pool.query(
        "INSERT INTO professional_sessions (account_id, refresh_token_hash, token_chain_id, expires_at) VALUES ($1, $2, $3, now())",
        [accountId, `rt-${randomUUID()}`, randomUUID()],
      );
      await pool.query("DELETE FROM professional_accounts WHERE id = $1", [accountId]);
      expect(await contar("SELECT count(*) AS n FROM professional_auth_tokens WHERE account_id = $1", [accountId])).toBe(0);
      expect(await contar("SELECT count(*) AS n FROM professional_sessions WHERE account_id = $1", [accountId])).toBe(0);
    });
  });

  describe("professionals", () => {
    it("account_id é único: segundo perfil para a mesma conta falha (23505, professionals_account_id_key)", async () => {
      const { accountId } = await criarProfissionalComConta();
      const erro = await capturarErro("INSERT INTO professionals (account_id) VALUES ($1)", [accountId]);
      expect(erro.code).toBe("23505");
      expect(erro.constraint).toBe("professionals_account_id_key");
    });

    it("defaults: validation_status DRAFT, status_changed_at preenchido, restantes colunas nulas", async () => {
      const { professionalId } = await criarProfissionalComConta();
      const { rows } = await pool.query<{
        validation_status: string;
        status_changed_at: Date | null;
        display_name: string | null;
        submitted_at: Date | null;
        approved_at: Date | null;
      }>("SELECT validation_status, status_changed_at, display_name, submitted_at, approved_at FROM professionals WHERE id = $1", [professionalId]);
      expect(must(rows[0]).validation_status).toBe("DRAFT");
      expect(must(rows[0]).status_changed_at).not.toBeNull();
      expect(must(rows[0]).display_name).toBeNull();
      expect(must(rows[0]).submitted_at).toBeNull();
      expect(must(rows[0]).approved_at).toBeNull();
    });

    it("display_name com 1 caractere falha (23514, professionals_display_name_check)", async () => {
      const accountId = await inserirConta();
      const erro = await capturarErro("INSERT INTO professionals (account_id, display_name) VALUES ($1, 'A')", [accountId]);
      expect(erro.code).toBe("23514");
      expect(erro.constraint).toBe("professionals_display_name_check");
    });

    it("display_name com 2 caracteres passa", async () => {
      const accountId = await inserirConta();
      const id = await inserirProfissional(accountId, { display_name: "Ab" });
      expect(id).toBeTruthy();
    });

    it("bio com mais de 1000 caracteres falha (23514, professionals_bio_check); com 1000 passa", async () => {
      const accountId = await inserirConta();
      const erro = await capturarErro("INSERT INTO professionals (account_id, bio) VALUES ($1, $2)", [accountId, "b".repeat(1001)]);
      expect(erro.code).toBe("23514");
      expect(erro.constraint).toBe("professionals_bio_check");

      const id = await inserirProfissional(accountId, { bio: "b".repeat(1000) });
      expect(id).toBeTruthy();
    });

    it("city com 1 caractere falha (23514, professionals_city_check)", async () => {
      const accountId = await inserirConta();
      const erro = await capturarErro("INSERT INTO professionals (account_id, city) VALUES ($1, 'L')", [accountId]);
      expect(erro.code).toBe("23514");
      expect(erro.constraint).toBe("professionals_city_check");
    });

    it("payment_instructions com mais de 500 caracteres falha (23514, professionals_payment_instructions_check)", async () => {
      const accountId = await inserirConta();
      const erro = await capturarErro("INSERT INTO professionals (account_id, payment_instructions) VALUES ($1, $2)", [accountId, "p".repeat(501)]);
      expect(erro.code).toBe("23514");
      expect(erro.constraint).toBe("professionals_payment_instructions_check");
    });

    it("status_reason com mais de 500 caracteres falha (23514, professionals_status_reason_check)", async () => {
      const accountId = await inserirConta();
      const erro = await capturarErro("INSERT INTO professionals (account_id, status_reason) VALUES ($1, $2)", [accountId, "r".repeat(501)]);
      expect(erro.code).toBe("23514");
      expect(erro.constraint).toBe("professionals_status_reason_check");
    });

    it.each(["PENDING_REVIEW", "APPROVED", "NEEDS_INFO", "REJECTED", "SUSPENDED"])(
      "estado %s sem submitted_at falha (23514, professionals_submitted_after_draft_check)",
      async (estado) => {
        const accountId = await inserirConta();
        const erro = await capturarErro(
          "INSERT INTO professionals (account_id, validation_status, display_name, city, approved_at) VALUES ($1, $2, 'Ana', 'Luanda', now())",
          [accountId, estado],
        );
        expect(erro.code).toBe("23514");
        expect(erro.constraint).toBe("professionals_submitted_after_draft_check");
      },
    );

    it("estado PENDING_REVIEW com submitted_at passa", async () => {
      const accountId = await inserirConta();
      const id = await inserirProfissional(accountId, { validation_status: "PENDING_REVIEW", submitted_at: new Date() });
      expect(id).toBeTruthy();
    });

    describe("APPROVED exige display_name, city e approved_at", () => {
      const completo = { validation_status: "APPROVED", display_name: "Ana Silva", city: "Luanda", submitted_at: new Date(), approved_at: new Date() };

      it("com todos os campos passa", async () => {
        const accountId = await inserirConta();
        const id = await inserirProfissional(accountId, completo);
        expect(id).toBeTruthy();
      });

      it.each(["display_name", "city", "approved_at"] as const)("sem %s falha (23514, professionals_approved_complete_check)", async (campo) => {
        const accountId = await inserirConta();
        const campos = Object.fromEntries(Object.entries(completo).filter(([k]) => k !== campo));
        const erro = await capturarErro(
          `INSERT INTO professionals (${["account_id", ...Object.keys(campos)].join(", ")}) VALUES (${["$1", ...Object.keys(campos).map((_, i) => `$${String(i + 2)}`)].join(", ")})`,
          [accountId, ...Object.values(campos)],
        );
        expect(erro.code).toBe("23514");
        expect(erro.constraint).toBe("professionals_approved_complete_check");
      });
    });

    it("apagar a conta apaga em cascata o perfil", async () => {
      const { accountId, professionalId } = await criarProfissionalComConta();
      await pool.query("DELETE FROM professional_accounts WHERE id = $1", [accountId]);
      expect(await contar("SELECT count(*) AS n FROM professionals WHERE id = $1", [professionalId])).toBe(0);
    });
  });

  describe("specialties", () => {
    it("nome é único sem distinguir maiúsculas (23505, specialties_name_lower_uq)", async () => {
      const u = randomUUID();
      await inserirEspecialidade({ name: `Esp-${u}` });
      const erro = await capturarErro("INSERT INTO specialties (name, category) VALUES ($1, 'WELLNESS')", [`ESP-${u.toUpperCase()}`]);
      expect(erro.code).toBe("23505");
      expect(erro.constraint).toBe("specialties_name_lower_uq");
    });

    it("name com 1 caractere falha (23514, specialties_name_check); com 2 passa", async () => {
      const erro = await capturarErro("INSERT INTO specialties (name, category) VALUES ('A', 'HEALTH')");
      expect(erro.code).toBe("23514");
      expect(erro.constraint).toBe("specialties_name_check");

      const id = await inserirEspecialidade({ name: "Ab" + randomUUID().slice(0, 8) });
      expect(id).toBeTruthy();
    });

    it("name com 81 caracteres falha e com 80 passa (limite 2..80)", async () => {
      const erro = await capturarErro("INSERT INTO specialties (name, category) VALUES ($1, 'HEALTH')", ["x".repeat(81)]);
      expect(erro.code).toBe("23514");
      expect(erro.constraint).toBe("specialties_name_check");

      const id = await inserirEspecialidade({ name: "y".repeat(80) });
      expect(id).toBeTruthy();
    });

    it("category fora do enum (HEALTH/WELLNESS) falha com 22P02", async () => {
      const erro = await capturarErro("INSERT INTO specialties (name, category) VALUES ($1, 'OUTRA')", [nomeUnico()]);
      expect(erro.code).toBe("22P02");
    });

    it("aceita category WELLNESS e tem active = true por defeito", async () => {
      const id = await inserirEspecialidade({ category: "WELLNESS" });
      const { rows } = await pool.query<{ category: string; active: boolean }>("SELECT category, active FROM specialties WHERE id = $1", [id]);
      expect(must(rows[0]).category).toBe("WELLNESS");
      expect(must(rows[0]).active).toBe(true);
    });
  });

  describe("professional_specialties", () => {
    it("PK composta (professional_id, specialty_id): par duplicado falha (23505, professional_specialties_pkey)", async () => {
      const { professionalId } = await criarProfissionalComConta();
      const specialtyId = await inserirEspecialidade();
      const ligacao = "INSERT INTO professional_specialties (professional_id, specialty_id) VALUES ($1, $2)";
      await pool.query(ligacao, [professionalId, specialtyId]);
      const erro = await capturarErro(ligacao, [professionalId, specialtyId]);
      expect(erro.code).toBe("23505");
      expect(erro.constraint).toBe("professional_specialties_pkey");
    });

    it("apagar uma especialidade com ligações falha (23503, RESTRICT)", async () => {
      const { professionalId } = await criarProfissionalComConta();
      const specialtyId = await inserirEspecialidade();
      await pool.query("INSERT INTO professional_specialties (professional_id, specialty_id) VALUES ($1, $2)", [professionalId, specialtyId]);
      const erro = await capturarErro("DELETE FROM specialties WHERE id = $1", [specialtyId]);
      expect(erro.code).toBe("23503");
      expect(erro.constraint).toBe("professional_specialties_specialty_id_fkey");
    });

    it("apagar o profissional remove as ligações em cascata, e a especialidade continua a existir", async () => {
      const { professionalId } = await criarProfissionalComConta();
      const specialtyId = await inserirEspecialidade();
      await pool.query("INSERT INTO professional_specialties (professional_id, specialty_id) VALUES ($1, $2)", [professionalId, specialtyId]);
      await pool.query("DELETE FROM professionals WHERE id = $1", [professionalId]);
      expect(await contar("SELECT count(*) AS n FROM professional_specialties WHERE professional_id = $1", [professionalId])).toBe(0);
      expect(await contar("SELECT count(*) AS n FROM specialties WHERE id = $1", [specialtyId])).toBe(1);
    });
  });

  describe("professional_credentials", () => {
    it("storage_key é único (23505, professional_credentials_storage_key_key)", async () => {
      const { professionalId } = await criarProfissionalComConta();
      const storageKey = `credenciais/${randomUUID()}.pdf`;
      await inserirCredencial(professionalId, { storage_key: storageKey });
      const erro = await capturarErro(
        "INSERT INTO professional_credentials (professional_id, kind, storage_key, content_type, size_bytes) VALUES ($1, 'IDENTITY', $2, 'application/pdf', 1024)",
        [professionalId, storageKey],
      );
      expect(erro.code).toBe("23505");
      expect(erro.constraint).toBe("professional_credentials_storage_key_key");
    });

    it.each(["image/gif", "text/plain", "application/octet-stream"])("content_type %s falha (23514, professional_credentials_content_type_check)", async (tipo) => {
      const { professionalId } = await criarProfissionalComConta();
      const erro = await capturarErro(
        "INSERT INTO professional_credentials (professional_id, kind, storage_key, content_type, size_bytes) VALUES ($1, 'IDENTITY', $2, $3, 1024)",
        [professionalId, `credenciais/${randomUUID()}`, tipo],
      );
      expect(erro.code).toBe("23514");
      expect(erro.constraint).toBe("professional_credentials_content_type_check");
    });

    it.each(["application/pdf", "image/jpeg", "image/png"])("content_type %s passa", async (tipo) => {
      const { professionalId } = await criarProfissionalComConta();
      const id = await inserirCredencial(professionalId, { content_type: tipo });
      expect(id).toBeTruthy();
    });

    it("size_bytes 0 falha (23514, professional_credentials_size_bytes_check)", async () => {
      const { professionalId } = await criarProfissionalComConta();
      const erro = await capturarErro(
        "INSERT INTO professional_credentials (professional_id, kind, storage_key, content_type, size_bytes) VALUES ($1, 'IDENTITY', $2, 'application/pdf', 0)",
        [professionalId, `credenciais/${randomUUID()}`],
      );
      expect(erro.code).toBe("23514");
      expect(erro.constraint).toBe("professional_credentials_size_bytes_check");
    });

    it("size_bytes 10485761 falha (23514); 1 e 10485760 passam (limite 1..10 MiB)", async () => {
      const { professionalId } = await criarProfissionalComConta();
      const erro = await capturarErro(
        "INSERT INTO professional_credentials (professional_id, kind, storage_key, content_type, size_bytes) VALUES ($1, 'IDENTITY', $2, 'application/pdf', 10485761)",
        [professionalId, `credenciais/${randomUUID()}`],
      );
      expect(erro.code).toBe("23514");
      expect(erro.constraint).toBe("professional_credentials_size_bytes_check");

      expect(await inserirCredencial(professionalId, { size_bytes: 1 })).toBeTruthy();
      expect(await inserirCredencial(professionalId, { size_bytes: 10485760 })).toBeTruthy();
    });

    it("number com mais de 60 caracteres falha (23514, professional_credentials_number_check)", async () => {
      const { professionalId } = await criarProfissionalComConta();
      const erro = await capturarErro(
        "INSERT INTO professional_credentials (professional_id, kind, storage_key, content_type, size_bytes, number) VALUES ($1, 'PROFESSIONAL_LICENSE', $2, 'application/pdf', 1024, $3)",
        [professionalId, `credenciais/${randomUUID()}`, "n".repeat(61)],
      );
      expect(erro.code).toBe("23514");
      expect(erro.constraint).toBe("professional_credentials_number_check");
    });

    it("issuing_body com mais de 120 caracteres falha (23514, professional_credentials_issuing_body_check)", async () => {
      const { professionalId } = await criarProfissionalComConta();
      const erro = await capturarErro(
        "INSERT INTO professional_credentials (professional_id, kind, storage_key, content_type, size_bytes, issuing_body) VALUES ($1, 'CERTIFICATION', $2, 'application/pdf', 1024, $3)",
        [professionalId, `credenciais/${randomUUID()}`, "e".repeat(121)],
      );
      expect(erro.code).toBe("23514");
      expect(erro.constraint).toBe("professional_credentials_issuing_body_check");
    });

    it("scan_status por defeito é PENDING", async () => {
      const { professionalId } = await criarProfissionalComConta();
      const id = await inserirCredencial(professionalId);
      const { rows } = await pool.query<{ scan_status: string; scanned_at: Date | null }>(
        "SELECT scan_status, scanned_at FROM professional_credentials WHERE id = $1",
        [id],
      );
      expect(must(rows[0]).scan_status).toBe("PENDING");
      expect(must(rows[0]).scanned_at).toBeNull();
    });

    it("apagar o profissional apaga as credenciais em cascata", async () => {
      const { professionalId } = await criarProfissionalComConta();
      await inserirCredencial(professionalId);
      await inserirCredencial(professionalId);
      await pool.query("DELETE FROM professionals WHERE id = $1", [professionalId]);
      expect(await contar("SELECT count(*) AS n FROM professional_credentials WHERE professional_id = $1", [professionalId])).toBe(0);
    });
  });

  describe("professional_file_deletions", () => {
    it("insert mínimo usa defaults: attempts 0 e deleted_at nulo", async () => {
      const { rows } = await pool.query<{ attempts: number; deleted_at: Date | null; created_at: Date | null }>(
        "INSERT INTO professional_file_deletions (storage_key) VALUES ($1) RETURNING attempts, deleted_at, created_at",
        [`credenciais/${randomUUID()}.pdf`],
      );
      expect(must(rows[0]).attempts).toBe(0);
      expect(must(rows[0]).deleted_at).toBeNull();
      expect(must(rows[0]).created_at).not.toBeNull();
    });

    it("não tem FK: aceita storage_key arbitrária sem ligação a nenhum profissional", async () => {
      const chave = `inexistente/${randomUUID()}`;
      await pool.query("INSERT INTO professional_file_deletions (storage_key) VALUES ($1)", [chave]);
      expect(await contar("SELECT count(*) AS n FROM professional_file_deletions WHERE storage_key = $1", [chave])).toBe(1);
    });
  });

  describe("audit_logs (actor do portal do profissional)", () => {
    it("INSERT com actor_type PROFESSIONAL_ACCOUNT e actor_professional_account_id inexistente funciona (sem FK)", async () => {
      const actorId = randomUUID();
      const { rows } = await pool.query<{ id: string; actor_type: string; actor_professional_account_id: string }>(
        `INSERT INTO audit_logs (actor_type, actor_professional_account_id, action, resource_type, result, request_id)
         VALUES ('PROFESSIONAL_ACCOUNT', $1, 'PROFESSIONAL_LOGIN', 'professional_account', 'SUCCESS', $2)
         RETURNING id, actor_type, actor_professional_account_id`,
        [actorId, `req-${randomUUID()}`],
      );
      expect(must(rows[0]).actor_type).toBe("PROFESSIONAL_ACCOUNT");
      expect(must(rows[0]).actor_professional_account_id).toBe(actorId);
    });

    it("colunas obrigatórias: sem request_id falha (23502, not_null_violation)", async () => {
      const erro = await capturarErro(
        "INSERT INTO audit_logs (actor_type, action, resource_type, result) VALUES ('PROFESSIONAL_ACCOUNT', 'PROFESSIONAL_LOGIN', 'professional_account', 'SUCCESS')",
      );
      expect(erro.code).toBe("23502");
    });
  });
});
