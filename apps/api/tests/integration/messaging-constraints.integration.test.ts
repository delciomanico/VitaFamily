// Integração real (testcontainers + PostgreSQL 16) da migração 0044 (MK2, ADR-037, schema.md §12; TC-MKT-70..73): CHECKs de
// estado e marcadores, UNIQUE do par e concorrência (um só par, seq sem lacunas), idempotência por client_message_id, trigger de
// imutabilidade das mensagens, denúncias, cascatas, valores novos de enum e migração sobre BD com dados. Só SQL cru.
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

describe("integração: migração 0044 (MK2) e restrições de conversations/messages/message_reports", () => {
  let container: StartedTestContainer;
  let pool: Pool;
  const abertas: Pool[] = [];
  const urlDe = (bd: string) =>
    `postgres://vita:vita@${container.getHost()}:${String(container.getMappedPort(5432))}/${bd}`;

  async function criarUtilizador(): Promise<string> {
    const id = randomUUID();
    await pool.query(
      "INSERT INTO users (id, email, password_hash, name, birth_date, timezone, terms_accepted_version, terms_accepted_at) VALUES ($1, $2, 'x', 'U', '1980-01-01', 'Europe/Lisbon', 'v1', now())",
      [id, `u-${id}@teste.pt`],
    );
    return id;
  }

  /** Família com um membro (ligado ao utilizador). */
  async function criarMembro(): Promise<{ userId: string; familyId: string; memberId: string }> {
    const userId = await criarUtilizador();
    const familyId = randomUUID();
    const memberId = randomUUID();
    await pool.query("INSERT INTO families (id, name) VALUES ($1, 'F')", [familyId]);
    await pool.query(
      "INSERT INTO family_members (id, family_id, user_id, name, birth_date, role) VALUES ($1,$2,$3,'M','1990-01-01','FAMILY_ADMIN')",
      [memberId, familyId, userId],
    );
    return { userId, familyId, memberId };
  }

  async function criarProfissional(): Promise<string> {
    const accountId = randomUUID();
    await pool.query(
      "INSERT INTO professional_accounts (id, email, password_hash, terms_accepted_version, terms_accepted_at) VALUES ($1,$2,'x','v1',now())",
      [accountId, `p-${accountId}@teste.pt`],
    );
    const id = randomUUID();
    await pool.query("INSERT INTO professionals (id, account_id) VALUES ($1,$2)", [id, accountId]);
    return id;
  }

  async function criarConversa(
    m: { userId: string; familyId: string; memberId: string },
    professionalId: string,
    extra: { lastSeq?: number } = {},
  ): Promise<string> {
    const id = randomUUID();
    await pool.query(
      "INSERT INTO conversations (id, family_id, member_id, professional_id, opened_by_user_id, participant_label, last_seq, last_message_at) VALUES ($1,$2,$3,$4,$5,'Ana',$6,now())",
      [id, m.familyId, m.memberId, professionalId, m.userId, extra.lastSeq ?? 1],
    );
    return id;
  }

  async function criarMensagem(
    conversationId: string,
    seq: number,
    side: "FAMILY" | "PROFESSIONAL",
    senderUserId: string | null,
    clientId: string | null = null,
  ): Promise<string> {
    const id = randomUUID();
    await pool.query(
      "INSERT INTO messages (id, conversation_id, seq, side, sender_user_id, body, client_message_id) VALUES ($1,$2,$3,$4,$5,'olá',$6)",
      [id, conversationId, seq, side, senderUserId, clientId],
    );
    return id;
  }

  async function conta(tabela: string, where: string, params: unknown[]): Promise<number> {
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM ${tabela} WHERE ${where}`,
      params,
    );
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
    for (const p of abertas) await p.end();
    await pool.end();
    await container.stop();
  });

  describe("conversations: CHECKs, UNIQUE e FKs", () => {
    it("aceita uma conversa válida e aplica os defeitos", async () => {
      const m = await criarMembro();
      const id = await criarConversa(m, await criarProfissional());
      const { rows } = await pool.query(
        "SELECT status, closed_by, last_professional_seq, family_read_seq, professional_read_seq FROM conversations WHERE id = $1",
        [id],
      );
      expect(rows[0]).toMatchObject({
        status: "OPEN",
        closed_by: null,
        last_professional_seq: 0,
        family_read_seq: 0,
        professional_read_seq: 0,
      });
    });

    it.each([
      [
        "label vazia",
        "UPDATE conversations SET participant_label = '   ' WHERE id = $1",
        "conversations_label_check",
      ],
      [
        "label com 41 caracteres",
        `UPDATE conversations SET participant_label = '${"a".repeat(41)}' WHERE id = $1`,
        "conversations_label_check",
      ],
      [
        "CLOSED sem closed_by/closed_at",
        "UPDATE conversations SET status = 'CLOSED' WHERE id = $1",
        "conversations_closed_check",
      ],
      [
        "closed_by sem CLOSED",
        "UPDATE conversations SET closed_by = 'FAMILY', closed_at = now() WHERE id = $1",
        "conversations_closed_check",
      ],
      [
        "last_seq < 1",
        "UPDATE conversations SET last_seq = 0 WHERE id = $1",
        "conversations_last_seq_check",
      ],
      [
        "family_read_seq > last_seq",
        "UPDATE conversations SET family_read_seq = 2 WHERE id = $1",
        "conversations_family_read_check",
      ],
      [
        "professional_read_seq > last_seq",
        "UPDATE conversations SET professional_read_seq = 2 WHERE id = $1",
        "conversations_professional_read_check",
      ],
      [
        "last_professional_seq > last_seq",
        "UPDATE conversations SET last_professional_seq = 2 WHERE id = $1",
        "conversations_last_professional_seq_check",
      ],
      [
        "read_seq negativo",
        "UPDATE conversations SET family_read_seq = -1 WHERE id = $1",
        "conversations_family_read_check",
      ],
    ])("rejeita %s (23514)", async (_nome, sql, restricao) => {
      const id = await criarConversa(await criarMembro(), await criarProfissional());
      const err = await erroDe(pool.query(sql, [id]));
      expect(err.code).toBe("23514");
      expect(err.constraint).toBe(restricao);
    });

    it("aceita fechar com closed_by e closed_at", async () => {
      const id = await criarConversa(await criarMembro(), await criarProfissional());
      await pool.query(
        "UPDATE conversations SET status = 'CLOSED', closed_by = 'SYSTEM', closed_at = now() WHERE id = $1",
        [id],
      );
      expect(await conta("conversations", "id = $1 AND status = 'CLOSED'", [id])).toBe(1);
    });

    it("rejeita a segunda conversa do mesmo (família, membro, profissional) (23505) e aceita outro profissional", async () => {
      const m = await criarMembro();
      const p = await criarProfissional();
      await criarConversa(m, p);
      const err = await erroDe(criarConversa(m, p));
      expect(err.code).toBe("23505");
      expect(err.constraint).toBe("conversations_pair_uq");
      await criarConversa(m, await criarProfissional());
    });

    it("abertura concorrente do mesmo par com ON CONFLICT DO NOTHING resulta numa só conversa", async () => {
      const m = await criarMembro();
      const p = await criarProfissional();
      const abrir = () =>
        pool.query(
          "INSERT INTO conversations (family_id, member_id, professional_id, participant_label, last_seq, last_message_at) VALUES ($1,$2,$3,'Ana',1,now()) ON CONFLICT (family_id, member_id, professional_id) DO NOTHING",
          [m.familyId, m.memberId, p],
        );
      await Promise.all(Array.from({ length: 8 }, abrir));
      expect(
        await conta("conversations", "family_id = $1 AND member_id = $2 AND professional_id = $3", [
          m.familyId,
          m.memberId,
          p,
        ]),
      ).toBe(1);
    });

    it("rejeita membro de outra família (FK composta, 23503)", async () => {
      const a = await criarMembro();
      const b = await criarMembro();
      const err = await erroDe(
        criarConversa(
          { userId: a.userId, familyId: a.familyId, memberId: b.memberId },
          await criarProfissional(),
        ),
      );
      expect(err.code).toBe("23503");
    });
  });

  describe("messages: CHECKs, seq e idempotência", () => {
    it.each([
      [
        "seq 0",
        "INSERT INTO messages (conversation_id, seq, side, body) VALUES ($1, 0, 'FAMILY', 'x')",
        "messages_seq_check",
      ],
      [
        "corpo vazio",
        "INSERT INTO messages (conversation_id, seq, side, body) VALUES ($1, 2, 'FAMILY', '')",
        "messages_body_check",
      ],
      [
        "corpo com 1001 caracteres",
        `INSERT INTO messages (conversation_id, seq, side, body) VALUES ($1, 2, 'FAMILY', '${"a".repeat(1001)}')`,
        "messages_body_check",
      ],
    ])("rejeita %s (23514)", async (_nome, sql, restricao) => {
      const id = await criarConversa(await criarMembro(), await criarProfissional());
      const err = await erroDe(pool.query(sql, [id]));
      expect(err.code).toBe("23514");
      expect(err.constraint).toBe(restricao);
    });

    it("aceita corpo com 1000 caracteres", async () => {
      const id = await criarConversa(await criarMembro(), await criarProfissional());
      await pool.query(
        "INSERT INTO messages (conversation_id, seq, side, body) VALUES ($1, 2, 'FAMILY', $2)",
        [id, "a".repeat(1000)],
      );
    });

    it("mensagem do profissional não tem sender_user_id (23514)", async () => {
      const m = await criarMembro();
      const id = await criarConversa(m, await criarProfissional());
      const err = await erroDe(criarMensagem(id, 2, "PROFESSIONAL", m.userId));
      expect(err.constraint).toBe("messages_sender_side_check");
    });

    it("rejeita seq repetido na mesma conversa (23505) e aceita-o noutra", async () => {
      const m = await criarMembro();
      const id = await criarConversa(m, await criarProfissional());
      const err = await erroDe(
        criarMensagem(id, 1, "FAMILY", m.userId).then(() =>
          criarMensagem(id, 1, "FAMILY", m.userId),
        ),
      );
      expect(err.constraint).toBe("messages_conversation_seq_uq");
      await criarMensagem(
        await criarConversa(await criarMembro(), await criarProfissional()),
        1,
        "FAMILY",
        null,
      );
    });

    it("UNIQUE parcial do client_message_id: repetido na conversa falha; nulos e outra conversa passam", async () => {
      const m = await criarMembro();
      const id = await criarConversa(m, await criarProfissional());
      const cid = randomUUID();
      await criarMensagem(id, 1, "FAMILY", m.userId, cid);
      const err = await erroDe(criarMensagem(id, 2, "FAMILY", m.userId, cid));
      expect(err.code).toBe("23505");
      expect(err.constraint).toBe("messages_client_message_uq");
      await criarMensagem(id, 2, "FAMILY", m.userId, null);
      await criarMensagem(id, 3, "FAMILY", m.userId, null);
      await criarMensagem(
        await criarConversa(await criarMembro(), await criarProfissional()),
        1,
        "FAMILY",
        null,
        cid,
      );
    });

    it("envios concorrentes (UPDATE last_seq + INSERT) dão seq sem lacunas nem repetições", async () => {
      const m = await criarMembro();
      const id = await criarConversa(m, await criarProfissional());
      const N = 25;
      const enviar = async () => {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const { rows } = await client.query<{ last_seq: number }>(
            "UPDATE conversations SET last_seq = last_seq + 1, last_message_at = now() WHERE id = $1 RETURNING last_seq",
            [id],
          );
          await client.query(
            "INSERT INTO messages (conversation_id, seq, side, sender_user_id, body) VALUES ($1,$2,'FAMILY',$3,'x')",
            [id, rows[0]?.last_seq, m.userId],
          );
          await client.query("COMMIT");
        } catch (e) {
          await client.query("ROLLBACK");
          throw e;
        } finally {
          client.release();
        }
      };
      await Promise.all(Array.from({ length: N }, enviar));
      const { rows } = await pool.query<{ seq: number }>(
        "SELECT seq FROM messages WHERE conversation_id = $1 ORDER BY seq",
        [id],
      );
      expect(rows.map((r) => r.seq)).toEqual(Array.from({ length: N }, (_, i) => i + 2));
    });
  });

  describe("messages: trigger de imutabilidade", () => {
    it.each([
      ["body", "UPDATE messages SET body = 'alterado' WHERE id = $1"],
      ["seq", "UPDATE messages SET seq = 99 WHERE id = $1"],
      ["side", "UPDATE messages SET side = 'PROFESSIONAL', sender_user_id = NULL WHERE id = $1"],
      [
        "created_at",
        "UPDATE messages SET created_at = created_at + interval '1 day' WHERE id = $1",
      ],
      [
        "client_message_id",
        "UPDATE messages SET client_message_id = gen_random_uuid() WHERE id = $1",
      ],
    ])("rejeita UPDATE de %s (23000)", async (_c, sql) => {
      const m = await criarMembro();
      const mid = await criarMensagem(
        await criarConversa(m, await criarProfissional()),
        1,
        "FAMILY",
        m.userId,
      );
      const err = await erroDe(pool.query(sql, [mid]));
      expect(err.code).toBe("23000");
      expect(err.message).toContain("imutável");
    });

    it("aceita ocultar (hidden_at nulo para data) e rejeita des-ocultar ou mudar a data", async () => {
      const m = await criarMembro();
      const mid = await criarMensagem(
        await criarConversa(m, await criarProfissional()),
        1,
        "FAMILY",
        m.userId,
      );
      await pool.query("UPDATE messages SET hidden_at = now() WHERE id = $1", [mid]);
      expect(
        (await erroDe(pool.query("UPDATE messages SET hidden_at = NULL WHERE id = $1", [mid])))
          .code,
      ).toBe("23000");
      expect(
        (
          await erroDe(
            pool.query("UPDATE messages SET hidden_at = now() + interval '1 day' WHERE id = $1", [
              mid,
            ]),
          )
        ).code,
      ).toBe("23000");
    });
  });

  describe("message_reports", () => {
    async function mensagem() {
      const m = await criarMembro();
      const cid = await criarConversa(m, await criarProfissional());
      return { m, cid, mid: await criarMensagem(cid, 1, "PROFESSIONAL", null) };
    }

    it("uma denúncia por (mensagem, lado): repetir falha (23505); o outro lado passa", async () => {
      const { mid } = await mensagem();
      await pool.query(
        "INSERT INTO message_reports (message_id, reporter_side, reason) VALUES ($1,'FAMILY','SPAM')",
        [mid],
      );
      const err = await erroDe(
        pool.query(
          "INSERT INTO message_reports (message_id, reporter_side, reason) VALUES ($1,'FAMILY','ABUSE')",
          [mid],
        ),
      );
      expect(err.constraint).toBe("message_reports_message_side_uq");
      await pool.query(
        "INSERT INTO message_reports (message_id, reporter_side, reason) VALUES ($1,'PROFESSIONAL','ABUSE')",
        [mid],
      );
    });

    it("nota com mais de 300 caracteres falha; com 300 passa", async () => {
      const { mid } = await mensagem();
      const err = await erroDe(
        pool.query(
          "INSERT INTO message_reports (message_id, reporter_side, reason, note) VALUES ($1,'FAMILY','OTHER',$2)",
          [mid, "a".repeat(301)],
        ),
      );
      expect(err.constraint).toBe("message_reports_note_check");
      await pool.query(
        "INSERT INTO message_reports (message_id, reporter_side, reason, note) VALUES ($1,'FAMILY','OTHER',$2)",
        [mid, "a".repeat(300)],
      );
    });

    it.each([
      [
        "DECIDED sem decisão",
        "UPDATE message_reports SET status = 'DECIDED' WHERE id = $1",
        "message_reports_decided_check",
      ],
      [
        "decisão sem DECIDED",
        "UPDATE message_reports SET decision = 'DISMISS', decided_at = now() WHERE id = $1",
        "message_reports_decided_check",
      ],
    ])("rejeita %s (23514)", async (_n, sql, restricao) => {
      const { mid } = await mensagem();
      const { rows } = await pool.query<{ id: string }>(
        "INSERT INTO message_reports (message_id, reporter_side, reason) VALUES ($1,'FAMILY','SPAM') RETURNING id",
        [mid],
      );
      const err = await erroDe(pool.query(sql, [rows[0]?.id]));
      expect(err.constraint).toBe(restricao);
    });

    it("decided_by exige DECIDED; decisão completa passa", async () => {
      const { mid } = await mensagem();
      const admin = await criarUtilizador();
      const { rows } = await pool.query<{ id: string }>(
        "INSERT INTO message_reports (message_id, reporter_side, reason) VALUES ($1,'FAMILY','SPAM') RETURNING id",
        [mid],
      );
      const id = rows[0]?.id;
      const err = await erroDe(
        pool.query("UPDATE message_reports SET decided_by = $2 WHERE id = $1", [id, admin]),
      );
      expect(err.constraint).toBe("message_reports_decided_by_check");
      await pool.query(
        "UPDATE message_reports SET status = 'DECIDED', decision = 'HIDE_MESSAGE', decided_at = now(), decided_by = $2 WHERE id = $1",
        [id, admin],
      );
      await pool.query("DELETE FROM users WHERE id = $1", [admin]);
      expect(
        await conta("message_reports", "id = $1 AND decided_by IS NULL AND status = 'DECIDED'", [
          id,
        ]),
      ).toBe(1);
    });
  });

  describe("cascatas e SET NULL", () => {
    async function cadeia() {
      const m = await criarMembro();
      const p = await criarProfissional();
      const cid = await criarConversa(m, p);
      const mid = await criarMensagem(cid, 1, "FAMILY", m.userId);
      await pool.query(
        "INSERT INTO message_reports (message_id, reporter_side, reason) VALUES ($1,'PROFESSIONAL','SPAM')",
        [mid],
      );
      return { m, p, cid, mid };
    }
    const restos = async (cid: string, mid: string) =>
      (await conta("conversations", "id = $1", [cid])) +
      (await conta("messages", "conversation_id = $1", [cid])) +
      (await conta("message_reports", "message_id = $1", [mid]));

    it("apagar o membro apaga conversa, mensagens e denúncias", async () => {
      const { m, cid, mid } = await cadeia();
      await pool.query("DELETE FROM family_members WHERE id = $1", [m.memberId]);
      expect(await restos(cid, mid)).toBe(0);
    });

    it("apagar a família apaga conversa, mensagens e denúncias", async () => {
      const { m, cid, mid } = await cadeia();
      await pool.query("DELETE FROM families WHERE id = $1", [m.familyId]);
      expect(await restos(cid, mid)).toBe(0);
    });

    it("apagar o profissional apaga conversa, mensagens e denúncias", async () => {
      const { p, cid, mid } = await cadeia();
      await pool.query("DELETE FROM professionals WHERE id = $1", [p]);
      expect(await restos(cid, mid)).toBe(0);
    });

    it("apagar o utilizador só anula as autorias (mensagem e conversa ficam)", async () => {
      const m = await criarMembro();
      const autor = await criarUtilizador();
      const cid = await criarConversa({ ...m, userId: autor }, await criarProfissional());
      const mid = await criarMensagem(cid, 1, "FAMILY", autor);
      await pool.query("DELETE FROM users WHERE id = $1", [autor]);
      const { rows } = await pool.query(
        "SELECT (SELECT sender_user_id FROM messages WHERE id = $2) AS s, (SELECT opened_by_user_id FROM conversations WHERE id = $1) AS o, (SELECT count(*) FROM conversations WHERE id = $1)::int AS c",
        [cid, mid],
      );
      expect(rows[0]).toEqual({ s: null, o: null, c: 1 });
    });
  });

  describe("enums e migração sobre BD existente", () => {
    it("os valores novos de alert_type/alert_source aceitam-se depois da migração", async () => {
      const { rows } = await pool.query<{ t: string; s: string }>(
        "SELECT 'MESSAGE_RECEIVED'::alert_type AS t, 'CONVERSATION'::alert_source AS s",
      );
      expect(rows[0]).toEqual({ t: "MESSAGE_RECEIVED", s: "CONVERSATION" });
    });

    it("o índice por cidade existe em professionals", async () => {
      expect(await conta("pg_indexes", "indexname = 'professionals_city_approved_idx'", [])).toBe(
        1,
      );
    });

    it("migrar 0044 sobre uma BD em 0043 com dados não altera as linhas existentes", async () => {
      const dir = await mkdtemp(join(tmpdir(), "vita-mig44-"));
      for (const f of (await readdir(defaultMigrationsDir())).filter(
        (x) => x.endsWith(".sql") && x < "0044_",
      ))
        await copyFile(join(defaultMigrationsDir(), f), join(dir, f));
      const nome = `legacy44_${randomUUID().replace(/-/g, "")}`;
      await pool.query(`CREATE DATABASE ${nome}`);
      const legacy = new Pool({ connectionString: urlDe(nome) });
      abertas.push(legacy);
      await runMigrations(legacy, dir);
      const u = randomUUID();
      const f = randomUUID();
      await legacy.query(
        "INSERT INTO users (id, email, password_hash, name, birth_date, timezone, terms_accepted_version, terms_accepted_at) VALUES ($1,$2,'x','U','1980-01-01','Europe/Lisbon','1',now())",
        [u, `u-${u}@teste.pt`],
      );
      await legacy.query("INSERT INTO families (id, name) VALUES ($1,'F')", [f]);
      const antes = JSON.stringify([
        (await legacy.query("SELECT * FROM users")).rows,
        (await legacy.query("SELECT * FROM families")).rows,
      ]);
      await runMigrations(legacy, defaultMigrationsDir());
      const depois = JSON.stringify([
        (await legacy.query("SELECT * FROM users")).rows,
        (await legacy.query("SELECT * FROM families")).rows,
      ]);
      expect(depois).toBe(antes);
      const { rows } = await legacy.query(
        "SELECT to_regclass('conversations') AS c, to_regclass('messages') AS m, to_regclass('message_reports') AS r",
      );
      expect(rows[0]).toEqual({ c: "conversations", m: "messages", r: "message_reports" });
    });
  });
});
