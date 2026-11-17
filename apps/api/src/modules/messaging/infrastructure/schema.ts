// Fusão de declaração das tabelas da migração 0044 (`conversations`, `messages`, `message_reports`; schema.md §12) no `Database`
// partilhado — só a infrastructure de `messaging` acede a estas tabelas (conventions.md §3.5).
import type { ColumnType, Generated } from "kysely";

export interface ConversationsTable {
  id: Generated<string>;
  family_id: string;
  member_id: string;
  professional_id: string;
  opened_by_user_id: string | null;
  participant_label: string;
  status: ColumnType<"OPEN" | "CLOSED", "OPEN" | "CLOSED" | undefined, "OPEN" | "CLOSED">;
  closed_by: ColumnType<"FAMILY" | "PROFESSIONAL" | "SYSTEM" | null, "FAMILY" | "PROFESSIONAL" | "SYSTEM" | null | undefined, "FAMILY" | "PROFESSIONAL" | "SYSTEM" | null>;
  closed_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  last_seq: number;
  last_professional_seq: ColumnType<number, number | undefined, number>;
  last_message_at: Date;
  family_read_seq: ColumnType<number, number | undefined, number>;
  professional_read_seq: ColumnType<number, number | undefined, number>;
  professional_notified_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

export interface MessagesTable {
  id: Generated<string>;
  conversation_id: string;
  seq: number;
  side: "FAMILY" | "PROFESSIONAL";
  sender_user_id: string | null;
  body: string;
  client_message_id: string | null;
  hidden_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  created_at: ColumnType<Date, Date | undefined, never>;
}

export interface MessageReportsTable {
  id: Generated<string>;
  message_id: string;
  reporter_side: "FAMILY" | "PROFESSIONAL";
  reason: "ABUSE" | "SPAM" | "SCAM_OR_OFF_PLATFORM_PAYMENT" | "SENSITIVE_DATA" | "OTHER";
  note: string | null;
  status: ColumnType<"OPEN" | "DECIDED", "OPEN" | "DECIDED" | undefined, "OPEN" | "DECIDED">;
  decision: ColumnType<"DISMISS" | "HIDE_MESSAGE" | "HIDE_AND_CLOSE" | null, never, "DISMISS" | "HIDE_MESSAGE" | "HIDE_AND_CLOSE" | null>;
  decided_by: ColumnType<string | null, never, string | null>;
  decided_at: ColumnType<Date | null, never, Date | null>;
  created_at: ColumnType<Date, Date | undefined, never>;
}

declare module "../../../platform/db/index.js" {
  interface Database {
    conversations: ConversationsTable;
    messages: MessagesTable;
    message_reports: MessageReportsTable;
  }
}
