import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { FormError } from '@/components/ui/states'
import { FOLLOW_UP_PRESETS, followUpLabel } from '@/lib/clinicDay'
import { errorMessage } from '@/lib/errors'
import { formatDayMonth } from '@/lib/format'
import { clinicDayService } from '@/services/clinicDay.service'
import { FOLLOW_UP_MAX_AMOUNT, type ClinicBooking, type ClinicFollowUpInput } from '@/types/clinic'

interface FollowUpModalProps {
  booking: ClinicBooking
  onClose: () => void
  onSaved: (booking: ClinicBooking) => void
}

/**
 * "Voltar em N semanas/meses" (BR-CLN-30): regista o lembrete de retorno numa consulta ou visita
 * concluída. Um toque nos atalhos; ou um valor próprio. Não cria consulta nem reserva horário.
 */
export function FollowUpModal({ booking, onClose, onSaved }: FollowUpModalProps) {
  const [amount, setAmount] = useState('')
  const [unit, setUnit] = useState<ClinicFollowUpInput['unit']>('WEEKS')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function save(input: ClinicFollowUpInput) {
    setSaving(true)
    try {
      onSaved(await clinicDayService.setFollowUp(booking.id, input))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  function saveCustom() {
    const value = Number(amount)
    if (!Number.isInteger(value) || value < 1 || value > FOLLOW_UP_MAX_AMOUNT) {
      return setError(`Indique um número de 1 a ${FOLLOW_UP_MAX_AMOUNT}.`)
    }
    void save({ amount: value, unit })
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Voltar em…"
      description={`${booking.patientName}: o lembrete de retorno fica registado${
        booking.source === 'MANUAL' ? ' em "Retornos a contactar".' : ' e o paciente é avisado na app.'
      }`}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Fechar
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {booking.followUpDueOn && (
          <p className="rounded-xl bg-surface-muted px-3.5 py-3 text-sm">
            Retorno atual: {formatDayMonth(booking.followUpDueOn)}. Escolher outro substitui-o.
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          {FOLLOW_UP_PRESETS.map((preset) => (
            <Button key={preset.label} variant="soft" disabled={saving} onClick={() => void save(preset)}>
              {preset.label}
            </Button>
          ))}
        </div>
        <div className="grid grid-cols-[6rem_minmax(0,1fr)_auto] items-end gap-2">
          <Input
            label="Outro prazo"
            type="number"
            min={1}
            max={FOLLOW_UP_MAX_AMOUNT}
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value)
              setError(null)
            }}
          />
          <Select
            label="Unidade"
            value={unit}
            options={[
              { value: 'WEEKS', label: 'Semanas' },
              { value: 'MONTHS', label: 'Meses' },
            ]}
            onChange={(event) => setUnit(event.target.value as ClinicFollowUpInput['unit'])}
          />
          <Button loading={saving} onClick={saveCustom} className="h-12">
            Guardar
          </Button>
        </div>
        {amount && Number.isInteger(Number(amount)) && Number(amount) >= 1 && (
          <p className="-mt-2 text-xs text-muted">{followUpLabel({ amount: Number(amount), unit })}</p>
        )}
        <FormError message={error} />
      </div>
    </Modal>
  )
}
