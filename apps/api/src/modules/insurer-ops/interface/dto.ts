// Mapeamento de entidades (application) -> forma da API (components.schemas do openapi.yaml). Nunca expõe ids de família/
// membro do paciente, hash do código nem dados de saúde (BR-SEG-14/20, ADR-005).
import type { Page } from "../../../platform/page/index.js";
import type { Beneficiary } from "../domain/beneficiary.js";
import type { Company } from "../domain/company.js";
import { previewOf, type ImportBatch } from "../domain/import-batch.js";
import type { LinkRequest } from "../domain/link-request.js";
import type { EligibilityResult } from "../domain/eligibility.js";
import type { InsurerPlan, PlanCoverage } from "../domain/plan.js";
import type { Policy } from "../domain/policy.js";
import type { InsurerProvider } from "../domain/provider.js";
import type { PolicySettingView } from "../domain/policy-setting.js";
import type { InsurerService } from "../domain/service.js";
import type { CatalogTypes, ServiceKind } from "../domain/service-kind.js";
import type { ClinicInsurer } from "../application/clinic-portal.js";
import type { PartnerClinic } from "../application/providers.js";
import type { CardClaimView, CardCoverageView, CardQrView, CardView } from "../application/patient-insurance.js";
import type { PortalMe } from "../application/portal-me.js";

export const toCompanyResponse = (c: Company) => ({ id: c.id, name: c.name, taxId: c.taxId, status: c.status, createdAt: c.createdAt.toISOString() });

export const toBeneficiaryResponse = (b: Beneficiary) => ({
  id: b.id,
  companyId: b.companyId,
  holderId: b.holderId,
  name: b.name,
  idDocumentType: b.idDocumentType,
  idDocumentNumber: b.idDocumentNumber,
  birthDate: b.birthDate,
  relationship: b.relationship,
  cardNumber: b.cardNumber,
  status: b.status,
  linked: b.linked,
  statusNote: b.statusNote,
  createdAt: b.createdAt.toISOString(),
});

export const toPolicyResponse = (p: Policy) => ({
  id: p.id,
  number: p.number,
  planId: p.planId,
  planName: p.planName,
  planVersion: p.planVersion,
  companyId: p.companyId,
  holderId: p.holderId,
  validFrom: p.validFrom,
  validTo: p.validTo,
  status: p.status,
  statusNote: p.statusNote,
  createdAt: p.createdAt.toISOString(),
});

export const toLinkRequestResponse = (r: LinkRequest) => ({
  id: r.id,
  beneficiaryId: r.beneficiaryId,
  beneficiaryName: r.beneficiaryName,
  cardNumber: r.cardNumber,
  status: r.status,
  requestedAt: r.createdAt.toISOString(),
  decidedAt: r.decidedAt?.toISOString() ?? null,
  decisionNote: r.decisionNote,
});

export const toImportResponse = (b: ImportBatch) => ({
  id: b.id,
  format: b.format,
  status: b.status,
  rowCount: b.rowCount,
  validRows: b.report.validRows,
  errorRows: b.report.errorRows,
  duplicateRows: b.report.duplicateRows,
  importedRows: b.report.importedRows,
  errors: b.report.errors.map((e) => ({ row: e.row, field: e.field, code: e.code, message: e.message })),
  errorsTruncated: b.report.errorsTruncated,
  preview: previewOf(b).map((r) => ({ row: r.row, name: r.name, idDocumentType: r.idDocumentType, idDocumentNumber: r.idDocumentNumber, birthDate: r.birthDate, relationship: r.relationship })),
  createdAt: b.createdAt.toISOString(),
});

export const toPageResponse = <T, R>(page: Page<T>, map: (item: T) => R) => ({ items: page.items.map(map), nextCursor: page.nextCursor });

export const toServiceResponse = (s: InsurerService) => ({ id: s.id, code: s.code, name: s.name, category: s.category, status: s.status, serviceKindId: s.serviceKindId, guideType: s.guideType, expenseType: s.expenseType });

export const toPlanResponse = (p: InsurerPlan) => ({ id: p.id, name: p.name, version: p.version, status: p.status, coverageCount: p.coverageCount, createdAt: p.createdAt.toISOString() });

export const toCoverageResponse = (c: PlanCoverage) => ({
  serviceId: c.serviceId,
  serviceCode: c.serviceCode,
  serviceName: c.serviceName,
  covered: c.covered,
  copayPct: c.copayPct,
  limitPerYear: c.limitPerYear,
  waitingDays: c.waitingDays,
  requiresAuthorization: c.requiresAuthorization,
});

export const toProviderResponse = (p: InsurerProvider) => ({ id: p.id, clinicId: p.clinicId, name: p.name, status: p.status });

/** Exatamente `id` e `name` (BR-SEG-14, TC-SEG-11): nada mais sai da clínica. */
export const toPartnerClinicResponse = (c: PartnerClinic) => ({ id: c.id, name: c.name });

export const toClinicInsurerResponse = (i: ClinicInsurer) => ({ id: i.id, name: i.name, currency: i.currency });

/** BR-SEG-22/39: código, nome, categoria e tipo de guia/despesa deduzidos do serviço (nunca `serviceKindId` nem política). */
export const toClinicServiceResponse = (s: InsurerService) => ({ code: s.code, name: s.name, category: s.category, guideType: s.guideType, expenseType: s.expenseType });

/** BR-SEG-18: com `eligible=false` só `eligible` e `notice`. */
export const toEligibilityResponse = (r: EligibilityResult) =>
  r.eligible
    ? {
        eligible: true,
        notice: r.notice,
        beneficiaryName: r.beneficiaryName,
        status: r.status,
        planName: r.planName,
        validFrom: r.validFrom,
        validTo: r.validTo,
        currency: r.currency,
        coverages: r.coverages.map((c) => ({
          serviceCode: c.serviceCode,
          serviceName: c.serviceName,
          coveredNow: c.coveredNow,
          copayPct: c.copayPct,
          limitPerYear: c.limitPerYear,
          waitingDays: c.waitingDays,
          waitingEndsOn: c.waitingEndsOn,
          requiresAuthorization: c.requiresAuthorization,
        })),
      }
    : { eligible: false, notice: r.notice };

export const toPortalMeResponse = (m: PortalMe) => ({
  insurerId: m.insurerId,
  name: m.name,
  currency: m.currency,
  operationalModuleEnabled: m.operationalModuleEnabled,
  role: m.role,
});

// ---- App do paciente (S6 parcial): só dados da seguradora, nunca de saúde; sem «usado»/«reservado»/saldo (D-A2) ----
export const toCardClaimResponse = (c: CardClaimView) => ({
  id: c.id,
  insurerId: c.insurerId,
  insurerName: c.insurerName,
  beneficiaryId: c.beneficiaryId,
  status: c.status,
  requestedAt: c.requestedAt.toISOString(),
  decidedAt: c.decidedAt?.toISOString() ?? null,
  decisionNote: c.decisionNote,
});

export const toCardResponse = (c: CardView) => ({
  beneficiaryId: c.beneficiaryId,
  insurerId: c.insurerId,
  insurerName: c.insurerName,
  currency: c.currency,
  beneficiaryName: c.beneficiaryName,
  cardNumber: c.cardNumber,
  status: c.status,
  planName: c.planName,
  policyNumber: c.policyNumber,
  validFrom: c.validFrom,
  validTo: c.validTo,
});

export const toCardQrResponse = (q: CardQrView) => ({ token: q.token, expiresAt: q.expiresAt.toISOString(), cardVersion: q.cardVersion });

export const toCardCoverageResponse = (c: CardCoverageView) => ({
  beneficiaryId: c.beneficiaryId,
  insurerId: c.insurerId,
  currency: c.currency,
  status: c.status,
  planName: c.planName,
  policyNumber: c.policyNumber,
  validFrom: c.validFrom,
  validTo: c.validTo,
  coverages: c.coverages.map((x) => ({
    serviceCode: x.serviceCode,
    serviceName: x.serviceName,
    coveredNow: x.coveredNow,
    copayPct: x.copayPct,
    limitPerYear: x.limitPerYear,
    waitingDays: x.waitingDays,
    waitingEndsOn: x.waitingEndsOn,
    requiresAuthorization: x.requiresAuthorization,
  })),
});

// ---- Catálogo e política (marco B fatia 2, ADR-033) ----
export const toServiceKindResponse = (k: ServiceKind) => ({ id: k.id, code: k.code, name: k.name, guideType: k.guideType, expenseType: k.expenseType, status: k.status, servicesCount: k.servicesCount });

export const toCatalogTypesResponse = (c: CatalogTypes) => ({ guideTypes: c.guideTypes.map((g) => ({ code: g.code })), expenseTypes: c.expenseTypes.map((e) => ({ code: e.code, legacyCode: e.legacyCode })) });

export const toPolicySettingResponse = (v: PolicySettingView) => ({
  key: v.key,
  unit: v.unit,
  min: v.min,
  max: v.max,
  defaultValue: v.defaultValue,
  value: v.value,
  source: v.source,
  allowsServiceScope: v.allowsServiceScope,
  serviceOverrides: v.serviceOverrides.map((o) => ({ serviceId: o.serviceId, serviceCode: o.serviceCode, serviceName: o.serviceName, value: o.value })),
});
