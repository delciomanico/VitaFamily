import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AlertCard } from './AlertCard'
import { toAlertItem, type ApiAlert } from '@/services/alert.service'

/** `Alert.type` do contrato (docs/05-api/openapi.yaml): todos têm de ter ícone, título e categoria. */
const CONTRACT_TYPES: ApiAlert['type'][] = [
  'MEDICATION_DUE',
  'APPOINTMENT_REMINDER',
  'EXAM_REMINDER',
  'APPOINTMENT_OUTCOME_REQUEST',
  'APPOINTMENT_CONFIRMED',
  'APPOINTMENT_REJECTED',
  'APPOINTMENT_CANCELLED',
  'EXAM_CANCELLED',
  'EXAM_RESULTS_AVAILABLE',
  'RECOMMENDATION_ADDED',
  'APPOINTMENT_CONFIRM_REQUEST',
  'FOLLOWUP_REMINDER',
  'EXAM_ORDER_ADDED',
]

describe('AlertCard com a API real', () => {
  it.each(CONTRACT_TYPES)('apresenta o alerta %s sem rebentar', (type) => {
    const alert = toAlertItem({
      id: 'a1',
      type,
      familyId: 'f1',
      memberId: 'm1',
      memberName: 'Maria',
      message: `Mensagem ${type}`,
      sourceType: 'EXAMINATION',
      sourceId: 's1',
      triggerAt: '2026-11-10T15:00:00.000Z',
    })
    render(<AlertCard alert={alert} />)
    expect(screen.getByText(`Mensagem ${type}`)).toBeInTheDocument()
  })
})
