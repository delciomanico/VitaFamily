// Repositórios Kysely/pg de `messaging` (migração 0044). Todas as consultas de conversa levam (família, membro) do caminho: uma conversa
// de outra família/membro nunca é encontrada (BR-MKT-48). Os carimbos gravam-se SEMPRE do relógio da aplicação (ms), para os cursores
// por (`last_message_at`, `id`) serem exatos. Nunca se regista texto de mensagens nem rótulos.
import { sql, type Kysely } from "kysely";
import type { Database } from "../../../platform/db/index.js";
import { shouldNotifyProfessional } from "../domain/conversation.js";
import type { Message } from "../domain/message.js";
import type {
  ConversationListFilter,
  ConversationRecord,
  ConversationRepository,
  ConversationWithUnread,
  ConversationWithUnreadProfessional,
  MessageReportRecord,
  MessageRepository,
  ReportRepository,
} from "../application/ports.js";
import "./schema.js";

type Db = Kysely<Database>;

interface ConversationRow {
  id: string;
  family_id: string;
  member_id: string;
  professional_id: string;
  opened_by_user_id: string | null;
  participant_label: string;
  status: "OPEN" | "CLOSED";
  closed_by: "FAMILY" | "PROFESSIONAL" | "SYSTEM" | null;
  closed_at: Date | null;
  last_seq: number;
  last_professional_seq: number;
  last_message_at: Date;
  family_read_seq: number;
  professional_read_seq: number;
  professional_notified_at: Date | null;
  created_at: Date;
}

function toConversation(row: ConversationRow): ConversationRecord {
  return {
    id: row.id,
    familyId: row.family_id,
    memberId: row.member_id,
    professionalId: row.professional_id,
    openedByUserId: row.opened_by_user_id,
    participantLabel: row.participant_label,
    status: row.status,
    closedBy: row.closed_by,
    closedAt: row.closed_at,
    lastSeq: row.last_seq,
    lastProfessionalSeq: row.last_professional_seq,
    lastMessageAt: row.last_message_at,
    familyReadSeq: row.family_read_seq,
    professionalReadSeq: row.professional_read_seq,
    professionalNotifiedAt: row.professional_notified_at,
    createdAt: row.created_at,
  };
}

const CONVERSATION_COLUMNS = [
  "id",
  "family_id",
  "member_id",
  "professional_id",
  "opened_by_user_id",
  "participant_label",
  "status",
  "closed_by",
  "closed_at",
  "last_seq",
  "last_professional_seq",
  "last_message_at",
  "family_read_seq",
  "professional_read_seq",
  "professional_notified_at",
  "created_at",
] as const;

export class KyselyConversationRepository implements ConversationRepository<Db> {
  async acquireLocks(trx: Db, keys: readonly string[]): Promise<void> {
    for (const key of [...new Set(keys)].sort()) {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`.execute(trx);
    }
  }

  async findByPair(trx: Db, familyId: string, memberId: string, professionalId: string): Promise<ConversationRecord | null> {
    const row = await trx
      .selectFrom("conversations")
      .select(CONVERSATION_COLUMNS)
      .where("family_id", "=", familyId)
      .where("member_id", "=", memberId)
      .where("professional_id", "=", professionalId)
      .forUpdate()
      .executeTakeFirst();
    return row ? toConversation(row) : null;
  }

  async findForFamily(trx: Db, familyId: string, memberId: string, conversationId: string, forUpdate: boolean): Promise<ConversationRecord | null> {
    let query = trx.selectFrom("conversations").select(CONVERSATION_COLUMNS).where("id", "=", conversationId).where("family_id", "=", familyId).where("member_id", "=", memberId);
    if (forUpdate) query = query.forUpdate();
    const row = await query.executeTakeFirst();
    return row ? toConversation(row) : null;
  }

  async insert(trx: Db, record: ConversationRecord): Promise<void> {
    await trx
      .insertInto("conversations")
      .values({
        id: record.id,
        family_id: record.familyId,
        member_id: record.memberId,
        professional_id: record.professionalId,
        opened_by_user_id: record.openedByUserId,
        participant_label: record.participantLabel,
        status: record.status,
        closed_by: record.closedBy,
        closed_at: record.closedAt,
        last_seq: record.lastSeq,
        last_professional_seq: record.lastProfessionalSeq,
        last_message_at: record.lastMessageAt,
        family_read_seq: record.familyReadSeq,
        professional_read_seq: record.professionalReadSeq,
        professional_notified_at: record.professionalNotifiedAt,
        created_at: record.createdAt,
        updated_at: record.createdAt,
      })
      .execute();
  }

  async unreadForFamily(trx: Db, conversationId: string, familyReadSeq: number): Promise<number> {
    const row = await trx
      .selectFrom("messages")
      .select(sql<string>`count(*)`.as("n"))
      .where("conversation_id", "=", conversationId)
      .where("side", "=", "PROFESSIONAL")
      .where("seq", ">", familyReadSeq)
      .executeTakeFirst();
    return Number(row?.n ?? 0);
  }

  async listForFamily(trx: Db, familyId: string, memberId: string, filter: ConversationListFilter): Promise<ConversationWithUnread[]> {
    let query = trx
      .selectFrom("conversations as c")
      .select([
        "c.id",
        "c.family_id",
        "c.member_id",
        "c.professional_id",
        "c.opened_by_user_id",
        "c.participant_label",
        "c.status",
        "c.closed_by",
        "c.closed_at",
        "c.last_seq",
        "c.last_professional_seq",
        "c.last_message_at",
        "c.family_read_seq",
        "c.professional_read_seq",
        "c.professional_notified_at",
        "c.created_at",
        sql<string>`(SELECT count(*) FROM messages m WHERE m.conversation_id = c.id AND m.side = 'PROFESSIONAL' AND m.seq > c.family_read_seq)`.as("unread"),
      ])
      .where("c.family_id", "=", familyId)
      .where("c.member_id", "=", memberId);
    if (filter.status) query = query.where("c.status", "=", filter.status);
    if (filter.after) {
      const { lastMessageAt, id } = filter.after;
      query = query.where(sql<boolean>`(c.last_message_at, c.id) < (${lastMessageAt}, ${id}::uuid)`);
    }
    const rows = await query.orderBy("c.last_message_at", "desc").orderBy("c.id", "desc").limit(filter.limit).execute();
    return rows.map((r) => ({ ...toConversation(r), unreadForFamily: Number(r.unread) }));
  }

  async countOpenForSubject(trx: Db, familyId: string, memberId: string): Promise<number> {
    const row = await trx
      .selectFrom("conversations")
      .select(sql<string>`count(*)`.as("n"))
      .where("family_id", "=", familyId)
      .where("member_id", "=", memberId)
      .where("status", "=", "OPEN")
      .executeTakeFirst();
    return Number(row?.n ?? 0);
  }

  async newConversationTimes(trx: Db, userId: string, since: Date): Promise<Date[]> {
    const rows = await trx.selectFrom("conversations").select("created_at").where("opened_by_user_id", "=", userId).where("created_at", ">", since).execute();
    return rows.map((r) => r.created_at);
  }

  async applyMessage(trx: Db, conversationId: string, change: { lastSeq: number; at: Date; side: "FAMILY" | "PROFESSIONAL" }): Promise<void> {
    await trx
      .updateTable("conversations")
      .set({ last_seq: change.lastSeq, last_message_at: change.at, updated_at: change.at, ...(change.side === "PROFESSIONAL" ? { last_professional_seq: change.lastSeq } : {}) })
      .where("id", "=", conversationId)
      .execute();
  }

  async setProfessionalReadSeq(trx: Db, conversationId: string, seq: number, at: Date): Promise<void> {
    await trx.updateTable("conversations").set({ professional_read_seq: seq, updated_at: at }).where("id", "=", conversationId).execute();
  }

  async findForProfessional(trx: Db, professionalId: string, conversationId: string, forUpdate: boolean): Promise<ConversationRecord | null> {
    let query = trx.selectFrom("conversations").select(CONVERSATION_COLUMNS).where("id", "=", conversationId).where("professional_id", "=", professionalId);
    if (forUpdate) query = query.forUpdate();
    const row = await query.executeTakeFirst();
    return row ? toConversation(row) : null;
  }

  async unreadForProfessional(trx: Db, conversationId: string, professionalReadSeq: number): Promise<number> {
    const row = await trx
      .selectFrom("messages")
      .select(sql<string>`count(*)`.as("n"))
      .where("conversation_id", "=", conversationId)
      .where("side", "=", "FAMILY")
      .where("seq", ">", professionalReadSeq)
      .executeTakeFirst();
    return Number(row?.n ?? 0);
  }

  async listForProfessional(trx: Db, professionalId: string, filter: ConversationListFilter): Promise<ConversationWithUnreadProfessional[]> {
    let query = trx
      .selectFrom("conversations as c")
      .select([
        "c.id",
        "c.family_id",
        "c.member_id",
        "c.professional_id",
        "c.opened_by_user_id",
        "c.participant_label",
        "c.status",
        "c.closed_by",
        "c.closed_at",
        "c.last_seq",
        "c.last_professional_seq",
        "c.last_message_at",
        "c.family_read_seq",
        "c.professional_read_seq",
        "c.professional_notified_at",
        "c.created_at",
        sql<string>`(SELECT count(*) FROM messages m WHERE m.conversation_id = c.id AND m.side = 'FAMILY' AND m.seq > c.professional_read_seq)`.as("unread"),
      ])
      .where("c.professional_id", "=", professionalId);
    if (filter.status) query = query.where("c.status", "=", filter.status);
    if (filter.after) {
      const { lastMessageAt, id } = filter.after;
      query = query.where(sql<boolean>`(c.last_message_at, c.id) < (${lastMessageAt}, ${id}::uuid)`);
    }
    const rows = await query.orderBy("c.last_message_at", "desc").orderBy("c.id", "desc").limit(filter.limit).execute();
    return rows.map((r) => ({ ...toConversation(r), unreadForProfessional: Number(r.unread) }));
  }

  async setFamilyReadSeq(trx: Db, conversationId: string, seq: number, at: Date): Promise<void> {
    await trx.updateTable("conversations").set({ family_read_seq: seq, updated_at: at }).where("id", "=", conversationId).execute();
  }

  async claimProfessionalNotice(trx: Db, conversationId: string, now: Date): Promise<{ professionalId: string; previous: Date | null } | null> {
    const row = await trx.selectFrom("conversations").select(["professional_id", "professional_notified_at", "last_seq", "last_professional_seq", "professional_read_seq"]).where("id", "=", conversationId).forUpdate().executeTakeFirst();
    if (!row) return null;
    // A última mensagem tem de ser da família e por ler pelo profissional.
    if (row.last_seq <= row.last_professional_seq || row.last_seq <= row.professional_read_seq) return null;
    if (!shouldNotifyProfessional(row.professional_notified_at?.getTime() ?? null, now.getTime())) return null;
    await trx.updateTable("conversations").set({ professional_notified_at: now }).where("id", "=", conversationId).execute();
    return { professionalId: row.professional_id, previous: row.professional_notified_at };
  }

  async releaseProfessionalNotice(trx: Db, conversationId: string, claimedAt: Date, previous: Date | null): Promise<void> {
    await trx.updateTable("conversations").set({ professional_notified_at: previous }).where("id", "=", conversationId).where("professional_notified_at", "=", claimedAt).execute();
  }

  async setStatus(trx: Db, conversationId: string, change: { status: "OPEN" | "CLOSED"; closedBy: "FAMILY" | "PROFESSIONAL" | "SYSTEM" | null; at: Date }): Promise<void> {
    await trx
      .updateTable("conversations")
      .set({ status: change.status, closed_by: change.closedBy, closed_at: change.status === "CLOSED" ? change.at : null, updated_at: change.at })
      .where("id", "=", conversationId)
      .execute();
  }

  async purgeLastMessageBefore(trx: Db, before: Date): Promise<number> {
    const rows = await trx.deleteFrom("conversations").where("last_message_at", "<", before).returning("id").execute();
    return rows.length;
  }
}

interface MessageRow {
  id: string;
  conversation_id: string;
  seq: number;
  side: "FAMILY" | "PROFESSIONAL";
  sender_user_id: string | null;
  body: string;
  client_message_id: string | null;
  hidden_at: Date | null;
  created_at: Date;
}

const MESSAGE_COLUMNS = ["id", "conversation_id", "seq", "side", "sender_user_id", "body", "client_message_id", "hidden_at", "created_at"] as const;

function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    seq: row.seq,
    side: row.side,
    senderUserId: row.sender_user_id,
    body: row.body,
    clientMessageId: row.client_message_id,
    hiddenAt: row.hidden_at,
    createdAt: row.created_at,
  };
}

export class KyselyMessageRepository implements MessageRepository<Db> {
  async insert(trx: Db, message: Message): Promise<void> {
    await trx
      .insertInto("messages")
      .values({
        id: message.id,
        conversation_id: message.conversationId,
        seq: message.seq,
        side: message.side,
        sender_user_id: message.senderUserId,
        body: message.body,
        client_message_id: message.clientMessageId,
        hidden_at: message.hiddenAt,
        created_at: message.createdAt,
      })
      .execute();
  }

  async findByClientMessageId(trx: Db, conversationId: string, clientMessageId: string): Promise<Message | null> {
    const row = await trx.selectFrom("messages").select(MESSAGE_COLUMNS).where("conversation_id", "=", conversationId).where("client_message_id", "=", clientMessageId).executeTakeFirst();
    return row ? toMessage(row) : null;
  }

  async findById(trx: Db, conversationId: string, messageId: string): Promise<Message | null> {
    const row = await trx.selectFrom("messages").select(MESSAGE_COLUMNS).where("conversation_id", "=", conversationId).where("id", "=", messageId).executeTakeFirst();
    return row ? toMessage(row) : null;
  }

  async listPage(trx: Db, conversationId: string, limit: number, beforeSeq?: number): Promise<Message[]> {
    let query = trx.selectFrom("messages").select(MESSAGE_COLUMNS).where("conversation_id", "=", conversationId);
    if (beforeSeq !== undefined) query = query.where("seq", "<", beforeSeq);
    return (await query.orderBy("seq", "desc").limit(limit).execute()).map(toMessage);
  }

  async familyTimesInConversation(trx: Db, conversationId: string, since: Date): Promise<Date[]> {
    const rows = await trx.selectFrom("messages").select("created_at").where("conversation_id", "=", conversationId).where("side", "=", "FAMILY").where("created_at", ">", since).execute();
    return rows.map((r) => r.created_at);
  }

  async professionalTimesInConversation(trx: Db, conversationId: string, since: Date): Promise<Date[]> {
    const rows = await trx.selectFrom("messages").select("created_at").where("conversation_id", "=", conversationId).where("side", "=", "PROFESSIONAL").where("created_at", ">", since).execute();
    return rows.map((r) => r.created_at);
  }

  async professionalTimes(trx: Db, professionalId: string, since: Date): Promise<Date[]> {
    const rows = await trx
      .selectFrom("messages as m")
      .innerJoin("conversations as c", "c.id", "m.conversation_id")
      .select("m.created_at")
      .where("c.professional_id", "=", professionalId)
      .where("m.side", "=", "PROFESSIONAL")
      .where("m.created_at", ">", since)
      .execute();
    return rows.map((r) => r.created_at);
  }

  async senderTimes(trx: Db, userId: string, since: Date): Promise<Date[]> {
    const rows = await trx.selectFrom("messages").select("created_at").where("sender_user_id", "=", userId).where("created_at", ">", since).execute();
    return rows.map((r) => r.created_at);
  }
}

export class KyselyReportRepository implements ReportRepository<Db> {
  async findBySide(trx: Db, messageId: string, side: "FAMILY" | "PROFESSIONAL"): Promise<MessageReportRecord | null> {
    const row = await trx.selectFrom("message_reports").select(["id", "message_id", "reporter_side", "reason", "note", "status", "created_at"]).where("message_id", "=", messageId).where("reporter_side", "=", side).executeTakeFirst();
    return row ? { id: row.id, messageId: row.message_id, reporterSide: row.reporter_side, reason: row.reason, note: row.note, status: row.status, createdAt: row.created_at } : null;
  }

  async insert(trx: Db, report: MessageReportRecord): Promise<void> {
    await trx.insertInto("message_reports").values({ id: report.id, message_id: report.messageId, reporter_side: report.reporterSide, reason: report.reason, note: report.note, status: "OPEN", created_at: report.createdAt }).execute();
  }

  async professionalReportTimes(trx: Db, professionalId: string, since: Date): Promise<Date[]> {
    const rows = await trx
      .selectFrom("message_reports as r")
      .innerJoin("messages as m", "m.id", "r.message_id")
      .innerJoin("conversations as c", "c.id", "m.conversation_id")
      .select("r.created_at")
      .where("c.professional_id", "=", professionalId)
      .where("r.reporter_side", "=", "PROFESSIONAL")
      .where("r.created_at", ">", since)
      .execute();
    return rows.map((r) => r.created_at);
  }

  async familyReportTimesForSubject(trx: Db, familyId: string, memberId: string, since: Date): Promise<Date[]> {
    const rows = await trx
      .selectFrom("message_reports as r")
      .innerJoin("messages as m", "m.id", "r.message_id")
      .innerJoin("conversations as c", "c.id", "m.conversation_id")
      .select("r.created_at")
      .where("c.family_id", "=", familyId)
      .where("c.member_id", "=", memberId)
      .where("r.reporter_side", "=", "FAMILY")
      .where("r.created_at", ">", since)
      .execute();
    return rows.map((r) => r.created_at);
  }
}
