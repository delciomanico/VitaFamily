import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { listenForInstallPrompt, promptInstall, useInstallMode } from './install'

function installEvent(outcome: 'accepted' | 'dismissed') {
  return Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
    prompt: vi.fn(() => Promise.resolve()),
    userChoice: Promise.resolve({ outcome }),
  })
}

describe('instalação da PWA', () => {
  it('só oferece instalar depois do pedido do navegador, e uma só vez', async () => {
    listenForInstallPrompt()
    const { result } = renderHook(() => useInstallMode())
    expect(result.current).toBe('none')

    const event = installEvent('accepted')
    act(() => void window.dispatchEvent(event))
    expect(event.defaultPrevented).toBe(true)
    expect(result.current).toBe('prompt')

    let accepted = false
    await act(async () => {
      accepted = await promptInstall()
    })
    expect(event.prompt).toHaveBeenCalledOnce()
    expect(accepted).toBe(true)
    expect(result.current).toBe('none')
  })
})
