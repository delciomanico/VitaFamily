import * as mock from '@/mocks/handlers/examOrders'
import { apiFetch, hasApiBackend } from '@/lib/apiClient'
import type { ExamOrderStatus, FamilyExamOrder } from '@/types/examOrder'

/** Pedidos de exame das clínicas ao membro (M15 U, BR-CLN-53); só titular/tutor (o servidor decide). */

interface ApiFamilyExamOrder extends Omit<FamilyExamOrder, 'note' | 'examinationId'> {
  note?: string | null
  examinationId?: string | null
}

const toOrder = (o: ApiFamilyExamOrder): FamilyExamOrder => ({
  ...o,
  note: o.note ?? undefined,
  examinationId: o.examinationId ?? undefined,
})

export interface ExamOrderFilter {
  status?: ExamOrderStatus
  appointmentId?: string
}

export const familyExamOrderService = {
  /** Por omissão exclui `CANCELLED`. */
  list: async (familyId: string, userId: string, memberId: string, filter: ExamOrderFilter = {}): Promise<FamilyExamOrder[]> => {
    if (!hasApiBackend()) return (await mock.listFamilyExamOrders(familyId, userId, memberId, filter)).items
    const query = new URLSearchParams()
    if (filter.status) query.set('status', filter.status)
    if (filter.appointmentId) query.set('appointmentId', filter.appointmentId)
    const suffix = query.size > 0 ? `?${query}` : ''
    const page = await apiFetch<{ items: ApiFamilyExamOrder[] }>(
      `/families/${familyId}/members/${memberId}/exam-orders${suffix}`,
    )
    return page.items.map(toOrder)
  },
}
