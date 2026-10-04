/**
 * Armazenamento local mínimo. Nunca guardar dados de saúde, palavras-passe ou tokens.
 * - sessão (sessionStorage): só o id do utilizador mock, termina ao fechar o separador;
 * - preferências (localStorage): só flags de UI, como “onboarding visto”.
 */

const SESSION_KEY = 'vf.session.userId'
const ONBOARDING_KEY = 'vf.onboarding.seen'

function read(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key)
  } catch {
    return null
  }
}

function write(storage: () => Storage, key: string, value: string | null) {
  try {
    if (value === null) storage().removeItem(key)
    else storage().setItem(key, value)
  } catch {
    // Armazenamento indisponível (modo privado): a app continua a funcionar sem persistência.
  }
}

const session = () => window.sessionStorage
const local = () => window.localStorage

export const sessionStore = {
  getUserId: () => read(session, SESSION_KEY),
  setUserId: (userId: string | null) => write(session, SESSION_KEY, userId),
}

export const preferences = {
  hasSeenOnboarding: () => read(local, ONBOARDING_KEY) === '1',
  markOnboardingSeen: () => write(local, ONBOARDING_KEY, '1'),
}
