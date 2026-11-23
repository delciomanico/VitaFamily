import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import { Sheet } from '@/components/app/Sheet'
import { FamilySummaryView } from '@/components/summary/FamilySummaryView'
import { MemberSummaryView } from '@/components/summary/MemberSummaryView'
import { PeriodControls } from '@/components/summary/PeriodControls'
import { Page } from '@/components/layout/Page'
import { Avatar } from '@/components/ui/Avatar'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { cn } from '@/lib/cn'
import { firstName, isValidISODate } from '@/lib/date'
import { isAppError } from '@/lib/errors'
import { rangeProblem, shortcutRange, type SummaryRange, type SummaryShortcut } from '@/lib/summaryPeriod'
import { paths } from '@/routes/paths'
import { healthSummaryService } from '@/services/healthSummary.service'
import type { FamilyHealthSummary, HealthSummary } from '@/types/healthSummary'
import { reportService } from '@/services/report.service'

const FAMILY = 'familia'

type Loaded = { kind: 'family'; data: FamilyHealthSummary } | { kind: 'member'; data: HealthSummary }

/** Resumo de saúde (UC-RPT-05/05b): estatísticas simples, calculadas no servidor, por membro ou para a família. */
export function HealthSummaryPage() {
  const { user, family, member: self } = useAuth()
  const [params, setParams] = useSearchParams()
  const [pickOpen, setPickOpen] = useState(false)
  const familyId = family?.id ?? ''
  const userId = user?.id ?? ''

  const subjects = useAsync(() => reportService.listReportSubjects(familyId, userId), [familyId, userId])
  const list = subjects.state.status === 'success' ? subjects.state.data : []

  const subject = params.get('membro') ?? self?.id ?? ''
  const isFamily = subject === FAMILY
  const shortcutParam = params.get('periodo')
  const shortcut: SummaryShortcut = shortcutParam === '30' || shortcutParam === '90' || shortcutParam === 'custom' ? shortcutParam : '12m'
  const from = params.get('de') ?? ''
  const to = params.get('ate') ?? ''
  const custom = shortcut === 'custom' && isValidISODate(from) && isValidISODate(to) && !rangeProblem({ from, to })
  const range: SummaryRange = useMemo(() => (custom ? { from, to } : shortcutRange(shortcut === 'custom' ? '12m' : shortcut)), [custom, from, to, shortcut])
  const active: SummaryShortcut = custom ? 'custom' : shortcut === 'custom' ? '12m' : shortcut

  const { state, reload } = useAsync<Loaded>(
    () =>
      isFamily
        ? healthSummaryService.getFamilySummary(familyId, userId, range).then((data) => ({ kind: 'family' as const, data }))
        : healthSummaryService.getMemberSummary(familyId, userId, subject, range).then((data) => ({ kind: 'member' as const, data })),
    [familyId, userId, subject, isFamily, range],
  )

  const update = (changes: Record<string, string | null>) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        for (const [key, value] of Object.entries(changes)) value === null ? next.delete(key) : next.set(key, value)
        return next
      },
      { replace: true },
    )

  const chosen = list.find((s) => s.member.id === subject)
  const chosenName = isFamily ? 'Toda a família' : (chosen?.member.name ?? self?.name ?? '')
  const canPick = list.length > 1

  return (
    <Page title="Resumo de saúde" backTo={paths.health} backLabel="Saúde">
      <button
        type="button"
        disabled={!canPick}
        onClick={() => setPickOpen(true)}
        aria-label={canPick ? `Ver o resumo de: ${chosenName}. Mudar` : undefined}
        className="flex min-h-16 items-center gap-4 border-b border-border pb-3 text-start disabled:cursor-default"
      >
        <Avatar name={chosenName || '?'} size="lg" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm text-muted">Resumo de</span>
          <span className="truncate font-display text-xl leading-6 font-semibold">{isFamily ? chosenName : firstName(chosenName)}</span>
        </span>
        {canPick && <ChevronDown className="size-6 shrink-0 text-muted" aria-hidden />}
      </button>

      <PeriodControls
        value={active}
        range={range}
        onShortcut={(s) => update({ periodo: s, de: null, ate: null })}
        onCustom={(r) => update({ periodo: 'custom', de: r.from, ate: r.to })}
      />

      {state.status === 'loading' && <LoadingState rows={4} />}
      {state.status === 'error' &&
        (isAppError(state.error, 'NOT_FOUND') ? (
          <ErrorState message="Não há resumo disponível para esta pessoa." />
        ) : isAppError(state.error, 'FORBIDDEN') ? (
          <ErrorState message="Não tem acesso ao resumo desta pessoa." />
        ) : isAppError(state.error, 'RATE_LIMITED') ? (
          <ErrorState message="Pediu muitas vezes seguidas. Espere um momento e tente de novo." onRetry={reload} />
        ) : isAppError(state.error, 'VALIDATION_ERROR') ? (
          <ErrorState message="Este período não é possível. Escolha até 5 anos." />
        ) : (
          <ErrorState onRetry={reload} />
        ))}
      {state.status === 'success' && state.data.kind === 'family' && (
        <FamilySummaryView
          summary={state.data.data}
          linkTo={(id) => `${paths.healthSummary}?${new URLSearchParams({ membro: id, periodo: active, ...(custom ? { de: range.from, ate: range.to } : {}) })}`}
        />
      )}
      {state.status === 'success' && state.data.kind === 'member' && (
        <MemberSummaryView
          key={`${subject}-${range.from}-${range.to}`}
          summary={state.data.data}
          firstName={firstName(chosenName)}
          canAdd={Boolean(chosen?.manage ?? chosen?.isSelf)}
        />
      )}

      <Sheet open={pickOpen} onClose={() => setPickOpen(false)} title="Ver o resumo de quem?">
        <ul className="flex flex-col pb-2">
          {list.map((s) => (
            <li key={s.member.id}>
              <PickRow name={s.isSelf ? `${s.member.name} (eu)` : s.member.name} selected={!isFamily && subject === s.member.id} onPick={() => { update({ membro: s.member.id }); setPickOpen(false) }} />
            </li>
          ))}
          <li>
            <PickRow name="Toda a família" selected={isFamily} onPick={() => { update({ membro: FAMILY }); setPickOpen(false) }} />
          </li>
        </ul>
      </Sheet>
    </Page>
  )
}

function PickRow({ name, selected, onPick }: { name: string; selected: boolean; onPick: () => void }) {
  return (
    <button type="button" aria-pressed={selected} onClick={onPick} className={cn('flex min-h-16 w-full items-center gap-4 border-b border-border py-2 text-start', selected && 'font-semibold')}>
      <Avatar name={name} size="lg" />
      <span className="flex-1 text-lg">{name}</span>
      {selected && <span className="text-sm font-semibold text-primary">Escolhido</span>}
    </button>
  )
}
