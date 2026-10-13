import type { ClinicAccount } from '@/types/clinic'
import { DEMO_PASSWORD } from './users'

/**
 * Contas do portal da clínica (`ClinicAccount`, ADR-020/D18). Espaço de identidade **separado**
 * de `users`: sem `userId`, sem família, sem relação com `family_members`. A palavra-passe só
 * existe nesta camada mock.
 */
export interface MockClinicAccountRecord extends ClinicAccount {
  password: string
}

/** Admin da Clínica Horizonte (criado pelo Platform Admin, BR-CLN-05). Credencial fictícia. */
export const DEMO_CLINIC_ADMIN_EMAIL = 'admin@clinicahorizonte.pt'
/** Gestor da Clínica Horizonte (criado por self-service pelo Admin da clínica). */
export const DEMO_CLINIC_MANAGER_EMAIL = 'rececao@clinicahorizonte.pt'

export const clinicAccounts: MockClinicAccountRecord[] = [
  {
    id: 'cac_horizonte_admin',
    clinicId: 'cln_horizonte',
    email: DEMO_CLINIC_ADMIN_EMAIL,
    password: DEMO_PASSWORD,
    role: 'CLINIC_ADMIN',
    status: 'ACTIVE',
  },
  {
    id: 'cac_horizonte_rececao',
    clinicId: 'cln_horizonte',
    email: DEMO_CLINIC_MANAGER_EMAIL,
    password: DEMO_PASSWORD,
    role: 'CLINIC_MANAGER',
    status: 'ACTIVE',
  },
]
