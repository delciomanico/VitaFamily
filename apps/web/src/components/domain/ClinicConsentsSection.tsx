import { useEffect, useRef, useState } from 'react'
import { Building2, KeyRound, ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { EmptyState, ErrorState, FormError, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAsync } from '@/hooks/useAsync'
import { errorMessage, isAppError } from '@/lib/errors'
import { formatLongDate } from '@/lib/format'
import { clinicConsentService } from '@/services/clinicConsent.service'
import { clinicService } from '@/services/clinic.service'
import type { ConsentLevel } from '@/types/clinic'
import { formatLinkCode, type ClinicConsent, type ClinicLinkCode } from '@/types/clinicConsent'

interface ClinicConsentsSectionProps {
  familyId: string
  userId: string
  memberId: string
  memberName: string
}

const countdown = (ms: number) => {
  const total = Math.max(0, Math.ceil(ms / 1000))
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/** Código de uso único com contagem decrescente (BR-CLN-20): 8 caracteres, 10 minutos. */
function LinkCodeModal({ scope, onClose }: { scope: Omit<ClinicConsentsSectionProps, 'memberName'>; onClose: () => void }) {
  const [code, setCode] = useState<ClinicLinkCode | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  async function generate() {
    setBusy(true)
    setError(null)
    try {
      setCode(await clinicConsentService.createLinkCode(scope.familyId, scope.userId, scope.memberId))
      setNow(Date.now())
    } catch (err) {
      setError(isAppError(err, 'RATE_LIMITED') ? 'Gerou demasiados códigos. Tente de novo daqui a uma hora.' : errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  // Gera logo ao abrir (uma só vez, mesmo em StrictMode: o limite é 5 códigos/hora).
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    void generate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!code) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [code])

  const remaining = code ? Date.parse(code.expiresAt) - now : 0
  const expired = code !== null && remaining <= 0

  return (
    <Modal
      open
      onClose={onClose}
      title="Código para a clínica"
      description="Mostre este código à clínica, no balcão. Serve uma só vez."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Fechar
          </Button>
          <Button onClick={() => void generate()} loading={busy}>
            Gerar novo código
          </Button>
        </>
      }
    >
      <div className="flex flex-col items-center gap-3 py-2 text-center">
        {code && !expired && (
          <>
            <p className="font-mono text-4xl font-semibold tracking-widest" aria-label={`Código ${code.code.split('').join(' ')}`}>
              {formatLinkCode(code.code)}
            </p>
            <p className="text-sm text-muted" role="timer">
              Válido durante <span className="font-medium text-foreground tabular-nums">{countdown(remaining)}</span>
            </p>
          </>
        )}
        {expired && <p className="text-sm text-warning">O código expirou. Gere um novo.</p>}
        {!code && busy && <LoadingState rows={1} />}
        <p className="text-xs text-muted">
          A clínica fica ligada a este perfil com o acesso “Marcações”. Pode retirá-lo quando quiser.
        </p>
        <FormError message={error} />
      </div>
    </Modal>
  )
}

function levelBadge(consent: ClinicConsent) {
  if (consent.level === 'HISTORY') {
    return <Badge tone="success">Partilha o histórico{consent.validUntil ? ` até ${formatLongDate(consent.validUntil)}` : ''}</Badge>
  }
  if (consent.renewalNeeded) return <Badge tone="warning">Partilha do histórico expirou</Badge>
  return <Badge tone="primary">Marcações</Badge>
}

/**
 * “Clínicas e partilha” (UC-CLN-15/16, BR-CLN-19/20): quem vê o quê, por clínica parceira.
 * Dois níveis — Marcações (omissão) e Partilhar histórico (medicação e exames, 12 meses,
 * renovável) —, revogar, e gerar o código de ligação. Só o titular adulto ou o tutor.
 */
export function ClinicConsentsSection({ familyId, userId, memberId, memberName }: ClinicConsentsSectionProps) {
  const toast = useToast()
  const { state, reload } = useAsync(() => clinicConsentService.list(familyId, userId, memberId), [familyId, userId, memberId])
  const clinics = useAsync(() => clinicService.listClinics(familyId), [familyId])
  const [addClinicId, setAddClinicId] = useState('')
  const [pendingHistory, setPendingHistory] = useState<ClinicConsent | { clinicId: string; clinicName: string } | null>(null)
  const [revoking, setRevoking] = useState<ClinicConsent | null>(null)
  const [showCode, setShowCode] = useState(false)
  const [busy, setBusy] = useState(false)

  async function setLevel(clinicId: string, level: ConsentLevel, message: string) {
    setBusy(true)
    try {
      await clinicConsentService.put(familyId, userId, memberId, clinicId, level)
      toast.show(message)
      setPendingHistory(null)
      reload()
    } catch (err) {
      toast.show(errorMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function revoke() {
    if (!revoking) return
    setBusy(true)
    try {
      await clinicConsentService.revoke(familyId, userId, memberId, revoking.clinicId)
      toast.show('Acesso da clínica retirado.')
      setRevoking(null)
      reload()
    } catch (err) {
      toast.show(errorMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  const consents = state.status === 'success' ? state.data : []
  const available =
    clinics.state.status === 'success'
      ? clinics.state.data.filter((c) => c.type === 'PARTNER' && !consents.some((x) => x.clinicId === c.id))
      : []

  return (
    <section className="flex flex-col gap-4" aria-labelledby="clinic-consents-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="clinic-consents-title" className="text-lg font-semibold">
            Clínicas e partilha
          </h2>
          <p className="text-sm text-muted">Veja e controle o que cada clínica pode ver de {memberName}.</p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => setShowCode(true)} icon={<KeyRound className="size-4" aria-hidden />}>
          Gerar código para a clínica
        </Button>
      </div>

      {state.status === 'loading' && <LoadingState rows={2} />}
      {state.status === 'error' && <ErrorState onRetry={reload} />}
      {state.status === 'success' && consents.length === 0 && (
        <EmptyState
          icon={Building2}
          title="Nenhuma clínica ligada."
          description="Quando uma clínica parceira ligar este perfil, aparece aqui. Pode gerar um código para lhe mostrar no balcão."
          action={
            <Button size="sm" onClick={() => setShowCode(true)}>
              Gerar código para a clínica
            </Button>
          }
        />
      )}
      {state.status === 'success' &&
        consents.map((consent) => (
          <Card key={consent.clinicId} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 font-medium">
                <ShieldCheck className="size-4 shrink-0 text-muted" aria-hidden />
                {consent.clinicName}
              </p>
              {levelBadge(consent)}
            </div>
            <p className="text-sm text-muted">
              {consent.level === 'HISTORY'
                ? 'Vê a identificação, as marcações com a clínica, a medicação ativa e os exames, só para leitura.'
                : 'Vê a identificação e as marcações com a clínica. Não vê o histórico de saúde.'}
              {consent.linked ? '' : ' Ainda sem ligação à clínica.'}
            </p>
            <div className="flex flex-wrap gap-2">
              {consent.level === 'BOOKINGS' ? (
                <Button size="sm" onClick={() => setPendingHistory(consent)}>
                  {consent.renewalNeeded ? 'Renovar partilha do histórico' : 'Partilhar histórico'}
                </Button>
              ) : (
                <>
                  <Button size="sm" variant="secondary" loading={busy} onClick={() => void setLevel(consent.clinicId, 'HISTORY', 'Partilha renovada por 12 meses.')}>
                    Renovar 12 meses
                  </Button>
                  <Button size="sm" variant="secondary" loading={busy} onClick={() => void setLevel(consent.clinicId, 'BOOKINGS', 'A clínica deixou de ver o histórico.')}>
                    Só marcações
                  </Button>
                </>
              )}
              <Button size="sm" variant="danger-ghost" onClick={() => setRevoking(consent)}>
                Retirar acesso
              </Button>
            </div>
          </Card>
        ))}

      {state.status === 'success' && available.length > 0 && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1 sm:max-w-72">
            <Select
              label="Dar acesso a outra clínica"
              placeholder="Escolha a clínica"
              value={addClinicId}
              options={available.map((c) => ({ value: c.id, label: c.name }))}
              onChange={(event) => setAddClinicId(event.target.value)}
            />
          </div>
          <Button
            variant="secondary"
            disabled={!addClinicId}
            loading={busy}
            onClick={() => {
              void setLevel(addClinicId, 'BOOKINGS', 'Acesso concedido: marcações.').then(() => setAddClinicId(''))
            }}
          >
            Dar acesso (marcações)
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={pendingHistory !== null}
        title="Partilhar o histórico?"
        description={`${pendingHistory?.clinicName ?? 'A clínica'} passa a ver a medicação ativa e os exames de ${memberName}, só para leitura, durante 12 meses. Pode retirar a qualquer momento, mas o que a clínica já tiver copiado fica com ela.`}
        confirmLabel="Partilhar durante 12 meses"
        loading={busy}
        onConfirm={() => pendingHistory && void setLevel(pendingHistory.clinicId, 'HISTORY', 'Histórico partilhado por 12 meses.')}
        onCancel={() => setPendingHistory(null)}
      />
      <ConfirmDialog
        open={revoking !== null}
        title="Retirar o acesso da clínica?"
        description={`${revoking?.clinicName ?? 'A clínica'} deixa de ver os dados de ${memberName} e a ligação é desfeita. O que a clínica registou por conta própria fica com ela.`}
        confirmLabel="Retirar acesso"
        destructive
        loading={busy}
        onConfirm={() => void revoke()}
        onCancel={() => setRevoking(null)}
      />
      {showCode && <LinkCodeModal scope={{ familyId, userId, memberId }} onClose={() => setShowCode(false)} />}
    </section>
  )
}
