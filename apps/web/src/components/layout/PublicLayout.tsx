import { Outlet } from 'react-router-dom'

/** Estrutura das telas públicas e de configuração inicial: coluna única centrada. */
export function PublicLayout() {
  return (
    <div className="flex min-h-dvh flex-col bg-background pt-safe pb-safe">
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-6 md:justify-center md:py-12">
        <Outlet />
      </main>
    </div>
  )
}
