import * as api from '@/mocks/handlers/clinicPortal'

export { SLOT_DURATIONS } from '@/mocks/handlers/clinicPortal'
export type { PublishSlotsInput } from '@/mocks/handlers/clinicPortal'

/** Portal da clínica parceira (D17). Hoje mock; contrato da API pendente (ver docs → D17). */
export const clinicPortalService = {
  getClinicMembership: api.getClinicMembership,
  listClinicBookings: api.listClinicBookings,
  confirmBooking: api.confirmBooking,
  rejectBooking: api.rejectBooking,
  cancelBooking: api.cancelBooking,
  listClinicSlots: api.listClinicSlots,
  publishSlots: api.publishSlots,
  removeSlot: api.removeSlot,
}
