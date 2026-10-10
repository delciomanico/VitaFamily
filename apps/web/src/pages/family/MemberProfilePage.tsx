import { useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { History, Lock } from 'lucide-react'
import { AppointmentList } from '@/components/domain/AppointmentList'
import { ExaminationList } from '@/components/domain/ExaminationList'
import { Locked } from '@/components/domain/Locked'
import { MedicationList } from '@/components/domain/MedicationList'
import { PrescriptionList } from '@/components/domain/PrescriptionList'
import { Page } from '@/components/layout/Page'
import { Avatar } from '@/components/ui/Avatar'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { ageOn, firstName } from '@/lib/date'
import { errorMessage, isAppError } from '@/lib/errors'
import { formatAge } from '@/lib/format'
import { bloodTypeLabel, relationshipLabels, roleLabels } from '@/lib/labels'
import { paths } from '@/routes/paths'
import { familyService } from '@/services/family.service'
import type { MemberProfile } from '@/types/member'
import type { SharingCategory } from '@/types/sharing'

function Tags({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) return <p className="text-sm text-muted">{empty}</p>
  return (
    <ul className="flex flex-wrap gap-2">
      {items.map((item) => (
        <li key={item} className="rounded-full bg-surface-muted px-3 py-1 text-sm">
          {item}
        </li>
      ))}
    </ul>
  )
}

interface BlockProps {
  title: string
  category: SharingCategory
  profile: MemberProfile
  /** Conteúdo quando há permissão (a secção vem preenchida). */
  visible: boolean
  children: ReactNode
}

/** Secção do perfil: conteúdo, ou cadeado se a categoria não está partilhada (BR-PRV-01). */
function Block({ title, category, profile, visible, children }: BlockProps) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-muted">{title}</h3>
      {visible ? children : <Locked category={category} ownerName={profile.member.name} />}
    </section>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  )
}

function ProfileContent({ profile, onRemove }: { profile: MemberProfile; onRemove: () => void }) {
  const { member, manage, isSelf } = profile
  const name = firstName(member.name)
  const details = [
    member.relationship && member.relationship !== 'SELF' ? relationshipLabels[member.relationship] : null,
    formatAge(ageOn(member.birthDate)),
    member.role ? roleLabels[member.role] : null,
  ]

  return (
    <>
      <div className="flex items-center gap-4">
        <Avatar name={member.name} size="xl" />
        <div className="min-w-0">
          <p className="truncate text-xl font-semibold">
            {member.name}
            {isSelf && <span className="font-normal text-muted"> (eu)</span>}
          </p>
          <p className="text-muted">{details.filter(Boolean).join(' · ')}</p>
          {profile.guardians.length > 0 && <p className="text-sm text-muted">Tutor: {profile.guardians.join(', ')}</p>}
        </div>
      </div>

      {!manage && (
        <p className="flex items-start gap-2.5 rounded-xl bg-surface-muted px-3.5 py-3 text-sm">
          <Lock className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
          <span>{name} tem conta própria e decide o que partilha. Vê apenas essas categorias, só para leitura.</span>
        </p>
      )}

      <Group title="Saúde">
        <Block title="Condições" category="CONDITIONS" profile={profile} visible={profile.conditions !== undefined}>
          <Card>
            <Tags items={profile.conditions ?? []} empty="Nenhuma condição registada." />
          </Card>
        </Block>
        <Block title="Alergias" category="ALLERGIES" profile={profile} visible={profile.allergies !== undefined}>
          <Card className="flex flex-col gap-3">
            <Tags items={profile.allergies ?? []} empty="Nenhuma alergia registada." />
            <p className="text-sm text-muted">
              Tipo sanguíneo:{' '}
              <span className="font-medium text-foreground">
                {profile.bloodType ? bloodTypeLabel(profile.bloodType) : 'Não indicado'}
              </span>
            </p>
          </Card>
        </Block>
        <Block title="Medicamentos" category="MEDICATION" profile={profile} visible={profile.medications !== undefined}>
          {profile.medications?.length ? (
            <MedicationList items={profile.medications} selfMemberId={member.id} linked={manage} />
          ) : (
            <p className="text-sm text-muted">Sem medicamentos ativos.</p>
          )}
        </Block>
      </Group>

      <Group title="Atividade">
        <Block title="Consultas" category="APPOINTMENTS" profile={profile} visible={profile.appointments !== undefined}>
          {profile.appointments?.length ? (
            <AppointmentList items={profile.appointments} selfMemberId={member.id} linked={manage} />
          ) : (
            <p className="text-sm text-muted">Sem consultas.</p>
          )}
        </Block>
        <Block title="Exames" category="EXAMS" profile={profile} visible={profile.examinations !== undefined}>
          {profile.examinations?.length ? (
            <ExaminationList items={profile.examinations} selfMemberId={member.id} linked={manage} />
          ) : (
            <p className="text-sm text-muted">Sem exames.</p>
          )}
        </Block>
        <Block title="Receitas" category="MEDICATION" profile={profile} visible={profile.prescriptions !== undefined}>
          {profile.prescriptions?.length ? (
            <PrescriptionList items={profile.prescriptions} selfMemberId={member.id} linked={manage} />
          ) : (
            <p className="text-sm text-muted">Sem receitas.</p>
          )}
        </Block>
      </Group>

      <div className="flex flex-col gap-2">
        <ButtonLink
          to={paths.familyMemberHistory(member.id)}
          variant="secondary"
          size="lg"
          icon={<History className="size-4" aria-hidden />}
        >
          Ver histórico completo
        </ButtonLink>
        {profile.canRemove && (
          <Button variant="danger-ghost" size="lg" onClick={onRemove}>
            Remover membro
          </Button>
        )}
      </div>
    </>
  )
}

/** Perfil do membro (UC-FAM-05, UC-PRV-02): saúde e atividade, respeitando a partilha. */
export function MemberProfilePage() {
  const { id = '' } = useParams()
  const { user, family } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const familyId = family?.id ?? ''
  const userId = user?.id ?? ''
  const { state, reload } = useAsync(() => familyService.getMemberProfile(familyId, userId, id), [familyId, userId, id])
  const [confirming, setConfirming] = useState(false)
  const [removing, setRemoving] = useState(false)

  async function remove() {
    setRemoving(true)
    try {
      await familyService.removeMember(familyId, userId, id)
      toast.show('Membro removido.')
      navigate(paths.family, { replace: true })
    } catch (error) {
      toast.show(errorMessage(error), 'error')
      setRemoving(false)
      setConfirming(false)
    }
  }

  const memberName = state.status === 'success' ? state.data.member.name : ''

  return (
    <Page title="Membro" backTo={paths.family} backLabel="Minha família">
      {state.status === 'loading' && <LoadingState rows={4} />}
      {state.status === 'error' &&
        (isAppError(state.error, 'NOT_FOUND') ? (
          <ErrorState message="Este membro não existe ou não pertence à sua família." />
        ) : (
          <ErrorState onRetry={reload} />
        ))}
      {state.status === 'success' && <ProfileContent profile={state.data} onRemove={() => setConfirming(true)} />}

      <ConfirmDialog
        open={confirming}
        title="Remover membro?"
        description={`O perfil de ${memberName} deixa de fazer parte da família. Esta ação não se pode desfazer.`}
        confirmLabel="Remover"
        destructive
        loading={removing}
        onConfirm={remove}
        onCancel={() => setConfirming(false)}
      />
    </Page>
  )
}
