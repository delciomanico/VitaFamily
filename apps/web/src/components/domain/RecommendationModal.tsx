import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Textarea } from '@/components/ui/Textarea'
import { FormError } from '@/components/ui/states'
import { useAsync } from '@/hooks/useAsync'
import { errorMessage } from '@/lib/errors'
import { formatWhen } from '@/lib/format'
import { clinicPortalService } from '@/services/clinicPortal.service'
import { RECOMMENDATION_MAX_LENGTH, type RecommendationOrigin } from '@/types/recommendation'

interface RecommendationModalProps {
  origin: RecommendationOrigin
  patientName: string
  onClose: () => void
  onSent: () => void
}

/**
 * Enviar uma recomendação ao paciente (BR-CLN-09): nota clínica ligada a esta consulta ou exame.
 * Não se edita nem apaga depois de enviada; a app não a interpreta nem gera alertas clínicos.
 */
export function RecommendationModal({ origin, patientName, onClose, onSent }: RecommendationModalProps) {
  const { state } = useAsync(() => clinicPortalService.listRecommendations(origin), [])
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function send() {
    const value = text.trim()
    if (!value) return setError('Escreva a recomendação.')
    if (value.length > RECOMMENDATION_MAX_LENGTH) return setError(`No máximo ${RECOMMENDATION_MAX_LENGTH} caracteres.`)
    setSaving(true)
    try {
      await clinicPortalService.createRecommendation(origin, value)
      onSent()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const previous = state.status === 'success' ? state.data : []

  return (
    <Modal
      open
      onClose={onClose}
      title="Enviar recomendação"
      description={`${patientName} recebe um aviso e lê a recomendação na app. Não pode ser editada depois de enviada.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button loading={saving} onClick={() => void send()}>
            Enviar
          </Button>
        </>
      }
    >
      <div className="flex max-h-[60dvh] flex-col gap-4 overflow-y-auto pr-1">
        {previous.length > 0 && (
          <ul className="flex flex-col gap-2" aria-label="Recomendações já enviadas">
            {previous.map((r) => (
              <li key={r.id} className="rounded-md bg-surface-muted p-3 text-sm">
                <p className="whitespace-pre-line">{r.text}</p>
                <p className="mt-1 text-xs text-muted">{formatWhen(r.createdAt)}</p>
              </li>
            ))}
          </ul>
        )}
        <Textarea
          label="Recomendação"
          rows={5}
          maxLength={RECOMMENDATION_MAX_LENGTH}
          hint={`${text.length}/${RECOMMENDATION_MAX_LENGTH}`}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setError(null)
          }}
        />
        <FormError message={error} />
      </div>
    </Modal>
  )
}
