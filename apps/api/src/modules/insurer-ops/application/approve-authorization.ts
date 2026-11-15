// openapi approveInsurerAuthorization (UC-SEG-07, BR-AUT-04/07/17/18): `IN_REVIEW → APPROVED` pelo analista (pedidos normais) ou pelo
// supervisor (recursos). Valor ≤ pedido e ≤ saldo (sem consumo, ADR-035 §7); em parte exige `note` visível; carência/limite exige
// `overrideReason` INTERNO; validade por política em dados; cobertura vermelha agora ⇒ 422. Código gerado (BR-SEG-05).
import type { OpsActor } from "../domain/access.js";
import { generateAuthorizationCode } from "../domain/authorization-code.js";
import { decideApproval, parseApproveInput } from "../domain/authorization-decision.js";
import { requireDefinition } from "../domain/policy-setting.js";
import { claimIfFreeAnalyst, decisionRole, loadForDecision, reloadDetail, requireAction } from "./insurer-authorization-support.js";
import { POLICY_KEYS, policyValue, recordTransition } from "./authorization-support.js";
import { conflictOnDecisionLost } from "./decision-support.js";
import type { OpsDeps, RequestContext } from "./ports.js";
import { coverageOnDate } from "./submit-authorization.js";
import { auditEvent, authorize } from "./support.js";

export function createApproveAuthorizationUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function approveAuthorization(actor: OpsActor, authorizationId: string, body: unknown, context: RequestContext) {
    const input = parseApproveInput(body);
    return deps.withTransaction(async (trx) => {
      const { currency } = await authorize(deps, trx, actor, "authorizations-decide");
      const { row, appealDays, now } = await loadForDecision(deps, trx, actor, authorizationId);
      requireAction("APPROVE", actor, row, appealDays, now);

      // Cobertura AGORA (estado/apólice/serviço podem ter mudado): a mesma `evaluateCoverage` da criação (ADR-033).
      const coverage = await coverageOnDate(deps, trx, actor.insurerId, row.beneficiaryId, { id: row.serviceId, status: row.serviceStatus }, row.expectedOn);
      const definition = requireDefinition(await deps.policySettings.definitions(trx), POLICY_KEYS.validityDays);
      const approval = decideApproval(
        input,
        row,
        coverage ?? { reason: "BENEFICIARY_NOT_ACTIVE", requiresAuthorization: false, remainingMinor: null },
        { defaultDays: await policyValue(deps, trx, actor.insurerId, POLICY_KEYS.validityDays), maxDays: definition.max },
        now,
      );

      const decidedBy = decisionRole(actor);
      await claimIfFreeAnalyst(deps, trx, actor, row, now);
      const written = await deps.insurerAuthorizations.decide(trx, actor.insurerId, row.id, "IN_REVIEW", {
        kind: "APPROVE",
        authorizedAmount: approval.authorizedAmount,
        code: generateAuthorizationCode(),
        validUntil: approval.validUntil,
        note: input.note,
        decidedBy,
        accountId: actor.insuranceAccountId,
        now,
      });
      if (!written) throw conflictOnDecisionLost();
      await recordTransition(deps, trx, { insurerId: actor.insurerId, authorizationId: row.id, from: "IN_REVIEW", to: "APPROVED", actor: decidedBy, actorAccountId: actor.insuranceAccountId, note: input.note, internalNote: input.overrideReason, now });
      await deps.audit.record(trx, auditEvent(deps, actor, context, { action: "AUTHORIZATION_APPROVE", resourceType: "AuthorizationRequest", resourceId: row.id, metadata: { decidedBy, partial: approval.partial, override: approval.override } }));
      return reloadDetail(deps, trx, actor, row.id, currency);
    });
  };
}
