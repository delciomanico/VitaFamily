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
}
