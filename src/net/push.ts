import { apiUrl, authHeaders } from '../api/client'

export type PushKind = 'call' | 'message'
export type PushFlags = { callNotifications: boolean; messageNotifications: boolean }
export type PushResult = 'ok' | 'blocked' | 'unsupported' | 'error'

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window
  )
}

function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (value.length % 4)) % 4)
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const bytes = new Uint8Array(raw.length)
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index)
  }
  return bytes
}

async function ensureRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  const existing = await navigator.serviceWorker.getRegistration()
  return existing ?? navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`)
}

async function saveSubscription(flags: PushFlags): Promise<boolean> {
  const registration = await ensureRegistration()
  if (!registration) return false
  let subscription = await registration.pushManager.getSubscription()
  const wantsPush = flags.callNotifications || flags.messageNotifications
  const endpoint = subscription?.endpoint ?? ''

  if (!wantsPush) {
    if (endpoint) {
      await fetch(apiUrl('/api/push-subscription'), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ endpoint }),
      }).catch(() => undefined)
    }
    await subscription?.unsubscribe().catch(() => false)
    return true
  }

  if (!subscription) {
    const response = await fetch(apiUrl('/api/vapid-public-key'))
    if (!response.ok) return false
    const data = (await response.json()) as { publicKey?: string }
    if (!data.publicKey) return false
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(data.publicKey),
    })
  }

  const saved = await fetch(apiUrl('/api/push-subscription'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      subscription: subscription.toJSON(),
      deviceId: localStorage.getItem('honden.signalId') ?? '',
      callNotifications: flags.callNotifications,
      messageNotifications: flags.messageNotifications,
    }),
  })
  return saved.ok
}

export async function setPushKind(
  kind: PushKind,
  enabled: boolean,
  current: PushFlags,
): Promise<PushResult> {
  if (!pushSupported()) return 'unsupported'
  if (enabled && Notification.permission !== 'granted') {
    const permission = await Notification.requestPermission()
    if (permission === 'denied') return 'blocked'
    if (permission !== 'granted') return 'error'
  }
  const next: PushFlags =
    kind === 'call'
      ? { ...current, callNotifications: enabled }
      : { ...current, messageNotifications: enabled }
  try {
    return (await saveSubscription(next)) ? 'ok' : 'error'
  } catch {
    return 'error'
  }
}
