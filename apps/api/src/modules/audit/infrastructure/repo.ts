// Implementação Kysely/pg da porta `AuditRepository` (application/ports.ts).
import type { Kysely } from "kysely";
import type { Database } from "../../../platform/db/index.js";
import type { AuditRepository, AuditMaintenanceRepository } from "../application/ports.js";
import type { AuditEvent } from "../domain/event.js";
import "./schema.js";

/** `Trx` é sempre `Kysely<Database>` ou uma `Transaction<Database>` (que o estende). */
export class KyselyAuditRepository implements AuditRepository<Kysely<Database>> {
  async record(trx: Kysely<Database>, event: AuditEvent): Promise<void> {
    await trx
      .insertInto("audit_logs")
      .values({
        occurred_at: event.occurredAt,
        actor_type: event.actorType,
        actor_user_id: event.actorUserId ?? null,
        action: event.action,
        resource_type: event.resourceType,
        resource_id: event.resourceId ?? null,
        family_id: event.familyId ?? null,
        subject_member_id: event.subjectMemberId ?? null,
        result: event.result,
        ip: event.ip ?? null,
        user_agent: event.userAgent ?? null,
        request_id: event.requestId,
        metadata: event.metadata ?? null,
      })
      .execute();
  }
}

/** Papel de manutenção (audit.md regras 5/6) — chamado pelo worker (`auth.cleanup`/`audit.purge`). */
export class KyselyAuditMaintenanceRepository implements AuditMaintenanceRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async purgeOlderThan(cutoff: Date): Promise<number> {
    const result = await this.db
      .deleteFrom("audit_logs")
      .where("occurred_at", "<", cutoff)
      .executeTakeFirst();
    return Number(result.numDeletedRows);
  }

  async anonymizeUser(userId: string): Promise<number> {
    const result = await this.db
      .updateTable("audit_logs")
      .set({ actor_user_id: null, ip: null, user_agent: null })
      .where("actor_user_id", "=", userId)
      .executeTakeFirst();
    return Number(result.numUpdatedRows);
  }
}
