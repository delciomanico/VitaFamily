/** Clínica parceira (global) ou privada da família (docs/04-domain/entities.md → Clinic). */
export interface Clinic {
  id: string
  type: 'PARTNER' | 'PRIVATE'
  familyId?: string
  name: string
  address?: string
  phone?: string
  email?: string
  status: 'ACTIVE' | 'ARCHIVED'
}
