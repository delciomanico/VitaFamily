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
  name: string;
  status: AccountStatus;
  createdAt: Date;
  platformRole?: "NONE" | "PLATFORM_ADMIN";
  emailVerifiedAt?: Date;
  suspendedAt?: Date;
  suspensionReason?: string;
}

/** Operações cruas de `users` (modules.md §2: `admin` depende de `users`), ligadas pela raiz. */
export interface AdminUsersPort<Trx> {
  byId: (trx: Trx, id: string) => Promise<AccountRecord | null>;
  listAccounts: (trx: Trx, filter: { status?: AccountStatus; q?: string; limit: number; cursor?: string }) => Promise<{ items: AccountRecord[]; nextCursor: string | null }>;
  setSuspension: (trx: Trx, id: string, suspension: { at: Date; reason: string } | null) => Promise<unknown>;
}

export type AccessResetKind = "PASSWORD_RESET" | "EMAIL_VERIFICATION";

/** Portas ligadas no composition root (modules.md nota 22): `auth` (sessões/recuperação) e contagem de famílias. */
export interface AdminAuthPort<Trx> {
  resetUserAccess: (trx: Trx, userId: string) => Promise<AccessResetKind>;
  getSessionStats: (trx: Trx, userId: string) => Promise<{ activeCount: number; lastUsedAt: Date | null }>;
}

export interface AdminFamiliesPort<Trx> {
  countFamiliesOfUser: (trx: Trx, userId: string) => Promise<number>;
}

export interface AdminAccountsDeps<Trx> {
  users: AdminUsersPort<Trx>;
  auth: AdminAuthPort<Trx>;
  families: AdminFamiliesPort<Trx>;
  audit: { record: (trx: Trx, event: AuditEvent) => Promise<void> };
  withTransaction: <T>(fn: (trx: Trx) => Promise<T>) => Promise<T>;
  clock: Clock;
}

export interface AdminUserView {
  id: string;
  email: string;
  name: string;
  status: AccountStatus;
  createdAt: Date;
}

/** BR-ADM-01: só dados operacionais — nunca saúde, nomes de famílias ou de membros (R10/D4). */
export interface AdminUserDetailView extends AdminUserView {
  platformRole: "NONE" | "PLATFORM_ADMIN";
  emailVerifiedAt: Date | null;
  suspendedAt: Date | null;
  suspensionReason: string | null;
  familiesCount: number;
  activeSessionsCount: number;
  lastSessionUsedAt: Date | null;
}

/** Contrato das contas de portal de clínica, implementado por `clinics` (ligado na raiz; BR-ADM-03). */
export interface AdminClinicAccountView {
  id: string;
  clinicId: string;
  email: string;
  role: "CLINIC_ADMIN" | "CLINIC_MANAGER" | "CLINIC_DOCTOR";
  status: "ACTIVE" | "SUSPENDED";
  createdAt: Date;
  lastLoginAt: Date | null;
  suspendedAt: Date | null;
}

export interface SuspendClinicAccountInput {
  reason: string;
}

export interface AdminListUsersQuery {
  q?: string;
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
    const q = query.q?.trim();
    if (q !== undefined && q.length > 0 && q.length < 2) {
      throw new ValidationError([{ field: "q", message: "mínimo 2 caracteres" }], { detail: "A pesquisa exige pelo menos 2 caracteres." });
    }
    // D4/R10: só campos de conta (nome do próprio utilizador incluído, BR-ADM-01) — nunca data de nascimento, famílias nem saúde.
    const page = await deps.withTransaction((trx) =>
      deps.users.listAccounts(trx, { limit, ...(cursor ? { cursor } : {}), ...(status ? { status } : {}), ...(q ? { q } : {}) }),
    );
    return {
      items: page.items.map((u): AdminUserView => ({ id: u.id, email: u.email, name: u.name, status: u.status, createdAt: u.createdAt })),
      nextCursor: page.nextCursor,
    };
  };
}

export function createAdminGetUserUseCase<Trx>(deps: AdminAccountsDeps<Trx>) {
  return async function adminGetUser(actor: ActorIdentity, userId: string): Promise<AdminUserDetailView> {
    requirePlatformAdmin(actor);
    return deps.withTransaction(async (trx) => {
      const user = await deps.users.byId(trx, userId);
      if (!user) throw new NotFoundError();
      const [sessions, familiesCount] = await Promise.all([deps.auth.getSessionStats(trx, userId), deps.families.countFamiliesOfUser(trx, userId)]);
      // Lista fechada de campos: nunca se devolve o registo inteiro (password_hash, birthDate…).
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        status: user.status,
        createdAt: user.createdAt,
        platformRole: user.platformRole ?? "NONE",
        emailVerifiedAt: user.emailVerifiedAt ?? null,
        suspendedAt: user.suspendedAt ?? null,
        suspensionReason: user.suspensionReason ?? null,
        familiesCount,
        activeSessionsCount: sessions.activeCount,
        lastSessionUsedAt: sessions.lastUsedAt,
      };
    });
  };
}

/**
 * BR-ADM-02: revoga todas as sessões e envia ao utilizador o e-mail de recuperação (ou nova
 * verificação). O token fica em `auth` — o admin nunca o vê nem define palavra-passe.
 */
export function createAdminResetUserAccessUseCase<Trx>(deps: AdminAccountsDeps<Trx>) {
  return async function adminResetUserAccess(actor: ActorIdentity, userId: string, context: RequestContext): Promise<void> {
    requirePlatformAdmin(actor);
    if (userId === actor.userId) {
      throw new ForbiddenError({ detail: "Não pode repor o seu próprio acesso por aqui." });
    }
    await deps.withTransaction(async (trx) => {
      const user = await deps.users.byId(trx, userId);
      if (!user) throw new NotFoundError();
      const kind = await deps.auth.resetUserAccess(trx, userId);
      await deps.audit.record(trx, {
        occurredAt: deps.clock.now(),
        actorType: "PLATFORM_ADMIN",
        actorUserId: actor.userId,
        action: "ADMIN_USER_RESET_ACCESS",
        resourceType: "User",
        resourceId: userId,
        result: "SUCCESS",
        requestId: context.requestId,
        metadata: { kind },
        ...auditContextFields(context),
      });
    });
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
