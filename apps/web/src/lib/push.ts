import { apiFetch, hasApiBackend } from './apiClient'

/*
 * Subscrição Web Push (UC-ALR-06; openapi → addPushSubscription / deletePushSubscription).
 * A chave pública VAPID não é segredo e o contrato não tem endpoint para a obter: vem do build
 * (`VITE_VAPID_PUBLIC_KEY`, deve ser igual a `VAPID_PUBLIC_KEY` da API — deploy/.env.production.example).
 * Os handlers `push`/`notificationclick` estão em public/push-sw.js (importado pelo service worker).
 */

const SUBSCRIPTION_ID_KEY = 'vita.pushSubscriptionId'

/** Porque é que o push não está disponível neste dispositivo (para mostrar uma mensagem útil). */
export type PushSupport =
  | { status: 'supported' }
  | { status: 'ios-install-required' }
  | { status: 'unsupported' }
  | { status: 'not-configured' }
  | { status: 'denied' }

export const PUSH_UNAVAILABLE_MESSAGES: Record<Exclude<PushSupport['status'], 'supported'>, string> = {
  'ios-install-required':
    'No iPhone e iPad, os avisos só funcionam com a app instalada: no Safari, toque em Partilhar e depois em «Adicionar ao ecrã principal» (iOS 16.4 ou superior). Abra a app a partir do ícone e volte aqui.',
  unsupported: 'Este navegador não suporta notificações no dispositivo. Continuará a ver os alertas dentro da app e por e-mail.',
  'not-configured': 'As notificações no dispositivo ainda não estão configuradas neste servidor.',
  denied: 'As notificações estão bloqueadas neste navegador. Permita-as nas definições do navegador para este site e tente de novo.',
}

function vapidPublicKey(): string | undefined {
  const key = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined)?.trim()
  return key ? key : undefined
}

function isIos(): boolean {
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (/macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
  )
}

function isStandalone(): boolean {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true
  return iosStandalone || window.matchMedia?.('(display-mode: standalone)').matches === true
}

/** O que este dispositivo/navegador consegue fazer; `denied` quando o utilizador já bloqueou. */
export function pushSupport(key: string | undefined = vapidPublicKey()): PushSupport {
  const hasApis =
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window &&
    'Notification' in window
  // iOS (16.4+) só expõe a Push API a PWAs instaladas; no Safari normal faltam `PushManager`/`Notification`.
  if (!hasApis) return { status: isIos() && !isStandalone() ? 'ios-install-required' : 'unsupported' }
  if (!key) return { status: 'not-configured' }
  if (Notification.permission === 'denied') return { status: 'denied' }
  return { status: 'supported' }
}

/** Converte a chave VAPID (base64url) no formato exigido por `pushManager.subscribe`. */
export function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padded = base64Url + '='.repeat((4 - (base64Url.length % 4)) % 4)
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i)
  return bytes
}

interface PushSubscriptionResponse {
  id: string
}

/** `serviceWorker.ready` nunca resolve sem service worker registado (ex.: `vite dev`): não prender a UI. */
function readyRegistration(timeoutMs = 8000): Promise<ServiceWorkerRegistration> {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('O service worker ainda não está ativo.')), timeoutMs),
    ),
  ])
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await readyRegistration()
  return registration.pushManager.getSubscription()
}

/** Há uma subscrição push deste navegador (independentemente de a API a conhecer). */
export async function hasDeviceSubscription(): Promise<boolean> {
  if (pushSupport().status === 'unsupported' || !('serviceWorker' in navigator)) return false
  try {
    return (await currentSubscription()) !== null
  } catch {
    return false
  }
}

/**
 * Pede autorização (tem de ser chamado a partir de um gesto do utilizador), subscreve o
 * `PushManager` com a chave VAPID e regista a subscrição na API. Devolve o motivo se não for possível.
 * Em modo demo (sem API) só pede a autorização.
 */
export async function enablePush(): Promise<PushSupport> {
  const support = pushSupport()
  if (support.status !== 'supported') return support
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
  if (permission !== 'granted') return { status: 'denied' }
  if (!hasApiBackend()) return { status: 'supported' }

  const key = vapidPublicKey()
  if (!key) return { status: 'not-configured' }
  const registration = await readyRegistration()
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) }))
  const json = subscription.toJSON()
  const p256dh = json.keys?.p256dh
  const auth = json.keys?.auth
  if (!json.endpoint || !p256dh || !auth) throw new Error('Subscrição push incompleta.')
  const saved = await apiFetch<PushSubscriptionResponse>('/users/me/push-subscriptions', {
    method: 'POST',
    body: { endpoint: json.endpoint, p256dh, auth, userAgent: navigator.userAgent.slice(0, 255) },
  })
  localStorage.setItem(SUBSCRIPTION_ID_KEY, saved.id)
  return { status: 'supported' }
}

/** Revoga a subscrição deste dispositivo: apaga-a na API e no `PushManager`. */
export async function disablePush(): Promise<void> {
  if (!('serviceWorker' in navigator)) return
  const id = localStorage.getItem(SUBSCRIPTION_ID_KEY)
  if (id && hasApiBackend()) {
    // 404: já não existe (ou era de outra conta neste dispositivo) — o objetivo é o mesmo.
    await apiFetch<void>(`/users/me/push-subscriptions/${id}`, { method: 'DELETE' }).catch(() => undefined)
  }
  localStorage.removeItem(SUBSCRIPTION_ID_KEY)
  const subscription = await currentSubscription().catch(() => null)
  await subscription?.unsubscribe().catch(() => undefined)
}
