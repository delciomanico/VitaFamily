import { useSyncExternalStore } from 'react'

/*
 * Instalação da PWA (prompt §5). Chrome/Edge/Android disparam `beforeinstallprompt` (guardado aqui para
 * instalar a partir das Configurações); o iOS não tem esse evento: instala-se pelo Safari, em Partilhar.
 */

/** Evento não normalizado (só Chromium); tipado aqui com o mínimo usado. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/** Como instalar neste dispositivo: pelo pedido do navegador, por instruções (iOS) ou não disponível. */
export type InstallMode = 'prompt' | 'ios' | 'none'

let deferred: BeforeInstallPromptEvent | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((listener) => listener())

function isStandalone(): boolean {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true
  return iosStandalone || window.matchMedia?.('(display-mode: standalone)').matches === true
}

function isIos(): boolean {
  // iPadOS identifica-se como Mac; distingue-se pelo ecrã tátil.
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (/macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
  )
}

/** Chamar uma vez no arranque, antes de o navegador disparar o evento. */
export function listenForInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    deferred = event as BeforeInstallPromptEvent
    notify()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    notify()
  })
}

function installMode(): InstallMode {
  if (isStandalone()) return 'none'
  if (deferred) return 'prompt'
  return isIos() ? 'ios' : 'none'
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useInstallMode(): InstallMode {
  return useSyncExternalStore(subscribe, installMode, () => 'none')
}

/** Abre o pedido de instalação do navegador; devolve true se o utilizador aceitou. */
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false
  const event = deferred
  await event.prompt()
  const { outcome } = await event.userChoice
  // O mesmo evento não pode ser usado duas vezes.
  deferred = null
  notify()
  return outcome === 'accepted'
}
