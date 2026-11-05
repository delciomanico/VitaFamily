import type { Recommendation } from '@/types/recommendation'
import { findVisibleMember } from '../access'
import { db } from '../db'
import { respond } from '../respond'

/**
 * `GET /families/{f}/members/{m}/recommendations` (BR-CLN-09): as recomendações das clínicas ao
 * membro, mais recentes primeiro. Só leitura — a família nunca as escreve nem as altera.
 */
export function listRecommendations(
  familyId: string,
  userId: string,
  memberId: string,
  origin: { appointmentId?: string; examinationId?: string } = {},
) {
  return respond((): Recommendation[] => {
    findVisibleMember(familyId, userId, memberId)
    return db.recommendations
      .filter(
        (r) =>
          r.familyId === familyId &&
          r.memberId === memberId &&
          (!origin.appointmentId || r.appointmentId === origin.appointmentId) &&
          (!origin.examinationId || r.examinationId === origin.examinationId),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(({ familyId: _f, clinicId: _c, ...rec }) => rec)
  })
}
