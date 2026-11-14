import { useState } from 'react'
import { Building2, Plus } from 'lucide-react'
import { FormModal } from '@/components/insurer/FormModal'
import { PageHeader } from '@/components/insurer/PageHeader'
import { PagedView } from '@/components/insurer/PagedView'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { EmptyState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { usePagedList } from '@/hooks/usePagedList'
import { errorMessage } from '@/lib/errors'
import { insurerOpsService } from '@/services/insurerOps.service'
import type { InsurerCompany } from '@/types/insurerOps'

function CompanyForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('')
  const [taxId, setTaxId] = useState('')
  const toast = useToast()

  async function submit() {
    if (!name.trim()) return 'Indique o nome da empresa.'
    if (!taxId.trim()) return 'Indique o NIF.'
    await insurerOpsService.createCompany({ name: name.trim(), taxId: taxId.trim() })
    toast.show('Empresa criada.')
    return undefined
  }

  return (
    <FormModal
      title="Nova empresa"
      description="Empresa cliente da seguradora. O NIF é único e não se altera depois."
      submitLabel="Criar empresa"
      onClose={onClose}
      onSubmit={submit}
      onDone={onDone}
      errorMessages={{ CONFLICT: 'Já existe uma empresa com este NIF.' }}
    >
      <Input label="Nome" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
      <Input label="NIF" value={taxId} maxLength={40} inputMode="numeric" onChange={(e) => setTaxId(e.target.value)} />
    </FormModal>
  )
}

/** Empresas clientes da seguradora (UC-SEG-01): criar, renomear e inativar. */
export function InsuranceCompaniesPage() {
  const toast = useToast()
  const list = usePagedList((cursor) => insurerOpsService.listCompanies({ cursor }), [])
  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState<InsurerCompany | null>(null)

  async function toggle(company: InsurerCompany) {
    try {
      await insurerOpsService.updateCompany(company.id, { status: company.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' })
      toast.show(company.status === 'ACTIVE' ? 'Empresa inativada.' : 'Empresa reativada.')
    } catch (error) {
      toast.show(errorMessage(error), 'error')
    }
    list.reload()
  }

  return (
    <>
      <PageHeader
        title="Empresas"
        description="Empresas clientes, para agrupar beneficiários e apólices."
        action={
          <Button size="sm" onClick={() => setCreating(true)} icon={<Plus className="size-4" aria-hidden />}>
            Nova empresa
          </Button>
        }
      />
      <PagedView
        list={list}
        empty={<EmptyState icon={Building2} title="Sem empresas." description="As empresas são opcionais: pode ter beneficiários individuais." />}
      >
        {(items) => (
          <Card className="divide-y divide-border py-1">
            {items.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center gap-2 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{c.name}</span>
                  <span className="block text-sm text-muted">NIF {c.taxId}</span>
                </span>
                <Badge tone={c.status === 'ACTIVE' ? 'success' : 'neutral'} dot>
                  {c.status === 'ACTIVE' ? 'Ativa' : 'Inativa'}
                </Badge>
                <Button size="sm" variant="ghost" onClick={() => setRenaming(c)}>
                  Renomear <span className="sr-only">{c.name}</span>
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void toggle(c)}>
                  {c.status === 'ACTIVE' ? 'Inativar' : 'Reativar'} <span className="sr-only">{c.name}</span>
                </Button>
              </div>
            ))}
          </Card>
        )}
      </PagedView>
      {creating && (
        <CompanyForm
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false)
            list.reload()
          }}
        />
      )}
      {renaming && (
        <RenameForm
          company={renaming}
          onClose={() => setRenaming(null)}
          onDone={() => {
            setRenaming(null)
            list.reload()
          }}
        />
      )}
    </>
  )
}

function RenameForm({ company, onClose, onDone }: { company: InsurerCompany; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(company.name)
  const toast = useToast()
  return (
    <FormModal
      title="Renomear empresa"
      submitLabel="Guardar"
      onClose={onClose}
      onDone={onDone}
      onSubmit={async () => {
        if (!name.trim()) return 'Indique o nome da empresa.'
        await insurerOpsService.updateCompany(company.id, { name: name.trim() })
        toast.show('Empresa atualizada.')
        return undefined
      }}
    >
      <Input label="Nome" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
    </FormModal>
  )
}
