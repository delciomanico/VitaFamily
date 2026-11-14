import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Building2, Clock, Mail, MapPin, Phone, Search, ShieldCheck, Stethoscope } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { ButtonLink, Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { useAsync } from '@/hooks/useAsync'
import { usePageTitle } from '@/hooks/usePageTitle'
import { cn } from '@/lib/cn'
import { paths } from '@/routes/paths'
import { partnersService } from '@/services/partners.service'
import type { PartnerKind, PublicPartner } from '@/types/partner'

type KindFilter = 'ALL' | PartnerKind

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

function PartnerCard({ partner }: { partner: PublicPartner }) {
  const isClinic = partner.kind === 'CLINIC'
  const Icon = isClinic ? Stethoscope : ShieldCheck
  const specialties = partner.specialties ?? []
  return (
    <li className="flex flex-col gap-5 rounded-3xl border border-border bg-surface p-7 shadow-card transition-all duration-300 hover:-translate-y-1 hover:shadow-overlay">
      <div className="flex items-start gap-4">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-primary">
          <Icon className="size-7" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-xl font-bold">{partner.name}</h3>
          <Badge tone="primary" className="mt-1">
            {isClinic ? 'Clínica parceira' : 'Seguradora parceira'}
          </Badge>
        </div>
      </div>

      {partner.description && <p className="text-base text-muted">{partner.description}</p>}

      <ul className="flex flex-col gap-2 text-base">
        {(partner.address || partner.city) && (
          <li className="flex gap-3">
            <MapPin className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
            <span>{partner.address ?? partner.city}</span>
          </li>
        )}
        {partner.openingHours && (
          <li className="flex gap-3">
            <Clock className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
            <span>{partner.openingHours}</span>
          </li>
        )}
        {partner.phone && (
          <li className="flex gap-3">
            <Phone className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
            <a href={`tel:${partner.phone.replace(/\s/g, '')}`} className="font-medium text-primary hover:underline">
              {partner.phone}
            </a>
          </li>
        )}
        {partner.email && (
          <li className="flex gap-3">
            <Mail className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
            <a href={`mailto:${partner.email}`} className="min-w-0 font-medium break-words text-primary hover:underline">
              {partner.email}
            </a>
          </li>
        )}
      </ul>

      {specialties.length > 0 && (
        <ul aria-label="Especialidades" className="flex flex-wrap gap-2">
          {specialties.map((specialty) => (
            <li key={specialty} className="rounded-full bg-surface-muted px-3 py-1 text-sm font-medium">
              {specialty}
            </li>
          ))}
        </ul>
      )}

      {partner.insurers && partner.insurers.length > 0 && (
        <p className="text-sm text-muted">
          <span className="font-semibold text-foreground">Seguros ligados: </span>
          {partner.insurers.join(', ')}
        </p>
      )}
    </li>
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

  const { state, reload } = useAsync(() => partnersService.listPartners(), [])

  function update(next: Record<string, string>) {
    const merged = new URLSearchParams(params)
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
                <ul className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                  {results.map((partner) => (
                    <PartnerCard key={partner.id} partner={partner} />
                  ))}
                </ul>
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
