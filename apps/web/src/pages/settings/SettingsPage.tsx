import { useState, type ReactNode } from 'react'
import {
  Bell,
  ChevronRight,
  CircleHelp,
  Download,
  FileText,
  House,
  KeyRound,
  LockKeyhole,
  LogOut,
  Share,
  ShieldCheck,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { Page } from '@/components/layout/Page'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { DetailSection } from '@/components/ui/InfoList'
import { Modal } from '@/components/ui/Modal'
import { RowLink } from '@/components/ui/RowLink'
import { useAuth } from '@/contexts/AuthContext'
import { promptInstall, useInstallMode } from '@/lib/install'
import { paths } from '@/routes/paths'

interface SettingsItem {
  to: string
  label: string
  description?: string
  icon: LucideIcon
}

function SettingsGroup({ title, items }: { title: string; items: SettingsItem[] }) {
  return (
    <DetailSection title={title}>
      <Card className="divide-y divide-border py-1">
        {items.map(({ to, label, description, icon }) => (
          <RowLink key={to} to={to}>
            <RowIcon icon={icon} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="font-medium">{label}</span>
              {description && <span className="truncate text-sm text-muted">{description}</span>}
            </span>
          </RowLink>
        ))}
      </Card>
    </DetailSection>
  )
}

function RowIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
      <Icon className="size-[1.125rem]" aria-hidden />
    </span>
  )
}

/**
 * Instalar a PWA (prompt §5): só aparece se ainda não estiver instalada e o dispositivo o permitir.
 * No iOS não há pedido do navegador; mostram-se os passos do Safari.
 */
function InstallAppSection() {
  const mode = useInstallMode()
  const [iosHelp, setIosHelp] = useState(false)
  if (mode === 'none') return null

  return (
    <DetailSection title="Aplicação">
      <Card className="py-1">
        <button
          type="button"
          onClick={() => (mode === 'prompt' ? void promptInstall() : setIosHelp(true))}
          className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-md px-2 py-3 text-left transition-colors hover:bg-surface-muted"
        >
          <RowIcon icon={Download} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="font-medium">Instalar aplicação</span>
            <span className="truncate text-sm text-muted">Abrir o Vita Family a partir do ecrã principal</span>
          </span>
          <ChevronRight className="size-5 shrink-0 text-muted" aria-hidden />
        </button>
      </Card>
      <Modal
        open={iosHelp}
        onClose={() => setIosHelp(false)}
        title="Instalar no iPhone ou iPad"
        footer={
          <Button fullWidth onClick={() => setIosHelp(false)}>
            Entendi
          </Button>
        }
      >
        <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm">
          <li>Abra o Vita Family no Safari.</li>
          <li>
            Toque em Partilhar <Share className="inline size-4 align-text-bottom" aria-label="(ícone Partilhar)" />.
          </li>
          <li>Escolha “Adicionar ao ecrã principal”.</li>
        </ol>
      </Modal>
    </DetailSection>
  )
}

/** Configurações (prompt §41): conta, família, notificações, privacidade e ajuda. */
export function SettingsPage() {
  const { user, family, logout } = useAuth()

  const groups: { title: string; items: SettingsItem[] }[] = [
    {
      title: 'Conta',
      items: [
        { to: paths.settingsAccount, label: 'Minha conta', description: user?.email, icon: UserRound },
        { to: paths.settingsSecurity, label: 'Segurança', description: 'Palavra-passe', icon: KeyRound },
      ],
    },
    {
      title: 'Família',
      items: [
        { to: paths.settingsFamily, label: 'Família', description: family?.name, icon: House },
        { to: paths.family, label: 'Membros', description: 'Ver e adicionar membros', icon: Users },
        { to: paths.settingsSharing, label: 'Permissões', description: 'O que partilha e o que vê', icon: LockKeyhole },
      ],
    },
    {
      title: 'Preferências',
      items: [
        { to: paths.settingsNotifications, label: 'Notificações', description: 'Canais e tipos de alerta', icon: Bell },
        {
          to: paths.settingsPrivacy,
          label: 'Privacidade',
          description: 'Exportar ou eliminar os seus dados',
          icon: ShieldCheck,
        },
      ],
    },
  ]
  const support: SettingsItem[] = [
    { to: paths.settingsHelp, label: 'Ajuda', icon: CircleHelp },
    { to: paths.settingsTerms, label: 'Termos', icon: FileText },
    { to: paths.settingsPrivacyPolicy, label: 'Política de privacidade', icon: FileText },
  ]

  return (
    <Page title="Configurações" backTo={paths.home} backLabel="Início">
      {groups.map((group) => (
        <SettingsGroup key={group.title} {...group} />
      ))}
      <InstallAppSection />
      <SettingsGroup title="Suporte" items={support} />
      <Button
        variant="danger-ghost"
        size="lg"
        fullWidth
        onClick={logout}
        icon={<LogOut className="size-5" aria-hidden />}
      >
        Sair
      </Button>
    </Page>
  )
}

/** Página de configurações com título e voltar às Configurações. */
export function SettingsSubPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Page title={title} backTo={paths.settings} backLabel="Configurações">
      {children}
    </Page>
  )
}
