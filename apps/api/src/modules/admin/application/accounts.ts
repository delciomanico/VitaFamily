// UC-ADM-01/02 Contas (FR-ADM-01, R10, D4): listar, suspender e reativar. Sem acesso a dados de
// saúde — este módulo só importa `users` e `audit` (modules.md §3.4). Conta suspensa não faz login
// nem renova sessão (BR-ACC-05): `auth` já recusa `SUSPENDED` no login, no refresh e a cada pedido.
import type { Clock } from "../../../platform/clock/index.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../../../platform/errors/index.js";
import { parsePageParams } from "../../../platform/page/index.js";
import { auditContextFields, type AuditEvent } from "../../audit/index.js";

export interface ActorIdentity {
  userId: string;
  platformAdmin: boolean;
}

export interface RequestContext {
  requestId: string;
  ip?: string;
  userAgent?: string;
}

type AccountStatus = "PENDING_VERIFICATION" | "ACTIVE" | "SUSPENDED";

interface AccountRecord {
  id: string;
  email: string;
  status: AccountStatus;
  createdAt: Date;
}

/** Operações cruas de `users` (modules.md §2: `admin` depende de `users`), ligadas pela raiz. */
export interface AdminUsersPort<Trx> {
  byId: (trx: Trx, id: string) => Promise<AccountRecord | null>;
  listAccounts: (trx: Trx, filter: { status?: AccountStatus; limit: number; cursor?: string }) => Promise<{ items: AccountRecord[]; nextCursor: string | null }>;
  setSuspension: (trx: Trx, id: string, suspension: { at: Date; reason: string } | null) => Promise<unknown>;
}

export interface AdminAccountsDeps<Trx> {
  users: AdminUsersPort<Trx>;
  audit: { record: (trx: Trx, event: AuditEvent) => Promise<void> };
  withTransaction: <T>(fn: (trx: Trx) => Promise<T>) => Promise<T>;
  clock: Clock;
}

export type AdminUserView = AccountRecord;

export interface AdminListUsersQuery {
  status?: string;
  limit?: string;
  cursor?: string;
}

function requirePlatformAdmin(actor: ActorIdentity): void {
  if (!actor.platformAdmin) {
    throw new ForbiddenError({ detail: "Só o Platform Admin gere contas." });
  }
}

const STATUSES: AccountStatus[] = ["PENDING_VERIFICATION", "ACTIVE", "SUSPENDED"];

export function createAdminListUsersUseCase<Trx>(deps: AdminAccountsDeps<Trx>) {
  return async function adminListUsers(actor: ActorIdentity, query: AdminListUsersQuery) {
    requirePlatformAdmin(actor);
    const { limit, cursor } = parsePageParams(query.limit, query.cursor);
    const status = STATUSES.find((s) => s === query.status);
    // D4/R10: só campos de conta — nunca nome, data de nascimento nem dados de saúde.
    const page = await deps.withTransaction((trx) =>
      deps.users.listAccounts(trx, { limit, ...(cursor ? { cursor } : {}), ...(status ? { status } : {}) }),
    );
    return {
      items: page.items.map((u): AdminUserView => ({ id: u.id, email: u.email, status: u.status, createdAt: u.createdAt })),
      nextCursor: page.nextCursor,
    };
  };
}

export interface SuspendUserInput {
  reason: string;
}

export function createAdminSuspendUserUseCase<Trx>(deps: AdminAccountsDeps<Trx>) {
  return async function adminSuspendUser(actor: ActorIdentity, userId: string, input: SuspendUserInput, context: RequestContext): Promise<void> {
    requirePlatformAdmin(actor);
    const reason = input.reason.trim();
    if (!reason) {
      throw new ValidationError([{ field: "reason", message: "obrigatório" }], { detail: "Indique o motivo da suspensão." });
    }
    await deps.withTransaction(async (trx) => {
      const user = await deps.users.byId(trx, userId);
      if (!user) throw new NotFoundError();
      if (user.status === "SUSPENDED") return; // idempotente
      if (user.id === actor.userId) {
        throw new ForbiddenError({ detail: "Não pode suspender a sua própria conta." });
      }
      await deps.users.setSuspension(trx, userId, { at: deps.clock.now(), reason });
      await deps.audit.record(trx, {
        occurredAt: deps.clock.now(),
        actorType: "PLATFORM_ADMIN",
        actorUserId: actor.userId,
        action: "ADMIN_USER_SUSPEND",
        resourceType: "User",
        resourceId: userId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });
    });
  };
}

export function createAdminReactivateUserUseCase<Trx>(deps: AdminAccountsDeps<Trx>) {
  return async function adminReactivateUser(actor: ActorIdentity, userId: string, context: RequestContext): Promise<void> {
    requirePlatformAdmin(actor);
    await deps.withTransaction(async (trx) => {
      const user = await deps.users.byId(trx, userId);
      if (!user) throw new NotFoundError();
      if (user.status !== "SUSPENDED") return; // idempotente
      await deps.users.setSuspension(trx, userId, null);
      await deps.audit.record(trx, {
        occurredAt: deps.clock.now(),
        actorType: "PLATFORM_ADMIN",
        actorUserId: actor.userId,
        action: "ADMIN_USER_REACTIVATE",
        resourceType: "User",
        resourceId: userId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });
    });
  };
}
