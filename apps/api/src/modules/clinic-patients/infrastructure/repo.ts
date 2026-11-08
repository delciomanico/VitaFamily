// Implementação Kysely/pg das portas de `clinic-patients` (application/ports.ts, schema.md §3d). Toda consulta de
// pacientes/visitas exige `clinicId` (isolamento). Violações de UNIQUE (ligação, horário) traduzem-se em `ConflictError`.
import { sql, type Kysely } from "kysely";
import { ConflictError } from "../../../platform/errors/index.js";
import type { Database } from "../../../platform/db/index.js";
import type { ClinicPatient } from "../domain/clinic-patient.js";
import type { ClinicConsent } from "../domain/consent.js";
import type { ClinicVisit } from "../domain/clinic-visit.js";
import type {
  ClinicPatientLink,
  ConsentWrite,
  ConsentsRepository,
  LinkCodeRecord,
  LinkCodesRepository,
  LinksRepository,
  NewPatientRecord,
  NewVisitRecord,
  PatientChanges,
  PatientListFilter,
  PatientsRepository,
  VisitDayFlowChange,
  VisitListFilter,
  VisitsRepository,
} from "../application/ports.js";
import "./schema.js";

const PG_UNIQUE_VIOLATION = "23505";

async function mapUnique<T>(action: () => Promise<T>, detail: string): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (typeof error === "object" && error !== null && (error as { code?: string }).code === PG_UNIQUE_VIOLATION) {
      throw new ConflictError({ detail });
    }
    throw error;
  }
}

interface PatientRow {
  id: string;
  clinic_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  birth_date: string | null;
  notes: string | null;
  origin: "MANUAL" | "VITA";
  created_at: Date;
  updated_at: Date;
}

function toPatient(row: PatientRow): ClinicPatient {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    name: row.name,
    origin: row.origin,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.phone !== null ? { phone: row.phone } : {}),
    ...(row.email !== null ? { email: row.email } : {}),
    ...(row.birth_date !== null ? { birthDate: row.birth_date } : {}),
    ...(row.notes !== null ? { notes: row.notes } : {}),
  };
}

const PATIENT_COLUMNS = ["id", "clinic_id", "name", "phone", "email", "notes", "origin", "created_at", "updated_at"] as const;
/** `date` -> texto AAAA-MM-DD (o `pg` devolveria `Date` no fuso do servidor). */
const BIRTH_DATE = sql<string | null>`to_char(birth_date, 'YYYY-MM-DD')`.as("birth_date");

export class KyselyPatientsRepository implements PatientsRepository<Kysely<Database>> {
  /** BR-CLN-29 `newPatients`: registos criados em `[from, to)`. Índice `(clinic_id, ...)`; contagem, nunca dados. */
  async countCreatedBetween(trx: Kysely<Database>, clinicId: string, from: Date, to: Date): Promise<number> {
    const row = await trx
      .selectFrom("clinic_patients")
      .select(sql<string>`count(*)`.as("total"))
      .where("clinic_id", "=", clinicId)
      .where("created_at", ">=", from)
      .where("created_at", "<", to)
      .executeTakeFirstOrThrow();
    return Number(row.total);
  }

  async insert(trx: Kysely<Database>, record: NewPatientRecord): Promise<ClinicPatient> {
    const row = await trx
      .insertInto("clinic_patients")
      .values({
        id: record.id,
        clinic_id: record.clinicId,
        name: record.name,
        name_norm: record.nameNorm,
        phone: record.phone,
        phone_digits: record.phoneDigits,
        email: record.email,
        birth_date: record.birthDate,
        notes: record.notes,
        origin: record.origin,
        created_by_clinic_account_id: record.createdByClinicAccountId,
        created_at: record.createdAt,
        updated_at: record.createdAt,
      })
      .returning([...PATIENT_COLUMNS, BIRTH_DATE])
      .executeTakeFirstOrThrow();
    return toPatient(row);
  }

  async findById(trx: Kysely<Database>, clinicId: string, patientId: string): Promise<ClinicPatient | null> {
    const row = await trx.selectFrom("clinic_patients").select([...PATIENT_COLUMNS, BIRTH_DATE]).where("clinic_id", "=", clinicId).where("id", "=", patientId).executeTakeFirst();
    return row ? toPatient(row) : null;
  }

  async findManyByIds(trx: Kysely<Database>, clinicId: string, patientIds: string[]): Promise<ClinicPatient[]> {
    if (patientIds.length === 0) return [];
    const rows = await trx.selectFrom("clinic_patients").select([...PATIENT_COLUMNS, BIRTH_DATE]).where("clinic_id", "=", clinicId).where("id", "in", patientIds).execute();
    return rows.map(toPatient);
  }

  async update(trx: Kysely<Database>, clinicId: string, patientId: string, changes: PatientChanges, now: Date): Promise<ClinicPatient> {
    const row = await trx
      .updateTable("clinic_patients")
      .set({
        ...(changes.name !== undefined ? { name: changes.name } : {}),
        ...(changes.nameNorm !== undefined ? { name_norm: changes.nameNorm } : {}),
        ...(changes.phone !== undefined ? { phone: changes.phone } : {}),
        ...(changes.phoneDigits !== undefined ? { phone_digits: changes.phoneDigits } : {}),
        ...(changes.email !== undefined ? { email: changes.email } : {}),
        ...(changes.birthDate !== undefined ? { birth_date: changes.birthDate } : {}),
        ...(changes.notes !== undefined ? { notes: changes.notes } : {}),
        updated_at: now,
      })
      .where("clinic_id", "=", clinicId)
      .where("id", "=", patientId)
      .returning([...PATIENT_COLUMNS, BIRTH_DATE])
      .executeTakeFirstOrThrow();
    return toPatient(row);
  }

  /** Varrimento "contém" dentro da clínica (`strpos`: sem escapes de `%`/`_`); ordem estável `(name_norm, id)`. */
  async list(trx: Kysely<Database>, clinicId: string, filter: PatientListFilter, limit: number): Promise<ClinicPatient[]> {
    let query = trx.selectFrom("clinic_patients").select([...PATIENT_COLUMNS, BIRTH_DATE]).where("clinic_id", "=", clinicId);
    const terms = filter.terms;
    if (terms) {
      query = query.where((eb) => {
        const conditions = [eb(sql<number>`strpos(name_norm, ${terms.name})`, ">", 0), eb(sql<number>`strpos(email, ${terms.email})`, ">", 0)];
        if (terms.phoneDigits) {
          conditions.push(eb(sql<number>`strpos(phone_digits, ${terms.phoneDigits})`, ">", 0));
        }
        return eb.or(conditions);
      });
    }
    if (filter.after) {
      const { n, i } = filter.after;
      query = query.where((eb) => eb.or([eb("name_norm", ">", n), eb.and([eb("name_norm", "=", n), eb("id", ">", i)])]));
    }
    const rows = await query.orderBy("name_norm", "asc").orderBy("id", "asc").limit(limit).execute();
    return rows.map(toPatient);
  }
}

export class KyselyLinksRepository implements LinksRepository<Kysely<Database>> {
  async insert(trx: Kysely<Database>, link: ClinicPatientLink): Promise<void> {
    await mapUnique(
      () =>
        trx
          .insertInto("clinic_patient_links")
          .values({ clinic_id: link.clinicId, clinic_patient_id: link.clinicPatientId, family_id: link.familyId, member_id: link.memberId, via: link.via })
          .execute(),
      "Já existe uma ligação para este paciente ou membro.",
    );
  }

  private toLink(row: { clinic_id: string; clinic_patient_id: string; family_id: string; member_id: string; via: "EMAIL" | "CODE" }): ClinicPatientLink {
    return { clinicId: row.clinic_id, clinicPatientId: row.clinic_patient_id, familyId: row.family_id, memberId: row.member_id, via: row.via };
  }

  async findByPatient(trx: Kysely<Database>, clinicId: string, patientId: string): Promise<ClinicPatientLink | null> {
    const row = await trx.selectFrom("clinic_patient_links").selectAll().where("clinic_id", "=", clinicId).where("clinic_patient_id", "=", patientId).executeTakeFirst();
    return row ? this.toLink(row) : null;
  }

  async findByMember(trx: Kysely<Database>, clinicId: string, memberId: string): Promise<ClinicPatientLink | null> {
    const row = await trx.selectFrom("clinic_patient_links").selectAll().where("clinic_id", "=", clinicId).where("member_id", "=", memberId).executeTakeFirst();
    return row ? this.toLink(row) : null;
  }

  async findByPatients(trx: Kysely<Database>, clinicId: string, patientIds: string[]): Promise<ClinicPatientLink[]> {
    if (patientIds.length === 0) return [];
    const rows = await trx.selectFrom("clinic_patient_links").selectAll().where("clinic_id", "=", clinicId).where("clinic_patient_id", "in", patientIds).execute();
    return rows.map((row) => this.toLink(row));
  }

  async findByMembers(trx: Kysely<Database>, clinicId: string, memberIds: string[]): Promise<ClinicPatientLink[]> {
    if (memberIds.length === 0) return [];
    const rows = await trx.selectFrom("clinic_patient_links").selectAll().where("clinic_id", "=", clinicId).where("member_id", "in", memberIds).execute();
    return rows.map((row) => this.toLink(row));
  }

  async listByMember(trx: Kysely<Database>, familyId: string, memberId: string): Promise<ClinicPatientLink[]> {
    const rows = await trx.selectFrom("clinic_patient_links").selectAll().where("family_id", "=", familyId).where("member_id", "=", memberId).execute();
    return rows.map((row) => this.toLink(row));
  }

  async deleteByMember(trx: Kysely<Database>, clinicId: string, memberId: string): Promise<boolean> {
    const result = await trx.deleteFrom("clinic_patient_links").where("clinic_id", "=", clinicId).where("member_id", "=", memberId).executeTakeFirst();
    return result.numDeletedRows > 0n;
  }
}

export class KyselyConsentsRepository implements ConsentsRepository<Kysely<Database>> {
  private toConsent(row: { clinic_id: string; family_id: string; member_id: string; level: "BOOKINGS" | "HISTORY"; history_valid_until: Date | null }): ClinicConsent {
    return {
      clinicId: row.clinic_id,
      familyId: row.family_id,
      memberId: row.member_id,
      level: row.level,
      ...(row.history_valid_until ? { historyValidUntil: row.history_valid_until } : {}),
    };
  }

  async find(trx: Kysely<Database>, clinicId: string, memberId: string): Promise<ClinicConsent | null> {
    const row = await trx.selectFrom("clinic_consents").selectAll().where("clinic_id", "=", clinicId).where("member_id", "=", memberId).executeTakeFirst();
    return row ? this.toConsent(row) : null;
  }

  async findMany(trx: Kysely<Database>, clinicId: string, memberIds: string[]): Promise<ClinicConsent[]> {
    if (memberIds.length === 0) return [];
    const rows = await trx.selectFrom("clinic_consents").selectAll().where("clinic_id", "=", clinicId).where("member_id", "in", memberIds).execute();
    return rows.map((row) => this.toConsent(row));
  }

  async listByMember(trx: Kysely<Database>, familyId: string, memberId: string): Promise<ClinicConsent[]> {
    const rows = await trx.selectFrom("clinic_consents").selectAll().where("family_id", "=", familyId).where("member_id", "=", memberId).execute();
    return rows.map((row) => this.toConsent(row));
  }

  async upsert(trx: Kysely<Database>, write: ConsentWrite): Promise<void> {
    await trx
      .insertInto("clinic_consents")
      .values({
        clinic_id: write.clinicId,
        family_id: write.familyId,
        member_id: write.memberId,
        level: write.level,
        history_valid_until: write.historyValidUntil,
        granted_by_user_id: write.grantedByUserId,
        created_at: write.now,
        updated_at: write.now,
      })
      .onConflict((oc) =>
        oc.columns(["clinic_id", "member_id"]).doUpdateSet({ level: write.level, history_valid_until: write.historyValidUntil, granted_by_user_id: write.grantedByUserId, updated_at: write.now }),
      )
      .execute();
  }

  async insertBookingsIfMissing(trx: Kysely<Database>, clinicId: string, familyId: string, memberId: string, now: Date): Promise<boolean> {
    const result = await trx
      .insertInto("clinic_consents")
      .values({ clinic_id: clinicId, family_id: familyId, member_id: memberId, level: "BOOKINGS", history_valid_until: null, granted_by_user_id: null, created_at: now, updated_at: now })
      .onConflict((oc) => oc.columns(["clinic_id", "member_id"]).doNothing())
      .executeTakeFirst();
    return result.numInsertedOrUpdatedRows !== undefined && result.numInsertedOrUpdatedRows > 0n;
  }

  async delete(trx: Kysely<Database>, clinicId: string, memberId: string): Promise<boolean> {
    const result = await trx.deleteFrom("clinic_consents").where("clinic_id", "=", clinicId).where("member_id", "=", memberId).executeTakeFirst();
    return result.numDeletedRows > 0n;
  }
}

export class KyselyLinkCodesRepository implements LinkCodesRepository<Kysely<Database>> {
  async invalidateActive(trx: Kysely<Database>, memberId: string, now: Date): Promise<void> {
    await trx.updateTable("clinic_link_codes").set({ used_at: now }).where("member_id", "=", memberId).where("used_at", "is", null).execute();
  }

  async insert(trx: Kysely<Database>, record: LinkCodeRecord): Promise<void> {
    await trx
      .insertInto("clinic_link_codes")
      .values({ id: record.id, family_id: record.familyId, member_id: record.memberId, code_hash: record.codeHash, expires_at: record.expiresAt, created_by_user_id: record.createdByUserId, created_at: record.createdAt })
      .execute();
  }

  async listCreatedSince(trx: Kysely<Database>, memberId: string, since: Date): Promise<Date[]> {
    const rows = await trx.selectFrom("clinic_link_codes").select("created_at").where("member_id", "=", memberId).where("created_at", ">", since).orderBy("created_at", "asc").execute();
    return rows.map((row) => row.created_at);
  }

  async consume(trx: Kysely<Database>, codeHash: string, now: Date): Promise<{ familyId: string; memberId: string } | null> {
    const row = await trx
      .updateTable("clinic_link_codes")
      .set({ used_at: now })
      .where("code_hash", "=", codeHash)
      .where("used_at", "is", null)
      .where("expires_at", ">", now)
      .returning(["family_id", "member_id"])
      .executeTakeFirst();
    return row ? { familyId: row.family_id, memberId: row.member_id } : null;
  }

  async purge(trx: Kysely<Database>, olderThan: Date): Promise<number> {
    const result = await trx
      .deleteFrom("clinic_link_codes")
      .where((eb) => eb.or([eb("expires_at", "<", olderThan), eb("used_at", "<", olderThan)]))
      .executeTakeFirst();
    return Number(result.numDeletedRows);
  }
}

interface VisitRow {
  id: string;
  clinic_id: string;
  clinic_patient_id: string;
  slot_id: string | null;
  scheduled_at: Date;
  duration_minutes: number;
  status: "SCHEDULED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
  notes: string | null;
  outcome_note: string | null;
  cancel_note: string | null;
  booked_by_clinic_account_id: string | null;
  confirmation_status: "PENDING" | "CONFIRMED";
  confirmed_at: Date | null;
  arrived_at: Date | null;
  started_at: Date | null;
  followup_due_on: string | null;
  created_at: Date;
}

const VISIT_COLUMNS = [
  "id",
  "clinic_id",
  "clinic_patient_id",
  "slot_id",
  "scheduled_at",
  "duration_minutes",
  "status",
  "notes",
  "outcome_note",
  "cancel_note",
  "booked_by_clinic_account_id",
  "confirmation_status",
  "confirmed_at",
  "arrived_at",
  "started_at",
  "created_at",
] as const;
/** `date` como texto AAAA-MM-DD (sem conversão de fuso do driver). */
const VISIT_FOLLOWUP = sql<string | null>`to_char(followup_due_on, 'YYYY-MM-DD')`.as("followup_due_on");
const VISIT_SELECT = [...VISIT_COLUMNS, VISIT_FOLLOWUP] as const;

function toVisit(row: VisitRow): ClinicVisit {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    clinicPatientId: row.clinic_patient_id,
    scheduledAt: row.scheduled_at,
    durationMinutes: row.duration_minutes,
    status: row.status,
    confirmationStatus: row.confirmation_status,
    createdAt: row.created_at,
    ...(row.confirmed_at !== null ? { confirmedAt: row.confirmed_at } : {}),
    ...(row.arrived_at !== null ? { arrivedAt: row.arrived_at } : {}),
    ...(row.started_at !== null ? { startedAt: row.started_at } : {}),
    ...(row.followup_due_on !== null ? { followUpDueOn: row.followup_due_on } : {}),
    ...(row.slot_id !== null ? { slotId: row.slot_id } : {}),
    ...(row.notes !== null ? { notes: row.notes } : {}),
    ...(row.outcome_note !== null ? { outcomeNote: row.outcome_note } : {}),
    ...(row.cancel_note !== null ? { cancelNote: row.cancel_note } : {}),
    ...(row.booked_by_clinic_account_id !== null ? { bookedByClinicAccountId: row.booked_by_clinic_account_id } : {}),
  };
}

export class KyselyVisitsRepository implements VisitsRepository<Kysely<Database>> {
  async insert(trx: Kysely<Database>, record: NewVisitRecord): Promise<ClinicVisit> {
    const row = await mapUnique(
      () =>
        trx
          .insertInto("clinic_visits")
          .values({
            id: record.id,
            clinic_id: record.clinicId,
            clinic_patient_id: record.clinicPatientId,
            slot_id: record.slotId,
            scheduled_at: record.scheduledAt,
            duration_minutes: record.durationMinutes,
            notes: record.notes,
            booked_by_clinic_account_id: record.bookedByClinicAccountId,
            created_at: record.createdAt,
            updated_at: record.createdAt,
          })
          .returning(VISIT_SELECT)
          .executeTakeFirstOrThrow(),
      "Esse horário já tem uma marcação ativa.",
    );
    return toVisit(row);
  }

  async findById(trx: Kysely<Database>, clinicId: string, visitId: string): Promise<ClinicVisit | null> {
    const row = await trx.selectFrom("clinic_visits").select(VISIT_SELECT).where("clinic_id", "=", clinicId).where("id", "=", visitId).executeTakeFirst();
    return row ? toVisit(row) : null;
  }

  async list(trx: Kysely<Database>, clinicId: string, filter: VisitListFilter, limit?: number): Promise<ClinicVisit[]> {
    let query = trx.selectFrom("clinic_visits").select(VISIT_SELECT).where("clinic_id", "=", clinicId);
    if (filter.statuses) query = query.where("status", "in", filter.statuses);
    if (filter.from) query = query.where("scheduled_at", ">=", filter.from);
    if (filter.to) query = query.where("scheduled_at", "<", filter.to);
    if (filter.clinicPatientId) query = query.where("clinic_patient_id", "=", filter.clinicPatientId);
    // Com limite (ficha/pesquisa): as mais recentes; sem limite (agenda/calendário): cronológica.
    const ordered = limit === undefined ? query.orderBy("scheduled_at", "asc").orderBy("id", "asc") : query.orderBy("scheduled_at", "desc").orderBy("id", "desc").limit(limit);
    return (await ordered.execute()).map(toVisit);
  }

  async countScheduledBySlot(trx: Kysely<Database>, slotIds: string[]): Promise<{ slotId: string; count: number }[]> {
    if (slotIds.length === 0) return [];
    const rows = await trx
      .selectFrom("clinic_visits")
      .select(["slot_id", sql<string>`count(*)`.as("total")])
      .where("slot_id", "in", slotIds)
      .where("status", "=", "SCHEDULED")
      .groupBy("slot_id")
      .execute();
    return rows.flatMap((row) => (row.slot_id === null ? [] : [{ slotId: row.slot_id, count: Number(row.total) }]));
  }

  async findScheduledOverlapping(trx: Kysely<Database>, clinicPatientId: string, from: Date, to: Date): Promise<ClinicVisit[]> {
    const rows = await trx
      .selectFrom("clinic_visits")
      .select(VISIT_SELECT)
      .where("clinic_patient_id", "=", clinicPatientId)
      .where("status", "=", "SCHEDULED")
      .where("scheduled_at", "<", to)
      .where(sql<boolean>`scheduled_at + duration_minutes * interval '1 minute' > ${from}`)
      .execute();
    return rows.map(toVisit);
  }

  async setStatus(trx: Kysely<Database>, clinicId: string, visitId: string, change: { status: ClinicVisit["status"]; outcomeNote?: string | null; cancelNote?: string | null }, now: Date): Promise<ClinicVisit> {
    const row = await trx
      .updateTable("clinic_visits")
      .set({
        status: change.status,
        // BR-CLN-30: o retorno só existe em `COMPLETED`.
        ...(change.status !== "COMPLETED" ? { followup_due_on: null } : {}),
        ...(change.outcomeNote !== undefined ? { outcome_note: change.outcomeNote } : {}),
        ...(change.cancelNote !== undefined ? { cancel_note: change.cancelNote } : {}),
        updated_at: now,
      })
      .where("clinic_id", "=", clinicId)
      .where("id", "=", visitId)
      .returning(VISIT_SELECT)
      .executeTakeFirstOrThrow();
    return toVisit(row);
  }

  async applyConfirmation(trx: Kysely<Database>, clinicId: string, visitId: string, confirmedAt: Date): Promise<ClinicVisit> {
    const row = await trx
      .updateTable("clinic_visits")
      .set({ confirmation_status: "CONFIRMED", confirmation_source: "CLINIC", confirmed_at: confirmedAt, updated_at: confirmedAt })
      .where("clinic_id", "=", clinicId)
      .where("id", "=", visitId)
      .returning(VISIT_SELECT)
      .executeTakeFirstOrThrow();
    return toVisit(row);
  }

  async applyDayFlow(trx: Kysely<Database>, clinicId: string, visitId: string, change: VisitDayFlowChange, now: Date): Promise<ClinicVisit> {
    const row = await mapUnique(
      () =>
        trx
          .updateTable("clinic_visits")
          .set({
            ...(change.status !== undefined ? { status: change.status } : {}),
            ...(change.arrivedAt !== undefined ? { arrived_at: change.arrivedAt } : {}),
            ...(change.startedAt !== undefined ? { started_at: change.startedAt } : {}),
            updated_at: now,
          })
          .where("clinic_id", "=", clinicId)
          .where("id", "=", visitId)
          .returning(VISIT_SELECT)
          .executeTakeFirstOrThrow(),
      "Esse horário já tem uma marcação ativa.",
    );
    return toVisit(row);
  }

  async setFollowUp(trx: Kysely<Database>, clinicId: string, visitId: string, dueOn: string | null, now: Date): Promise<ClinicVisit> {
    const row = await trx
      .updateTable("clinic_visits")
      .set({ followup_due_on: dueOn, updated_at: now })
      .where("clinic_id", "=", clinicId)
      .where("id", "=", visitId)
      .returning(VISIT_SELECT)
      .executeTakeFirstOrThrow();
    return toVisit(row);
  }

  async listFollowUps(trx: Kysely<Database>, clinicId: string, until: string, limit: number): Promise<ClinicVisit[]> {
    const rows = await trx
      .selectFrom("clinic_visits")
      .select(VISIT_SELECT)
      .where("clinic_id", "=", clinicId)
      .where("status", "=", "COMPLETED")
      .where(sql<boolean>`followup_due_on is not null and followup_due_on <= ${until}::date`)
      .orderBy("followup_due_on", "asc")
      .orderBy("id", "asc")
      .limit(limit)
      .execute();
    return rows.map(toVisit);
  }
}
