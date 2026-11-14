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
import type { InsurerSettingsPort, OpsDeps, PartnerClinicDirectory, PatientAccessPort } from "./application/ports.js";
import { createCreateProviderUseCase, createListPartnerClinicsUseCase, createListProvidersUseCase, createSetProviderStatusUseCase } from "./application/providers.js";
import { createCreateServiceUseCase, createListServicesUseCase, createUpdateServiceUseCase } from "./application/services.js";
import { InMemoryRateLimiter } from "./domain/rate-limiter.js";
import { KyselyPlansRepository, KyselyServicesRepository } from "./infrastructure/catalog-repo.js";
import { KyselyEligibilityRepository, KyselyProvidersRepository } from "./infrastructure/clinic-repo.js";
import { registerExpirePoliciesWorker, registerPurgeImportPreviewsWorker } from "./infrastructure/jobs.js";
import { KyselyPatientInsuranceRepository } from "./infrastructure/patient-repo.js";
import {
  KyselyBeneficiariesRepository,
  KyselyCompaniesRepository,
  KyselyImportsRepository,
  KyselyLinkRequestsRepository,
  KyselyPoliciesRepository,
} from "./infrastructure/repo.js";
import { createInsurerClinicRouter, type InsurerClinicController } from "./interface/clinic-router.js";
import { createInsurerPatientRouter, type InsurerPatientController } from "./interface/patient-router.js";
import { createInsurerOpsRouter, type InsurerOpsController } from "./interface/portal-router.js";

export type { OpsActor, OpsRole } from "./domain/access.js";

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
}

export interface InsurerOpsModule {
  /** `/families/{f}/members/{m}/insurance/{card-claims,cards}` (S6 parcial, app do paciente) e `/insurance-portal/{companies,beneficiaries,imports,link-requests,policies,services,plans,partner-clinics,providers}` (S1–S3) e `/clinic-portal/insurers*` (S3 parcial). */
  router: Router;
  /** `InsurerOperationalDataPort` de `insurance` (BR-SEG-19): a seguradora já tem beneficiários/apólices? */
  operationalData: { hasData: (trx: Kysely<Database>, insurerId: string) => Promise<boolean> };
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
    plans: new KyselyPlansRepository(),
    providers: new KyselyProvidersRepository(),
    eligibility: new KyselyEligibilityRepository(),
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
  return {
    router,
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
  /** Jobs diários `insurer.expire-policies` e `insurer.purge-import-previews` — só o processo "worker" chama isto. */
  registerWorkers: () => Promise<void>;
  /** A expiração em si (idempotente), exposta para testes e execução manual. */
  expirePolicies: ReturnType<typeof createExpirePoliciesJobUseCase<Kysely<Database>>>;
  /** Expurgo (idempotente) dos lotes de importação em PREVIEW com mais de 24 h — job `insurer.purge-import-previews`. */
  purgeImportPreviews: ReturnType<typeof createPurgeImportPreviewsJobUseCase<Kysely<Database>>>;
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
  return {
    expirePolicies,
    purgeImportPreviews,
    registerWorkers: async () => {
      await registerExpirePoliciesWorker(deps.boss, expirePolicies);
      await registerPurgeImportPreviewsWorker(deps.boss, purgeImportPreviews);
    },
  };
}
