import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ClipboardCheck } from 'lucide-react'
import { ValidationStatusBadge } from '@/components/professional/ValidationStatusBadge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Select, type SelectOption } from '@/components/ui/Select'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAsync } from '@/hooks/useAsync'
import { errorMessage } from '@/lib/errors'
import { formatCount, formatShortDate } from '@/lib/format'
import { categoryLabel, validationStatusLabel } from '@/lib/professional'
import { paths } from '@/routes/paths'
import { professionalAdminService } from '@/services/professionalAdmin.service'
import type {
  AdminProfessionalFilters,
  AdminProfessionalItem,
  AdminProfessionalPage,
  ProfessionalValidationStatus,
  SpecialtyCategory,
} from '@/types/professional'

const STATUS_OPTIONS: SelectOption[] = (Object.keys(validationStatusLabel) as ProfessionalValidationStatus[]).map((value) => ({
  value,
  label: validationStatusLabel[value],
}))

const CATEGORY_OPTIONS: SelectOption[] = [
  { value: '', label: 'Todas' },
  ...(Object.keys(categoryLabel) as SpecialtyCategory[]).map((value) => ({ value, label: categoryLabel[value] })),
]

/** A pesquisa só chama o serviço a partir de 2 letras (UC-MKT-06). */
const MIN_SEARCH_LENGTH = 2

/** Fila de validação de profissionais (`/admin/professionals`, UC-MKT-06). */
export function AdminProfessionalsPage() {
  const toast = useToast()
  const [status, setStatus] = useState<ProfessionalValidationStatus>('PENDING_REVIEW')
  const [category, setCategory] = useState<'' | SpecialtyCategory>('')
  const [search, setSearch] = useState('')
  const term = search.trim()
  const q = term.length >= MIN_SEARCH_LENGTH ? term : undefined

  const filters: AdminProfessionalFilters = { status, category: category || undefined, q }
  const { state, reload } = useAsync(() => professionalAdminService.list(filters), [status, category, q])

  // Páginas seguintes guardam a primeira página a que pertencem: ao mudar filtros, deixam de valer.
  const [extra, setExtra] = useState<{ base: AdminProfessionalPage; items: AdminProfessionalItem[]; nextCursor: string | null } | null>(
    null,
  )
  const [loadingMore, setLoadingMore] = useState(false)

  const page = state.status === 'success' ? state.data : null
  const more = page && extra?.base === page ? extra : null
  const items = page ? [...page.items, ...(more?.items ?? [])] : []
  const nextCursor = more ? more.nextCursor : (page?.nextCursor ?? null)

  async function loadMore() {
    if (!page || !nextCursor) return
    setLoadingMore(true)
    try {
      const next = await professionalAdminService.list({ ...filters, cursor: nextCursor })
      setExtra({ base: page, items: [...(more?.items ?? []), ...next.items], nextCursor: next.nextCursor })
    } catch (error) {
      toast.show(errorMessage(error), 'error')
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <>
      <h1 className="text-xl font-semibold">Profissionais</h1>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Select
          label="Estado"
          options={STATUS_OPTIONS}
          value={status}
          onChange={(event) => setStatus(event.target.value as ProfessionalValidationStatus)}
        />
        <Select
          label="Categoria"
          options={CATEGORY_OPTIONS}
          value={category}
          onChange={(event) => setCategory(event.target.value as '' | SpecialtyCategory)}
        />
        <Input
          label="Pesquisar"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          hint={term.length > 0 && term.length < MIN_SEARCH_LENGTH ? 'Escreva pelo menos 2 letras para pesquisar.' : undefined}
          placeholder="Nome ou e-mail"
        />
      </div>

      {state.status === 'loading' && <LoadingState rows={3} />}
      {state.status === 'error' && <ErrorState message={errorMessage(state.error)} onRetry={reload} />}

      {page &&
        (items.length > 0 ? (
          <section className="flex flex-col gap-3">
            <Card className="divide-y divide-border py-1">
              {items.map((item) => (
                <Link
                  key={item.id}
                  to={paths.adminProfessional(item.id)}
                  className="flex flex-col gap-1 rounded-md py-3 transition-colors hover:bg-surface-muted"
                >
                  <span className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate font-medium">{item.displayName || 'Sem nome'}</span>
                    <ValidationStatusBadge status={item.validationStatus} />
                  </span>
                  <span className="truncate text-sm text-muted">{item.email}</span>
                  <span className="text-sm text-muted">
                    {item.specialties.map((specialty) => specialty.name).join(', ') || 'Sem especialidades'} ·{' '}
                    {formatCount(item.credentialCount, 'credencial', 'credenciais')}
                  </span>
                  <span className="text-xs text-muted">
                    Submetido: {item.submittedAt ? formatShortDate(item.submittedAt) : 'ainda não'}
                  </span>
                </Link>
              ))}
            </Card>
            {nextCursor && (
              <Button variant="secondary" onClick={() => void loadMore()} loading={loadingMore}>
                Carregar mais
              </Button>
            )}
          </section>
        ) : (
          <EmptyState icon={ClipboardCheck} title="Sem profissionais neste estado." />
        ))}
    </>
  )
}
