import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/components/ui/Toast'
import { DEFAULT_NOTIFICATION_PREFERENCES } from '@/types/settings'

const push = vi.hoisted(() => ({
  enablePush: vi.fn(),
  disablePush: vi.fn(),
  hasDeviceSubscription: vi.fn(),
  pushSupport: vi.fn(),
}))
vi.mock('@/lib/push', async () => ({ ...(await vi.importActual<object>('@/lib/push')), ...push }))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
const put = vi.fn()
vi.mock('@/services/account.service', () => ({
  accountService: {
    getNotificationPreferences: async () => ({ ...DEFAULT_NOTIFICATION_PREFERENCES, pushEnabled: false }),
    putNotificationPreferences: (...args: unknown[]) => put(...args),
  },
}))

import { NotificationSettingsPage } from './NotificationSettingsPage'

const renderPage = () =>
  render(
    <MemoryRouter>
      <ToastProvider>
        <NotificationSettingsPage />
      </ToastProvider>
    </MemoryRouter>,
  )

beforeEach(() => {
  vi.clearAllMocks()
  push.pushSupport.mockReturnValue({ status: 'supported' })
  push.hasDeviceSubscription.mockResolvedValue(false)
  push.enablePush.mockResolvedValue({ status: 'supported' })
  push.disablePush.mockResolvedValue(undefined)
  put.mockImplementation(async (_u: string, prefs: unknown) => prefs)
})

describe('Definições de notificações — push (UC-ALR-06)', () => {
  it('ligar o push subscreve este dispositivo e guarda a preferência', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('switch', { name: /Notificações no dispositivo/ }))
    await waitFor(() => expect(put).toHaveBeenCalled())
    expect(push.enablePush).toHaveBeenCalledTimes(1)
    expect(put.mock.calls[0]?.[1]).toMatchObject({ pushEnabled: true })
  })

  it('sem autorização/suporte não guarda a preferência e explica porquê', async () => {
    push.enablePush.mockResolvedValue({ status: 'denied' })
    renderPage()
    fireEvent.click(await screen.findByRole('switch', { name: /Notificações no dispositivo/ }))
    expect(await screen.findByText(/bloqueadas neste navegador/)).toBeInTheDocument()
    expect(put).not.toHaveBeenCalled()
  })

  it('iOS fora da PWA instalada mostra como instalar', async () => {
    push.pushSupport.mockReturnValue({ status: 'ios-install-required' })
    renderPage()
    expect(await screen.findByText(/Adicionar ao ecrã principal/)).toBeInTheDocument()
  })
})
