import {
  Controller,
  useFieldArray,
  useForm,
  type Control,
  type FieldErrors,
  type UseFormRegister,
} from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
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
import { Page } from '@/components/layout/Page'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Checkbox } from '@/components/ui/Checkbox'
import { DetailSection } from '@/components/ui/InfoList'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { isValidISODate, todayISO } from '@/lib/date'
import { errorMessage } from '@/lib/errors'
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
      <Input
        label="Observações (opcional)"
        placeholder="Ex.: tomar depois das refeições"
        {...register(`medications.${index}.notes`)}
      />
    </Card>
  )
}

function NewPrescriptionForm({ members, selfMemberId }: { members: FamilyMember[]; selfMemberId: string }) {
  const { user, family } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const {
    register,
    control,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
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

  async function onSubmit(values: FormValues) {
    try {
      const prescription = await prescriptionService.createPrescription(family?.id ?? '', user?.id ?? '', {
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
      navigate(paths.prescription(prescription.id), { replace: true })
    } catch (error) {
      toast.show(errorMessage(error), 'error')
    }
  }

  const memberOptions = members.map((m) => ({ value: m.id, label: m.id === selfMemberId ? `${m.name} (eu)` : m.name }))

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        {members.length > 1 && (
          <Select
            label="Para quem"
            options={memberOptions}
            error={errors.memberId?.message}
            {...register('memberId')}
          />
        )}
        <Input
          label="Data da receita"
          type="date"
          max={todayISO()}
          error={errors.issuedOn?.message}
          {...register('issuedOn')}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Médico (opcional)" placeholder="Ex.: Dra. Ana Costa" {...register('doctorName')} />
          <Input label="Clínica (opcional)" placeholder="Ex.: Centro de Saúde" {...register('clinicName')} />
        </div>
      </div>

      <DetailSection title="Medicamentos">
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
        <Button variant="soft" onClick={() => append(newMedication())} icon={<Plus className="size-4" aria-hidden />}>
          Adicionar medicamento
        </Button>
      </DetailSection>

      <Controller
        control={control}
        name="documents"
        render={({ field }) => (
          <DocumentPicker label="Documento (opcional)" value={field.value} onChange={field.onChange} />
        )}
      />

      <Textarea label="Observações (opcional)" {...register('notes')} />

      <div className="flex flex-col gap-2 sm:flex-row-reverse">
        <Button type="submit" size="lg" loading={isSubmitting} className="sm:flex-1">
          Guardar receita
        </Button>
        <ButtonLink to={paths.prescriptions} variant="ghost" size="lg" className="sm:flex-1">
          Cancelar
        </ButtonLink>
      </div>
    </form>
  )
}

/** Registar receita (UC-RX-01): sem OCR; cada medicamento cria um plano de toma. */
export function NewPrescriptionPage() {
  const { user, family, member } = useAuth()
  const familyId = family?.id ?? ''
  const userId = user?.id ?? ''
  const { state, reload } = useAsync(() => familyService.listManagedMembers(familyId, userId), [familyId, userId])

  return (
    <Page title="Adicionar receita" backTo={paths.prescriptions} backLabel="Receitas">
      {state.status === 'loading' && <LoadingState rows={4} />}
      {state.status === 'error' && <ErrorState onRetry={reload} />}
      {state.status === 'success' && <NewPrescriptionForm members={state.data} selfMemberId={member?.id ?? ''} />}
    </Page>
  )
}
