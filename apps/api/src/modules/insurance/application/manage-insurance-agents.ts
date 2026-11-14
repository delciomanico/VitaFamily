// Hierarquia de contas do portal (BR-INS-06, UC-INS-05, authorization.md §8): só o `INSURANCE_ADMIN`
// da própria seguradora cria/lista/remove os seus `INSURANCE_AGENT`. openapi
// listInsuranceAgents/createInsuranceAgent/removeInsuranceAgent.
import { ValidationError } from "../../../platform/errors/index.js";
import { newId } from "../../../platform/ids/index.js";
import { auditContextFields } from "../../audit/index.js";
import type { InsuranceAccount } from "../domain/insurance-account.js";
import { generateInitialInsurancePassword, hashInsurancePassword } from "../domain/insurance-crypto.js";
import { assertCanManageAgents, assertRemovableAgentTarget, MANAGED_ACCOUNT_ROLES } from "../domain/insurance-staff-hierarchy.js";
import type { InsuranceDeps, InsurancePortalActor, RequestContext } from "./ports.js";
import { trySendInsuranceMail } from "./send-insurance-mail.js";

export interface CreateInsuranceAgentInput {
  email: string;
  /** Por omissão `INSURANCE_AGENT`; `BENEFICIARY_MANAGER` só com o módulo operacional ativo (ADR-025, Fase A). */
  role?: string | null;
}

/** Palavra-passe gerada pelo servidor, só por e-mail. */
export function createCreateInsuranceAgentUseCase<Trx>(deps: InsuranceDeps<Trx>) {
  return async function createInsuranceAgent(actor: InsurancePortalActor, input: CreateInsuranceAgentInput, context: RequestContext): Promise<InsuranceAccount> {
    assertCanManageAgents(actor);
    const email = input.email.trim().toLowerCase();
    const role = input.role ?? "INSURANCE_AGENT";
    if (role !== "INSURANCE_AGENT" && role !== "BENEFICIARY_MANAGER") {
      throw new ValidationError([{ field: "role", message: "INSURANCE_AGENT ou BENEFICIARY_MANAGER" }], { detail: "Papel inválido." });
    }

    const { account, password } = await deps.withTransaction(async (trx) => {
      if (role === "BENEFICIARY_MANAGER" && (await deps.insurersRepo.findById(trx, actor.insurerId))?.operationalModuleEnabled !== true) {
        throw new ValidationError([{ field: "role", message: "requer o módulo operacional ativo" }], { detail: "O módulo operacional não está ativo nesta seguradora." });
      }
      if (await deps.insuranceAccountRepo.findByEmail(trx, email)) {
        throw new ValidationError([{ field: "email", message: "já está em uso" }], { detail: "E-mail já associado a outra conta do portal." });
      }
      const now = deps.clock.now();
      const generatedPassword = generateInitialInsurancePassword();
      const newAccount = await deps.insuranceAccountRepo.insert(trx, {
        id: newId(),
        insurerId: actor.insurerId,
        email,
        passwordHash: await hashInsurancePassword(generatedPassword),
        role,
        createdAt: now,
      });
      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "INSURANCE_ACCOUNT",
        actorInsuranceAccountId: actor.insuranceAccountId,
        action: role === "INSURANCE_AGENT" ? "INSURANCE_AGENT_CREATE" : "INSURER_ACCOUNT_CREATE",
        resourceType: "InsuranceAccount",
        resourceId: newAccount.id,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
        ...(role === "INSURANCE_AGENT" ? {} : { metadata: { insurerId: actor.insurerId, role } }),
      });
      return { account: newAccount, password: generatedPassword };
    });

    await trySendInsuranceMail(deps.insuranceMailer, deps.logger, {
      to: account.email,
      subject: "Acesso ao Portal da Seguradora Vita Family",
      text: `A sua palavra-passe de acesso ao Portal da Seguradora é: ${password}`,
    });
    return account;
  };
}

/** `GET /insurance-portal/agents`: `INSURANCE_AGENT` e `BENEFICIARY_MANAGER` da própria seguradora (nunca o `INSURANCE_ADMIN`). */
export function createListInsuranceAgentsUseCase<Trx>(deps: InsuranceDeps<Trx>) {
  return async function listInsuranceAgents(actor: InsurancePortalActor): Promise<InsuranceAccount[]> {
    assertCanManageAgents(actor);
    return deps.withTransaction((trx) => deps.insuranceAccountRepo.listByInsurer(trx, actor.insurerId, MANAGED_ACCOUNT_ROLES));
  };
}

/** `DELETE /insurance-portal/agents/{id}`: só remove `INSURANCE_AGENT` da própria seguradora. */
export function createRemoveInsuranceAgentUseCase<Trx>(deps: InsuranceDeps<Trx>) {
  return async function removeInsuranceAgent(actor: InsurancePortalActor, insuranceAccountId: string, context: RequestContext): Promise<void> {
    assertCanManageAgents(actor);

    await deps.withTransaction(async (trx) => {
      const target = assertRemovableAgentTarget(actor, await deps.insuranceAccountRepo.findById(trx, insuranceAccountId));
      await deps.insuranceAccountRepo.delete(trx, insuranceAccountId);
      await deps.audit.record(trx, {
        occurredAt: deps.clock.now(),
        actorType: "INSURANCE_ACCOUNT",
        actorInsuranceAccountId: actor.insuranceAccountId,
        action: target.role === "INSURANCE_AGENT" ? "INSURANCE_AGENT_REMOVE" : "INSURER_ACCOUNT_REMOVE",
        resourceType: "InsuranceAccount",
        resourceId: insuranceAccountId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
        ...(target.role === "INSURANCE_AGENT" ? {} : { metadata: { insurerId: actor.insurerId, role: target.role } }),
      });
    });
    deps.accountStateCache.invalidate(insuranceAccountId);
  };
}
