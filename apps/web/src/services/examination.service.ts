import * as api from '@/mocks/handlers/examinations'
import { apiFetch, hasApiBackend } from '@/lib/apiClient'
import { todayISO } from '@/lib/date'
import type {
  ExamResult,
  Examination,
  ExaminationDetail,
  ExaminationStatus,
  ExaminationSummary,
  ParameterHistory,
} from '@/types/examination'
import { collectPerMember, findPerMember } from './apiMembers'
import { clinicService } from './clinic.service'

export type { ExamResultInput, NewExaminationInput } from '@/mocks/handlers/examinations'

interface ApiResult {
  id: string
  parameter: string
  valueNumeric?: number | null
  valueText?: string | null
  unit?: string | null
  referenceMin?: number | null
  referenceMax?: number | null
}

/** `Examination` (openapi.yaml): resultados embutidos, sem `familyId`. */
export interface ApiExamination {
  id: string
  memberId: string
  name: string
  examDate: string
  status: ExaminationStatus
  clinicId?: string | null
  clinicName?: string | null
  notes?: string | null
  results: ApiResult[]
}

const examPath = (familyId: string, memberId: string) => `/families/${familyId}/members/${memberId}/examinations`

export function toExamination(familyId: string, e: ApiExamination): Examination {
  return {
    id: e.id,
    familyId,
    memberId: e.memberId,
    name: e.name,
    examDate: e.examDate,
    status: e.status,
    clinicId: e.clinicId ?? undefined,
    clinicName: e.clinicName ?? undefined,
    notes: e.notes ?? undefined,
  }
}

/** O contrato não tem data de registo do resultado; usa-se a do exame. */
function toResult(examination: ApiExamination, r: ApiResult): ExamResult {
  return {
    id: r.id,
    examinationId: examination.id,
    parameter: r.parameter,
    valueNumeric: r.valueNumeric ?? undefined,
    valueText: r.valueText ?? undefined,
    unit: r.unit ?? undefined,
    referenceMin: r.referenceMin ?? undefined,
    referenceMax: r.referenceMax ?? undefined,
    createdAt: examination.examDate,
  }
}

async function apiListExaminations(familyId: string): Promise<ExaminationSummary[]> {
  const entries = await collectPerMember<ApiExamination>(familyId, (m) => `${examPath(familyId, m)}?limit=100`)
  return entries
    .map(({ member, item }) => ({
      examination: toExamination(familyId, item),
      memberName: member.name,
      resultCount: item.results.length,
    }))
    .sort((a, b) => b.examination.examDate.localeCompare(a.examination.examDate))
}

async function apiGetExamination(familyId: string, id: string): Promise<ExaminationDetail> {
  const { member, item } = await findPerMember<ApiExamination>(familyId, (m) => `${examPath(familyId, m)}/${id}`)
  // TBD: documentos (upload multipart/download mediado, M5) ainda não ligados na UI.
  return {
    examination: toExamination(familyId, item),
    memberName: member.name,
    results: item.results.map((r) => toResult(item, r)),
    documents: [],
  }
}

async function apiCreateExamination(familyId: string, input: api.NewExaminationInput): Promise<Examination> {
  const base = examPath(familyId, input.memberId)
  const clinicName = input.clinicName?.trim()
  const clinic = clinicName
    ? (await clinicService.listClinics(familyId)).find(
        (c) => c.name.toLocaleLowerCase('pt-PT') === clinicName.toLocaleLowerCase('pt-PT'),
      )
    : undefined
  const created = await apiFetch<ApiExamination>(base, {
    method: 'POST',
    body: {
      name: input.name.trim(),
      examDate: input.examDate,
      clinicId: clinic?.id ?? null,
      clinicName: clinic?.name ?? clinicName ?? null,
      notes: input.notes?.trim() || null,
    },
  })
  // Só exames realizados aceitam resultados (ST5); o servidor decide o estado a partir da data.
  if (input.examDate <= todayISO()) {
    for (const r of input.results) {
      await apiFetch<ApiResult>(`${base}/${created.id}/results`, {
        method: 'POST',
        body: {
          parameter: r.parameter.trim(),
          valueNumeric: r.valueNumeric ?? null,
          valueText: r.valueText?.trim() || null,
          unit: r.unit?.trim() || null,
          referenceMin: r.referenceMin ?? null,
          referenceMax: r.referenceMax ?? null,
        },
      })
    }
  }
  return toExamination(familyId, created)
}

async function apiSetStatus(familyId: string, id: string, status: 'COMPLETED' | 'CANCELLED'): Promise<Examination> {
  const { member } = await findPerMember<ApiExamination>(familyId, (m) => `${examPath(familyId, m)}/${id}`)
  const updated = await apiFetch<ApiExamination>(`${examPath(familyId, member.id)}/${id}/status`, {
    method: 'PUT',
    body: { status },
  })
  return toExamination(familyId, updated)
}

interface ApiHistoryItem {
  examinationId: string
  examDate: string
  valueNumeric?: number | null
  valueText?: string | null
  unit?: string | null
  referenceMin?: number | null
  referenceMax?: number | null
}

/** Histórico de cada parâmetro do exame (`GET …/exam-results?parameter=`), do mais antigo ao mais recente. */
async function apiGetParameterHistory(familyId: string, id: string): Promise<ParameterHistory[]> {
  const { member, item } = await findPerMember<ApiExamination>(familyId, (m) => `${examPath(familyId, m)}/${id}`)
  return Promise.all(
    item.results.map(async (current): Promise<ParameterHistory> => {
      const history = await apiFetch<ApiHistoryItem[]>(
        `/families/${familyId}/members/${member.id}/exam-results?parameter=${encodeURIComponent(current.parameter)}`,
      )
      return {
        parameter: current.parameter,
        unit: current.unit ?? undefined,
        points: history
          .map((h) => ({
            examinationId: h.examinationId,
            examDate: h.examDate,
            result: toResult(
              { ...item, id: h.examinationId, examDate: h.examDate },
              { id: `${h.examinationId}:${current.parameter}`, parameter: current.parameter, ...h },
            ),
          }))
          .sort((a, b) => a.examDate.localeCompare(b.examDate)),
      }
    }),
  )
}

/** Exames e resultados. Com `VITE_API_URL` usa `/families/{id}/members/{id}/examinations`. */
export const examinationService = hasApiBackend()
  ? {
      listExaminations: (familyId: string, _userId: string) => apiListExaminations(familyId),
      getExamination: (familyId: string, _userId: string, id: string) => apiGetExamination(familyId, id),
      createExamination: (familyId: string, _userId: string, input: api.NewExaminationInput) =>
        apiCreateExamination(familyId, input),
      setExaminationStatus: (familyId: string, _userId: string, id: string, status: 'COMPLETED' | 'CANCELLED') =>
        apiSetStatus(familyId, id, status),
      getParameterHistory: (familyId: string, _userId: string, id: string) => apiGetParameterHistory(familyId, id),
    }
  : {
      listExaminations: api.listExaminations,
      getExamination: api.getExamination,
      createExamination: api.createExamination,
      setExaminationStatus: api.setExaminationStatus,
      getParameterHistory: api.getParameterHistory,
    }
