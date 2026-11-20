import { useState, type FormEvent } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { zodResolver } from '@hookform/resolvers/zod'
import { ChevronRight, Clock, FileText, Pencil, StickyNote } from 'lucide-react'
import { z } from 'zod'
import { ReminderState } from '@/components/domain/MedicationList'
import {
  ScheduleFields,
  scheduleError,
  scheduleFromPlan,
  toScheduleInput,
  type ScheduleValue,
} from '@/components/domain/ScheduleFields'
import { AccordionSection } from '@/components/app/Accordion'
import { ConfirmSheet } from '@/components/app/Sheet'
import { Page } from '@/components/layout/Page'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { InfoList, InfoRow } from '@/components/ui/InfoList'
import { Input } from '@/components/ui/Input'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { isValidISODate, todayISO } from '@/lib/date'
import { errorMessage, isAppError } from '@/lib/errors'
import { formatLongDate, formatWhen } from '@/lib/format'
import { medicationStatus } from '@/lib/labels'
import { PRESCRIPTION_READ_ONLY_NOTICE } from '@/lib/recordSharing'
import { dailyTimes, describeDuration, describeFrequency } from '@/lib/medication'
import { paths } from '@/routes/paths'
import { medicationService, type UpdateMedicationInput } from '@/services/medication.service'
import type { MedicationDetail } from '@/types/medication'

const schema = z
  .object({
    name: z.string().trim().min(1, 'Indique o medicamento.'),
    dosage: z.string().trim().min(1, 'Indique a dosagem.'),
    schedule: z.custom<ScheduleValue>().superRefine((value, ctx) => {
      const message = scheduleError(value)
      if (message) ctx.addIssue({ code: 'custom', message })
    }),
    continuous: z.boolean(),
    endDate: z.string(),
    notes: z.string(),
  })
  .superRefine((values, ctx) => {
    if (values.continuous) return
    if (!isValidISODate(values.endDate)) {
      ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'Indique a data de término.' })
    } else if (values.endDate < todayISO()) {
      ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'A data de término não pode ser passada.' })
    }
  })

type FormValues = z.infer<typeof schema>

interface EditFormProps {
  detail: MedicationDetail
  onSubmit: (input: UpdateMedicationInput) => Promise<void>
  onCancel: () => void
}

/** Editar medicamento (UC-MED-04): as alterações só valem para as tomas futuras. */
function MedicationEditForm({ detail: { plan }, onSubmit, onCancel }: EditFormProps) {
  const {
    register,
    control,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: plan.name,
      dosage: plan.dosage,
      schedule: scheduleFromPlan(plan),
      continuous: plan.continuous,
      endDate: plan.endAt ? todayISO(new Date(plan.endAt)) : '',
      notes: plan.notes ?? '',
    },
  })
  const continuous = watch('continuous')

  function submit({ schedule, endDate, ...values }: FormValues) {
    return onSubmit({ ...values, ...toScheduleInput(schedule), endDate: values.continuous ? undefined : endDate })
  }

  return (
    <form onSubmit={handleSubmit(submit)} noValidate className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Nome" error={errors.name?.message} {...register('name')} />
        <Input label="Dosagem" error={errors.dosage?.message} {...register('dosage')} />
      </div>
      <Controller
        control={control}
        name="schedule"
        render={({ field, fieldState }) => (
          <ScheduleFields value={field.value} onChange={field.onChange} error={fieldState.error?.message} />
        )}
      />
      <Input
        label="Data de término"
        type="date"
        min={todayISO()}
        disabled={continuous}
        error={continuous ? undefined : errors.endDate?.message}
        className="sm:w-52"
        {...register('endDate')}
      />
      <Checkbox label="Uso contínuo (sem data de fim)" {...register('continuous')} />
      <Input label="Observações (opcional)" {...register('notes')} />
      <p className="text-sm text-muted">As alterações aplicam-se às próximas tomas; as já registadas mantêm-se.</p>
      <div className="flex flex-col gap-2 pt-2 sm:flex-row-reverse">
        <Button type="submit" size="xl" loading={isSubmitting} className="sm:flex-1">
          Guardar
        </Button>
        <Button variant="ghost" size="xl" onClick={onCancel} className="sm:flex-1">
          Cancelar
        </Button>
      </div>
    </form>
  )
}

/** Receita do profissional (OP-127): o conteúdo é só leitura; só se acertam os horários dos lembretes. */
function ScheduleOnlyForm({ detail: { plan }, onSubmit, onCancel }: EditFormProps) {
  const [schedule, setSchedule] = useState<ScheduleValue>(scheduleFromPlan(plan))
  const [saving, setSaving] = useState(false)
  const error = scheduleError(schedule)
  const [shown, setShown] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setShown(true)
    if (error) return
    setSaving(true)
    try {
      await onSubmit({
        name: plan.name,
        dosage: plan.dosage,
        notes: plan.notes,
        continuous: plan.continuous,
        ...toScheduleInput(schedule),
        scheduleOnly: true,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-4">
      <p role="note" className="rounded-md bg-surface-muted px-3.5 py-3 text-sm">
        {PRESCRIPTION_READ_ONLY_NOTICE}
      </p>
      <p className="font-medium">
        {plan.name} <span className="font-normal text-muted">{plan.dosage}</span>
      </p>
      <ScheduleFields value={schedule} onChange={setSchedule} error={shown ? (error ?? undefined) : undefined} />
      <p className="text-sm text-muted">As alterações aplicam-se às próximas tomas; as já registadas mantêm-se.</p>
      <div className="flex flex-col gap-2 pt-2 sm:flex-row-reverse">
        <Button type="submit" size="xl" loading={saving} className="sm:flex-1">
          Guardar horários
        </Button>
        <Button variant="ghost" size="xl" onClick={onCancel} className="sm:flex-1">
          Cancelar
        </Button>
      </div>
    </form>
  )
}

function TimePills({ times }: { times: string[] }) {
  return (
    <ul className="flex flex-wrap justify-end gap-1.5">
      {times.map((time) => (
        <li
          key={time}
          className="rounded-full bg-primary-soft px-2.5 py-0.5 text-sm font-medium text-primary tabular-nums"
        >
          {time}
        </li>
      ))}
    </ul>
  )
}

interface MedicationViewProps {
  detail: MedicationDetail
  selfMemberId?: string
  onEnd: () => void
}

/** Resumo no topo (nome, dosagem, próxima dose); o resto em acordeões fechados: horários, observações e receita. */
function MedicationView({ detail, selfMemberId, onEnd }: MedicationViewProps) {
  const { plan, memberName, nextDoseAt, remindersOn, prescription } = detail
  const status = medicationStatus[plan.status]
  return (
    <>
      <div className="flex flex-col gap-2 rounded-2xl bg-primary-soft p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-2xl font-semibold">{plan.name}</h2>
          <Badge tone={status.tone} dot>
            {status.label}
          </Badge>
        </div>
        <p className="text-lg">
          {plan.dosage}
          {plan.memberId !== selfMemberId && ` · ${memberName}`}
        </p>
        {nextDoseAt && (
          <p className="text-lg">
            Próxima dose: <span className="font-semibold">{formatWhen(nextDoseAt)}</span>
          </p>
        )}
        <ReminderState on={remindersOn} className="text-base" />
      </div>

      <AccordionSection title="Horários e duração" summary={describeFrequency(plan, { short: true })} icon={Clock}>
        <InfoList>
          <InfoRow label="Frequência" value={describeFrequency(plan)} />
          <InfoRow label="Horários" value={<TimePills times={dailyTimes(plan)} />} />
          <InfoRow label="Data de início" value={formatLongDate(plan.startAt)} />
          <InfoRow
            label="Data de término"
            value={plan.continuous || !plan.endAt ? 'Uso contínuo' : formatLongDate(plan.endedAt ?? plan.endAt)}
          />
          {!plan.continuous && <InfoRow label="Duração" value={describeDuration(plan)} />}
        </InfoList>
      </AccordionSection>

      {plan.notes && (
        <AccordionSection title="Observações" icon={StickyNote}>
          <p className="whitespace-pre-line">{plan.notes}</p>
        </AccordionSection>
      )}

      {prescription?.issuedBy === 'PROFESSIONAL' && (
        <p role="note" className="rounded-xl bg-surface-muted px-4 py-3 text-base">
          {PRESCRIPTION_READ_ONLY_NOTICE}
        </p>
      )}

      <AccordionSection
        title="Receita associada"
        summary={prescription ? (prescription.doctorName ?? 'Receita') : 'Sem receita associada'}
        icon={FileText}
      >
        {prescription ? (
          <Link
            to={paths.prescription(prescription.id)}
            className="flex min-h-14 items-center gap-3 rounded-xl border border-border bg-surface p-4 transition-colors hover:border-border-strong"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-lg font-medium">{prescription.doctorName ?? 'Receita'}</span>
              <span className="block text-base text-muted">{formatLongDate(prescription.issuedOn)}</span>
            </span>
            <ChevronRight className="size-6 shrink-0 text-muted" aria-hidden />
          </Link>
        ) : (
          <p className="text-base text-muted">Medicamento sem receita associada.</p>
        )}
      </AccordionSection>

      {plan.status === 'ACTIVE' && (
        <Button variant="danger-ghost" size="xl" onClick={onEnd}>
          Desativar medicamento
        </Button>
      )}
    </>
  )
}

/** Detalhe do medicamento; `?editar` abre o formulário (o botão voltar funciona). */
export function MedicationDetailPage() {
  const { id = '' } = useParams()
  const { user, family, member } = useAuth()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const [confirming, setConfirming] = useState(false)
  const [ending, setEnding] = useState(false)
  const familyId = family?.id ?? ''
  const userId = user?.id ?? ''
  const { state, reload } = useAsync(
    () => medicationService.getMedication(familyId, userId, id),
    [familyId, userId, id],
  )

  const canEdit = state.status === 'success' && state.data.plan.status === 'ACTIVE'
  const editing = params.has('editar') && canEdit
  const setEditing = (on: boolean) => setParams(on ? { editar: '' } : {}, { replace: !on })

  async function save(input: UpdateMedicationInput) {
    try {
      await medicationService.updateMedication(familyId, userId, id, input)
      toast.show('Medicamento atualizado.')
      setEditing(false)
      reload()
    } catch (error) {
      toast.show(isAppError(error, 'CONFLICT') ? 'O conteúdo desta receita só pode ser lido.' : errorMessage(error), 'error')
    }
  }

  async function end() {
    setEnding(true)
    try {
      await medicationService.endMedication(familyId, userId, id)
      toast.show('Medicamento desativado.')
      setConfirming(false)
      reload()
    } catch (error) {
      toast.show(errorMessage(error), 'error')
    } finally {
      setEnding(false)
    }
  }

  const editButton = canEdit && !editing && (
    <Button
      variant="secondary"
      size="lg"
      onClick={() => setEditing(true)}
      icon={<Pencil className="size-4" aria-hidden />}
    >
      Editar
    </Button>
  )

  return (
    <Page
      title={editing ? 'Editar medicamento' : 'Medicamento'}
      backTo={paths.medications}
      backLabel="Medicamentos"
      action={editButton}
    >
      {state.status === 'loading' && <LoadingState rows={3} />}
      {state.status === 'error' &&
        (isAppError(state.error, 'NOT_FOUND') ? (
          <ErrorState message="Este medicamento não existe ou não tem acesso a ele." />
        ) : (
          <ErrorState onRetry={reload} />
        ))}
      {state.status === 'success' &&
        (editing ? (
          state.data.prescription?.issuedBy === 'PROFESSIONAL' ? (
            <ScheduleOnlyForm detail={state.data} onSubmit={save} onCancel={() => setEditing(false)} />
          ) : (
            <MedicationEditForm detail={state.data} onSubmit={save} onCancel={() => setEditing(false)} />
          )
        ) : (
          <MedicationView detail={state.data} selfMemberId={member?.id} onEnd={() => setConfirming(true)} />
        ))}

      <ConfirmSheet
        open={confirming}
        title="Desativar medicamento?"
        description="Os lembretes param e as próximas tomas deixam de aparecer. O histórico de tomas mantém-se."
        yesLabel="Sim, desativar"
        destructive
        loading={ending}
        onYes={end}
        onNo={() => setConfirming(false)}
      />
    </Page>
  )
}
