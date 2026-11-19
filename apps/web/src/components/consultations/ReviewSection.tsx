import { useState, type FormEvent } from 'react'
import { Star } from 'lucide-react'
import { Stars } from '@/components/consultations/Stars'
import { Button } from '@/components/ui/Button'
import { Card, Section } from '@/components/ui/Card'
import { FormError, LoadingState } from '@/components/ui/states'
import { Textarea } from '@/components/ui/Textarea'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { cn } from '@/lib/cn'
import { REVIEW_COMMENT_MAX, REVIEW_LEGAL_NOTICE, REVIEW_NOTICE, plainText } from '@/lib/consultations'
import { errorMessage } from '@/lib/errors'
import { formatWhenLuanda } from '@/lib/format'
import { consultationService } from '@/services/consultation.service'
import type { FamilyBooking, FamilyReview } from '@/types/consultations'

/**
 * Avaliar o profissional (UC-MKT-39, BR-MKT-59): só quem consultou, nota 1–5 e comentário curto; anónima e pública.
 * Pode editar-se durante 7 dias. Mostra a avaliação própria quando já existe.
 */
export function ReviewSection({ booking, onChanged }: { booking: FamilyBooking; onChanged: () => void }) {
  const { user, family } = useAuth()
  const familyId = family?.id ?? ''
  const userId = user?.id ?? ''
  const existing = useAsync(
    () => (booking.hasReview ? consultationService.getReview(familyId, userId, booking.memberId, booking.id) : Promise.resolve<FamilyReview | null>(null)),
    [familyId, userId, booking.id, booking.memberId, booking.hasReview],
  )
  const [editing, setEditing] = useState(false)

  if (!booking.canReview && !booking.hasReview) return null
  if (existing.state.status === 'loading') return <LoadingState rows={1} />
  const review = existing.state.status === 'success' ? existing.state.data : null
  const editable = review !== null && Date.parse(review.editableUntil) > Date.now()

  return (
    <Section title="A sua avaliação">
      {review && !editing ? (
        <Card className="flex flex-col gap-2">
          <Stars rating={review.rating} />
          {review.commentHidden ? <p className="text-sm italic text-muted">O comentário foi ocultado pela moderação.</p> : review.comment && <p className="text-sm whitespace-pre-line">{review.comment}</p>}
          {review.reply && (
            <div className="rounded-md bg-surface-muted px-3 py-2 text-sm">
              <p className="font-medium">Resposta do profissional</p>
              <p className="whitespace-pre-line">{review.reply.text}</p>
            </div>
          )}
          <p className="text-xs text-muted">
            {editable ? `Pode alterar até ${formatWhenLuanda(review.editableUntil)}.` : 'Já não pode alterar esta avaliação.'} {REVIEW_NOTICE}
          </p>
          {editable && (
            <Button variant="secondary" size="sm" className="w-fit" onClick={() => setEditing(true)}>
              Alterar avaliação
            </Button>
          )}
        </Card>
      ) : (
        <ReviewForm
          booking={booking}
          initial={review ?? undefined}
          onSaved={() => {
            setEditing(false)
            existing.reload()
            onChanged()
          }}
          onCancel={review ? () => setEditing(false) : undefined}
        />
      )}
    </Section>
  )
}

function ReviewForm({ booking, initial, onSaved, onCancel }: { booking: FamilyBooking; initial?: FamilyReview; onSaved: () => void; onCancel?: () => void }) {
  const { user, family } = useAuth()
  const toast = useToast()
  const [rating, setRating] = useState(initial?.rating ?? 0)
  const [comment, setComment] = useState(initial?.comment ?? '')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const text = comment.trim() === '' ? undefined : plainText(comment, REVIEW_COMMENT_MAX)
    if (rating < 1) return setError('Escolha uma nota de 1 a 5.')
    if (text === null) return setError(`Escreva até ${REVIEW_COMMENT_MAX} caracteres, sem símbolos especiais.`)
    setSending(true)
    setError(null)
    try {
      await consultationService.putReview(family?.id ?? '', user?.id ?? '', booking.memberId, booking.id, { rating, comment: text })
      toast.show('Obrigado pela sua avaliação.')
      onSaved()
    } catch (e) {
      setError(errorMessage(e))
      setSending(false)
    }
  }

  return (
    <Card>
      <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-3">
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">Nota</legend>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                aria-label={n === 1 ? '1 estrela' : `${n} estrelas`}
                aria-pressed={rating === n}
                onClick={() => setRating(n)}
                className="rounded-md p-1 text-warning hover:bg-surface-muted"
              >
                <Star className={cn('size-7', n <= rating && 'fill-current')} aria-hidden />
              </button>
            ))}
          </div>
        </fieldset>
        <Textarea label="Comentário (opcional)" value={comment} onChange={(event) => setComment(event.target.value)} maxLength={REVIEW_COMMENT_MAX} hint={`${comment.length}/${REVIEW_COMMENT_MAX} caracteres. ${REVIEW_NOTICE}`} />
        <p className="text-xs text-muted">{REVIEW_LEGAL_NOTICE}</p>
        <FormError message={error} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={sending}>
            {initial ? 'Guardar alterações' : 'Publicar avaliação'}
          </Button>
          {onCancel && (
            <Button variant="secondary" onClick={onCancel}>
              Cancelar
            </Button>
          )}
        </div>
      </form>
    </Card>
  )
}
