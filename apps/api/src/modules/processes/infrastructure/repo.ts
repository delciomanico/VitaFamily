// Implementação Kysely/pg de `ProcessesRepository` (application/ports.ts). Leituras exigem `familyId`
// (conventions.md §3.4); a leitura da clínica filtra por `clinic_id` (BR-PRC-06).
import { sql, type Kysely, type Selectable } from "kysely";
import type { Database } from "../../../platform/db/index.js";
import type { NewProcessRecord, ProcessListFilter, ProcessesRepository } from "../application/ports.js";
import type { Process } from "../domain/process.js";
import "./schema.js";
import type { ProcessesTable } from "./schema.js";

const PROCESS_COLUMNS = ["id", "family_id", "member_id", "kind", "origin_type", "origin_id", "clinic_id", "opened_at"] as const;

function toProcess(row: Selectable<ProcessesTable>): Process {
  return {
    id: row.id,
    familyId: row.family_id,
    memberId: row.member_id,
    kind: row.kind,
    originType: row.origin_type,
    originId: row.origin_id,
    openedAt: row.opened_at,
    ...(row.clinic_id !== null ? { clinicId: row.clinic_id } : {}),
  };
}

/**
 * O cursor guarda `openedAt` em milissegundos (JS `Date`); linhas do backfill podem ter microssegundos. Ordenar e comparar
 * pelo valor truncado ao milissegundo mantém a paginação estável (sem saltos entre páginas).
 */
const OPENED_AT_MS = sql<Date>`date_trunc('milliseconds', opened_at)`;

export class KyselyProcessesRepository implements ProcessesRepository<Kysely<Database>> {
  async insertIfAbsent(trx: Kysely<Database>, record: NewProcessRecord): Promise<{ process: Process; created: boolean }> {
    const inserted = await trx
      .insertInto("processes")
      .values({
        id: record.id,
        family_id: record.familyId,
        member_id: record.memberId,
        kind: record.kind,
        origin_type: record.originType,
        origin_id: record.originId,
        clinic_id: record.clinicId ?? null,
        opened_at: record.openedAt,
      })
      .onConflict((conflict) => conflict.columns(["origin_type", "origin_id"]).doNothing())
      .returning(PROCESS_COLUMNS)
      .executeTakeFirst();
    if (inserted) {
      return { process: toProcess(inserted), created: true };
    }
    const existing = await trx.selectFrom("processes").select(PROCESS_COLUMNS).where("origin_type", "=", record.originType).where("origin_id", "=", record.originId).executeTakeFirstOrThrow();
    return { process: toProcess(existing), created: false };
  }

  async deleteByOrigin(trx: Kysely<Database>, originType: Process["originType"], originId: string): Promise<Process | null> {
    const row = await trx.deleteFrom("processes").where("origin_type", "=", originType).where("origin_id", "=", originId).returning(PROCESS_COLUMNS).executeTakeFirst();
    return row ? toProcess(row) : null;
  }

  async findOfMember(trx: Kysely<Database>, familyId: string, memberId: string, processId: string): Promise<Process | null> {
    const row = await trx.selectFrom("processes").select(PROCESS_COLUMNS).where("family_id", "=", familyId).where("member_id", "=", memberId).where("id", "=", processId).executeTakeFirst();
    return row ? toProcess(row) : null;
  }

  async listOfMember(trx: Kysely<Database>, familyId: string, memberId: string, filter: ProcessListFilter, limit: number): Promise<{ rows: Process[]; hasMore: boolean }> {
    let query = trx.selectFrom("processes").select(PROCESS_COLUMNS).where("family_id", "=", familyId).where("member_id", "=", memberId).where("origin_type", "in", filter.originTypes);
    if (filter.after) {
      const openedAt = new Date(filter.after.createdAt);
      const afterId = filter.after.id;
      query = query.where((eb) => eb.or([eb(OPENED_AT_MS, "<", openedAt), eb.and([eb(OPENED_AT_MS, "=", openedAt), eb("id", "<", afterId)])]));
    }
    const rows = await query.orderBy(OPENED_AT_MS, "desc").orderBy("id", "desc").limit(limit + 1).execute();
    return { rows: rows.slice(0, limit).map(toProcess), hasMore: rows.length > limit };
  }

  async findByIds(trx: Kysely<Database>, processIds: string[]): Promise<Process[]> {
    if (processIds.length === 0) return [];
    return (await trx.selectFrom("processes").select(PROCESS_COLUMNS).where("id", "in", processIds).execute()).map(toProcess);
  }

  async findOfClinic(trx: Kysely<Database>, clinicId: string, processId: string): Promise<Process | null> {
    const row = await trx.selectFrom("processes").select(PROCESS_COLUMNS).where("clinic_id", "=", clinicId).where("id", "=", processId).executeTakeFirst();
    return row ? toProcess(row) : null;
  }
}
