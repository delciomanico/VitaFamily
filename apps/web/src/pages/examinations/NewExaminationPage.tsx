import { useId } from 'react'
import { Controller, useFieldArray, useForm, type FieldErrors, type UseFormRegister } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import { zodResolver } from '@hookform/resolvers/zod'
import { Plus, Trash2 } from 'lucide-react'
import { z } from 'zod'
import { DocumentPicker } from '@/components/domain/Documents'
import { Page } from '@/components/layout/Page'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
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
import { parseNumber } from '@/lib/examination'
import { paths } from '@/routes/paths'
import { examinationService, type ExamResultInput } from '@/services/examination.service'
import { familyService } from '@/services/family.service'
import type { DocumentUpload } from '@/types/document'
import type { FamilyMember } from '@/types/family'

const optionalNumber = z.string().refine((v) => !v.trim() || parseNumber(v) !== null, 'Use só números.')

const resultSchema = z
  .object({
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
}

/** Um resultado: parâmetro, valor, unidade e referência (opcional, do boletim). */
function ResultFields({ index, register, errors, onRemove }: ResultFieldsProps) {
  return (
    <Card className="flex flex-col gap-4">
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
    </Card>
  )
}

interface NewExaminationFormProps {
  members: FamilyMember[]
  clinics: string[]
  selfMemberId: string
}

function NewExaminationForm({ members, clinics, selfMemberId }: NewExaminationFormProps) {
  const { user, family } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const clinicListId = useId()
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
      name: '',
      examDate: todayISO(),
      clinicName: '',
      results: [],
      documents: [],
      notes: '',
    },
  })
  const { fields, append, remove } = useFieldArray({ control, name: 'results' })
  // Exame futuro fica agendado e ainda não tem resultados (ST5).
  const scheduled = watch('examDate') > todayISO()

  async function onSubmit({ results, ...values }: FormValues) {
    try {
      const examination = await examinationService.createExamination(family?.id ?? '', user?.id ?? '', {
        ...values,
        results: scheduled ? [] : results.map(toResultInput),
      })
      toast.show(scheduled ? 'Exame agendado.' : 'Exame registado.')
      navigate(paths.examination(examination.id), { replace: true })
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
          label="Tipo de exame"
          placeholder="Ex.: Análises clínicas"
          error={errors.name?.message}
          {...register('name')}
        />
        <Input
          label="Data"
          type="date"
          error={errors.examDate?.message}
          hint={scheduled ? 'Data futura: o exame fica agendado.' : undefined}
          {...register('examDate')}
        />
        <Input
          label="Clínica/Laboratório (opcional)"
          placeholder="Ex.: Laboratório Vida Plena"
          list={clinicListId}
          {...register('clinicName')}
        />
        <datalist id={clinicListId}>
          {clinics.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </div>

      {!scheduled && (
        <DetailSection title="Resultados">
          {fields.map((field, index) => (
            <ResultFields
              key={field.id}
              index={index}
              register={register}
              errors={errors.results?.[index]}
              onRemove={() => remove(index)}
            />
          ))}
          <Button variant="soft" onClick={() => append(emptyResult())} icon={<Plus className="size-4" aria-hidden />}>
            Adicionar resultado
          </Button>
          <p className="text-sm text-muted">
            Copie os valores e as referências do boletim. A Vita Family guarda-os sem os interpretar.
          </p>
        </DetailSection>
      )}

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
          Guardar exame
        </Button>
        <ButtonLink to={paths.examinations} variant="ghost" size="lg" className="sm:flex-1">
          Cancelar
        </ButtonLink>
      </div>
    </form>
  )
}

/** Registar exame (UC-EXM-01/02/03), com vários resultados e documento. */
export function NewExaminationPage() {
  const { user, family, member } = useAuth()
  const familyId = family?.id ?? ''
  const userId = user?.id ?? ''
  const { state, reload } = useAsync(
    () =>
      Promise.all([familyService.listManagedMembers(familyId, userId), examinationService.listClinicNames(familyId)]),
    [familyId, userId],
  )

  return (
    <Page title="Adicionar exame" backTo={paths.examinations} backLabel="Exames">
      {state.status === 'loading' && <LoadingState rows={4} />}
      {state.status === 'error' && <ErrorState onRetry={reload} />}
      {state.status === 'success' && (
        <NewExaminationForm members={state.data[0]} clinics={state.data[1]} selfMemberId={member?.id ?? ''} />
      )}
    </Page>
  )
}
