import * as api from '@/mocks/handlers/clinicPortal'
import { hasApiBackend } from '@/lib/apiClient'

export { SLOT_DURATIONS } from '@/mocks/handlers/clinicPortal'
export type { PublishSlotsInput } from '@/mocks/handlers/clinicPortal'

/**
 * Portal da clínica parceira (D17). Contrato da API pendente (adiado): com a API real ninguém é
 * clínica parceira, logo o portal fica inacessível; o resto continua em mock.
 */
export const clinicPortalService = {
  getClinicMembership: hasApiBackend() ? async (_userId: string) => null : api.getClinicMembership,
  listClinicBookings: api.listClinicBookings,
  confirmBooking: api.confirmBooking,
  rejectBooking: api.rejectBooking,
  cancelBooking: api.cancelBooking,
  listClinicSlots: api.listClinicSlots,
  publishSlots: api.publishSlots,
  removeSlot: api.removeSlot,
}
