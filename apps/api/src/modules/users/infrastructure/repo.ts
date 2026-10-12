// Implementação Kysely/pg da porta `UsersRepository` (application/ports.ts).
import { sql, type Kysely } from "kysely";
import type { Database } from "../../../platform/db/index.js";
import { decodeCursor, encodeCursor } from "../../../platform/page/index.js";
import type { AccountListFilter, AccountPage, NewUserRecord, ProfileChanges, Suspension, UsersRepository } from "../application/ports.js";
import type { User } from "../domain/user.js";
import "./schema.js";

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  birth_date: string;
  timezone: string;
  status: "PENDING_VERIFICATION" | "ACTIVE" | "SUSPENDED";
  platform_role: "NONE" | "PLATFORM_ADMIN";
  email_verified_at: Date | null;
  terms_accepted_version: string;
  terms_accepted_at: Date;
  suspended_at: Date | null;
  suspension_reason: string | null;
  created_at: Date;
}

function toDomain(row: UserRow): User {
  const user: User = {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    name: row.name,
    birthDate: row.birth_date,
    timezone: row.timezone,
    status: row.status,
    platformRole: row.platform_role,
    termsAcceptedVersion: row.terms_accepted_version,
    termsAcceptedAt: row.terms_accepted_at,
    createdAt: row.created_at,
  };
  if (row.email_verified_at) {
    user.emailVerifiedAt = row.email_verified_at;
  }
  if (row.suspended_at) {
    user.suspendedAt = row.suspended_at;
  }
  if (row.suspension_reason) {
    user.suspensionReason = row.suspension_reason;
  }
  return user;
}

const SELECT_COLUMNS = [
  "id",
  "email",
  "password_hash",
  "name",
  "birth_date",
  "timezone",
  "status",
  "platform_role",
  "email_verified_at",
  "terms_accepted_version",
  "terms_accepted_at",
  "suspended_at",
  "suspension_reason",
  "created_at",
] as const;

export class KyselyUsersRepository implements UsersRepository<Kysely<Database>> {
  async insert(trx: Kysely<Database>, record: NewUserRecord): Promise<User> {
    const row = await trx
      .insertInto("users")
      .values({
        id: record.id,
        email: record.email,
        password_hash: record.passwordHash,
        name: record.name,
        birth_date: record.birthDate,
        timezone: record.timezone,
        terms_accepted_version: record.termsAcceptedVersion,
        terms_accepted_at: record.termsAcceptedAt,
        created_at: record.createdAt,
      })
      .returning(SELECT_COLUMNS)
      .executeTakeFirstOrThrow();
    // NOTA (M8, change control, ver infrastructure/schema.ts): já não insere aqui a linha de
    // `notification_preferences` por omissão — essa tabela passou a ser propriedade exclusiva de
    // `notifications` (conventions.md §3.5), que trata a ausência de linha como os defaults (R9).
    return toDomain(row);
  }

  async findByEmail(trx: Kysely<Database>, email: string): Promise<User | null> {
    const row = await trx
      .selectFrom("users")
      .select(SELECT_COLUMNS)
      .where("email", "=", email)
      .executeTakeFirst();
    return row ? toDomain(row) : null;
  }

  async findById(trx: Kysely<Database>, id: string): Promise<User | null> {
    const row = await trx
      .selectFrom("users")
      .select(SELECT_COLUMNS)
      .where("id", "=", id)
      .executeTakeFirst();
    return row ? toDomain(row) : null;
  }

  async updateProfile(trx: Kysely<Database>, id: string, changes: ProfileChanges): Promise<User> {
    const row = await trx
      .updateTable("users")
      .set({
        ...(changes.name !== undefined ? { name: changes.name } : {}),
        ...(changes.timezone !== undefined ? { timezone: changes.timezone } : {}),
        updated_at: sql`now()`,
      })
      .where("id", "=", id)
      .returning(SELECT_COLUMNS)
      .executeTakeFirstOrThrow();
    return toDomain(row);
  }

  async updateTermsAcceptance(
    trx: Kysely<Database>,
    id: string,
    version: string,
    acceptedAt: Date,
  ): Promise<User> {
    const row = await trx
      .updateTable("users")
      .set({
        terms_accepted_version: version,
        terms_accepted_at: acceptedAt,
        updated_at: sql`now()`,
      })
      .where("id", "=", id)
      .returning(SELECT_COLUMNS)
      .executeTakeFirstOrThrow();
    return toDomain(row);
  }

  async updateEmailVerified(trx: Kysely<Database>, id: string, verifiedAt: Date): Promise<User> {
    const row = await trx
      .updateTable("users")
      .set({ status: "ACTIVE", email_verified_at: verifiedAt, updated_at: sql`now()` })
      .where("id", "=", id)
      .returning(SELECT_COLUMNS)
      .executeTakeFirstOrThrow();
    return toDomain(row);
  }

  async updatePasswordHash(trx: Kysely<Database>, id: string, passwordHash: string): Promise<void> {
    await trx
      .updateTable("users")
      .set({ password_hash: passwordHash, updated_at: sql`now()` })
      .where("id", "=", id)
      .execute();
  }

  async listAll(trx: Kysely<Database>, filter: AccountListFilter): Promise<AccountPage> {
    let query = trx.selectFrom("users").select(SELECT_COLUMNS);
    if (filter.status) query = query.where("status", "=", filter.status);
    if (filter.cursor) {
      const after = new Date(decodeCursor(filter.cursor).createdAt);
      const afterId = decodeCursor(filter.cursor).id;
      query = query.where((eb) => eb.or([eb("created_at", ">", after), eb.and([eb("created_at", "=", after), eb("id", ">", afterId)])]));
    }
    const rows = await query.orderBy("created_at", "asc").orderBy("id", "asc").limit(filter.limit + 1).execute();
    const hasMore = rows.length > filter.limit;
    const page = hasMore ? rows.slice(0, filter.limit) : rows;
    const last = page[page.length - 1];
    return { items: page.map(toDomain), nextCursor: hasMore && last ? encodeCursor({ createdAt: last.created_at.toISOString(), id: last.id }) : null };
  }

  async setSuspension(trx: Kysely<Database>, id: string, suspension: Suspension | null): Promise<User> {
    const row = await trx
      .updateTable("users")
      .set(
        suspension
          ? { status: "SUSPENDED", suspended_at: suspension.at, suspension_reason: suspension.reason, updated_at: sql`now()` }
          : {
              // Reativar: volta a ACTIVE só se o e-mail já foi verificado; senão continua por verificar.
              status: sql`CASE WHEN email_verified_at IS NULL THEN 'PENDING_VERIFICATION'::user_status ELSE 'ACTIVE'::user_status END`,
              suspended_at: null,
              suspension_reason: null,
              updated_at: sql`now()`,
            },
      )
      .where("id", "=", id)
      .returning(SELECT_COLUMNS)
      .executeTakeFirstOrThrow();
    return toDomain(row);
  }
}
