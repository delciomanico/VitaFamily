// Raiz do módulo `insurance` (ADR-015/conventions.md §1): única API pública importável por outros
// módulos e pelo composition root (`main/api.ts`). Fase 4a (M11, ADR-021/ADR-023): seguradoras
// parceiras (`/admin/insurers*`) e identidade do portal da seguradora (`InsuranceAccount`,
// `insurance_sessions`, `/insurance-portal/auth|agents`), TOTALMENTE separada de `User` e
// `ClinicAccount`. Fase 4b: apólices (`InsurancePolicy`) e pedidos de reembolso do titular
// (`/families/.../insurance-policies*`, `/families/{id}/insurers`) e `/insurance-portal/claims*`.
// Depende de `access` (`AccessPolicy` MANAGE_INSURANCE + pertença), `documents` (foto do cartão e
// anexos, BR-INS-04) e `audit` (modules.md §2). O portal vive dentro deste módulo (mesma decisão do
// ADR-020 para `clinics`), mas as suas casos de uso só usam `InsurancePortalClaimsDeps` (sem
// `access`/`documents`).
import type { Router } from "express";
import type { Kysely } from "kysely";
import type { Clock } from "../../platform/clock/index.js";
import type { Database } from "../../platform/db/index.js";
import { withTransaction } from "../../platform/db/index.js";
import type { Logger } from "../../platform/logger/index.js";
import type { AccessModule } from "../access/index.js";
import type { AuditModule } from "../audit/index.js";
import type { DocumentsModule } from "../documents/index.js";
import {
  createAdminCreateInsurerUseCase,
  createAdminInsurerRootAccountUseCase,
  createAdminListInsurersUseCase,
  createAdminSetInsurerStatusUseCase,
  createAdminUpdateInsurerUseCase,
} from "./application/admin-insurers.js";
import {
  createCreateInsurancePolicyUseCase,
  createDeleteInsurancePolicyUseCase,
  createGetInsurancePolicyUseCase,
  createListInsurancePoliciesUseCase,
  createUpdateInsurancePolicyUseCase,
} from "./application/insurance-policies.js";
import { createListPartnerInsurersUseCase } from "./application/list-partner-insurers.js";
import { createDecideInsuranceClaimUseCase, createGetInsuranceClaimUseCase, createListInsuranceClaimsUseCase } from "./application/portal-claims.js";
import {
  createCreateReimbursementClaimUseCase,
  createGetReimbursementClaimUseCase,
  createListReimbursementClaimsUseCase,
  createMarkReimbursementClaimPaidUseCase,
} from "./application/reimbursement-claims.js";
import { createInsuranceLoginUseCase } from "./application/insurance-login.js";
import { createInsuranceLogoutUseCase } from "./application/insurance-logout.js";
import { createInsuranceRefreshUseCase } from "./application/insurance-refresh.js";
import { createCreateInsuranceAgentUseCase, createListInsuranceAgentsUseCase, createRemoveInsuranceAgentUseCase } from "./application/manage-insurance-agents.js";
import type { CachedInsuranceAccountState, ClinicReceiptLookupPort, InsuranceDeps, InsuranceHolderDeps, InsuranceMailer, InsurancePortalClaimsDeps } from "./application/ports.js";
import { createResolveInsuranceActorStateUseCase } from "./application/resolve-insurance-actor-state.js";
import type { InsuranceSigningKey } from "./domain/insurance-jwt.js";
import { InsuranceInMemoryRateLimiter } from "./domain/insurance-rate-limiter.js";
import { InsuranceTtlCache } from "./domain/insurance-ttl-cache.js";
import {
  KyselyInsuranceAccountRepository,
  KyselyInsurancePoliciesRepository,
  KyselyInsuranceSessionRepository,
  KyselyInsurersRepository,
  KyselyReimbursementClaimsRepository,
} from "./infrastructure/repo.js";
import { createInsuranceAdminRouter, type InsuranceAdminController } from "./interface/admin-router.js";
import { createInsuranceRouter, type InsuranceController } from "./interface/insurance-router.js";
import { createInsuranceActorContextMiddleware, createInsuranceBearerAuthSecurityHandler } from "./interface/insurance-portal-middleware.js";
import { createInsurancePortalRouter, type InsurancePortalController } from "./interface/insurance-portal-router.js";

export type { Insurer, InsurerStatus } from "./domain/insurer.js";
export type { InsuranceAccount, InsuranceAccountRole, InsuranceAccountStatus } from "./domain/insurance-account.js";
export { parseInsuranceSigningKeys, type InsuranceSigningKey } from "./domain/insurance-jwt.js";
export type { InsuranceMailer, InsuranceSentEmail } from "./application/ports.js";
export type { InsurancePolicy } from "./domain/insurance-policy.js";
export type { ClaimStatus, ReimbursementClaim } from "./domain/reimbursement-claim.js";

/** Cache do estado da conta do portal por pedido (authorization.md §8.1, ≤60 s). */
const INSURANCE_ACCOUNT_STATE_CACHE_TTL_MS = 60_000;

export interface InsuranceModuleDeps {
  db: Kysely<Database>;
  audit: AuditModule;
  access: AccessModule;
  documents: DocumentsModule;
  clock: Clock;
  logger: Logger;
  /** Porta de e-mail (palavras-passe iniciais); o composition root liga o mesmo SMTP dos outros portais. */
  insuranceMailer: InsuranceMailer;
  insuranceSigningKeys: InsuranceSigningKey[];
  insuranceAccessTtlSeconds: number;
  insuranceRefreshTtlMs: number;
  cookieDomain: string;
  /** M14 R (BR-CLN-36): `ClinicReceiptLookup` — implementada por `clinic-receipts/interface`, ligada em `main/api.ts`. */
  receipts: ClinicReceiptLookupPort<Kysely<Database>>;
}

export interface InsuranceModule {
  /** `/families/{id}/insurers`, `/families/.../insurance-policies*` (titular, ator de User). */
  router: Router;
  /** `/admin/insurers*` (BR-ADM-05/06). */
  adminRouter: Router;
  /** `/insurance-portal/auth|agents|claims` (ADR-021). */
  insurancePortalRouter: Router;
  /** Handler de segurança `insuranceBearerAuth` (`createApp({ securityHandlers })`). */
  insuranceSecurityHandlers: { insuranceBearerAuth: ReturnType<typeof createInsuranceBearerAuthSecurityHandler> };
  /** Middleware a montar a seguir aos de `auth`/`clinics` (preenche o TERCEIRO `platform/actor`). */
  insuranceActorContextMiddleware: ReturnType<typeof createInsuranceActorContextMiddleware>;
  /** M14 R (BR-CLN-35/36, `clinic-receipts`, ligado no composition root): pedidos ativos a que cada recibo está anexado. */
  claimIdsByReceipts: (trx: Kysely<Database>, receiptIds: string[]) => Promise<Map<string, string[]>>;
}

export function createInsuranceModule(deps: InsuranceModuleDeps): InsuranceModule {
  const insuranceDeps: InsuranceDeps<Kysely<Database>> = {
    insurersRepo: new KyselyInsurersRepository(),
    insuranceAccountRepo: new KyselyInsuranceAccountRepository(),
    insuranceSessionRepo: new KyselyInsuranceSessionRepository(),
    audit: deps.audit,
    db: deps.db,
    withTransaction: (fn) => withTransaction(deps.db, fn),
    clock: deps.clock,
    insuranceMailer: deps.insuranceMailer,
    logger: deps.logger,
    insuranceRateLimiter: new InsuranceInMemoryRateLimiter(deps.clock),
    insuranceSigningKeys: deps.insuranceSigningKeys,
    insuranceAccessTtlSeconds: deps.insuranceAccessTtlSeconds,
    insuranceRefreshTtlMs: deps.insuranceRefreshTtlMs,
    accountStateCache: new InsuranceTtlCache<CachedInsuranceAccountState>(deps.clock, INSURANCE_ACCOUNT_STATE_CACHE_TTL_MS),
  };

  const insurersRepo = new KyselyInsurersRepository();
  const claimsRepo = new KyselyReimbursementClaimsRepository();
  const holderDeps: InsuranceHolderDeps<Kysely<Database>> = {
    policiesRepo: new KyselyInsurancePoliciesRepository(),
    claimsRepo,
    insurersRepo,
    policy: deps.access.policy,
    membership: { getMembershipFacts: deps.access.getMembershipFacts },
    documents: {
      listForResource: deps.documents.listForResource,
      deleteAllForResource: deps.documents.deleteAllForResource,
      listAttachable: deps.documents.listAttachable,
    },
    receipts: deps.receipts,
    audit: deps.audit,
    db: deps.db,
    withTransaction: (fn) => withTransaction(deps.db, fn),
    clock: deps.clock,
  };
  const portalClaimsDeps: InsurancePortalClaimsDeps<Kysely<Database>> = {
    claimsRepo,
    receipts: deps.receipts,
    audit: deps.audit,
    withTransaction: (fn) => withTransaction(deps.db, fn),
    clock: deps.clock,
  };

  const holderController: InsuranceController = {
    listPartnerInsurers: createListPartnerInsurersUseCase(holderDeps),
    listInsurancePolicies: createListInsurancePoliciesUseCase(holderDeps),
    createInsurancePolicy: createCreateInsurancePolicyUseCase(holderDeps),
    getInsurancePolicy: createGetInsurancePolicyUseCase(holderDeps),
    updateInsurancePolicy: createUpdateInsurancePolicyUseCase(holderDeps),
    deleteInsurancePolicy: createDeleteInsurancePolicyUseCase(holderDeps),
    listReimbursementClaims: createListReimbursementClaimsUseCase(holderDeps),
    createReimbursementClaim: createCreateReimbursementClaimUseCase(holderDeps),
    getReimbursementClaim: createGetReimbursementClaimUseCase(holderDeps),
    markReimbursementClaimPaid: createMarkReimbursementClaimPaidUseCase(holderDeps),
  };

  const adminController: InsuranceAdminController = {
    adminListInsurers: createAdminListInsurersUseCase(insuranceDeps),
    adminCreateInsurer: createAdminCreateInsurerUseCase(insuranceDeps),
    adminUpdateInsurer: createAdminUpdateInsurerUseCase(insuranceDeps),
    adminSetInsurerStatus: createAdminSetInsurerStatusUseCase(insuranceDeps),
    adminCreateOrResetInsurerRootAccount: createAdminInsurerRootAccountUseCase(insuranceDeps),
  };

  const portalController: InsurancePortalController = {
    insuranceLogin: createInsuranceLoginUseCase(insuranceDeps),
    insuranceRefresh: createInsuranceRefreshUseCase(insuranceDeps),
    insuranceLogout: createInsuranceLogoutUseCase(insuranceDeps),
    listInsuranceAgents: createListInsuranceAgentsUseCase(insuranceDeps),
    createInsuranceAgent: createCreateInsuranceAgentUseCase(insuranceDeps),
    removeInsuranceAgent: createRemoveInsuranceAgentUseCase(insuranceDeps),
    listInsuranceClaims: createListInsuranceClaimsUseCase(portalClaimsDeps),
    getInsuranceClaim: createGetInsuranceClaimUseCase(portalClaimsDeps),
    decideInsuranceClaim: createDecideInsuranceClaimUseCase(portalClaimsDeps),
  };

  return {
    router: createInsuranceRouter(holderController),
    adminRouter: createInsuranceAdminRouter(adminController),
    insurancePortalRouter: createInsurancePortalRouter(portalController, deps.cookieDomain),
    insuranceSecurityHandlers: {
      insuranceBearerAuth: createInsuranceBearerAuthSecurityHandler({ signingKeys: deps.insuranceSigningKeys, clock: deps.clock }),
    },
    insuranceActorContextMiddleware: createInsuranceActorContextMiddleware({
      resolveInsuranceActorState: createResolveInsuranceActorStateUseCase(insuranceDeps),
    }),
    claimIdsByReceipts: (trx, receiptIds) => claimsRepo.activeClaimIdsByReceipts(trx, receiptIds),
  };
}
