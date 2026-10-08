// Implementação Kysely/pg das portas de `families` (application/ports.ts). Toda consulta exige
// `familyId` (conventions.md §3.4) — nunca um "findById" global.
import { sql, type Kysely } from "kysely";
import type { Database } from "../../../platform/db/index.js";
import type { Family } from "../domain/family.js";
import type { Guardianship } from "../domain/guardianship.js";
import type { Invitation, InvitationStatus } from "../domain/invitation.js";
import type { FamilyMember, FamilyRole } from "../domain/member.js";
import type {
  FamiliesRepository,
  GuardianshipsRepository,
  InvitationsRepository,
  MemberChanges,
  MembersRepository,
  NewFamilyRecord,
  NewGuardianshipRecord,
  NewInvitationRecord,
  NewMemberRecord,
} from "../application/ports.js";
import "./schema.js";

function toFamily(row: { id: string; name: string; created_by: string | null; created_at: Date }): Family {
  const family: Family = { id: row.id, name: row.name, createdAt: row.created_at };
  if (row.created_by) {
    family.createdBy = row.created_by;
  }
  return family;
}

interface MemberRow {
  id: string;
  family_id: string;
  user_id: string | null;
  name: string;
  birth_date: string;
  role: FamilyRole | null;
  is_dependent: boolean;
  status: "ACTIVE" | "BLOCKED";
  scheduled_deletion_at: Date | null;
  created_at: Date;
}

function toMember(row: MemberRow): FamilyMember {
  const member: FamilyMember = {
    id: row.id,
    familyId: row.family_id,
    name: row.name,
    birthDate: row.birth_date,
    isDependent: row.is_dependent,
    status: row.status,
    createdAt: row.created_at,
  };
  if (row.user_id) {
    member.userId = row.user_id;
  }
  if (row.role) {
    member.role = row.role;
  }
  if (row.scheduled_deletion_at) {
    member.scheduledDeletionAt = row.scheduled_deletion_at;
  }
  return member;
}

function toGuardianship(row: {
  family_id: string;
  dependent_id: string;
  guardian_id: string;
  is_primary: boolean;
  created_at: Date;
}): Guardianship {
  return {
    familyId: row.family_id,
    dependentId: row.dependent_id,
    guardianId: row.guardian_id,
    isPrimary: row.is_primary,
    createdAt: row.created_at,
  };
}

function toInvitation(row: {
  id: string;
  family_id: string;
  email: string;
  type: Invitation["type"];
  member_id: string | null;
  token_hash: string;
  status: InvitationStatus;
  expires_at: Date;
  invited_by: string | null;
  accepted_by: string | null;
  accepted_at: Date | null;
  created_at: Date;
}): Invitation {
  const invitation: Invitation = {
    id: row.id,
    familyId: row.family_id,
    email: row.email,
    type: row.type,
    tokenHash: row.token_hash,
    status: row.status,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
  if (row.member_id) {
    invitation.memberId = row.member_id;
  }
  if (row.invited_by) {
    invitation.invitedBy = row.invited_by;
  }
  if (row.accepted_by) {
    invitation.acceptedBy = row.accepted_by;
  }
  if (row.accepted_at) {
    invitation.acceptedAt = row.accepted_at;
  }
  return invitation;
}

const FAMILY_COLUMNS = ["id", "name", "created_by", "created_at"] as const;
const MEMBER_COLUMNS = [
  "id",
  "family_id",
  "user_id",
  "name",
  "birth_date",
  "role",
  "is_dependent",
  "status",
  "scheduled_deletion_at",
  "created_at",
] as const;
const GUARDIANSHIP_COLUMNS = ["family_id", "dependent_id", "guardian_id", "is_primary", "created_at"] as const;
const INVITATION_COLUMNS = [
  "id",
  "family_id",
  "email",
  "type",
  "member_id",
  "token_hash",
  "status",
  "expires_at",
  "invited_by",
  "accepted_by",
  "accepted_at",
  "created_at",
] as const;

export class KyselyFamiliesRepository implements FamiliesRepository<Kysely<Database>> {
  async insert(trx: Kysely<Database>, record: NewFamilyRecord): Promise<Family> {
    const row = await trx
      .insertInto("families")
      .values({ id: record.id, name: record.name, created_by: record.createdBy, created_at: record.createdAt })
      .returning(FAMILY_COLUMNS)
      .executeTakeFirstOrThrow();
    return toFamily(row);
  }

  async findById(trx: Kysely<Database>, familyId: string): Promise<Family | null> {
    const row = await trx.selectFrom("families").select(FAMILY_COLUMNS).where("id", "=", familyId).executeTakeFirst();
    return row ? toFamily(row) : null;
  }

  async listForUser(trx: Kysely<Database>, userId: string): Promise<Family[]> {
    const rows = await trx
      .selectFrom("families")
      .innerJoin("family_members", "family_members.family_id", "families.id")
      .select(FAMILY_COLUMNS.map((c) => `families.${c}` as const))
      .where("family_members.user_id", "=", userId)
      .where("family_members.role", "is not", null)
      .execute();
    return rows.map(toFamily);
  }

  async countForUser(trx: Kysely<Database>, userId: string): Promise<number> {
    const row = await trx
      .selectFrom("families")
      .innerJoin("family_members", "family_members.family_id", "families.id")
      .select(({ fn }) => fn.countAll().as("count"))
      .where("family_members.user_id", "=", userId)
      .where("family_members.role", "is not", null)
      .executeTakeFirstOrThrow();
    return Number(row.count);
  }

  async updateName(trx: Kysely<Database>, familyId: string, name: string): Promise<Family> {
    const row = await trx
      .updateTable("families")
      .set({ name, updated_at: sql`now()` })
      .where("id", "=", familyId)
      .returning(FAMILY_COLUMNS)
      .executeTakeFirstOrThrow();
    return toFamily(row);
  }

  async delete(trx: Kysely<Database>, familyId: string): Promise<void> {
    await trx.deleteFrom("families").where("id", "=", familyId).execute();
  }
}

export class KyselyMembersRepository implements MembersRepository<Kysely<Database>> {
  async insert(trx: Kysely<Database>, record: NewMemberRecord): Promise<FamilyMember> {
    const row = await trx
      .insertInto("family_members")
      .values({
        id: record.id,
        family_id: record.familyId,
        user_id: record.userId ?? null,
        name: record.name,
        birth_date: record.birthDate,
        role: record.role ?? null,
        is_dependent: record.isDependent,
        created_at: record.createdAt,
      })
      .returning(MEMBER_COLUMNS)
      .executeTakeFirstOrThrow();
    return toMember(row);
  }

  async findById(trx: Kysely<Database>, familyId: string, memberId: string): Promise<FamilyMember | null> {
    const row = await trx
      .selectFrom("family_members")
      .select(MEMBER_COLUMNS)
      .where("family_id", "=", familyId)
      .where("id", "=", memberId)
      .executeTakeFirst();
    return row ? toMember(row) : null;
  }

  async findByUserId(trx: Kysely<Database>, familyId: string, userId: string): Promise<FamilyMember | null> {
    const row = await trx
      .selectFrom("family_members")
      .select(MEMBER_COLUMNS)
      .where("family_id", "=", familyId)
      .where("user_id", "=", userId)
      .executeTakeFirst();
    return row ? toMember(row) : null;
  }

  async listFamilyIdsForUser(
    trx: Kysely<Database>,
    userId: string,
  ): Promise<{ familyId: string; role: FamilyRole }[]> {
    const rows = await trx
      .selectFrom("family_members")
      .select(["family_id", "role"])
      .where("user_id", "=", userId)
      .where("role", "is not", null)
      .execute();
    return rows
      .filter((r): r is { family_id: string; role: FamilyRole } => r.role !== null)
      .map((r) => ({ familyId: r.family_id, role: r.role }));
  }

  async listByFamily(trx: Kysely<Database>, familyId: string): Promise<FamilyMember[]> {
    const rows = await trx
      .selectFrom("family_members")
      .select(MEMBER_COLUMNS)
      .where("family_id", "=", familyId)
      .execute();
    return rows.map(toMember);
  }

  async countByFamily(trx: Kysely<Database>, familyId: string): Promise<number> {
    const row = await trx
      .selectFrom("family_members")
      .select(({ fn }) => fn.countAll().as("count"))
      .where("family_id", "=", familyId)
      .executeTakeFirstOrThrow();
    return Number(row.count);
  }

  async countActiveAdmins(trx: Kysely<Database>, familyId: string): Promise<number> {
    const row = await trx
      .selectFrom("family_members")
      .select(({ fn }) => fn.countAll().as("count"))
      .where("family_id", "=", familyId)
      .where("role", "=", "FAMILY_ADMIN")
      .where("status", "=", "ACTIVE")
      .executeTakeFirstOrThrow();
    return Number(row.count);
  }

  async update(trx: Kysely<Database>, familyId: string, memberId: string, changes: MemberChanges): Promise<FamilyMember> {
    const row = await trx
      .updateTable("family_members")
      .set({
        ...(changes.name !== undefined ? { name: changes.name } : {}),
        ...(changes.birthDate !== undefined ? { birth_date: changes.birthDate } : {}),
        ...(changes.isDependent !== undefined ? { is_dependent: changes.isDependent } : {}),
        ...(changes.userId !== undefined ? { user_id: changes.userId } : {}),
        ...(changes.role !== undefined ? { role: changes.role } : {}),
        updated_at: sql`now()`,
      })
      .where("family_id", "=", familyId)
      .where("id", "=", memberId)
      .returning(MEMBER_COLUMNS)
      .executeTakeFirstOrThrow();
    return toMember(row);
  }

  async delete(trx: Kysely<Database>, familyId: string, memberId: string): Promise<void> {
    await trx.deleteFrom("family_members").where("family_id", "=", familyId).where("id", "=", memberId).execute();
  }
}

export class KyselyGuardianshipsRepository implements GuardianshipsRepository<Kysely<Database>> {
  async insert(trx: Kysely<Database>, record: NewGuardianshipRecord): Promise<Guardianship> {
    const row = await trx
      .insertInto("guardianships")
      .values({
        family_id: record.familyId,
        dependent_id: record.dependentId,
        guardian_id: record.guardianId,
        is_primary: record.isPrimary,
        created_at: record.createdAt,
      })
      .returning(GUARDIANSHIP_COLUMNS)
      .executeTakeFirstOrThrow();
    return toGuardianship(row);
  }

  async find(trx: Kysely<Database>, familyId: string, dependentId: string, guardianId: string): Promise<Guardianship | null> {
    const row = await trx
      .selectFrom("guardianships")
      .select(GUARDIANSHIP_COLUMNS)
      .where("family_id", "=", familyId)
      .where("dependent_id", "=", dependentId)
      .where("guardian_id", "=", guardianId)
      .executeTakeFirst();
    return row ? toGuardianship(row) : null;
  }

  async listByDependent(trx: Kysely<Database>, familyId: string, dependentId: string): Promise<Guardianship[]> {
    const rows = await trx
      .selectFrom("guardianships")
      .select(GUARDIANSHIP_COLUMNS)
      .where("family_id", "=", familyId)
      .where("dependent_id", "=", dependentId)
      .execute();
    return rows.map(toGuardianship);
  }

  async listByGuardian(trx: Kysely<Database>, familyId: string, guardianId: string): Promise<Guardianship[]> {
    const rows = await trx
      .selectFrom("guardianships")
      .select(GUARDIANSHIP_COLUMNS)
      .where("family_id", "=", familyId)
      .where("guardian_id", "=", guardianId)
      .execute();
    return rows.map(toGuardianship);
  }

  async delete(trx: Kysely<Database>, familyId: string, dependentId: string, guardianId: string): Promise<void> {
    await trx
      .deleteFrom("guardianships")
      .where("family_id", "=", familyId)
      .where("dependent_id", "=", dependentId)
      .where("guardian_id", "=", guardianId)
      .execute();
  }

  async deleteAllForDependent(trx: Kysely<Database>, familyId: string, dependentId: string): Promise<void> {
    await trx.deleteFrom("guardianships").where("family_id", "=", familyId).where("dependent_id", "=", dependentId).execute();
  }

  async setPrimary(trx: Kysely<Database>, familyId: string, dependentId: string, guardianId: string): Promise<void> {
    // O índice único parcial `guardianships_primary_guardian_idx` (0003_families.sql) exige
    // desligar o anterior antes de ligar o novo na mesma transação.
    await trx
      .updateTable("guardianships")
      .set({ is_primary: false, updated_at: sql`now()` })
      .where("family_id", "=", familyId)
      .where("dependent_id", "=", dependentId)
      .where("guardian_id", "!=", guardianId)
      .execute();
    await trx
      .updateTable("guardianships")
      .set({ is_primary: true, updated_at: sql`now()` })
      .where("family_id", "=", familyId)
      .where("dependent_id", "=", dependentId)
      .where("guardian_id", "=", guardianId)
      .execute();
  }
}

export class KyselyInvitationsRepository implements InvitationsRepository<Kysely<Database>> {
  async insert(trx: Kysely<Database>, record: NewInvitationRecord): Promise<Invitation> {
    const row = await trx
      .insertInto("invitations")
      .values({
        id: record.id,
        family_id: record.familyId,
        email: record.email,
        type: record.type,
        member_id: record.memberId ?? null,
        token_hash: record.tokenHash,
        expires_at: record.expiresAt,
        invited_by: record.invitedBy,
        created_at: record.createdAt,
      })
      .returning(INVITATION_COLUMNS)
      .executeTakeFirstOrThrow();
    return toInvitation(row);
  }

  async findById(trx: Kysely<Database>, familyId: string, invitationId: string): Promise<Invitation | null> {
    const row = await trx
      .selectFrom("invitations")
      .select(INVITATION_COLUMNS)
      .where("family_id", "=", familyId)
      .where("id", "=", invitationId)
      .executeTakeFirst();
    return row ? toInvitation(row) : null;
  }

  async findByTokenHash(trx: Kysely<Database>, tokenHash: string): Promise<Invitation | null> {
    const row = await trx
      .selectFrom("invitations")
      .select(INVITATION_COLUMNS)
      .where("token_hash", "=", tokenHash)
      .executeTakeFirst();
    return row ? toInvitation(row) : null;
  }

  async listByFamily(trx: Kysely<Database>, familyId: string): Promise<Invitation[]> {
    const rows = await trx
      .selectFrom("invitations")
      .select(INVITATION_COLUMNS)
      .where("family_id", "=", familyId)
      .execute();
    return rows.map(toInvitation);
  }

  async countPending(trx: Kysely<Database>, familyId: string): Promise<number> {
    const row = await trx
      .selectFrom("invitations")
      .select(({ fn }) => fn.countAll().as("count"))
      .where("family_id", "=", familyId)
      .where("status", "=", "PENDING")
      .executeTakeFirstOrThrow();
    return Number(row.count);
  }

  async updateStatus(trx: Kysely<Database>, id: string, status: InvitationStatus): Promise<void> {
    await trx.updateTable("invitations").set({ status, updated_at: sql`now()` }).where("id", "=", id).execute();
  }

  async markAccepted(trx: Kysely<Database>, id: string, acceptedBy: string, acceptedAt: Date): Promise<void> {
    await trx
      .updateTable("invitations")
      .set({ status: "ACCEPTED", accepted_by: acceptedBy, accepted_at: acceptedAt, updated_at: sql`now()` })
      .where("id", "=", id)
      .execute();
  }
}
