// openapi listInsurerPolicySettings (UC-SEG-19, BR-SEG-40): limites do Vita + valor efetivo da seguradora + exceções por serviço. Leitura.
import type { OpsActor } from "../domain/access.js";
import { describePolicySetting, type PolicySettingView } from "../domain/policy-setting.js";
import type { OpsDeps } from "./ports.js";
import { authorize } from "./support.js";

export function createListPolicySettingsUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function listPolicySettings(actor: OpsActor): Promise<PolicySettingView[]> {
    return deps.withTransaction(async (trx) => {
      await authorize(deps, trx, actor, "read");
      const stored = await deps.policySettings.list(trx, actor.insurerId);
      return (await deps.policySettings.definitions(trx)).map((definition) => describePolicySetting(definition, stored));
    });
  };
}
