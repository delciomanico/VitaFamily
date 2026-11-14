// openapi createAuthorizationRequest (UC-SEG-06, BR-AUT-01/02/06/09/12/16, BR-SEG-18/29): a clínica pede autorização a uma
// seguradora a que está ligada. O beneficiário identifica-se como na elegibilidade e é revalidado no servidor (mesmo rate limit,
// mesmo 404 único); só um serviço AMARELO cria pedido. Ator `ClinicAccount`: Admin/Gestor.
import { RateLimitedError } from "../../../platform/errors/index.js";
import { assertClinicRole, type ClinicOpsActor } from "../domain/access.js";
import { parseCreateAuthorizationInput } from "../domain/authorization.js";
import { evaluateEligibility } from "../domain/coverage.js";
import { toViews, type AuthorizationView } from "./authorization-support.js";
import { consumeLookupRateLimit, findBeneficiary, notFoundError } from "./beneficiary-lookup.js";
import { authorizeClinic } from "./clinic-portal.js";
import type { OpsDeps, RequestContext } from "./ports.js";
import { gateRejection, lightOnDate, resolveGuideType, submitAuthorization } from "./submit-authorization.js";

export function createCreateAuthorizationUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function createAuthorization(actor: ClinicOpsActor, body: unknown, context: RequestContext): Promise<AuthorizationView> {
    assertClinicRole(actor.role);
    const today = deps.clock.now().toISOString().slice(0, 10);
    const input = parseCreateAuthorizationInput(body, today);
    const outcome = await deps.withTransaction(async (trx): Promise<{ limitedMs: number } | { view: AuthorizationView }> => {
      await authorizeClinic(deps, trx, actor, input.insurerId);
      const limitedMs = await consumeLookupRateLimit(deps, trx, actor, input.insurerId, context);
      if (limitedMs !== null) return { limitedMs };

      // Revalidação como na elegibilidade (hoje): inexistente, inelegível ou QR inválido ⇒ o mesmo 404, sem motivo (BR-SEG-18).
      const candidate = await findBeneficiary(deps, trx, input.insurerId, input.identification.by, today);
      if (!candidate?.policy || !evaluateEligibility({ status: candidate.status, policy: candidate.policy }, today).eligible) throw notFoundError();
      const providerId = await deps.authorizations.activeProviderId(trx, actor.clinicId, input.insurerId);
      if (providerId === null) throw notFoundError();

      // Serviço desconhecido, VERMELHO e VERDE dão a MESMA recusa (BR-AUT-02): a razão nunca sai.
      const service = await deps.authorizations.findServiceByCode(trx, input.insurerId, input.identification.serviceCode ?? "");
      if (service === null) throw gateRejection();
      const light = await lightOnDate(deps, trx, input.insurerId, candidate.beneficiaryId, service, input.expectedOn);
      if (light !== "YELLOW") throw gateRejection();
      const guideType = await resolveGuideType(deps, trx, service, input.guideType);

      const id = await submitAuthorization(deps, trx, {
        actor,
        context,
        insurerId: input.insurerId,
        beneficiaryId: candidate.beneficiaryId,
        providerId,
        service,
        guideType,
        requestedAmount: input.requestedAmount,
        expectedOn: input.expectedOn,
        justification: input.justification,
        processId: input.processId,
        parentRequestId: null,
        light,
      });
      const row = await deps.authorizations.findForClinic(trx, actor.clinicId, id);
      if (!row) throw new Error("pedido inexistente logo após a escrita");
      const [view] = await toViews(deps, trx, [row], false);
      if (!view) throw new Error("vista inexistente");
      return { view };
    });
    if ("limitedMs" in outcome) throw new RateLimitedError(outcome.limitedMs, { detail: "Demasiadas validações. Tente novamente mais tarde." });
    return outcome.view;
  };
}
