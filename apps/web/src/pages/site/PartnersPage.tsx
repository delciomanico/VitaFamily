import { useMemo, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Building2, Clock, Mail, MapPin, Phone, Search, ShieldCheck, Stethoscope } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { ButtonLink, Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Pagination } from '@/components/ui/Pagination'
import { Select } from '@/components/ui/Select'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { useAsync } from '@/hooks/useAsync'
import { usePageTitle } from '@/hooks/usePageTitle'
import { cn } from '@/lib/cn'
import { paths } from '@/routes/paths'
import { partnersService } from '@/services/partners.service'
import type { PartnerKind, PublicPartner } from '@/types/partner'

type KindFilter = 'ALL' | PartnerKind

/** Itens por página (o primeiro é o padrão). */
const PAGE_SIZES = [5, 10, 20]

const kindFilters: { value: KindFilter; label: string }[] = [
  { value: 'ALL', label: 'Todos' },
  { value: 'CLINIC', label: 'Clínicas' },
  { value: 'INSURER', label: 'Seguradoras' },
]

/** Minúsculas e sem acentos, para a pesquisa não falhar por «Clinica» vs «Clínica». */
function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

function matches(partner: PublicPartner, query: string): boolean {
  if (!query) return true
  const haystack = normalize(
    [partner.name, partner.city, partner.address, partner.description, ...(partner.specialties ?? []), ...(partner.insurers ?? [])]
      .filter(Boolean)
      .join(' '),
  )
  return query.split(/\s+/).every((word) => haystack.includes(word))
}

/** Célula com rótulo próprio no telemóvel, onde a linha da tabela vira um bloco. */
function Cell({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <td
      className={cn(
        'block px-5 py-2 align-top md:table-cell md:px-6 md:py-5',
        'before:mb-1 before:block before:text-xs before:font-semibold before:tracking-wide before:text-muted before:uppercase before:content-[attr(data-label)] md:before:hidden',
        className,
      )}
      data-label={label}
    >
      {children}
    </td>
  )
}

function PartnerRow({ partner }: { partner: PublicPartner }) {
  const isClinic = partner.kind === 'CLINIC'
  const Icon = isClinic ? Stethoscope : ShieldCheck
  const specialties = partner.specialties ?? []
  const insurers = partner.insurers ?? []
  return (
    <tr className="block border-b border-border py-3 transition-colors last:border-b-0 hover:bg-primary-soft/40 md:table-row md:py-0">
      <th scope="row" className="block px-5 py-2 text-left align-top font-normal md:table-cell md:px-6 md:py-5">
        <div className="flex items-start gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
            <Icon className="size-6" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-lg font-bold">{partner.name}</p>
            <Badge tone="primary" className="mt-1">
              {isClinic ? 'Clínica' : 'Seguradora'}
            </Badge>
            {partner.description && <p className="mt-2 max-w-sm text-base text-muted">{partner.description}</p>}
          </div>
        </div>
      </th>
      <Cell label="Localização">
        <div className="flex flex-col gap-2 text-base">
          {partner.city && <p className="font-semibold">{partner.city}</p>}
          {partner.address && (
            <p className="flex gap-2">
              <MapPin className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
              <span>{partner.address}</span>
            </p>
          )}
          {partner.openingHours && (
            <p className="flex gap-2 text-muted">
              <Clock className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
              <span>{partner.openingHours}</span>
            </p>
          )}
          {!partner.city && !partner.address && !partner.openingHours && <span className="text-muted">—</span>}
        </div>
      </Cell>
      <Cell label="Contactos">
        <div className="flex flex-col gap-2 text-base">
          {partner.phone && (
            <p className="flex gap-2">
              <Phone className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
              <a href={`tel:${partner.phone.replace(/\s/g, '')}`} className="font-medium whitespace-nowrap text-primary hover:underline">
                {partner.phone}
              </a>
            </p>
          )}
          {partner.email && (
            <p className="flex gap-2">
              <Mail className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
              <a href={`mailto:${partner.email}`} className="min-w-0 font-medium break-words text-primary hover:underline">
                {partner.email}
              </a>
            </p>
          )}
          {!partner.phone && !partner.email && <span className="text-muted">—</span>}
        </div>
      </Cell>
      <Cell label={isClinic ? 'Especialidades e seguros' : 'Rede'}>
        {specialties.length > 0 || insurers.length > 0 ? (
          <div className="flex flex-col gap-3">
            {specialties.length > 0 && (
              <ul aria-label="Especialidades" className="flex flex-wrap gap-2">
                {specialties.map((specialty) => (
                  <li key={specialty} className="rounded-full bg-surface-muted px-3 py-1 text-sm font-medium">
                    {specialty}
                  </li>
                ))}
              </ul>
            )}
            {insurers.length > 0 && (
              <p className="text-sm text-muted">
                <span className="font-semibold text-foreground">Seguros ligados: </span>
                {insurers.join(', ')}
              </p>
            )}
          </div>
        ) : (
          <span className="text-muted">—</span>
        )}
      </Cell>
    </tr>
  )
}

/**
 * Pesquisa pública da rede de parceiros (clínicas e seguradoras ligadas ao Vita Family).
 * Filtros e pesquisa ficam no URL (`?q=&tipo=&cidade=&especialidade=`) para se poder partilhar.
 */
export function PartnersPage() {
  usePageTitle('Parceiros')
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const kind = (['CLINIC', 'INSURER'].includes(params.get('tipo') ?? '') ? params.get('tipo') : 'ALL') as KindFilter
  const city = params.get('cidade') ?? ''
  const specialty = params.get('especialidade') ?? ''
  const pageSize = PAGE_SIZES.includes(Number(params.get('por'))) ? Number(params.get('por')) : PAGE_SIZES[0]!
  const requestedPage = Math.max(1, Number.parseInt(params.get('pagina') ?? '1', 10) || 1)

  const { state, reload } = useAsync(() => partnersService.listPartners(), [])

  function update(next: Record<string, string>) {
    const merged = new URLSearchParams(params)
    // Qualquer alteração de pesquisa ou filtro volta à primeira página; só «pagina» a mantém.
    if (!('pagina' in next)) merged.delete('pagina')
    for (const [key, value] of Object.entries(next)) {
      if (value && value !== 'ALL') merged.set(key, value)
      else merged.delete(key)
    }
    setParams(merged, { replace: true })
  }

  const partners = state.status === 'success' ? state.data : []
  const cities = useMemo(() => [...new Set(partners.map((p) => p.city).filter((c): c is string => Boolean(c)))].sort((a, b) => a.localeCompare(b, 'pt-PT')), [partners])
  const specialties = useMemo(
    () => [...new Set(partners.flatMap((p) => p.specialties ?? []))].sort((a, b) => a.localeCompare(b, 'pt-PT')),
    [partners],
  )

  const results = useMemo(() => {
    const query = normalize(q)
    return partners.filter(
      (p) =>
        (kind === 'ALL' || p.kind === kind) &&
        (!city || p.city === city) &&
        (!specialty || (p.specialties ?? []).includes(specialty)) &&
        matches(p, query),
    )
  }, [partners, q, kind, city, specialty])

  const hasFilters = Boolean(q || kind !== 'ALL' || city || specialty)
  const pages = Math.max(1, Math.ceil(results.length / pageSize))
  const page = Math.min(requestedPage, pages)
  const visible = results.slice((page - 1) * pageSize, page * pageSize)

  return (
    <>
      <section className="relative overflow-hidden bg-surface">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute -top-32 -left-24 size-[30rem] animate-drift rounded-full bg-primary-soft blur-3xl" />
        </div>
        <div className="relative mx-auto max-w-7xl px-5 py-20 lg:px-10 lg:py-28">
          <p className="text-base font-semibold tracking-wide text-primary uppercase">Rede de parceiros</p>
          <h1 className="mt-4 max-w-3xl text-4xl leading-[1.1] font-bold tracking-tight text-balance md:text-6xl">
            Encontre clínicas e seguradoras perto de si.
          </h1>
          <p className="mt-5 max-w-2xl text-xl text-muted">
            Pesquise por nome, especialidade ou cidade e veja quem está ligado ao Vita Family.
          </p>

          <form role="search" onSubmit={(event) => event.preventDefault()} className="mt-10 flex flex-col gap-4">
            <Input
              label="Pesquisar parceiros"
              type="search"
              icon={Search}
              placeholder="Ex.: Pediatria, Luanda, Clínica…"
              value={q}
              onChange={(event) => update({ q: event.target.value })}
              className="h-14 text-base"
            />
            <div className="grid gap-4 md:grid-cols-2 lg:max-w-3xl">
              <Select
                label="Cidade"
                placeholder="Todas as cidades"
                value={city}
                onChange={(event) => update({ cidade: event.target.value })}
                options={cities.map((value) => ({ value, label: value }))}
              />
              <Select
                label="Especialidade"
                placeholder="Todas as especialidades"
                value={specialty}
                onChange={(event) => update({ especialidade: event.target.value })}
                options={specialties.map((value) => ({ value, label: value }))}
              />
            </div>
            <div role="group" aria-label="Tipo de parceiro" className="flex flex-wrap gap-2">
              {kindFilters.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={kind === option.value}
                  onClick={() => update({ tipo: option.value })}
                  className={cn(
                    'h-11 rounded-full border px-5 text-base font-medium transition-colors',
                    kind === option.value
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-surface hover:bg-surface-muted',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </form>
        </div>
      </section>

      <section className="bg-surface-muted">
        <div className="mx-auto max-w-7xl px-5 py-16 lg:px-10 lg:py-20">
          {state.status === 'loading' && <LoadingState rows={3} label="A carregar parceiros…" />}
          {state.status === 'error' && (
            <ErrorState
              message="O diretório de parceiros não está disponível de momento. Tente mais tarde ou fale connosco."
              onRetry={reload}
            />
          )}
          {state.status === 'success' && (
            <>
              <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
                <p role="status" className="text-lg font-semibold">
                  {results.length === 1 ? '1 parceiro encontrado' : `${results.length} parceiros encontrados`}
                </p>
                {hasFilters && (
                  <Button variant="ghost" onClick={() => setParams({}, { replace: true })}>
                    Limpar filtros
                  </Button>
                )}
              </div>
              {results.length === 0 ? (
                <EmptyState
                  icon={Building2}
                  title="Nenhum parceiro corresponde à pesquisa"
                  description="Experimente outro nome, cidade ou especialidade."
                />
              ) : (
                <>
                <div className="overflow-hidden rounded-3xl border border-border bg-surface shadow-card">
                  <table className="block w-full border-collapse text-left md:table">
                    <caption className="sr-only">Parceiros do Vita Family</caption>
                    <thead className="hidden bg-surface-muted md:table-header-group">
                      <tr>
                        <th scope="col" className="px-6 py-4 text-sm font-semibold tracking-wide text-muted uppercase">
                          Parceiro
                        </th>
                        <th scope="col" className="px-6 py-4 text-sm font-semibold tracking-wide text-muted uppercase">
                          Localização
                        </th>
                        <th scope="col" className="px-6 py-4 text-sm font-semibold tracking-wide text-muted uppercase">
                          Contactos
                        </th>
                        <th scope="col" className="px-6 py-4 text-sm font-semibold tracking-wide text-muted uppercase">
                          Especialidades e seguros
                        </th>
                      </tr>
                    </thead>
                    <tbody className="block md:table-row-group">
                      {visible.map((partner) => (
                        <PartnerRow key={partner.id} partner={partner} />
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination
                  className="mt-6"
                  page={page}
                  pageSize={pageSize}
                  total={results.length}
                  pageSizeOptions={PAGE_SIZES}
                  onPageSizeChange={(size) => update({ por: size === PAGE_SIZES[0] ? '' : String(size) })}
                  onPageChange={(next) => update({ pagina: next > 1 ? String(next) : '' })}
                />
                </>
              )}
            </>
          )}
        </div>
      </section>

      <section className="bg-surface">
        <div className="mx-auto flex max-w-7xl flex-col items-start gap-6 px-5 py-16 lg:flex-row lg:items-center lg:justify-between lg:px-10 lg:py-20">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">A sua clínica ou seguradora quer aparecer aqui?</h2>
            <p className="mt-2 text-lg text-muted">Peça acesso ao portal e ligue-se às famílias.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <ButtonLink to={paths.requestAccess('clinica')} size="lg">
              Sou uma clínica
            </ButtonLink>
            <ButtonLink to={paths.requestAccess('seguradora')} variant="secondary" size="lg">
              Sou uma seguradora
            </ButtonLink>
          </div>
        </div>
      </section>
    </>
  )
}
