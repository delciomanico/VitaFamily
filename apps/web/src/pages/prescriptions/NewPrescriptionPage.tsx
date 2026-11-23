import { useMemo, useState, type ReactNode } from 'react'
import {
  Controller,
  useFieldArray,
  useForm,
  type Control,
  type FieldErrors,
  type UseFormRegister,
} from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Plus, Trash2 } from 'lucide-react'
import { z } from 'zod'
import { DocumentPicker } from '@/components/domain/Documents'
import { MarkedField, ReviewBanner } from '@/components/ocr/OcrMark'
import { OcrIntake, type IntakeOutcome } from '@/components/ocr/OcrIntake'
import {
  ScheduleFields,
  emptySchedule,
  scheduleError,
  toScheduleInput,
  type ScheduleValue,
} from '@/components/domain/ScheduleFields'
import { SheetWait, WizardSheet } from '@/components/app/FormSheet'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Checkbox } from '@/components/ui/Checkbox'
import { Disclosure } from '@/components/ui/Disclosure'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { isValidISODate, todayISO } from '@/lib/date'
import { errorMessage } from '@/lib/errors'
import { prescriptionDefaults } from '@/lib/ocrPrefill'
import type { PrescriptionDraft } from '@/lib/ocrParse'
import { medKey, planPrescriptionReview, unresolvedKeys } from '@/lib/ocrReview'
import { useModalRoute } from '@/lib/modalRoute'
import { useWizardStep } from '@/hooks/useWizardStep'
import { paths } from '@/routes/paths'
import { familyService } from '@/services/family.service'
import { prescriptionService } from '@/services/prescription.service'
import type { DocumentUpload } from '@/types/document'
import type { FamilyMember } from '@/types/family'

/** Duração máxima aceite no formulário; acima disso, usar “uso contínuo”. */
const MAX_DURATION_DAYS = 365

const medicationSchema = z
  .object({
    /** Identificador da linha lida da foto (vazio se escrita à mão): liga as marcas «Confirmar» à linha certa. */
    ocrId: z.string(),
    name: z.string().trim().min(1, 'Indique o medicamento.'),
    dosage: z.string().trim().min(1, 'Indique a dosagem.'),
    schedule: z.custom<ScheduleValue>().superRefine((value, ctx) => {
      const message = scheduleError(value)
      if (message) ctx.addIssue({ code: 'custom', message })
    }),
    continuous: z.boolean(),
    durationDays: z.string(),
    notes: z.string(),
  })
  .superRefine((medication, ctx) => {
    const days = Number(medication.durationDays)
    if (!medication.continuous && !(Number.isInteger(days) && days >= 1 && days <= MAX_DURATION_DAYS)) {
      ctx.addIssue({ code: 'custom', path: ['durationDays'], message: 'Indique a duração em dias (1 a 365).' })
    }
  })

const schema = z.object({
  memberId: z.string().min(1, 'Escolha para quem é a receita.'),
  issuedOn: z
    .string()
    .refine(isValidISODate, 'Indique a data da receita.')
    .refine((date) => date <= todayISO(), 'A data não pode ser futura.'),
  doctorName: z.string(),
  clinicName: z.string(),
  medications: z.array(medicationSchema).min(1),
  documents: z.array(z.custom<DocumentUpload>()),
  notes: z.string(),
})

type FormValues = z.infer<typeof schema>

const newMedication = (): FormValues['medications'][number] => ({
  ocrId: '',
  name: '',
  dosage: '',
  schedule: emptySchedule(),
  continuous: false,
  durationDays: '7',
  notes: '',
})

interface MedicationFieldsProps {
  index: number
  control: Control<FormValues>
  register: UseFormRegister<FormValues>
  errors?: FieldErrors<FormValues['medications'][number]>
  continuous: boolean
  onRemove?: () => void
  /** Marcas «Confirmar» desta linha (só se veio da leitura de uma foto). */
  marks?: PartMarks
}

type MedPart = 'name' | 'dosage' | 'frequency' | 'duration' | 'notes'
interface PartMarks {
  pending(part: MedPart): boolean
  confirm(part: MedPart): void
}

/** Um medicamento da receita: nome, dosagem, frequência, duração e observações. */
function MedicationFields({ index, control, register, errors, continuous, onRemove, marks }: MedicationFieldsProps) {
  const mark = (part: MedPart, children: ReactNode) => (
    <MarkedField pending={marks?.pending(part) ?? false} onConfirm={() => marks?.confirm(part)}>
      {children}
    </MarkedField>
  )
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold">Medicamento {index + 1}</h3>
        {onRemove && (
          <Button variant="ghost" size="sm" onClick={onRemove} icon={<Trash2 className="size-4" aria-hidden />}>
            Remover
          </Button>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {mark(
          'name',
          <Input label="Nome" placeholder="Ex.: Amoxicilina" error={errors?.name?.message} {...register(`medications.${index}.name`)} />,
        )}
        {mark(
          'dosage',
          <Input label="Dosagem" placeholder="Ex.: 500 mg" error={errors?.dosage?.message} {...register(`medications.${index}.dosage`)} />,
        )}
      </div>
      {mark(
        'frequency',
        <Controller
          control={control}
          name={`medications.${index}.schedule`}
          render={({ field, fieldState }) => (
            <ScheduleFields value={field.value} onChange={field.onChange} error={fieldState.error?.message} />
          )}
        />,
      )}
      {mark(
        'duration',
        <div className="flex flex-col gap-3">
          <Input
            label="Duração (dias)"
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_DURATION_DAYS}
            disabled={continuous}
            error={continuous ? undefined : errors?.durationDays?.message}
            className="sm:w-40"
            {...register(`medications.${index}.durationDays`)}
          />
          <Checkbox label="Uso contínuo (sem data de fim)" {...register(`medications.${index}.continuous`)} />
        </div>,
      )}
      <Disclosure label="Observações" defaultOpen={marks !== undefined}>
        {mark(
          'notes',
          <Input label="Observações" placeholder="Ex.: tomar depois das refeições" {...register(`medications.${index}.notes`)} />,
        )}
      </Disclosure>
    </Card>
  )
}

const STEPS = ['Dados da receita', 'Medicamentos', 'Foto e notas'] as const
/** Campos a validar antes de passar de cada passo. */
const STEP_FIELDS: Record<number, (keyof FormValues)[]> = { 0: ['memberId', 'issuedOn'], 1: ['medications'], 2: [] }

type Values = FormValues

/** Valor atual de um campo marcado, no mesmo formato em que foi lido (para saber se o utilizador o editou). */
function currentValue(key: string, values: Values): string | undefined {
  if (key === 'issuedOn' || key === 'doctorName' || key === 'clinicName' || key === 'notes') return values[key]
  const [, id, part] = key.split(':') as [string, string, MedPart]
  const m = values.medications.find((item) => item.ocrId === id)
  if (!m) return undefined
  if (part === 'frequency') return JSON.stringify(m.schedule)
  if (part === 'duration') return m.continuous ? 'contínuo' : m.durationDays
  return m[part]
}

function NewPrescriptionForm({ members, selfMemberId, intake }: { members: FamilyMember[]; selfMemberId: string; intake: IntakeOutcome<PrescriptionDraft> }) {
  const { user, family } = useAuth()
  const toast = useToast()
  const { close, saved } = useModalRoute(paths.prescriptions)
  const { step, next, back, last } = useWizardStep(STEPS.length, close)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const { draft, original, notice, confirmed, confirm } = intake
  // Valores iniciais: o que a leitura encontrou (BR-OCR-06) e, se existir, o original já anexado (BR-OCR-09).
  const [defaults] = useState<FormValues>(() => {
    const read = prescriptionDefaults(draft)
    return {
      memberId: selfMemberId,
      issuedOn: read.issuedOn,
      doctorName: read.doctorName,
      clinicName: read.clinicName,
      medications: read.medications.length > 0 ? read.medications : [newMedication()],
      documents: original ? [original] : [],
      notes: read.notes,
    }
  })
  // Campos a confirmar: os de confiança < 0,70, com o valor lido para detetar se foram editados (BR-OCR-07/08).
  const marked = useMemo(() => (draft ? planPrescriptionReview(draft, (key) => currentValue(key, defaults) ?? '').marked : {}), [draft, defaults])
  const {
    register,
    control,
    handleSubmit,
    watch,
    trigger,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: defaults })
  const { fields, append, remove } = useFieldArray({ control, name: 'medications' })
  const medications = watch('medications')
  const values = watch()
  const unresolved = new Set(unresolvedKeys(marked, confirmed, (key) => currentValue(key, values)))
  const isPending = (key: string) => unresolved.has(key)
  const [doctorDetailsOpen, setDoctorDetailsOpen] = useState(!!(defaults.doctorName || defaults.clinicName))
  const [done, setDone] = useState(false)

  async function onSubmit(values: FormValues) {
    setSubmitError(null)
    try {
      await prescriptionService.createPrescription(family?.id ?? '', user?.id ?? '', {
        memberId: values.memberId,
        issuedOn: values.issuedOn,
        doctorName: values.doctorName,
        clinicName: values.clinicName,
        notes: values.notes,
        documents: values.documents,
        medications: values.medications.map((m) => ({
          name: m.name,
          dosage: m.dosage,
          notes: m.notes,
          continuous: m.continuous,
          durationDays: m.continuous ? undefined : Number(m.durationDays),
          ...toScheduleInput(m.schedule),
        })),
      })
      toast.show('Receita registada.')
      setDone(true)
      saved()
    } catch (error) {
      setSubmitError(errorMessage(error))
    }
  }

  async function onNext() {
    setSubmitError(null)
    const fieldsToCheck = STEP_FIELDS[step] ?? []
    if (fieldsToCheck.length > 0 && !(await trigger(fieldsToCheck))) return
    if (!last) return next()
    await handleSubmit(onSubmit)()
  }

  const memberOptions = members.map((m) => ({ value: m.id, label: m.id === selfMemberId ? `${m.name} (eu)` : m.name }))

  return (
    <WizardSheet
      title="Adicionar receita"
      stepTitle={STEPS[step] ?? ''}
      description={step === 1 ? 'Cada medicamento cria um horário de tomas.' : step === 2 ? 'A foto original fica guardada com a receita.' : undefined}
      step={step}
      total={STEPS.length}
      onBack={() => {
        setSubmitError(null)
        back()
      }}
      onNext={onNext}
      nextLabel={last ? 'Guardar receita' : 'Continuar'}
      busy={isSubmitting}
      nextDisabled={last && unresolved.size > 0}
      error={submitError}
      dirty={isDirty && !done}
      onClose={close}
    >
      {draft && <ReviewBanner pending={unresolved.size} notice={notice} />}
      {!draft && notice && <p className="rounded-xl bg-primary-soft px-3.5 py-3 text-base text-primary">{notice}</p>}
      {step === 0 && (
        <>
          {members.length > 1 && <Select label="Para quem" options={memberOptions} error={errors.memberId?.message} {...register('memberId')} />}
          <MarkedField pending={isPending('issuedOn')} onConfirm={() => confirm('issuedOn')}>
            <Input label="Data da receita" type="date" max={todayISO()} error={errors.issuedOn?.message} {...register('issuedOn')} />
          </MarkedField>
          <Disclosure label="Médico e clínica" open={doctorDetailsOpen} onOpenChange={setDoctorDetailsOpen}>
            <div className="flex flex-col gap-4">
              <MarkedField pending={isPending('doctorName')} onConfirm={() => confirm('doctorName')}>
                <Input label="Médico" placeholder="Ex.: Dra. Ana Costa" {...register('doctorName')} />
              </MarkedField>
              <MarkedField pending={isPending('clinicName')} onConfirm={() => confirm('clinicName')}>
                <Input label="Clínica" placeholder="Ex.: Centro de Saúde" {...register('clinicName')} />
              </MarkedField>
            </div>
          </Disclosure>
        </>
      )}
      {step === 1 && (
        <>
          {fields.map((field, index) => (
            <MedicationFields
              key={field.id}
              index={index}
              control={control}
              register={register}
              errors={errors.medications?.[index]}
              continuous={medications[index]?.continuous ?? false}
              onRemove={fields.length > 1 ? () => remove(index) : undefined}
              marks={
                medications[index]?.ocrId
                  ? {
                      pending: (part) => isPending(medKey(medications[index]!.ocrId, part)),
                      confirm: (part) => confirm(medKey(medications[index]!.ocrId, part)),
                    }
                  : undefined
              }
            />
          ))}
          <Button variant="soft" size="lg" onClick={() => append(newMedication())} icon={<Plus className="size-4" aria-hidden />}>
            Adicionar medicamento
          </Button>
        </>
      )}
      {step === 2 && (
        <>
          <Controller
            control={control}
            name="documents"
            render={({ field }) => <DocumentPicker label="Documento" value={field.value} onChange={field.onChange} />}
          />
          <MarkedField pending={isPending('notes')} onConfirm={() => confirm('notes')}>
            <Textarea label="Observações" {...register('notes')} />
          </MarkedField>
        </>
      )}
    </WizardSheet>
  )
}

/** Registar receita (UC-RX-01) numa folha em ecrã inteiro, por cima da lista: cada medicamento cria um plano de toma. */
export function NewPrescriptionPage() {
  const { user, family, member } = useAuth()
  const { close } = useModalRoute(paths.prescriptions)
  const familyId = family?.id ?? ''
  const userId = user?.id ?? ''
  const { state, reload } = useAsync(() => familyService.listManagedMembers(familyId, userId), [familyId, userId])

  // «Fotografar primeiro» (M16): a escolha da foto vem antes do formulário; «Preencher à mão» abre-o vazio.
  if (state.status === 'success')
    return (
      <OcrIntake kind="PRESCRIPTION" onClose={close}>
        {(intake) => <NewPrescriptionForm members={state.data} selfMemberId={member?.id ?? ''} intake={intake} />}
      </OcrIntake>
    )
  return <SheetWait title="Adicionar receita" onClose={close} onRetry={reload} failed={state.status === 'error'} />
}
