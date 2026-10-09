// Implementação Kysely/pg das portas de `health-records` (application/ports.ts). Toda consulta
// exige `familyId`+`memberId` (conventions.md §3.4) — nunca um "findById" global.
import { sql, type Kysely } from "kysely";
import type { Database } from "../../../platform/db/index.js";
import type { Allergy } from "../domain/allergy.js";
import type { ConditionKind, MedicalCondition } from "../domain/medical-condition.js";
import type {
  AllergiesRepository,
  AllergyChanges,
  ConditionChanges,
  MedicalConditionsRepository,
  NewAllergyRecord,
  NewConditionRecord,
} from "../application/ports.js";
import "./schema.js";

function toAllergy(row: {
  id: string;
  family_id: string;
  member_id: string;
  name: string;
  notes: string | null;
  since: string | null;
  created_at: Date;
}): Allergy {
  const allergy: Allergy = {
    id: row.id,
    familyId: row.family_id,
    memberId: row.member_id,
    name: row.name,
    createdAt: row.created_at,
  };
  if (row.notes !== null) {
    allergy.notes = row.notes;
  }
  if (row.since !== null) {
    allergy.since = row.since;
  }
  return allergy;
}

function toMedicalCondition(row: {
  id: string;
  family_id: string;
  member_id: string;
  name: string;
  kind: ConditionKind;
  notes: string | null;
  since: string | null;
  until: string | null;
  created_at: Date;
}): MedicalCondition {
  const condition: MedicalCondition = {
    id: row.id,
    familyId: row.family_id,
    memberId: row.member_id,
    name: row.name,
    kind: row.kind,
    createdAt: row.created_at,
  };
  if (row.notes !== null) {
    condition.notes = row.notes;
  }
  if (row.since !== null) {
    condition.since = row.since;
  }
  if (row.until !== null) {
    condition.until = row.until;
  }
  return condition;
}

const ALLERGY_COLUMNS = ["id", "family_id", "member_id", "name", "notes", "since", "created_at"] as const;
const CONDITION_COLUMNS = ["id", "family_id", "member_id", "name", "kind", "notes", "since", "until", "created_at"] as const;

export class KyselyAllergiesRepository implements AllergiesRepository<Kysely<Database>> {
  async insert(trx: Kysely<Database>, record: NewAllergyRecord): Promise<Allergy> {
    const row = await trx
      .insertInto("allergies")
      .values({
        id: record.id,
        family_id: record.familyId,
        member_id: record.memberId,
        name: record.name,
        notes: record.notes ?? null,
        since: record.since ?? null,
        created_at: record.createdAt,
      })
      .returning(ALLERGY_COLUMNS)
      .executeTakeFirstOrThrow();
    return toAllergy(row);
  }

  async findById(trx: Kysely<Database>, familyId: string, memberId: string, allergyId: string): Promise<Allergy | null> {
    const row = await trx
      .selectFrom("allergies")
      .select(ALLERGY_COLUMNS)
      .where("family_id", "=", familyId)
      .where("member_id", "=", memberId)
      .where("id", "=", allergyId)
      .executeTakeFirst();
    return row ? toAllergy(row) : null;
  }

  async listByMember(trx: Kysely<Database>, familyId: string, memberId: string): Promise<Allergy[]> {
    const rows = await trx
      .selectFrom("allergies")
      .select(ALLERGY_COLUMNS)
      .where("family_id", "=", familyId)
      .where("member_id", "=", memberId)
      .orderBy("created_at", "asc")
      .execute();
    return rows.map(toAllergy);
  }

  async update(
    trx: Kysely<Database>,
    familyId: string,
    memberId: string,
    allergyId: string,
    changes: AllergyChanges,
  ): Promise<Allergy> {
    const row = await trx
      .updateTable("allergies")
      .set({
        ...(changes.name !== undefined ? { name: changes.name } : {}),
        ...(changes.notes !== undefined ? { notes: changes.notes } : {}),
        ...(changes.since !== undefined ? { since: changes.since } : {}),
        updated_at: sql`now()`,
      })
      .where("family_id", "=", familyId)
      .where("member_id", "=", memberId)
      .where("id", "=", allergyId)
      .returning(ALLERGY_COLUMNS)
      .executeTakeFirstOrThrow();
    return toAllergy(row);
  }

  async delete(trx: Kysely<Database>, familyId: string, memberId: string, allergyId: string): Promise<void> {
    await trx
      .deleteFrom("allergies")
      .where("family_id", "=", familyId)
      .where("member_id", "=", memberId)
      .where("id", "=", allergyId)
      .execute();
  }
}

export class KyselyMedicalConditionsRepository implements MedicalConditionsRepository<Kysely<Database>> {
  async insert(trx: Kysely<Database>, record: NewConditionRecord): Promise<MedicalCondition> {
    const row = await trx
      .insertInto("medical_conditions")
      .values({
        id: record.id,
        family_id: record.familyId,
        member_id: record.memberId,
        name: record.name,
        kind: record.kind,
        notes: record.notes ?? null,
        since: record.since ?? null,
        until: record.until ?? null,
        created_at: record.createdAt,
      })
      .returning(CONDITION_COLUMNS)
      .executeTakeFirstOrThrow();
    return toMedicalCondition(row);
  }

  async findById(trx: Kysely<Database>, familyId: string, memberId: string, conditionId: string): Promise<MedicalCondition | null> {
    const row = await trx
      .selectFrom("medical_conditions")
      .select(CONDITION_COLUMNS)
      .where("family_id", "=", familyId)
      .where("member_id", "=", memberId)
      .where("id", "=", conditionId)
      .executeTakeFirst();
    return row ? toMedicalCondition(row) : null;
  }

  async listByMember(trx: Kysely<Database>, familyId: string, memberId: string): Promise<MedicalCondition[]> {
    const rows = await trx
      .selectFrom("medical_conditions")
      .select(CONDITION_COLUMNS)
      .where("family_id", "=", familyId)
      .where("member_id", "=", memberId)
      .orderBy("created_at", "asc")
      .execute();
    return rows.map(toMedicalCondition);
  }

  async update(
    trx: Kysely<Database>,
    familyId: string,
    memberId: string,
    conditionId: string,
    changes: ConditionChanges,
  ): Promise<MedicalCondition> {
    const row = await trx
      .updateTable("medical_conditions")
      .set({
        ...(changes.name !== undefined ? { name: changes.name } : {}),
        ...(changes.kind !== undefined ? { kind: changes.kind } : {}),
        ...(changes.notes !== undefined ? { notes: changes.notes } : {}),
        ...(changes.since !== undefined ? { since: changes.since } : {}),
        ...(changes.until !== undefined ? { until: changes.until } : {}),
        updated_at: sql`now()`,
      })
      .where("family_id", "=", familyId)
      .where("member_id", "=", memberId)
      .where("id", "=", conditionId)
      .returning(CONDITION_COLUMNS)
      .executeTakeFirstOrThrow();
    return toMedicalCondition(row);
  }

  async delete(trx: Kysely<Database>, familyId: string, memberId: string, conditionId: string): Promise<void> {
    await trx
      .deleteFrom("medical_conditions")
      .where("family_id", "=", familyId)
      .where("member_id", "=", memberId)
      .where("id", "=", conditionId)
      .execute();
  }
}
