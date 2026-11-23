import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { DetailSection } from '@/components/ui/InfoList'
import { Switch } from '@/components/ui/Switch'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { errorMessage } from '@/lib/errors'
import { disablePush, enablePush, hasDeviceSubscription, PUSH_UNAVAILABLE_MESSAGES, pushSupport } from '@/lib/push'
import { accountService } from '@/services/account.service'
import type { NotificationPreferences } from '@/types/settings'
import { SettingsSubPage } from './SettingsPage'

type Key = keyof NotificationPreferences

const channels: { key: Key; label: string; description: string }[] = [
  { key: 'pushEnabled', label: 'Notificações no dispositivo', description: 'Avisos push desta app.' },
  { key: 'emailEnabled', label: 'E-mail', description: 'Avisos no seu e-mail.' },
]

const types: { key: Key; label: string; description: string }[] = [
  {
    key: 'medicationDue',
    label: 'Tomas de medicamentos',
    description: 'À hora da toma e 15 min depois, se não confirmar.',
  },
  { key: 'appointmentReminder', label: 'Consultas', description: '24 h e 2 h antes.' },
  { key: 'examReminder', label: 'Exames', description: '24 h antes.' },
]

function Preferences({ initial, userId }: { initial: NotificationPreferences; userId: string }) {
  const toast = useToast()
  const [preferences, setPreferences] = useState(initial)
  const [saving, setSaving] = useState<Key | null>(null)
  const [support, setSupport] = useState(() => pushSupport())
  const [deviceOn, setDeviceOn] = useState<boolean | null>(null)

  useEffect(() => {
    let active = true
    void hasDeviceSubscription().then((on) => active && setDeviceOn(on))
    return () => {
      active = false
    }
  }, [])

  /** Autoriza, subscreve e regista este dispositivo (UC-ALR-06); devolve false (com aviso) se não for possível. */
  async function activateDevice(): Promise<boolean> {
    try {
      const result = await enablePush()
      setSupport(pushSupport())
      if (result.status !== 'supported') {
        toast.show(PUSH_UNAVAILABLE_MESSAGES[result.status], 'error')
        return false
      }
      setDeviceOn(true)
      return true
    } catch (error) {
      toast.show(errorMessage(error), 'error')
      return false
    }
  }

  async function toggle(key: Key, value: boolean) {
    if (key === 'pushEnabled' && value && !(await activateDevice())) return
    const next = { ...preferences, [key]: value }
    setSaving(key)
    try {
      setPreferences(await accountService.putNotificationPreferences(userId, next))
      if (key === 'pushEnabled' && !value) {
        await disablePush().catch(() => undefined)
        setDeviceOn(false)
      }
    } catch (error) {
      toast.show(errorMessage(error), 'error')
    } finally {
      setSaving(null)
    }
  }

  const rows = (items: typeof channels) => (
    <Card className="divide-y divide-border py-1">
      {items.map(({ key, label, description }) => (
        <Switch
          key={key}
          label={label}
          description={description}
          checked={preferences[key]}
          disabled={saving !== null}
          onChange={(value) => toggle(key, value)}
        />
      ))}
    </Card>
  )

  return (
    <>
      <DetailSection title="Canais">
        {rows(channels)}
        {support.status !== 'supported' && (
          <p className="text-sm text-muted" role="status">
            {PUSH_UNAVAILABLE_MESSAGES[support.status]}
          </p>
        )}
        {support.status === 'supported' && preferences.pushEnabled && deviceOn === false && (
          <Card className="flex flex-col gap-3 p-4">
            <p className="text-sm text-muted">Este dispositivo ainda não recebe avisos. Ative-os para os receber aqui.</p>
            <Button variant="soft" onClick={() => void activateDevice()}>
              Ativar neste dispositivo
            </Button>
          </Card>
        )}
        <p className="text-sm text-muted">
          Fora da app, os avisos não mostram nomes, horas nem dados de saúde. Os detalhes só aparecem dentro da app.
        </p>
      </DetailSection>
      <DetailSection title="Tipos de alerta">
        {rows(types)}
        <p className="text-sm text-muted">
          Desativar um tipo deixa de criar esses alertas para si, também na app. As respostas da clínica e os pedidos
          para atualizar consultas passadas chegam sempre.
        </p>
      </DetailSection>
    </>
  )
}

/** Notificações (UC-ALR-05): canais ativos e tipos de alerta, por conta. */
export function NotificationSettingsPage() {
  const { user } = useAuth()
  const userId = user?.id ?? ''
  const { state, reload } = useAsync(() => accountService.getNotificationPreferences(userId), [userId])

  return (
    <SettingsSubPage title="Notificações">
      {state.status === 'loading' && <LoadingState rows={3} />}
      {state.status === 'error' && <ErrorState onRetry={reload} />}
      {state.status === 'success' && <Preferences initial={state.data} userId={userId} />}
    </SettingsSubPage>
  )
}
