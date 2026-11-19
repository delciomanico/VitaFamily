import { Link, useSearchParams } from 'react-router-dom'
import { GitCompare } from 'lucide-react'
import { Page } from '@/components/layout/Page'
import { Badge } from '@/components/ui/Badge'
import { ButtonLink } from '@/components/ui/Button'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { useAsync } from '@/hooks/useAsync'
import { usePageTitle } from '@/hooks/usePageTitle'
import { errorMessage } from '@/lib/errors'
import { formatWhenLuanda } from '@/lib/format'
import { formatKz, offerMethodLabel } from '@/lib/professional'
import { paths } from '@/routes/paths'
import { marketplaceService } from '@/services/marketplace.service'
import type { ComparisonItem, MarketplaceOffer, ProfessionalComparison } from '@/types/marketplace'
import type { OfferMethod } from '@/types/professional'

const MIN_IDS = 2
const MAX_IDS = 3
const METHOD_ORDER = Object.keys(offerMethodLabel) as OfferMethod[]

interface RowKey {
  method: OfferMethod
  durationMinutes: number
}

/** Oferta de um profissional para um método e duração, se existir. */
function offerFor(item: ComparisonItem, row: RowKey): MarketplaceOffer | undefined {
  return item.offers.find((offer) => offer.method === row.method && offer.durationMinutes === row.durationMinutes)
}

interface ComparisonTableProps {
  comparison: ProfessionalComparison
  specialtyId: string
}

/** Tabela lado a lado: profissionais nas colunas; método e duração nas linhas. */
function ComparisonTable({ comparison, specialtyId }: ComparisonTableProps) {
  const { items, priceSummary } = comparison

  // União de método + duração entre os profissionais, por ordem de método e duração.
  const seen = new Map<string, RowKey>()
  for (const offer of items.flatMap((item) => item.offers)) {
    const key = `${offer.method}-${offer.durationMinutes}`
    if (!seen.has(key)) seen.set(key, { method: offer.method, durationMinutes: offer.durationMinutes })
  }
  const rows = [...seen.values()].sort(
    (a, b) => METHOD_ORDER.indexOf(a.method) - METHOD_ORDER.indexOf(b.method) || a.durationMinutes - b.durationMinutes,
  )

  const isCheapest = (professionalId: string, offer: MarketplaceOffer) => {
    const summary = priceSummary.find((entry) => entry.method === offer.method)
    return Boolean(summary && summary.cheapestProfessionalIds.includes(professionalId) && offer.priceKz === summary.minPriceKz)
  }

  const nameOf = (professionalId: string) => items.find((item) => item.professionalId === professionalId)?.displayName ?? ''

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-card">
      <table className="w-full min-w-[32rem] border-collapse text-sm">
        <caption className="sr-only">Comparação de preços de {items.length} profissionais</caption>
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className="p-3 text-left font-medium text-muted">
              Oferta
            </th>
            {items.map((item) => (
              <th scope="col" key={item.professionalId} className="p-3 text-left align-top">
                <Link to={paths.marketplaceProfessional(item.professionalId, specialtyId)} className="font-semibold hover:underline">
                  {item.displayName}
                </Link>
                <span className="block text-xs font-normal text-muted">{item.city}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.method}-${row.durationMinutes}`} className="border-b border-border">
              <th scope="row" className="p-3 text-left font-medium">
                {offerMethodLabel[row.method]} · {row.durationMinutes} min
              </th>
              {items.map((item) => {
                const offer = offerFor(item, row)
                return (
                  <td key={item.professionalId} className="p-3 align-top">
                    {offer ? (
                      <span className="flex flex-col items-start gap-1">
                        <span className="font-semibold">{formatKz(offer.priceKz)}</span>
                        {isCheapest(item.professionalId, offer) && <Badge tone="success">Mais barato</Badge>}
                        {offer.note && <span className="text-xs text-muted">{offer.note}</span>}
                      </span>
                    ) : (
                      <span className="text-muted">
                        <span aria-hidden>—</span>
                        <span className="sr-only">Sem oferta</span>
                      </span>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
          <tr className="border-b border-border">
            <th scope="row" className="p-3 text-left font-medium">
              A partir de
            </th>
            {items.map((item) => (
              <td key={item.professionalId} className="p-3 align-top font-semibold">
                {formatKz(item.fromPriceKz)}
              </td>
            ))}
          </tr>
          <tr className="border-b border-border">
            <th scope="row" className="p-3 text-left font-medium">
              Próxima disponibilidade
            </th>
            {items.map((item) => (
              <td key={item.professionalId} className="p-3 align-top">
                {item.nextAvailableAt ? formatWhenLuanda(item.nextAvailableAt) : 'Sem horários livres'}
              </td>
            ))}
          </tr>
          {priceSummary.map((summary) => (
            <tr key={summary.method} className="bg-surface-muted">
              <th scope="row" className="p-3 text-left font-medium">
                Intervalo · {offerMethodLabel[summary.method]}
              </th>
              <td colSpan={items.length} className="p-3">
                {formatKz(summary.minPriceKz)} a {formatKz(summary.maxPriceKz)}
                {summary.cheapestProfessionalIds.length > 0 && (
                  <span className="block text-xs text-muted">
                    Mais barato: {summary.cheapestProfessionalIds.map(nameOf).filter(Boolean).join(', ')}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Comparação de preços entre 2 a 3 profissionais para uma especialidade (`/marketplace/comparar`). */
export function MarketplaceComparePage() {
  usePageTitle('Comparar profissionais')
  const [params] = useSearchParams()
  const idsParam = params.get('ids') ?? ''
  const specialtyId = params.get('especialidade') ?? ''
  const ids = [...new Set(idsParam.split(',').map((id) => id.trim()).filter((id) => id !== ''))]
  const valid = ids.length >= MIN_IDS && ids.length <= MAX_IDS && specialtyId !== ''
  const requestKey = `${ids.join(',')}|${specialtyId}`

  const { state, reload } = useAsync<ProfessionalComparison | null>(
    () => (valid ? marketplaceService.compare(ids, specialtyId) : Promise.resolve(null)),
    [requestKey],
  )

  if (!valid) {
    return (
      <Page title="Comparar" backTo={paths.marketplace}>
        <EmptyState
          icon={GitCompare}
          title={specialtyId ? 'Escolha de 2 a 3 profissionais para comparar.' : 'Escolha uma especialidade para comparar preços.'}
          action={
            <ButtonLink to={paths.marketplace} variant="secondary">
              Voltar à pesquisa
            </ButtonLink>
          }
        />
      </Page>
    )
  }

  return (
    <Page title="Comparar" backTo={paths.marketplace}>
      {state.status === 'loading' && <LoadingState rows={2} />}
      {state.status === 'error' && <ErrorState message={errorMessage(state.error)} onRetry={reload} />}
      {state.status === 'success' && state.data && <ComparisonTable comparison={state.data} specialtyId={specialtyId} />}
    </Page>
  )
}
