/**
 * Parceiro listado no diretório público (clínicas e seguradoras ligadas ao Vita Family).
 * Só dados institucionais que a entidade aceita tornar públicos: nunca contas, pacientes ou beneficiários.
 */
export type PartnerKind = 'CLINIC' | 'INSURER'

export interface PublicPartner {
  id: string
  kind: PartnerKind
  name: string
  description?: string
  /** Província ou cidade, para filtrar (ex.: «Luanda»). */
  city?: string
  address?: string
  phone?: string
  email?: string
  website?: string
  openingHours?: string
  /** Só clínicas: especialidades e serviços oferecidos. */
  specialties?: string[]
  /** Só clínicas: seguradoras com cobertura ligada ao Vita Family. */
  insurers?: string[]
}
