import type { InsuranceAccount, Insurer } from '@/types/insurance'
import { DEMO_PASSWORD } from './users'

/**
 * Contas do portal da seguradora (`InsuranceAccount`, ADR-021). Espaço de identidade **separado**
 * de `users` e de `clinicAccounts`. A palavra-passe só existe nesta camada mock.
 */
export interface MockInsuranceAccountRecord extends InsuranceAccount {
  password: string
}

export const DEMO_INSURANCE_ADMIN_EMAIL = 'admin@seguradoraaurora.pt'
export const DEMO_INSURANCE_AGENT_EMAIL = 'agente@seguradoraaurora.pt'

export const insurers: Insurer[] = [
  { id: 'ins_aurora', name: 'Seguradora Aurora', taxId: '500100200', status: 'ACTIVE' },
]

export const insuranceAccounts: MockInsuranceAccountRecord[] = [
  {
    id: 'iac_aurora_admin',
    insurerId: 'ins_aurora',
    email: DEMO_INSURANCE_ADMIN_EMAIL,
    password: DEMO_PASSWORD,
    role: 'INSURANCE_ADMIN',
    status: 'ACTIVE',
  },
  {
    id: 'iac_aurora_agent',
    insurerId: 'ins_aurora',
    email: DEMO_INSURANCE_AGENT_EMAIL,
    password: DEMO_PASSWORD,
    role: 'INSURANCE_AGENT',
    status: 'ACTIVE',
  },
]
