import { Outlet } from 'react-router-dom'
import { useState, type ReactNode } from 'react'
import {
  Bell,
  ChevronRight,
  CircleHelp,
  Download,
  FileText,
  HeartPulse,
  House,
  KeyRound,
  LockKeyhole,
  LogOut,
  Share,
  Share2,
  Sparkles,
  ShieldCheck,
  UserRound,
  Users,
  Watch,
  type LucideIcon,
} from 'lucide-react'
import { AccordionSection } from '@/components/app/Accordion'
import type { Tone } from '@/lib/tones'
import { ListEntry } from '@/components/app/ListEntry'
import { ConfirmSheet } from '@/components/app/Sheet'
import { Page } from '@/components/layout/Page'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { DetailSection } from '@/components/ui/InfoList'
import { Modal } from '@/components/ui/Modal'
import { useAuth } from '@/contexts/AuthContext'
import { useAiEnabled } from '@/hooks/useAiEnabled'
import { promptInstall, useInstallMode } from '@/lib/install'
import { paths } from '@/routes/paths'

interface SettingsItem {
  to: string
  label: string
  description?: string
  icon: LucideIcon
  tone?: Tone
}

function SettingsGroup({ items }: { items: SettingsItem[] }) {
  return (
    <ul className="flex flex-col">
      {items.map(({ to, label, description, icon, tone }) => (
        <li key={to}>
          <ListEntry to={to} icon={icon} title={label} subtitle={description} tone={tone} />
        </li>
      ))}
    </ul>
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
      <div className="py-1">
        <button
          type="button"
          onClick={() => (mode === 'prompt' ? void promptInstall() : setIosHelp(true))}
          className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 px-2 py-3 text-left transition-colors hover:bg-surface-muted"
        >
          <RowIcon icon={Download} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="font-medium">Instalar aplicação</span>
            <span className="truncate text-sm text-muted">Abrir o Vita Family a partir do ecrã principal</span>
          </span>
          <ChevronRight className="size-5 shrink-0 text-muted" aria-hidden />
        </button>
      </div>
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

/** Perfil (prompt §41): quem sou, atalhos da família e, em acordeões, conta, preferências e suporte. */
export function SettingsPage() {
  const { user, family, member, logout } = useAuth()
  const [leaving, setLeaving] = useState(false)
  const aiEnabled = useAiEnabled()
  const name = member?.name ?? user?.name ?? ''

  const shortcuts: SettingsItem[] = [
    { to: paths.healthProfile, label: 'Meu perfil de saúde', description: 'Dados básicos, alergias e condições', icon: HeartPulse, tone: 'health' },
    { to: paths.family, label: 'A minha família', description: family?.name ?? 'Ver e adicionar membros', icon: Users, tone: 'family' },
    { to: paths.shares, label: 'Partilhas com profissionais', description: 'Quem pode ver os seus registos', icon: Share2 },
    { to: paths.watch, label: 'Relógio', description: 'Ligar e ver as medições', icon: Watch, tone: 'meds' },
    { to: paths.alerts, label: 'Alertas', description: 'O que precisa da sua atenção', icon: Bell, tone: 'chat' },
    // M18: só aparece com o assistente ligado no servidor (AI_ASSISTANT_ENABLED).
    ...(aiEnabled ? [{ to: paths.assistant, label: 'Assistente Vita', description: 'Explicar os números e orientar sintomas', icon: Sparkles } satisfies SettingsItem] : []),
  ]
  const groups: { title: string; summary: string; icon: LucideIcon; items: SettingsItem[] }[] = [
    {
      title: 'Conta e segurança',
      summary: user?.email ?? '',
      icon: UserRound,
      items: [
        { to: paths.settingsAccount, label: 'Minha conta', description: user?.email, icon: UserRound },
        { to: paths.settingsSecurity, label: 'Segurança', description: 'Palavra-passe', icon: KeyRound },
        { to: paths.settingsFamily, label: 'Família', description: family?.name, icon: House },
        { to: paths.settingsSharing, label: 'Permissões', description: 'O que partilha e o que vê', icon: LockKeyhole },
      ],
    },
    {
      title: 'Avisos e privacidade',
      summary: 'Notificações, exportar ou eliminar dados',
      icon: ShieldCheck,
      items: [
        { to: paths.settingsNotifications, label: 'Notificações', description: 'Canais e tipos de alerta', icon: Bell },
        { to: paths.settingsPrivacy, label: 'Privacidade', description: 'Exportar ou eliminar os seus dados', icon: ShieldCheck },
      ],
    },
    {
      title: 'Ajuda',
      summary: 'Ajuda, termos e política de privacidade',
      icon: CircleHelp,
      items: [
        { to: paths.settingsHelp, label: 'Ajuda', icon: CircleHelp },
        { to: paths.settingsTerms, label: 'Termos', icon: FileText },
        { to: paths.settingsPrivacyPolicy, label: 'Política de privacidade', icon: FileText },
      ],
    },
  ]

  return (
    <Page title="Perfil">
      <div className="flex items-center gap-4 pb-2">
        <Avatar name={name} size="xl" />
        <div className="min-w-0">
          <p className="truncate font-display text-[1.25rem] leading-tight font-semibold">{name}</p>
          {family?.name && <p className="truncate text-lg text-muted">{family.name}</p>}
        </div>
      </div>

      <ul className="flex flex-col">
        {shortcuts.map(({ to, label, description, icon, tone }) => (
          <li key={to}>
            <ListEntry to={to} icon={icon} title={label} subtitle={description} tone={tone} />
          </li>
        ))}
      </ul>

      <div className="flex flex-col">
        {groups.map(({ title, summary, icon, items }) => (
          <AccordionSection key={title} title={title} summary={summary} icon={icon}>
            <SettingsGroup items={items} />
          </AccordionSection>
        ))}
      </div>
      <InstallAppSection />

      <Button variant="danger-ghost" size="xl" fullWidth onClick={() => setLeaving(true)} icon={<LogOut className="size-6" aria-hidden />}>
        Sair
      </Button>
      {/* Formulários das Configurações (ex.: «Segurança») abrem como folha por cima desta lista. */}
      <Outlet />
      <ConfirmSheet
        open={leaving}
        title="Quer mesmo sair?"
        description="Para voltar a entrar, vai precisar do seu e-mail e da palavra-passe."
        yesLabel="Sim, sair"
        noLabel="Não, ficar"
        onYes={logout}
        onNo={() => setLeaving(false)}
      />
    </Page>
  )
}

/** Página de configurações com título e voltar às Configurações. */
export function SettingsSubPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Page title={title} backTo={paths.settings} backLabel="Perfil">
      {children}
    </Page>
  )
}
