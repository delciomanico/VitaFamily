import type { ReactNode } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { TagInput } from '@/components/ui/TagInput'
import { isValidISODate, todayISO } from '@/lib/date'
import { bloodTypeOptions, sexOptions } from '@/lib/labels'
import type { HealthProfileInput } from '@/services/health.service'
import { BLOOD_TYPES, SEXES, type HealthProfile } from '@/types/health'

const schema = z.object({
  name: z.string().trim().min(2, 'Introduza o nome.'),
  birthDate: z
    .string()
    .refine(isValidISODate, 'Introduza a data de nascimento.')
    .refine((date) => date <= todayISO(), 'A data não pode ser futura.'),
  sex: z.enum(SEXES).or(z.literal('')),
  bloodType: z.enum(BLOOD_TYPES).or(z.literal('')),
  allergies: z.array(z.string()),
  conditions: z.array(z.string()),
})

type FormValues = z.infer<typeof schema>

export function profileToFormValues({ member, allergies, conditions }: HealthProfile): FormValues {
  return {
    name: member.name,
    birthDate: member.birthDate,
    sex: member.sex ?? '',
    bloodType: member.bloodType ?? '',
    allergies: allergies.map((a) => a.name),
    conditions: conditions.map((c) => c.name),
  }
}

interface HealthProfileFormProps {
  defaultValues: FormValues
  onSubmit: (input: HealthProfileInput) => Promise<void>
  submitLabel: string
  /** Ação secundária (ex.: “Pular por agora”). */
  secondaryAction?: ReactNode
}

/** Perfil de saúde: usado na configuração inicial e em “Editar perfil”. */
export function HealthProfileForm({ defaultValues, onSubmit, submitLabel, secondaryAction }: HealthProfileFormProps) {
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues })

  function submit({ sex, bloodType, ...values }: FormValues) {
    return onSubmit({ ...values, sex: sex || undefined, bloodType: bloodType || undefined })
  }

  return (
    <form onSubmit={handleSubmit(submit)} noValidate className="flex flex-col gap-4">
      <Input label="Nome" autoComplete="name" error={errors.name?.message} {...register('name')} />
      <Input
        label="Data de nascimento"
        type="date"
        max={todayISO()}
        error={errors.birthDate?.message}
        {...register('birthDate')}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Select label="Sexo" placeholder="Selecionar" options={sexOptions} {...register('sex')} />
        <Select label="Tipo sanguíneo" placeholder="Selecionar" options={bloodTypeOptions} {...register('bloodType')} />
      </div>
      <Controller
        control={control}
        name="allergies"
        render={({ field }) => (
          <TagInput label="Alergias" values={field.value} onChange={field.onChange} placeholder="Ex.: Penicilina" />
        )}
      />
      <Controller
        control={control}
        name="conditions"
        render={({ field }) => (
          <TagInput
            label="Condições de saúde"
            values={field.value}
            onChange={field.onChange}
            placeholder="Ex.: Asma"
          />
        )}
      />
      <div className="flex flex-col gap-2 pt-2">
        <Button type="submit" size="lg" fullWidth loading={isSubmitting}>
          {submitLabel}
        </Button>
        {secondaryAction}
      </div>
    </form>
  )
}
