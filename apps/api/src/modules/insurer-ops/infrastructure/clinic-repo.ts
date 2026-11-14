// Implementações Kysely da ligação clínica↔seguradora (`insurer_providers`) e da consulta de elegibilidade (S3 parcial).
// Toda consulta filtra por `insurer_id` (BR-SEG-14). A elegibilidade lê só dados da seguradora; nunca dados de saúde.
import type { Kysely } from "kysely";
import type { Database } from "../../../platform/db/index.js";
import type { EligibilityCandidate, EligibilityLookup, EligibilityRepository, PageQuery, ProvidersRepository } from "../application/ports.js";
import type { CoverageRowForEligibility } from "../domain/eligibility.js";
import type { InsurerProvider, ProviderStatus } from "../domain/provider.js";
import { guard, keyset, required } from "./db-helpers.js";
import "./schema.js";

type Db = Kysely<Database>;

const NIL_UUID = "00000000-0000-0000-0000-000000000000";

interface ProviderRow {
  id: string;
  insurer_id: string;
  clinic_id: string | null;
  name: string;
  status: ProviderStatus;
  created_at: Date;
}

const toProvider = (r: ProviderRow): InsurerProvider => ({ id: r.id, insurerId: r.insurer_id, clinicId: r.clinic_id, name: r.name, status: r.status, createdAt: r.created_at });
const PROVIDER_COLUMNS = ["id", "insurer_id", "clinic_id", "name", "status", "created_at"] as const;

export class KyselyProvidersRepository implements ProvidersRepository<Db> {
  async insert(trx: Db, record: { id: string; insurerId: string; clinicId: string; name: string; createdAt: Date }): Promise<InsurerProvider> {
    await guard(
      () => trx.insertInto("insurer_providers").values({ id: record.id, insurer_id: record.insurerId, clinic_id: record.clinicId, name: record.name, created_at: record.createdAt, updated_at: record.createdAt }).execute(),
      "A clínica já está ligada à seguradora.",
    );
    return required(await this.findById(trx, record.insurerId, record.id));
  }

  async findById(trx: Db, insurerId: string, id: string, lock = false): Promise<InsurerProvider | null> {
    let query = trx.selectFrom("insurer_providers").select(PROVIDER_COLUMNS).where("insurer_id", "=", insurerId).where("id", "=", id);
    if (lock) query = query.forUpdate();
    const row = await query.executeTakeFirst();
    return row ? toProvider(row) : null;
  }

  async list(trx: Db, insurerId: string, filter: { status?: ProviderStatus }, page: PageQuery): Promise<InsurerProvider[]> {
    let query = trx.selectFrom("insurer_providers as p").select(PROVIDER_COLUMNS.map((c) => `p.${c}` as const)).where("p.insurer_id", "=", insurerId);
    if (filter.status) query = query.where("p.status", "=", filter.status);
    return (await keyset(query, "p", page).execute()).map(toProvider);
  }

  async setStatus(trx: Db, insurerId: string, id: string, status: ProviderStatus, now: Date): Promise<InsurerProvider> {
    await trx.updateTable("insurer_providers").set({ status, updated_at: now }).where("insurer_id", "=", insurerId).where("id", "=", id).execute();
    return required(await this.findById(trx, insurerId, id));
  }

  async activeInsurerIdsOfClinic(trx: Db, clinicId: string): Promise<string[]> {
    const rows = await trx.selectFrom("insurer_providers").select("insurer_id").where("clinic_id", "=", clinicId).where("status", "=", "ACTIVE").execute();
    return rows.map((r) => r.insurer_id);
  }

  async isActivelyLinked(trx: Db, clinicId: string, insurerId: string): Promise<boolean> {
    const row = await trx.selectFrom("insurer_providers").select("id").where("clinic_id", "=", clinicId).where("insurer_id", "=", insurerId).where("status", "=", "ACTIVE").limit(1).executeTakeFirst();
    return row !== undefined;
  }
}

export class KyselyEligibilityRepository implements EligibilityRepository<Db> {
  async find(trx: Db, insurerId: string, lookup: EligibilityLookup, today: string): Promise<EligibilityCandidate | null> {
    let query = trx
      .selectFrom("insurer_beneficiaries as b")
      .select(["b.id", "b.name", "b.card_number", "b.status", "b.card_version", "b.holder_id"])
      .where("b.insurer_id", "=", insurerId);
    if (lookup.kind === "CARD") query = query.where("b.card_number", "=", lookup.cardNumber);
    else if (lookup.kind === "DOCUMENT") query = query.where("b.id_document_type", "=", lookup.type).where("b.id_document_number", "=", lookup.number);
    else query = query.where("b.id", "=", lookup.beneficiaryId);
    const b = await query.executeTakeFirst();
    // O agregado familiar de uma apólice = o titular e os beneficiários cujo `holder_id` o referencia (schema.md §3c).
    // Anti-timing (BR-SEG-18): a consulta da apólice corre SEMPRE (com um id nulo quando o beneficiário não existe), para que
    // «inexistente» e «existente» façam o mesmo trabalho na BD.
    const holderId = b ? (b.holder_id ?? b.id) : NIL_UUID;
    const policy = await trx
      .selectFrom("insurer_policies as p")
      .innerJoin("insurer_plans as pl", (join) => join.onRef("pl.insurer_id", "=", "p.insurer_id").onRef("pl.id", "=", "p.plan_id"))
      .select(["p.plan_id", "pl.name as plan_name", "p.number", "p.status", "p.valid_from", "p.valid_to"])
      .where("p.insurer_id", "=", insurerId)
      .where("p.holder_id", "=", holderId)
      .where("p.status", "=", "ACTIVE")
      .where("p.valid_from", "<=", today)
      .where("p.valid_to", ">=", today)
      .orderBy("p.valid_from", "desc")
      .orderBy("p.id")
      .executeTakeFirst();
    if (!b) return null;
    return {
      beneficiaryId: b.id,
      name: b.name,
      cardNumber: b.card_number,
      status: b.status,
      cardVersion: b.card_version,
      policy: policy ? { planId: policy.plan_id, planName: policy.plan_name, number: policy.number, status: policy.status, validFrom: policy.valid_from, validTo: policy.valid_to } : null,
    };
  }

  async coverages(trx: Db, insurerId: string, planId: string, serviceCode: string | null): Promise<(CoverageRowForEligibility & { serviceId: string })[]> {
    let query = trx
      .selectFrom("insurer_plan_coverages as c")
      .innerJoin("insurer_services as s", (join) => join.onRef("s.insurer_id", "=", "c.insurer_id").onRef("s.id", "=", "c.service_id"))
      .select(["c.service_id", "s.code", "s.name", "c.copay_pct", "c.limit_per_year", "c.waiting_days", "c.requires_authorization"])
      .where("c.insurer_id", "=", insurerId)
      .where("c.plan_id", "=", planId)
      .where("c.type", "<>", "EXCLUDED")
      .where("s.status", "=", "ACTIVE");
    if (serviceCode !== null) query = query.where("s.code", "=", serviceCode);
    const rows = await query.orderBy("s.code").execute();
    return rows.map((r) => ({
      serviceId: r.service_id,
      serviceCode: r.code,
      serviceName: r.name,
      copayPct: Number(r.copay_pct),
      limitPerYear: r.limit_per_year === null ? null : Number(r.limit_per_year),
      waitingDays: r.waiting_days,
      requiresAuthorization: r.requires_authorization,
    }));
  }

  async serviceCodeExists(trx: Db, insurerId: string, code: string): Promise<boolean> {
    const row = await trx.selectFrom("insurer_services").select("id").where("insurer_id", "=", insurerId).where("code", "=", code).where("status", "=", "ACTIVE").limit(1).executeTakeFirst();
    return row !== undefined;
  }
}

