// openapi listAutoApprovalRules / createAutoApprovalRule / updateAutoApprovalRule / deleteAutoApprovalRule (UC-SEG-21, BR-AUT-03/23):
// regras SIMPLES da seguradora (alvo + valor máximo); uma ativa por alvo (UNIQUE parcial, também sob corrida); não retroativas; sem
// regras ativas não há auto-aprovação. Escrita só do SUPERVISOR; leitura SUPERVISOR, INSURANCE_ADMIN e AUTHORIZATION_ANALYST.
import { DomainError } from "../../../platform/errors/index.js";
import { newId } from "../../../platform/ids/index.js";
import type { OpsActor } from "../domain/access.js";
import { MAX_RULES_PER_INSURER, parseRuleInput, parseRulePatch } from "../domain/authorization-decision.js";
import { assertAssignable } from "../domain/service-kind.js";
import { requireUuid } from "../domain/validation.js";
import type { AutoApprovalRuleRecord, OpsDeps, RequestContext } from "./ports.js";
import { auditEvent, authorize, invalidReference, notFound } from "./support.js";

export interface AutoApprovalRuleView {
  id: string;
  name: string;
  scope: "SERVICE_KIND" | "SERVICE";
  serviceKindId: string | null;
  serviceId: string | null;
  targetName: string;
  maxAmount: number;
  currency: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function toView(rule: AutoApprovalRuleRecord, currency: string): AutoApprovalRuleView {
  return {
    id: rule.id,
    name: rule.name,
    scope: rule.serviceId === null ? "SERVICE_KIND" : "SERVICE",
    serviceKindId: rule.serviceKindId,
    serviceId: rule.serviceId,
    targetName: rule.targetName,
    maxAmount: rule.maxAmountMinor / 100,
    currency,
    active: rule.active,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  };
}

export function createListAutoApprovalRulesUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function listAutoApprovalRules(actor: OpsActor): Promise<AutoApprovalRuleView[]> {
    return deps.withTransaction(async (trx) => {
      const { currency } = await authorize(deps, trx, actor, "rules-read");
      return (await deps.autoApprovalRules.list(trx, actor.insurerId)).map((rule) => toView(rule, currency));
    });
  };
}

export function createCreateAutoApprovalRuleUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function createAutoApprovalRule(actor: OpsActor, body: unknown, context: RequestContext): Promise<AutoApprovalRuleView> {
    const input = parseRuleInput(body);
    return deps.withTransaction(async (trx) => {
      const { currency } = await authorize(deps, trx, actor, "rules-write");
      if (input.serviceKindId !== null) assertAssignable(await deps.serviceKinds.findById(trx, actor.insurerId, input.serviceKindId), "serviceKindId");
      if (input.serviceId !== null && (await deps.services.findById(trx, actor.insurerId, input.serviceId))?.status !== "ACTIVE") throw invalidReference("serviceId", "serviço inexistente ou inativo");
      if ((await deps.autoApprovalRules.count(trx, actor.insurerId)) >= MAX_RULES_PER_INSURER) throw new DomainError("LIMIT_EXCEEDED", { detail: "Máximo de 100 regras por seguradora." });
      const id = newId();
      await deps.autoApprovalRules.insert(trx, { id, insurerId: actor.insurerId, name: input.name, serviceKindId: input.serviceKindId, serviceId: input.serviceId, maxAmount: input.maxAmount, active: input.active, accountId: actor.insuranceAccountId, now: deps.clock.now() });
      await deps.audit.record(
        trx,
        auditEvent(deps, actor, context, {
          action: "AUTO_APPROVAL_RULE_CREATE",
          resourceType: "AutoApprovalRule",
          resourceId: id,
          metadata: { scope: input.serviceId === null ? "SERVICE_KIND" : "SERVICE", active: input.active, maxAmountTo: input.maxAmount },
        }),
      );
      const created = await deps.autoApprovalRules.find(trx, actor.insurerId, id);
      if (!created) throw new Error("regra inexistente logo após a escrita");
      return toView(created, currency);
    });
  };
}

export function createUpdateAutoApprovalRuleUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function updateAutoApprovalRule(actor: OpsActor, ruleId: string, body: unknown, context: RequestContext): Promise<AutoApprovalRuleView> {
    requireUuid(ruleId, "ruleId");
    const patch = parseRulePatch(body);
    return deps.withTransaction(async (trx) => {
      const { currency } = await authorize(deps, trx, actor, "rules-write");
      const before = await deps.autoApprovalRules.find(trx, actor.insurerId, ruleId);
      if (!before) throw notFound();
      // Reativar com outra regra ativa no mesmo alvo ⇒ `ConflictError` (UNIQUE parcial).
      await deps.autoApprovalRules.update(trx, actor.insurerId, ruleId, patch, actor.insuranceAccountId, deps.clock.now());
      await deps.audit.record(
        trx,
        auditEvent(deps, actor, context, {
          action: "AUTO_APPROVAL_RULE_UPDATE",
          resourceType: "AutoApprovalRule",
          resourceId: ruleId,
          metadata: {
            scope: before.serviceId === null ? "SERVICE_KIND" : "SERVICE",
            fields: Object.keys(patch).filter((key) => key !== "name").join(",") + (patch.name !== undefined ? ",name" : ""),
            activeFrom: before.active,
            activeTo: patch.active ?? before.active,
            maxAmountFrom: before.maxAmountMinor / 100,
            maxAmountTo: patch.maxAmount ?? before.maxAmountMinor / 100,
          },
        }),
      );
      const updated = await deps.autoApprovalRules.find(trx, actor.insurerId, ruleId);
      if (!updated) throw new Error("regra inexistente logo após a escrita");
      return toView(updated, currency);
    });
  };
}

export function createDeleteAutoApprovalRuleUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function deleteAutoApprovalRule(actor: OpsActor, ruleId: string, context: RequestContext): Promise<void> {
    requireUuid(ruleId, "ruleId");
    await deps.withTransaction(async (trx) => {
      await authorize(deps, trx, actor, "rules-write");
      const before = await deps.autoApprovalRules.find(trx, actor.insurerId, ruleId);
      // Idempotente: 204 mesmo que já não exista; auditoria só quando algo foi apagado (os pedidos decididos mantêm o rasto).
      if (!before || !(await deps.autoApprovalRules.remove(trx, actor.insurerId, ruleId))) return;
      await deps.audit.record(
        trx,
        auditEvent(deps, actor, context, { action: "AUTO_APPROVAL_RULE_DELETE", resourceType: "AutoApprovalRule", resourceId: ruleId, metadata: { scope: before.serviceId === null ? "SERVICE_KIND" : "SERVICE", active: before.active } }),
      );
    });
  };
}
