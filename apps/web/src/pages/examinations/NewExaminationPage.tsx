import { useId, useMemo, useState } from 'react'
import { Controller, useFieldArray, useForm, type FieldErrors, type UseFormRegister } from 'react-hook-form'
import { useSearchParams } from 'react-router-dom'
import { zodResolver } from '@hookform/resolvers/zod'
import { Plus, Trash2 } from 'lucide-react'
import { z } from 'zod'
import { DocumentPicker } from '@/components/domain/Documents'
import { MarkedField, ReviewBanner } from '@/components/ocr/OcrMark'
import { OcrIntake, type IntakeOutcome } from '@/components/ocr/OcrIntake'
import { SheetWait, WizardSheet } from '@/components/app/FormSheet'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { isValidISODate, todayISO } from '@/lib/date'
import { errorMessage } from '@/lib/errors'
import { parseNumber } from '@/lib/examination'
import { examinationDefaults } from '@/lib/ocrPrefill'
import type { ExamDraft } from '@/lib/ocrParse'
import { planExaminationReview, resultKey, unresolvedKeys } from '@/lib/ocrReview'
import { useModalRoute } from '@/lib/modalRoute'
import { useWizardStep } from '@/hooks/useWizardStep'
import { paths } from '@/routes/paths'
import { examinationService, type ExamResultInput } from '@/services/examination.service'
import { clinicService } from '@/services/clinic.service'
import { familyService } from '@/services/family.service'
import type { DocumentUpload } from '@/types/document'
import type { FamilyMember } from '@/types/family'

const optionalNumber = z.string().refine((v) => !v.trim() || parseNumber(v) !== null, 'Use só números.')

const resultSchema = z
  .object({
    /** Identificador da linha lida da foto (vazio se escrita à mão): liga a marca «Confirmar» à linha certa. */
    ocrId: z.string(),
    parameter: z.string().trim().min(1, 'Indique o parâmetro.'),
    value: z.string().trim().min(1, 'Indique o valor.'),
    unit: z.string(),
    referenceMin: optionalNumber,
    referenceMax: optionalNumber,
  })
  .superRefine((result, ctx) => {
    const min = parseNumber(result.referenceMin)
    const max = parseNumber(result.referenceMax)
    if (min !== null && max !== null && min > max) {
      ctx.addIssue({ code: 'custom', path: ['referenceMax'], message: 'O máximo não pode ser menor que o mínimo.' })
    }
  })

const schema = z.object({
  memberId: z.string().min(1, 'Escolha para quem é o exame.'),
  name: z.string().trim().min(1, 'Indique o tipo de exame.'),
  examDate: z.string().refine(isValidISODate, 'Indique a data do exame.'),
  clinicName: z.string(),
  results: z.array(resultSchema),
  documents: z.array(z.custom<DocumentUpload>()),
  notes: z.string(),
})

type FormValues = z.infer<typeof schema>

const emptyResult = (): FormValues['results'][number] => ({
  ocrId: '',
  parameter: '',
  value: '',
  unit: '',
  referenceMin: '',
  referenceMax: '',
})

/** O valor é numérico quando possível; senão fica como texto livre (BR-EXM-01, ex.: “Negativo”). */
function toResultInput(result: FormValues['results'][number]): ExamResultInput {
  const numeric = parseNumber(result.value)
  return {
    parameter: result.parameter,
    ...(numeric !== null ? { valueNumeric: numeric } : { valueText: result.value }),
    unit: result.unit,
    referenceMin: parseNumber(result.referenceMin) ?? undefined,
    referenceMax: parseNumber(result.referenceMax) ?? undefined,
  }
}

interface ResultFieldsProps {
  index: number
  register: UseFormRegister<FormValues>
  errors?: FieldErrors<FormValues['results'][number]>
  onRemove: () => void
  /** Marca «Confirmar» da linha (só se veio da leitura de uma foto): a linha confirma-se de uma vez. */
  mark?: { pending: boolean; confirm: () => void }
}

/** Um resultado: parâmetro, valor, unidade e referência (opcional, do boletim). */
function ResultFields({ index, register, errors, onRemove, mark }: ResultFieldsProps) {
  return (
    <Card className="flex flex-col gap-4">
      <MarkedField pending={mark?.pending ?? false} onConfirm={() => mark?.confirm()}>
      <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold">Resultado {index + 1}</h3>
        <Button variant="ghost" size="sm" onClick={onRemove} icon={<Trash2 className="size-4" aria-hidden />}>
          Remover
        </Button>
      </div>
      <Input
        label="Parâmetro"
        placeholder="Ex.: Glicemia"
        error={errors?.parameter?.message}
        {...register(`results.${index}.parameter`)}
      />
      <div className="grid grid-cols-2 gap-4">
        <Input
          label="Valor"
          placeholder="Ex.: 98"
          error={errors?.value?.message}
          {...register(`results.${index}.value`)}
        />
        <Input label="Unidade" placeholder="Ex.: mg/dL" {...register(`results.${index}.unit`)} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Input
          label="Referência mín."
          inputMode="decimal"
          error={errors?.referenceMin?.message}
          {...register(`results.${index}.referenceMin`)}
        />
        <Input
          label="Referência máx."
          inputMode="decimal"
          error={errors?.referenceMax?.message}
          {...register(`results.${index}.referenceMax`)}
        />
      </div>
      </div>
      </MarkedField>
    </Card>
  )
}

/** Pedido de exame de uma clínica a marcar (`?examOrderId&name&clinicId&memberId`, M15 U). */
interface OrderPrefill {
  examOrderId: string
  name: string
  memberId?: string
  clinicName?: string
}

interface NewExaminationFormProps {
  members: FamilyMember[]
  clinics: string[]
  selfMemberId: string
  prefill?: OrderPrefill
}

/** Pedido de exame de uma clínica a marcar (`?examOrderId&name&clinicId&memberId`, M15 U). */
interface OrderPrefill {
  examOrderId: string
  name: string
  memberId?: string
  clinicName?: string
}

interface NewExaminationFormProps {
  members: FamilyMember[]
  clinics: string[]
  selfMemberId: string
  prefill?: OrderPrefill
  intake: IntakeOutcome<ExamDraft>
}

type Values = FormValues

/** Valor atual de um campo marcado, no mesmo formato em que foi lido (para saber se o utilizador o editou). */
function currentValue(key: string, values: Values): string | undefined {
  if (key === 'name' || key === 'examDate') return values[key]
  if (key === 'labName') return values.clinicName
  const r = values.results.find((item) => resultKey(item.ocrId) === key)
  return r ? JSON.stringify([r.parameter, r.value, r.unit, r.referenceMin, r.referenceMax]) : undefined
}

function NewExaminationForm({ members, clinics, selfMemberId, prefill, intake }: NewExaminationFormProps) {
  const { user, family } = useAuth()
  const toast = useToast()
  const [params] = useSearchParams()
  const { close, saved } = useModalRoute(paths.examinations)
  const clinicListId = useId()
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const { draft, original, notice, confirmed, confirm } = intake
  // Valores iniciais: o que a leitura encontrou (BR-OCR-06) e, se existir, o original já anexado (BR-OCR-09).
  const [defaults] = useState<FormValues>(() => {
    const read = examinationDefaults(draft)
    return {
      memberId: prefill?.memberId && members.some((m) => m.id === prefill.memberId) ? prefill.memberId : selfMemberId,
      name: prefill?.name ?? read.name,
      examDate: read.examDate,
      clinicName: prefill?.clinicName ?? read.clinicName,
      results: read.results,
      documents: original ? [original] : [],
      notes: '',
    }
  })
  // Campos a confirmar: os de confiança < 0,70, com o valor lido para detetar se foram editados (BR-OCR-07/08).
  const marked = useMemo(() => (draft ? planExaminationReview(draft, (key) => currentValue(key, defaults) ?? '').marked : {}), [draft, defaults])
  const {
    register,
    control,
    handleSubmit,
    watch,
    trigger,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: defaults })
  const { fields, append, remove } = useFieldArray({ control, name: 'results' })
  const values = watch()
  // Exame agendado (data futura) não leva resultados: as marcas das linhas deixam de contar.
  const unresolved = new Set(unresolvedKeys(marked, confirmed, (key) => (values.examDate > todayISO() && key.startsWith('res:') ? undefined : currentValue(key, values))))
  const isPending = (key: string) => unresolved.has(key)
  // Exame futuro fica agendado e ainda não tem resultados (ST5): sem o passo dos resultados.
  const scheduled = watch('examDate') > todayISO()
  const steps = scheduled ? (['Que exame?', 'Foto e notas'] as const) : (['Que exame?', 'Resultados', 'Foto e notas'] as const)
  const { step, next, back, last } = useWizardStep(steps.length, close)
  const stepName = steps[step] ?? ''

  async function onSubmit({ results, ...values }: FormValues) {
    setSubmitError(null)
    try {
      await examinationService.createExamination(family?.id ?? '', user?.id ?? '', {
        ...values,
        ...(prefill ? { examOrderId: prefill.examOrderId } : {}),
        results: scheduled ? [] : results.map(toResultInput),
      })
      toast.show(scheduled ? 'Exame agendado.' : 'Exame registado.')
      setDone(true)
      saved()
    } catch (error) {
      setSubmitError(errorMessage(error))
    }
  }

  async function onNext() {
    setSubmitError(null)
    if (stepName === 'Que exame?' && !(await trigger(['memberId', 'name', 'examDate']))) return
    if (stepName === 'Resultados' && !(await trigger('results'))) return
    if (!last) return next()
    await handleSubmit(onSubmit)()
  }

  const memberOptions = members.map((m) => ({ value: m.id, label: m.id === selfMemberId ? `${m.name} (eu)` : m.name }))
  const search = prefill ? `?${params}` : ''

  return (
    <WizardSheet
      title="Adicionar exame"
      stepTitle={stepName}
      description={stepName === 'Resultados' ? 'Confira os valores e as referências com o boletim. A Vita Family guarda-os sem os interpretar.' : stepName === 'Foto e notas' ? 'A foto original fica guardada com o exame.' : undefined}
      step={step}
      total={steps.length}
      onBack={() => {
        setSubmitError(null)
        back()
      }}
      onNext={onNext}
      nextLabel={last ? 'Guardar exame' : 'Continuar'}
      busy={isSubmitting}
      nextDisabled={last && unresolved.size > 0}
      error={submitError}
      dirty={isDirty && !done}
      onClose={close}
    >
      {draft && <ReviewBanner pending={unresolved.size} total={Object.keys(marked).length} notice={notice} />}
      {!draft && notice && <p className="rounded-xl bg-primary-soft px-3.5 py-3 text-base text-primary">{notice}</p>}
      {stepName === 'Que exame?' && (
        <>
          {prefill && (
            <p className="rounded-xl bg-primary-soft px-3.5 py-3 text-base text-primary">
              A marcar o exame pedido pela clínica: <strong>{prefill.name}</strong>. Escolha a data e, se quiser, outra clínica.
            </p>
          )}
          {members.length > 1 && <Select label="Para quem" options={memberOptions} error={errors.memberId?.message} {...register('memberId')} />}
          <MarkedField pending={isPending('name')} onConfirm={() => confirm('name')}>
            <Input label="Tipo de exame" placeholder="Ex.: Análises clínicas" error={errors.name?.message} {...register('name')} />
          </MarkedField>
          <MarkedField pending={isPending('examDate')} onConfirm={() => confirm('examDate')}>
            <Input label="Data" type="date" error={errors.examDate?.message} hint={scheduled ? 'Data futura: o exame fica agendado.' : undefined} {...register('examDate')} />
          </MarkedField>
          <MarkedField pending={isPending('labName')} onConfirm={() => confirm('labName')}>
            <Input label="Clínica/Laboratório (opcional)" placeholder="Ex.: Laboratório Vida Plena" list={clinicListId} {...register('clinicName')} />
          </MarkedField>
          <datalist id={clinicListId}>
            {clinics.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          <ButtonLink to={`${paths.examinationSchedule}${search}`} replace variant="soft" size="lg">
            Agendar numa clínica parceira
          </ButtonLink>
        </>
      )}
      {stepName === 'Resultados' && (
        <>
          {fields.map((field, index) => (
            <ResultFields
              key={field.id}
              index={index}
              register={register}
              errors={errors.results?.[index]}
              onRemove={() => remove(index)}
              mark={
                values.results[index]?.ocrId
                  ? { pending: isPending(resultKey(values.results[index]!.ocrId)), confirm: () => confirm(resultKey(values.results[index]!.ocrId)) }
                  : undefined
              }
            />
          ))}
          <Button variant="soft" size="lg" onClick={() => append(emptyResult())} icon={<Plus className="size-4" aria-hidden />}>
            Adicionar resultado
          </Button>
        </>
      )}
      {stepName === 'Foto e notas' && (
        <>
          <Controller
            control={control}
            name="documents"
            render={({ field }) => <DocumentPicker label="Documento (opcional)" value={field.value} onChange={field.onChange} />}
          />
          <Textarea label="Observações (opcional)" {...register('notes')} />
        </>
      )}
    </WizardSheet>
  )
}

/** Registar exame (UC-EXM-01/02/03), com vários resultados e documento, numa folha em ecrã inteiro por cima da lista. */
export function NewExaminationPage() {
  const { user, family, member } = useAuth()
  const [params] = useSearchParams()
  const { close } = useModalRoute(paths.examinations)
  const familyId = family?.id ?? ''
  const userId = user?.id ?? ''
  const { state, reload } = useAsync(
    () => Promise.all([familyService.listManagedMembers(familyId, userId), clinicService.listClinics(familyId)]),
    [familyId, userId],
  )

  const examOrderId = params.get('examOrderId')
  const prefill = (clinics: Array<{ id: string; name: string }>): OrderPrefill | undefined =>
    examOrderId
      ? {
          examOrderId,
          name: params.get('name') ?? '',
          memberId: params.get('memberId') ?? undefined,
          clinicName: clinics.find((c) => c.id === params.get('clinicId'))?.name,
        }
      : undefined

  if (state.status !== 'success') return <SheetWait title="Adicionar exame" onClose={close} onRetry={reload} failed={state.status === 'error'} />
  const form = (intake: IntakeOutcome<ExamDraft>) => (
    <NewExaminationForm members={state.data[0]} clinics={state.data[1].map((c) => c.name)} selfMemberId={member?.id ?? ''} prefill={prefill(state.data[1])} intake={intake} />
  )
  // Pedido de uma clínica a marcar: sem leitura de foto, vai direto ao formulário (a marcar, não a registar um resultado).
  if (examOrderId) return form({ draft: null, original: null, notice: null, confirmed: new Set(), confirm: () => {} })
  // «Fotografar primeiro» (M16): a escolha da foto vem antes do formulário; «Preencher à mão» abre-o vazio.
  return (
    <OcrIntake kind="EXAMINATION" onClose={close}>
      {form}
    </OcrIntake>
  )
}
