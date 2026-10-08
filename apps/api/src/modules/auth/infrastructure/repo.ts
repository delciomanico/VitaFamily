// Implementações Kysely/pg das portas `AuthTokenRepository` e `SessionRepository`
// (application/ports.ts).
import { sql, type Kysely } from "kysely";
import type { Database } from "../../../platform/db/index.js";
import type {
  AuthToken,
  AuthTokenRepository,
  AuthTokenType,
  NewAuthToken,
  NewSessionRecord,
  SessionRepository,
} from "../application/ports.js";
import type { Session } from "../domain/session.js";
import "./schema.js";

interface AuthTokenRow {
  id: string;
  user_id: string;
  type: AuthTokenType;
  token_hash: string;
  expires_at: Date;
  used_at: Date | null;
  created_at: Date;
}

function tokenToDomain(row: AuthTokenRow): AuthToken {
  const token: AuthToken = {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    tokenHash: row.token_hash,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
  if (row.used_at) {
    token.usedAt = row.used_at;
  }
  return token;
}

export class KyselyAuthTokenRepository implements AuthTokenRepository<Kysely<Database>> {
  async insert(trx: Kysely<Database>, token: NewAuthToken): Promise<AuthToken> {
    const row = await trx
      .insertInto("auth_tokens")
      .values({
        id: token.id,
        user_id: token.userId,
        type: token.type,
        token_hash: token.tokenHash,
        expires_at: token.expiresAt,
        created_at: token.createdAt,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return tokenToDomain(row);
  }

  async findValidByHash(
    trx: Kysely<Database>,
    type: AuthTokenType,
    tokenHash: string,
    now: Date,
  ): Promise<AuthToken | null> {
    const row = await trx
      .selectFrom("auth_tokens")
      .selectAll()
      .where("type", "=", type)
      .where("token_hash", "=", tokenHash)
      .where("used_at", "is", null)
      .where("expires_at", ">", now)
      .executeTakeFirst();
    return row ? tokenToDomain(row) : null;
  }

  async markUsed(trx: Kysely<Database>, id: string, usedAt: Date): Promise<void> {
    await trx
      .updateTable("auth_tokens")
      .set({ used_at: usedAt, updated_at: sql`now()` })
      .where("id", "=", id)
      .execute();
  }

  async invalidateAllForUser(
    trx: Kysely<Database>,
    userId: string,
    type: AuthTokenType,
    now: Date,
  ): Promise<void> {
    await trx
      .updateTable("auth_tokens")
      .set({ used_at: now, updated_at: sql`now()` })
      .where("user_id", "=", userId)
      .where("type", "=", type)
      .where("used_at", "is", null)
      .execute();
  }
}

interface SessionRow {
  id: string;
  user_id: string;
  refresh_token_hash: string;
  token_chain_id: string;
  user_agent: string | null;
  ip: string | null;
  expires_at: Date;
  revoked_at: Date | null;
  last_used_at: Date;
  created_at: Date;
}

function sessionToDomain(row: SessionRow): Session {
  const session: Session = {
    id: row.id,
    userId: row.user_id,
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

export class KyselySessionRepository implements SessionRepository<Kysely<Database>> {
  async insert(trx: Kysely<Database>, record: NewSessionRecord): Promise<Session> {
    const row = await trx
      .insertInto("sessions")
      .values({
        id: record.id,
        user_id: record.userId,
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

  async findByRefreshTokenHash(trx: Kysely<Database>, refreshTokenHash: string): Promise<Session | null> {
    const row = await trx
      .selectFrom("sessions")
      .selectAll()
      .where("refresh_token_hash", "=", refreshTokenHash)
      .executeTakeFirst();
    return row ? sessionToDomain(row) : null;
  }

  async findById(trx: Kysely<Database>, id: string): Promise<Session | null> {
    const row = await trx.selectFrom("sessions").selectAll().where("id", "=", id).executeTakeFirst();
    return row ? sessionToDomain(row) : null;
  }

  async revoke(trx: Kysely<Database>, id: string, revokedAt: Date): Promise<void> {
    await trx
      .updateTable("sessions")
      .set({ revoked_at: revokedAt, updated_at: sql`now()` })
      .where("id", "=", id)
      .where("revoked_at", "is", null)
      .execute();
  }

  async revokeChain(trx: Kysely<Database>, tokenChainId: string, revokedAt: Date): Promise<void> {
    await trx
      .updateTable("sessions")
      .set({ revoked_at: revokedAt, updated_at: sql`now()` })
      .where("token_chain_id", "=", tokenChainId)
      .where("revoked_at", "is", null)
      .execute();
  }

  async revokeAllForUser(trx: Kysely<Database>, userId: string, revokedAt: Date): Promise<void> {
    await trx
      .updateTable("sessions")
      .set({ revoked_at: revokedAt, updated_at: sql`now()` })
      .where("user_id", "=", userId)
      .where("revoked_at", "is", null)
      .execute();
  }

  async revokeAllForUserExcept(
    trx: Kysely<Database>,
    userId: string,
    exceptSessionId: string,
    revokedAt: Date,
  ): Promise<void> {
    await trx
      .updateTable("sessions")
      .set({ revoked_at: revokedAt, updated_at: sql`now()` })
      .where("user_id", "=", userId)
      .where("id", "!=", exceptSessionId)
      .where("revoked_at", "is", null)
      .execute();
  }
}
