import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import {
  prepareAndroidPush,
  setAndroidNotificationAdapterForTests,
  showAndroidCallAlert,
  showAndroidMessageAlert,
  type AndroidNotificationAdapter,
} from '../src/net/androidNotifications'
import { pushSupported, setPushKind } from '../src/net/push'

type FakeNotification = Record<string, unknown>

let assignedUrls: string[] = []
let sent: FakeNotification[] = []
let channels: Array<Record<string, unknown>> = []
let actionTypes: Array<Record<string, unknown>> = []
let removed: Array<{ id: number; tag?: string }> = []
let permission: NotificationPermission = 'granted'
let actionHandler: ((event: unknown) => void | Promise<void>) | null = null
let fetchCalls: Array<{ url: string; body: unknown }> = []

const fakeAdapter: AndroidNotificationAdapter = {
  isPermissionGranted: async () => permission === 'granted',
  requestPermission: async () => permission,
  createChannel: async (channel) => {
    channels.push(channel as unknown as Record<string, unknown>)
  },
  registerActionTypes: async (types) => {
    actionTypes.push(...(types as unknown as Array<Record<string, unknown>>))
  },
  onAction: async (callback) => {
    actionHandler = callback as (event: unknown) => void | Promise<void>
    return { unlisten() {} }
  },
  sendNotification: (options) => {
    sent.push(options as unknown as FakeNotification)
  },
  removeActive: async (notifications) => {
    removed.push(...notifications)
  },
}

function androidRuntime() {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: {
        hostname: 'tauri.localhost',
        assign(url: string) {
          assignedUrls.push(url)
        },
      },
    },
  })
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      userAgent: 'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 Chrome/120 Mobile',
    },
  })
}

beforeEach(() => {
  assignedUrls = []
  sent = []
  channels = []
  actionTypes = []
  removed = []
  permission = 'granted'
  actionHandler = null
  fetchCalls = []
  androidRuntime()
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (url: string, init?: RequestInit) => {
      fetchCalls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) })
      return { ok: true } as Response
    },
  })
  setAndroidNotificationAdapterForTests(fakeAdapter)
})

afterEach(() => {
  setAndroidNotificationAdapterForTests(null)
  Reflect.deleteProperty(globalThis, 'window')
  Reflect.deleteProperty(globalThis, 'navigator')
  Reflect.deleteProperty(globalThis, 'fetch')
})

test('Android Tauri uses native alerts instead of a Web Push subscription', async () => {
  assert.equal(pushSupported(), true)

  const result = await setPushKind('call', true, {
    callNotifications: false,
    messageNotifications: false,
  })
  assert.equal(result, 'ok')
  assert.deepEqual(
    channels.map((channel) => channel.id),
    ['honden-calls', 'honden-messages'],
  )
  assert.equal(actionTypes[0]?.id, 'honden-call-actions')
  assert.deepEqual(
    (actionTypes[0]?.actions as Array<Record<string, unknown>>).map((action) => action.id),
    ['accept', 'decline'],
  )

  permission = 'denied'
  setAndroidNotificationAdapterForTests(fakeAdapter)
  assert.equal(
    await setPushKind('call', true, {
      callNotifications: false,
      messageNotifications: false,
    }),
    'blocked',
  )
})

test('desktop Web Push support is unchanged', () => {
  Reflect.deleteProperty(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: { hostname: 'honden.onrender.com' },
      Notification: function Notification() {},
      PushManager: function PushManager() {},
    },
  })
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Firefox/135.0', serviceWorker: {} },
  })

  assert.equal(pushSupported(), true)
})

test('native call alerts carry only the caller name and call type', async () => {
  await showAndroidCallAlert(
    {
      callId: 'call-123',
      sender: '@Skypuppy',
      senderName: 'Skypuppy',
      kind: 'video',
    },
    true,
  )

  assert.equal(sent.length, 1)
  const alert = sent[0]
  assert.equal(alert.title, 'Incoming call from @skypuppy')
  assert.equal(alert.body, 'Video call')
  assert.equal(alert.channelId, 'honden-calls')
  assert.equal(alert.actionTypeId, 'honden-call-actions')
  assert.deepEqual(alert.extra, {
    type: 'incoming-call',
    callId: 'call-123',
    sender: 'skypuppy',
    senderName: 'Skypuppy',
    kind: 'video',
  })
  assert.ok(!JSON.stringify(alert).includes('text'))
  assert.ok(!JSON.stringify(alert).includes('message'))

  await showAndroidCallAlert(
    { callId: 'call-123', sender: 'skypuppy', kind: 'voice' },
    false,
  )
  assert.equal(sent.length, 1)
})

test('native message alerts never include message content', async () => {
  await showAndroidMessageAlert({ chatId: 'uwupentesting', sender: '@skypuppy' }, true)

  assert.equal(sent.length, 1)
  const alert = sent[0]
  assert.equal(alert.title, 'New message from @skypuppy')
  assert.equal(alert.body, 'New message')
  assert.deepEqual(alert.extra, {
    type: 'message',
    chatId: 'uwupentesting',
    sender: 'skypuppy',
  })

  await showAndroidMessageAlert({ chatId: 'uwupentesting', sender: '@skypuppy' }, false)
  assert.equal(sent.length, 1)
})

test('native Accept and Decline act on the matching call without Web Push', async () => {
  assert.equal(await prepareAndroidPush(), true)
  assert.ok(actionHandler)
  const extra = {
    type: 'incoming-call',
    callId: 'call-123',
    sender: 'skypuppy',
    senderName: 'Skypuppy',
    kind: 'video',
  }

  await actionHandler({ actionId: 'accept', notification: { extra } })
  assert.deepEqual(assignedUrls, [
    '/chats?callFrom=skypuppy&callId=call-123&callKind=video',
  ])

  await actionHandler({ actionId: 'decline', notification: { extra } })
  assert.deepEqual(assignedUrls, [
    '/chats?callFrom=skypuppy&callId=call-123&callKind=video',
  ])
  assert.equal(fetchCalls.length, 1)
  assert.match(fetchCalls[0].url, /\/api\/call-decline$/)
  assert.deepEqual(fetchCalls[0].body, { callId: 'call-123', to: 'skypuppy' })
  assert.equal(removed.length, 1)
  assert.ok(removed[0].id > 0)
})

test('tapping a native message alert opens the right chat', async () => {
  assert.equal(await prepareAndroidPush(), true)
  assert.ok(actionHandler)

  await actionHandler({
    actionId: 'tap',
    notification: {
      extra: { type: 'message', chatId: 'uwupentesting', sender: '@skypuppy' },
    },
  })

  assert.deepEqual(assignedUrls, ['/chats?chat=uwupentesting&from=skypuppy'])
})
