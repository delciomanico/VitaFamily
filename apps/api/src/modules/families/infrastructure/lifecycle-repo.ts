// Implementação Kysely/pg de `LifecycleRepository` (application/lifecycle-ops.ts).
import { sql, type Kysely } from "kysely";
import type { Database } from "../../../platform/db/index.js";
import { BLOCKED_RETENTION_DAYS, type LifecycleRepository, type LifecycleTarget } from "../application/lifecycle-ops.js";
import "./schema.js";

interface TargetRow {
  family_id: string;
  id: string;
  name: string;
  user_id: string | null;
}

export class KyselyLifecycleRepository implements LifecycleRepository<Kysely<Database>> {
  private async toTargets(trx: Kysely<Database>, rows: TargetRow[]): Promise<LifecycleTarget[]> {
    const targets: LifecycleTarget[] = [];
    for (const row of rows) {
      const guardians = await trx
        .selectFrom("guardianships as g")
        .innerJoin("family_members as m", (join) => join.onRef("m.id", "=", "g.guardian_id").onRef("m.family_id", "=", "g.family_id"))
        .select("m.user_id")
        .where("g.family_id", "=", row.family_id)
        .where("g.dependent_id", "=", row.id)
        .execute();
      const admins = await trx
        .selectFrom("family_members")
        .select("user_id")
        .where("family_id", "=", row.family_id)
        .where("role", "=", "FAMILY_ADMIN")
        .execute();
      targets.push({
        familyId: row.family_id,
        memberId: row.id,
        name: row.name,
        ...(row.user_id ? { userId: row.user_id } : {}),
        guardianUserIds: guardians.flatMap((g) => (g.user_id ? [g.user_id] : [])),
        adminUserIds: admins.flatMap((a) => (a.user_id ? [a.user_id] : [])),
      });
    }
    return targets;
  }

  async listTurningAdult(trx: Kysely<Database>, today: string, inDays: number): Promise<LifecycleTarget[]> {
    // `created_at` anterior ao 18.º aniversário distingue o menor que cresceu do adulto que foi
    // marcado como dependente por consentimento (N3), que não é afetado por esta regra.
    const rows = await trx
      .selectFrom("family_members")
      .select(["family_id", "id", "name", "user_id"])
      .where("is_dependent", "=", true)
      .where("status", "=", "ACTIVE")
      .where(sql<boolean>`birth_date + interval '18 years' = (${today}::date + ${inDays} * interval '1 day')`)
      .where(sql<boolean>`created_at < birth_date + interval '18 years'`)
      .execute();
    return this.toTargets(trx, rows);
  }

  async listAdultsDue(trx: Kysely<Database>, today: string): Promise<LifecycleTarget[]> {
    const rows = await trx
      .selectFrom("family_members")
      .select(["family_id", "id", "name", "user_id"])
      .where("is_dependent", "=", true)
      .where("status", "=", "ACTIVE")
      .where(sql<boolean>`birth_date + interval '18 years' <= ${today}::date`)
      .where(sql<boolean>`created_at < birth_date + interval '18 years'`)
      .execute();
    return this.toTargets(trx, rows);
  }

  async completeComingOfAge(trx: Kysely<Database>, familyId: string, memberId: string, now: Date): Promise<{ blocked: boolean }> {
    const member = await trx.selectFrom("family_members").select("user_id").where("family_id", "=", familyId).where("id", "=", memberId).executeTakeFirstOrThrow();
    await trx.deleteFrom("guardianships").where("family_id", "=", familyId).where("dependent_id", "=", memberId).execute();
    const hasAccount = member.user_id !== null;
    await trx
      .updateTable("family_members")
      .set(
        hasAccount
          ? { is_dependent: false, role: "FAMILY_MEMBER", updated_at: sql`now()` }
          : {
              is_dependent: false,
              status: "BLOCKED",
              blocked_at: now,
              scheduled_deletion_at: new Date(now.getTime() + BLOCKED_RETENTION_DAYS * 86_400_000),
              updated_at: sql`now()`,
            },
      )
      .where("family_id", "=", familyId)
      .where("id", "=", memberId)
      .execute();
    return { blocked: !hasAccount };
  }

  async listBlockedForDays(trx: Kysely<Database>, today: string, days: number): Promise<LifecycleTarget[]> {
    const rows = await trx
      .selectFrom("family_members")
      .select(["family_id", "id", "name", "user_id"])
      .where("status", "=", "BLOCKED")
      .where(sql<boolean>`blocked_at::date = (${today}::date - ${days} * interval '1 day')::date`)
      .execute();
    return this.toTargets(trx, rows);
  }

  async listBlockedDue(trx: Kysely<Database>, now: Date): Promise<LifecycleTarget[]> {
    const rows = await trx
      .selectFrom("family_members")
      .select(["family_id", "id", "name", "user_id"])
      .where("status", "=", "BLOCKED")
      .where("scheduled_deletion_at", "<=", now)
      .execute();
    return this.toTargets(trx, rows);
  }

  async deleteMember(trx: Kysely<Database>, familyId: string, memberId: string): Promise<void> {
    await trx.deleteFrom("family_members").where("family_id", "=", familyId).where("id", "=", memberId).execute();
  }
}
