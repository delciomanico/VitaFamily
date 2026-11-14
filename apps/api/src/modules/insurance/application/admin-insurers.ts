// openapi `adminListInsurers`/`adminCreateInsurer`/`adminUpdateInsurer`/`adminSetInsurerStatus`/
// `adminCreateOrResetInsurerRootAccount` (BR-ADM-05/06, BR-INS-06/10, ADR-021/ADR-023): só
// PLATFORM_ADMIN, nunca dados de saúde. Sem eliminação (schema.md §8). Mirror de `admin-clinics.ts`.
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../../platform/errors/index.js";
import { newId } from "../../../platform/ids/index.js";
import { auditContextFields } from "../../audit/index.js";
import type { InsuranceAccount } from "../domain/insurance-account.js";
import { generateInitialInsurancePassword, hashInsurancePassword } from "../domain/insurance-crypto.js";
import { assertValidCurrency, assertValidInsurerName, assertValidTaxId, DEFAULT_INSURER_CURRENCY, type Insurer, type InsurerStatus } from "../domain/insurer.js";
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
  /** ISO 4217; por omissão `AOA` (BR-SEG-19). */
  currency?: string | null;
  /** Por omissão `false` (ADR-025). */
  operationalModuleEnabled?: boolean | null;
}

export function createAdminCreateInsurerUseCase<Trx>(deps: InsuranceDeps<Trx>) {
  return async function adminCreateInsurer(actor: ActorIdentity, input: AdminCreateInsurerInput, context: RequestContext): Promise<Insurer> {
    requirePlatformAdmin(actor);
    const name = assertValidInsurerName(input.name);
    const taxId = assertValidTaxId(input.taxId);
    const currency = assertValidCurrency(input.currency ?? DEFAULT_INSURER_CURRENCY);
    const operationalModuleEnabled = input.operationalModuleEnabled ?? false;

    return deps.withTransaction(async (trx) => {
      if (await deps.insurersRepo.findByTaxId(trx, taxId)) {
        throw duplicateTaxId();
      }
      const now = deps.clock.now();
      const insurer = await deps.insurersRepo.insert(trx, { id: newId(), name, taxId, currency, operationalModuleEnabled, createdBy: actor.userId, createdAt: now });
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
  currency?: string | null;
  operationalModuleEnabled?: boolean | null;
}

export function createAdminUpdateInsurerUseCase<Trx>(deps: InsuranceDeps<Trx>) {
  return async function adminUpdateInsurer(actor: ActorIdentity, insurerId: string, input: AdminUpdateInsurerInput, context: RequestContext): Promise<Insurer> {
    requirePlatformAdmin(actor);
    const changes: InsurerChanges = {};
    if (input.name !== undefined && input.name !== null) changes.name = assertValidInsurerName(input.name);
    if (input.taxId !== undefined && input.taxId !== null) changes.taxId = assertValidTaxId(input.taxId);
    if (input.currency !== undefined && input.currency !== null) changes.currency = assertValidCurrency(input.currency);
    if (input.operationalModuleEnabled !== undefined && input.operationalModuleEnabled !== null) changes.operationalModuleEnabled = input.operationalModuleEnabled;

    return deps.withTransaction(async (trx) => {
      const current = await requireInsurer(deps, trx, insurerId);
      const currencyChanged = changes.currency !== undefined && changes.currency !== current.currency;
      // BR-SEG-19: sem conversão; mudar a moeda com beneficiários/apólices criados deixaria valores na moeda errada.
      if (currencyChanged && (await deps.operationalData.hasData(trx, insurerId))) {
        throw new ConflictError({ detail: "A moeda não pode mudar: a seguradora já tem beneficiários ou apólices." });
      }
      const moduleChanged = changes.operationalModuleEnabled !== undefined && changes.operationalModuleEnabled !== current.operationalModuleEnabled;
      if (changes.taxId !== undefined && changes.taxId !== current.taxId) {
        const other = await deps.insurersRepo.findByTaxId(trx, changes.taxId);
        if (other && other.id !== insurerId) {
          throw duplicateTaxId();
        }
      }
      const updated = await deps.insurersRepo.update(trx, insurerId, changes);
      const now = deps.clock.now();
      const base = {
        occurredAt: now,
        actorType: "PLATFORM_ADMIN" as const,
        actorUserId: actor.userId,
        resourceType: "Insurer",
        resourceId: insurerId,
        result: "SUCCESS" as const,
        requestId: context.requestId,
        ...auditContextFields(context),
      };
      await deps.audit.record(trx, { ...base, action: "ADMIN_INSURER_UPDATE" });
      if (currencyChanged) {
        await deps.audit.record(trx, { ...base, action: "ADMIN_INSURER_CURRENCY_UPDATE", metadata: { insurerId, currency: updated.currency } });
      }
      if (moduleChanged) {
        await deps.audit.record(trx, { ...base, action: updated.operationalModuleEnabled ? "ADMIN_INSURER_MODULE_ENABLE" : "ADMIN_INSURER_MODULE_DISABLE", metadata: { insurerId } });
      }
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
