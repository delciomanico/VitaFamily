// Controllers HTTP de `/clinic-portal/insurers*` (Fase A/S3 parcial; openapi tag "Clinic Portal", ADR-025, authorization.md §8.4).
// O ator vem SEMPRE do token da clínica (`getClinicActor`), nunca do corpo/query/caminho; o `insurerId` do caminho só vale se a
// clínica estiver ligada à seguradora (senão NOT_FOUND). A matriz papel×rota (Médico ⇒ FORBIDDEN) está em `clinics`.
import { Router } from "express";
import { getClinicActor } from "../../../platform/actor/index.js";
import { UnauthenticatedError } from "../../../platform/errors/index.js";
import { asyncHandler, buildRequestContext, requireParam } from "../../../platform/http/index.js";
import type { Page } from "../../../platform/page/index.js";
import type { ClinicOpsActor } from "../domain/access.js";
import type { EligibilityResult } from "../domain/eligibility.js";
import type { InsurerService } from "../domain/service.js";
import type { ClinicInsurer } from "../application/clinic-portal.js";
import type { PageInput } from "../application/support.js";
import type { RequestContext } from "./types.js";
import { toClinicInsurerResponse, toClinicServiceResponse, toEligibilityResponse, toPageResponse } from "./dto.js";

export interface InsurerClinicController {
  listClinicInsurers: (actor: ClinicOpsActor) => Promise<ClinicInsurer[]>;
  checkEligibility: (actor: ClinicOpsActor, insurerId: string, input: Record<string, unknown>, ctx: RequestContext) => Promise<EligibilityResult>;
  listClinicInsurerServices: (actor: ClinicOpsActor, insurerId: string, query: PageInput & { q?: string | undefined }) => Promise<Page<InsurerService>>;
}

function requireClinicActor(): ClinicOpsActor {
  const actor = getClinicActor();
  if (!actor) throw new UnauthenticatedError({ detail: "Sem sessão válida." });
  return { clinicAccountId: actor.clinicAccountId, clinicId: actor.clinicId, role: actor.role };
}

const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

export function createInsurerClinicRouter(c: InsurerClinicController): Router {
  const router = Router();
  const base = "/clinic-portal/insurers";
  // security.md «Cabeçalhos»: respostas com dados de terceiros/pessoais nunca ficam em cache (também as listas e GET por id).
  router.use(base, (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  router.get(base, asyncHandler(async (_req, res) => {
    res.json((await c.listClinicInsurers(requireClinicActor())).map(toClinicInsurerResponse));
  }));
  router.post(`${base}/:insurerId/eligibility`, asyncHandler(async (req, res) => {
    const result = await c.checkEligibility(requireClinicActor(), requireParam(req, "insurerId"), (req.body ?? {}) as Record<string, unknown>, buildRequestContext(req));
    // Resposta sobre dados de terceiros: nunca em cache.
    res.setHeader("Cache-Control", "no-store");
    res.json(toEligibilityResponse(result));
  }));
  router.get(`${base}/:insurerId/services`, asyncHandler(async (req, res) => {
    const { limit, cursor, q } = req.query as Record<string, unknown>;
    const query = { limit: str(limit) ?? (typeof limit === "number" ? limit : undefined), cursor: str(cursor), q: str(q) };
    res.json(toPageResponse(await c.listClinicInsurerServices(requireClinicActor(), requireParam(req, "insurerId"), query), toClinicServiceResponse));
  }));

  return router;
}
