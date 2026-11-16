// Implementações Kysely/pg das portas de identidade (application/ports.ts): contas, tokens OTP e sessões do profissional.
import { sql, type Kysely } from "kysely";
import type { Database } from "../../../platform/db/index.js";
import type {
  NewProfessionalAccountRecord,
  NewProfessionalAuthTokenRecord,
  NewProfessionalSessionRecord,
  ProfessionalAccountRepository,
  ProfessionalAuthToken,
  ProfessionalAuthTokenRepository,
  ProfessionalAuthTokenType,
  ProfessionalSessionRepository,
} from "../application/ports.js";
import type { ProfessionalAccount, ProfessionalRef } from "../domain/account.js";
import type { ProfessionalSession } from "../domain/session.js";
import "./schema.js";

interface AccountRow {
  id: string;
  email: string;
  password_hash: string;
  status: "PENDING_VERIFICATION" | "ACTIVE";
  email_verified_at: Date | null;
  terms_accepted_version: string;
  created_at: Date;
}

function accountToDomain(row: AccountRow): ProfessionalAccount {
  const account: ProfessionalAccount = {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    status: row.status,
    termsAcceptedVersion: row.terms_accepted_version,
    createdAt: row.created_at,
  };
  if (row.email_verified_at) account.emailVerifiedAt = row.email_verified_at;
  return account;
}

export class KyselyProfessionalAccountRepository implements ProfessionalAccountRepository<Kysely<Database>> {
  async insertWithProfessional(trx: Kysely<Database>, record: NewProfessionalAccountRecord): Promise<ProfessionalAccount | null> {
    const row = await trx
      .insertInto("professional_accounts")
      .values({
        id: record.id,
        email: record.email,
        password_hash: record.passwordHash,
        terms_accepted_version: record.termsAcceptedVersion,
        terms_accepted_at: record.createdAt,
        created_at: record.createdAt,
      })
      .onConflict((oc) => oc.column("email").doNothing())
      .returningAll()
      .executeTakeFirst();
    if (!row) return null;
    await trx.insertInto("professionals").values({ id: record.professionalId, account_id: record.id, created_at: record.createdAt, status_changed_at: record.createdAt }).execute();
    return accountToDomain(row);
  }

  async findByEmail(trx: Kysely<Database>, email: string): Promise<ProfessionalAccount | null> {
    const row = await trx.selectFrom("professional_accounts").selectAll().where("email", "=", email).executeTakeFirst();
    return row ? accountToDomain(row) : null;
  }

  async findById(trx: Kysely<Database>, id: string): Promise<ProfessionalAccount | null> {
    const row = await trx.selectFrom("professional_accounts").selectAll().where("id", "=", id).executeTakeFirst();
    return row ? accountToDomain(row) : null;
  }

  async findProfessionalByAccountId(trx: Kysely<Database>, accountId: string): Promise<ProfessionalRef | null> {
    const row = await trx.selectFrom("professionals").select(["id", "account_id", "validation_status"]).where("account_id", "=", accountId).executeTakeFirst();
    return row ? { id: row.id, accountId: row.account_id, validationStatus: row.validation_status } : null;
  }

  async markEmailVerified(trx: Kysely<Database>, id: string, now: Date): Promise<void> {
    await trx.updateTable("professional_accounts").set({ status: "ACTIVE", email_verified_at: now, updated_at: now }).where("id", "=", id).execute();
  }

  async setPasswordHash(trx: Kysely<Database>, id: string, passwordHash: string, now: Date): Promise<void> {
    await trx.updateTable("professional_accounts").set({ password_hash: passwordHash, updated_at: now }).where("id", "=", id).execute();
  }

  async touchLastLogin(trx: Kysely<Database>, id: string, now: Date): Promise<void> {
    await trx.updateTable("professional_accounts").set({ last_login_at: now, updated_at: now }).where("id", "=", id).execute();
  }
}

export class KyselyProfessionalAuthTokenRepository implements ProfessionalAuthTokenRepository<Kysely<Database>> {
  async insert(trx: Kysely<Database>, record: NewProfessionalAuthTokenRecord): Promise<void> {
    await trx
      .insertInto("professional_auth_tokens")
      .values({ id: record.id, account_id: record.accountId, type: record.type, token_hash: record.tokenHash, expires_at: record.expiresAt, created_at: record.createdAt })
      .execute();
  }

  async findValidForAccount(trx: Kysely<Database>, accountId: string, type: ProfessionalAuthTokenType, tokenHash: string, now: Date): Promise<ProfessionalAuthToken | null> {
    const row = await trx
      .selectFrom("professional_auth_tokens")
      .selectAll()
      .where("account_id", "=", accountId)
      .where("type", "=", type)
      .where("token_hash", "=", tokenHash)
      .where("used_at", "is", null)
      .where("expires_at", ">", now)
      .executeTakeFirst();
    return row ? { id: row.id, accountId: row.account_id, type: row.type, tokenHash: row.token_hash, expiresAt: row.expires_at } : null;
  }

  async markUsed(trx: Kysely<Database>, id: string, usedAt: Date): Promise<void> {
    // `used_at is null` garante uso único mesmo com dois pedidos concorrentes (o segundo não altera nada).
    await trx.updateTable("professional_auth_tokens").set({ used_at: usedAt, updated_at: sql`now()` }).where("id", "=", id).where("used_at", "is", null).execute();
  }

  async invalidateAllForAccount(trx: Kysely<Database>, accountId: string, type: ProfessionalAuthTokenType, now: Date): Promise<void> {
    await trx
      .updateTable("professional_auth_tokens")
      .set({ used_at: now, updated_at: sql`now()` })
      .where("account_id", "=", accountId)
      .where("type", "=", type)
      .where("used_at", "is", null)
      .execute();
  }
}

interface SessionRow {
  id: string;
  account_id: string;
  refresh_token_hash: string;
  token_chain_id: string;
  user_agent: string | null;
  ip: string | null;
  expires_at: Date;
  revoked_at: Date | null;
  last_used_at: Date;
  created_at: Date;
}

function sessionToDomain(row: SessionRow): ProfessionalSession {
  const session: ProfessionalSession = {
    id: row.id,
    accountId: row.account_id,
    refreshTokenHash: row.refresh_token_hash,
    tokenChainId: row.token_chain_id,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
  };
  if (row.user_agent) session.userAgent = row.user_agent;
  if (row.ip) session.ip = row.ip;
  if (row.revoked_at) session.revokedAt = row.revoked_at;
  return session;
}

export class KyselyProfessionalSessionRepository implements ProfessionalSessionRepository<Kysely<Database>> {
  async insert(trx: Kysely<Database>, record: NewProfessionalSessionRecord): Promise<ProfessionalSession> {
    const row = await trx
      .insertInto("professional_sessions")
      .values({
        id: record.id,
        account_id: record.accountId,
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

  async findByRefreshTokenHash(trx: Kysely<Database>, refreshTokenHash: string): Promise<ProfessionalSession | null> {
    const row = await trx.selectFrom("professional_sessions").selectAll().where("refresh_token_hash", "=", refreshTokenHash).executeTakeFirst();
    return row ? sessionToDomain(row) : null;
  }

  async revoke(trx: Kysely<Database>, id: string, revokedAt: Date): Promise<boolean> {
    const result = await trx.updateTable("professional_sessions").set({ revoked_at: revokedAt, updated_at: sql`now()` }).where("id", "=", id).where("revoked_at", "is", null).executeTakeFirst();
    return Number(result.numUpdatedRows) > 0;
  }

  async revokeChain(trx: Kysely<Database>, tokenChainId: string, revokedAt: Date): Promise<void> {
    await trx.updateTable("professional_sessions").set({ revoked_at: revokedAt, updated_at: sql`now()` }).where("token_chain_id", "=", tokenChainId).where("revoked_at", "is", null).execute();
  }

  async revokeAllForAccount(trx: Kysely<Database>, accountId: string, revokedAt: Date): Promise<void> {
    await trx.updateTable("professional_sessions").set({ revoked_at: revokedAt, updated_at: sql`now()` }).where("account_id", "=", accountId).where("revoked_at", "is", null).execute();
  }
}
