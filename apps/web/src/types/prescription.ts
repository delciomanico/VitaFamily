import type { DocumentInfo } from './document'
import type { MedicationPlan } from './medication'

/** Receita — categoria C4 (docs/04-domain/entities.md → Prescription). */
export type PrescriptionStatus = 'ACTIVE' | 'COMPLETED' | 'CANCELLED'

export interface Prescription {
  id: string
  familyId: string
  memberId: string
  /** Data ISO, obrigatória e não futura. */
  issuedOn: string
  doctorName?: string
  /** TBD: a especificação pede “Clínica”; o domínio não a tem na receita. */
  clinicName?: string
  notes?: string
  status: PrescriptionStatus
  /**
   * Quem emitiu a receita (BR-RX-07, D18): a própria família ou a clínica parceira ao completar
   * a consulta. Omisso = `FAMILY` (receitas antigas).
   */
  issuedBy?: 'FAMILY' | 'CLINIC'
  /** Consulta de origem, só quando `issuedBy=CLINIC` (rastreabilidade, BR-RX-07). */
  appointmentId?: string
}

/** Linha da lista de receitas. */
export interface PrescriptionSummary {
  prescription: Prescription
  memberName: string
  medicationCount: number
}

/** Receita com os seus medicamentos (planos de toma) e documentos. */
export interface PrescriptionDetail {
  prescription: Prescription
  memberName: string
  medications: MedicationPlan[]
  documents: DocumentInfo[]
}
