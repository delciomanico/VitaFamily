// Controllers HTTP de `/insurance-portal/{companies,beneficiaries,imports,link-requests,policies,services,plans,partner-clinics,providers}` (Fase A/S1–S3; openapi tag
// "Insurance Portal", ADR-025). O ator vem SEMPRE da sessão (`getInsuranceActor`), nunca do corpo/query/caminho.
import { Router } from "express";
import { getInsuranceActor } from "../../../platform/actor/index.js";
import { UnauthenticatedError, ValidationError } from "../../../platform/errors/index.js";
import { asyncHandler, buildRequestContext, requireParam } from "../../../platform/http/index.js";
import type { Page } from "../../../platform/page/index.js";
import type { OpsActor } from "../domain/access.js";
import type { Beneficiary, BeneficiaryInput } from "../domain/beneficiary.js";
import type { Company } from "../domain/company.js";
import type { ImportBatch } from "../domain/import-batch.js";
import type { LinkRequest } from "../domain/link-request.js";
import type { InsurerPlan, PlanCoverage } from "../domain/plan.js";
import type { Policy } from "../domain/policy.js";
import type { InsurerProvider } from "../domain/provider.js";
import type { PolicySettingView } from "../domain/policy-setting.js";
import type { InsurerService } from "../domain/service.js";
import type { CatalogTypes, ServiceKind } from "../domain/service-kind.js";
import type { PortalMe } from "../application/portal-me.js";
import type { PartnerClinic } from "../application/providers.js";
import type { PageInput } from "../application/support.js";
import type { RequestContext, UploadedFile } from "./types.js";
import {
  toBeneficiaryResponse,
  toCompanyResponse,
  toImportResponse,
  toLinkRequestResponse,
  toCoverageResponse,
  toPageResponse,
  toPartnerClinicResponse,
  toPlanResponse,
  toPortalMeResponse,
  toPolicyResponse,
  toProviderResponse,
  toServiceResponse,
  toCatalogTypesResponse,
  toPolicySettingResponse,
  toServiceKindResponse,
} from "./dto.js";

type Body = Record<string, unknown>;
type Query = PageInput & { status?: string | undefined };

export interface InsurerOpsController {
  getPortalMe: (actor: OpsActor) => Promise<PortalMe>;
  listCompanies: (actor: OpsActor, query: Query) => Promise<Page<Company>>;
  createCompany: (actor: OpsActor, input: Body, ctx: RequestContext) => Promise<Company>;
  updateCompany: (actor: OpsActor, companyId: string, input: Body, ctx: RequestContext) => Promise<Company>;
  listBeneficiaries: (actor: OpsActor, query: Query & { q?: string | undefined; companyId?: string | undefined; holderId?: string | undefined; relationship?: string | undefined }) => Promise<Page<Beneficiary>>;
  createBeneficiary: (actor: OpsActor, input: BeneficiaryInput, ctx: RequestContext) => Promise<Beneficiary>;
  getBeneficiary: (actor: OpsActor, beneficiaryId: string) => Promise<Beneficiary>;
  updateBeneficiary: (actor: OpsActor, beneficiaryId: string, input: Body, ctx: RequestContext) => Promise<Beneficiary>;
  setBeneficiaryStatus: (actor: OpsActor, beneficiaryId: string, input: Body, ctx: RequestContext) => Promise<Beneficiary>;
  issueClaimCode: (actor: OpsActor, beneficiaryId: string, ctx: RequestContext) => Promise<{ code: string; expiresAt: Date }>;
  createImport: (actor: OpsActor, file: UploadedFile, ctx: RequestContext) => Promise<ImportBatch>;
  getImport: (actor: OpsActor, importId: string) => Promise<ImportBatch>;
  cancelImport: (actor: OpsActor, importId: string, ctx: RequestContext) => Promise<void>;
  commitImport: (actor: OpsActor, importId: string, ctx: RequestContext) => Promise<ImportBatch>;
  listLinkRequests: (actor: OpsActor, query: Query) => Promise<Page<LinkRequest>>;
  confirmLinkRequest: (actor: OpsActor, linkRequestId: string, ctx: RequestContext) => Promise<LinkRequest>;
  rejectLinkRequest: (actor: OpsActor, linkRequestId: string, input: Body, ctx: RequestContext) => Promise<LinkRequest>;
  listPolicies: (actor: OpsActor, query: Query & { companyId?: string | undefined; holderId?: string | undefined; q?: string | undefined }) => Promise<Page<Policy>>;
  createPolicy: (actor: OpsActor, input: Body, ctx: RequestContext) => Promise<Policy>;
  getPolicy: (actor: OpsActor, policyId: string) => Promise<Policy>;
  updatePolicy: (actor: OpsActor, policyId: string, input: Body, ctx: RequestContext) => Promise<Policy>;
  setPolicyStatus: (actor: OpsActor, policyId: string, input: Body, ctx: RequestContext) => Promise<Policy>;
  listServices: (actor: OpsActor, query: Query & { q?: string | undefined }) => Promise<Page<InsurerService>>;
  createService: (actor: OpsActor, input: Body, ctx: RequestContext) => Promise<InsurerService>;
  updateService: (actor: OpsActor, serviceId: string, input: Body, ctx: RequestContext) => Promise<InsurerService>;
  listCatalogTypes: (actor: OpsActor) => Promise<CatalogTypes>;
  listServiceKinds: (actor: OpsActor, query: { status?: string | undefined }) => Promise<ServiceKind[]>;
  createServiceKind: (actor: OpsActor, input: Body, ctx: RequestContext) => Promise<ServiceKind>;
  updateServiceKind: (actor: OpsActor, kindId: string, input: Body, ctx: RequestContext) => Promise<ServiceKind>;
  classifyServices: (actor: OpsActor, input: Body, ctx: RequestContext) => Promise<{ updated: number }>;
  listPolicySettings: (actor: OpsActor) => Promise<PolicySettingView[]>;
  setPolicySetting: (actor: OpsActor, key: string, input: Body, ctx: RequestContext) => Promise<PolicySettingView>;
  resetPolicySetting: (actor: OpsActor, key: string, query: { serviceId?: string | undefined }, ctx: RequestContext) => Promise<void>;
  listPlans: (actor: OpsActor, query: Query & { name?: string | undefined }) => Promise<Page<InsurerPlan>>;
  createPlan: (actor: OpsActor, input: Body, ctx: RequestContext) => Promise<InsurerPlan>;
  getPlan: (actor: OpsActor, planId: string) => Promise<InsurerPlan>;
  setPlanStatus: (actor: OpsActor, planId: string, input: Body, ctx: RequestContext) => Promise<InsurerPlan>;
  newPlanVersion: (actor: OpsActor, planId: string, ctx: RequestContext) => Promise<InsurerPlan>;
  listCoverages: (actor: OpsActor, planId: string) => Promise<PlanCoverage[]>;
  replaceCoverages: (actor: OpsActor, planId: string, input: Body, ctx: RequestContext) => Promise<PlanCoverage[]>;
  listPartnerClinics: (actor: OpsActor, query: PageInput & { q?: string | undefined }) => Promise<Page<PartnerClinic>>;
  listProviders: (actor: OpsActor, query: Query) => Promise<Page<InsurerProvider>>;
  createProvider: (actor: OpsActor, input: Body, ctx: RequestContext) => Promise<InsurerProvider>;
  setProviderStatus: (actor: OpsActor, providerId: string, input: Body, ctx: RequestContext) => Promise<InsurerProvider>;
}

function requireActor(): OpsActor {
  const actor = getInsuranceActor();
  if (!actor) throw new UnauthenticatedError({ detail: "Sem sessão válida." });
  return { insuranceAccountId: actor.insuranceAccountId, insurerId: actor.insurerId, role: actor.role };
}

const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);
const body = (req: { body?: unknown }): Body => (req.body ?? {}) as Body;

/** Query comum (`limit`, `cursor`, `status`, `q`, `companyId`, `holderId`) — o validador OpenAPI já tipou os parâmetros. */
function readQuery(req: { query: Record<string, unknown> }) {
  const q = req.query;
  return { limit: str(q.limit) ?? (typeof q.limit === "number" ? q.limit : undefined), cursor: str(q.cursor), status: str(q.status), q: str(q.q), companyId: str(q.companyId), holderId: str(q.holderId), relationship: str(q.relationship) };
}

function requireUploadedFile(req: { files?: unknown }): UploadedFile {
  const files = Array.isArray(req.files) ? (req.files as { fieldname: string; originalname: string; buffer: Buffer }[]) : [];
  const file = files.find((f) => f.fieldname === "file");
  if (!file) throw new ValidationError([{ field: "file", message: "obrigatório" }], { detail: "Ficheiro obrigatório." });
  return { buffer: file.buffer, originalName: file.originalname };
}

export function createInsurerOpsRouter(c: InsurerOpsController): Router {
  const router = Router();
  const base = "/insurance-portal";
  // security.md «Cabeçalhos»: respostas com dados de terceiros/pessoais nunca ficam em cache (também as listas e GET por id).
  router.use(base, (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  router.get(`${base}/me`, asyncHandler(async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(toPortalMeResponse(await c.getPortalMe(requireActor())));
  }));

  router.get(`${base}/companies`, asyncHandler(async (req, res) => {
    res.json(toPageResponse(await c.listCompanies(requireActor(), readQuery(req)), toCompanyResponse));
  }));
  router.post(`${base}/companies`, asyncHandler(async (req, res) => {
    res.status(201).json(toCompanyResponse(await c.createCompany(requireActor(), body(req), buildRequestContext(req))));
  }));
  router.patch(`${base}/companies/:companyId`, asyncHandler(async (req, res) => {
    res.json(toCompanyResponse(await c.updateCompany(requireActor(), requireParam(req, "companyId"), body(req), buildRequestContext(req))));
  }));

  router.get(`${base}/beneficiaries`, asyncHandler(async (req, res) => {
    res.json(toPageResponse(await c.listBeneficiaries(requireActor(), readQuery(req)), toBeneficiaryResponse));
  }));
  router.post(`${base}/beneficiaries`, asyncHandler(async (req, res) => {
    res.status(201).json(toBeneficiaryResponse(await c.createBeneficiary(requireActor(), body(req), buildRequestContext(req))));
  }));
  router.get(`${base}/beneficiaries/:beneficiaryId`, asyncHandler(async (req, res) => {
    res.json(toBeneficiaryResponse(await c.getBeneficiary(requireActor(), requireParam(req, "beneficiaryId"))));
  }));
  router.patch(`${base}/beneficiaries/:beneficiaryId`, asyncHandler(async (req, res) => {
    res.json(toBeneficiaryResponse(await c.updateBeneficiary(requireActor(), requireParam(req, "beneficiaryId"), body(req), buildRequestContext(req))));
  }));
  router.post(`${base}/beneficiaries/:beneficiaryId/status`, asyncHandler(async (req, res) => {
    res.json(toBeneficiaryResponse(await c.setBeneficiaryStatus(requireActor(), requireParam(req, "beneficiaryId"), body(req), buildRequestContext(req))));
  }));
  router.post(`${base}/beneficiaries/:beneficiaryId/claim-code`, asyncHandler(async (req, res) => {
    const result = await c.issueClaimCode(requireActor(), requireParam(req, "beneficiaryId"), buildRequestContext(req));
    // O código em claro só viaja nesta resposta; nunca em cache.
    res.setHeader("Cache-Control", "no-store");
    res.status(201).json({ code: result.code, expiresAt: result.expiresAt.toISOString() });
  }));

  router.post(`${base}/imports`, asyncHandler(async (req, res) => {
    res.status(201).json(toImportResponse(await c.createImport(requireActor(), requireUploadedFile(req), buildRequestContext(req))));
  }));
  router.get(`${base}/imports/:importId`, asyncHandler(async (req, res) => {
    res.json(toImportResponse(await c.getImport(requireActor(), requireParam(req, "importId"))));
  }));
  router.delete(`${base}/imports/:importId`, asyncHandler(async (req, res) => {
    await c.cancelImport(requireActor(), requireParam(req, "importId"), buildRequestContext(req));
    res.status(204).end();
  }));
  router.post(`${base}/imports/:importId/commit`, asyncHandler(async (req, res) => {
    res.json(toImportResponse(await c.commitImport(requireActor(), requireParam(req, "importId"), buildRequestContext(req))));
  }));

  router.get(`${base}/link-requests`, asyncHandler(async (req, res) => {
    res.json(toPageResponse(await c.listLinkRequests(requireActor(), readQuery(req)), toLinkRequestResponse));
  }));
  router.post(`${base}/link-requests/:linkRequestId/confirm`, asyncHandler(async (req, res) => {
    res.json(toLinkRequestResponse(await c.confirmLinkRequest(requireActor(), requireParam(req, "linkRequestId"), buildRequestContext(req))));
  }));
  router.post(`${base}/link-requests/:linkRequestId/reject`, asyncHandler(async (req, res) => {
    res.json(toLinkRequestResponse(await c.rejectLinkRequest(requireActor(), requireParam(req, "linkRequestId"), body(req), buildRequestContext(req))));
  }));

  router.get(`${base}/policies`, asyncHandler(async (req, res) => {
    res.json(toPageResponse(await c.listPolicies(requireActor(), readQuery(req)), toPolicyResponse));
  }));
  router.post(`${base}/policies`, asyncHandler(async (req, res) => {
    res.status(201).json(toPolicyResponse(await c.createPolicy(requireActor(), body(req), buildRequestContext(req))));
  }));
  router.get(`${base}/policies/:policyId`, asyncHandler(async (req, res) => {
    res.json(toPolicyResponse(await c.getPolicy(requireActor(), requireParam(req, "policyId"))));
  }));
  router.patch(`${base}/policies/:policyId`, asyncHandler(async (req, res) => {
    res.json(toPolicyResponse(await c.updatePolicy(requireActor(), requireParam(req, "policyId"), body(req), buildRequestContext(req))));
  }));
  router.post(`${base}/policies/:policyId/status`, asyncHandler(async (req, res) => {
    res.json(toPolicyResponse(await c.setPolicyStatus(requireActor(), requireParam(req, "policyId"), body(req), buildRequestContext(req))));
  }));

  router.get(`${base}/services`, asyncHandler(async (req, res) => {
    res.json(toPageResponse(await c.listServices(requireActor(), readQuery(req)), toServiceResponse));
  }));
  router.post(`${base}/services`, asyncHandler(async (req, res) => {
    res.status(201).json(toServiceResponse(await c.createService(requireActor(), body(req), buildRequestContext(req))));
  }));
  // `/services/classify` antes de `/services/:serviceId` (contrato; ADR-033).
  router.post(`${base}/services/classify`, asyncHandler(async (req, res) => {
    res.json(await c.classifyServices(requireActor(), body(req), buildRequestContext(req)));
  }));
  router.patch(`${base}/services/:serviceId`, asyncHandler(async (req, res) => {
    res.json(toServiceResponse(await c.updateService(requireActor(), requireParam(req, "serviceId"), body(req), buildRequestContext(req))));
  }));

  router.get(`${base}/catalog-types`, asyncHandler(async (_req, res) => {
    res.json(toCatalogTypesResponse(await c.listCatalogTypes(requireActor())));
  }));
  router.get(`${base}/service-kinds`, asyncHandler(async (req, res) => {
    res.json((await c.listServiceKinds(requireActor(), { status: str(req.query.status) })).map(toServiceKindResponse));
  }));
  router.post(`${base}/service-kinds`, asyncHandler(async (req, res) => {
    res.status(201).json(toServiceKindResponse(await c.createServiceKind(requireActor(), body(req), buildRequestContext(req))));
  }));
  router.patch(`${base}/service-kinds/:kindId`, asyncHandler(async (req, res) => {
    res.json(toServiceKindResponse(await c.updateServiceKind(requireActor(), requireParam(req, "kindId"), body(req), buildRequestContext(req))));
  }));

  router.get(`${base}/policy-settings`, asyncHandler(async (_req, res) => {
    res.json((await c.listPolicySettings(requireActor())).map(toPolicySettingResponse));
  }));
  router.put(`${base}/policy-settings/:key`, asyncHandler(async (req, res) => {
    res.json(toPolicySettingResponse(await c.setPolicySetting(requireActor(), requireParam(req, "key"), body(req), buildRequestContext(req))));
  }));
  router.delete(`${base}/policy-settings/:key`, asyncHandler(async (req, res) => {
    await c.resetPolicySetting(requireActor(), requireParam(req, "key"), { serviceId: str(req.query.serviceId) }, buildRequestContext(req));
    res.status(204).end();
  }));

  router.get(`${base}/plans`, asyncHandler(async (req, res) => {
    res.json(toPageResponse(await c.listPlans(requireActor(), { ...readQuery(req), name: str(req.query.name) }), toPlanResponse));
  }));
  router.post(`${base}/plans`, asyncHandler(async (req, res) => {
    res.status(201).json(toPlanResponse(await c.createPlan(requireActor(), body(req), buildRequestContext(req))));
  }));
  router.get(`${base}/plans/:planId`, asyncHandler(async (req, res) => {
    res.json(toPlanResponse(await c.getPlan(requireActor(), requireParam(req, "planId"))));
  }));
  router.post(`${base}/plans/:planId/status`, asyncHandler(async (req, res) => {
    res.json(toPlanResponse(await c.setPlanStatus(requireActor(), requireParam(req, "planId"), body(req), buildRequestContext(req))));
  }));
  router.post(`${base}/plans/:planId/new-version`, asyncHandler(async (req, res) => {
    res.status(201).json(toPlanResponse(await c.newPlanVersion(requireActor(), requireParam(req, "planId"), buildRequestContext(req))));
  }));
  router.get(`${base}/plans/:planId/coverages`, asyncHandler(async (req, res) => {
    res.json((await c.listCoverages(requireActor(), requireParam(req, "planId"))).map(toCoverageResponse));
  }));
  router.put(`${base}/plans/:planId/coverages`, asyncHandler(async (req, res) => {
    res.json((await c.replaceCoverages(requireActor(), requireParam(req, "planId"), body(req), buildRequestContext(req))).map(toCoverageResponse));
  }));

  router.get(`${base}/partner-clinics`, asyncHandler(async (req, res) => {
    const { limit, cursor, q } = readQuery(req);
    res.json(toPageResponse(await c.listPartnerClinics(requireActor(), { limit, cursor, q }), toPartnerClinicResponse));
  }));
  router.get(`${base}/providers`, asyncHandler(async (req, res) => {
    res.json(toPageResponse(await c.listProviders(requireActor(), readQuery(req)), toProviderResponse));
  }));
  router.post(`${base}/providers`, asyncHandler(async (req, res) => {
    res.status(201).json(toProviderResponse(await c.createProvider(requireActor(), body(req), buildRequestContext(req))));
  }));
  router.post(`${base}/providers/:providerId/status`, asyncHandler(async (req, res) => {
    res.json(toProviderResponse(await c.setProviderStatus(requireActor(), requireParam(req, "providerId"), body(req), buildRequestContext(req))));
  }));

  return router;
}
