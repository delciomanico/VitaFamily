// Raiz do módulo `insurer-ops` (ADR-025, modules.md §2 nota 23; nome provisório): módulo operacional de seguradoras. Marco
// S1 / Fase A: empresas, beneficiários (incl. código de reclamação), importação CSV/XLSX, pedidos de ligação e apólices;
// S2 mínimo: serviços, planos/versões/coberturas; S3 parcial: ligação de clínicas parceiras e `/clinic-portal/insurers*`
// (ator `ClinicAccount`) — em `/insurance-portal/*` (ator `InsuranceAccount`; nunca `AccessPolicy`), mais o job `insurer.expire-policies`.
// Dados da seguradora, nunca de saúde. Depende só de `audit` e, por injeção (composition root), do estado da seguradora
// lido pela raiz de `insurance` (`insurer_accounts.operational_module_enabled`/`currency`, nota 23d).
import { Router } from "express";
import type { Kysely } from "kysely";
import type PgBoss from "pg-boss";
import type { Clock } from "../../platform/clock/index.js";
import { withTransaction, type Database } from "../../platform/db/index.js";
import type { AuditModule } from "../audit/index.js";
import { createCancelImportUseCase, createCommitImportUseCase, createCreateImportUseCase, createGetImportUseCase, createPurgeImportPreviewsJobUseCase } from "./application/imports.js";
import {
  createCreateBeneficiaryUseCase,
  createGetBeneficiaryUseCase,
  createIssueClaimCodeUseCase,
  createListBeneficiariesUseCase,
  createSetBeneficiaryStatusUseCase,
  createUpdateBeneficiaryUseCase,
} from "./application/beneficiaries.js";
import { createGetPortalMeUseCase } from "./application/portal-me.js";
import { createCreateCompanyUseCase, createListCompaniesUseCase, createUpdateCompanyUseCase } from "./application/companies.js";
import { createConfirmLinkRequestUseCase, createListLinkRequestsUseCase, createRejectLinkRequestUseCase } from "./application/link-requests.js";
import {
  createCreatePolicyUseCase,
  createExpirePoliciesJobUseCase,
  createGetPolicyUseCase,
  createListPoliciesUseCase,
  createSetPolicyStatusUseCase,
  createUpdatePolicyUseCase,
} from "./application/policies.js";
import { createCheckEligibilityUseCase, createListClinicInsurersUseCase, createListClinicInsurerServicesUseCase } from "./application/clinic-portal.js";
import {
  createCreatePlanUseCase,
  createGetPlanUseCase,
  createListCoveragesUseCase,
  createListPlansUseCase,
  createNewPlanVersionUseCase,
  createReplaceCoveragesUseCase,
  createSetPlanStatusUseCase,
} from "./application/plans.js";
import {
  createClaimCardUseCase,
  createGetCardCoverageUseCase,
  createIssueCardQrUseCase,
  createListCardClaimsUseCase,
  createListCardsUseCase,
  createRevokeCardClaimUseCase,
} from "./application/patient-insurance.js";
import type { AttachmentFiles, InsurerSettingsPort, OpsDeps, PartnerClinicDirectory, PatientAccessPort, ProcessLinker } from "./application/ports.js";
import { createApproveAuthorizationUseCase } from "./application/approve-authorization.js";
import { createAssignAuthorizationUseCase } from "./application/assign-authorization.js";
import { createGetAuthorizationMetricsUseCase } from "./application/authorization-metrics.js";
import { createCreateAutoApprovalRuleUseCase, createDeleteAutoApprovalRuleUseCase, createListAutoApprovalRulesUseCase, createUpdateAutoApprovalRuleUseCase } from "./application/auto-approval-rules.js";
import { createDownloadAuthorizationAttachmentUseCase } from "./application/download-authorization-attachment.js";
import { createFlagSlaBreachesJobUseCase } from "./application/flag-sla-breaches.js";
import { createGetInsurerAuthorizationUseCase, createListInsurerAuthorizationsUseCase } from "./application/list-insurer-authorizations.js";
import { createListAuthorizationAssigneesUseCase } from "./application/list-authorization-assignees.js";
import { createRejectAuthorizationUseCase } from "./application/reject-authorization.js";
import { createReopenAuthorizationUseCase } from "./application/reopen-authorization.js";
import { createRequestAuthorizationInfoUseCase } from "./application/request-authorization-info.js";
import { createRevertAuthorizationUseCase } from "./application/revert-authorization.js";
import { createAddAuthorizationAttachmentUseCase } from "./application/add-authorization-attachment.js";
import { createAppealAuthorizationUseCase } from "./application/appeal-authorization.js";
import { createCancelAuthorizationUseCase } from "./application/cancel-authorization.js";
import { createCreateAuthorizationUseCase } from "./application/create-authorization.js";
import { createExpireInfoRequestsJobUseCase } from "./application/expire-info-requests.js";
import { createGetCoverageFactsUseCase } from "./application/get-coverage-facts.js";
import { createGetAuthorizationUseCase, createListAuthorizationsUseCase } from "./application/list-authorizations.js";
import { createRemoveAuthorizationAttachmentUseCase } from "./application/remove-authorization-attachment.js";
import { createRespondAuthorizationUseCase } from "./application/respond-authorization.js";
import { createCreateProviderUseCase, createListPartnerClinicsUseCase, createListProvidersUseCase, createSetProviderStatusUseCase } from "./application/providers.js";
import { createClassifyServicesUseCase } from "./application/classify-services.js";
import { createCreateServiceKindUseCase } from "./application/create-service-kind.js";
import { createListCatalogTypesUseCase } from "./application/list-catalog-types.js";
import { createListPolicySettingsUseCase } from "./application/list-policy-settings.js";
import { createListServiceKindsUseCase } from "./application/list-service-kinds.js";
import { createResetPolicySettingUseCase } from "./application/reset-policy-setting.js";
import { createSetPolicySettingUseCase } from "./application/set-policy-setting.js";
import { createUpdateServiceKindUseCase } from "./application/update-service-kind.js";
import { createCreateServiceUseCase, createListServicesUseCase, createUpdateServiceUseCase } from "./application/services.js";
import { InMemoryRateLimiter } from "./domain/rate-limiter.js";
import { KyselyCatalogTypesRepository, KyselyPlansRepository, KyselyPolicySettingsRepository, KyselyServiceKindsRepository, KyselyServicesRepository } from "./infrastructure/catalog-repo.js";
import { KyselyEligibilityRepository, KyselyProvidersRepository } from "./infrastructure/clinic-repo.js";
import { KyselyAuthorizationsRepository } from "./infrastructure/authorizations-repo.js";
import { KyselyAutoApprovalRulesRepository } from "./infrastructure/auto-approval-repo.js";
import { KyselyInsurerAuthorizationsRepository } from "./infrastructure/insurer-authorizations-repo.js";
import { registerExpireInfoRequestsWorker, registerExpirePoliciesWorker, registerFlagSlaBreachesWorker, registerPurgeImportPreviewsWorker } from "./infrastructure/jobs.js";
import { KyselyPatientInsuranceRepository } from "./infrastructure/patient-repo.js";
import {
  KyselyBeneficiariesRepository,
  KyselyCompaniesRepository,
  KyselyImportsRepository,
  KyselyLinkRequestsRepository,
  KyselyPoliciesRepository,
} from "./infrastructure/repo.js";
import { createClinicAuthorizationsRouter, type InsurerClinicAuthorizationsController } from "./interface/clinic-authorizations-router.js";
import { createInsurerAuthorizationsRouter, type InsurerAuthorizationsController } from "./interface/insurer-authorizations-router.js";
import { createInsurerClinicRouter, type InsurerClinicController } from "./interface/clinic-router.js";
import { createInsurerPatientRouter, type InsurerPatientController } from "./interface/patient-router.js";
import { createInsurerOpsRouter, type InsurerOpsController } from "./interface/portal-router.js";

export type { OpsActor, OpsRole } from "./domain/access.js";
export type { AttachmentFiles, ProcessLinker } from "./application/ports.js";

export interface InsurerOpsModuleDeps {
  db: Kysely<Database>;
  audit: AuditModule;
  clock: Clock;
  /** Estado da seguradora (módulo ligado, moeda) — `createInsurerSettingsReader()` de `insurance`, ligado em `main/api.ts`. */
  insurers: InsurerSettingsPort<Kysely<Database>>;
  /** Segredo do HMAC dos códigos de reclamação (BR-SEG-20). */
  claimCodeSecret: string;
  /** Clínicas PARTNER+ACTIVE (`id` e nome) — `clinics.partnerClinicDirectory`, ligada em `main/api.ts` (nota 23b). */
  partnerClinics: PartnerClinicDirectory<Kysely<Database>>;
  /** `AccessPolicy.can(MANAGE_INSURANCE)` (§8.5) — porta ligada em `main/api.ts` sobre `access.policy` (modules.md §2 nota 23a). */
  patientAccess: PatientAccessPort<Kysely<Database>>;
  /** `ProcessLinker` (ADR-034): implementada por `processes`, ligada em `main/api.ts` (`insurer-ops` e `processes` não se importam). */
  processes: ProcessLinker<Kysely<Database>>;
  /** Ficheiros dos anexos (Storage + antivírus + outbox `file_deletions`), ligada em `main/api.ts` (nota 31d). */
  files: AttachmentFiles<Kysely<Database>>;
}

export interface InsurerOpsModule {
  /** `/families/{f}/members/{m}/insurance/{card-claims,cards}` (S6 parcial, app do paciente) e `/insurance-portal/{companies,beneficiaries,imports,link-requests,policies,services,plans,partner-clinics,providers}` (S1–S3), `/insurance-portal/{authorizations,auto-approval-rules}*` (fatia 4) e `/clinic-portal/insurers*` (S3 parcial). */
  router: Router;
  /** `InsurerOperationalDataPort` de `insurance` (BR-SEG-19): a seguradora já tem beneficiários/apólices? */
  operationalData: { hasData: (trx: Kysely<Database>, insurerId: string) => Promise<boolean> };
  /** Implementa `ProcessFacts.getCoverageFacts` de `processes` (ADR-034): ligada em `main/api.ts`. */
  getCoverageFacts: ReturnType<typeof createGetCoverageFactsUseCase<Kysely<Database>>>;
}

function createOpsDeps(deps: InsurerOpsModuleDeps): OpsDeps<Kysely<Database>> {
  return {
    insurers: deps.insurers,
    companies: new KyselyCompaniesRepository(),
    beneficiaries: new KyselyBeneficiariesRepository(),
    linkRequests: new KyselyLinkRequestsRepository(),
    policies: new KyselyPoliciesRepository(),
    imports: new KyselyImportsRepository(),
    services: new KyselyServicesRepository(),
    serviceKinds: new KyselyServiceKindsRepository(),
    catalogTypes: new KyselyCatalogTypesRepository(),
    policySettings: new KyselyPolicySettingsRepository(),
    plans: new KyselyPlansRepository(),
    providers: new KyselyProvidersRepository(),
    eligibility: new KyselyEligibilityRepository(),
    authorizations: new KyselyAuthorizationsRepository(),
    insurerAuthorizations: new KyselyInsurerAuthorizationsRepository(),
    autoApprovalRules: new KyselyAutoApprovalRulesRepository(),
    processes: deps.processes,
    files: deps.files,
    partnerClinics: deps.partnerClinics,
    patients: new KyselyPatientInsuranceRepository(),
    patientAccess: deps.patientAccess,
    rateLimiter: new InMemoryRateLimiter(deps.clock),
    audit: deps.audit,
    withTransaction: (fn) => withTransaction(deps.db, fn),
    clock: deps.clock,
    claimCodeSecret: deps.claimCodeSecret,
  };
}

export function createInsurerOpsModule(deps: InsurerOpsModuleDeps): InsurerOpsModule {
  const ops = createOpsDeps(deps);
  const controller: InsurerOpsController = {
    getPortalMe: createGetPortalMeUseCase(ops),
    listCompanies: createListCompaniesUseCase(ops),
    createCompany: createCreateCompanyUseCase(ops),
    updateCompany: createUpdateCompanyUseCase(ops),
    listBeneficiaries: createListBeneficiariesUseCase(ops),
    createBeneficiary: createCreateBeneficiaryUseCase(ops),
    getBeneficiary: createGetBeneficiaryUseCase(ops),
    updateBeneficiary: createUpdateBeneficiaryUseCase(ops),
    setBeneficiaryStatus: createSetBeneficiaryStatusUseCase(ops),
    issueClaimCode: createIssueClaimCodeUseCase(ops),
    createImport: createCreateImportUseCase(ops),
    getImport: createGetImportUseCase(ops),
    cancelImport: createCancelImportUseCase(ops),
    commitImport: createCommitImportUseCase(ops),
    listLinkRequests: createListLinkRequestsUseCase(ops),
    confirmLinkRequest: createConfirmLinkRequestUseCase(ops),
    rejectLinkRequest: createRejectLinkRequestUseCase(ops),
    listPolicies: createListPoliciesUseCase(ops),
    createPolicy: createCreatePolicyUseCase(ops),
    getPolicy: createGetPolicyUseCase(ops),
    updatePolicy: createUpdatePolicyUseCase(ops),
    setPolicyStatus: createSetPolicyStatusUseCase(ops),
    listServices: createListServicesUseCase(ops),
    createService: createCreateServiceUseCase(ops),
    updateService: createUpdateServiceUseCase(ops),
    listCatalogTypes: createListCatalogTypesUseCase(ops),
    listServiceKinds: createListServiceKindsUseCase(ops),
    createServiceKind: createCreateServiceKindUseCase(ops),
    updateServiceKind: createUpdateServiceKindUseCase(ops),
    classifyServices: createClassifyServicesUseCase(ops),
    listPolicySettings: createListPolicySettingsUseCase(ops),
    setPolicySetting: createSetPolicySettingUseCase(ops),
    resetPolicySetting: createResetPolicySettingUseCase(ops),
    listPlans: createListPlansUseCase(ops),
    createPlan: createCreatePlanUseCase(ops),
    getPlan: createGetPlanUseCase(ops),
    setPlanStatus: createSetPlanStatusUseCase(ops),
    newPlanVersion: createNewPlanVersionUseCase(ops),
    listCoverages: createListCoveragesUseCase(ops),
    replaceCoverages: createReplaceCoveragesUseCase(ops),
    listPartnerClinics: createListPartnerClinicsUseCase(ops),
    listProviders: createListProvidersUseCase(ops),
    createProvider: createCreateProviderUseCase(ops),
    setProviderStatus: createSetProviderStatusUseCase(ops),
  };
  const clinicController: InsurerClinicController = {
    listClinicInsurers: createListClinicInsurersUseCase(ops),
    checkEligibility: createCheckEligibilityUseCase(ops),
    listClinicInsurerServices: createListClinicInsurerServicesUseCase(ops),
  };
  const authorizationsController: InsurerClinicAuthorizationsController = {
    createAuthorization: createCreateAuthorizationUseCase(ops),
    listAuthorizations: createListAuthorizationsUseCase(ops),
    getAuthorization: createGetAuthorizationUseCase(ops),
    respondAuthorization: createRespondAuthorizationUseCase(ops),
    cancelAuthorization: createCancelAuthorizationUseCase(ops),
    appealAuthorization: createAppealAuthorizationUseCase(ops),
    addAuthorizationAttachment: createAddAuthorizationAttachmentUseCase(ops),
    removeAuthorizationAttachment: createRemoveAuthorizationAttachmentUseCase(ops),
  };
  const insurerAuthorizationsController: InsurerAuthorizationsController = {
    listAuthorizations: createListInsurerAuthorizationsUseCase(ops),
    getMetrics: createGetAuthorizationMetricsUseCase(ops),
    listAssignees: createListAuthorizationAssigneesUseCase(ops),
    getAuthorization: createGetInsurerAuthorizationUseCase(ops),
    assign: createAssignAuthorizationUseCase(ops),
    requestInfo: createRequestAuthorizationInfoUseCase(ops),
    approve: createApproveAuthorizationUseCase(ops),
    reject: createRejectAuthorizationUseCase(ops),
    cancel: createRevertAuthorizationUseCase(ops),
    reopen: createReopenAuthorizationUseCase(ops),
    downloadAttachment: createDownloadAuthorizationAttachmentUseCase(ops),
    listRules: createListAutoApprovalRulesUseCase(ops),
    createRule: createCreateAutoApprovalRuleUseCase(ops),
    updateRule: createUpdateAutoApprovalRuleUseCase(ops),
    deleteRule: createDeleteAutoApprovalRuleUseCase(ops),
  };
  const patientController: InsurerPatientController = {
    listCardClaims: createListCardClaimsUseCase(ops),
    claimCard: createClaimCardUseCase(ops),
    revokeCardClaim: createRevokeCardClaimUseCase(ops),
    listCards: createListCardsUseCase(ops),
    issueCardQr: createIssueCardQrUseCase(ops),
    getCardCoverage: createGetCardCoverageUseCase(ops),
  };
  const router = Router();
  router.use(createInsurerOpsRouter(controller));
  router.use(createInsurerPatientRouter(patientController));
  router.use(createInsurerClinicRouter(clinicController));
  router.use(createClinicAuthorizationsRouter(authorizationsController));
  router.use(createInsurerAuthorizationsRouter(insurerAuthorizationsController));
  return {
    router,
    getCoverageFacts: createGetCoverageFactsUseCase(ops),
    operationalData: {
      hasData: async (trx, insurerId) => (await ops.beneficiaries.hasAny(trx, insurerId)) || (await ops.policies.hasAny(trx, insurerId)),
    },
  };
}

export interface InsurerOpsWorkerModuleDeps {
  db: Kysely<Database>;
  audit: AuditModule;
  clock: Clock;
  boss: PgBoss;
}

export interface InsurerOpsWorkerModule {
  /** Jobs `insurer.expire-policies`, `insurer.purge-import-previews`, `insurer.expire-info-requests` (diários) e `insurer.flag-sla-breaches` (15 min) — só o processo "worker" chama isto. */
  registerWorkers: () => Promise<void>;
  /** A expiração em si (idempotente), exposta para testes e execução manual. */
  expirePolicies: ReturnType<typeof createExpirePoliciesJobUseCase<Kysely<Database>>>;
  /** Expurgo (idempotente) dos lotes de importação em PREVIEW com mais de 24 h — job `insurer.purge-import-previews`. */
  purgeImportPreviews: ReturnType<typeof createPurgeImportPreviewsJobUseCase<Kysely<Database>>>;
  /** Caducidade (idempotente) dos pedidos de informação sem resposta — job `insurer.expire-info-requests` (00:50 UTC, BR-AUT-14). */
  expireInfoRequests: ReturnType<typeof createExpireInfoRequestsJobUseCase<Kysely<Database>>>;
  /** Marca de SLA (idempotente) nos `IN_REVIEW` com prazo atingido — job `insurer.flag-sla-breaches` (15 min, BR-AUT-20); nunca decide. */
  flagSlaBreaches: ReturnType<typeof createFlagSlaBreachesJobUseCase<Kysely<Database>>>;
}

/** Composition root do processo "worker": só BD, auditoria e relógio. */
export function createInsurerOpsWorkerModule(deps: InsurerOpsWorkerModuleDeps): InsurerOpsWorkerModule {
  const expirePolicies = createExpirePoliciesJobUseCase<Kysely<Database>>({
    policies: new KyselyPoliciesRepository(),
    audit: deps.audit,
    withTransaction: (fn) => withTransaction(deps.db, fn),
    clock: deps.clock,
  });
  const purgeImportPreviews = createPurgeImportPreviewsJobUseCase<Kysely<Database>>({
    imports: new KyselyImportsRepository(),
    audit: deps.audit,
    withTransaction: (fn) => withTransaction(deps.db, fn),
    clock: deps.clock,
  });
  const expireInfoRequests = createExpireInfoRequestsJobUseCase<Kysely<Database>>({
    authorizations: new KyselyAuthorizationsRepository(),
    audit: deps.audit,
    withTransaction: (fn) => withTransaction(deps.db, fn),
    clock: deps.clock,
  });
  const flagSlaBreaches = createFlagSlaBreachesJobUseCase<Kysely<Database>>({
    insurerAuthorizations: new KyselyInsurerAuthorizationsRepository(),
    audit: deps.audit,
    withTransaction: (fn) => withTransaction(deps.db, fn),
    clock: deps.clock,
  });
  return {
    expirePolicies,
    purgeImportPreviews,
    expireInfoRequests,
    flagSlaBreaches,
    registerWorkers: async () => {
      await registerExpirePoliciesWorker(deps.boss, expirePolicies);
      await registerPurgeImportPreviewsWorker(deps.boss, purgeImportPreviews);
      await registerExpireInfoRequestsWorker(deps.boss, expireInfoRequests);
      await registerFlagSlaBreachesWorker(deps.boss, flagSlaBreaches);
    },
  };
}
