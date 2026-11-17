import { DEMO_PASSWORD, DEMO_VERIFICATION_CODE } from './data/users'
import type {
  AdminSpecialty,
  ProfessionalCredential,
  ProfessionalOffer,
  ProfessionalScheduleRule,
  ProfessionalSlot,
  ProfessionalTimeOff,
  ProfessionalValidationStatus,
  Specialty,
  ValidationCase,
} from '@/types/professional'

/**
 * “Base de dados” em memória do mercado de profissionais (MK1). Independente de `db.ts`: o espaço de
 * identidade do profissional é separado (BR-MKT-13). Nada aqui é dado de saúde ou de família.
 */

export const DEMO_PROFESSIONAL_EMAIL = 'profissional@vitafamily.app'
export const DEMO_PROFESSIONAL_PASSWORD = DEMO_PASSWORD
/** Código de 6 dígitos de verificação de e-mail e de recuperação de palavra-passe no backend simulado. */
export const DEMO_PROFESSIONAL_CODE = DEMO_VERIFICATION_CODE

export interface MockProfessionalCredential extends ProfessionalCredential {
  /** Ciclos de leitura já vistos enquanto `PENDING` (simula o job de antivírus). */
  ticks: number
  fileName: string
}

export interface MockProfessional {
  id: string
  email: string
  password: string
  verified: boolean
  resetPending: boolean
  displayName?: string
  bio?: string
  city?: string
  paymentInstructions?: string
  validationStatus: ProfessionalValidationStatus
  statusReason?: string
  statusChangedAt: string
  submittedAt?: string
  approvedAt?: string
  createdAt: string
  specialtyIds: string[]
  credentials: MockProfessionalCredential[]
  offers: ProfessionalOffer[]
  rules: ProfessionalScheduleRule[]
  timeOffs: ProfessionalTimeOff[]
  slots: Array<ProfessionalSlot & { ruleId: string }>
  /** Mais antigo primeiro (a API devolve o mais recente primeiro). */
  history: ValidationCase[]
}

interface ProfessionalDb {
  specialties: Array<Specialty & { active: boolean }>
  professionals: MockProfessional[]
  /** Conteúdo dos ficheiros das credenciais (nunca sai do mock nem entra em respostas clonadas). */
  files: Map<string, Blob>
}

let seq = 0
export function proId(prefix: string): string {
  seq += 1
  return `${prefix}_${seq.toString(36)}${crypto.randomUUID().slice(0, 6)}`
}

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString()

function cred(
  id: string,
  kind: ProfessionalCredential['kind'],
  extra: Partial<MockProfessionalCredential> = {},
): MockProfessionalCredential {
  return {
    id,
    kind,
    scanStatus: 'CLEAN',
    contentType: 'application/pdf',
    sizeBytes: 120_000,
    createdAt: daysAgo(3),
    ticks: 1,
    fileName: `${id}.pdf`,
    ...extra,
  }
}

function base(partial: Partial<MockProfessional> & Pick<MockProfessional, 'id' | 'email'>): MockProfessional {
  return {
    password: DEMO_PASSWORD,
    verified: true,
    resetPending: false,
    validationStatus: 'DRAFT',
    statusChangedAt: daysAgo(5),
    createdAt: daysAgo(10),
    specialtyIds: [],
    credentials: [],
    offers: [],
    rules: [],
    timeOffs: [],
    slots: [],
    history: [],
    ...partial,
  }
}

function seed(): ProfessionalDb {
  const specialties = [
    { id: 'spc_geral', name: 'Medicina geral', category: 'HEALTH' as const, active: true },
    { id: 'spc_psico', name: 'Psicologia', category: 'HEALTH' as const, active: true },
    { id: 'spc_nutri', name: 'Nutrição', category: 'HEALTH' as const, active: true },
    { id: 'spc_yoga', name: 'Yoga', category: 'WELLNESS' as const, active: true },
    { id: 'spc_treino', name: 'Treino pessoal', category: 'WELLNESS' as const, active: true },
    { id: 'spc_antiga', name: 'Fisioterapia (antiga)', category: 'HEALTH' as const, active: false },
  ]
  const files = new Map<string, Blob>()
  const professionals: MockProfessional[] = [
    // Conta de demonstração do portal: perfil por completar.
    base({ id: 'pro_demo', email: DEMO_PROFESSIONAL_EMAIL, displayName: 'Dra. Helena Cardoso', createdAt: daysAgo(2) }),
    // Fila do admin: pedido completo à espera de decisão.
    base({
      id: 'pro_fila',
      email: 'joao.mendes@exemplo.ao',
      displayName: 'João Mendes',
      city: 'Luanda',
      bio: 'Psicólogo clínico com 8 anos de experiência.',
      paymentInstructions: 'Transferência para o IBAN indicado após a marcação.',
      validationStatus: 'PENDING_REVIEW',
      submittedAt: daysAgo(1),
      statusChangedAt: daysAgo(1),
      specialtyIds: ['spc_psico'],
      credentials: [cred('crd_fila_id', 'IDENTITY'), cred('crd_fila_lic', 'PROFESSIONAL_LICENSE', { number: 'OP-12345', issuingBody: 'Ordem dos Psicólogos' })],
      history: [{ id: 'val_fila_1', action: 'SUBMITTED', fromStatus: 'DRAFT', toStatus: 'PENDING_REVIEW', actor: 'PROFESSIONAL', createdAt: daysAgo(1) }],
    }),
    base({
      id: 'pro_aprovada',
      email: 'marta.lopes@exemplo.ao',
      displayName: 'Marta Lopes',
      city: 'Benguela',
      validationStatus: 'APPROVED',
      submittedAt: daysAgo(20),
      approvedAt: daysAgo(18),
      statusChangedAt: daysAgo(18),
      specialtyIds: ['spc_yoga'],
      credentials: [cred('crd_ap_id', 'IDENTITY'), cred('crd_ap_cert', 'CERTIFICATION', { issuingBody: 'Yoga Alliance' })],
      offers: [{ id: 'ofr_ap_1', specialtyId: 'spc_yoga', method: 'IN_PERSON', durationMinutes: 60, priceKz: 15000, note: 'Estúdio na Restinga', active: true }],
      history: [
        { id: 'val_ap_2', action: 'APPROVED', fromStatus: 'PENDING_REVIEW', toStatus: 'APPROVED', actor: 'PLATFORM_ADMIN', createdAt: daysAgo(18) },
        { id: 'val_ap_1', action: 'SUBMITTED', fromStatus: 'DRAFT', toStatus: 'PENDING_REVIEW', actor: 'PROFESSIONAL', createdAt: daysAgo(20) },
      ].reverse() as ValidationCase[],
    }),
    base({
      id: 'pro_suspensa',
      email: 'rui.tavares@exemplo.ao',
      displayName: 'Rui Tavares',
      city: 'Huambo',
      validationStatus: 'SUSPENDED',
      statusReason: 'Reclamações por confirmar.',
      statusChangedAt: daysAgo(4),
      specialtyIds: ['spc_nutri'],
      credentials: [cred('crd_su_id', 'IDENTITY'), cred('crd_su_lic', 'PROFESSIONAL_LICENSE')],
    }),
  ]
  for (const p of professionals) for (const c of p.credentials) files.set(c.id, new Blob([`Credencial simulada ${c.id}`], { type: c.contentType }))
  return { specialties, professionals, files }
}

export let professionalDb: ProfessionalDb = seed()

export function resetProfessionalDb() {
  professionalDb = seed()
}

export function newProfessional(email: string, password: string): MockProfessional {
  const rec = base({ id: proId('pro'), email, password, verified: false, createdAt: new Date().toISOString() })
  professionalDb.professionals.push(rec)
  return rec
}

export function adminSpecialtyView(spec: Specialty & { active: boolean }): AdminSpecialty {
  return {
    id: spec.id,
    name: spec.name,
    category: spec.category,
    active: spec.active,
    professionalCount: professionalDb.professionals.filter((p) => p.specialtyIds.includes(spec.id)).length,
  }
}
