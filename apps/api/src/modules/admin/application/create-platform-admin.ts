// CLI `create-platform-admin <email>` (environment.md §4): o primeiro Platform Admin é criado por
// um comando explícito e auditado — nunca há conta admin por defeito. Promove uma conta JÁ
// registada, com e-mail verificado e ativa (o fluxo normal de registo trata da palavra-passe).
import type { Clock } from "../../../platform/clock/index.js";
import { newId } from "../../../platform/ids/index.js";
import type { AuditEvent } from "../../audit/index.js";

type PlatformRole = "NONE" | "PLATFORM_ADMIN";

export interface PlatformAdminUsersPort<Trx> {
  byEmail: (trx: Trx, email: string) => Promise<{ id: string; status: "PENDING_VERIFICATION" | "ACTIVE" | "SUSPENDED"; platformRole: PlatformRole } | null>;
  setPlatformRole: (trx: Trx, id: string, role: PlatformRole) => Promise<unknown>;
}

export interface CreatePlatformAdminDeps<Trx> {
  users: PlatformAdminUsersPort<Trx>;
  audit: { record: (trx: Trx, event: AuditEvent) => Promise<void> };
  withTransaction: <T>(fn: (trx: Trx) => Promise<T>) => Promise<T>;
  clock: Clock;
}

export type CreatePlatformAdminResult = "CREATED" | "ALREADY_ADMIN" | "NOT_FOUND" | "NOT_ACTIVE";

export function createCreatePlatformAdminUseCase<Trx>(deps: CreatePlatformAdminDeps<Trx>) {
  return async function createPlatformAdmin(email: string): Promise<CreatePlatformAdminResult> {
    return deps.withTransaction(async (trx) => {
      const user = await deps.users.byEmail(trx, email);
      if (!user) return "NOT_FOUND";
      if (user.platformRole === "PLATFORM_ADMIN") return "ALREADY_ADMIN";
      if (user.status !== "ACTIVE") return "NOT_ACTIVE";
      await deps.users.setPlatformRole(trx, user.id, "PLATFORM_ADMIN");
      await deps.audit.record(trx, {
        occurredAt: deps.clock.now(),
        actorType: "SYSTEM",
        action: "ADMIN_PLATFORM_ADMIN_CREATE",
        resourceType: "User",
        resourceId: user.id,
        result: "SUCCESS",
        requestId: newId(),
      });
      return "CREATED";
    });
  };
}
