import { respond } from '../respond'
import { publicPartners } from '../data/partners'

/** Diretório público de parceiros (sem autenticação). */
export function listPublicPartners() {
  return respond(() => [...publicPartners].sort((a, b) => a.name.localeCompare(b.name, 'pt-PT')))
}
