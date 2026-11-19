import { useRef, useState, type FormEvent } from 'react'
import { Download } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, Section } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Textarea } from '@/components/ui/Textarea'
import { ErrorState, FormError, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { NOTE_MAX, PAYMENT_OUTSIDE_APP_NOTICE, PROOF_NOTICE, paymentStatusText, plainText, proofFileError, proofStatusText, proofTypeLabel } from '@/lib/consultations'
import { saveBlob } from '@/lib/download'
import { ATTACHMENT_FILE_HELP, attachmentErrorMessage, errorMessage } from '@/lib/errors'
import { formatWhenLuanda } from '@/lib/format'
import { formatFileSize, formatKz } from '@/lib/professional'
import { consultationService } from '@/services/consultation.service'
import type { FamilyBooking, PaymentProof } from '@/types/consultations'

/**
 * Pagamento fora da aplicação (UC-MKT-35/37, BR-MKT-56/57/58): instruções do profissional, envio do comprovativo
 * e disputa de uma recusa. O estado é declarativo: a Vita Family não recebe nem confirma dinheiro.
 */
export function PaymentSection({ booking, onChanged }: { booking: FamilyBooking; onChanged: () => void }) {
  const { user, family } = useAuth()
  const toast = useToast()
  const familyId = family?.id ?? ''
  const userId = user?.id ?? ''
  const paid = booking.status === 'CONFIRMED' || booking.status === 'COMPLETED'
  const proofs = useAsync(() => (booking.priceKz > 0 && paid ? consultationService.proofs(familyId, userId, booking.memberId, booking.id) : Promise.resolve<PaymentProof[]>([])), [familyId, userId, booking.id, booking.memberId, booking.updatedAt, paid])
  const fileInput = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [disputing, setDisputing] = useState<PaymentProof | null>(null)

  if (['CANCELLED', 'REJECTED', 'NO_SHOW'].includes(booking.status)) return null
  const payment = paymentStatusText[booking.paymentStatus]

  async function upload(event: FormEvent) {
    event.preventDefault()
    if (!file) {
      setFileError('Escolha o ficheiro do comprovativo.')
      return
    }
    if (proofFileError(file)) {
      setFileError(ATTACHMENT_FILE_HELP)
      return
    }
    setSending(true)
    setFileError(null)
    try {
      await consultationService.uploadProof(familyId, userId, booking.memberId, booking.id, file)
      toast.show('Comprovativo enviado.')
      setFile(null)
      if (fileInput.current) fileInput.current.value = ''
      onChanged()
    } catch (error) {
      setFileError(attachmentErrorMessage(error))
    } finally {
      setSending(false)
    }
  }

  async function download(proof: PaymentProof) {
    try {
      saveBlob(await consultationService.downloadProof(familyId, userId, booking.memberId, booking.id, proof.id), `comprovativo.${proofTypeLabel[proof.contentType].toLowerCase()}`)
    } catch (error) {
      toast.show(errorMessage(error), 'error')
    }
  }

  return (
    <Section title="Pagamento">
      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold">{formatKz(booking.priceKz)}</span>
          <Badge tone={payment.tone}>{payment.label}</Badge>
        </div>

        {booking.priceKz === 0 && <p className="text-sm text-muted">Esta consulta não tem custo.</p>}

        {booking.priceKz > 0 && booking.status === 'REQUESTED' && (
          <p className="text-sm text-muted">As instruções de pagamento aparecem quando o profissional confirmar a marcação.</p>
        )}

        {booking.priceKz > 0 && paid && (
          <>
            {booking.paymentInstructions && (
              <div className="rounded-md bg-surface-muted px-3 py-2 text-sm">
                <p className="font-medium">Como pagar</p>
                <p className="whitespace-pre-line">{booking.paymentInstructions}</p>
              </div>
            )}
            <p className="text-xs text-muted">{PAYMENT_OUTSIDE_APP_NOTICE}</p>
          </>
        )}

        {booking.paymentStatus === 'DISPUTED' && <p className="text-sm">A Vita Family está a analisar o seu pedido. Avisamos quando houver decisão.</p>}

        {booking.canSendProof && (
          <form onSubmit={(event) => void upload(event)} noValidate className="flex flex-col gap-3">
            <Input
              ref={fileInput}
              label="Comprovativo de pagamento"
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              className="h-auto py-2"
              hint={ATTACHMENT_FILE_HELP}
              error={fileError ?? undefined}
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null)
                setFileError(null)
              }}
            />
            <p className="text-xs text-muted">{PROOF_NOTICE}</p>
            <Button type="submit" className="w-fit" loading={sending}>
              Enviar comprovativo
            </Button>
          </form>
        )}
      </Card>

      {proofs.state.status === 'loading' && paid && booking.priceKz > 0 && <LoadingState rows={1} />}
      {proofs.state.status === 'error' && <ErrorState message={errorMessage(proofs.state.error)} onRetry={proofs.reload} />}
      {proofs.state.status === 'success' && proofs.state.data.length > 0 && (
        <Card className="py-1">
          <ul className="divide-y divide-border">
            {proofs.state.data.map((proof) => {
              const status = proofStatusText[proof.status]
              return (
                <li key={proof.id} className="flex flex-col gap-2 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm">
                      {proofTypeLabel[proof.contentType]} · {formatFileSize(proof.sizeBytes)} · {formatWhenLuanda(proof.createdAt)}
                    </span>
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </div>
                  {proof.scanStatus === 'PENDING' && <p className="text-sm text-muted">A verificar o ficheiro…</p>}
                  {proof.decisionReason && proof.status !== 'CONFIRMED' && <p className="text-sm">Motivo do profissional: {proof.decisionReason}</p>}
                  <div className="flex flex-wrap gap-2">
                    {proof.scanStatus === 'CLEAN' && !proof.purged && (
                      <Button variant="secondary" size="sm" icon={<Download className="size-4" aria-hidden />} onClick={() => void download(proof)}>
                        Descarregar
                      </Button>
                    )}
                    {proof.status === 'REJECTED' && (
                      <Button variant="soft" size="sm" onClick={() => setDisputing(proof)}>
                        Pedir análise à Vita Family
                      </Button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </Card>
      )}

      {disputing && (
        <DisputeModal
          booking={booking}
          proof={disputing}
          onClose={() => setDisputing(null)}
          onDone={() => {
            setDisputing(null)
            toast.show('Pedido enviado. A Vita Family vai analisar.')
            onChanged()
          }}
        />
      )}
    </Section>
  )
}

function DisputeModal({ booking, proof, onClose, onDone }: { booking: FamilyBooking; proof: PaymentProof; onClose: () => void; onDone: () => void }) {
  const { user, family } = useAuth()
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const text = note.trim() === '' ? undefined : plainText(note, NOTE_MAX)
    if (text === null) {
      setError(`Escreva até ${NOTE_MAX} caracteres, sem símbolos especiais.`)
      return
    }
    setSending(true)
    try {
      await consultationService.disputeProof(family?.id ?? '', user?.id ?? '', booking.memberId, booking.id, proof.id, text)
      onDone()
    } catch (e) {
      setError(errorMessage(e))
      setSending(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Pedir análise à Vita Family" description="A Vita Family vê só o comprovativo e esta marcação. Não escreva dados de saúde.">
      <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-4">
        <Textarea label="Nota (opcional)" value={note} onChange={(event) => setNote(event.target.value)} maxLength={NOTE_MAX} hint={`${note.length}/${NOTE_MAX} caracteres`} />
        <FormError message={error} />
        <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={sending}>
            Enviar pedido
          </Button>
        </div>
      </form>
    </Modal>
  )
}
