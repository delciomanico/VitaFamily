// Integração (PostgreSQL real com todas as migrações) do ciclo de vida das conversas de `messaging` (MK2 S10):
// TC-MKT-66 (retenção de 24 meses: `messaging.purge-expired` com fronteira exata, relógio injetado, cascata para mensagens e denúncias,
// idempotência e auditoria `MESSAGES_PURGED` só com a contagem) e TC-MKT-67 (cascatas de membro/família/profissional e `SET NULL`
// da autoria ao apagar o `User`, confirmadas pelas FKs de `db/migrations/0044_messaging.sql`).
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPurgeExpired } from "../../src/modules/messaging/application/purge-expired.js";
import { KyselyConversationRepository } from "../../src/modules/messaging/infrastructure/repo.js";
import { withTransaction } from "../../src/platform/db/index.js";
import { START, startProfessionalsHarness, type ProfessionalsHarness } from "../support/professionals-harness.js";

const TEXT_CANARY = "canario-texto-purge-xyz";
const LABEL = "rotulo-purge";
/** `START` (2026-11-16T10:00Z) menos 24 meses de calendário: fronteira da retenção. */
const CUTOFF = new Date("2024-11-16T10:00:00.000Z");

describe("integração: ciclo de vida das conversas (MK2 S10)", () => {
  let h: ProfessionalsHarness;

  beforeAll(async () => {
    h = await startProfessionalsHarness();
  }, 240_000);

  afterAll(async () => {
    await h.stop();
  });

  async function newFamily(): Promise<string> {
    const id = randomUUID();
    await h.pool.query("INSERT INTO families (id, name) VALUES ($1,'F')", [id]);
    return id;
  }

  async function newMember(familyId: string): Promise<string> {
    const id = randomUUID();
    await h.pool.query("INSERT INTO family_members (id, family_id, user_id, name, birth_date, role, is_dependent, status) VALUES ($1,$2,NULL,'D','2018-01-01',NULL,true,'ACTIVE')", [id, familyId]);
    return id;
  }

  async function newUser(): Promise<string> {
    const id = randomUUID();
    await h.pool.query("INSERT INTO users (id, email, password_hash, name, birth_date, timezone, status, terms_accepted_version, terms_accepted_at) VALUES ($1,$2,'x','Autor','1980-01-01','Africa/Luanda','ACTIVE','1',now())", [id, `${id}@exemplo.ao`]);
    return id;
  }

  /** Conversa com `messages` mensagens alternadas (a 1.ª com `TEXT_CANARY`), todas datadas de `lastMessageAt`. */
  async function conversationAt(opts: { familyId: string; professionalId: string; lastMessageAt: Date; messages?: number; memberId?: string; openedBy?: string | null; senderUserId?: string }): Promise<string> {
    const id = randomUUID();
    const n = opts.messages ?? 2;
    const member = opts.memberId ?? (await newMember(opts.familyId));
    await h.pool.query(
      "INSERT INTO conversations (id, family_id, member_id, professional_id, opened_by_user_id, participant_label, status, last_seq, last_professional_seq, last_message_at) VALUES ($1,$2,$3,$4,$5,$6,'OPEN',$7,0,$8)",
      [id, opts.familyId, member, opts.professionalId, opts.openedBy ?? null, LABEL, n, opts.lastMessageAt],
    );
    for (let seq = 1; seq <= n; seq++) {
      // A autoria só se grava no INSERT: o trigger `messages_immutable` não deixa atribuí-la depois (NULL → valor).
      const sender = seq === 1 && opts.senderUserId ? opts.senderUserId : null;
      await h.pool.query("INSERT INTO messages (id, conversation_id, seq, side, sender_user_id, body, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)", [
        randomUUID(),
        id,
        seq,
        seq % 2 === 1 ? "FAMILY" : "PROFESSIONAL",
        sender,
        seq === 1 ? TEXT_CANARY : `msg ${String(seq)}`,
        opts.lastMessageAt,
      ]);
    }
    return id;
  }

  async function messageId(conversationId: string, seq = 1): Promise<string> {
    const { rows } = await h.pool.query<{ id: string }>("SELECT id FROM messages WHERE conversation_id = $1 AND seq = $2", [conversationId, seq]);
    return rows[0]?.id ?? "";
  }

  async function report(messageIdValue: string, reporterSide: "FAMILY" | "PROFESSIONAL" = "FAMILY"): Promise<void> {
    await h.pool.query("INSERT INTO message_reports (id, message_id, reporter_side, reason) VALUES ($1,$2,$3,'SPAM')", [randomUUID(), messageIdValue, reporterSide]);
  }

  async function count(sql: string, params: unknown[] = []): Promise<number> {
    const { rows } = await h.pool.query<{ n: number }>(sql, params);
    return rows[0]?.n ?? -1;
  }

  const conversationExists = (id: string) => count("SELECT count(*)::int AS n FROM conversations WHERE id = $1", [id]).then((n) => n === 1);
  const messagesOf = (id: string) => count("SELECT count(*)::int AS n FROM messages WHERE conversation_id = $1", [id]);
  const reportsOf = (messageIdValue: string) => count("SELECT count(*)::int AS n FROM message_reports WHERE message_id = $1", [messageIdValue]);

  describe("TC-MKT-66: retenção de 24 meses (messaging.purge-expired)", () => {
    it("fronteira exata mantém-se, 1 ms antes apaga-se, recente intacta; cascata para mensagens e denúncias; idempotente; auditoria só com a contagem", async () => {
      const family = await newFamily();
      const pro = await h.newProfessional();
      const exact = await conversationAt({ familyId: family, professionalId: pro.professionalId, lastMessageAt: CUTOFF, messages: 2 });
      const justBefore = await conversationAt({ familyId: family, professionalId: pro.professionalId, lastMessageAt: new Date(CUTOFF.getTime() - 1), messages: 3 });
      const recent = await conversationAt({ familyId: family, professionalId: pro.professionalId, lastMessageAt: START, messages: 2 });

      const expiredMessage = await messageId(justBefore, 1);
      await report(expiredMessage, "FAMILY");
      await report(expiredMessage, "PROFESSIONAL");
      const keptMessage = await messageId(exact, 1);
      await report(keptMessage, "FAMILY");
      const recentMessage = await messageId(recent, 1);
      await report(recentMessage, "PROFESSIONAL");

      const purgeExpired = createPurgeExpired({
        conversations: new KyselyConversationRepository(),
        audit: h.audit,
        withTransaction: (fn) => withTransaction(h.db, fn),
        clock: h.clock,
      });

      expect(await purgeExpired()).toEqual({ count: 1 });

      expect(await conversationExists(justBefore)).toBe(false);
      expect(await messagesOf(justBefore)).toBe(0);
      expect(await reportsOf(expiredMessage)).toBe(0);

      expect(await conversationExists(exact)).toBe(true);
      expect(await messagesOf(exact)).toBe(2);
      expect(await reportsOf(keptMessage)).toBe(1);

      expect(await conversationExists(recent)).toBe(true);
      expect(await messagesOf(recent)).toBe(2);
      expect(await reportsOf(recentMessage)).toBe(1);

      // Idempotente: a segunda execução não apaga nada.
      expect(await purgeExpired()).toEqual({ count: 0 });
      expect(await conversationExists(exact)).toBe(true);
      expect(await conversationExists(recent)).toBe(true);

      // Auditoria: uma linha por execução, SYSTEM, só com a contagem (BR-MKT-46).
      const { rows } = await h.pool.query<{
        action: string;
        actor_type: string;
        resource_type: string;
        resource_id: string | null;
        family_id: string | null;
        subject_member_id: string | null;
        actor_user_id: string | null;
        actor_professional_account_id: string | null;
        result: string;
        ip: string | null;
        user_agent: string | null;
        metadata: Record<string, unknown> | null;
        blob: string;
      }>(
        "SELECT action, actor_type, resource_type, resource_id, family_id, subject_member_id, actor_user_id, actor_professional_account_id, result, ip::text, user_agent, metadata, row_to_json(audit_logs)::text AS blob FROM audit_logs WHERE action = 'MESSAGES_PURGED' ORDER BY id",
      );
      expect(rows).toHaveLength(2);
      const [first, second] = rows;
      for (const row of [first, second]) {
        expect(row?.actor_type).toBe("SYSTEM");
        expect(row?.resource_type).toBe("Conversation");
        expect(row?.resource_id).toBeNull();
        expect(row?.family_id).toBeNull();
        expect(row?.subject_member_id).toBeNull();
        expect(row?.actor_user_id).toBeNull();
        expect(row?.actor_professional_account_id).toBeNull();
        expect(row?.result).toBe("SUCCESS");
        expect(row?.ip).toBeNull();
        expect(row?.user_agent).toBeNull();
        expect(row?.metadata).toEqual(expect.objectContaining({ count: expect.any(Number) as unknown }));
        expect(Object.keys(row?.metadata ?? {})).toEqual(["count"]);
        for (const forbidden of [TEXT_CANARY, justBefore, exact, recent, family, expiredMessage, pro.professionalId]) {
          expect(row?.blob.includes(forbidden)).toBe(false);
        }
      }
      expect(first?.metadata).toEqual({ count: 1 });
      expect(second?.metadata).toEqual({ count: 0 });
    });
  });

  describe("TC-MKT-67: cascatas do ciclo de vida", () => {
    it("apagar membro, família e profissional apaga as suas conversas, mensagens e denúncias, e só essas", async () => {
      const pro = await h.newProfessional();
      const otherPro = await h.newProfessional();

      // Família A (dois membros) e família B; cada uma com uma conversa com o profissional `pro` (recentes).
      const familyA = await newFamily();
      const memberA1 = await newMember(familyA);
      const memberA2 = await newMember(familyA);
      const familyB = await newFamily();
      const memberB = await newMember(familyB);
      const convA1 = await conversationAt({ familyId: familyA, professionalId: pro.professionalId, lastMessageAt: START, memberId: memberA1 });
      const convA2 = await conversationAt({ familyId: familyA, professionalId: pro.professionalId, lastMessageAt: START, memberId: memberA2 });
      const convB = await conversationAt({ familyId: familyB, professionalId: pro.professionalId, lastMessageAt: START, memberId: memberB });
      const familyC = await newFamily();
      const convOtherPro = await conversationAt({ familyId: familyC, professionalId: otherPro.professionalId, lastMessageAt: START });
      for (const c of [convA1, convA2, convB, convOtherPro]) await report(await messageId(c, 1));

      // 1) Apagar o membro A1 ⇒ só a conversa dele (com mensagens e denúncia).
      await h.pool.query("DELETE FROM family_members WHERE id = $1", [memberA1]);
      expect(await conversationExists(convA1)).toBe(false);
      expect(await messagesOf(convA1)).toBe(0);
      expect(await count("SELECT count(*)::int AS n FROM message_reports r JOIN messages m ON m.id = r.message_id WHERE m.conversation_id = $1", [convA1])).toBe(0);
      expect(await conversationExists(convA2)).toBe(true);
      expect(await messagesOf(convA2)).toBe(2);

      // 2) Apagar a família B ⇒ as suas conversas (membro B), mas não as de A.
      await h.pool.query("DELETE FROM families WHERE id = $1", [familyB]);
      expect(await conversationExists(convB)).toBe(false);
      expect(await messagesOf(convB)).toBe(0);
      expect(await count("SELECT count(*)::int AS n FROM message_reports r JOIN messages m ON m.id = r.message_id WHERE m.conversation_id = $1", [convB])).toBe(0);
      expect(await conversationExists(convA2)).toBe(true);

      // 3) Apagar o profissional `pro` ⇒ as conversas dele desaparecem; as do outro profissional ficam.
      await h.pool.query("DELETE FROM professionals WHERE id = $1", [pro.professionalId]);
      expect(await conversationExists(convA2)).toBe(false);
      expect(await messagesOf(convA2)).toBe(0);
      expect(await conversationExists(convOtherPro)).toBe(true);
      expect(await messagesOf(convOtherPro)).toBe(2);
      expect(await count("SELECT count(*)::int AS n FROM message_reports r JOIN messages m ON m.id = r.message_id WHERE m.conversation_id = $1", [convOtherPro])).toBe(1);
    });

    it("apagar o User só anula sender_user_id, opened_by_user_id e decided_by; as mensagens e a conversa mantêm-se", async () => {
      const pro = await h.newProfessional();
      const family = await newFamily();
      const author = await newUser();
      // Mensagem da família com autoria do User (só servidor; `side = FAMILY`).
      const conv = await conversationAt({ familyId: family, professionalId: pro.professionalId, lastMessageAt: START, messages: 2, openedBy: author, senderUserId: author });
      const m1 = await messageId(conv, 1);
      // Denúncia decidida pelo User (admin): `decided_by` com estado DECIDED.
      await h.pool.query("INSERT INTO message_reports (id, message_id, reporter_side, reason, status, decision, decided_by, decided_at) VALUES ($1,$2,'PROFESSIONAL','ABUSE','DECIDED','DISMISS',$3,$4)", [randomUUID(), m1, author, START]);

      await h.pool.query("DELETE FROM users WHERE id = $1", [author]);

      const { rows: convRows } = await h.pool.query<{ opened_by_user_id: string | null }>("SELECT opened_by_user_id FROM conversations WHERE id = $1", [conv]);
      expect(convRows).toHaveLength(1);
      expect(convRows[0]?.opened_by_user_id).toBeNull();
      expect(await messagesOf(conv)).toBe(2);
      const { rows: msgRows } = await h.pool.query<{ sender_user_id: string | null; body: string }>("SELECT sender_user_id, body FROM messages WHERE conversation_id = $1 AND seq = 1", [conv]);
      expect(msgRows[0]?.sender_user_id).toBeNull();
      expect(msgRows[0]?.body).toBe(TEXT_CANARY);
      const { rows: reportRows } = await h.pool.query<{ decided_by: string | null; status: string }>("SELECT decided_by, status FROM message_reports WHERE message_id = $1", [m1]);
      expect(reportRows).toHaveLength(1);
      expect(reportRows[0]?.decided_by).toBeNull();
      expect(reportRows[0]?.status).toBe("DECIDED");
    });
  });
});
