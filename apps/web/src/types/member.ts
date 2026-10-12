import type { AppointmentItem } from './appointment'
import type { BloodType } from './health'
import type { ExaminationSummary } from './examination'
import type { PublicMember } from './family'
import type { MedicationSummary } from './medication'
import type { PrescriptionSummary } from './prescription'
import type { SharingCategory } from './sharing'

/**
 * Perfil de um membro visto por outro (UC-FAM-05, UC-PRV-02). Cada secção só vem preenchida
 * se o utilizador a puder ver; `undefined` = sem permissão (a UI mostra o cadeado).
 */
export interface MemberProfile {
  member: PublicMember
  isSelf: boolean
  manage: boolean
  /**
   * O utilizador é Family Admin e pode remover este membro (BR-MEM-16: um adulto com conta
   * recebe o pacote de dados por e-mail antes de ser apagado). A API ainda pode recusar com
   * `LAST_ADMIN`/`LAST_GUARDIAN` se a remoção deixasse a família sem Admin ou um dependente sem tutor.
   */
  canRemove: boolean
  /** Tutores do membro, quando é dependente. */
  guardians: string[]
  /** Categorias que o utilizador pode ver. */
  access: SharingCategory[]
  bloodType?: BloodType
  allergies?: string[]
  conditions?: string[]
  medications?: MedicationSummary[]
  appointments?: AppointmentItem[]
  examinations?: ExaminationSummary[]
  prescriptions?: PrescriptionSummary[]
}
