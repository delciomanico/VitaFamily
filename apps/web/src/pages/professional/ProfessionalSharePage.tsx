import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { CircleSlash } from 'lucide-react'
import { ScreenHeader } from '@/components/app/ScreenHeader'
import { ConfirmSheet } from '@/components/app/Sheet'
import { SharedRecordsViewer } from '@/components/shares/SharedRecordsViewer'
import { LockedNotice } from '@/components/professional/LockedNotice'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAsync } from '@/hooks/useAsync'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useProfessionalProfile } from '@/hooks/useProfessionalProfile'
import { errorMessage, isAppError } from '@/lib/errors'
import { formatWhenLuanda } from '@/lib/format'
import { PROFESSIONAL_OPEN_NOTICE, categoriesText, professionalShareStatusText } from '@/lib/recordSharing'
import { paths } from '@/routes/paths'
import { professionalShareService } from '@/services/professionalShare.service'
import type { ProfessionalShare, SharedRecordsView } from '@/types/recordSharing'

/**
 * Uma partilha recebida: metadados e **Abrir** (UC-MKT-54/55). O conteúdo aberto vive só neste estado do ecrã:
 * não se guarda em lado nenhum e perde-se ao sair. As causas de recusa não se distinguem (BR-MKT-70).
 */
export function ProfessionalSharePage() {
  const { shareId = '' } = useParams()
  usePageTitle('Partilha')
  const profile = useProfessionalProfile()
  const { state, reload } = useAsync(() => professionalShareService.get(shareId), [shareId])
  const [last, setLast] = useState<{ id: string; share: ProfessionalShare } | null>(null)
  if (state.status === 'success' && last?.share !== state.data) setLast({ id: shareId, share: state.data })
  const shown = state.status === 'success' ? state.data : last?.id === shareId ? last.share : null
  const approved = profile.profile?.validationStatus === 'APPROVED'
  const back = <ScreenHeader title="Partilha" backTo={paths.professionalShares} backLabel="Partilhas" />

  if (!shown && state.status === 'loading')
    return (
      <div className="flex flex-col gap-5">
        {back}
        <LoadingState rows={3} />
      </div>
    )
  if (state.status === 'error')
    return (
      <div className="flex flex-col gap-5">
        {back}
        {isAppError(state.error, 'NOT_FOUND') ? <EmptyState icon={CircleSlash} title="Partilha não encontrada." /> : <ErrorState message={errorMessage(state.error)} onRetry={reload} />}
      </div>
    )
  return (
    <div className="flex flex-col gap-5">
      {back}
      {profile.profile && !approved && <LockedNotice>A sua conta não está aprovada: só pode ver os dados da partilha, não abri-la.</LockedNotice>}
      {shown && <Detail share={shown} onChanged={reload} />}
    </div>
  )
}

function Detail({ share, onChanged }: { share: ProfessionalShare; onChanged: () => void }) {
  const toast = useToast()
  const [confirming, setConfirming] = useState(false)
  const [opening, setOpening] = useState(false)
  const [content, setContent] = useState<SharedRecordsView | null>(null)
  const [refused, setRefused] = useState<string | null>(null)
  const status = professionalShareStatusText(share.status, share.canOpen)

  async function open() {
    setOpening(true)
    setRefused(null)
    try {
      setContent(await professionalShareService.open(share.id))
    } catch (error) {
      if (isAppError(error, 'SHARE_NOT_AVAILABLE') || isAppError(error, 'SHARE_ALREADY_VIEWED')) setRefused(errorMessage(error))
      else toast.show(errorMessage(error), 'error')
    } finally {
      setOpening(false)
      setConfirming(false)
      onChanged()
    }
  }

  return (
    <>
      <section aria-label="Resumo da partilha" className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-col">
            <h2 className="text-xl font-semibold">{share.participantLabel}</h2>
            <p className="text-base text-muted">{categoriesText(share.categories)}</p>
          </div>
          <Badge tone={status.tone} dot>
            {status.label}
          </Badge>
        </div>
        {share.status === 'ACTIVE' && share.canOpen && (
          <p className="text-base">
            <span className="text-muted">Disponível até: </span>
            {formatWhenLuanda(share.expiresAt)}
          </p>
        )}
        <p className="text-base text-muted">
          {share.openCount === 0 ? 'Ainda não a abriu.' : share.openCount === 1 ? 'Abriu 1 vez.' : `Abriu ${share.openCount} vezes.`}
          {share.lastOpenedAt ? ` Última abertura: ${formatWhenLuanda(share.lastOpenedAt)}.` : ''}
        </p>
        {share.viewOnce && share.status !== 'CONSUMED' && <p className="text-base font-medium">Só pode ser aberta uma vez.</p>}
        {share.status === 'CONSUMED' && !content && <p className="text-base">Esta partilha já foi vista e não pode ser aberta outra vez.</p>}
        {share.status !== 'ACTIVE' && share.status !== 'CONSUMED' && <p className="text-base">Esta partilha já não está disponível.</p>}
        {refused && (
          <p role="alert" className="text-base text-danger">
            {refused}
          </p>
        )}
        {share.canOpen && !content && (
          <Button size="xl" fullWidth onClick={() => setConfirming(true)} loading={opening}>
            Abrir partilha
          </Button>
        )}
      </section>

      {content ? (
        <>
          <p role="note" className="rounded-xl bg-warning-soft px-4 py-3 text-base">
            {PROFESSIONAL_OPEN_NOTICE}
          </p>
          <SharedRecordsViewer view={content} />
        </>
      ) : null}

      <ConfirmSheet
        open={confirming}
        title="Abrir esta partilha?"
        description={
          share.viewOnce
            ? 'Só pode abrir esta partilha uma vez. Se sair do ecrã depois de abrir, não a poderá ver outra vez.'
            : 'Cada abertura fica registada e a família pode vê-la. Os dados mostram uma marca de água com o seu nome.'
        }
        yesLabel="Sim, abrir"
        loading={opening}
        onYes={() => void open()}
        onNo={() => setConfirming(false)}
      />
    </>
  )
}
