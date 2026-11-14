import { useState, type FormEvent } from 'react'
import { ClipboardList, Pencil, Plus, Search } from 'lucide-react'
import { FormModal } from '@/components/insurer/FormModal'
import { PageHeader } from '@/components/insurer/PageHeader'
import { PagedView } from '@/components/insurer/PagedView'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { EmptyState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useInsuranceAuth } from '@/contexts/InsuranceAuthContext'
import { usePagedList } from '@/hooks/usePagedList'
import { errorMessage } from '@/lib/errors'
import { insurerOpsService } from '@/services/insurerOps.service'
import type { InsurerService } from '@/types/insurerOps'

function ServiceForm({ service, onClose, onDone }: { service?: InsurerService; onClose: () => void; onDone: () => void }) {
  const [code, setCode] = useState(service?.code ?? '')
  const [name, setName] = useState(service?.name ?? '')
  const [category, setCategory] = useState(service?.category ?? '')
  const toast = useToast()

  async function submit() {
    if (!name.trim()) return 'Indique o nome do serviço.'
    if (service) {
      await insurerOpsService.updateService(service.id, { name: name.trim(), category: category.trim() || null })
      toast.show('Serviço atualizado.')
    } else {
      if (!code.trim()) return 'Indique o código do serviço.'
      await insurerOpsService.createService({ code: code.trim(), name: name.trim(), ...(category.trim() ? { category: category.trim() } : {}) })
      toast.show('Serviço criado.')
    }
    return undefined
  }

  return (
    <FormModal
      title={service ? 'Editar serviço' : 'Novo serviço'}
      description={service ? 'O código não se altera.' : 'O código é único nesta seguradora.'}
      submitLabel={service ? 'Guardar' : 'Criar serviço'}
      onClose={onClose}
      onSubmit={submit}
      onDone={onDone}
      errorMessages={{ CONFLICT: 'Já existe um serviço com este código.' }}
    >
      {!service && <Input label="Código" value={code} maxLength={40} onChange={(e) => setCode(e.target.value)} />}
      <Input label="Nome" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
      <Input label="Categoria (opcional)" value={category} maxLength={80} onChange={(e) => setCategory(e.target.value)} />
    </FormModal>
  )
}

/**
 * Lista de serviços da seguradora (BR-SEG-22; sem catálogo comum). Todos os papéis do módulo leem;
 * só o Admin cria, edita e inativa.
 */
export function InsuranceServicesPage() {
  const { isAdmin } = useInsuranceAuth()
  const toast = useToast()
  const [q, setQ] = useState('')
  const [applied, setApplied] = useState('')
  const list = usePagedList((cursor) => insurerOpsService.listServices({ q: applied, cursor }), [applied])
  const [form, setForm] = useState<{ service?: InsurerService } | null>(null)

  function search(event: FormEvent) {
    event.preventDefault()
    setApplied(q.trim())
  }

  async function toggle(service: InsurerService) {
    try {
      await insurerOpsService.updateService(service.id, { status: service.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' })
      toast.show(service.status === 'ACTIVE' ? 'Serviço inativado.' : 'Serviço reativado.')
    } catch (error) {
      toast.show(errorMessage(error), 'error')
    }
    list.reload()
  }

  return (
    <>
      <PageHeader
        title="Serviços"
        description="Os serviços que os planos podem cobrir e que as clínicas ligadas veem."
        action={
          isAdmin && (
            <Button size="sm" onClick={() => setForm({})} icon={<Plus className="size-4" aria-hidden />}>
              Novo serviço
            </Button>
          )
        }
      />
      <form onSubmit={search} role="search" aria-label="Pesquisar serviços" className="flex items-end gap-2">
        <div className="flex-1">
          <Input label="Código ou nome" icon={Search} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Button type="submit" variant="secondary" className="mb-6">
          Pesquisar
        </Button>
      </form>
      <PagedView list={list} empty={<EmptyState icon={ClipboardList} title="Sem serviços." description={isAdmin ? 'Crie os serviços que os planos vão cobrir.' : 'O Admin da seguradora ainda não criou serviços.'} />}>
        {(items) => (
          <Card className="divide-y divide-border py-1">
            {items.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center gap-2 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{s.name}</span>
                  <span className="block text-sm text-muted">
                    {s.code}
                    {s.category ? ` · ${s.category}` : ''}
                  </span>
                </span>
                <Badge tone={s.status === 'ACTIVE' ? 'success' : 'neutral'} dot>
                  {s.status === 'ACTIVE' ? 'Ativo' : 'Inativo'}
                </Badge>
                {isAdmin && (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => setForm({ service: s })} icon={<Pencil className="size-4" aria-hidden />}>
                      Editar <span className="sr-only">{s.name}</span>
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void toggle(s)}>
                      {s.status === 'ACTIVE' ? 'Inativar' : 'Reativar'} <span className="sr-only">{s.name}</span>
                    </Button>
                  </>
                )}
              </div>
            ))}
          </Card>
        )}
      </PagedView>
      {form && (
        <ServiceForm
          service={form.service}
          onClose={() => setForm(null)}
          onDone={() => {
            setForm(null)
            list.reload()
          }}
        />
      )}
    </>
  )
}
