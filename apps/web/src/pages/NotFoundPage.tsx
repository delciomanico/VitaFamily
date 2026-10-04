import { Compass } from 'lucide-react'
import { ButtonLink } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/states'
import { paths } from '@/routes/paths'

export function NotFoundPage() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4">
      <EmptyState
        icon={Compass}
        title="Página não encontrada"
        description="O endereço que abriu não existe ou foi alterado."
        action={<ButtonLink to={paths.home}>Ir para o início</ButtonLink>}
      />
    </div>
  )
}
