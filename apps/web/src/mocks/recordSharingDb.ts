import type { ProfessionalPrescriptionMedication, RecordShareCategory, ShareValidity } from '@/types/recordSharing'

/**
 * “Base de dados” em memória de MK4 (partilhas, vistas e receitas dos profissionais). A partilha guarda só
 * metadados: o conteúdo lê-se dos registos a cada abertura e nunca se guarda (BR-MKT-68/75). `EXPIRED` não
 * é estado gravado: deriva-se de `expiresAt` (state-machines.md, RecordShare).
 */

const HOUR = 3_600_000
const DAY = 86_400_000

export interface MockShare {
  id: string
  familyId: string
  memberId: string
  bookingId: string
  professionalId: string
  professionalCategory: 'HEALTH' | 'WELLNESS'
  participantLabel: string
  categories: RecordShareCategory[]
  validity: ShareValidity
  viewOnce: boolean
  /** Estado gravado; `EXPIRED` deriva-se. */
  status: 'ACTIVE' | 'REVOKED' | 'CONSUMED'
  expiresAt: string
  revokedAt?: string
  consumedAt?: string
  clientRequestId?: string
  createdAt: string
}

export interface MockShareView {
  shareId: string
  viewNo: number
  viewedAt: string
  categories: RecordShareCategory[]
}

/** Receita emitida pelo profissional: o que escreveu (relido por `GET …/prescription`) e a receita criada no registo. */
export interface MockProfessionalPrescription {
  bookingId: string
  professionalId: string
  prescriptionId: string
  issuedOn: string
  notes?: string
  medications: ProfessionalPrescriptionMedication[]
  createdAt: string
}

interface RecordSharingDb {
  shares: MockShare[]
  views: MockShareView[]
  prescriptions: MockProfessionalPrescription[]
  /** Criações por utilizador (limite de 20/dia, BR-MKT-77). */
  creations: Array<{ userId: string; at: number }>
}

/**
 * Receita digital (BR-MKT-79): desligada por omissão até ao parecer jurídico. No mock lê-se de
 * `VITE_DIGITAL_PRESCRIPTION_ENABLED` (nunca no código de negócio); com a flag desligada a UI não mostra o
 * botão e as rotas dão `404`.
 */
const flagFromEnv = (): boolean => (import.meta.env as Record<string, string | undefined>).VITE_DIGITAL_PRESCRIPTION_ENABLED === 'true'
export const recordSharingFlags = { digitalPrescription: flagFromEnv() }

export function setDigitalPrescriptionEnabled(enabled: boolean) {
  recordSharingFlags.digitalPrescription = enabled
}

let seq = 0
export function shareId(prefix: string): string {
  seq += 1
  return `${prefix}_${seq.toString(36)}${crypto.randomUUID().slice(0, 6)}`
}

const ago = (ms: number) => new Date(Date.now() - ms).toISOString()
const ahead = (ms: number) => new Date(Date.now() + ms).toISOString()

function seed(): RecordSharingDb {
  const base = { familyId: 'fam_monarca', memberId: 'mem_monarca', professionalId: 'pro_aprovada', professionalCategory: 'WELLNESS' as const, participantLabel: 'Monarca' }
  const shares: MockShare[] = [
    // Ativa, 7 dias, medicação: já aberta uma vez pelo profissional (demonstra «Quem viu»).
    { ...base, id: 'shr_seed_active', bookingId: 'bkg_seed_pa_done', categories: ['MEDICATION'], validity: 'D7', viewOnce: false, status: 'ACTIVE', expiresAt: ahead(6 * DAY), createdAt: ago(DAY) },
    // Visualização única ainda por abrir.
    { ...base, id: 'shr_seed_once', bookingId: 'bkg_seed_pa_conf', categories: ['MEDICATION'], validity: 'H24', viewOnce: true, status: 'ACTIVE', expiresAt: ahead(20 * HOUR), createdAt: ago(4 * HOUR) },
    // Parada pela família.
    { ...base, id: 'shr_seed_revoked', bookingId: 'bkg_seed_pa_done', categories: ['MEDICATION'], validity: 'D30', viewOnce: false, status: 'REVOKED', expiresAt: ahead(20 * DAY), revokedAt: ago(2 * DAY), createdAt: ago(3 * DAY) },
  ]
  const views: MockShareView[] = [{ shareId: 'shr_seed_active', viewNo: 1, viewedAt: ago(3 * HOUR), categories: ['MEDICATION'] }]
  return { shares, views, prescriptions: [], creations: [] }
}

export let recordSharingDb: RecordSharingDb = seed()

export function resetRecordSharingDb() {
  recordSharingDb = seed()
  recordSharingFlags.digitalPrescription = flagFromEnv()
}
