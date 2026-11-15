// Implementação Kysely de `AutoApprovalRulesRepository` (marco B fatia 4, schema.md §3c, BR-AUT-23). Sem regras de negócio: a
// especificidade (serviço > tipo) é de `domain/auto-approval.ts`. UNIQUE parciais = «uma regra ativa por alvo», também sob corrida.
import { sql, type Kysely } from "kysely";
import type { Database } from "../../../platform/db/index.js";
import type { AutoApprovalRuleRecord, AutoApprovalRulesRepository } from "../application/ports.js";
import type { AutoApprovalRule } from "../domain/auto-approval.js";
import { guard } from "./db-helpers.js";
import "./schema.js";

type Db = Kysely<Database>;

const toMinor = (value: string): number => Math.round(Number(value) * 100);

export class KyselyAutoApprovalRulesRepository implements AutoApprovalRulesRepository<Db> {
  async listActive(trx: Db, insurerId: string): Promise<AutoApprovalRule[]> {
    const rows = await trx.selectFrom("insurer_auto_approval_rules").select(["id", "name", "service_kind_id", "service_id", "max_amount", "active"]).where("insurer_id", "=", insurerId).where("active", "=", true).execute();
    return rows.map((r) => ({ id: r.id, name: r.name, serviceKindId: r.service_kind_id, serviceId: r.service_id, maxAmountMinor: toMinor(r.max_amount), active: r.active }));
  }

  private query(trx: Db, insurerId: string) {
    return trx
      .selectFrom("insurer_auto_approval_rules as r")
      .leftJoin("insurer_service_kinds as k", (join) => join.onRef("k.insurer_id", "=", "r.insurer_id").onRef("k.id", "=", "r.service_kind_id"))
      .leftJoin("insurer_services as s", (join) => join.onRef("s.insurer_id", "=", "r.insurer_id").onRef("s.id", "=", "r.service_id"))
      .select(["r.id", "r.name", "r.service_kind_id", "r.service_id", "r.max_amount", "r.active", "r.created_at", "r.updated_at", "k.name as kind_name", "s.name as service_name"])
      .where("r.insurer_id", "=", insurerId);
  }

  private static map(r: { id: string; name: string; service_kind_id: string | null; service_id: string | null; max_amount: string; active: boolean; created_at: Date; updated_at: Date; kind_name: string | null; service_name: string | null }): AutoApprovalRuleRecord {
    return {
      id: r.id,
      name: r.name,
      serviceKindId: r.service_kind_id,
      serviceId: r.service_id,
      maxAmountMinor: toMinor(r.max_amount),
      active: r.active,
      targetName: r.service_name ?? r.kind_name ?? "",
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  async list(trx: Db, insurerId: string): Promise<AutoApprovalRuleRecord[]> {
    const rows = await this.query(trx, insurerId).orderBy(sql`r.active desc`).orderBy("r.name").orderBy("r.id").limit(100).execute();
    return rows.map((r) => KyselyAutoApprovalRulesRepository.map(r));
  }

  async count(trx: Db, insurerId: string): Promise<number> {
    const row = await trx.selectFrom("insurer_auto_approval_rules").select(sql<string>`count(*)`.as("n")).where("insurer_id", "=", insurerId).executeTakeFirstOrThrow();
    return Number(row.n);
  }

  async find(trx: Db, insurerId: string, id: string): Promise<AutoApprovalRuleRecord | null> {
    const row = await this.query(trx, insurerId).where("r.id", "=", id).executeTakeFirst();
    return row ? KyselyAutoApprovalRulesRepository.map(row) : null;
  }

  async insert(trx: Db, record: { id: string; insurerId: string; name: string; serviceKindId: string | null; serviceId: string | null; maxAmount: number; active: boolean; accountId: string; now: Date }): Promise<void> {
    await guard(
      () =>
        trx
          .insertInto("insurer_auto_approval_rules")
          .values({
            id: record.id,
            insurer_id: record.insurerId,
            name: record.name,
            service_kind_id: record.serviceKindId,
            service_id: record.serviceId,
            max_amount: record.maxAmount,
            active: record.active,
            created_by_insurance_account_id: record.accountId,
            updated_by_insurance_account_id: record.accountId,
            created_at: record.now,
            updated_at: record.now,
          })
          .execute(),
      "Já existe uma regra ativa para este alvo.",
    );
  }

  async update(trx: Db, insurerId: string, id: string, patch: { name?: string; maxAmount?: number; active?: boolean }, accountId: string, now: Date): Promise<void> {
    await guard(
      () =>
        trx
          .updateTable("insurer_auto_approval_rules")
          .set({
            ...(patch.name !== undefined ? { name: patch.name } : {}),
            ...(patch.maxAmount !== undefined ? { max_amount: patch.maxAmount } : {}),
            ...(patch.active !== undefined ? { active: patch.active } : {}),
            updated_by_insurance_account_id: accountId,
            updated_at: now,
          })
          .where("insurer_id", "=", insurerId)
          .where("id", "=", id)
          .execute(),
      "Já existe uma regra ativa para este alvo.",
    );
  }

  async remove(trx: Db, insurerId: string, id: string): Promise<boolean> {
    const result = await trx.deleteFrom("insurer_auto_approval_rules").where("insurer_id", "=", insurerId).where("id", "=", id).executeTakeFirst();
    return Number(result.numDeletedRows) > 0;
  }
}
