import type { Appointment } from '@/types/appointment'
import { at } from '../time'
import { slotId } from './clinics'

/** Consultas fictícias, com datas relativas a hoje. */
export function seedAppointments(now: Date = new Date()): Appointment[] {
  const base = { familyId: 'fam_monarca' }
  return [
    {
      ...base,
      id: 'apt_cardio',
      memberId: 'mem_monarca',
      scheduledAt: at(1, '09:30', now),
      status: 'SCHEDULED',
      slotId: slotId(1, '09:30', 'Cardiologia'),
      specialty: 'Cardiologia',
      professionalName: 'Dr.ª Ana Costa',
      clinicId: 'cln_horizonte',
      clinicName: 'Clínica Horizonte',
      reason: 'Consulta de rotina',
    },
    {
      ...base,
      id: 'apt_pediatria',
      memberId: 'mem_pedro',
      scheduledAt: at(6, '15:00', now),
      status: 'SCHEDULED',
      slotId: slotId(6, '15:00', 'Pediatria'),
      specialty: 'Pediatria',
      professionalName: 'Dr. Rui Mendes',
      clinicId: 'cln_horizonte',
      clinicName: 'Clínica Horizonte',
    },
    {
      // Pedido à clínica parceira, à espera de confirmação (D17).
      ...base,
      id: 'apt_derma',
      memberId: 'mem_maria',
      scheduledAt: at(3, '11:00', now),
      status: 'REQUESTED',
      slotId: slotId(3, '11:00', 'Dermatologia'),
      specialty: 'Dermatologia',
      professionalName: 'Dr.ª Inês Lima',
      clinicId: 'cln_horizonte',
      clinicName: 'Clínica Horizonte',
      notes: 'Sinal no braço para observar.',
    },
    {
      // Agendada e já passada: item pendente (UC-RPT-02).
      ...base,
      id: 'apt_endocrino',
      memberId: 'mem_joao',
      scheduledAt: at(-3, '10:00', now),
      status: 'SCHEDULED',
      specialty: 'Endocrinologia',
      professionalName: 'Dr. Paulo Neto',
      clinicId: 'cln_bairro',
      clinicName: 'Centro de Saúde do Bairro',
    },
    {
      ...base,
      id: 'apt_gineco',
      memberId: 'mem_maria',
      scheduledAt: at(-40, '11:00', now),
      status: 'COMPLETED',
      specialty: 'Ginecologia',
      professionalName: 'Dr.ª Sofia Reis',
      clinicId: 'cln_horizonte',
      clinicName: 'Clínica Horizonte',
    },
    {
      ...base,
      id: 'apt_geral',
      memberId: 'mem_monarca',
      scheduledAt: at(-90, '08:30', now),
      status: 'COMPLETED',
      specialty: 'Medicina geral',
      professionalName: 'Dr. Tiago Alves',
      clinicId: 'cln_bairro',
      clinicName: 'Centro de Saúde do Bairro',
    },
  ]
}
