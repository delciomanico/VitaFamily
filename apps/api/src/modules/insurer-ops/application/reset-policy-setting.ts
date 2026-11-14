// openapi resetInsurerPolicySetting (UC-SEG-19, BR-SEG-40): apaga a definição (da seguradora ⇒ omissão do Vita; do serviço ⇒ valor da
// seguradora). Idempotente (204); auditoria só quando algo foi apagado.
import type { OpsActor } from "../domain/access.js";
import { requireDefinition, resolvePolicySetting } from "../domain/policy-setting.js";
import { requireUuid } from "../domain/validation.js";
import type { OpsDeps, RequestContext } from "./ports.js";
import { auditEvent, authorize, notFound } from "./support.js";

export function createResetPolicySettingUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function resetPolicySetting(actor: OpsActor, key: string, query: { serviceId?: string | undefined }, context: RequestContext): Promise<void> {
    return deps.withTransaction(async (trx) => {
      await authorize(deps, trx, actor, "admin");
      const definition = requireDefinition(await deps.policySettings.definitions(trx), key);
      const serviceId = query.serviceId === undefined ? undefined : requireUuid(query.serviceId, "serviceId");
      if (serviceId !== undefined && !(await deps.services.findById(trx, actor.insurerId, serviceId))) throw notFound();

      const previous = await deps.policySettings.remove(trx, actor.insurerId, key, serviceId ?? null);
      if (previous === null) return;
      const to = resolvePolicySetting(definition, await deps.policySettings.list(trx, actor.insurerId), serviceId).value;
      await deps.audit.record(
        trx,
        auditEvent(deps, actor, context, { action: "INSURER_POLICY_SETTING_RESET", resourceType: "InsurerPolicySetting", metadata: { key, ...(serviceId === undefined ? {} : { serviceId }), from: previous, to } }),
      );
    });
  };
}
