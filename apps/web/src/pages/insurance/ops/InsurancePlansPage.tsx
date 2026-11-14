import { useState } from 'react'
import { ClipboardCheck, Plus } from 'lucide-react'
import { FormModal } from '@/components/insurer/FormModal'
import { PageHeader } from '@/components/insurer/PageHeader'
import { PagedView } from '@/components/insurer/PagedView'
import { Badge, type Tone } from '@/components/ui/Badge'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { EmptyState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useInsuranceAuth } from '@/contexts/InsuranceAuthContext'
import { usePagedList } from '@/hooks/usePagedList'
import { errorMessage, isAppError } from '@/lib/errors'
import { withFallback } from '@/lib/safe'
import { paths } from '@/routes/paths'
import { insurerOpsService } from '@/services/insurerOps.service'
import { planStatusLabel, type InsurerPlan, type PlanStatus } from '@/types/insurerOps'

export const planTone = withFallback<PlanStatus, Tone>({ DRAFT: 'warning', ACTIVE: 'success', ARCHIVED: 'neutral' }, () => 'neutral')
export const planText = withFallback(planStatusLabel, (key) => key)

function PlanForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('')
  const toast = useToast()
  return (
    <FormModal
      title="Novo plano"
      description="Nasce como rascunho (versão 1). Defina as coberturas e depois ative-o."
      submitLabel="Criar plano"
      onClose={onClose}
      onDone={onDone}
      errorMessages={{ CONFLICT: 'Já existe um plano com este nome.' }}
      onSubmit={async () => {
        if (!name.trim()) return 'Indique o nome do plano.'
        await insurerOpsService.createPlan(name)
        toast.show('Plano criado.')
        return undefined
      }}
    >
      <Input label="Nome do plano" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
    </FormModal>
  )
}

/** Planos e versões (UC-SEG-04, BR-SEG-01): só o Admin cria, ativa, arquiva e cria versões; o Gestor lê. */
export function InsurancePlansPage() {
  const { isAdmin } = useInsuranceAuth()
  const toast = useToast()
  const list = usePagedList((cursor) => insurerOpsService.listPlans({ cursor }), [])
  const [creating, setCreating] = useState(false)

  async function newVersion(plan: InsurerPlan) {
    try {
      const created = await insurerOpsService.newPlanVersion(plan.id)
      toast.show(`Versão ${created.version} de ${created.name} criada como rascunho.`)
    } catch (error) {
      toast.show(
        isAppError(error, 'CONFLICT') ? 'Já existe uma versão em rascunho deste plano, ou o plano não está ativo.' : errorMessage(error),
        'error',
      )
    }
    list.reload()
  }

  return (
    <>
      <PageHeader
        title="Planos"
        description="Cada plano tem versões. Um plano com apólices ativas é imutável: para alterar cria-se uma nova versão."
        action={
          isAdmin && (
            <Button size="sm" onClick={() => setCreating(true)} icon={<Plus className="size-4" aria-hidden />}>
              Novo plano
            </Button>
          )
        }
      />
      <PagedView list={list} empty={<EmptyState icon={ClipboardCheck} title="Sem planos." description={isAdmin ? 'Crie o primeiro plano e defina as suas coberturas.' : undefined} />}>
        {(items) => (
          <Card className="divide-y divide-border py-1">
            {items.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-2 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {p.name} <span className="text-muted">· versão {p.version}</span>
                  </span>
                  <span className="block text-sm text-muted">
                    {p.coverageCount === 1 ? '1 cobertura' : `${p.coverageCount} coberturas`}
                  </span>
                </span>
                <Badge tone={planTone[p.status]} dot>
                  {planText[p.status]}
                </Badge>
                <ButtonLink to={paths.insurancePlan(p.id)} size="sm" variant="ghost">
                  {isAdmin && p.status === 'DRAFT' ? 'Coberturas' : 'Ver'} <span className="sr-only">de {p.name} versão {p.version}</span>
                </ButtonLink>
                {isAdmin && p.status === 'ACTIVE' && (
                  <Button size="sm" variant="ghost" onClick={() => void newVersion(p)}>
                    Nova versão <span className="sr-only">de {p.name}</span>
                  </Button>
                )}
              </div>
            ))}
          </Card>
        )}
      </PagedView>
      {creating && (
        <PlanForm
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false)
            list.reload()
          }}
        />
      )}
    </>
  )
}
