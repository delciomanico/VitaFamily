import * as mock from '@/mocks/handlers/clinicCatalog'
import { hasApiBackend } from '@/lib/apiClient'
import { clinicApiFetch } from '@/lib/clinicApiClient'
import { AppError } from '@/lib/errors'
import { clinicSessionStore } from '@/lib/storage'
import type {
  ClinicProfessional,
  ClinicProfessionalInput,
  ClinicProfessionalPatch,
  ClinicScheduleRule,
  ClinicScheduleRuleInput,
  ClinicScheduleRulePatch,
  ClinicServiceType,
  ClinicServiceTypeInput,
  ClinicServiceTypePatch,
  ClinicTimeOff,
  ClinicTimeOffInput,
  ScheduleGeneration,
  ScheduleRuleResult,
  SlotKind,
  TimeOffResult,
} from '@/types/clinic'

/**
 * Catálogo da clínica, regras de horário e bloqueios (`/clinic-portal/{professionals,services,
 * schedule-rules,time-off}`, M14 a1/a2, BR-CLN-11..16). Mesmo padrão do `clinicPortalService`:
 * backend simulado sem `VITE_API_URL`, `clinicApiFetch` com a API real.
 */

interface ApiProfessional {
  id: string
  name: string
  specialty?: string | null
  active: boolean
}

interface ApiService {
  id: string
  name: string
  kind: SlotKind
  durationMinutes: number
  priceMinor?: number | null
  currency: string
  active: boolean
}

interface ApiRule {
  id: string
  professionalId: string
  serviceTypeId: string
  weekdays: number[]
  startTime: string
  endTime: string
  validFrom?: string | null
  validUntil?: string | null
  capacity: number
  active: boolean
}

interface ApiTimeOff {
  id: string
  professionalId: string
  startsAt: string
  endsAt: string
  reason?: string | null
  bookedSlotCount: number
}

interface ApiRuleResult {
  rule: ApiRule
  generation: ScheduleGeneration
}

interface ApiTimeOffResult {
  timeOff: ApiTimeOff
  removedSlots: number
  bookedSlots: TimeOffResult['bookedSlots']
}

const toProfessional = (p: ApiProfessional): ClinicProfessional => ({
  id: p.id,
  name: p.name,
  specialty: p.specialty ?? undefined,
  active: p.active,
})

const toService = (s: ApiService): ClinicServiceType => ({
  id: s.id,
  name: s.name,
  kind: s.kind,
  durationMinutes: s.durationMinutes,
  priceMinor: s.priceMinor ?? undefined,
  currency: s.currency,
  active: s.active,
})

const toRule = (r: ApiRule): ClinicScheduleRule => ({
  id: r.id,
  professionalId: r.professionalId,
  serviceTypeId: r.serviceTypeId,
  weekdays: [...r.weekdays].sort((a, b) => a - b),
  startTime: r.startTime,
  endTime: r.endTime,
  validFrom: r.validFrom ?? undefined,
  validUntil: r.validUntil ?? undefined,
  capacity: r.capacity,
  active: r.active,
})

const toTimeOff = (t: ApiTimeOff): ClinicTimeOff => ({
  id: t.id,
  professionalId: t.professionalId,
  startsAt: t.startsAt,
  endsAt: t.endsAt,
  reason: t.reason ?? undefined,
  bookedSlotCount: t.bookedSlotCount,
})

const toRuleResult = (r: ApiRuleResult): ScheduleRuleResult => ({ rule: toRule(r.rule), generation: r.generation })

function query(params: Record<string, string | boolean | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value !== undefined) search.set(key, String(value))
  const text = search.toString()
  return text ? `?${text}` : ''
}

const apiImpl = {
  async listProfessionals(filter: { active?: boolean } = {}): Promise<ClinicProfessional[]> {
    return (await clinicApiFetch<ApiProfessional[]>(`/professionals${query(filter)}`)).map(toProfessional)
  },
  async createProfessional(input: ClinicProfessionalInput): Promise<ClinicProfessional> {
    return toProfessional(
      await clinicApiFetch<ApiProfessional>('/professionals', {
        method: 'POST',
        body: { name: input.name.trim(), specialty: input.specialty?.trim() || null },
      }),
    )
  },
  async updateProfessional(id: string, patch: ClinicProfessionalPatch): Promise<ClinicProfessional> {
    return toProfessional(
      await clinicApiFetch<ApiProfessional>(`/professionals/${id}`, {
        method: 'PATCH',
        body: {
          ...patch,
          ...(patch.name !== undefined && { name: patch.name.trim() }),
          ...(typeof patch.specialty === 'string' && { specialty: patch.specialty.trim() || null }),
        },
      }),
    )
  },

  async listServices(filter: { active?: boolean; kind?: SlotKind } = {}): Promise<ClinicServiceType[]> {
    return (await clinicApiFetch<ApiService[]>(`/services${query(filter)}`)).map(toService)
  },
  async createService(input: ClinicServiceTypeInput): Promise<ClinicServiceType> {
    return toService(
      await clinicApiFetch<ApiService>('/services', {
        method: 'POST',
        body: {
          name: input.name.trim(),
          kind: input.kind,
          durationMinutes: input.durationMinutes,
          priceMinor: input.priceMinor ?? null,
        },
      }),
    )
  },
  async updateService(id: string, patch: ClinicServiceTypePatch): Promise<ClinicServiceType> {
    return toService(
      await clinicApiFetch<ApiService>(`/services/${id}`, {
        method: 'PATCH',
        body: { ...patch, ...(patch.name !== undefined && { name: patch.name.trim() }) },
      }),
    )
  },

  async listRules(filter: { professionalId?: string; active?: boolean } = {}): Promise<ClinicScheduleRule[]> {
    return (await clinicApiFetch<ApiRule[]>(`/schedule-rules${query(filter)}`)).map(toRule)
  },
  async createRule(input: ClinicScheduleRuleInput): Promise<ScheduleRuleResult> {
    return toRuleResult(
      await clinicApiFetch<ApiRuleResult>('/schedule-rules', {
        method: 'POST',
        body: {
          ...input,
          validFrom: input.validFrom ?? null,
          validUntil: input.validUntil ?? null,
          capacity: input.capacity ?? 1,
        },
      }),
    )
  },
  async updateRule(id: string, patch: ClinicScheduleRulePatch): Promise<ScheduleRuleResult> {
    return toRuleResult(await clinicApiFetch<ApiRuleResult>(`/schedule-rules/${id}`, { method: 'PATCH', body: patch }))
  },
  async regenerateRule(id: string): Promise<ScheduleRuleResult> {
    return toRuleResult(await clinicApiFetch<ApiRuleResult>(`/schedule-rules/${id}/regenerate`, { method: 'POST' }))
  },

  async listTimeOff(filter: { professionalId?: string; from?: string; to?: string } = {}): Promise<ClinicTimeOff[]> {
    return (await clinicApiFetch<ApiTimeOff[]>(`/time-off${query(filter)}`)).map(toTimeOff)
  },
  async createTimeOff(input: ClinicTimeOffInput): Promise<TimeOffResult> {
    const result = await clinicApiFetch<ApiTimeOffResult>('/time-off', {
      method: 'POST',
      body: { ...input, reason: input.reason?.trim() || null },
    })
    return { timeOff: toTimeOff(result.timeOff), removedSlots: result.removedSlots, bookedSlots: result.bookedSlots }
  },
  deleteTimeOff(id: string): Promise<ScheduleGeneration> {
    return clinicApiFetch<ScheduleGeneration>(`/time-off/${id}`, { method: 'DELETE' })
  },
}

function mockAccountId(): string {
  const clinicAccountId = clinicSessionStore.getAccountId()
  if (!clinicAccountId) throw new AppError('INVALID_CREDENTIALS')
  return clinicAccountId
}

const mockImpl: typeof apiImpl = {
  listProfessionals: (filter) => mock.listClinicProfessionals(mockAccountId(), filter),
  createProfessional: (input) => mock.createClinicProfessional(mockAccountId(), input),
  updateProfessional: (id, patch) => mock.updateClinicProfessional(mockAccountId(), id, patch),

  listServices: (filter) => mock.listClinicServices(mockAccountId(), filter),
  createService: (input) => mock.createClinicService(mockAccountId(), input),
  updateService: (id, patch) => mock.updateClinicService(mockAccountId(), id, patch),

  listRules: (filter) => mock.listClinicScheduleRules(mockAccountId(), filter),
  createRule: (input) => mock.createClinicScheduleRule(mockAccountId(), input),
  updateRule: (id, patch) => mock.updateClinicScheduleRule(mockAccountId(), id, patch),
  regenerateRule: (id) => mock.regenerateClinicScheduleRule(mockAccountId(), id),

  listTimeOff: (filter) => mock.listClinicTimeOff(mockAccountId(), filter),
  createTimeOff: (input) => mock.createClinicTimeOff(mockAccountId(), input),
  deleteTimeOff: (id) => mock.deleteClinicTimeOff(mockAccountId(), id),
}

export const clinicCatalogService = hasApiBackend() ? apiImpl : mockImpl
