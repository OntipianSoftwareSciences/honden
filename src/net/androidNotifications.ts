import { apiUrl, isTauriRuntime, type SignalEvent } from '../api/client'
import { callManager } from '../webrtc/callManager'
import type {
  ActionPerformed,
  ActionType,
  Channel,
  Importance,
  Options as NativeNotificationOptions,
  Visibility,
} from '@tauri-apps/plugin-notification'

type NativeListener = { unlisten: () => void | Promise<void> }

export type AndroidNotificationAdapter = {
  isPermissionGranted: () => Promise<boolean>
  requestPermission: () => Promise<NotificationPermission>
  createChannel: (channel: Channel) => Promise<void>
  registerActionTypes: (types: ActionType[]) => Promise<void>
  onAction: (callback: (event: ActionPerformed) => void) => Promise<NativeListener>
  sendNotification: (options: NativeNotificationOptions) => void
  removeActive: (notifications: Array<{ id: number; tag?: string }>) => Promise<void>
}

export type AndroidCallAlert = {
  callId: string
  sender: string
  senderName?: string
  kind?: 'voice' | 'video'
}

export type AndroidMessageAlert = {
  chatId: string
  sender: string
}

const CALL_CHANNEL = 'honden-calls'
const MESSAGE_CHANNEL = 'honden-messages'
const CALL_ACTIONS = 'honden-call-actions'

let adapterOverride: AndroidNotificationAdapter | null = null
let nativeAdapter: AndroidNotificationAdapter | null = null
let adapterPromise: Promise<AndroidNotificationAdapter | null> | null = null
let preparePromise: Promise<boolean> | null = null
let permissionGranted = false

export function isAndroidPushRuntime(): boolean {
  return (
    typeof window !== 'undefined' &&
    isTauriRuntime() &&
    typeof navigator !== 'undefined' &&
    /android/i.test(navigator.userAgent)
  )
}

async function loadAdapter(): Promise<AndroidNotificationAdapter | null> {
  if (adapterOverride) return adapterOverride
  if (nativeAdapter) return nativeAdapter
  if (!isAndroidPushRuntime()) return null
  if (!adapterPromise) {
    adapterPromise = import('@tauri-apps/plugin-notification')
      .then((plugin) => {
        nativeAdapter = plugin as unknown as AndroidNotificationAdapter
        return nativeAdapter
      })
      .catch(() => null)
  }
  return adapterPromise
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/^@/, '').toLowerCase() : ''
}

function notificationId(value: string): number {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0
  }
  return Math.abs(hash % 2_147_483_647) + 1
}

async function setupNativeAlerts(adapter: AndroidNotificationAdapter): Promise<boolean> {
  try {
    permissionGranted = await adapter.isPermissionGranted()
    await Promise.all([
      adapter.createChannel({
        id: CALL_CHANNEL,
        name: 'HonDen calls',
        description: 'Incoming voice and video calls.',
        importance: 4 as Importance,
        vibration: true,
        visibility: 1 as Visibility,
      }),
      adapter.createChannel({
        id: MESSAGE_CHANNEL,
        name: 'HonDen messages',
        description: 'New message alerts without message previews.',
        importance: 3 as Importance,
        vibration: true,
        visibility: 0 as Visibility,
      }),
      adapter.registerActionTypes([
        {
          id: CALL_ACTIONS,
          actions: [
            { id: 'accept', title: 'Accept' },
            { id: 'decline', title: 'Decline' },
          ],
        },
      ]),
    ])
    await adapter.onAction(handleNativeAction)
    return true
  } catch {
    return false
  }
}

export function prepareAndroidPush(): Promise<boolean> {
  if (!preparePromise) {
    preparePromise = loadAdapter().then((adapter) =>
      adapter ? setupNativeAlerts(adapter) : false,
    )
  }
  return preparePromise
}

export async function requestAndroidNotificationPermission(): Promise<
  NotificationPermission | 'unsupported'
> {
  // Keep the permission prompt in the Settings tap's user-gesture path.
  // prepareAndroidPush() has already loaded the adapter on app start.
  const adapter = adapterOverride ?? nativeAdapter
  if (!adapter) {
    const loaded = await loadAdapter()
    if (!loaded) return 'unsupported'
    return loaded.requestPermission()
  }
  if (permissionGranted) return 'granted'
  const result = await adapter.requestPermission()
  permissionGranted = result === 'granted'
  return result
}

export async function showAndroidCallAlert(
  alert: AndroidCallAlert,
  enabled: boolean,
): Promise<void> {
  if (!enabled) return
  const callId = typeof alert.callId === 'string' ? alert.callId.trim() : ''
  const sender = clean(alert.sender)
  if (!callId || !sender) return
  const adapter = await loadAdapter()
  if (!adapter || !(await adapter.isPermissionGranted())) return
  await prepareAndroidPush()
  const kind = alert.kind === 'video' ? 'video' : 'voice'
  const senderName =
    typeof alert.senderName === 'string' && alert.senderName.trim()
      ? alert.senderName.trim().replace(/^@/, '')
      : sender
  adapter.sendNotification({
    id: notificationId(`call:${callId}`),
    channelId: CALL_CHANNEL,
    actionTypeId: CALL_ACTIONS,
    title: `Incoming call from @${sender}`,
    body: kind === 'video' ? 'Video call' : 'Voice call',
    ongoing: true,
    autoCancel: false,
    visibility: 1 as Visibility,
    extra: {
      type: 'incoming-call',
      callId,
      sender,
      senderName,
      kind,
    },
  })
}

export async function showAndroidMessageAlert(
  alert: AndroidMessageAlert,
  enabled: boolean,
): Promise<void> {
  if (!enabled) return
  const chatId = typeof alert.chatId === 'string' ? alert.chatId.trim() : ''
  const sender = clean(alert.sender)
  if (!chatId || !sender) return
  const adapter = await loadAdapter()
  if (!adapter || !(await adapter.isPermissionGranted())) return
  await prepareAndroidPush()
  adapter.sendNotification({
    id: notificationId(`message:${chatId}:${sender}`),
    channelId: MESSAGE_CHANNEL,
    title: `New message from @${sender}`,
    body: 'New message',
    autoCancel: true,
    visibility: 0 as Visibility,
    extra: {
      type: 'message',
      chatId,
      sender,
    },
  })
}

export async function dismissAndroidCallAlert(callId: string): Promise<void> {
  if (!callId) return
  const adapter = await loadAdapter()
  if (!adapter) return
  try {
    await adapter.removeActive([{ id: notificationId(`call:${callId}`) }])
  } catch {
    // A dismissed notification is cosmetic; never break the call cleanup path.
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

async function handleNativeAction(event: ActionPerformed): Promise<void> {
  const extra = record(event.notification?.extra)
  const actionId = event.actionId === 'accept' || event.actionId === 'decline'
    ? event.actionId
    : 'tap'
  const type = extra.type

  if (type === 'incoming-call') {
    const callId = typeof extra.callId === 'string' ? extra.callId : ''
    const sender = clean(extra.sender)
    const kind = extra.kind === 'video' ? 'video' : 'voice'
    if (!callId || !sender) return

    if (actionId === 'decline') {
      callManager.handleReject({
        type: 'call:reject',
        callId,
        from: sender,
      } as SignalEvent)
      void fetch(apiUrl('/api/call-decline'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callId, to: sender }),
      }).catch(() => undefined)
      await dismissAndroidCallAlert(callId)
      return
    }

    if (actionId === 'accept') {
      const url = `/chats?callFrom=${encodeURIComponent(sender)}&callId=${encodeURIComponent(callId)}&callKind=${kind}`
      window.location.assign(url)
    } else {
      const url = `/chats?chat=${encodeURIComponent(sender)}&from=${encodeURIComponent(sender)}`
      window.location.assign(url)
    }
    return
  }

  if (type === 'message') {
    const chatId = typeof extra.chatId === 'string' ? clean(extra.chatId) : ''
    const sender = clean(extra.sender)
    if (!chatId || !sender) return
    window.location.assign(
      `/chats?chat=${encodeURIComponent(chatId)}&from=${encodeURIComponent(sender)}`,
    )
  }
}

/** Used by the push regression tests; never called in the app. */
export function setAndroidNotificationAdapterForTests(
  adapter: AndroidNotificationAdapter | null,
): void {
  adapterOverride = adapter
  nativeAdapter = null
  adapterPromise = null
  preparePromise = null
  permissionGranted = false
}
