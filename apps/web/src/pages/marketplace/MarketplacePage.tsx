import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { SearchX } from 'lucide-react'
import { Page } from '@/components/layout/Page'
import { ProfessionalCard } from '@/components/marketplace/ProfessionalCard'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select, type SelectOption } from '@/components/ui/Select'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAsync } from '@/hooks/useAsync'
import { usePageTitle } from '@/hooks/usePageTitle'
import { errorMessage } from '@/lib/errors'
import { formatCount } from '@/lib/format'
import { sortLabel } from '@/lib/marketplace'
import { offerMethodLabel } from '@/lib/professional'
import { paths } from '@/routes/paths'
import { marketplaceService } from '@/services/marketplace.service'
import type {
  MarketplaceFilters,
  MarketplaceProfessionalItem,
  MarketplaceProfessionalPage,
  MarketplaceSearchParams,
  MarketplaceSort,
} from '@/types/marketplace'
import type { OfferMethod } from '@/types/professional'

/** A pesquisa por nome só chama o serviço a partir de 2 letras. */
const MIN_SEARCH_LENGTH = 2
const MIN_COMPARE = 2
const MAX_COMPARE = 3

const WITHIN_DAYS_OPTIONS: SelectOption[] = [
  { value: '', label: 'Qualquer data' },
  { value: '3', label: 'Nos próximos 3 dias' },
  { value: '7', label: 'Nos próximos 7 dias' },
  { value: '14', label: 'Nos próximos 14 dias' },
  { value: '30', label: 'Nos próximos 30 dias' },
]

const SORT_KEYS = Object.keys(sortLabel) as MarketplaceSort[]

/**
 * Campo de preço em Kz: vazio → `undefined`; inteiro ≥ 0 → número; qualquer outro texto → `null` (inválido).
 */
function parseKz(value: string): number | undefined | null {
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null
}

interface MoreState {
  base: MarketplaceProfessionalPage
  items: MarketplaceProfessionalItem[]
  nextCursor: string | null
}

/** Pesquisa e resultados; só monta depois de carregadas as opções de filtro. */
function MarketplaceSearch({ filters }: { filters: MarketplaceFilters }) {
  const toast = useToast()
  const navigate = useNavigate()
  const [params] = useSearchParams()

  const [name, setName] = useState('')
  const [specialtyId, setSpecialtyId] = useState(() => {
    const requested = params.get('especialidade') ?? ''
    return filters.specialties.some((specialty) => specialty.id === requested) ? requested : ''
  })
  const [method, setMethod] = useState<'' | OfferMethod>('')
  const [city, setCity] = useState('')
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [withinDays, setWithinDays] = useState('')
  /** `null` = omissão (depende da especialidade). */
  const [sortChoice, setSortChoice] = useState<MarketplaceSort | null>(null)
  const [selected, setSelected] = useState<string[]>([])

  const hasSpecialty = specialtyId !== ''
  const defaultSort: MarketplaceSort = hasSpecialty ? 'RANKING' : 'NEXT_AVAILABLE'
  const requestedSort = sortChoice ?? defaultSort
  // «Melhores» só existe com especialidade escolhida.
  const sort: MarketplaceSort = requestedSort === 'RANKING' && !hasSpecialty ? 'NEXT_AVAILABLE' : requestedSort
  const sortOptions: SelectOption[] = SORT_KEYS.filter((key) => key !== 'RANKING' || hasSpecialty).map((key) => ({
    value: key,
    label: sortLabel[key],
  }))

  const term = name.trim()
  const minKz = parseKz(minPrice)
  const maxKz = parseKz(maxPrice)
  const minError = minKz === null ? 'Indique um valor em Kz, só com algarismos.' : undefined
  const maxError =
    maxKz === null
      ? 'Indique um valor em Kz, só com algarismos.'
      : typeof minKz === 'number' && typeof maxKz === 'number' && minKz > maxKz
        ? 'O preço máximo não pode ser inferior ao mínimo.'
        : undefined

  // Com preços inválidos ou em ordem errada não há pesquisa: o erro aparece nos campos.
  const query: MarketplaceSearchParams | null =
    minError || maxError
      ? null
      : {
          q: term.length >= MIN_SEARCH_LENGTH ? term : undefined,
          specialtyId: hasSpecialty ? specialtyId : undefined,
          method: method || undefined,
          city: city || undefined,
          minPriceKz: minKz ?? undefined,
          maxPriceKz: maxKz ?? undefined,
          availableWithinDays: withinDays ? Number(withinDays) : undefined,
          sort,
        }
  const queryKey = query ? JSON.stringify(query) : ''

  const { state, reload } = useAsync<MarketplaceProfessionalPage | null>(
    () => (query ? marketplaceService.search(query) : Promise.resolve(null)),
    [queryKey],
  )

  // Páginas seguintes guardam a primeira página a que pertencem: ao mudar a pesquisa, deixam de valer.
  const [extra, setExtra] = useState<MoreState | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)

  const page = state.status === 'success' ? state.data : null
  const more = page && extra?.base === page ? extra : null
  const items = page ? [...page.items, ...(more?.items ?? [])] : []
  const nextCursor = more ? more.nextCursor : (page?.nextCursor ?? null)

  async function loadMore() {
    if (!page || !query || !nextCursor) return
    setLoadingMore(true)
    try {
      const next = await marketplaceService.search({ ...query, cursor: nextCursor })
      setExtra({ base: page, items: [...(more?.items ?? []), ...next.items], nextCursor: next.nextCursor })
    } catch (error) {
      toast.show(errorMessage(error), 'error')
    } finally {
      setLoadingMore(false)
    }
  }

  function changeSpecialty(value: string) {
    setSpecialtyId(value)
    setSelected([])
  }

  function toggleCompare(id: string) {
    setSelected((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id)
      return current.length >= MAX_COMPARE ? current : [...current, id]
    })
  }

  const specialtyOptions: SelectOption[] = [
    { value: '', label: 'Todas as especialidades' },
    ...filters.specialties.map((specialty) => ({
      value: specialty.id,
      label: `${specialty.name} (${specialty.professionalCount})`,
    })),
  ]
  const methodOptions: SelectOption[] = [
    { value: '', label: 'Todos os métodos' },
    ...filters.methods.map((value) => ({ value, label: offerMethodLabel[value] })),
  ]
  const cityOptions: SelectOption[] = [
    { value: '', label: 'Todas as cidades' },
    ...filters.cities.map((item) => ({ value: item.name, label: `${item.name} (${item.professionalCount})` })),
  ]
  const compareFull = selected.length >= MAX_COMPARE

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="Pesquisar por nome"
          type="search"
          placeholder="Nome do profissional"
          value={name}
          onChange={(event) => setName(event.target.value)}
          hint={term.length === 1 ? 'Escreva pelo menos 2 letras para pesquisar por nome.' : undefined}
        />
        <Select label="Especialidade" options={specialtyOptions} value={specialtyId} onChange={(event) => changeSpecialty(event.target.value)} />
        <Select
          label="Método"
          options={methodOptions}
          value={method}
          onChange={(event) => setMethod(event.target.value as '' | OfferMethod)}
        />
        <Select label="Cidade" options={cityOptions} value={city} onChange={(event) => setCity(event.target.value)} />
        <Input
          label="Preço mínimo (Kz)"
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          value={minPrice}
          onChange={(event) => setMinPrice(event.target.value)}
          hint="Valor inteiro, em Kz."
          error={minError}
        />
        <Input
          label="Preço máximo (Kz)"
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          value={maxPrice}
          onChange={(event) => setMaxPrice(event.target.value)}
          hint="Valor inteiro, em Kz."
          error={maxError}
        />
        <Select
          label="Disponível nos próximos"
          options={WITHIN_DAYS_OPTIONS}
          value={withinDays}
          onChange={(event) => setWithinDays(event.target.value)}
        />
        <Select
          label="Ordenar por"
          options={sortOptions}
          value={sort}
          onChange={(event) => setSortChoice(event.target.value as MarketplaceSort)}
        />
      </div>

      <p aria-live="polite" className="text-sm text-muted">
        {page ? formatCount(items.length, 'profissional encontrado', 'profissionais encontrados') : ''}
      </p>

      {state.status === 'loading' && <LoadingState rows={3} />}
      {state.status === 'error' && <ErrorState message={errorMessage(state.error)} onRetry={reload} />}

      {page && items.length === 0 && (
        <EmptyState
          icon={SearchX}
          title="Sem resultados"
          description="Tente alargar os filtros: retire a cidade, o método ou o intervalo de preços."
        />
      )}

      {page && items.length > 0 && (
        <section aria-label="Resultados" className="flex flex-col gap-3">
          {items.map((item) => (
            <ProfessionalCard
              key={item.id}
              item={item}
              specialtyId={hasSpecialty ? specialtyId : undefined}
              selected={selected.includes(item.id)}
              onToggleCompare={hasSpecialty ? () => toggleCompare(item.id) : undefined}
              compareDisabled={compareFull && !selected.includes(item.id)}
            />
          ))}
          {nextCursor && (
            <Button variant="secondary" onClick={() => void loadMore()} loading={loadingMore}>
              Carregar mais
            </Button>
          )}
          {sort === 'RANKING' && (
            <p className="text-sm text-muted">
              O pagamento e os destaques pagos nunca influenciam a ordem.{' '}
              <Link to={paths.marketplaceRanking} className="font-medium text-primary underline">
                Como ordenamos
              </Link>
            </p>
          )}
        </section>
      )}

      {hasSpecialty ? (
        <div className="sticky bottom-4 flex items-center justify-between gap-3 rounded-xl border border-border bg-surface p-3 shadow-overlay">
          <p className="text-sm text-muted">
            {selected.length < MIN_COMPARE ? 'Escolha de 2 a 3 profissionais para comparar.' : `${selected.length} de ${MAX_COMPARE} escolhidos.`}
          </p>
          <Button
            disabled={selected.length < MIN_COMPARE}
            onClick={() => navigate(paths.marketplaceCompare(selected, specialtyId))}
          >
            Comparar ({selected.length})
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted">Escolha uma especialidade para comparar preços.</p>
      )}
    </>
  )
}

/** Pesquisa de profissionais para famílias (`/marketplace`, MK2). */
export function MarketplacePage() {
  usePageTitle('Profissionais')
  const { state, reload } = useAsync(() => marketplaceService.filters(), [])

  return (
    <Page
      title="Profissionais"
      action={
        <ButtonLink to={paths.marketplaceRanking} variant="secondary" size="sm">
          Como ordenamos
        </ButtonLink>
      }
    >
      {state.status === 'loading' && <LoadingState rows={3} />}
      {state.status === 'error' && <ErrorState message={errorMessage(state.error)} onRetry={reload} />}
      {state.status === 'success' && <MarketplaceSearch filters={state.data} />}
    </Page>
  )
}
