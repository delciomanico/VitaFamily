import type { ReactNode } from 'react'
import {
  Bell,
  CircleHelp,
  FileText,
  House,
  KeyRound,
  LockKeyhole,
  LogOut,
  ShieldCheck,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { Page } from '@/components/layout/Page'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { DetailSection } from '@/components/ui/InfoList'
import { RowLink } from '@/components/ui/RowLink'
import { useAuth } from '@/contexts/AuthContext'
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
        {items.map(({ to, label, description, icon: Icon }) => (
          <RowLink key={to} to={to}>
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
              <Icon className="size-[1.125rem]" aria-hidden />
            </span>
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
    {
      title: 'Suporte',
      items: [
        { to: paths.settingsHelp, label: 'Ajuda', icon: CircleHelp },
        { to: paths.settingsTerms, label: 'Termos', icon: FileText },
        { to: paths.settingsPrivacyPolicy, label: 'Política de privacidade', icon: FileText },
      ],
    },
  ]

  return (
    <Page title="Configurações" backTo={paths.home} backLabel="Início">
      {groups.map((group) => (
        <SettingsGroup key={group.title} {...group} />
      ))}
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
