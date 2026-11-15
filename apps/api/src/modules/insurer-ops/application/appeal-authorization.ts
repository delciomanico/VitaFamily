// openapi appealAuthorizationRequest (BR-AUT-08): o recurso é um NOVO pedido (`parentRequestId`) sobre um `REJECTED`, dentro de
// `APPEAL_REQUEST_DAYS` (por política); herda beneficiário, serviço, guia e processo; o recusado não muda. Mesmo semáforo da criação.
import { ConflictError, DomainError, RateLimitedError } from "../../../platform/errors/index.js";
import type { ClinicOpsActor } from "../domain/access.js";
import { appealOpenUntil, parseAppealInput } from "../domain/authorization.js";
import { toEligibilityLight } from "../domain/coverage.js";
import { fail } from "../domain/validation.js";
import { loadForWrite, POLICY_KEYS, policyValue, toViews, type AuthorizationView } from "./authorization-support.js";
import { consumeLookupRateLimit } from "./beneficiary-lookup.js";
import type { OpsDeps, RequestContext } from "./ports.js";
import { coverageOnDate, gateRejection, submitAuthorization } from "./submit-authorization.js";

export function createAppealAuthorizationUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function appealAuthorization(actor: ClinicOpsActor, authorizationId: string, body: unknown, context: RequestContext): Promise<AuthorizationView> {
    const today = deps.clock.now().toISOString().slice(0, 10);
    const input = parseAppealInput(body, today);
    const outcome = await deps.withTransaction(async (trx): Promise<{ limitedMs: number } | { view: AuthorizationView }> => {
      const { row } = await loadForWrite(deps, trx, actor, authorizationId);
      if (row.status !== "REJECTED") throw new DomainError("INVALID_STATE_TRANSITION", { detail: "Só se pode recorrer de um pedido recusado." });
      const until = appealOpenUntil(row, await policyValue(deps, trx, row.insurerId, POLICY_KEYS.appealDays));
      if (until === null || deps.clock.now().getTime() > until.getTime()) throw new ConflictError({ detail: "Prazo de recurso terminado." });
      if (row.hasLiveAppeal) throw new ConflictError({ detail: "Já existe um recurso em curso para este pedido." });

      const limitedMs = await consumeLookupRateLimit(deps, trx, actor, row.insurerId, context);
      if (limitedMs !== null) return { limitedMs };

      const expectedOn = input.expectedOn ?? row.expectedOn;
      if (expectedOn < today) fail("expectedOn", "não pode ser uma data passada");
      const service = await deps.authorizations.findServiceByCode(trx, row.insurerId, row.serviceCode);
      if (service === null) throw gateRejection();
      const coverage = await coverageOnDate(deps, trx, row.insurerId, row.beneficiaryId, service, expectedOn);
      const light = coverage === null ? "RED" : toEligibilityLight(coverage);
      if (coverage === null || light !== "YELLOW") throw gateRejection();

      const id = await submitAuthorization(deps, trx, {
        actor,
        context,
        insurerId: row.insurerId,
        beneficiaryId: row.beneficiaryId,
        providerId: row.providerId,
        service,
        // O pedido herda o tipo de guia GUARDADO (reclassificar depois o serviço não o altera, TC-AUT-05).
        guideType: row.guideType,
        requestedAmount: input.requestedAmount ?? row.requestedAmount,
        expectedOn,
        justification: input.justification,
        processId: row.processId,
        parentRequestId: row.id,
        light,
        coverage,
      });
      const created = await deps.authorizations.findForClinic(trx, actor.clinicId, id);
      const [view] = await toViews(deps, trx, created ? [created] : [], false);
      if (!view) throw new Error("pedido inexistente logo após a escrita");
      return { view };
    });
    if ("limitedMs" in outcome) throw new RateLimitedError(outcome.limitedMs, { detail: "Demasiadas validações. Tente novamente mais tarde." });
    return outcome.view;
  };
}
