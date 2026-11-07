import type { ClinicProfessional, ClinicScheduleRule, ClinicServiceType } from '@/types/clinic'

/** Moeda da clínica (`clinics.currency`, omissão AOA; só leitura nas fases a1/a2). */
export const CLINIC_CURRENCY = 'AOA'

type Owned<T> = T & { clinicId: string }

/** Profissionais demo da Clínica Horizonte (BR-CLN-11). */
export const seedProfessionals: Array<Owned<ClinicProfessional>> = [
  { id: 'pro_ana', clinicId: 'cln_horizonte', name: 'Dr.ª Ana Costa', specialty: 'Cardiologia', active: true },
  { id: 'pro_ines', clinicId: 'cln_horizonte', name: 'Dr.ª Inês Lima', specialty: 'Dermatologia', active: true },
  { id: 'pro_rui', clinicId: 'cln_horizonte', name: 'Dr. Rui Mendes', specialty: 'Pediatria', active: true },
]

/** Serviços demo: duração em minutos, preço em cêntimos de AOA (ex.: 15 000 Kz = 1 500 000). */
export const seedServices: Array<Owned<ClinicServiceType>> = [
  { id: 'svc_cardio', clinicId: 'cln_horizonte', name: 'Consulta de cardiologia', kind: 'APPOINTMENT', durationMinutes: 30, priceMinor: 1_500_000, currency: CLINIC_CURRENCY, active: true },
  { id: 'svc_derma', clinicId: 'cln_horizonte', name: 'Consulta de dermatologia', kind: 'APPOINTMENT', durationMinutes: 30, priceMinor: 1_200_000, currency: CLINIC_CURRENCY, active: true },
  { id: 'svc_pedia', clinicId: 'cln_horizonte', name: 'Consulta de pediatria', kind: 'APPOINTMENT', durationMinutes: 45, priceMinor: 1_000_000, currency: CLINIC_CURRENCY, active: true },
  { id: 'svc_analises', clinicId: 'cln_horizonte', name: 'Análises ao sangue', kind: 'EXAM', durationMinutes: 15, priceMinor: 650_000, currency: CLINIC_CURRENCY, active: true },
  { id: 'svc_eco', clinicId: 'cln_horizonte', name: 'Ecografia abdominal', kind: 'EXAM', durationMinutes: 30, currency: CLINIC_CURRENCY, active: true },
]

/** Regra demo: cardiologia de segunda a sexta, à tarde (não colide com os horários manuais da manhã). */
export const seedScheduleRules: Array<Owned<ClinicScheduleRule>> = [
  {
    id: 'rul_cardio_tarde',
    clinicId: 'cln_horizonte',
    professionalId: 'pro_ana',
    serviceTypeId: 'svc_cardio',
    weekdays: [1, 2, 3, 4, 5],
    startTime: '15:00',
    endTime: '17:00',
    capacity: 1,
    active: true,
  },
]
