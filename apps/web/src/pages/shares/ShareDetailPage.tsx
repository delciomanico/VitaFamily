import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { CircleSlash } from 'lucide-react'
import { Page } from '@/components/layout/Page'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { useCursorPages } from '@/hooks/useCursorPages'
import { usePageTitle } from '@/hooks/usePageTitle'
import { isStateChange } from '@/lib/consultations'
import { errorMessage, isAppError } from '@/lib/errors'
import { formatWhenLuanda } from '@/lib/format'
import { SCREENSHOT_NOTICE, WHO_VIEWED_NOTICE, categoriesText, familyShareStatusText, validityLabel } from '@/lib/recordSharing'
import { paths } from '@/routes/paths'
import { recordShareService } from '@/services/recordShare.service'
import type { RecordShare } from '@/types/recordSharing'

/** Uma partilha: prazo, estado, «Quem viu» (registo de acessos) e parar a partilha (UC-MKT-50..52). */
export function ShareDetailPage() {
  usePageTitle('Partilha')
  const { user, family } = useAuth()
  const { memberId = '', shareId = '' } = useParams()
  const familyId = family?.id ?? ''
  const userId = user?.id ?? ''
  const share = useAsync(() => recordShareService.get(familyId, userId, memberId, shareId), [familyId, userId, memberId, shareId])

  return (
    <Page title="Partilha" backTo={paths.shares} backLabel="Partilhas">
      {share.state.status === 'loading' && <LoadingState rows={3} />}
      {share.state.status === 'error' &&
        (isAppError(share.state.error, 'NOT_FOUND') ? (
          <EmptyState icon={CircleSlash} title="Esta partilha já não está disponível." />
        ) : (
          <ErrorState message={errorMessage(share.state.error)} onRetry={share.reload} />
        ))}
      {share.state.status === 'success' && <Detail share={share.state.data} memberId={memberId} onChanged={share.reload} />}
    </Page>
  )
}

function Detail({ share, memberId, onChanged }: { share: RecordShare; memberId: string; onChanged: () => void }) {
  const { user, family } = useAuth()
  const toast = useToast()
  const [confirming, setConfirming] = useState(false)
  const [stopping, setStopping] = useState(false)
  const status = familyShareStatusText[share.status]
  const views = useCursorPages((cursor) => recordShareService.views(family?.id ?? '', user?.id ?? '', memberId, share.id, cursor), [family?.id, user?.id, memberId, share.id, share.viewCount, share.status])

  async function stop() {
    setStopping(true)
    try {
      await recordShareService.revoke(family?.id ?? '', user?.id ?? '', memberId, share.id)
      toast.show('Partilha parada.')
    } catch (error) {
      toast.show(isStateChange(error) ? 'Esta partilha já tinha terminado. Atualizámos a página.' : errorMessage(error), 'error')
    } finally {
      setStopping(false)
      setConfirming(false)
      onChanged()
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-col">
            <h2 className="text-lg font-semibold">{share.professional.displayName}</h2>
            <p className="text-sm text-muted">{categoriesText(share.categories)}</p>
          </div>
          <Badge tone={status.tone} dot>
            {status.label}
          </Badge>
        </div>
        <p className="text-sm">
          <span className="text-muted">{share.status === 'ACTIVE' ? 'Termina: ' : 'Prazo: '}</span>
          {formatWhenLuanda(share.expiresAt)}
          <span className="text-muted"> ({validityLabel[share.validity].toLowerCase()})</span>
        </p>
        {share.viewOnce && <p className="text-sm text-muted">Só pode ser aberta uma vez.</p>}
        {share.revokedAt && <p className="text-sm text-muted">Parou esta partilha {formatWhenLuanda(share.revokedAt)}.</p>}
        {share.status === 'CONSUMED' && share.consumedAt && <p className="text-sm text-muted">Foi aberta {formatWhenLuanda(share.consumedAt)} e já não pode ser aberta outra vez.</p>}
        {share.status === 'ACTIVE' && (
          <Button variant="danger" className="w-fit" onClick={() => setConfirming(true)}>
            Parar a partilha
          </Button>
        )}
      </Card>

      <section aria-labelledby="quem-viu" className="flex flex-col gap-3">
        <h2 id="quem-viu" className="text-lg font-semibold">
          Quem viu
        </h2>
        <p className="text-xs text-muted">{WHO_VIEWED_NOTICE}</p>
        <p role="note" className="rounded-md bg-warning-soft px-3.5 py-3 text-sm">
          {SCREENSHOT_NOTICE}
        </p>
        {views.state.status === 'loading' && <LoadingState rows={2} />}
        {views.state.status === 'error' && <ErrorState message={errorMessage(views.state.error)} onRetry={views.reload} />}
        {views.state.status === 'success' &&
          (views.items.length === 0 ? (
            <p className="text-sm text-muted">Ainda ninguém abriu esta partilha.</p>
          ) : (
            <Card>
              <ul className="flex flex-col divide-y divide-border">
                {views.items.map((view) => (
                  <li key={view.viewNo} className="flex flex-col gap-0.5 py-3">
                    <p className="font-medium">{view.professionalName}</p>
                    <p className="text-sm text-muted">Viu: {categoriesText(view.categories)}</p>
                    <time className="text-sm" dateTime={view.viewedAt}>
                      {formatWhenLuanda(view.viewedAt)}
                    </time>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        {views.nextCursor && (
          <Button variant="secondary" onClick={() => void views.loadMore()} loading={views.loadingMore}>
            Carregar mais
          </Button>
        )}
      </section>

      <ConfirmDialog
        open={confirming}
        title="Parar esta partilha?"
        description="O profissional deixa de poder abrir o seu registo de imediato. O que já foi visto fica na lista de «Quem viu»."
        confirmLabel="Parar a partilha"
        destructive
        loading={stopping}
        onConfirm={() => void stop()}
        onCancel={() => setConfirming(false)}
      />
    </div>
  )
}
