// openapi listClinicInsurers / checkInsurerEligibility / listClinicInsurerServices (UC-SEG-05, BR-SEG-01/02/04/18/22/23,
// authorization.md §8.4). Ator `ClinicAccount` (token da clínica; nunca `AccessPolicy`): CLINIC_ADMIN e CLINIC_MANAGER; o Médico
// ⇒ FORBIDDEN. A clínica só opera em seguradoras a que está ligada (insurer_providers ativo) e com módulo ativo; senão NOT_FOUND.
import { NotFoundError, RateLimitedError } from "../../../platform/errors/index.js";
import type { Page } from "../../../platform/page/index.js";
import { assertClinicRole, type ClinicOpsActor } from "../domain/access.js";
import { evaluateEligibility, type EligibilityLight } from "../domain/coverage.js";
import {
  ELIGIBILITY_NOTICE,
  NOT_ELIGIBLE_RESULT,
  parseEligibilityRequest,
  coverageLimitsFor,
  trafficLightFor,
  type EligibilityResult,
} from "../domain/eligibility.js";
import type { InsurerService } from "../domain/service.js";
import { consumeLookupRateLimit, eligibilityAudit, findBeneficiary } from "./beneficiary-lookup.js";
import type { OpsDeps, RequestContext } from "./ports.js";
import { toPage, toPageQuery, type PageInput } from "./support.js";

export interface ClinicInsurer {
  id: string;
  name: string;
  currency: string;
}

/** §8.4 (b): ligação ATIVA da clínica à seguradora + módulo ativo + seguradora ativa; senão `NOT_FOUND` (sem enumeração). */
export async function authorizeClinic<Trx>(deps: OpsDeps<Trx>, trx: Trx, actor: ClinicOpsActor, insurerId: string): Promise<{ currency: string }> {
  assertClinicRole(actor.role);
  const linked = await deps.providers.isActivelyLinked(trx, actor.clinicId, insurerId);
  const settings = await deps.insurers.get(trx, insurerId);
  if (!linked || !settings || !settings.operationalModuleEnabled || settings.status !== "ACTIVE") {
    throw new NotFoundError({ detail: "Recurso não encontrado." });
  }
  return { currency: settings.currency };
}

export function createListClinicInsurersUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function listClinicInsurers(actor: ClinicOpsActor): Promise<ClinicInsurer[]> {
    assertClinicRole(actor.role);
    return deps.withTransaction(async (trx) => {
      const result: ClinicInsurer[] = [];
      for (const insurerId of await deps.providers.activeInsurerIdsOfClinic(trx, actor.clinicId)) {
        const settings = await deps.insurers.get(trx, insurerId);
        if (settings?.operationalModuleEnabled === true && settings.status === "ACTIVE") result.push({ id: insurerId, name: settings.name, currency: settings.currency });
      }
      return result.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    });
  };
}

export function createCheckEligibilityUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function checkEligibility(actor: ClinicOpsActor, insurerId: string, input: Record<string, unknown>, context: RequestContext): Promise<EligibilityResult> {
    assertClinicRole(actor.role);
    const request = parseEligibilityRequest(input);
    const outcome = await deps.withTransaction(async (trx): Promise<{ limitedMs: number } | { result: EligibilityResult }> => {
      const { currency } = await authorizeClinic(deps, trx, actor, insurerId);
      const today = deps.clock.now().toISOString().slice(0, 10);

      // BR-SEG-18: rate limit por conta de clínica e por IP; cada validação conta (também `eligible:false`).
      const limitedMs = await consumeLookupRateLimit(deps, trx, actor, insurerId, context);
      if (limitedMs !== null) return { limitedMs };

      const candidate = await findBeneficiary(deps, trx, insurerId, request.by, today);
      let result: EligibilityResult = NOT_ELIGIBLE_RESULT;
      let light: EligibilityLight | undefined;
      // `serviceCode` só conta se for um código ATIVO da lista da seguradora (texto livre da clínica nunca é registado, BR-SEG-15).
      const knownService = request.serviceCode !== null && (await deps.eligibility.serviceCodeExists(trx, insurerId, request.serviceCode));
      if (candidate?.policy && evaluateEligibility({ status: candidate.status, policy: candidate.policy }, today).eligible) {
        const { policy } = candidate;
        const rows = await deps.eligibility.coverages(trx, insurerId, policy.planId, request.serviceCode);
        const beneficiary = { status: candidate.status, policy };
        result = {
          eligible: true,
          notice: ELIGIBILITY_NOTICE,
          beneficiaryName: candidate.name,
          status: "ACTIVE",
          planName: policy.planName,
          validFrom: policy.validFrom,
          validTo: policy.validTo,
          currency,
          coverages: coverageLimitsFor(rows, beneficiary, today),
          // Marco B fatia 3 (BR-SEG-43): semáforo só com `serviceCode` ativo; sem linha de cobertura (excluído/fora do plano) ⇒ VERMELHO.
          ...(knownService ? trafficLightFor(rows, beneficiary, today) : {}),
        };
        if ("light" in result) light = result.light;
      }

      await deps.audit.record(
        trx,
        eligibilityAudit(deps, actor, insurerId, context, "SUCCESS", {
          result: result.eligible ? "ELIGIBLE" : "NOT_ELIGIBLE",
          ...(knownService && request.serviceCode !== null ? { serviceCode: request.serviceCode } : {}),
          ...(light !== undefined ? { light } : {}),
        }),
      );
      return { result };
    });
    if ("limitedMs" in outcome) throw new RateLimitedError(outcome.limitedMs, { detail: "Demasiadas validações. Tente novamente mais tarde." });
    return outcome.result;
  };
}

export function createListClinicInsurerServicesUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function listClinicInsurerServices(actor: ClinicOpsActor, insurerId: string, query: PageInput & { q?: string | undefined }): Promise<Page<InsurerService>> {
    assertClinicRole(actor.role);
    const page = toPageQuery(query);
    return deps.withTransaction(async (trx) => {
      await authorizeClinic(deps, trx, actor, insurerId);
      const rows = await deps.services.list(trx, insurerId, { status: "ACTIVE", ...(query.q ? { q: query.q } : {}) }, page);
      return toPage(rows, page, (s) => s);
    });
  };
}

