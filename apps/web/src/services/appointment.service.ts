import * as api from '@/mocks/handlers/appointments'

export type { AppointmentInput, AppointmentRequestInput, NewAppointmentInput } from '@/mocks/handlers/appointments'

/** Consultas. Hoje mock; depois /api/v1/families/{id}/members/{id}/appointments. */
export const appointmentService = {
  listAppointments: api.listAppointments,
  getAppointment: api.getAppointment,
  listAvailableSlots: api.listAvailableSlots,
  requestAppointment: api.requestAppointment,
  createAppointment: api.createAppointment,
  updateAppointment: api.updateAppointment,
  setAppointmentStatus: api.setAppointmentStatus,
}
