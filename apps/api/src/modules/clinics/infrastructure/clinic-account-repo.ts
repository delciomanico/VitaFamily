// Implementações Kysely/pg das portas `ClinicAccountRepository` e `ClinicSessionRepository`
// (application/ports.ts).
import { sql, type Kysely } from "kysely";
import type { Database } from "../../../platform/db/index.js";
import type {
  ClinicAccountCredentialsReset,
  ClinicAccountRepository,
  ClinicSessionRepository,
  NewClinicAccountRecord,
  NewClinicSessionRecord,
} from "../application/ports.js";
import type { ClinicAccount, ClinicAccountRole, ClinicAccountStatus } from "../domain/clinic-account.js";
import type { ClinicSession } from "../domain/clinic-session.js";
import "./clinic-account-schema.js";

interface ClinicAccountRow {
  id: string;
  clinic_id: string;
  email: string;
  password_hash: string;
  role: ClinicAccountRole;
  status: ClinicAccountStatus;
  created_by_platform_admin: string | null;
  suspended_at: Date | null;
  created_at: Date;
}

function accountToDomain(row: ClinicAccountRow): ClinicAccount {
  const account: ClinicAccount = {
    id: row.id,
    clinicId: row.clinic_id,
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
  };
  if (row.created_by_platform_admin) {
    account.createdByPlatformAdmin = row.created_by_platform_admin;
  }
  if (row.suspended_at) {
    account.suspendedAt = row.suspended_at;
  }
  return account;
}

export class KyselyClinicAccountRepository implements ClinicAccountRepository<Kysely<Database>> {
  async insert(trx: Kysely<Database>, record: NewClinicAccountRecord): Promise<ClinicAccount> {
    const row = await trx
      .insertInto("clinic_accounts")
      .values({
        id: record.id,
        clinic_id: record.clinicId,
        email: record.email,
        password_hash: record.passwordHash,
        role: record.role,
        status: "ACTIVE",
        created_by_platform_admin: record.createdByPlatformAdmin ?? null,
        created_at: record.createdAt,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return accountToDomain(row);
  }

  async findById(trx: Kysely<Database>, id: string): Promise<ClinicAccount | null> {
    const row = await trx.selectFrom("clinic_accounts").selectAll().where("id", "=", id).executeTakeFirst();
    return row ? accountToDomain(row) : null;
  }

  async findByEmail(trx: Kysely<Database>, email: string): Promise<ClinicAccount | null> {
    const row = await trx.selectFrom("clinic_accounts").selectAll().where("email", "=", email).executeTakeFirst();
    return row ? accountToDomain(row) : null;
  }

  async findActiveAdminByClinic(trx: Kysely<Database>, clinicId: string): Promise<ClinicAccount | null> {
    const row = await trx
      .selectFrom("clinic_accounts")
      .selectAll()
      .where("clinic_id", "=", clinicId)
      .where("role", "=", "CLINIC_ADMIN")
      .where("status", "=", "ACTIVE")
      .executeTakeFirst();
    return row ? accountToDomain(row) : null;
  }

  async resetCredentials(
    trx: Kysely<Database>,
    id: string,
    changes: ClinicAccountCredentialsReset,
    now: Date,
  ): Promise<ClinicAccount> {
    const row = await trx
      .updateTable("clinic_accounts")
      .set({ email: changes.email, password_hash: changes.passwordHash, updated_at: now })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirstOrThrow();
    return accountToDomain(row);
  }

  async updateStatus(trx: Kysely<Database>, id: string, status: ClinicAccountStatus, now: Date): Promise<ClinicAccount> {
    const row = await trx
      .updateTable("clinic_accounts")
      .set({
        status,
        suspended_at: status === "SUSPENDED" ? now : null,
        updated_at: now,
      })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirstOrThrow();
    return accountToDomain(row);
  }

  async listByClinic(trx: Kysely<Database>, clinicId: string, role?: ClinicAccountRole): Promise<ClinicAccount[]> {
    let query = trx.selectFrom("clinic_accounts").selectAll().where("clinic_id", "=", clinicId);
    if (role) {
      query = query.where("role", "=", role);
    }
    const rows = await query.orderBy("created_at", "asc").execute();
    return rows.map(accountToDomain);
  }

  async delete(trx: Kysely<Database>, id: string): Promise<void> {
    await trx.deleteFrom("clinic_accounts").where("id", "=", id).execute();
  }
}

interface ClinicSessionRow {
  id: string;
  clinic_account_id: string;
  refresh_token_hash: string;
  token_chain_id: string;
  user_agent: string | null;
  ip: string | null;
  expires_at: Date;
  revoked_at: Date | null;
  last_used_at: Date;
  created_at: Date;
}

function sessionToDomain(row: ClinicSessionRow): ClinicSession {
  const session: ClinicSession = {
    id: row.id,
    clinicAccountId: row.clinic_account_id,
    refreshTokenHash: row.refresh_token_hash,
    tokenChainId: row.token_chain_id,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
  };
  if (row.user_agent) {
    session.userAgent = row.user_agent;
  }
  if (row.ip) {
    session.ip = row.ip;
  }
  if (row.revoked_at) {
    session.revokedAt = row.revoked_at;
  }
  return session;
}

export class KyselyClinicSessionRepository implements ClinicSessionRepository<Kysely<Database>> {
  async insert(trx: Kysely<Database>, record: NewClinicSessionRecord): Promise<ClinicSession> {
    const row = await trx
      .insertInto("clinic_sessions")
      .values({
        id: record.id,
        clinic_account_id: record.clinicAccountId,
        refresh_token_hash: record.refreshTokenHash,
        token_chain_id: record.tokenChainId,
        user_agent: record.userAgent ?? null,
        ip: record.ip ?? null,
        expires_at: record.expiresAt,
        last_used_at: record.createdAt,
        created_at: record.createdAt,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return sessionToDomain(row);
  }

  async findByRefreshTokenHash(trx: Kysely<Database>, refreshTokenHash: string): Promise<ClinicSession | null> {
    const row = await trx
      .selectFrom("clinic_sessions")
      .selectAll()
      .where("refresh_token_hash", "=", refreshTokenHash)
      .executeTakeFirst();
    return row ? sessionToDomain(row) : null;
  }

  async revoke(trx: Kysely<Database>, id: string, revokedAt: Date): Promise<void> {
    await trx
      .updateTable("clinic_sessions")
      .set({ revoked_at: revokedAt, updated_at: sql`now()` })
      .where("id", "=", id)
      .where("revoked_at", "is", null)
      .execute();
  }

  async revokeChain(trx: Kysely<Database>, tokenChainId: string, revokedAt: Date): Promise<void> {
    await trx
      .updateTable("clinic_sessions")
      .set({ revoked_at: revokedAt, updated_at: sql`now()` })
      .where("token_chain_id", "=", tokenChainId)
      .where("revoked_at", "is", null)
      .execute();
  }
}
