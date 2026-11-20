import type { ProfessionalRequirement } from '@/types/professional'

const TITLE = /^(dr\.?ª?|dra\.?|prof\.?ª?|profa\.?)\s+/i
const LUANDA_HOUR = new Intl.DateTimeFormat('pt-PT', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Africa/Luanda' })

/** «Dr.ª Marta Lopes» → «Dr.ª Marta»; sem título no nome, só o primeiro nome (não se inventa o género). */
export function greetingName(displayName?: string): string {
  const full = displayName?.trim()
  if (!full) return ''
  const match = full.match(TITLE)
  const rest = match ? full.slice(match[0].length) : full
  const first = rest.split(/\s+/)[0] ?? ''
  return match ? `${match[1]} ${first}` : first
}

/** «Bom dia» / «Boa tarde» / «Boa noite» pela hora de Luanda. */
export function greeting(now: Date = new Date()): string {
  const hour = Number(LUANDA_HOUR.format(now))
  if (hour < 12) return 'Bom dia'
  if (hour < 20) return 'Boa tarde'
  return 'Boa noite'
}

const PROFILE_REQUIREMENTS: ProfessionalRequirement[] = ['DISPLAY_NAME', 'CITY', 'SPECIALTY']

/** Em falta há algo do perfil (nome, cidade, especialidade) ou só documentos? */
export const missingProfile = (missing: ProfessionalRequirement[]) => missing.some((item) => PROFILE_REQUIREMENTS.includes(item))
export const missingDocuments = (missing: ProfessionalRequirement[]) => missing.some((item) => item.startsWith('CREDENTIAL_'))

