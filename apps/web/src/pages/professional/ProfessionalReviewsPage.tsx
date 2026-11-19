import { useState, type FormEvent } from 'react'
import { Flag, Star } from 'lucide-react'
import { ReviewCard } from '@/components/consultations/ReviewCard'
import { LockedNotice } from '@/components/professional/LockedNotice'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { Tabs, type TabItem } from '@/components/ui/Tabs'
import { Textarea } from '@/components/ui/Textarea'
import { EmptyState, ErrorState, FormError, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useCursorPages } from '@/hooks/useCursorPages'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useProfessionalProfile } from '@/hooks/useProfessionalProfile'
import { NOTE_MAX, REPLY_MAX, REVIEW_REPORT_REASONS, plainText, reviewReportReasonLabel } from '@/lib/consultations'
import { errorMessage, isAppError } from '@/lib/errors'
import { professionalBookingService } from '@/services/professionalBooking.service'
import type { ProfessionalReview, ReviewReportReason } from '@/types/consultations'

type Filter = 'ALL' | 'UNANSWERED'
const filterItems: TabItem<Filter>[] = [
  { value: 'ALL', label: 'Todas' },
  { value: 'UNANSWERED', label: 'Sem resposta' },
]

/** Avaliações recebidas (UC-MKT-41/42): anónimas; responde uma vez e pode denunciar (a avaliação continua visível até decisão). */
export function ProfessionalReviewsPage() {
  usePageTitle('Avaliações')
  const profile = useProfessionalProfile()
  const [filter, setFilter] = useState<Filter>('ALL')
  const list = useCursorPages((cursor) => professionalBookingService.reviews({ unanswered: filter === 'UNANSWERED', cursor }), [filter])
  const [replying, setReplying] = useState<ProfessionalReview | null>(null)
  const [reporting, setReporting] = useState<ProfessionalReview | null>(null)
  const approved = profile.profile?.validationStatus === 'APPROVED'

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Avaliações</h1>
      <p className="text-sm text-muted">São anónimas e só de quem consultou consigo. Pode responder a cada uma uma só vez.</p>
      {profile.profile && !approved && <LockedNotice>A sua conta não está aprovada: as avaliações estão só de leitura.</LockedNotice>}
      <Tabs items={filterItems} value={filter} onChange={setFilter} label="Filtro das avaliações" />

      {list.state.status === 'loading' && <LoadingState rows={3} />}
      {list.state.status === 'error' && <ErrorState message={errorMessage(list.state.error)} onRetry={list.reload} />}
      {list.state.status === 'success' &&
        (list.items.length === 0 ? (
          <EmptyState icon={Star} title={filter === 'UNANSWERED' ? 'Todas as avaliações têm resposta.' : 'Ainda sem avaliações.'} />
        ) : (
          <>
            <Card className="py-1">
              <ul className="divide-y divide-border">
                {list.items.map((review) => (
                  <ReviewCard key={review.id} review={review}>
                    <div className="flex flex-wrap items-center gap-2">
                      {!review.reply && <Badge tone="warning">Sem resposta</Badge>}
                      {review.reported && <Badge>Denunciada</Badge>}
                      {approved && !review.reply && (
                        <Button size="sm" variant="secondary" onClick={() => setReplying(review)}>
                          Responder
                        </Button>
                      )}
                      {approved && !review.reported && (
                        <Button size="sm" variant="soft" icon={<Flag className="size-4" aria-hidden />} onClick={() => setReporting(review)}>
                          Denunciar
                        </Button>
                      )}
                    </div>
                  </ReviewCard>
                ))}
              </ul>
            </Card>
            {list.nextCursor && (
              <Button variant="secondary" onClick={() => void list.loadMore()} loading={list.loadingMore}>
                Carregar mais
              </Button>
            )}
          </>
        ))}

      {replying && <ReplyModal review={replying} onClose={() => setReplying(null)} onDone={() => { setReplying(null); list.reload() }} />}
      {reporting && <ReportModal review={reporting} onClose={() => setReporting(null)} onDone={() => { setReporting(null); list.reload() }} />}
    </div>
  )
}

function ReplyModal({ review, onClose, onDone }: { review: ProfessionalReview; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const value = plainText(text, REPLY_MAX, { required: true })
    if (value === null) return setError('Escreva a resposta (até 500 caracteres).')
    setSending(true)
    try {
      await professionalBookingService.reply(review.id, value)
      toast.show('Resposta publicada.')
      onDone()
    } catch (e) {
      setError(isAppError(e, 'CONFLICT') ? 'Esta avaliação já tem resposta.' : errorMessage(e))
      setSending(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Responder à avaliação" description="A resposta fica pública junto da avaliação e não se pode alterar.">
      <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-4">
        <Textarea label="Resposta" value={text} onChange={(event) => setText(event.target.value)} maxLength={REPLY_MAX} hint={`${text.length}/${REPLY_MAX} caracteres`} />
        <FormError message={error} />
        <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={sending}>
            Publicar resposta
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function ReportModal({ review, onClose, onDone }: { review: ProfessionalReview; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [reason, setReason] = useState<ReviewReportReason>('ABUSE')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const value = note.trim() === '' ? undefined : plainText(note, NOTE_MAX)
    if (value === null) return setError(`Escreva até ${NOTE_MAX} caracteres.`)
    setSending(true)
    try {
      await professionalBookingService.reportReview(review.id, { reason, note: value })
      toast.show('Denúncia enviada. A avaliação continua visível até haver decisão.')
      onDone()
    } catch (e) {
      setError(errorMessage(e))
      setSending(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Denunciar a avaliação" description="A equipa da Vita Family analisa. A avaliação continua visível até haver decisão.">
      <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-4">
        <Select label="Motivo" options={REVIEW_REPORT_REASONS.map((value) => ({ value, label: reviewReportReasonLabel[value] }))} value={reason} onChange={(event) => setReason(event.target.value as ReviewReportReason)} />
        <Textarea label="Nota (opcional)" value={note} onChange={(event) => setNote(event.target.value)} maxLength={NOTE_MAX} hint={`${note.length}/${NOTE_MAX} caracteres`} />
        <FormError message={error} />
        <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={sending}>
            Enviar denúncia
          </Button>
        </div>
      </form>
    </Modal>
  )
}
