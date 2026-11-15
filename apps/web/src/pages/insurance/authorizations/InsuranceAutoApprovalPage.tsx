import { useEffect, useState } from 'react'
import { Pencil, Plus, Trash2, WandSparkles } from 'lucide-react'
import { FormModal } from '@/components/insurer/FormModal'
import { ModuleError } from '@/components/insurer/PagedView'
import { PageHeader } from '@/components/insurer/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { EmptyState, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useInsuranceAuth } from '@/contexts/InsuranceAuthContext'
import { errorMessage } from '@/lib/errors'
import { formatMoney, parseAmount } from '@/lib/insurerFormat'
import { insurerAuthorizationsService } from '@/services/insurerAuthorizations.service'
import { insurerOpsService } from '@/services/insurerOps.service'
import type { AutoApprovalRule, InsurerServiceKind } from '@/types/insurerAuthorizations'
import type { InsurerService } from '@/types/insurerOps'

type Scope = 'SERVICE' | 'SERVICE_KIND'

function RuleForm({ rule, onClose, onDone, currency }: { rule?: AutoApprovalRule; onClose: () => void; onDone: () => void; currency: string }) {
  const toast = useToast()
  const [name, setName] = useState(rule?.name ?? '')
  const [scope, setScope] = useState<Scope>('SERVICE')
  const [target, setTarget] = useState('')
  const [amount, setAmount] = useState(rule ? String(rule.maxAmount).replace('.', ',') : '')
  const [services, setServices] = useState<InsurerService[]>([])
  const [kinds, setKinds] = useState<InsurerServiceKind[]>([])

  useEffect(() => {
    if (rule) return
    let active = true
    void Promise.all([insurerOpsService.listServices({ status: 'ACTIVE', limit: 100 }), insurerAuthorizationsService.listServiceKinds()]).then(([page, list]) => {
      if (!active) return
      setServices(page.items)
      setKinds(list)
    })
    return () => {
      active = false
    }
  }, [rule])

  async function submit() {
    if (!name.trim()) return 'Dê um nome à regra.'
    const max = parseAmount(amount)
    if (max === null) return `Indique o valor máximo em ${currency} (maior que zero).`
    if (rule) {
      await insurerAuthorizationsService.updateRule(rule.id, { name: name.trim(), maxAmount: max })
      toast.show('Regra atualizada.')
      return undefined
    }
    if (!target) return scope === 'SERVICE' ? 'Escolha o serviço.' : 'Escolha o tipo de serviço.'
    await insurerAuthorizationsService.createRule({ name: name.trim(), maxAmount: max, ...(scope === 'SERVICE' ? { serviceId: target } : { serviceKindId: target }) })
    toast.show('Regra criada.')
    return undefined
  }

  return (
    <FormModal
      title={rule ? 'Editar regra' : 'Nova regra de aprovação automática'}
      description={rule ? 'O serviço ou tipo de serviço não se altera: apague a regra e crie outra.' : 'Aplica-se só a pedidos novos. Fica ativa assim que a criar.'}
      submitLabel={rule ? 'Guardar' : 'Criar regra'}
      onClose={onClose}
      onSubmit={submit}
      onDone={onDone}
      errorMessages={{ CONFLICT: 'Já existe uma regra ativa para este serviço ou tipo de serviço.', LIMIT_EXCEEDED: 'Atingiu o máximo de 100 regras.' }}
    >
      <Input label="Nome da regra" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
      {!rule && (
        <>
          <Select
            label="Aplica-se a"
            value={scope}
            onChange={(e) => {
              setScope(e.target.value as Scope)
              setTarget('')
            }}
            options={[
              { value: 'SERVICE', label: 'Um serviço' },
              { value: 'SERVICE_KIND', label: 'Um tipo de serviço' },
            ]}
            hint="A regra de um serviço tem prioridade sobre a do seu tipo de serviço."
          />
          <Select
            label={scope === 'SERVICE' ? 'Serviço' : 'Tipo de serviço'}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="Escolher…"
            options={scope === 'SERVICE' ? services.map((s) => ({ value: s.id, label: `${s.name} (${s.code})` })) : kinds.map((k) => ({ value: k.id, label: k.name }))}
          />
        </>
      )}
      <Input label={`Valor máximo (${currency})`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} hint="Pedidos até este valor são aprovados sem esperar por um analista." />
    </FormModal>
  )
}

/**
 * Regras de aprovação automática (BR-AUT-23): o Supervisor define, por serviço ou tipo de serviço, o valor até ao qual um pedido é aprovado
 * sem esperar por um analista. É a seguradora que decide (o Vita só executa as regras). Carência e limite esgotado nunca se aprovam sozinhos.
 */
export function InsuranceAutoApprovalPage() {
  const { isSupervisor, currency } = useInsuranceAuth()
  const toast = useToast()
  const [rules, setRules] = useState<AutoApprovalRule[] | null>(null)
  const [failed, setFailed] = useState<unknown>(null)
  const [version, setVersion] = useState(0)
  const [form, setForm] = useState<{ rule?: AutoApprovalRule } | null>(null)
  const [removing, setRemoving] = useState<AutoApprovalRule | null>(null)

  useEffect(() => {
    let active = true
    insurerAuthorizationsService.listRules().then(
      (list) => active && setRules(list),
      (error: unknown) => active && setFailed(error),
    )
    return () => {
      active = false
    }
  }, [version])
  const reload = () => setVersion((n) => n + 1)

  async function toggle(rule: AutoApprovalRule) {
    try {
      await insurerAuthorizationsService.updateRule(rule.id, { active: !rule.active })
      toast.show(rule.active ? 'Regra desligada.' : 'Regra ligada.')
    } catch (error) {
      toast.show(errorMessage(error) || 'Não foi possível alterar a regra.', 'error')
    }
    reload()
  }

  async function remove(rule: AutoApprovalRule) {
    try {
      await insurerAuthorizationsService.deleteRule(rule.id)
      toast.show('Regra apagada.')
    } catch (error) {
      toast.show(errorMessage(error), 'error')
    }
    setRemoving(null)
    reload()
  }

  return (
    <>
      <PageHeader
        title="Aprovação automática"
        description="Pedidos que cumprem uma destas regras são aprovados logo, sem esperar por um analista. Os pedidos em carência ou com o limite esgotado vão sempre para uma pessoa."
        action={
          isSupervisor && (
            <Button size="sm" onClick={() => setForm({})} icon={<Plus className="size-4" aria-hidden />}>
              Nova regra
            </Button>
          )
        }
      />
      {failed ? (
        <ModuleError error={failed} onRetry={() => { setFailed(null); reload() }} />
      ) : !rules ? (
        <LoadingState rows={3} />
      ) : rules.length === 0 ? (
        <EmptyState icon={WandSparkles} title="Sem regras." description="Sem regras ligadas, todos os pedidos vão para um analista." />
      ) : (
        <Card className="divide-y divide-border py-1">
          {rules.map((rule) => (
            <div key={rule.id} className="flex flex-wrap items-center gap-2 py-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{rule.name}</span>
                <span className="block text-sm text-muted">
                  {rule.scope === 'SERVICE' ? 'Serviço' : 'Tipo de serviço'}: {rule.targetName} · até {formatMoney(rule.maxAmount, rule.currency)}
                </span>
              </span>
              <Badge tone={rule.active ? 'success' : 'neutral'} dot>
                {rule.active ? 'Ligada' : 'Desligada'}
              </Badge>
              {isSupervisor && (
                <>
                  <Button size="sm" variant="ghost" onClick={() => void toggle(rule)}>
                    {rule.active ? 'Desligar' : 'Ligar'} <span className="sr-only">{rule.name}</span>
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setForm({ rule })} icon={<Pencil className="size-4" aria-hidden />}>
                    Editar <span className="sr-only">{rule.name}</span>
                  </Button>
                  <Button size="sm" variant="danger-ghost" onClick={() => setRemoving(rule)} icon={<Trash2 className="size-4" aria-hidden />}>
                    Apagar <span className="sr-only">{rule.name}</span>
                  </Button>
                </>
              )}
            </div>
          ))}
        </Card>
      )}
      {!isSupervisor && rules && rules.length > 0 && <p className="text-sm text-muted">Só o supervisor altera as regras.</p>}
      {form && <RuleForm rule={form.rule} currency={currency} onClose={() => setForm(null)} onDone={() => { setForm(null); reload() }} />}
      <ConfirmDialog
        open={removing !== null}
        title="Apagar regra?"
        description="Os pedidos já decididos não mudam. Daqui em diante, os pedidos deste serviço vão para um analista."
        confirmLabel="Apagar regra"
        destructive
        onCancel={() => setRemoving(null)}
        onConfirm={() => removing && void remove(removing)}
      />
    </>
  )
}
