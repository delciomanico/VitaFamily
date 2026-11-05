import { useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Camera, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { Page } from '@/components/layout/Page'
import { Badge, type Tone } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Checkbox } from '@/components/ui/Checkbox'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { EmptyState, ErrorState, FormError, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { errorMessage, isAppError } from '@/lib/errors'
import { formatLongDate, formatWhen } from '@/lib/format'
import { paths } from '@/routes/paths'
import { insuranceService } from '@/services/insurance.service'
import { DOCUMENT_MAX_BYTES, DOCUMENT_MIME_TYPES } from '@/types/document'
import {
  INSURANCE_TEXT_MAX,
  type ClaimStatus,
  type InsurancePolicy,
  type InsurancePolicyInput,
  type PartnerInsurer,
  type ReimbursementClaim,
} from '@/types/insurance'

const claimStatus: Record<ClaimStatus, { label: string; tone: Tone }> = {
  SUBMITTED: { label: 'Em análise', tone: 'warning' },
  APPROVED: { label: 'Aprovado', tone: 'success' },
  REJECTED: { label: 'Recusado', tone: 'danger' },
  PAID: { label: 'Pago', tone: 'primary' },
}

const money = (amount: number, currency: string) =>
  new Intl.NumberFormat('pt-PT', { style: 'currency', currency }).format(amount)

interface Scope {
  familyId: string
  userId: string
  memberId: string
}

/** `POST/PATCH …/insurance-policies` (BR-INS-01/09): escolher uma seguradora parceira ou escrever o nome. */
function PolicyForm({
  scope,
  initial,
  insurers,
  onClose,
  onSaved,
}: {
  scope: Scope
  initial?: InsurancePolicy
  insurers: PartnerInsurer[]
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const [insurerId, setInsurerId] = useState(initial?.insurerId ?? '')
  const [insurerName, setInsurerName] = useState(initial?.insurerName ?? '')
  const [policyNumber, setPolicyNumber] = useState(initial?.policyNumber ?? '')
  const [holderName, setHolderName] = useState(initial?.holderName ?? '')
  const [validUntil, setValidUntil] = useState(initial?.validUntil ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const partner = insurers.find((i) => i.id === insurerId)

  async function save() {
    const name = (partner?.name ?? insurerName).trim()
    if (!name || !policyNumber.trim() || !holderName.trim()) return setError('Preencha a seguradora, o número da apólice e o titular.')
    if ([name, policyNumber.trim(), holderName.trim()].some((t) => t.length > INSURANCE_TEXT_MAX)) {
      return setError(`Cada campo tem no máximo ${INSURANCE_TEXT_MAX} caracteres.`)
    }
    const input: InsurancePolicyInput = {
      insurerId: partner?.id ?? null,
      insurerName: name,
      policyNumber,
      holderName,
      validUntil: validUntil || null,
    }
    setSaving(true)
    try {
      if (initial) {
        await insuranceService.updatePolicy(scope.familyId, scope.userId, scope.memberId, initial.id, input)
      } else {
        await insuranceService.createPolicy(scope.familyId, scope.userId, scope.memberId, input)
      }
      onSaved(initial ? 'Apólice atualizada.' : 'Apólice adicionada.')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={initial ? 'Editar apólice' : 'Nova apólice'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button onClick={save} loading={saving}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {insurers.length > 0 && (
          <Select
            label="Seguradora parceira"
            hint="Só as apólices de uma seguradora parceira permitem pedir reembolsos."
            placeholder="Outra seguradora"
            value={insurerId}
            options={insurers.map((i) => ({ value: i.id, label: i.name }))}
            onChange={(event) => {
              setInsurerId(event.target.value)
              setError(null)
            }}
          />
        )}
        {!partner && (
          <Input
            label="Nome da seguradora"
            value={insurerName}
            onChange={(event) => {
              setInsurerName(event.target.value)
              setError(null)
            }}
          />
        )}
        <Input label="Número da apólice" value={policyNumber} onChange={(e) => setPolicyNumber(e.target.value)} />
        <Input label="Titular da apólice" value={holderName} onChange={(e) => setHolderName(e.target.value)} />
        <Input label="Válida até (opcional)" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
        <FormError message={error} />
      </div>
    </Modal>
  )
}

/** `POST …/reimbursement-claims` (BR-INS-04): escolhe, a cada pedido, os documentos que seguem. */
function ClaimForm({
  scope,
  policy,
  onClose,
  onSaved,
}: {
  scope: Scope
  policy: InsurancePolicy
  onClose: () => void
  onSaved: () => void
}) {
  const docs = useAsync(() => insuranceService.listMemberDocuments(scope.familyId, scope.memberId), [scope.familyId, scope.memberId])
  const [amount, setAmount] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const attachable = docs.state.status === 'success' ? docs.state.data.filter((d) => d.scanStatus !== 'INFECTED') : []

  async function submit() {
    const value = Number(amount.replace(',', '.'))
    if (!(value > 0) || !/^\d+([.,]\d{1,2})?$/.test(amount.trim())) return setError('Indique um valor válido, com até 2 casas decimais.')
    if (selected.length < 1) return setError('Escolha pelo menos um documento.')
    if (selected.length > 10) return setError('No máximo 10 documentos.')
    setSaving(true)
    try {
      await insuranceService.submitClaim(scope.familyId, scope.userId, scope.memberId, policy.id, {
        amount: value,
        documentIds: selected,
      })
      onSaved()
    } catch (err) {
      setError(
        isAppError(err, 'CONFLICT') ? 'A seguradora está suspensa e não aceita novos pedidos.' : errorMessage(err),
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Pedir reembolso"
      description={`${policy.insurerName} · apólice ${policy.policyNumber}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button onClick={submit} loading={saving}>
            Enviar pedido
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input
          label="Valor (€)"
          inputMode="decimal"
          value={amount}
          onChange={(event) => {
            setAmount(event.target.value)
            setError(null)
          }}
        />
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">Documentos a enviar</legend>
          <p className="text-sm text-muted">
            A seguradora só vê os documentos que escolher aqui, nunca o resto do perfil de saúde.
          </p>
          {docs.state.status === 'loading' && <LoadingState rows={2} />}
          {docs.state.status === 'error' && <ErrorState onRetry={docs.reload} />}
          {docs.state.status === 'success' &&
            (attachable.length > 0 ? (
              attachable.map((doc) => (
                <Checkbox
                  key={doc.id}
                  label={
                    <>
                      {doc.originalName}
                      {doc.scanStatus === 'PENDING' && <span className="text-muted"> (em verificação)</span>}
                    </>
                  }
                  checked={selected.includes(doc.id)}
                  disabled={doc.scanStatus === 'PENDING'}
                  onChange={(event) => {
                    setSelected((s) => (event.target.checked ? [...s, doc.id] : s.filter((id) => id !== doc.id)))
                    setError(null)
                  }}
                />
              ))
            ) : (
              <p className="text-sm text-muted">
                Ainda não há documentos. Anexe primeiro a fatura ou a receita numa receita ou num exame.
              </p>
            ))}
        </fieldset>
        <FormError message={error} />
      </div>
    </Modal>
  )
}

function Claims({ scope, policy, reloadKey }: { scope: Scope; policy: InsurancePolicy; reloadKey: number }) {
  const toast = useToast()
  const { state, reload } = useAsync(
    () => insuranceService.listClaims(scope.familyId, scope.userId, scope.memberId, policy.id),
    [scope.familyId, scope.userId, scope.memberId, policy.id, reloadKey],
  )
  const [busyId, setBusyId] = useState<string | null>(null)

  async function markPaid(claim: ReimbursementClaim) {
    setBusyId(claim.id)
    try {
      await insuranceService.markClaimPaid(scope.familyId, scope.userId, scope.memberId, policy.id, claim.id)
      toast.show('Pedido marcado como pago.')
      reload()
    } catch (error) {
      toast.show(errorMessage(error), 'error')
    } finally {
      setBusyId(null)
    }
  }

  if (state.status === 'loading') return <LoadingState rows={1} />
  if (state.status === 'error') return <ErrorState onRetry={reload} />
  if (state.data.length === 0) return <p className="text-sm text-muted">Sem pedidos de reembolso.</p>
  return (
    <ul className="divide-y divide-border">
      {state.data.map((claim) => (
        <li key={claim.id} className="flex flex-col gap-1.5 py-2.5">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 font-medium">{money(claim.amount, claim.currency)}</span>
            <Badge tone={claimStatus[claim.status].tone} dot>
              {claimStatus[claim.status].label}
            </Badge>
          </div>
          <p className="text-sm text-muted">Pedido {formatWhen(claim.createdAt)}</p>
          {claim.decisionNote && <p className="text-sm">Nota da seguradora: {claim.decisionNote}</p>}
          {claim.status === 'APPROVED' && (
            <Button
              variant="secondary"
              size="sm"
              className="w-fit"
              loading={busyId === claim.id}
              onClick={() => void markPaid(claim)}
            >
              Marcar como pago
            </Button>
          )}
        </li>
      ))}
    </ul>
  )
}

function PolicyCard({
  scope,
  policy,
  onEdit,
  onDelete,
  onChanged,
}: {
  scope: Scope
  policy: InsurancePolicy
  onEdit: () => void
  onDelete: () => void
  onChanged: () => void
}) {
  const toast = useToast()
  const input = useRef<HTMLInputElement>(null)
  const [claiming, setClaiming] = useState(false)
  const [claimsKey, setClaimsKey] = useState(0)
  const [uploading, setUploading] = useState(false)

  async function onCard(files: FileList | null) {
    const file = files?.[0]
    if (input.current) input.current.value = ''
    if (!file) return
    if (!(DOCUMENT_MIME_TYPES as readonly string[]).includes(file.type) || file.size > DOCUMENT_MAX_BYTES) {
      return toast.show('A foto do cartão tem de ser PDF, JPG ou PNG até 10 MB.', 'error')
    }
    setUploading(true)
    try {
      await insuranceService.uploadCard(scope.familyId, scope.memberId, policy.id, {
        originalName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        file,
      })
      toast.show('Foto do cartão enviada.')
      onChanged()
    } catch (error) {
      toast.show(errorMessage(error), 'error')
    } finally {
      setUploading(false)
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{policy.insurerName}</span>
          <span className="block text-sm text-muted">
            Apólice {policy.policyNumber} · {policy.holderName}
          </span>
          <span className="block text-sm text-muted">
            {policy.validUntil ? `Válida até ${formatLongDate(policy.validUntil)}` : 'Sem data de validade'}
          </span>
        </span>
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Editar apólice ${policy.policyNumber}`}
          className="flex size-9 items-center justify-center rounded-full text-muted hover:bg-surface-muted hover:text-foreground"
        >
          <Pencil className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Apagar apólice ${policy.policyNumber}`}
          className="flex size-9 items-center justify-center rounded-full text-muted hover:bg-surface-muted hover:text-danger"
        >
          <Trash2 className="size-4" aria-hidden />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={policy.insurerId ? 'success' : 'neutral'}>
          {policy.insurerId ? 'Seguradora parceira' : 'Sem reembolsos'}
        </Badge>
        <Badge tone={policy.cardDocumentId ? 'primary' : 'neutral'}>
          {policy.cardDocumentId ? 'Cartão anexado' : 'Sem foto do cartão'}
        </Badge>
      </div>

      <input
        ref={input}
        type="file"
        accept={DOCUMENT_MIME_TYPES.join(',')}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => void onCard(event.target.files)}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          loading={uploading}
          onClick={() => input.current?.click()}
          icon={<Camera className="size-4" aria-hidden />}
        >
          {policy.cardDocumentId ? 'Trocar foto do cartão' : 'Foto do cartão'}
        </Button>
        {policy.insurerId && (
          <Button size="sm" onClick={() => setClaiming(true)} icon={<Plus className="size-4" aria-hidden />}>
            Pedir reembolso
          </Button>
        )}
      </div>

      {policy.insurerId && (
        <section className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold text-muted">Pedidos de reembolso</h3>
          <Claims scope={scope} policy={policy} reloadKey={claimsKey} />
        </section>
      )}

      {claiming && (
        <ClaimForm
          scope={scope}
          policy={policy}
          onClose={() => setClaiming(false)}
          onSaved={() => {
            setClaiming(false)
            toast.show('Pedido enviado à seguradora.')
            setClaimsKey((k) => k + 1)
          }}
        />
      )}
    </Card>
  )
}

/** Seguro e reembolsos de um membro (ADR-021): só o próprio ou o tutor (BR-INS-02). */
export function MemberInsurancePage() {
  const { id: memberId = '' } = useParams()
  const { user, family } = useAuth()
  const toast = useToast()
  const familyId = family?.id ?? ''
  const userId = user?.id ?? ''
  const scope: Scope = { familyId, userId, memberId }
  const { state, reload } = useAsync(
    async () => ({
      policies: await insuranceService.listPolicies(familyId, userId, memberId),
      insurers: await insuranceService.listInsurers(familyId),
    }),
    [familyId, userId, memberId],
  )
  const [editing, setEditing] = useState<InsurancePolicy | 'new' | null>(null)
  const [deleting, setDeleting] = useState<InsurancePolicy | null>(null)
  const [removing, setRemoving] = useState(false)

  async function remove(policy: InsurancePolicy) {
    setRemoving(true)
    try {
      await insuranceService.deletePolicy(familyId, userId, memberId, policy.id)
      toast.show('Apólice apagada.')
      setDeleting(null)
      reload()
    } catch (error) {
      toast.show(
        isAppError(error, 'CONFLICT')
          ? 'Há pedidos em análise ou aprovados nesta apólice; não a pode apagar.'
          : errorMessage(error),
        'error',
      )
      setDeleting(null)
    } finally {
      setRemoving(false)
    }
  }

  return (
    <Page
      title="Seguro e reembolsos"
      backTo={paths.familyMember(memberId)}
      backLabel="Membro"
      action={
        state.status === 'success' ? (
          <Button size="sm" onClick={() => setEditing('new')} icon={<Plus className="size-4" aria-hidden />}>
            Apólice
          </Button>
        ) : undefined
      }
    >
      {state.status === 'loading' && <LoadingState rows={3} />}
      {state.status === 'error' &&
        (isAppError(state.error, 'FORBIDDEN') ? (
          <ErrorState message="Só o próprio ou o tutor podem ver o seguro deste membro." />
        ) : (
          <ErrorState onRetry={reload} />
        ))}
      {state.status === 'success' &&
        (state.data.policies.length > 0 ? (
          <div className="flex flex-col gap-3">
            {state.data.policies.map((policy) => (
              <PolicyCard
                key={policy.id}
                scope={scope}
                policy={policy}
                onEdit={() => setEditing(policy)}
                onDelete={() => setDeleting(policy)}
                onChanged={reload}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={ShieldCheck}
            title="Sem apólices."
            description="Guarde o cartão do seguro e, se a seguradora for parceira, peça reembolsos."
          />
        ))}

      {editing && state.status === 'success' && (
        <PolicyForm
          scope={scope}
          initial={editing === 'new' ? undefined : editing}
          insurers={state.data.insurers}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null)
            toast.show(message)
            reload()
          }}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        title="Apagar apólice?"
        description="Os pedidos de reembolso desta apólice também deixam de aparecer. Esta ação não se pode desfazer."
        confirmLabel="Apagar"
        destructive
        loading={removing}
        onConfirm={() => (deleting ? remove(deleting) : undefined)}
        onCancel={() => setDeleting(null)}
      />
    </Page>
  )
}
