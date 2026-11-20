import { useState } from 'react'
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
import { extractClinicName, extractDateISO, extractDoctorName, extractMedication } from '@/lib/ocrParse'
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
}

/** Um medicamento da receita: nome, dosagem, frequência, duração e observações. */
function MedicationFields({ index, control, register, errors, continuous, onRemove }: MedicationFieldsProps) {
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
        <Input
          label="Nome"
          placeholder="Ex.: Amoxicilina"
          error={errors?.name?.message}
          {...register(`medications.${index}.name`)}
        />
        <Input
          label="Dosagem"
          placeholder="Ex.: 500 mg"
          error={errors?.dosage?.message}
          {...register(`medications.${index}.dosage`)}
        />
      </div>
      <Controller
        control={control}
        name={`medications.${index}.schedule`}
        render={({ field, fieldState }) => (
          <ScheduleFields value={field.value} onChange={field.onChange} error={fieldState.error?.message} />
        )}
      />
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
      </div>
      <Disclosure label="Observações">
        <Input
          label="Observações"
          placeholder="Ex.: tomar depois das refeições"
          {...register(`medications.${index}.notes`)}
        />
      </Disclosure>
    </Card>
  )
}

const STEPS = ['Dados da receita', 'Medicamentos', 'Foto e notas'] as const
/** Campos a validar antes de passar de cada passo. */
const STEP_FIELDS: Record<number, (keyof FormValues)[]> = { 0: ['memberId', 'issuedOn'], 1: ['medications'], 2: [] }

function NewPrescriptionForm({ members, selfMemberId }: { members: FamilyMember[]; selfMemberId: string }) {
  const { user, family } = useAuth()
  const toast = useToast()
  const { close, saved } = useModalRoute(paths.prescriptions)
  const { step, next, back, last } = useWizardStep(STEPS.length, close)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    getValues,
    trigger,
    formState: { errors, isSubmitting, isDirty, dirtyFields },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      memberId: selfMemberId,
      issuedOn: todayISO(),
      doctorName: '',
      clinicName: '',
      medications: [newMedication()],
      documents: [],
      notes: '',
    },
  })
  const { fields, append, remove } = useFieldArray({ control, name: 'medications' })
  const medications = watch('medications')
  const [doctorDetailsOpen, setDoctorDetailsOpen] = useState(false)
  const [done, setDone] = useState(false)

  /** Pré-preenche a partir da leitura da foto (melhor esforço); nunca substitui o que já foi escrito. */
  function handleOcrExtract(text: string) {
    const values = getValues()
    let filled = 0

    const date = extractDateISO(text)
    if (date && !dirtyFields.issuedOn) {
      setValue('issuedOn', date, { shouldDirty: true })
      filled++
    }
    const doctor = extractDoctorName(text)
    if (doctor && !values.doctorName) {
      setValue('doctorName', doctor, { shouldDirty: true })
      filled++
    }
    const clinic = extractClinicName(text)
    if (clinic && !values.clinicName) {
      setValue('clinicName', clinic, { shouldDirty: true })
      filled++
    }
    if (doctor || clinic) setDoctorDetailsOpen(true)

    const medication = extractMedication(text)
    if (medication && !values.medications[0]?.name) {
      setValue('medications.0.name', medication.name, { shouldDirty: true })
      setValue('medications.0.dosage', medication.dosage, { shouldDirty: true })
      filled++
    }

    toast.show(
      filled > 0
        ? 'Alguns campos foram preenchidos a partir da foto — reveja antes de guardar.'
        : 'Não reconheci dados nesta foto. Preencha os campos manualmente.',
      filled > 0 ? 'success' : 'error',
    )
  }

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
      description={step === 1 ? 'Cada medicamento cria um horário de tomas.' : step === 2 ? 'Opcional. Tirar uma foto ajuda a preencher.' : undefined}
      step={step}
      total={STEPS.length}
      onBack={() => {
        setSubmitError(null)
        back()
      }}
      onNext={onNext}
      nextLabel={last ? 'Guardar receita' : 'Continuar'}
      busy={isSubmitting}
      error={submitError}
      dirty={isDirty && !done}
      onClose={close}
    >
      {step === 0 && (
        <>
          {members.length > 1 && <Select label="Para quem" options={memberOptions} error={errors.memberId?.message} {...register('memberId')} />}
          <Input label="Data da receita" type="date" max={todayISO()} error={errors.issuedOn?.message} {...register('issuedOn')} />
          <Disclosure label="Médico e clínica" open={doctorDetailsOpen} onOpenChange={setDoctorDetailsOpen}>
            <div className="flex flex-col gap-4">
              <Input label="Médico" placeholder="Ex.: Dra. Ana Costa" {...register('doctorName')} />
              <Input label="Clínica" placeholder="Ex.: Centro de Saúde" {...register('clinicName')} />
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
            render={({ field }) => <DocumentPicker label="Documento" value={field.value} onChange={field.onChange} ocr={{ onExtract: handleOcrExtract }} />}
          />
          <Textarea label="Observações" {...register('notes')} />
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

  if (state.status === 'success') return <NewPrescriptionForm members={state.data} selfMemberId={member?.id ?? ''} />
  return <SheetWait title="Adicionar receita" onClose={close} onRetry={reload} failed={state.status === 'error'} />
}
