import * as api from '@/mocks/handlers/health'
import { apiFetch, hasApiBackend } from '@/lib/apiClient'
import type { HealthProfileInput } from '@/mocks/handlers/health'
import type { FamilyMember } from '@/types/family'
import type { Allergy, BloodType, HealthProfile, MedicalCondition } from '@/types/health'

export type { HealthProfileInput } from '@/mocks/handlers/health'

/** `Member` (openapi.yaml): só os campos usados aqui. */
interface ApiMember {
  id: string
  familyId: string
  name: string
  birthDate: string
  isDependent: boolean
  role: FamilyMember['role'] | null
  status: 'ACTIVE' | 'BLOCKED'
}

interface ApiAllergy {
  id: string
  name: string
  notes?: string | null
  since?: string | null
}

interface ApiCondition extends ApiAllergy {
  kind: 'CONDITION' | 'HISTORY'
  until?: string | null
}

/** Tipo sanguíneo da UI ('A+') ↔ contrato (`A_POS`). */
const toApiBloodType = (value: BloodType) => value.replace('+', '_POS').replace('-', '_NEG')
const fromApiBloodType = (value: string): BloodType | undefined =>
  value === 'UNKNOWN' ? undefined : (value.replace('_POS', '+').replace('_NEG', '-') as BloodType)

const base = (familyId: string, memberId: string) => `/families/${familyId}/members/${memberId}`

/** GET member + blood-type + allergies + conditions (perfil de saúde agregado). */
async function apiGetHealthProfile(familyId: string, memberId: string): Promise<HealthProfile> {
  const path = base(familyId, memberId)
  const [member, bloodType, allergies, conditions] = await Promise.all([
    apiFetch<ApiMember>(path),
    apiFetch<{ bloodType: string }>(`${path}/blood-type`),
    apiFetch<ApiAllergy[]>(`${path}/allergies`),
    apiFetch<ApiCondition[]>(`${path}/conditions`),
  ])
  return {
    member: {
      id: member.id,
      familyId: member.familyId,
      name: member.name,
      birthDate: member.birthDate,
      role: member.role ?? undefined,
      isDependent: member.isDependent,
      status: member.status,
      bloodType: fromApiBloodType(bloodType.bloodType),
    },
    allergies: allergies.map(
      (a): Allergy => ({ id: a.id, familyId, memberId, name: a.name, notes: a.notes ?? undefined, since: a.since ?? undefined }),
    ),
    conditions: conditions
      .filter((c) => c.kind === 'CONDITION')
      .map(
        (c): MedicalCondition => ({
          id: c.id,
          familyId,
          memberId,
          name: c.name,
          kind: 'CONDITION',
          notes: c.notes ?? undefined,
          since: c.since ?? undefined,
          until: c.until ?? undefined,
        }),
      ),
  }
}

/**
 * Guarda nome/data, tipo sanguíneo e substitui alergias/condições atuais pelos nomes indicados
 * (mantém os itens já existentes com o mesmo nome). `sex` não existe no contrato — não é enviado.
 */
async function apiSaveHealthProfile(
  familyId: string,
  memberId: string,
  input: HealthProfileInput,
): Promise<HealthProfile> {
  const path = base(familyId, memberId)
  const current = await apiGetHealthProfile(familyId, memberId)

  if (current.member.name !== input.name.trim() || current.member.birthDate !== input.birthDate) {
    await apiFetch(path, { method: 'PATCH', body: { name: input.name.trim(), birthDate: input.birthDate } })
  }
  if (input.bloodType !== current.member.bloodType) {
    await apiFetch(`${path}/blood-type`, {
      method: 'PUT',
      body: { bloodType: input.bloodType ? toApiBloodType(input.bloodType) : 'UNKNOWN' },
    })
  }

  const wanted = (names: string[]) => [...new Set(names.map((n) => n.trim()).filter(Boolean))]
  const sync = async (
    kind: 'allergies' | 'conditions',
    existing: Array<{ id: string; name: string }>,
    names: string[],
  ) => {
    const target = wanted(names)
    for (const item of existing.filter((e) => !target.includes(e.name))) {
      await apiFetch(`${path}/${kind}/${item.id}`, { method: 'DELETE' })
    }
    for (const name of target.filter((n) => !existing.some((e) => e.name === n))) {
      await apiFetch(`${path}/${kind}`, {
        method: 'POST',
        body: kind === 'conditions' ? { name, kind: 'CONDITION' } : { name },
      })
    }
  }
  await sync('allergies', current.allergies, input.allergies)
  await sync('conditions', current.conditions, input.conditions)

  return apiGetHealthProfile(familyId, memberId)
}

/** Perfil de saúde e histórico médico. Com `VITE_API_URL` usa a API real; o histórico continua mock. */
export const healthService = {
  getHealthProfile: hasApiBackend()
    ? (familyId: string, _userId: string, memberId: string) => apiGetHealthProfile(familyId, memberId)
    : api.getHealthProfile,
  saveHealthProfile: hasApiBackend()
    ? (familyId: string, _userId: string, memberId: string, input: HealthProfileInput) =>
        apiSaveHealthProfile(familyId, memberId, input)
    : api.saveHealthProfile,
  getMedicalHistory: api.getMedicalHistory,
}
