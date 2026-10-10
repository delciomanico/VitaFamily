import { useState } from 'react'
import { Lock } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Checkbox } from '@/components/ui/Checkbox'
import { DetailSection } from '@/components/ui/InfoList'
import { Select } from '@/components/ui/Select'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { firstName } from '@/lib/date'
import { errorMessage } from '@/lib/errors'
import { sharingCategoryLabels } from '@/lib/labels'
import { familyService } from '@/services/family.service'
import { sharingService } from '@/services/sharing.service'
import type { SharingRule, SharingSettings } from '@/types/settings'
import { SHARING_CATEGORIES, type SharingCategory } from '@/types/sharing'
import { SettingsSubPage } from './SettingsPage'

type Audience = 'NONE' | 'ALL' | 'SOME'

interface CategoryChoice {
  audience: Audience
  people: string[]
}

const NOBODY = { value: 'NONE', label: 'Ninguém' }
const EVERYONE = { value: 'ALL', label: 'Toda a família' }
const CHOSEN = { value: 'SOME', label: 'Pessoas escolhidas' }

function choicesFrom(grants: SharingRule[]): Record<SharingCategory, CategoryChoice> {
  const entries = SHARING_CATEGORIES.map((category): [SharingCategory, CategoryChoice] => {
    const rules = grants.filter((g) => g.category === category)
    if (rules.some((g) => !g.granteeMemberId)) return [category, { audience: 'ALL', people: [] }]
    const people = rules.flatMap((g) => (g.granteeMemberId ? [g.granteeMemberId] : []))
    return [category, { audience: people.length > 0 ? 'SOME' : 'NONE', people }]
  })
  return Object.fromEntries(entries) as Record<SharingCategory, CategoryChoice>
}

function rulesFrom(choices: Record<SharingCategory, CategoryChoice>): SharingRule[] {
  return SHARING_CATEGORIES.flatMap((category): SharingRule[] => {
    const { audience, people } = choices[category]
    if (audience === 'ALL') return [{ category }]
    if (audience === 'SOME') return people.map((granteeMemberId) => ({ category, granteeMemberId }))
    return []
  })
}

function SharingForm({ settings, onSaved }: { settings: SharingSettings; onSaved: () => void }) {
  const { user, family } = useAuth()
  const toast = useToast()
  const [choices, setChoices] = useState(() => choicesFrom(settings.grants))
  const [saving, setSaving] = useState(false)

  const update = (category: SharingCategory, change: Partial<CategoryChoice>) =>
    setChoices((current) => ({ ...current, [category]: { ...current[category], ...change } }))

  const togglePerson = (category: SharingCategory, id: string, on: boolean) => {
    const people = choices[category].people
    update(category, { people: on ? [...people, id] : people.filter((p) => p !== id) })
  }

  async function save() {
    const incomplete = SHARING_CATEGORIES.some((c) => choices[c].audience === 'SOME' && choices[c].people.length === 0)
    if (incomplete) {
      toast.show('Escolha pelo menos uma pessoa, ou “Ninguém”.', 'error')
      return
    }
    setSaving(true)
    try {
      await sharingService.putSharing(family?.id ?? '', user?.id ?? '', settings.member.id, rulesFrom(choices))
      toast.show('Partilha guardada.')
      onSaved()
    } catch (error) {
      toast.show(errorMessage(error), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Card className="divide-y divide-border py-1">
        {SHARING_CATEGORIES.map((category) => (
          <div key={category} className="flex flex-col gap-3 py-4">
            <Select
              label={sharingCategoryLabels[category]}
              options={settings.others.length > 0 ? [NOBODY, EVERYONE, CHOSEN] : [NOBODY, EVERYONE]}
              value={choices[category].audience}
              onChange={(event) => update(category, { audience: event.target.value as Audience })}
            />
            {choices[category].audience === 'SOME' && (
              <fieldset className="flex flex-col gap-2">
                <legend className="sr-only">Pessoas que podem ver {sharingCategoryLabels[category]}</legend>
                {settings.others.map((other) => (
                  <Checkbox
                    key={other.id}
                    label={other.name}
                    checked={choices[category].people.includes(other.id)}
                    onChange={(event) => togglePerson(category, other.id, event.target.checked)}
                  />
                ))}
              </fieldset>
            )}
          </div>
        ))}
      </Card>
      {settings.others.length === 0 && (
        <p className="text-sm text-muted">
          Ainda não há outros adultos com conta na família: ninguém além dos tutores entra na app para ver.
        </p>
      )}
      <p className="text-sm text-muted">
        Quem vê só lê, não altera. Nome e data de nascimento são sempre visíveis à família. Retirar a partilha tem
        efeito imediato.
      </p>
      <Button size="lg" fullWidth loading={saving} onClick={save}>
        Guardar partilha
      </Button>
    </>
  )
}

/** O que os outros partilham consigo (UC-PRV-02). */
function SharedWithMe() {
  const { user, family } = useAuth()
  const familyId = family?.id ?? ''
  const userId = user?.id ?? ''
  const { state } = useAsync(() => sharingService.sharedWithMe(familyId, userId), [familyId, userId])
  if (state.status !== 'success') return null

  return (
    <DetailSection title="Partilhado consigo">
      {state.data.length > 0 ? (
        <Card className="divide-y divide-border py-1">
          {state.data.map((item) => (
            <div key={item.memberId} className="flex flex-col gap-0.5 py-3">
              <span className="font-medium">{item.memberName}</span>
              <span className="text-sm text-muted">
                {item.categories.map((c) => sharingCategoryLabels[c]).join(' · ')}
              </span>
            </div>
          ))}
        </Card>
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Lock className="size-4" aria-hidden />
          Nenhum adulto da família partilha dados consigo.
        </p>
      )}
    </DetailSection>
  )
}

/** Permissões (UC-PRV-01/02): o titular ou o tutor decide quem lê cada categoria. */
export function SharingSettingsPage() {
  const { user, family, member: self } = useAuth()
  const familyId = family?.id ?? ''
  const userId = user?.id ?? ''
  const [memberId, setMemberId] = useState(self?.id ?? '')
  const managed = useAsync(() => familyService.listManagedMembers(familyId, userId), [familyId, userId])
  const { state, reload } = useAsync(
    () => sharingService.getSharing(familyId, userId, memberId),
    [familyId, userId, memberId],
  )

  const options =
    managed.state.status === 'success'
      ? managed.state.data.map((m) => ({ value: m.id, label: m.id === self?.id ? `${m.name} (eu)` : m.name }))
      : []

  return (
    <SettingsSubPage title="Permissões">
      <DetailSection
        title={
          memberId === self?.id
            ? 'O que partilha'
            : `O que ${firstName(state.status === 'success' ? state.data.member.name : '')} partilha`
        }
      >
        {options.length > 1 && (
          <Select
            label="Dados de"
            hint="Pelos seus dependentes decide o tutor."
            options={options}
            value={memberId}
            onChange={(event) => setMemberId(event.target.value)}
          />
        )}
        {state.status === 'loading' && <LoadingState rows={3} />}
        {state.status === 'error' && <ErrorState onRetry={reload} />}
        {state.status === 'success' && <SharingForm key={memberId} settings={state.data} onSaved={reload} />}
      </DetailSection>
      <SharedWithMe />
    </SettingsSubPage>
  )
}
