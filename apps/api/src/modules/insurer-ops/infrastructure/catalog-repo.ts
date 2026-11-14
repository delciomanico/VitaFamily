// Implementações Kysely de serviços, planos/versões e coberturas (S2 mínimo). Toda consulta filtra por `insurer_id` (BR-SEG-14);
// as FKs compostas `(insurer_id, id)` garantem na BD que nada cruza seguradoras. Dinheiro: `numeric` lido como texto ⇒ número.
import { sql, type ExpressionBuilder, type Kysely } from "kysely";
import type { Database } from "../../../platform/db/index.js";
import type { CatalogTypesRepository, PageQuery, PlansRepository, PolicySettingsRepository, ServiceKindsRepository, ServicesRepository } from "../application/ports.js";
import type { InsurerPlan, ParsedCoverage, PlanCoverage } from "../domain/plan.js";
import type { PlanStatus } from "../domain/policy.js";
import type { PolicySettingDefinition, StoredPolicySetting } from "../domain/policy-setting.js";
import type { InsurerService, ServicePatch, ServiceStatus } from "../domain/service.js";
import type { CatalogTypes, ServiceKind, ServiceKindInput, ServiceKindPatch } from "../domain/service-kind.js";
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
  service_kind_id: string | null;
  guide_type: string | null;
  expense_type: string | null;
  created_at: Date;
}

const toService = (r: ServiceRow): InsurerService => ({
  id: r.id,
  insurerId: r.insurer_id,
  code: r.code,
  name: r.name,
  category: r.category,
  status: r.status,
  serviceKindId: r.service_kind_id,
  guideType: r.guide_type,
  expenseType: r.expense_type,
  createdAt: r.created_at,
});

/** Serviço com `guideType`/`expenseType` derivados do tipo (BR-SEG-39). */
function selectServices(trx: Db, insurerId: string) {
  return trx
    .selectFrom("insurer_services as s")
    .leftJoin("insurer_service_kinds as k", (join) => join.onRef("k.insurer_id", "=", "s.insurer_id").onRef("k.id", "=", "s.service_kind_id"))
    .select(["s.id", "s.insurer_id", "s.code", "s.name", "s.category", "s.status", "s.service_kind_id", "k.guide_type", "k.expense_type", "s.created_at"])
    .where("s.insurer_id", "=", insurerId);
}

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
    const row = await selectServices(trx, insurerId).where("s.id", "=", id).executeTakeFirst();
    return row ? toService(row) : null;
  }

  async list(trx: Db, insurerId: string, filter: { q?: string; status?: ServiceStatus }, page: PageQuery): Promise<InsurerService[]> {
    let query = selectServices(trx, insurerId);
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
        ...(patch.serviceKindId === undefined ? {} : { service_kind_id: patch.serviceKindId }),
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

  async listForClassification(trx: Db, insurerId: string): Promise<{ id: string; category: string | null; serviceKindId: string | null }[]> {
    const rows = await trx.selectFrom("insurer_services").select(["id", "category", "service_kind_id"]).where("insurer_id", "=", insurerId).execute();
    return rows.map((r) => ({ id: r.id, category: r.category, serviceKindId: r.service_kind_id }));
  }

  async setServiceKind(trx: Db, insurerId: string, ids: string[], serviceKindId: string, now: Date): Promise<void> {
    if (ids.length === 0) return;
    await trx.updateTable("insurer_services").set({ service_kind_id: serviceKindId, updated_at: now }).where("insurer_id", "=", insurerId).where("id", "in", ids).execute();
  }
}

// ---------- Tipos de serviço (service_kind), catálogos globais e política (ADR-033) ----------

const toKind = (r: { id: string; insurer_id: string; code: string; name: string; guide_type: string; expense_type: string; status: ServiceStatus; services_count: string | number }): ServiceKind => ({
  id: r.id,
  insurerId: r.insurer_id,
  code: r.code,
  name: r.name,
  guideType: r.guide_type,
  expenseType: r.expense_type,
  status: r.status,
  servicesCount: Number(r.services_count),
});

export class KyselyServiceKindsRepository implements ServiceKindsRepository<Db> {
  private select(trx: Db, insurerId: string) {
    return trx
      .selectFrom("insurer_service_kinds as k")
      .select([
        "k.id",
        "k.insurer_id",
        "k.code",
        "k.name",
        "k.guide_type",
        "k.expense_type",
        "k.status",
        sql<string>`(select count(*) from insurer_services s where s.insurer_id = k.insurer_id and s.service_kind_id = k.id)`.as("services_count"),
      ])
      .where("k.insurer_id", "=", insurerId);
  }

  async count(trx: Db, insurerId: string): Promise<number> {
    const row = await trx.selectFrom("insurer_service_kinds").select((eb) => eb.fn.countAll<string>().as("n")).where("insurer_id", "=", insurerId).executeTakeFirstOrThrow();
    return Number(row.n);
  }

  async seedDefaults(trx: Db, insurerId: string): Promise<void> {
    // Mesma instrução da migração `0037` (semeadura idempotente; sem auditoria).
    await sql`
      INSERT INTO insurer_service_kinds (insurer_id, code, name, guide_type, expense_type)
      SELECT ${insurerId}::uuid, e.code, e.default_name, e.default_guide_type, e.code FROM expense_types e WHERE e.active
      ON CONFLICT (insurer_id, code) DO NOTHING`.execute(trx);
  }

  async list(trx: Db, insurerId: string, filter: { status?: ServiceStatus }): Promise<ServiceKind[]> {
    let query = this.select(trx, insurerId);
    if (filter.status) query = query.where("k.status", "=", filter.status);
    return (await query.orderBy("k.name").orderBy("k.id").execute()).map(toKind);
  }

  async findById(trx: Db, insurerId: string, id: string, lock = false): Promise<ServiceKind | null> {
    if (lock) await trx.selectFrom("insurer_service_kinds").select("id").where("insurer_id", "=", insurerId).where("id", "=", id).forUpdate().execute();
    const row = await this.select(trx, insurerId).where("k.id", "=", id).executeTakeFirst();
    return row ? toKind(row) : null;
  }

  async insert(trx: Db, record: ServiceKindInput & { id: string; insurerId: string; createdAt: Date }): Promise<ServiceKind> {
    await guard(
      () =>
        trx
          .insertInto("insurer_service_kinds")
          .values({ id: record.id, insurer_id: record.insurerId, code: record.code, name: record.name, guide_type: record.guideType, expense_type: record.expenseType, created_at: record.createdAt, updated_at: record.createdAt })
          .execute(),
      "Já existe um tipo de serviço com este código.",
    );
    return required(await this.findById(trx, record.insurerId, record.id));
  }

  async update(trx: Db, insurerId: string, id: string, patch: ServiceKindPatch, now: Date): Promise<ServiceKind> {
    await trx
      .updateTable("insurer_service_kinds")
      .set({
        updated_at: now,
        ...(patch.name === undefined ? {} : { name: patch.name }),
        ...(patch.guideType === undefined ? {} : { guide_type: patch.guideType }),
        ...(patch.expenseType === undefined ? {} : { expense_type: patch.expenseType }),
        ...(patch.status === undefined ? {} : { status: patch.status }),
      })
      .where("insurer_id", "=", insurerId)
      .where("id", "=", id)
      .execute();
    return required(await this.findById(trx, insurerId, id));
  }

  async countActiveServices(trx: Db, insurerId: string, id: string): Promise<number> {
    const row = await trx
      .selectFrom("insurer_services")
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .where("insurer_id", "=", insurerId)
      .where("service_kind_id", "=", id)
      .where("status", "=", "ACTIVE")
      .executeTakeFirstOrThrow();
    return Number(row.n);
  }
}

export class KyselyCatalogTypesRepository implements CatalogTypesRepository<Db> {
  async list(trx: Db): Promise<CatalogTypes> {
    const guides = await trx.selectFrom("guide_types").select("code").where("active", "=", true).orderBy("sort_order").execute();
    const expenses = await trx.selectFrom("expense_types").select(["code", "legacy_code"]).where("active", "=", true).orderBy("sort_order").execute();
    return { guideTypes: guides.map((g) => ({ code: g.code })), expenseTypes: expenses.map((e) => ({ code: e.code, legacyCode: e.legacy_code })) };
  }
}

export class KyselyPolicySettingsRepository implements PolicySettingsRepository<Db> {
  async definitions(trx: Db): Promise<PolicySettingDefinition[]> {
    const rows = await trx.selectFrom("policy_setting_definitions").selectAll().orderBy("key").execute();
    return rows.map((r) => ({ key: r.key, unit: r.unit, min: r.min_value, max: r.max_value, defaultValue: r.default_value, allowsServiceScope: r.allows_service_scope }));
  }

  async list(trx: Db, insurerId: string): Promise<StoredPolicySetting[]> {
    const rows = await trx
      .selectFrom("insurer_policy_settings as p")
      .leftJoin("insurer_services as s", (join) => join.onRef("s.insurer_id", "=", "p.insurer_id").onRef("s.id", "=", "p.service_id"))
      .select(["p.setting_key", "p.service_id", "p.value", "s.code as service_code", "s.name as service_name"])
      .where("p.insurer_id", "=", insurerId)
      .orderBy("p.setting_key")
      .orderBy("s.code")
      .execute();
    return rows.map((r) => ({ key: r.setting_key, serviceId: r.service_id, value: r.value, ...(r.service_code === null ? {} : { serviceCode: r.service_code }), ...(r.service_name === null ? {} : { serviceName: r.service_name }) }));
  }

  async upsert(trx: Db, r: { insurerId: string; key: string; serviceId: string | null; value: number; accountId: string; now: Date }): Promise<{ previous: number | null }> {
    const previous = await this.valueOf(trx, r.insurerId, r.key, r.serviceId);
    if (previous === null) {
      const row = { insurer_id: r.insurerId, setting_key: r.key, service_id: r.serviceId, value: r.value, updated_by_insurance_account_id: r.accountId, created_at: r.now, updated_at: r.now };
      await guard(() => trx.insertInto("insurer_policy_settings").values(row).execute(), "Conflito ao gravar a regra; tente novamente.");
    } else {
      await trx.updateTable("insurer_policy_settings").set({ value: r.value, updated_by_insurance_account_id: r.accountId, updated_at: r.now }).where(sameSetting(r.insurerId, r.key, r.serviceId)).execute();
    }
    return { previous };
  }

  async remove(trx: Db, insurerId: string, key: string, serviceId: string | null): Promise<number | null> {
    const previous = await this.valueOf(trx, insurerId, key, serviceId);
    if (previous !== null) await trx.deleteFrom("insurer_policy_settings").where(sameSetting(insurerId, key, serviceId)).execute();
    return previous;
  }

  /** Valor gravado, com bloqueio da linha (serializa PUT/DELETE concorrentes). */
  private async valueOf(trx: Db, insurerId: string, key: string, serviceId: string | null): Promise<number | null> {
    const row = await trx.selectFrom("insurer_policy_settings").select("value").where(sameSetting(insurerId, key, serviceId)).forUpdate().executeTakeFirst();
    return row?.value ?? null;
  }
}

/** `service_id` nulo = valor da seguradora (índice único parcial). */
const sameSetting = (insurerId: string, key: string, serviceId: string | null) => (eb: ExpressionBuilder<Database, "insurer_policy_settings">) =>
  eb.and([eb("insurer_id", "=", insurerId), eb("setting_key", "=", key), serviceId === null ? eb("service_id", "is", null) : eb("service_id", "=", serviceId)]);

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
