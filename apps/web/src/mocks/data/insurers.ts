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
/** Gestor de beneficiários (ADR-025, Fase A): só o módulo operacional, sem pedidos de reembolso. */
export const DEMO_INSURANCE_MANAGER_EMAIL = 'beneficiarios@seguradoraaurora.pt'
/** Analista e Supervisor de autorizações (marco B fatia 4, ADR-035). */
export const DEMO_INSURANCE_ANALYST_EMAIL = 'analista@seguradoraaurora.pt'
export const DEMO_INSURANCE_SUPERVISOR_EMAIL = 'supervisor@seguradoraaurora.pt'

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
  {
    id: 'iac_aurora_manager',
    insurerId: 'ins_aurora',
    email: DEMO_INSURANCE_MANAGER_EMAIL,
    password: DEMO_PASSWORD,
    role: 'BENEFICIARY_MANAGER',
    status: 'ACTIVE',
  },
  // Marco B fatia 4: dois analistas e dois supervisores (um supervisor não decide o recurso de uma recusa sua).
  { id: 'iac_aurora_analyst', insurerId: 'ins_aurora', email: DEMO_INSURANCE_ANALYST_EMAIL, password: DEMO_PASSWORD, role: 'AUTHORIZATION_ANALYST', status: 'ACTIVE' },
  { id: 'iac_aurora_analyst2', insurerId: 'ins_aurora', email: 'analista2@seguradoraaurora.pt', password: DEMO_PASSWORD, role: 'AUTHORIZATION_ANALYST', status: 'ACTIVE' },
  { id: 'iac_aurora_supervisor', insurerId: 'ins_aurora', email: DEMO_INSURANCE_SUPERVISOR_EMAIL, password: DEMO_PASSWORD, role: 'SUPERVISOR', status: 'ACTIVE' },
  { id: 'iac_aurora_supervisor2', insurerId: 'ins_aurora', email: 'supervisor2@seguradoraaurora.pt', password: DEMO_PASSWORD, role: 'SUPERVISOR', status: 'ACTIVE' },
]
