// Implementação Kysely/pg de `AdminProfessionalRepository`: fila/lista do admin (BR-MKT-18). Só identificação profissional.
import { sql, type Kysely } from "kysely";
import type { Database } from "../../../platform/db/index.js";
import type { AdminProfessionalFilter, AdminProfessionalItemRow, AdminProfessionalRepository, LinkedSpecialty } from "../application/ports.js";
import "./schema.js";

/** Escapa `%`, `_` e `\` para um `ILIKE` literal (a pesquisa é por texto, nunca por padrão). */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export class KyselyAdminProfessionalRepository implements AdminProfessionalRepository<Kysely<Database>> {
  async list(trx: Kysely<Database>, filter: AdminProfessionalFilter): Promise<AdminProfessionalItemRow[]> {
    let query = trx
      .selectFrom("professionals as p")
      .innerJoin("professional_accounts as a", "a.id", "p.account_id")
      .select([
        "p.id",
        "p.display_name",
        "a.email",
        "p.validation_status",
        "p.submitted_at",
        "p.created_at",
        sql<string | null>`to_char(p.submitted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as("submitted_at_key"),
        sql<number>`(SELECT count(*)::int FROM professional_credentials c WHERE c.professional_id = p.id)`.as("credential_count"),
      ])
      .where("p.validation_status", "=", filter.status);
    if (filter.category) {
      query = query.where(sql<boolean>`EXISTS (SELECT 1 FROM professional_specialties ps JOIN specialties s ON s.id = ps.specialty_id WHERE ps.professional_id = p.id AND s.category = ${filter.category})`);
    }
    if (filter.q) {
      const pattern = likePattern(filter.q);
      query = query.where(sql<boolean>`(p.display_name ILIKE ${pattern} ESCAPE '\\' OR a.email::text ILIKE ${pattern} ESCAPE '\\')`);
    }
    if (filter.after) {
      const ts = filter.after.submittedAtKey ?? "infinity";
      query = query.where(sql<boolean>`(coalesce(p.submitted_at, 'infinity'::timestamptz), p.id) > (${ts}::timestamptz, ${filter.after.id}::uuid)`);
    }
    const rows = await query.orderBy(sql`coalesce(p.submitted_at, 'infinity'::timestamptz)`).orderBy("p.id").limit(filter.limit).execute();
    return rows.map((r) => ({
      id: r.id,
      displayName: r.display_name,
      email: r.email,
      validationStatus: r.validation_status,
      submittedAt: r.submitted_at,
      submittedAtKey: r.submitted_at_key,
      credentialCount: r.credential_count,
      createdAt: r.created_at,
    }));
  }

  async listSpecialtiesFor(trx: Kysely<Database>, professionalIds: string[]): Promise<Map<string, LinkedSpecialty[]>> {
    const result = new Map<string, LinkedSpecialty[]>();
    if (professionalIds.length === 0) return result;
    const rows = await trx
      .selectFrom("professional_specialties as ps")
      .innerJoin("specialties as s", "s.id", "ps.specialty_id")
      .select(["ps.professional_id", "s.id", "s.name", "s.category", "s.active"])
      .where("ps.professional_id", "in", professionalIds)
      .orderBy("s.name")
      .execute();
    for (const row of rows) {
      const list = result.get(row.professional_id) ?? [];
      list.push({ id: row.id, name: row.name, category: row.category, active: row.active });
      result.set(row.professional_id, list);
    }
    return result;
  }
}
