import { Compass } from 'lucide-react'
import { ButtonLink } from '@/components/ui/Button'
import { paths } from '@/routes/paths'

export function NotFoundPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-surface-muted text-muted">
        <Compass className="size-6" aria-hidden />
      </span>
      <h1 className="text-xl font-semibold">Página não encontrada</h1>
      <p className="text-sm text-muted">O endereço que abriu não existe ou foi alterado.</p>
      <ButtonLink to={paths.home}>Ir para o início</ButtonLink>
    </main>
  )
}
