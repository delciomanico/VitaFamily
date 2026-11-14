import { useState, type FormEvent } from 'react'
import { Check, Copy, KeyRound, Pencil, Plus, Search, Users } from 'lucide-react'
import { FormModal } from '@/components/insurer/FormModal'
import { NoteModal } from '@/components/insurer/NoteModal'
import { PageHeader } from '@/components/insurer/PageHeader'
import { PagedView } from '@/components/insurer/PagedView'
import { HolderSelect } from '@/components/insurer/HolderSelect'
import { useCompanyOptions } from '@/components/insurer/useOptions'
import { Badge, type Tone } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { EmptyState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { usePagedList } from '@/hooks/usePagedList'
import { errorMessage } from '@/lib/errors'
import { formatShortDate } from '@/lib/format'
import { withFallback } from '@/lib/safe'
import { insurerOpsService } from '@/services/insurerOps.service'
import {
  beneficiaryStatusLabel,
  relationshipLabel,
  type BeneficiaryRelationship,
  type BeneficiaryStatus,
  type InsurerBeneficiary,
  type InsurerClaimCode,
} from '@/types/insurerOps'

const statusTone = withFallback<BeneficiaryStatus, Tone>(
  { PENDING: 'warning', ACTIVE: 'success', SUSPENDED: 'danger', CANCELLED: 'neutral' },
  () => 'neutral',
)
const statusText = withFallback(beneficiaryStatusLabel, (key) => key)
const relationshipText = withFallback(relationshipLabel, (key) => key)

const STATUS_FILTERS = [
  { value: 'PENDING', label: 'Pendente' },
  { value: 'ACTIVE', label: 'Ativo' },
  { value: 'SUSPENDED', label: 'Suspenso' },
  { value: 'CANCELLED', label: 'Cancelado' },
]
const RELATIONSHIPS: BeneficiaryRelationship[] = ['HOLDER', 'SPOUSE', 'CHILD', 'OTHER']
const DOCUMENT_TYPES = ['BI', 'Passaporte', 'Cartão de residente', 'Outro']

/** Ações de estado permitidas (ST Beneficiary, UC-SEG-02): ativar, suspender e cancelar (final). */
function allowedActions(status: BeneficiaryStatus): Array<'ACTIVE' | 'SUSPENDED' | 'CANCELLED'> {
  if (status === 'PENDING') return ['ACTIVE', 'CANCELLED']
  if (status === 'ACTIVE') return ['SUSPENDED', 'CANCELLED']
  if (status === 'SUSPENDED') return ['ACTIVE', 'CANCELLED']
  return []
}

const actionLabel = { ACTIVE: 'Ativar', SUSPENDED: 'Suspender', CANCELLED: 'Cancelar' } as const

function BeneficiaryForm({
  beneficiary,
  onClose,
  onDone,
}: {
  beneficiary?: InsurerBeneficiary
  onClose: () => void
  onDone: () => void
}) {
  const editing = Boolean(beneficiary)
  const [name, setName] = useState(beneficiary?.name ?? '')
  const [docType, setDocType] = useState(beneficiary?.idDocumentType ?? 'BI')
  const [docNumber, setDocNumber] = useState(beneficiary?.idDocumentNumber ?? '')
  const [birthDate, setBirthDate] = useState(beneficiary?.birthDate ?? '')
  const [relationship, setRelationship] = useState<BeneficiaryRelationship>(beneficiary?.relationship ?? 'HOLDER')
  const [holderId, setHolderId] = useState('')
  const [companyId, setCompanyId] = useState(beneficiary?.companyId ?? '')
  const companies = useCompanyOptions()
  const toast = useToast()

  async function submit() {
    if (!name.trim()) return 'Indique o nome.'
    if (!birthDate) return 'Indique a data de nascimento.'
    if (!editing) {
      if (!docNumber.trim()) return 'Indique o número do documento.'
      if (relationship !== 'HOLDER' && !holderId) return 'Escolha o titular.'
    }
    if (beneficiary) {
      await insurerOpsService.updateBeneficiary(beneficiary.id, {
        name: name.trim(),
        birthDate,
        companyId: companyId || null,
      })
      toast.show('Beneficiário atualizado.')
    } else {
      const created = await insurerOpsService.createBeneficiary({
        name: name.trim(),
        idDocumentType: docType.trim(),
        idDocumentNumber: docNumber.trim(),
        birthDate,
        relationship,
        ...(relationship !== 'HOLDER' ? { holderId } : {}),
        ...(companyId ? { companyId } : {}),
      })
      toast.show(`Beneficiário criado (cartão ${created.cardNumber}), pendente de validação.`)
    }
    return undefined
  }

  return (
    <FormModal
      title={editing ? 'Editar beneficiário' : 'Novo beneficiário'}
      description={editing ? 'O documento e a relação não se alteram.' : 'Nasce como pendente; o número de cartão é gerado pelo sistema.'}
      submitLabel={editing ? 'Guardar' : 'Criar beneficiário'}
      onClose={onClose}
      onSubmit={submit}
      onDone={onDone}
      errorMessages={{ CONFLICT: 'Já existe um beneficiário com este documento nesta seguradora.' }}
    >
      <Input label="Nome" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
      {!editing && (
        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Documento"
            value={docType}
            onChange={(e) => setDocType(e.target.value)}
            options={DOCUMENT_TYPES.map((v) => ({ value: v, label: v }))}
          />
          <Input label="Número" value={docNumber} maxLength={60} onChange={(e) => setDocNumber(e.target.value)} />
        </div>
      )}
      <Input label="Data de nascimento" type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
      {!editing && (
        <Select
          label="Relação"
          value={relationship}
          onChange={(e) => setRelationship(e.target.value as BeneficiaryRelationship)}
          options={RELATIONSHIPS.map((v) => ({ value: v, label: relationshipLabel[v] }))}
        />
      )}
      {!editing && relationship !== 'HOLDER' && (
        <HolderSelect value={holderId} onChange={setHolderId} />
      )}
      <Select label="Empresa (opcional)" value={companyId} onChange={(e) => setCompanyId(e.target.value)} placeholder="Sem empresa" options={companies} />
    </FormModal>
  )
}

/** Código em claro, mostrado uma única vez (BR-SEG-20): ao fechar, deixa de existir no ecrã. */
function ClaimCodeModal({ code, onClose }: { code: InsurerClaimCode; onClose: () => void }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(code.code)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Código de reclamação"
      description="Entregue este código ao beneficiário. Só é mostrado agora: depois de fechar não o pode voltar a ver (pode emitir um novo, que invalida este)."
      footer={<Button onClick={onClose}>Já copiei, fechar</Button>}
    >
      <div className="flex flex-col gap-3">
        <p
          aria-label="Código de reclamação"
          className="rounded-lg bg-surface-muted px-4 py-3 text-center font-mono text-2xl font-semibold tracking-widest select-all"
        >
          {code.code}
        </p>
        <p className="text-sm text-muted">Válido até {formatShortDate(code.expiresAt)}.</p>
        <Button
          variant="secondary"
          onClick={() => void copy()}
          icon={copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
        >
          {copied ? 'Copiado' : 'Copiar código'}
        </Button>
      </div>
    </Modal>
  )
}

/** Beneficiários e dependentes (UC-SEG-02): pesquisa, estados, edição e código de reclamação do cartão. */
export function InsuranceBeneficiariesPage() {
  const toast = useToast()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [applied, setApplied] = useState({ q: '', status: '' })
  const list = usePagedList(
    (cursor) => insurerOpsService.listBeneficiaries({ q: applied.q, status: applied.status, cursor }),
    [applied],
  )
  const [form, setForm] = useState<{ beneficiary?: InsurerBeneficiary } | null>(null)
  const [pendingStatus, setPendingStatus] = useState<{ b: InsurerBeneficiary; to: 'ACTIVE' | 'SUSPENDED' | 'CANCELLED' } | null>(null)
  const [codeFor, setCodeFor] = useState<InsurerBeneficiary | null>(null)
  const [issued, setIssued] = useState<InsurerClaimCode | null>(null)
  const [busy, setBusy] = useState(false)

  function search(event: FormEvent) {
    event.preventDefault()
    setApplied({ q: q.trim(), status })
  }

  async function activate(b: InsurerBeneficiary) {
    try {
      await insurerOpsService.setBeneficiaryStatus(b.id, 'ACTIVE')
      toast.show(`${b.name} ativado.`)
    } catch (error) {
      toast.show(errorMessage(error), 'error')
    }
    list.reload()
  }

  async function issueCode() {
    if (!codeFor) return
    setBusy(true)
    try {
      setIssued(await insurerOpsService.issueClaimCode(codeFor.id))
      setCodeFor(null)
    } catch (error) {
      toast.show(errorMessage(error), 'error')
      setCodeFor(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Beneficiários"
        description="Titulares e dependentes da seguradora. Só vê dados da sua seguradora, nunca o perfil de saúde."
        action={
          <Button size="sm" onClick={() => setForm({})} icon={<Plus className="size-4" aria-hidden />}>
            Novo beneficiário
          </Button>
        }
      />

      <form onSubmit={search} role="search" aria-label="Pesquisar beneficiários" className="grid gap-2 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
        <Input
          label="Nome, nº de cartão ou nº de documento"
          icon={Search}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          hint="O documento só se pesquisa pelo número exato."
        />
        <Select label="Estado" value={status} onChange={(e) => setStatus(e.target.value)} placeholder="Todos" options={STATUS_FILTERS} />
        <Button type="submit" variant="secondary" className="sm:mb-6">
          Pesquisar
        </Button>
      </form>

      <PagedView
        list={list}
        empty={
          <EmptyState
            icon={Users}
            title="Sem beneficiários."
            description="Crie um beneficiário ou importe um ficheiro CSV/XLSX."
          />
        }
      >
        {(items) => (
          <Card className="divide-y divide-border py-1">
            {items.map((b) => (
              <div key={b.id} className="flex flex-col gap-2 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{b.name}</span>
                  <Badge tone={statusTone[b.status]} dot>
                    {statusText[b.status]}
                  </Badge>
                  {b.linked && <Badge tone="primary">Ligado ao app</Badge>}
                </div>
                <p className="text-sm text-muted">
                  {relationshipText[b.relationship]} · cartão {b.cardNumber} · {b.idDocumentType} {b.idDocumentNumber} · nasc.{' '}
                  {formatShortDate(b.birthDate)}
                </p>
                {b.statusNote && <p className="text-sm text-muted">Nota: {b.statusNote}</p>}
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setForm({ beneficiary: b })} icon={<Pencil className="size-4" aria-hidden />}>
                    Editar <span className="sr-only">{b.name}</span>
                  </Button>
                  {b.status !== 'CANCELLED' && (
                    <Button size="sm" variant="ghost" onClick={() => setCodeFor(b)} icon={<KeyRound className="size-4" aria-hidden />}>
                      Código de reclamação <span className="sr-only">de {b.name}</span>
                    </Button>
                  )}
                  {allowedActions(b.status).map((to) => (
                    <Button
                      key={to}
                      size="sm"
                      variant={to === 'CANCELLED' ? 'danger-ghost' : 'ghost'}
                      onClick={() => (to === 'ACTIVE' ? void activate(b) : setPendingStatus({ b, to }))}
                    >
                      {actionLabel[to]} <span className="sr-only">{b.name}</span>
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </Card>
        )}
      </PagedView>

      {form && (
        <BeneficiaryForm
          beneficiary={form.beneficiary}
          onClose={() => setForm(null)}
          onDone={() => {
            setForm(null)
            list.reload()
          }}
        />
      )}

      {pendingStatus && (
        <NoteModal
          title={pendingStatus.to === 'CANCELLED' ? 'Cancelar beneficiário?' : 'Suspender beneficiário?'}
          description={
            pendingStatus.to === 'CANCELLED'
              ? `${pendingStatus.b.name} deixa de ser elegível e o cancelamento é definitivo.`
              : `${pendingStatus.b.name} deixa de ser elegível até ser reativado.`
          }
          noteLabel="Motivo (obrigatório)"
          confirmLabel={pendingStatus.to === 'CANCELLED' ? 'Cancelar beneficiário' : 'Suspender'}
          destructive
          onClose={() => setPendingStatus(null)}
          onConfirm={(note) => insurerOpsService.setBeneficiaryStatus(pendingStatus.b.id, pendingStatus.to, note)}
          onDone={() => {
            toast.show(pendingStatus.to === 'CANCELLED' ? 'Beneficiário cancelado.' : 'Beneficiário suspenso.')
            setPendingStatus(null)
            list.reload()
          }}
        />
      )}

      <ConfirmDialog
        open={codeFor !== null}
        title="Emitir código de reclamação?"
        description={
          codeFor
            ? `Emitir um novo código para ${codeFor.name} invalida o anterior. O código só é mostrado uma vez.`
            : undefined
        }
        confirmLabel="Emitir código"
        loading={busy}
        onConfirm={() => void issueCode()}
        onCancel={() => setCodeFor(null)}
      />
      {issued && <ClaimCodeModal code={issued} onClose={() => setIssued(null)} />}
    </>
  )
}
