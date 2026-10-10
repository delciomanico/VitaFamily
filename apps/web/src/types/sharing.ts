/** Categorias de partilha C2–C6 (C1, nome e data de nascimento, é sempre visível — BR-PRV-10). */
export const SHARING_CATEGORIES = ['ALLERGIES', 'CONDITIONS', 'MEDICATION', 'APPOINTMENTS', 'EXAMS'] as const
export type SharingCategory = (typeof SHARING_CATEGORIES)[number]

/** Partilha de leitura de uma categoria (docs/04-domain/entities.md → SharingGrant). */
export interface SharingGrant {
  familyId: string
  ownerMemberId: string
  /** Nulo = toda a família (DM3). */
  granteeMemberId?: string
  category: SharingCategory
  grantedBy: string
}
