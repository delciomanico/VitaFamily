// Repositório Kysely/pg da moderação do admin (migração 0044). Só lê `conversations` para obter o `professional_id` e para fechar por
// sistema; NUNCA seleciona `family_id`, `member_id` nem `participant_label` (BR-MKT-44/48).
import { sql, type Kysely } from "kysely";
import type { Database } from "../../../platform/db/index.js";
import type { ModerationRepository, ReportQueueFilter, ReportQueueRow, ReportWithMessage } from "../application/moderation-ports.js";
import "./schema.js";

type Db = Kysely<Database>;

export class KyselyModerationRepository implements ModerationRepository<Db> {
  async listQueue(trx: Db, filter: ReportQueueFilter): Promise<ReportQueueRow[]> {
    let query = trx
      .selectFrom("message_reports as r")
      .innerJoin("messages as m", "m.id", "r.message_id")
      .innerJoin("conversations as c", "c.id", "m.conversation_id")
      .select(["r.id", "r.status", "r.reason", "m.side as reported_side", "c.professional_id", "r.created_at"])
      .where("r.status", "=", filter.status);
    if (filter.after) {
      const { createdAt, id } = filter.after;
      query = query.where(sql<boolean>`(r.created_at, r.id) > (${createdAt}, ${id}::uuid)`);
    }
    const rows = await query.orderBy("r.created_at", "asc").orderBy("r.id", "asc").limit(filter.limit).execute();
    return rows.map((r) => ({ id: r.id, status: r.status, reason: r.reason, reportedSide: r.reported_side, professionalId: r.professional_id, createdAt: r.created_at }));
  }

  async findReport(trx: Db, reportId: string, forUpdate: boolean): Promise<ReportWithMessage | null> {
    // O bloqueio só incide sobre a denúncia (`FOR UPDATE OF r`): as mensagens/conversas não se bloqueiam para ler.
    if (forUpdate) await trx.selectFrom("message_reports").select("id").where("id", "=", reportId).forUpdate().executeTakeFirst();
    const query = trx
      .selectFrom("message_reports as r")
      .innerJoin("messages as m", "m.id", "r.message_id")
      .innerJoin("conversations as c", "c.id", "m.conversation_id")
      .select([
        "r.id as report_id",
        "r.message_id",
        "r.reporter_side",
        "r.reason",
        "r.note",
        "r.status",
        "r.decision",
        "r.decided_at",
        "r.created_at as report_created_at",
        "m.id as m_id",
        "m.conversation_id",
        "m.seq",
        "m.side",
        "m.sender_user_id",
        "m.body",
        "m.client_message_id",
        "m.hidden_at",
        "m.created_at as m_created_at",
        "c.professional_id",
      ])
      .where("r.id", "=", reportId);
    const row = await query.executeTakeFirst();
    if (!row) return null;
    return {
      report: { id: row.report_id, messageId: row.message_id, reporterSide: row.reporter_side, reason: row.reason, note: row.note, status: row.status, createdAt: row.report_created_at, decision: row.decision, decidedAt: row.decided_at },
      message: { id: row.m_id, conversationId: row.conversation_id, seq: row.seq, side: row.side, senderUserId: row.sender_user_id, body: row.body, clientMessageId: row.client_message_id, hiddenAt: row.hidden_at, createdAt: row.m_created_at },
      professionalId: row.professional_id,
    };
  }

  async hideMessage(trx: Db, messageId: string, at: Date): Promise<void> {
    await trx.updateTable("messages").set({ hidden_at: at }).where("id", "=", messageId).where("hidden_at", "is", null).execute();
  }

  async closeConversationBySystem(trx: Db, conversationId: string, at: Date): Promise<void> {
    await trx.selectFrom("conversations").select("id").where("id", "=", conversationId).forUpdate().executeTakeFirst();
    await trx.updateTable("conversations").set({ status: "CLOSED", closed_by: "SYSTEM", closed_at: at, updated_at: at }).where("id", "=", conversationId).execute();
  }

  async markDecided(trx: Db, reportId: string, change: { decision: "DISMISS" | "HIDE_MESSAGE" | "HIDE_AND_CLOSE"; decidedBy: string; at: Date }): Promise<void> {
    await trx.updateTable("message_reports").set({ status: "DECIDED", decision: change.decision, decided_by: change.decidedBy, decided_at: change.at }).where("id", "=", reportId).execute();
  }
}
