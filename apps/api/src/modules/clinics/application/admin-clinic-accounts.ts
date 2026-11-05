// BR-ADM-03/04 (ADR-023): o Platform Admin lista, suspende e reativa as contas do portal de uma
// clínica parceira. Não cria nem remove Gestores (BR-CLN-05). Só identificação e estado — nunca
// palavra-passe. Exposto por `clinics` (dono de `clinic_accounts`/`clinic_sessions`) e ligado às
// rotas por `admin` (modules.md §2, nota 22).
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import type { ClinicAccount } from "../domain/clinic-account.js";
import type { ActorIdentity, ClinicsDeps, RequestContext } from "./ports.js";
import { requirePartnerClinic } from "./support.js";

export interface AdminClinicAccountView {
  id: string;
  clinicId: string;
  email: string;
  role: ClinicAccount["role"];
  status: ClinicAccount["status"];
  createdAt: Date;
  lastLoginAt: Date | null;
  suspendedAt: Date | null;
}

export interface SuspendClinicAccountInput {
  reason: string;
}

function requirePlatformAdmin(actor: ActorIdentity): void {
  if (!actor.platformAdmin) {
    throw new ForbiddenError({ detail: "Só o Platform Admin gere contas do portal da clínica." });
  }
}

/** 404 sem enumeração: conta inexistente ou de outra clínica respondem igual. */
async function requireAccountOfClinic<Trx>(deps: ClinicsDeps<Trx>, trx: Trx, clinicId: string, accountId: string): Promise<ClinicAccount> {
  await requirePartnerClinic(deps, trx, clinicId);
  const account = await deps.clinicAccountRepo.findById(trx, accountId);
  if (account?.clinicId !== clinicId) {
    throw new NotFoundError({ detail: "Conta não encontrada." });
  }
  return account;
}

export function createAdminListClinicAccountsUseCase<Trx>(deps: ClinicsDeps<Trx>) {
  return async function adminListClinicAccounts(actor: ActorIdentity, clinicId: string): Promise<AdminClinicAccountView[]> {
    requirePlatformAdmin(actor);
    return deps.withTransaction(async (trx) => {
      await requirePartnerClinic(deps, trx, clinicId);
      const rows = await deps.clinicAccountRepo.listByClinicWithLastLogin(trx, clinicId);
      return rows.map(({ account, lastLoginAt }) => ({
        id: account.id,
        clinicId: account.clinicId,
        email: account.email,
        role: account.role,
        status: account.status,
        createdAt: account.createdAt,
        lastLoginAt,
        suspendedAt: account.suspendedAt ?? null,
      }));
    });
  };
}

export function createAdminSuspendClinicAccountUseCase<Trx>(deps: ClinicsDeps<Trx>) {
  return async function adminSuspendClinicAccount(
    actor: ActorIdentity,
    clinicId: string,
    clinicAccountId: string,
    input: SuspendClinicAccountInput,
    context: RequestContext,
  ): Promise<void> {
    requirePlatformAdmin(actor);
    // O motivo é obrigatório mas não é persistido nem auditado (texto livre = risco de PII, BR-ADM-07).
    if (!input.reason.trim()) {
      throw new ValidationError([{ field: "reason", message: "obrigatório" }], { detail: "Indique o motivo da suspensão." });
    }
    await deps.withTransaction(async (trx) => {
      const account = await requireAccountOfClinic(deps, trx, clinicId, clinicAccountId);
      if (account.status === "SUSPENDED") return; // idempotente
      const now = deps.clock.now();
      await deps.clinicAccountRepo.updateStatus(trx, account.id, "SUSPENDED", now);
      await deps.clinicSessionRepo.revokeAllForAccount(trx, account.id, now);
      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "PLATFORM_ADMIN",
        actorUserId: actor.userId,
        action: "ADMIN_CLINIC_ACCOUNT_SUSPEND",
        resourceType: "ClinicAccount",
        resourceId: account.id,
        result: "SUCCESS",
        requestId: context.requestId,
        metadata: { clinicId, role: account.role },
        ...auditContextFields(context),
      });
    });
  };
}

export function createAdminReactivateClinicAccountUseCase<Trx>(deps: ClinicsDeps<Trx>) {
  return async function adminReactivateClinicAccount(
    actor: ActorIdentity,
    clinicId: string,
    clinicAccountId: string,
    context: RequestContext,
  ): Promise<void> {
    requirePlatformAdmin(actor);
    await deps.withTransaction(async (trx) => {
      const account = await requireAccountOfClinic(deps, trx, clinicId, clinicAccountId);
      if (account.status === "ACTIVE") return; // idempotente
      if (account.role === "CLINIC_ADMIN") {
        // BR-ADM-04: no máximo um CLINIC_ADMIN ativo por clínica (UNIQUE parcial, schema.md).
        const active = await deps.clinicAccountRepo.findActiveAdminByClinic(trx, clinicId);
        if (active && active.id !== account.id) {
          throw new ConflictError({ detail: "Já existe um administrador ativo nesta clínica." });
        }
      }
      const now = deps.clock.now();
      try {
        await deps.clinicAccountRepo.updateStatus(trx, account.id, "ACTIVE", now);
      } catch (err) {
        // Corrida com outra reativação: o índice único parcial é a garantia final.
        if ((err as { code?: string }).code === "23505") {
          throw new ConflictError({ detail: "Já existe um administrador ativo nesta clínica." });
        }
        throw err;
      }
      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "PLATFORM_ADMIN",
        actorUserId: actor.userId,
        action: "ADMIN_CLINIC_ACCOUNT_REACTIVATE",
        resourceType: "ClinicAccount",
        resourceId: account.id,
        result: "SUCCESS",
        requestId: context.requestId,
        metadata: { clinicId, role: account.role },
        ...auditContextFields(context),
      });
    });
  };
}
