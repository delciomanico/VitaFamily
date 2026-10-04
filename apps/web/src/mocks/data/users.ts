import type { User } from '@/types/user'

/** Registo de utilizador do backend simulado. A palavra-passe só existe nesta camada mock. */
export interface MockUserRecord extends User {
  password: string
}

/** Credenciais de demonstração (fictícias, documentadas no README). */
export const DEMO_EMAIL = 'demo@vitafamily.app'
export const DEMO_PASSWORD = 'password'

/** Código de verificação aceite pelo mock (o real seria enviado por e-mail). */
export const DEMO_VERIFICATION_CODE = '123456'

export const users: MockUserRecord[] = [
  {
    id: 'usr_monarca',
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    name: 'Monarca Lopes',
    birthDate: '1985-03-12',
    timezone: 'Africa/Luanda',
    status: 'ACTIVE',
  },
]
