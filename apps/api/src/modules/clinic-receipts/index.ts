// Raiz do módulo `clinic-receipts` (ADR-015/conventions.md §1, M14 R, ADR-026, modules.md §2 nota 26): recibos internos não
// fiscais da clínica (`ClinicReceipt`, linhas, ligação ao paciente, contador sequencial); rotas `/clinic-portal/receipts*`
// (ator `ClinicAccount`, matriz de authorization.md §6.2b) e `/families/{f}/members/{m}/clinic-receipts*` (ator `User`,
// `AccessPolicy.can(VIEW_CLINIC_RECEIPTS)`). Depende só de `access` e `audit` (e de `clinics` apenas via portas ligadas no
// composition root); NÃO importa módulos de saúde, `families`, `auth`, `insurance` nem `documents`. Sem PDF no servidor.
import type { Router } from "express";
import type { Kysely } from "kysely";
import type { Clock } from "../../platform/clock/index.js";
import { withTransaction, type Database } from "../../platform/db/index.js";
import { InMemoryRateLimiter } from "../../platform/rate-limit/index.js";
import type { AccessModule } from "../access/index.js";
import type { AuditModule } from "../audit/index.js";
import {
  createFindIssuedReceiptIdsUseCase,
  createLockVisibleReceiptsUseCase,
  createReceiptInsurerSummariesUseCase,
  createReceiptRefsUseCase,
} from "./application/claim-lookup.js";
import { createGetFamilyReceiptUseCase, createListFamilyReceiptsUseCase } from "./application/family-receipts.js";
import { createIssueReceiptUseCase } from "./application/issue-receipt.js";
import { createGetReceiptUseCase, createListReceiptsUseCase } from "./application/list-receipts.js";
import type {
  AttachedClaimsPort,
  BookingSourcePort,
  ClinicProfileReaderPort,
  ClinicReceiptsDeps,
  ConsentLookupPort,
  ServiceCatalogReaderPort,
} from "./application/ports.js";
import { createVoidReceiptUseCase } from "./application/void-receipt.js";
import { KyselyReceiptsRepository } from "./infrastructure/repo.js";
import { createClinicReceiptLookup } from "./interface/claim-lookup.js";
import { createClinicReceiptsFamilyRouter } from "./interface/family-router.js";
import { createClinicReceiptsPortalRouter } from "./interface/portal-router.js";

export type { BookingFacts, BookingSourcePort, ClinicProfileSnapshot, ClinicProfileReaderPort, ConsentLookupPort, ServiceCatalogReaderPort, AttachedClaimsPort } from "./application/ports.js";
export type { ReceiptBookingKind } from "./domain/receipt.js";

export interface ClinicReceiptsModuleDeps {
  db: Kysely<Database>;
  audit: AuditModule;
  access: AccessModule;
  clock: Clock;
  /** Marcação concluída da clínica (implementada por `appointments`, `examinations` e `clinic-patients`; ligada no composition root). */
  bookings: BookingSourcePort<Kysely<Database>>;
  /** `ClinicConsent` (implementada por `clinic-patients`). */
  consents: ConsentLookupPort<Kysely<Database>>;
  /** Perfil/moeda (implementada por `clinics`). */
  profile: ClinicProfileReaderPort<Kysely<Database>>;
  /** Preço do serviço do catálogo (implementada por `clinics`). */
  services: ServiceCatalogReaderPort<Kysely<Database>>;
  /** Pedidos de reembolso a que cada recibo está anexado (implementada por `insurance`). */
  attachedClaims: AttachedClaimsPort<Kysely<Database>>;
}

export interface ClinicReceiptsModule {
  /** `/families/{f}/members/{m}/clinic-receipts*` (ator `User`). */
  router: Router;
  /** `/clinic-portal/receipts*` (ator `ClinicAccount`, ADR-020). */
  clinicPortalRouter: Router;
  /** API pública para `appointments`/`examinations`/`clinic-patients` (decorar `receiptId`, nunca para o Médico). */
  findIssuedReceiptIds: ReturnType<typeof createFindIssuedReceiptIdsUseCase<Kysely<Database>>>;
  /** Porta `ClinicReceiptLookup` de `insurance` (BR-CLN-36), ligada em `main/api.ts`. */
  claimLookup: ReturnType<typeof createClinicReceiptLookup<Kysely<Database>>>;
}

/** Composition root chama isto uma vez por processo (main/api.ts). */
export function createClinicReceiptsModule(deps: ClinicReceiptsModuleDeps): ClinicReceiptsModule {
  const receiptsDeps: ClinicReceiptsDeps<Kysely<Database>> = {
    receiptsRepo: new KyselyReceiptsRepository(),
    bookings: deps.bookings,
    consents: deps.consents,
    profile: deps.profile,
    services: deps.services,
    attachedClaims: deps.attachedClaims,
    policy: deps.access.policy,
    audit: deps.audit,
    withTransaction: (fn) => withTransaction(deps.db, fn),
    listLimiter: new InMemoryRateLimiter(deps.clock),
    clock: deps.clock,
  };

  return {
    clinicPortalRouter: createClinicReceiptsPortalRouter({
      listClinicReceipts: createListReceiptsUseCase(receiptsDeps),
      createClinicReceipt: createIssueReceiptUseCase(receiptsDeps),
      getClinicReceipt: createGetReceiptUseCase(receiptsDeps),
      voidClinicReceipt: createVoidReceiptUseCase(receiptsDeps),
    }),
    router: createClinicReceiptsFamilyRouter({
      listFamilyClinicReceipts: createListFamilyReceiptsUseCase(receiptsDeps),
      getFamilyClinicReceipt: createGetFamilyReceiptUseCase(receiptsDeps),
    }),
    findIssuedReceiptIds: createFindIssuedReceiptIdsUseCase(receiptsDeps),
    claimLookup: createClinicReceiptLookup({
      lockVisibleReceipts: createLockVisibleReceiptsUseCase(receiptsDeps),
      receiptRefs: createReceiptRefsUseCase(receiptsDeps),
      receiptInsurerSummaries: createReceiptInsurerSummariesUseCase(receiptsDeps),
    }),
  };
}
