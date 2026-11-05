// Hierarquia de contas do portal (BR-INS-06, UC-INS-05, authorization.md §8): só o `INSURANCE_ADMIN`
// da própria seguradora cria/lista/remove os seus `INSURANCE_AGENT`. openapi
// listInsuranceAgents/createInsuranceAgent/removeInsuranceAgent.
import { ValidationError } from "../../../platform/errors/index.js";
import { newId } from "../../../platform/ids/index.js";
import { auditContextFields } from "../../audit/index.js";
import type { InsuranceAccount } from "../domain/insurance-account.js";
import { generateInitialInsurancePassword, hashInsurancePassword } from "../domain/insurance-crypto.js";
import { assertCanManageAgents, assertRemovableAgentTarget } from "../domain/insurance-staff-hierarchy.js";
import type { InsuranceDeps, InsurancePortalActor, RequestContext } from "./ports.js";
import { trySendInsuranceMail } from "./send-insurance-mail.js";

export interface CreateInsuranceAgentInput {
  email: string;
}

/** A conta criada é sempre `INSURANCE_AGENT`; palavra-passe gerada pelo servidor, só por e-mail. */
export function createCreateInsuranceAgentUseCase<Trx>(deps: InsuranceDeps<Trx>) {
  return async function createInsuranceAgent(actor: InsurancePortalActor, input: CreateInsuranceAgentInput, context: RequestContext): Promise<InsuranceAccount> {
    assertCanManageAgents(actor);
    const email = input.email.trim().toLowerCase();

    const { account, password } = await deps.withTransaction(async (trx) => {
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
        role: "INSURANCE_AGENT",
        createdAt: now,
      });
      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "INSURANCE_ACCOUNT",
        actorInsuranceAccountId: actor.insuranceAccountId,
        action: "INSURANCE_AGENT_CREATE",
        resourceType: "InsuranceAccount",
        resourceId: newAccount.id,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
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

/** `GET /insurance-portal/agents`: só `INSURANCE_AGENT` da própria seguradora. */
export function createListInsuranceAgentsUseCase<Trx>(deps: InsuranceDeps<Trx>) {
  return async function listInsuranceAgents(actor: InsurancePortalActor): Promise<InsuranceAccount[]> {
    assertCanManageAgents(actor);
    return deps.withTransaction((trx) => deps.insuranceAccountRepo.listByInsurer(trx, actor.insurerId, "INSURANCE_AGENT"));
  };
}

/** `DELETE /insurance-portal/agents/{id}`: só remove `INSURANCE_AGENT` da própria seguradora. */
export function createRemoveInsuranceAgentUseCase<Trx>(deps: InsuranceDeps<Trx>) {
  return async function removeInsuranceAgent(actor: InsurancePortalActor, insuranceAccountId: string, context: RequestContext): Promise<void> {
    assertCanManageAgents(actor);

    await deps.withTransaction(async (trx) => {
      assertRemovableAgentTarget(actor, await deps.insuranceAccountRepo.findById(trx, insuranceAccountId));
      await deps.insuranceAccountRepo.delete(trx, insuranceAccountId);
      await deps.audit.record(trx, {
        occurredAt: deps.clock.now(),
        actorType: "INSURANCE_ACCOUNT",
        actorInsuranceAccountId: actor.insuranceAccountId,
        action: "INSURANCE_AGENT_REMOVE",
        resourceType: "InsuranceAccount",
        resourceId: insuranceAccountId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });
    });
    deps.accountStateCache.invalidate(insuranceAccountId);
  };
}
