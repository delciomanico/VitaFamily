// Implementação Kysely/pg das portas de `alerts` (application/ports.ts). `listByRecipient`
// precisa de um cursor de 3 chaves (não lido primeiro, depois `trigger_at` desc, `id` asc —
// indexes.md `(recipient_user_id, read_at, trigger_at DESC)`), por isso não reaproveita o
// `KeysetCursor` de `platform/page` (forma fixa `{createdAt,id}`, pensado para listas ordenadas só
// por `created_at` — ver `medications`/`appointments`/`examinations`); codec próprio, mesma
// técnica (JSON + base64url).
import { sql, type Kysely } from "kysely";
import type { Database } from "../../../platform/db/index.js";
import { ValidationError } from "../../../platform/errors/index.js";
import type { Alert, AlertSourceType, AlertType, RuleKey } from "../domain/alert.js";
import type { AlertListFilter, AlertsRepository, CursorPage, NewAlertRecord } from "../application/ports.js";
import "./schema.js";

interface AlertRow {
  id: string;
  recipient_user_id: string;
  family_id: string;
  member_id: string;
  type: AlertType;
  source_type: AlertSourceType;
  source_id: string;
  rule_key: string;
  dedupe_key: string;
  trigger_at: Date;
  read_at: Date | null;
  created_at: Date;
}

function toAlert(row: AlertRow): Alert {
  const alert: Alert = {
    id: row.id,
    recipientUserId: row.recipient_user_id,
    familyId: row.family_id,
    memberId: row.member_id,
    type: row.type,
    sourceType: row.source_type,
    sourceId: row.source_id,
    ruleKey: row.rule_key as RuleKey,
    dedupeKey: row.dedupe_key,
    triggerAt: row.trigger_at,
    createdAt: row.created_at,
  };
  if (row.read_at !== null) alert.readAt = row.read_at;
  return alert;
}

const ALERT_COLUMNS = ["id", "recipient_user_id", "family_id", "member_id", "type", "source_type", "source_id", "rule_key", "dedupe_key", "trigger_at", "read_at", "created_at"] as const;

/** 0 = não lido (`read_at IS NULL`, vem primeiro), 1 = lido — UC-ALR-03 "não lidos primeiro". */
const READ_RANK = sql<number>`(case when alerts.read_at is null then 0 else 1 end)`;

interface AlertCursor {
  rank: number;
  triggerAt: string;
  id: string;
}

function encodeAlertCursor(cursor: AlertCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeAlertCursor(cursor: string): AlertCursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as Record<string, unknown>).rank === "number" &&
      typeof (parsed as Record<string, unknown>).triggerAt === "string" &&
      typeof (parsed as Record<string, unknown>).id === "string"
    ) {
      return parsed as AlertCursor;
    }
    throw new Error("forma inválida");
  } catch (cause) {
    throw new ValidationError([{ field: "cursor", message: "inválido" }], { detail: "Cursor de paginação inválido.", cause });
  }
}

export class KyselyAlertsRepository implements AlertsRepository<Kysely<Database>> {
  async insertIfNew(trx: Kysely<Database>, record: NewAlertRecord): Promise<Alert | null> {
    const row = await trx
      .insertInto("alerts")
      .values({
        id: record.id,
        recipient_user_id: record.recipientUserId,
        family_id: record.familyId,
        member_id: record.memberId,
        type: record.type,
        source_type: record.sourceType,
        source_id: record.sourceId,
        rule_key: record.ruleKey,
        dedupe_key: record.dedupeKey,
        trigger_at: record.triggerAt,
        created_at: record.createdAt,
      })
      // schema.md §4: UNIQUE (dedupe_key) — idempotente (ADR-009).
      .onConflict((oc) => oc.column("dedupe_key").doNothing())
      .returning(ALERT_COLUMNS)
      .executeTakeFirst();
    return row ? toAlert(row) : null;
  }

  async findById(trx: Kysely<Database>, recipientUserId: string, id: string): Promise<Alert | null> {
    const row = await trx.selectFrom("alerts").select(ALERT_COLUMNS).where("recipient_user_id", "=", recipientUserId).where("id", "=", id).executeTakeFirst();
    return row ? toAlert(row) : null;
  }

  async listByRecipient(trx: Kysely<Database>, recipientUserId: string, filter: AlertListFilter, limit: number, cursor?: string): Promise<CursorPage<Alert>> {
    let query = trx.selectFrom("alerts").select(ALERT_COLUMNS).where("recipient_user_id", "=", recipientUserId);
    if (filter.unread === true) {
      query = query.where("read_at", "is", null);
    } else if (filter.unread === false) {
      query = query.where("read_at", "is not", null);
    }
    if (cursor) {
      const decoded = decodeAlertCursor(cursor);
      const triggerAt = new Date(decoded.triggerAt);
      query = query.where((eb) =>
        eb.or([
          eb(READ_RANK, ">", decoded.rank),
          eb.and([eb(READ_RANK, "=", decoded.rank), eb("trigger_at", "<", triggerAt)]),
          eb.and([eb(READ_RANK, "=", decoded.rank), eb("trigger_at", "=", triggerAt), eb("id", ">", decoded.id)]),
        ]),
      );
    }
    const rows = await query.orderBy(READ_RANK, "asc").orderBy("trigger_at", "desc").orderBy("id", "asc").limit(limit + 1).execute();

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const nextCursor = hasMore && last ? encodeAlertCursor({ rank: last.read_at === null ? 0 : 1, triggerAt: last.trigger_at.toISOString(), id: last.id }) : null;
    return { items: page.map(toAlert), nextCursor };
  }

  async markRead(trx: Kysely<Database>, id: string, readAt: Date): Promise<Alert> {
    const row = await trx.updateTable("alerts").set({ read_at: readAt }).where("id", "=", id).returning(ALERT_COLUMNS).executeTakeFirstOrThrow();
    return toAlert(row);
  }

  async markAllRead(trx: Kysely<Database>, recipientUserId: string, readAt: Date): Promise<string[]> {
    const rows = await trx
      .updateTable("alerts")
      .set({ read_at: readAt })
      .where("recipient_user_id", "=", recipientUserId)
      .where("read_at", "is", null)
      .returning(["id"])
      .execute();
    return rows.map((row) => row.id);
  }
}
