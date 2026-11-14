// Implementações Kysely de serviços, planos/versões e coberturas (S2 mínimo). Toda consulta filtra por `insurer_id` (BR-SEG-14);
// as FKs compostas `(insurer_id, id)` garantem na BD que nada cruza seguradoras. Dinheiro: `numeric` lido como texto ⇒ número.
import { sql, type Kysely } from "kysely";
import type { Database } from "../../../platform/db/index.js";
import type { PageQuery, PlansRepository, ServicesRepository } from "../application/ports.js";
import type { InsurerPlan, ParsedCoverage, PlanCoverage } from "../domain/plan.js";
import type { PlanStatus } from "../domain/policy.js";
import type { InsurerService, ServicePatch, ServiceStatus } from "../domain/service.js";
import { guard, keyset, likeContains, required } from "./db-helpers.js";
import "./schema.js";

type Db = Kysely<Database>;

// ---------- Serviços ----------

interface ServiceRow {
  id: string;
  insurer_id: string;
  code: string;
  name: string;
  category: string | null;
  status: ServiceStatus;
  created_at: Date;
}

const toService = (r: ServiceRow): InsurerService => ({ id: r.id, insurerId: r.insurer_id, code: r.code, name: r.name, category: r.category, status: r.status, createdAt: r.created_at });
const SERVICE_COLUMNS = ["id", "insurer_id", "code", "name", "category", "status", "created_at"] as const;

export class KyselyServicesRepository implements ServicesRepository<Db> {
  async insert(trx: Db, record: { id: string; insurerId: string; code: string; name: string; category: string | null; createdAt: Date }): Promise<InsurerService> {
    await guard(
      () =>
        trx
          .insertInto("insurer_services")
          .values({ id: record.id, insurer_id: record.insurerId, code: record.code, name: record.name, category: record.category, created_at: record.createdAt, updated_at: record.createdAt })
          .execute(),
      "Já existe um serviço com este código.",
    );
    return required(await this.findById(trx, record.insurerId, record.id));
  }

  async findById(trx: Db, insurerId: string, id: string): Promise<InsurerService | null> {
    const row = await trx.selectFrom("insurer_services").select(SERVICE_COLUMNS).where("insurer_id", "=", insurerId).where("id", "=", id).executeTakeFirst();
    return row ? toService(row) : null;
  }

  async list(trx: Db, insurerId: string, filter: { q?: string; status?: ServiceStatus }, page: PageQuery): Promise<InsurerService[]> {
    let query = trx.selectFrom("insurer_services as s").select(SERVICE_COLUMNS.map((c) => `s.${c}` as const)).where("s.insurer_id", "=", insurerId);
    if (filter.status) query = query.where("s.status", "=", filter.status);
    if (filter.q) {
      const like = likeContains(filter.q);
      query = query.where((eb) => eb.or([eb("s.code", "ilike", like), eb("s.name", "ilike", like)]));
    }
    return (await keyset(query, "s", page).execute()).map(toService);
  }

  async update(trx: Db, insurerId: string, id: string, patch: ServicePatch, now: Date): Promise<InsurerService> {
    await trx
      .updateTable("insurer_services")
      .set({
        updated_at: now,
        ...(patch.name === undefined ? {} : { name: patch.name }),
        ...(patch.category === undefined ? {} : { category: patch.category }),
        ...(patch.status === undefined ? {} : { status: patch.status }),
      })
      .where("insurer_id", "=", insurerId)
      .where("id", "=", id)
      .execute();
    return required(await this.findById(trx, insurerId, id));
  }

  async countByIds(trx: Db, insurerId: string, ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const row = await trx
      .selectFrom("insurer_services")
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .where("insurer_id", "=", insurerId)
      .where("id", "in", ids)
      .executeTakeFirstOrThrow();
    return Number(row.n);
  }
}

// ---------- Planos, versões e coberturas ----------

interface PlanRow {
  id: string;
  insurer_id: string;
  name: string;
  version: number;
  status: PlanStatus;
  coverage_count: string | number;
  created_at: Date;
}

const toPlan = (r: PlanRow): InsurerPlan => ({ id: r.id, insurerId: r.insurer_id, name: r.name, version: r.version, status: r.status, coverageCount: Number(r.coverage_count), createdAt: r.created_at });

export class KyselyPlansRepository implements PlansRepository<Db> {
  private select(trx: Db, insurerId: string) {
    return trx
      .selectFrom("insurer_plans as p")
      .select([
        "p.id",
        "p.insurer_id",
        "p.name",
        "p.version",
        "p.status",
        "p.created_at",
        sql<string>`(select count(*) from insurer_plan_coverages c where c.insurer_id = p.insurer_id and c.plan_id = p.id)`.as("coverage_count"),
      ])
      .where("p.insurer_id", "=", insurerId);
  }

  async insert(trx: Db, record: { id: string; insurerId: string; name: string; createdAt: Date }): Promise<InsurerPlan> {
    await guard(
      () => trx.insertInto("insurer_plans").values({ id: record.id, insurer_id: record.insurerId, name: record.name, created_at: record.createdAt, updated_at: record.createdAt }).execute(),
      "Já existe um plano com este nome.",
    );
    return required(await this.findById(trx, record.insurerId, record.id));
  }

  async findById(trx: Db, insurerId: string, id: string, lock = false): Promise<InsurerPlan | null> {
    if (lock) await trx.selectFrom("insurer_plans").select("id").where("insurer_id", "=", insurerId).where("id", "=", id).forUpdate().execute();
    const row = await this.select(trx, insurerId).where("p.id", "=", id).executeTakeFirst();
    return row ? toPlan(row) : null;
  }

  async list(trx: Db, insurerId: string, filter: { status?: PlanStatus; name?: string }, page: PageQuery): Promise<InsurerPlan[]> {
    let query = this.select(trx, insurerId);
    if (filter.status) query = query.where("p.status", "=", filter.status);
    if (filter.name) query = query.where("p.name", "ilike", likeContains(filter.name));
    return (await keyset(query, "p", page).execute()).map(toPlan);
  }

  async setStatus(trx: Db, insurerId: string, id: string, status: PlanStatus, now: Date): Promise<InsurerPlan> {
    await trx.updateTable("insurer_plans").set({ status, updated_at: now }).where("insurer_id", "=", insurerId).where("id", "=", id).execute();
    return required(await this.findById(trx, insurerId, id));
  }

  async maxVersion(trx: Db, insurerId: string, name: string): Promise<number> {
    const row = await trx
      .selectFrom("insurer_plans")
      .select((eb) => eb.fn.max("version").as("v"))
      .where("insurer_id", "=", insurerId)
      .where("name", "=", name)
      .executeTakeFirst();
    return row?.v ?? 0;
  }

  async hasDraft(trx: Db, insurerId: string, name: string): Promise<boolean> {
    return (await trx.selectFrom("insurer_plans").select("id").where("insurer_id", "=", insurerId).where("name", "=", name).where("status", "=", "DRAFT").limit(1).executeTakeFirst()) !== undefined;
  }

  async insertNewVersion(trx: Db, record: { id: string; insurerId: string; sourcePlanId: string; name: string; version: number; createdAt: Date }): Promise<InsurerPlan> {
    await guard(async () => {
      await trx.insertInto("insurer_plans").values({ id: record.id, insurer_id: record.insurerId, name: record.name, version: record.version, created_at: record.createdAt, updated_at: record.createdAt }).execute();
      // Copia as coberturas da versão de origem (mesma seguradora; as FKs compostas fecham o resto).
      await sql`
        insert into insurer_plan_coverages (insurer_id, plan_id, service_id, type, copay_pct, limit_per_beneficiary, limit_per_family, limit_per_year, waiting_days, requires_authorization, created_at, updated_at)
        select insurer_id, ${record.id}::uuid, service_id, type, copay_pct, limit_per_beneficiary, limit_per_family, limit_per_year, waiting_days, requires_authorization, ${record.createdAt}, ${record.createdAt}
        from insurer_plan_coverages where insurer_id = ${record.insurerId}::uuid and plan_id = ${record.sourcePlanId}::uuid`.execute(trx);
    }, "Já existe uma versão em rascunho deste plano.");
    return required(await this.findById(trx, record.insurerId, record.id));
  }

  async listCoverages(trx: Db, insurerId: string, planId: string): Promise<PlanCoverage[]> {
    const rows = await trx
      .selectFrom("insurer_plan_coverages as c")
      .innerJoin("insurer_services as s", (join) => join.onRef("s.insurer_id", "=", "c.insurer_id").onRef("s.id", "=", "c.service_id"))
      .select(["c.service_id", "s.code", "s.name", "c.type", "c.copay_pct", "c.limit_per_year", "c.waiting_days", "c.requires_authorization"])
      .where("c.insurer_id", "=", insurerId)
      .where("c.plan_id", "=", planId)
      .orderBy("s.code")
      .execute();
    return rows.map((r) => ({
      serviceId: r.service_id,
      serviceCode: r.code,
      serviceName: r.name,
      covered: r.type !== "EXCLUDED",
      copayPct: Number(r.copay_pct),
      limitPerYear: r.limit_per_year === null ? null : Number(r.limit_per_year),
      waitingDays: r.waiting_days,
      requiresAuthorization: r.requires_authorization,
    }));
  }

  async replaceCoverages(trx: Db, insurerId: string, planId: string, items: ParsedCoverage[], now: Date): Promise<void> {
    await trx.deleteFrom("insurer_plan_coverages").where("insurer_id", "=", insurerId).where("plan_id", "=", planId).execute();
    if (items.length === 0) return;
    await guard(
      () =>
        trx
          .insertInto("insurer_plan_coverages")
          .values(
            items.map((i) => ({
              insurer_id: insurerId,
              plan_id: planId,
              service_id: i.serviceId,
              type: i.type,
              copay_pct: i.copayPct,
              limit_per_year: i.limitPerYear,
              waiting_days: i.waitingDays,
              requires_authorization: i.requiresAuthorization,
              created_at: now,
              updated_at: now,
            })),
          )
          .execute(),
      "Cobertura inválida.",
    );
  }
}
