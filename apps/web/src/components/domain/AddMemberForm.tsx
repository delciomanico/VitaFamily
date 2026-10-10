import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Plus } from 'lucide-react'
import { z } from 'zod'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { isValidISODate, todayISO } from '@/lib/date'
import { relationshipOptions } from '@/lib/labels'
import type { NewMemberInput } from '@/services/family.service'
import { RELATIONSHIPS } from '@/types/family'

const schema = z.object({
  name: z.string().trim().min(2, 'Introduza o nome.'),
  birthDate: z
    .string()
    .refine(isValidISODate, 'Introduza a data de nascimento.')
    .refine((date) => date <= todayISO(), 'A data não pode ser futura.'),
  relationship: z.enum(RELATIONSHIPS, { message: 'Escolha a relação.' }),
})

type FormValues = z.infer<typeof schema>

interface AddMemberFormProps {
  /** Devolve `true` se o membro foi adicionado (o formulário é então limpo). */
  onAdd: (input: NewMemberInput) => Promise<boolean>
}

/**
 * Novo membro sem conta. A data de nascimento é obrigatória no domínio (FamilyMember.birthDate);
 * a Relação é TBD (ver types/family.ts).
 */
export function AddMemberForm({ onAdd }: AddMemberFormProps) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  async function submit(values: FormValues) {
    if (await onAdd(values)) reset()
  }

  return (
    <form onSubmit={handleSubmit(submit)} noValidate className="flex flex-col gap-4">
      <Input label="Nome" error={errors.name?.message} {...register('name')} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Data de nascimento"
          type="date"
          max={todayISO()}
          error={errors.birthDate?.message}
          {...register('birthDate')}
        />
        <Select
          label="Relação"
          placeholder="Selecionar"
          options={relationshipOptions}
          error={errors.relationship?.message}
          {...register('relationship')}
        />
      </div>
      <Button type="submit" variant="secondary" size="lg" fullWidth loading={isSubmitting} icon={<Plus className="size-5" aria-hidden />}>
        Adicionar
      </Button>
    </form>
  )
}
