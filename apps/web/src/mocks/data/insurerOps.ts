import type {
  InsurerBeneficiary,
  InsurerCompany,
  InsurerImport,
  InsurerLinkRequest,
  InsurerPlan,
  InsurerPlanCoverage,
  InsurerPolicy,
  InsurerProvider,
  InsurerService,
  AuthorizationRequest,
} from '@/types/insurerOps'
import type { AuthorizationDecider, AutoApprovalRule, AutoApprovalTrace, InsurerServiceKind, InsurerTimelineEntry } from '@/types/insurerAuthorizations'

/**
 * Módulo operacional de seguradoras, Fase A (ADR-025) — dados demo. Todos os registos levam
 * `insurerId` (só no mock): a API real filtra sempre pela seguradora do token (BR-SEG-14).
 */
type Owned<T> = T & { insurerId: string }

/** Campos que só a seguradora tem de um pedido (a vista da clínica nunca os mostra, ADR-035). */
export interface MockDecisionMeta {
  assignedToId: string | null
  decidedBy: AuthorizationDecider | null
  decidedByAccountId: string | null
  /** Marca de SLA (job `insurer.flag-sla-breaches`); só informa. */
  escalatedAt: string | null
  autoApproval: AutoApprovalTrace | null
  /** Quem decidiu a recusa de que este recurso nasceu (separação de funções). */
  originDeciderId: string | null
  /** Quem recusou este pedido antes de ser reaberto. */
  priorRejecterId: string | null
  /** Linha do tempo da seguradora (com notas internas). */
  events: InsurerTimelineEntry[]
}

export interface MockInsurerModule {
  /** `operational_module_enabled` (ligado pelo Platform Admin). */
  enabled: boolean
  /** ISO 4217 (BR-SEG-19). */
  currency: string
}

export interface MockInsurerOps {
  modules: Record<string, MockInsurerModule>
  companies: Array<Owned<InsurerCompany>>
  beneficiaries: Array<Owned<InsurerBeneficiary>>
  policies: Array<Owned<InsurerPolicy>>
  plans: Array<Owned<InsurerPlan>>
  /** Coberturas por plano (`planId`). */
  coverages: Array<Owned<InsurerPlanCoverage & { planId: string }>>
  services: Array<Owned<InsurerService>>
  providers: Array<Owned<InsurerProvider>>
  /** Lotes de importação; as linhas válidas ficam guardadas até ao commit. */
  imports: Array<Owned<InsurerImport & { validRecords: Array<Omit<InsurerBeneficiary, 'id' | 'cardNumber' | 'status' | 'linked' | 'createdAt'>> }>>
  /** `familyId`/`memberId` só existem no mock: ligam o pedido ao membro que reclamou o cartão (BR-SEG-20). */
  linkRequests: Array<Owned<InsurerLinkRequest & { familyId?: string; memberId?: string }>>
  /** Códigos de reclamação emitidos (a API real só guarda o hash, BR-SEG-32); uso único. */
  claimCodes: Array<{ insurerId: string; beneficiaryId: string; code: string; expiresAt: string; used: boolean }>
  /** Instantes (ms) das reclamações por utilizador e dos QR por cartão, para os limites simulados (BR-SEG-33). */
  claimAttempts: Record<string, number[]>
  qrIssues: Record<string, number[]>
  /** Instantes (ms) das validações por clínica, para o rate limit simulado (BR-SEG-18). */
  eligibilityChecks: Record<string, number[]>
  /** Pedidos de autorização do prestador (ADR-034); `clinicId` só existe no mock. */
  authorizations: Array<AuthorizationRequest & { clinicId: string; beneficiaryId: string; originalDecisionAt?: string }>
  /** Marco B fatia 4: dados só da seguradora por pedido, regras de aprovação automática e tipos de serviço. */
  decisions: Record<string, MockDecisionMeta>
  autoApprovalRules: Array<Owned<AutoApprovalRule>>
  serviceKinds: Array<Owned<InsurerServiceKind>>
}

const CREATED = '2026-01-10T09:00:00.000Z'

export function seedInsurerOps(): MockInsurerOps {
  const insurerId = 'ins_aurora'
  return {
    modules: { [insurerId]: { enabled: true, currency: 'AOA' } },
    companies: [
      { id: 'cmp_petro', insurerId, name: 'Petrolíbia, Lda', taxId: '5417001234', status: 'ACTIVE', createdAt: CREATED },
    ],
    beneficiaries: [
      {
        id: 'ben_joao',
        insurerId,
        companyId: 'cmp_petro',
        holderId: null,
        name: 'João Mendes',
        idDocumentType: 'BI',
        idDocumentNumber: '000111222LA042',
        birthDate: '1985-03-14',
        relationship: 'HOLDER',
        cardNumber: 'AUR-000001',
        status: 'ACTIVE',
        linked: false,
        statusNote: null,
        createdAt: CREATED,
      },
      {
        id: 'ben_ana',
        insurerId,
        companyId: 'cmp_petro',
        holderId: 'ben_joao',
        name: 'Ana Mendes',
        idDocumentType: 'BI',
        idDocumentNumber: '000333444LA051',
        birthDate: '1987-07-02',
        relationship: 'SPOUSE',
        cardNumber: 'AUR-000002',
        status: 'ACTIVE',
        linked: false,
        statusNote: null,
        createdAt: CREATED,
      },
      {
        id: 'ben_pedro',
        insurerId,
        companyId: null,
        holderId: null,
        name: 'Pedro Quimbo',
        idDocumentType: 'BI',
        idDocumentNumber: '000555666LA033',
        birthDate: '1990-11-30',
        relationship: 'HOLDER',
        cardNumber: 'AUR-000003',
        status: 'PENDING',
        linked: false,
        statusNote: null,
        createdAt: CREATED,
      },
    ],
    policies: [
      {
        id: 'pol_joao',
        insurerId,
        number: 'AP-2026-0001',
        planId: 'pln_basico',
        planName: 'Plano Básico',
        planVersion: 1,
        companyId: 'cmp_petro',
        holderId: 'ben_joao',
        validFrom: '2026-01-01',
        validTo: '2027-12-31',
        status: 'ACTIVE',
        statusNote: null,
        createdAt: CREATED,
      },
    ],
    plans: [
      { id: 'pln_basico', insurerId, name: 'Plano Básico', version: 1, status: 'ACTIVE', coverageCount: 3, createdAt: CREATED },
      { id: 'pln_plus', insurerId, name: 'Plano Plus', version: 1, status: 'DRAFT', coverageCount: 0, createdAt: CREATED },
    ],
    coverages: [
      {
        planId: 'pln_basico',
        insurerId,
        serviceId: 'svc_cons',
        serviceCode: 'CONS-GER',
        serviceName: 'Consulta de clínica geral',
        covered: true,
        copayPct: 80,
        limitPerYear: null,
        waitingDays: 0,
        requiresAuthorization: false,
      },
      {
        planId: 'pln_basico',
        insurerId,
        serviceId: 'svc_lab',
        serviceCode: 'LAB-HEM',
        serviceName: 'Hemograma completo',
        covered: true,
        copayPct: 100,
        limitPerYear: 50000,
        waitingDays: 0,
        requiresAuthorization: false,
      },
      {
        planId: 'pln_basico',
        insurerId,
        serviceId: 'svc_rx',
        serviceCode: 'IMG-RX',
        serviceName: 'Radiografia',
        covered: true,
        copayPct: 70,
        limitPerYear: 120000,
        waitingDays: 30,
        requiresAuthorization: true,
      },
    ],
    services: [
      { id: 'svc_cons', insurerId, code: 'CONS-GER', name: 'Consulta de clínica geral', category: 'Consultas', status: 'ACTIVE' },
      { id: 'svc_lab', insurerId, code: 'LAB-HEM', name: 'Hemograma completo', category: 'Análises', status: 'ACTIVE' },
      { id: 'svc_rx', insurerId, code: 'IMG-RX', name: 'Radiografia', category: 'Imagem', status: 'ACTIVE' },
      { id: 'svc_old', insurerId, code: 'OLD-01', name: 'Serviço descontinuado', category: null, status: 'INACTIVE' },
    ],
    providers: [{ id: 'prv_horizonte', insurerId, clinicId: 'cln_horizonte', name: 'Clínica Horizonte', status: 'ACTIVE' }],
    imports: [],
    linkRequests: [
      {
        id: 'lnk_ana',
        insurerId,
        beneficiaryId: 'ben_ana',
        beneficiaryName: 'Ana Mendes',
        cardNumber: 'AUR-000002',
        status: 'PENDING',
        requestedAt: '2026-11-10T10:00:00.000Z',
        decidedAt: null,
        decisionNote: null,
      },
    ],
    claimCodes: [
      // Demo: o João pode ser reclamado com a apólice AP-2026-0001 e este código.
      { insurerId, beneficiaryId: 'ben_joao', code: 'JOAO2345', expiresAt: '2030-01-01T00:00:00.000Z', used: false },
    ],
    claimAttempts: {},
    qrIssues: {},
    eligibilityChecks: {},
    authorizations: [],
    decisions: {},
    autoApprovalRules: [],
    serviceKinds: [
      { id: 'knd_consultas', insurerId, code: 'CONSULTATION', name: 'Consultas', status: 'ACTIVE' },
      { id: 'knd_diagnostico', insurerId, code: 'DIAGNOSTICS', name: 'Exames e diagnóstico', status: 'ACTIVE' },
      { id: 'knd_internamento', insurerId, code: 'INPATIENT', name: 'Internamento', status: 'ACTIVE' },
    ],
  }
}
