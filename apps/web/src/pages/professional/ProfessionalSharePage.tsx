import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, CircleSlash } from 'lucide-react'
import { SharedRecordsViewer } from '@/components/shares/SharedRecordsViewer'
import { LockedNotice } from '@/components/professional/LockedNotice'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
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
  const back = (
    <Link to={paths.professionalShares} className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-primary">
      <ArrowLeft className="size-4" aria-hidden />
      Voltar às partilhas
    </Link>
  )

  if (!shown && state.status === 'loading')
    return (
      <div className="flex flex-col gap-4">
        {back}
        <LoadingState rows={3} />
      </div>
    )
  if (state.status === 'error')
    return (
      <div className="flex flex-col gap-4">
        {back}
        {isAppError(state.error, 'NOT_FOUND') ? <EmptyState icon={CircleSlash} title="Partilha não encontrada." /> : <ErrorState message={errorMessage(state.error)} onRetry={reload} />}
      </div>
    )
  return (
    <div className="flex flex-col gap-4">
      {back}
      <h1 className="text-xl font-semibold">Partilha</h1>
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
      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-col">
            <h2 className="text-lg font-semibold">{share.participantLabel}</h2>
            <p className="text-sm text-muted">{categoriesText(share.categories)}</p>
          </div>
          <Badge tone={status.tone} dot>
            {status.label}
          </Badge>
        </div>
        {share.status === 'ACTIVE' && share.canOpen && (
          <p className="text-sm">
            <span className="text-muted">Disponível até: </span>
            {formatWhenLuanda(share.expiresAt)}
          </p>
        )}
        <p className="text-sm text-muted">
          {share.openCount === 0 ? 'Ainda não a abriu.' : share.openCount === 1 ? 'Abriu 1 vez.' : `Abriu ${share.openCount} vezes.`}
          {share.lastOpenedAt ? ` Última abertura: ${formatWhenLuanda(share.lastOpenedAt)}.` : ''}
        </p>
        {share.viewOnce && share.status !== 'CONSUMED' && <p className="text-sm font-medium">Só pode ser aberta uma vez.</p>}
        {share.status === 'CONSUMED' && !content && <p className="text-sm">Esta partilha já foi vista e não pode ser aberta outra vez.</p>}
        {share.status !== 'ACTIVE' && share.status !== 'CONSUMED' && <p className="text-sm">Esta partilha já não está disponível.</p>}
        {refused && (
          <p role="alert" className="text-sm text-danger">
            {refused}
          </p>
        )}
        {share.canOpen && !content && (
          <Button className="w-fit" onClick={() => setConfirming(true)} loading={opening}>
            Abrir partilha
          </Button>
        )}
      </Card>

      {content ? (
        <>
          <p role="note" className="rounded-md bg-warning-soft px-3.5 py-3 text-sm">
            {PROFESSIONAL_OPEN_NOTICE}
          </p>
          <SharedRecordsViewer view={content} />
        </>
      ) : null}

      <ConfirmDialog
        open={confirming}
        title="Abrir esta partilha?"
        description={
          share.viewOnce
            ? 'Só pode abrir esta partilha uma vez. Se sair do ecrã depois de abrir, não a poderá ver outra vez.'
            : 'Cada abertura fica registada e a família pode vê-la. Os dados mostram uma marca de água com o seu nome.'
        }
        confirmLabel="Abrir"
        loading={opening}
        onConfirm={() => void open()}
        onCancel={() => setConfirming(false)}
      />
    </>
  )
}
