import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Trash2, Users } from 'lucide-react'
import { AddMemberForm } from '@/components/domain/AddMemberForm'
import { MemberListItem } from '@/components/domain/MemberListItem'
import { PageHeader } from '@/components/layout/PageHeader'
import { SetupProgress } from '@/components/layout/SetupProgress'
import { Button } from '@/components/ui/Button'
import { Card, Section } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { errorMessage } from '@/lib/errors'
import { paths } from '@/routes/paths'
import { familyService, type NewMemberInput } from '@/services/family.service'
import type { FamilyMember } from '@/types/family'
import { SETUP_STEPS } from './steps'

export function SetupMembersPage() {
  const { user, family } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const familyId = family?.id ?? ''
  const userId = user?.id ?? ''
  const { state, reload } = useAsync(() => familyService.listMembers(familyId), [familyId])
  const [toRemove, setToRemove] = useState<FamilyMember | null>(null)
  const [removing, setRemoving] = useState(false)

  async function onAdd(input: NewMemberInput) {
    try {
      await familyService.addMember(familyId, userId, input)
      toast.show('Membro adicionado.')
      reload()
      return true
    } catch (error) {
      toast.show(errorMessage(error), 'error')
      return false
    }
  }

  async function confirmRemove() {
    if (!toRemove) return
    setRemoving(true)
    try {
      await familyService.removeMember(familyId, userId, toRemove.id)
      toast.show('Membro removido.')
      reload()
    } catch (error) {
      toast.show(errorMessage(error), 'error')
    } finally {
      setRemoving(false)
      setToRemove(null)
    }
  }

  // O próprio utilizador já está na família; aqui listam-se os outros.
  const added = state.status === 'success' ? state.data.filter((m) => m.userId !== userId) : []

  return (
    <div className="flex flex-col gap-8">
      <SetupProgress step={3} total={SETUP_STEPS.create} />
      <PageHeader title="Adicionar membros" description="Quem mais quer acompanhar no Vita Family?" />

      <AddMemberForm onAdd={onAdd} />

      <Section title="Membros adicionados">
        {state.status === 'loading' && <LoadingState rows={2} />}
        {state.status === 'error' && <ErrorState onRetry={reload} />}
        {state.status === 'success' &&
          (added.length === 0 ? (
            <EmptyState icon={Users} title="Ainda não adicionou membros." description="Pode fazê-lo agora ou mais tarde." />
          ) : (
            <Card className="divide-y divide-border py-0">
              {added.map((member) => (
                <MemberListItem
                  key={member.id}
                  member={member}
                  action={
                    <Button variant="ghost" size="sm" onClick={() => setToRemove(member)} aria-label={`Remover ${member.name}`}>
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  }
                />
              ))}
            </Card>
          ))}
      </Section>

      <Button size="lg" fullWidth onClick={() => navigate(paths.home)}>
        {added.length > 0 ? 'Concluir' : 'Pular por agora'}
      </Button>

      <ConfirmDialog
        open={toRemove !== null}
        title="Remover membro?"
        description={toRemove ? `${toRemove.name} deixa de fazer parte da família.` : undefined}
        confirmLabel="Remover"
        destructive
        loading={removing}
        onConfirm={confirmRemove}
        onCancel={() => setToRemove(null)}
      />
    </div>
  )
}
