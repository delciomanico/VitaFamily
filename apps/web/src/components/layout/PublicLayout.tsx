import { Outlet } from 'react-router-dom'

/**
 * Telas públicas e de configuração inicial. Cada tela controla a sua coluna:
 * `AuthScreen` no mobile ocupa o ecrã e no desktop aparece como cartão centrado;
 * splash e onboarding ocupam o ecrã inteiro.
 */
export function PublicLayout() {
  return (
    <div className="flex min-h-dvh flex-col bg-surface md:justify-center md:bg-background">
      <main className="flex flex-1 flex-col md:flex-none">
        <Outlet />
      </main>
    </div>
  )
}
