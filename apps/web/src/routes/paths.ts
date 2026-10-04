/** Caminhos da aplicação: único sítio onde as URLs são escritas. */
export const paths = {
  splash: '/',
  onboarding: '/onboarding',
  login: '/login',
  register: '/register',
  forgotPassword: '/forgot-password',
  verify: '/verify',

  setupFamily: '/setup/family',
  setupHealth: '/setup/health',
  setupMembers: '/setup/members',

  home: '/app',
  health: '/app/health',
  healthProfile: '/app/health/profile',
  prescriptions: '/app/health/prescriptions',
  prescriptionNew: '/app/health/prescriptions/new',
  prescription: (id: string) => `/app/health/prescriptions/${id}`,
  medications: '/app/health/medications',
  medication: (id: string) => `/app/health/medications/${id}`,
  examinations: '/app/health/examinations',
  examinationNew: '/app/health/examinations/new',
  examination: (id: string) => `/app/health/examinations/${id}`,
  examinationHistory: (id: string) => `/app/health/examinations/${id}/history`,
  medicalHistory: '/app/health/history',

  appointments: '/app/appointments',
  appointmentNew: '/app/appointments/new',
  appointment: (id: string) => `/app/appointments/${id}`,

  family: '/app/family',
  familyMember: (id: string) => `/app/family/${id}`,
  familyMemberHistory: (id: string) => `/app/family/${id}/history`,

  alerts: '/app/alerts',
  familyReport: '/app/reports/family',
  preventiveReport: '/app/reports/preventive',
  settings: '/app/settings',

  // Portal da clínica parceira (D17).
  clinic: '/clinic',
  clinicAgenda: '/clinic/agenda',
  clinicSlots: '/clinic/slots',
} as const
