// Implementação Kysely/pg da porta `AuditRepository` (application/ports.ts).
import { sql, type Kysely } from "kysely";
import { getClinicActor } from "../../../platform/actor/index.js";
import type { Database } from "../../../platform/db/index.js";
import type { AuditRepository, AuditMaintenanceRepository, ClinicAuditEntry, ClinicAuditFilter, ClinicAuditReader } from "../application/ports.js";
import type { AuditEvent } from "../domain/event.js";
import "./schema.js";

/** BR-CLN-40: a clínica do ator vem do token do pedido (ou explícita); nunca de dados do pedido. */
function clinicIdOf(event: AuditEvent): string | null {
  if (event.actorType !== "CLINIC_ACCOUNT") return null;
  if (event.actorClinicId) return event.actorClinicId;
  const actor = getClinicActor();
  return actor && actor.clinicAccountId === event.actorClinicAccountId ? actor.clinicId : null;
}

/** `Trx` é sempre `Kysely<Database>` ou uma `Transaction<Database>` (que o estende). */
export class KyselyAuditRepository implements AuditRepository<Kysely<Database>> {
  async record(trx: Kysely<Database>, event: AuditEvent): Promise<void> {
    await trx
      .insertInto("audit_logs")
      .values({
        occurred_at: event.occurredAt,
        actor_type: event.actorType,
        actor_user_id: event.actorUserId ?? null,
        actor_clinic_account_id: event.actorClinicAccountId ?? null,
        actor_clinic_id: clinicIdOf(event),
        actor_insurance_account_id: event.actorInsuranceAccountId ?? null,
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

/** BR-CLN-40: só `actor_type = CLINIC_ACCOUNT` da clínica do token; projeção mínima (sem ip, metadata, família…). */
export class KyselyClinicAuditReader implements ClinicAuditReader<Kysely<Database>> {
  async list(trx: Kysely<Database>, filter: ClinicAuditFilter, limit: number): Promise<ClinicAuditEntry[]> {
    let query = trx
      .selectFrom("audit_logs")
      .select(["id", "occurred_at", "action", "resource_type", "resource_id", "result", "actor_clinic_account_id"])
      .where("actor_clinic_id", "=", filter.clinicId)
      .where("actor_type", "=", "CLINIC_ACCOUNT")
      .where("occurred_at", ">=", filter.from)
      .where("occurred_at", "<=", filter.to);
    if (filter.action !== undefined) query = query.where("action", "=", filter.action);
    if (filter.actorAccountId !== undefined) query = query.where("actor_clinic_account_id", "=", filter.actorAccountId);
    if (filter.after) query = query.where(sql<boolean>`(occurred_at, id) < (${filter.after.occurredAt}, ${filter.after.id}::bigint)`);
    const rows = await query.orderBy("occurred_at", "desc").orderBy("id", "desc").limit(limit).execute();
    return rows.map((row) => ({
      id: row.id,
      occurredAt: row.occurred_at,
      action: row.action,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      result: row.result,
      actorAccountId: row.actor_clinic_account_id,
    }));
  }
}
