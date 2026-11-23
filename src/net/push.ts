import { apiUrl, authHeaders } from '../api/client'

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

export async function enableCallPush(): Promise<boolean> {
  if (!pushSupported()) return false
  try {
    const response = await fetch(apiUrl('/api/vapid-public-key'))
    if (!response.ok) return false
    const data = (await response.json()) as { publicKey?: string }
    if (!data.publicKey) return false
    if ((await Notification.requestPermission()) !== 'granted') return false

    const registration = await navigator.serviceWorker.ready
    let subscription = await registration.pushManager.getSubscription()
    if (!subscription) {
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
        callNotifications: true,
      }),
    })
    return saved.ok
  } catch {
    return false
  }
}

export async function disableCallPush(): Promise<void> {
  if (!pushSupported()) return
  try {
    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.getSubscription()
    if (!subscription) return
    await fetch(apiUrl('/api/push-subscription'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        subscription: subscription.toJSON(),
        deviceId: localStorage.getItem('honden.signalId') ?? '',
        callNotifications: false,
      }),
    })
  } catch {
    // Turning notifications off is best-effort; the server ignores disabled rows.
  }
}
