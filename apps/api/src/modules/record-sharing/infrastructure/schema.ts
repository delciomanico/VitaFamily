// Fusão de declaração das tabelas da migração 0046 (schema.md §14) no `Database` partilhado — só a infrastructure de `record-sharing`
// acede a `record_shares` e `record_share_views` (conventions.md §3.5). `categories` (`data_category[]`) lê-se como `text[]` por cast
// explícito no repositório (o `pg` não conhece o tipo do array de enum) e escreve-se por expressão SQL.
import type { ColumnType, Generated } from "kysely";

type Nullable<T> = ColumnType<T | null, T | null | undefined, T | null>;
type ShareStatus = "ACTIVE" | "REVOKED" | "CONSUMED";

export interface RecordSharesTable {
  id: Generated<string>;
  family_id: string;
  member_id: string;
  professional_id: string;
  booking_id: string;
  participant_label: string;
  professional_category: "HEALTH" | "WELLNESS";
  categories: ColumnType<string, unknown, never>;
  validity: "H24" | "D7" | "D30" | "UNTIL_CONSULTATION_END_PLUS_24H";
  view_once: boolean;
  expires_at: Date;
  status: ColumnType<ShareStatus, ShareStatus | undefined, ShareStatus>;
  revoked_at: Nullable<Date>;
  revoked_by_user_id: Nullable<string>;
  consumed_at: Nullable<Date>;
  view_count: ColumnType<number, number | undefined, number>;
  last_viewed_at: Nullable<Date>;
  created_by_user_id: Nullable<string>;
  client_request_id: Nullable<string>;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

export interface RecordShareViewsTable {
  id: Generated<string>;
  share_id: string;
  view_no: number;
  viewed_at: Date;
  categories: ColumnType<string, unknown, never>;
  created_at: ColumnType<Date, Date | undefined, never>;
}

declare module "../../../platform/db/index.js" {
  interface Database {
    record_shares: RecordSharesTable;
    record_share_views: RecordShareViewsTable;
  }
}
