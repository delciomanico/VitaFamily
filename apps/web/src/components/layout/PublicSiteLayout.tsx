import { useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import { ButtonLink } from '@/components/ui/Button'
import { useAppEntry } from '@/hooks/useAppEntry'
import { cn } from '@/lib/cn'
import { site } from '@/lib/site'
import { paths } from '@/routes/paths'
import { Logo } from './Logo'

const links = [
  { to: `${paths.splash}#familias`, label: 'Famílias', hash: true },
  { to: paths.clinics, label: 'Clínicas', hash: false },
  { to: paths.partners, label: 'Rede de prestadores', hash: false },
  { to: paths.faq, label: 'Perguntas frequentes', hash: false },
  { to: paths.contact, label: 'Contacto', hash: false },
]

/** Cabeçalho, conteúdo e rodapé do site público. */
export function SiteFrame({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const appEntry = useAppEntry()
  const linkClass = 'whitespace-nowrap rounded-full px-4 py-2 text-base font-medium text-muted transition-colors hover:text-foreground'

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <a
        href="#conteudo"
        className="sr-only z-50 rounded-md bg-surface px-4 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Saltar para o conteúdo
      </a>
      <header className="sticky top-0 z-30 border-b border-border bg-surface/95 pt-safe backdrop-blur">
        <div className="mx-auto flex h-20 max-w-7xl items-center gap-4 px-5 lg:px-10">
          <Link to={paths.splash} aria-label="Vita Family, página inicial" className="shrink-0 whitespace-nowrap">
            <Logo />
          </Link>
          <nav aria-label="Principal" className="ml-6 hidden items-center gap-1 xl:flex">
            {links.map((link) =>
              link.hash ? (
                <a key={link.to} href={link.to} className={linkClass}>
                  {link.label}
                </a>
              ) : (
                <NavLink
                  key={link.to}
                  to={link.to}
                  className={({ isActive }) => cn(linkClass, isActive && 'text-foreground')}
                >
                  {link.label}
                </NavLink>
              ),
            )}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {appEntry ? (
              <ButtonLink to={appEntry}>
                Abrir a app
              </ButtonLink>
            ) : (
              <ButtonLink to={paths.enter}>
                Entrar
              </ButtonLink>
            )}
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              aria-expanded={open}
              aria-controls="menu-site"
              aria-label={open ? 'Fechar menu' : 'Abrir menu'}
              className="flex size-11 items-center justify-center rounded-full text-foreground hover:bg-surface-muted xl:hidden"
            >
              {open ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
            </button>
          </div>
        </div>
        {open && (
          <nav id="menu-site" aria-label="Menu" className="flex flex-col gap-1 border-t border-border px-4 py-3 xl:hidden">
            {links.map((link) =>
              link.hash ? (
                <a key={link.to} href={link.to} onClick={() => setOpen(false)} className={linkClass}>
                  {link.label}
                </a>
              ) : (
                <Link key={link.to} to={link.to} onClick={() => setOpen(false)} className={linkClass}>
                  {link.label}
                </Link>
              ),
            )}
          </nav>
        )}
      </header>

      <main id="conteudo" className="flex-1">
        {children}
      </main>

      <footer className="border-t border-border bg-surface">
        <div className="mx-auto grid max-w-7xl gap-10 px-5 py-16 pb-[max(4rem,env(safe-area-inset-bottom))] sm:grid-cols-3 lg:px-10">
          <div className="flex flex-col gap-3">
            <Logo />
            <p className="max-w-xs text-base text-muted">
              A saúde da família num só lugar, ligada às clínicas que a acompanham.
            </p>
          </div>
          <nav aria-label="Entrar" className="flex flex-col gap-3 text-base">
            <p className="font-semibold">Aceder</p>
            <Link to={paths.login} className="text-muted hover:text-foreground">
              Famílias
            </Link>
            <Link to={paths.clinics} className="text-muted hover:text-foreground">
              Clínicas
            </Link>
            <Link to={paths.partners} className="text-muted hover:text-foreground">
              Rede de prestadores
            </Link>
          </nav>
          <nav aria-label="Institucional" className="flex flex-col gap-3 text-base">
            <p className="font-semibold">Informação</p>
            <Link to={paths.faq} className="text-muted hover:text-foreground">
              Perguntas frequentes
            </Link>
            <Link to={paths.contact} className="text-muted hover:text-foreground">
              Contacto
            </Link>
            <Link to={paths.termsPublic} className="text-muted hover:text-foreground">
              Termos de utilização
            </Link>
            <Link to={paths.privacyPublic} className="text-muted hover:text-foreground">
              Política de privacidade
            </Link>
          </nav>
        </div>
        <p className="border-t border-border px-4 py-4 text-center text-xs text-muted">
          © {new Date().getFullYear()} {site.name} · operado por {site.operator}
        </p>
      </footer>
    </div>
  )
}

/** Layout das rotas públicas do site (usa `Outlet`). */
export function PublicSiteLayout() {
  return (
    <SiteFrame>
      <Outlet />
    </SiteFrame>
  )
}
