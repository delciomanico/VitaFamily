// openapi setInsurerPolicySetting (UC-SEG-19, BR-SEG-40): INSURANCE_ADMIN e, desde a fatia 4, SUPERVISOR (§8.2b).
// Valor inteiro entre mín. e máx. do Vita; `serviceId` só em chaves com escopo por serviço e da própria seguradora; idempotente.
import type { OpsActor } from "../domain/access.js";
import { assertServiceScope, assertWithinLimits, describePolicySetting, requireDefinition, resolvePolicySetting, type PolicySettingView } from "../domain/policy-setting.js";
import { requireUuid } from "../domain/validation.js";
import type { OpsDeps, RequestContext } from "./ports.js";
import { auditEvent, authorize, notFound } from "./support.js";

export function createSetPolicySettingUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function setPolicySetting(actor: OpsActor, key: string, input: { value?: unknown; serviceId?: unknown }, context: RequestContext): Promise<PolicySettingView> {
    return deps.withTransaction(async (trx) => {
      await authorize(deps, trx, actor, "policy-write");
      const definition = requireDefinition(await deps.policySettings.definitions(trx), key);
      const serviceId = input.serviceId === undefined || input.serviceId === null ? undefined : requireUuid(input.serviceId, "serviceId");
      assertServiceScope(definition, serviceId);
      const value = assertWithinLimits(definition, input.value);
      if (serviceId !== undefined && !(await deps.services.findById(trx, actor.insurerId, serviceId))) throw notFound();

      const before = await deps.policySettings.list(trx, actor.insurerId);
      const from = resolvePolicySetting(definition, before, serviceId).value;
      const { previous } = await deps.policySettings.upsert(trx, { insurerId: actor.insurerId, key, serviceId: serviceId ?? null, value, accountId: actor.insuranceAccountId, now: deps.clock.now() });
      if (previous !== value) {
        await deps.audit.record(
          trx,
          auditEvent(deps, actor, context, { action: "INSURER_POLICY_SETTING_UPDATE", resourceType: "InsurerPolicySetting", metadata: { key, ...(serviceId === undefined ? {} : { serviceId }), from, to: value } }),
        );
      }
      return describePolicySetting(definition, await deps.policySettings.list(trx, actor.insurerId));
    });
  };
}
