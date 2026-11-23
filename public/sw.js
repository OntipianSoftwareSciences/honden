const CACHE = 'honden-shell-v2'
const SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icon-192.png',
  '/icon-512.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    fetch('/index.html')
      .then((response) => response.text())
      .then((html) => {
        const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(
          (match) => match[1],
        )
        return caches.open(CACHE).then((cache) => cache.addAll([...SHELL, ...assets]))
      })
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = {}
  }
  if (!payload) return

  if (payload.type === 'message') {
    const chatId = String(payload.chatId || '')
    const sender = String(payload.sender || '').replace(/^@/, '')
    const senderName = String(payload.senderName || sender || 'someone')
    if (!chatId || !sender) return
    const url = `/chats?chat=${encodeURIComponent(chatId)}&from=${encodeURIComponent(sender)}`
    event.waitUntil(
      self.registration.showNotification(`New message from @${sender}`, {
        tag: `honden-message-${chatId}`,
        data: { type: 'message', chatId, sender, senderName, url },
      }),
    )
    return
  }

  if (payload.type === 'incoming-call') {
    const callId = String(payload.callId || '')
    const sender = String(payload.sender || '').replace(/^@/, '')
    const senderName = String(payload.senderName || sender || 'someone')
    const kind = payload.kind === 'video' ? 'video' : 'voice'
    if (!callId || !sender) return

    const url = `/chats?callFrom=${encodeURIComponent(sender)}&callId=${encodeURIComponent(callId)}&callKind=${kind}`
    event.waitUntil(
      self.registration.showNotification(`Incoming call from @${sender}`, {
        body: `${senderName} is ${kind} calling`,
        tag: `honden-call-${callId}`,
        renotify: true,
        requireInteraction: true,
        vibrate: [200, 100, 200, 100, 200],
        actions: [
          { action: 'accept', title: 'Accept' },
          { action: 'decline', title: 'Decline' },
        ],
        data: { type: 'incoming-call', callId, sender, senderName, kind, url },
      }),
    )
  }
})

self.addEventListener('notificationclick', (event) => {
  const notification = event.notification
  const data = notification.data || {}
  notification.close()
  if (data.type !== 'message' && data.type !== 'incoming-call') return

  if (data.type === 'incoming-call' && event.action === 'decline') {
    event.waitUntil(
      fetch('/api/call-decline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callId: data.callId, to: data.sender }),
      }).catch(() => undefined),
    )
    return
  }

  const url = new URL(data.url || '/chats', self.location.origin).href
  const message =
    data.type === 'incoming-call'
      ? {
          type: 'honden:call-action',
          action: 'accept',
          callId: data.callId,
          sender: data.sender,
          senderName: data.senderName,
          kind: data.kind,
        }
      : null
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(async (clients) => {
        const existing = clients.find((client) => client.url.startsWith(self.location.origin))
        if (existing) {
          await existing.navigate(url)
          existing.focus()
          if (message) existing.postMessage(message)
          return
        }
        const opened = await self.clients.openWindow(url)
        if (opened && message) {
          opened.postMessage(message)
          setTimeout(() => opened.postMessage(message), 750)
        }
      }),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone()
        event.waitUntil(
          caches.open(CACHE).then((cache) => cache.put(request, copy)),
        )
        return response
      })
      .catch(() =>
        caches.match(request).then(
          (cached) =>
            cached ||
            (request.mode === 'navigate'
              ? caches.match('/index.html')
              : Response.error()),
        ),
      ),
  )
})
