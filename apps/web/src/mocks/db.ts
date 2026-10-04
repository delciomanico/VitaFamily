import { families, invitations, members } from './data/families'
import { allergies, conditions } from './data/health'
import { users } from './data/users'

/**
 * “Base de dados” em memória do backend simulado.
 * Começa com os dados demo e perde as alterações ao recarregar a página.
 */
function seed() {
  return structuredClone({ users, families, members, invitations, allergies, conditions })
}

export let db = seed()

/** Repõe os dados demo (usado nos testes). */
export function resetDb() {
  db = seed()
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`
}
