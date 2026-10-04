import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, Lock, UserPlus, Users } from 'lucide-react'
import { AddMemberForm } from '@/components/domain/AddMemberForm'
import { Page } from '@/components/layout/Page'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Modal } from '@/components/ui/Modal'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { ageOn } from '@/lib/date'
import { errorMessage } from '@/lib/errors'
import { formatAge, formatCount } from '@/lib/format'
import { relationshipLabels, roleLabels } from '@/lib/labels'
import { paths } from '@/routes/paths'
import { familyService, type NewMemberInput } from '@/services/family.service'
import type { FamilyMemberCard, MemberTracking } from '@/types/family'

/** Estado de acompanhamento: pendentes de quem gere, ou o que o membro partilha consigo. */
function TrackingBadge({ tracking }: { tracking: MemberTracking }) {
  switch (tracking.kind) {
    case 'UP_TO_DATE':
      return (
        <Badge tone="success" dot>
          Em dia
        </Badge>
      )
    case 'PENDING':
      return (
        <Badge tone="warning" dot>
          {formatCount(tracking.count, 'pendente', 'pendentes')}
        </Badge>
      )
    case 'SHARED':
      return (
        <Badge tone="neutral">
          <Lock className="size-3" aria-hidden />
          {tracking.categories.length > 0
            ? `Partilha ${formatCount(tracking.categories.length, 'categoria', 'categorias')}`
            : 'Não partilha dados'}
        </Badge>
      )
  }
}

/** Nome, idade, relação e estado de acompanhamento de cada membro. */
function MemberRow({ card }: { card: FamilyMemberCard }) {
  const { member, isSelf, tracking } = card
  const details = [
    member.relationship && member.relationship !== 'SELF' ? relationshipLabels[member.relationship] : null,
    formatAge(ageOn(member.birthDate)),
    member.role === 'FAMILY_ADMIN' ? roleLabels.FAMILY_ADMIN : null,
  ]
  return (
    <Link
      to={paths.familyMember(member.id)}
      className="-mx-2 flex items-center gap-3 rounded-md px-2 py-3 transition-colors hover:bg-surface-muted"
    >
      <Avatar name={member.name} size="lg" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-medium">
          {member.name}
          {isSelf && <span className="font-normal text-muted"> (eu)</span>}
        </span>
        <span className="truncate text-sm text-muted">{details.filter(Boolean).join(' · ')}</span>
        <span className="mt-0.5">
          <TrackingBadge tracking={tracking} />
        </span>
      </span>
      <ChevronRight className="size-5 shrink-0 text-muted" aria-hidden />
    </Link>
  )
}

/** Minha família (UC-FAM-05): membros em lista e, para o Admin, “Adicionar membro”. */
export function FamilyPage() {
  const { user, family } = useAuth()
  const toast = useToast()
  const familyId = family?.id ?? ''
  const userId = user?.id ?? ''
  const { state, reload } = useAsync(() => familyService.getFamilyOverview(familyId, userId), [familyId, userId])
  const [adding, setAdding] = useState(false)

  async function onAdd(input: NewMemberInput) {
    try {
      await familyService.addMember(familyId, userId, input)
      toast.show('Membro adicionado.')
      setAdding(false)
      reload()
      return true
    } catch (error) {
      toast.show(errorMessage(error), 'error')
      return false
    }
  }

  const addButton = state.status === 'success' && state.data.isAdmin && (
    <Button size="sm" onClick={() => setAdding(true)} icon={<UserPlus className="size-4" aria-hidden />}>
      Adicionar membro
    </Button>
  )

  return (
    <Page title="Minha família" action={addButton}>
      {state.status === 'loading' && <LoadingState rows={4} />}
      {state.status === 'error' && <ErrorState onRetry={reload} />}
      {state.status === 'success' && (
        <>
          <div className="flex flex-col gap-0.5">
            <h2 className="text-xl font-semibold">{state.data.family.name}</h2>
            <p className="text-muted">{formatCount(state.data.members.length, 'membro', 'membros')}</p>
          </div>
          {state.data.members.length > 0 ? (
            <Card className="divide-y divide-border py-1">
              {state.data.members.map((card) => (
                <MemberRow key={card.member.id} card={card} />
              ))}
            </Card>
          ) : (
            <EmptyState icon={Users} title="Ainda não há membros." />
          )}
          <p className="text-sm text-muted">
            De cada adulto só vê o que ele partilha consigo; dos dependentes de quem é tutor vê tudo.
          </p>
        </>
      )}

      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title="Adicionar membro"
        description="Perfil sem conta (ex.: filhos), de quem fica tutor."
      >
        <AddMemberForm onAdd={onAdd} />
      </Modal>
    </Page>
  )
}
