import { Outlet } from 'react-router-dom'
import { useState } from 'react'
import { CalendarOff, Clock, Plus } from 'lucide-react'
import { AccordionSection } from '@/components/app/Accordion'
import { ScreenHeader } from '@/components/app/ScreenHeader'
import { ConfirmSheet } from '@/components/app/Sheet'
import { LockedNotice } from '@/components/professional/LockedNotice'
import { Badge } from '@/components/ui/Badge'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { ErrorState, FormError, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAsync } from '@/hooks/useAsync'
import { useProfessionalProfile } from '@/hooks/useProfessionalProfile'
import { usePageTitle } from '@/hooks/usePageTitle'
import { todayISO } from '@/lib/date'
import { errorMessage } from '@/lib/errors'
import { formatLongDate, formatTimeLuanda, formatWhenLuanda, luandaDayISO } from '@/lib/format'
import { offerMethodLabel, weekdayLabel } from '@/lib/professional'
import { DEFAULT_RANGE_DAYS, addDays, generationMessage, luandaIso, ruleErrorMessage, sortedDays, validateRange, validityText } from '@/lib/schedule'
import { paths } from '@/routes/paths'
import { professionalPortalService } from '@/services/professionalPortal.service'
import type { ProfessionalScheduleRule, ProfessionalSlot, ProfessionalTimeOff, Specialty } from '@/types/professional'

/**
 * Horários do profissional (UC-MKT-09, BR-MKT-25): horários semanais por serviço, pausas/férias e horários livres gerados.
 * Todas as horas são de Luanda (Africa/Luanda, UTC+1). As regras só geram horários com o perfil APPROVED; noutros estados ficam guardadas.
 */

function RulesSection({ canEdit, approved, specialties, onChanged }: { canEdit: boolean; approved: boolean; specialties: Specialty[]; onChanged: () => void }) {
  const toast = useToast()
  const offers = useAsync(() => professionalPortalService.listOffers(true), [])
  const rules = useAsync(() => professionalPortalService.listScheduleRules(), [])
  const [busyId, setBusyId] = useState<string | null>(null)

  const specialtyName = (id: string) => specialties.find((s) => s.id === id)?.name ?? 'Serviço'
  const activeOffers = offers.state.status === 'success' ? offers.state.data : []
  const offerById = new Map(activeOffers.map((o) => [o.id, o]))
  // Serviço desativado não aparece na lista de ativos: a regra mostra-o em vez de falhar.
  const offerLabel = (offerId: string) => {
    const offer = offerById.get(offerId)
    return offer ? `${specialtyName(offer.specialtyId)} · ${offerMethodLabel[offer.method]} · ${offer.durationMinutes} min` : 'Serviço desativado'
  }

  async function toggle(rule: ProfessionalScheduleRule) {
    setBusyId(rule.id)
    try {
      const result = await professionalPortalService.updateScheduleRule(rule.id, { active: !rule.active })
      toast.show(rule.active ? 'Horário desativado.' : generationMessage(result.generation, approved))
      rules.reload()
      onChanged()
    } catch (error) {
      toast.show(ruleErrorMessage(error), 'error')
    } finally {
      setBusyId(null)
    }
  }

  const loading = offers.state.status === 'loading' || rules.state.status === 'loading'
  const loadError = offers.state.status === 'error' || rules.state.status === 'error'
  const list = rules.state.status === 'success' ? rules.state.data : []

  return (
    <section aria-labelledby="horarios-semanais" className="flex flex-col gap-3">
      <h2 id="horarios-semanais" className="text-xl font-semibold">
        Horários semanais
      </h2>
      {approved ? null : <p className="text-base text-muted">Enquanto o perfil não estiver aprovado, os horários ficam guardados e só passam a estar livres depois da aprovação.</p>}

      {loading && <LoadingState rows={2} />}
      {!loading && loadError && <ErrorState onRetry={() => { offers.reload(); rules.reload() }} />}

      {!loading && !loadError && activeOffers.length === 0 && (
        <div className="flex flex-col gap-3 rounded-2xl border border-dashed border-border-strong p-5 text-center">
          <p className="text-base">Para definir horários precisa de pelo menos um serviço ativo.</p>
          {canEdit && (
            <ButtonLink to={paths.professionalOfferNew} variant="soft" size="lg">
              Criar um serviço
            </ButtonLink>
          )}
        </div>
      )}

      {!loading && !loadError && activeOffers.length > 0 && canEdit && (
        <ButtonLink to={paths.professionalScheduleNew} size="xl" fullWidth icon={<Plus className="size-6" aria-hidden />}>
          Novo horário
        </ButtonLink>
      )}

      {!loading && !loadError && activeOffers.length > 0 && list.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border-strong px-6 py-8 text-center">
          <Clock className="size-10 text-muted" aria-hidden />
          <p className="text-lg font-semibold">Ainda não definiu horários</p>
          <p className="text-base text-muted">Escolha os dias e as horas em que atende, para cada serviço.</p>
        </div>
      )}

      {!loading && !loadError && list.length > 0 && (
        <ul className="flex flex-col gap-3">
          {list.map((rule) => {
            const busy = busyId === rule.id
            return (
              <li key={rule.id} className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4 shadow-card">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-col">
                    <p className="text-lg leading-6 font-semibold">{offerLabel(rule.offerId)}</p>
                    <p className="text-base text-muted">{sortedDays(rule.weekdays).map((d) => weekdayLabel[d]).join(', ')}</p>
                  </div>
                  <Badge tone={rule.active ? 'success' : 'neutral'} dot>
                    {rule.active ? 'Ativo' : 'Desativado'}
                  </Badge>
                </div>
                <p className="text-xl font-semibold">
                  {rule.startTime} – {rule.endTime}
                </p>
                <p className="text-base text-muted">{validityText(rule)}</p>
                {canEdit && (
                  <div className="flex flex-col gap-2">
                    <ButtonLink to={paths.professionalScheduleEdit(rule.id)} variant="secondary" size="lg" fullWidth>
                      Mudar
                    </ButtonLink>
                    <Button variant={rule.active ? 'danger-ghost' : 'soft'} size="lg" fullWidth loading={busy} onClick={() => void toggle(rule)}>
                      {rule.active ? 'Desativar' : 'Ativar'}
                    </Button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function TimeOffSection({ canEdit, onChanged }: { canEdit: boolean; onChanged: () => void }) {
  const toast = useToast()
  const timeOff = useAsync(() => professionalPortalService.listTimeOff(), [])
  const [toRemove, setToRemove] = useState<ProfessionalTimeOff | null>(null)
  const [removing, setRemoving] = useState(false)

  async function removeTimeOff() {
    if (!toRemove) return
    setRemoving(true)
    try {
      await professionalPortalService.deleteTimeOff(toRemove.id)
      toast.show('Pausa removida.')
      setToRemove(null)
      timeOff.reload()
      onChanged()
    } catch (error) {
      toast.show(errorMessage(error), 'error')
    } finally {
      setRemoving(false)
    }
  }

  const list = timeOff.state.status === 'success' ? timeOff.state.data : []
  return (
    <AccordionSection title="Pausas e férias" icon={CalendarOff} summary={timeOff.state.status === 'success' ? (list.length === 0 ? 'Sem pausas' : list.length === 1 ? '1 pausa marcada' : `${list.length} pausas marcadas`) : undefined}>
      <p className="text-base text-muted">Períodos em que não atende. Os horários livres desse intervalo são retirados.</p>
      {timeOff.state.status === 'loading' && <LoadingState rows={1} />}
      {timeOff.state.status === 'error' && <ErrorState onRetry={timeOff.reload} />}
      {timeOff.state.status === 'success' && list.length === 0 && <p className="text-base font-medium">Sem pausas marcadas.</p>}
      {list.length > 0 && (
        <ul className="flex flex-col gap-3">
          {list.map((item) => (
            <li key={item.id} className="flex flex-col gap-2 rounded-xl bg-surface-muted p-3">
              <p className="text-base font-medium">
                {formatWhenLuanda(item.startsAt)} – {formatWhenLuanda(item.endsAt)}
              </p>
              {item.reason && <p className="text-base break-words text-muted">{item.reason}</p>}
              {canEdit && (
                <Button variant="danger-ghost" size="lg" fullWidth onClick={() => setToRemove(item)}>
                  Remover pausa
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <ButtonLink to={paths.professionalTimeOffNew} variant="soft" size="lg" fullWidth icon={<Plus className="size-5" aria-hidden />}>
          Adicionar pausa
        </ButtonLink>
      )}
      <ConfirmSheet
        open={toRemove !== null}
        title="Remover esta pausa?"
        description="Os horários deste intervalo poderão voltar a ficar livres, se houver horários semanais ativos."
        yesLabel="Sim, remover"
        destructive
        loading={removing}
        onYes={() => void removeTimeOff()}
        onNo={() => setToRemove(null)}
      />
    </AccordionSection>
  )
}

/** Agrupa por dia (dia em Luanda) e ordena cronologicamente. */
function groupSlotsByDay(slots: ProfessionalSlot[]): Array<[string, ProfessionalSlot[]]> {
  const byDay = new Map<string, ProfessionalSlot[]>()
  const ordered = [...slots].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
  for (const slot of ordered) {
    const day = luandaDayISO(slot.startsAt)
    byDay.set(day, [...(byDay.get(day) ?? []), slot])
  }
  return [...byDay.entries()]
}

function SlotsSection({ version }: { version: number }) {
  const [range, setRange] = useState(() => {
    const today = todayISO()
    return { from: today, to: addDays(today, DEFAULT_RANGE_DAYS) }
  })
  const rangeError = validateRange(range.from, range.to)

  // Intervalo inválido não chega à API: a mensagem fica visível e a lista é ocultada.
  const slots = useAsync((): Promise<ProfessionalSlot[]> => {
    if (validateRange(range.from, range.to)) return Promise.resolve([])
    return professionalPortalService.listSlots(luandaIso(range.from, '00:00'), luandaIso(addDays(range.to, 1), '00:00'))
  }, [range.from, range.to, version])

  const groups = slots.state.status === 'success' ? groupSlotsByDay(slots.state.data) : []

  return (
    <AccordionSection title="Horários livres" icon={Clock} summary="O que as famílias podem marcar">
      <p className="text-base text-muted">Só existem com o perfil aprovado. Horas de Luanda.</p>
      <Input label="De" type="date" value={range.from} onChange={(event) => setRange((r) => ({ ...r, from: event.target.value }))} />
      <Input label="Até" type="date" value={range.to} onChange={(event) => setRange((r) => ({ ...r, to: event.target.value }))} />
      <FormError message={rangeError} />
      {!rangeError && slots.state.status === 'loading' && <LoadingState rows={2} />}
      {!rangeError && slots.state.status === 'error' && <ErrorState onRetry={slots.reload} />}
      {!rangeError && slots.state.status === 'success' && groups.length === 0 && <p className="text-base font-medium">Sem horários livres neste intervalo.</p>}
      {!rangeError && groups.length > 0 && (
        <div className="flex flex-col gap-4">
          {groups.map(([day, daySlots]) => (
            <div key={day} className="flex flex-col gap-2">
              <h3 className="text-base font-semibold capitalize">{formatLongDate(day)}</h3>
              <ul className="flex flex-wrap gap-2">
                {daySlots.map((slot) => (
                  <li key={slot.id}>
                    <Badge tone="primary" className="px-3 py-1.5 text-sm">
                      {formatTimeLuanda(slot.startsAt)}–{formatTimeLuanda(slot.endsAt)}
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </AccordionSection>
  )
}

export function ProfessionalSchedulePage() {
  usePageTitle('Os meus horários')
  const profile = useProfessionalProfile()
  // Incrementa quando regras ou pausas mudam, para a lista de horários livres se atualizar.
  const [slotsVersion, setSlotsVersion] = useState(0)
  const refreshSlots = () => setSlotsVersion((v) => v + 1)
  // Um formulário (horário, pausa) guardou: recarrega as listas.
  const [formsVersion, setFormsVersion] = useState(0)
  const onSaved = () => {
    setFormsVersion((v) => v + 1)
    refreshSlots()
  }

  const canEdit = profile.rights?.commercial === true
  const approved = profile.profile?.validationStatus === 'APPROVED'
  const specialties = profile.profile?.specialties ?? []

  return (
    <div className="flex flex-col gap-5">
      <ScreenHeader title="Os meus horários" backTo={paths.professionalProfile} backLabel="Perfil" subtitle="Quando atende. Horas de Luanda." />

      {profile.rights?.readOnly && <LockedNotice>Neste estado o perfil está só para ler. Não é possível mudar horários nem pausas.</LockedNotice>}

      {profile.state.status === 'loading' && <LoadingState rows={3} />}
      {profile.state.status === 'error' && <ErrorState onRetry={profile.reload} />}

      {profile.profile && (
        <>
          <RulesSection key={`rules-${formsVersion}`} canEdit={canEdit} approved={approved} specialties={specialties} onChanged={refreshSlots} />
          <div className="flex flex-col gap-3">
            <TimeOffSection key={`off-${formsVersion}`} canEdit={canEdit} onChanged={refreshSlots} />
            <SlotsSection version={slotsVersion} />
          </div>
        </>
      )}
      <Outlet context={{ onSaved }} />
    </div>
  )
}
