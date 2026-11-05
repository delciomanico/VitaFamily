// openapi `adminListInsurers`/`adminCreateInsurer`/`adminUpdateInsurer`/`adminSetInsurerStatus`/
// `adminCreateOrResetInsurerRootAccount` (BR-ADM-05/06, BR-INS-06/10, ADR-021/ADR-023): só
// PLATFORM_ADMIN, nunca dados de saúde. Sem eliminação (schema.md §8). Mirror de `admin-clinics.ts`.
import { ForbiddenError, NotFoundError, ValidationError } from "../../../platform/errors/index.js";
import { newId } from "../../../platform/ids/index.js";
import { auditContextFields } from "../../audit/index.js";
import type { InsuranceAccount } from "../domain/insurance-account.js";
import { generateInitialInsurancePassword, hashInsurancePassword } from "../domain/insurance-crypto.js";
import { assertValidInsurerName, assertValidTaxId, type Insurer, type InsurerStatus } from "../domain/insurer.js";
import type { ActorIdentity, InsuranceDeps, InsurerChanges, RequestContext } from "./ports.js";
import { trySendInsuranceMail } from "./send-insurance-mail.js";

function requirePlatformAdmin(actor: ActorIdentity): void {
  if (!actor.platformAdmin) {
    throw new ForbiddenError({ detail: "Só o Platform Admin gere seguradoras parceiras." });
  }
}

async function requireInsurer<Trx>(deps: InsuranceDeps<Trx>, trx: Trx, insurerId: string): Promise<Insurer> {
  const insurer = await deps.insurersRepo.findById(trx, insurerId);
  if (!insurer) {
    throw new NotFoundError({ detail: "Seguradora não encontrada." });
  }
  return insurer;
}

function duplicateTaxId(): ValidationError {
  return new ValidationError([{ field: "taxId", message: "já está em uso" }], { detail: "NIF já associado a outra seguradora." });
}

export function createAdminListInsurersUseCase<Trx>(deps: InsuranceDeps<Trx>) {
  return async function adminListInsurers(actor: ActorIdentity): Promise<Insurer[]> {
    requirePlatformAdmin(actor);
    return deps.withTransaction((trx) => deps.insurersRepo.list(trx));
  };
}

export interface AdminCreateInsurerInput {
  name: string;
  taxId: string;
}

export function createAdminCreateInsurerUseCase<Trx>(deps: InsuranceDeps<Trx>) {
  return async function adminCreateInsurer(actor: ActorIdentity, input: AdminCreateInsurerInput, context: RequestContext): Promise<Insurer> {
    requirePlatformAdmin(actor);
    const name = assertValidInsurerName(input.name);
    const taxId = assertValidTaxId(input.taxId);

    return deps.withTransaction(async (trx) => {
      if (await deps.insurersRepo.findByTaxId(trx, taxId)) {
        throw duplicateTaxId();
      }
      const now = deps.clock.now();
      const insurer = await deps.insurersRepo.insert(trx, { id: newId(), name, taxId, createdBy: actor.userId, createdAt: now });
      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "PLATFORM_ADMIN",
        actorUserId: actor.userId,
        action: "ADMIN_INSURER_CREATE",
        resourceType: "Insurer",
        resourceId: insurer.id,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });
      return insurer;
    });
  };
}

export interface AdminUpdateInsurerInput {
  name?: string | null;
  taxId?: string | null;
}

export function createAdminUpdateInsurerUseCase<Trx>(deps: InsuranceDeps<Trx>) {
  return async function adminUpdateInsurer(actor: ActorIdentity, insurerId: string, input: AdminUpdateInsurerInput, context: RequestContext): Promise<Insurer> {
    requirePlatformAdmin(actor);
    const changes: InsurerChanges = {};
    if (input.name !== undefined && input.name !== null) changes.name = assertValidInsurerName(input.name);
    if (input.taxId !== undefined && input.taxId !== null) changes.taxId = assertValidTaxId(input.taxId);

    return deps.withTransaction(async (trx) => {
      const current = await requireInsurer(deps, trx, insurerId);
      if (changes.taxId !== undefined && changes.taxId !== current.taxId) {
        const other = await deps.insurersRepo.findByTaxId(trx, changes.taxId);
        if (other && other.id !== insurerId) {
          throw duplicateTaxId();
        }
      }
      const updated = await deps.insurersRepo.update(trx, insurerId, changes);
      await deps.audit.record(trx, {
        occurredAt: deps.clock.now(),
        actorType: "PLATFORM_ADMIN",
        actorUserId: actor.userId,
        action: "ADMIN_INSURER_UPDATE",
        resourceType: "Insurer",
        resourceId: insurerId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });
      return updated;
    });
  };
}

export interface AdminSetInsurerStatusInput {
  status: InsurerStatus;
}

/** BR-INS-10: suspender revoga de imediato as sessões de todas as contas da seguradora. */
export function createAdminSetInsurerStatusUseCase<Trx>(deps: InsuranceDeps<Trx>) {
  return async function adminSetInsurerStatus(actor: ActorIdentity, insurerId: string, input: AdminSetInsurerStatusInput, context: RequestContext): Promise<Insurer> {
    requirePlatformAdmin(actor);

    const updated = await deps.withTransaction(async (trx) => {
      await requireInsurer(deps, trx, insurerId);
      const now = deps.clock.now();
      const result = await deps.insurersRepo.updateStatus(trx, insurerId, input.status);
      if (input.status === "SUSPENDED") {
        await deps.insuranceSessionRepo.revokeAllForInsurer(trx, insurerId, now);
      }
      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "PLATFORM_ADMIN",
        actorUserId: actor.userId,
        action: "ADMIN_INSURER_STATUS",
        resourceType: "Insurer",
        resourceId: insurerId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
        metadata: { status: input.status },
      });
      return result;
    });
    deps.accountStateCache.clear();
    return updated;
  };
}

export interface AdminInsurerRootAccountInput {
  email: string;
}

/**
 * `POST /admin/insurers/{id}/root-account` (BR-INS-06): cria a conta `INSURANCE_ADMIN` raiz ou repõe-lhe
 * as credenciais (idempotente por seguradora, UNIQUE parcial). A palavra-passe é gerada pelo servidor e
 * só sai por e-mail. Repor revoga as sessões da conta (a credencial anterior deixa de valer).
 */
export function createAdminInsurerRootAccountUseCase<Trx>(deps: InsuranceDeps<Trx>) {
  return async function adminCreateOrResetInsurerRootAccount(
    actor: ActorIdentity,
    insurerId: string,
    input: AdminInsurerRootAccountInput,
    context: RequestContext,
  ): Promise<InsuranceAccount> {
    requirePlatformAdmin(actor);
    const email = input.email.trim().toLowerCase();

    const { account, password } = await deps.withTransaction(async (trx) => {
      await requireInsurer(deps, trx, insurerId);

      const existingByEmail = await deps.insuranceAccountRepo.findByEmail(trx, email);
      const existingAdmin = await deps.insuranceAccountRepo.findActiveAdminByInsurer(trx, insurerId);
      if (existingByEmail && existingByEmail.id !== existingAdmin?.id) {
        throw new ValidationError([{ field: "email", message: "já está em uso" }], { detail: "E-mail já associado a outra conta do portal." });
      }

      const now = deps.clock.now();
      const generatedPassword = generateInitialInsurancePassword();
      const passwordHash = await hashInsurancePassword(generatedPassword);

      let resultAccount: InsuranceAccount;
      if (existingAdmin) {
        resultAccount = await deps.insuranceAccountRepo.resetCredentials(trx, existingAdmin.id, { email, passwordHash }, now);
        await deps.insuranceSessionRepo.revokeAllForAccount(trx, existingAdmin.id, now);
      } else {
        resultAccount = await deps.insuranceAccountRepo.insert(trx, {
          id: newId(),
          insurerId,
          email,
          passwordHash,
          role: "INSURANCE_ADMIN",
          createdByPlatformAdmin: actor.userId,
          createdAt: now,
        });
      }

      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "PLATFORM_ADMIN",
        actorUserId: actor.userId,
        action: "ADMIN_INSURER_ROOT_ACCOUNT",
        resourceType: "InsuranceAccount",
        resourceId: resultAccount.id,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
        metadata: { reset: existingAdmin !== null },
      });

      return { account: resultAccount, password: generatedPassword };
    });
    deps.accountStateCache.invalidate(account.id);

    // Best effort: a conta já está gravada; o pedido é idempotente e pode ser repetido.
    await trySendInsuranceMail(deps.insuranceMailer, deps.logger, {
      to: account.email,
      subject: "Acesso ao Portal da Seguradora Vita Family",
      text: `A sua palavra-passe de acesso ao Portal da Seguradora é: ${password}`,
    });

    return account;
  };
}
