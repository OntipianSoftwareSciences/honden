import type { EncryptedPayload } from '../crypto/e2ee'
import { mergeById } from '../transport/reliability'
import type { ChatMessage, MessageKind } from '../types'

export type StoredMessage = {
  id: string
  threadId: string
  senderId: string
  from: 'me' | 'them'
  time: string
  timestamp: number
  payload: EncryptedPayload
  text: string
}

export type OutboxMessage = {
  id: string
  threadId: string
  sender: string
  text: string
  plain: string
  time: string
  status: 'sending' | 'failed'
  kind?: MessageKind
  gifUrl?: string
}

export type Thread = {
  id: string
  name: string
  username: string
  createdAt: number
}

const THREADS_KEY = 'honden.threads.v2'
const MESSAGES_KEY = 'honden.messages.v1'
const CHAT_BACKUP_KEY = 'honden.chatMessages.v1'
const OUTBOX_KEY = 'honden.outbox.v1'
const fakeThreadNames = new Set(['al' + 'ex', 'that' + 'name', 'some' + 'one'])

export function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function normalizeUsername(value: string): string {
  return value.trim().replace(/^@/, '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '')
}

export function loadThreads(): Thread[] {
  try {
    const saved = localStorage.getItem(THREADS_KEY)
    if (!saved) return []
    const parsed: unknown = JSON.parse(saved)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is Thread => {
      if (
        !item ||
        typeof item !== 'object' ||
        typeof (item as Thread).id !== 'string' ||
        typeof (item as Thread).name !== 'string' ||
        typeof (item as Thread).username !== 'string'
      ) {
        return false
      }
      const thread = item as Thread
      return (
        !fakeThreadNames.has(normalizeUsername(thread.username)) &&
        !fakeThreadNames.has(normalizeUsername(thread.name))
      )
    })
  } catch {
    return []
  }
}

export function saveThreads(threads: Thread[]): void {
  localStorage.setItem(THREADS_KEY, JSON.stringify(threads))
}

export function createThread(name: string): Thread {
  const username = normalizeUsername(name) || 'someone'
  const thread: Thread = {
    id: username,
    name: name.trim() || 'Someone',
    username,
    createdAt: Date.now(),
  }
  saveThreads([...loadThreads(), thread])
  return thread
}

export function loadMessages(): StoredMessage[] {
  try {
    const saved = localStorage.getItem(MESSAGES_KEY)
    if (!saved) return []
    const parsed: unknown = JSON.parse(saved)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is StoredMessage =>
        Boolean(
          item &&
            typeof item === 'object' &&
            typeof (item as StoredMessage).id === 'string' &&
            typeof (item as StoredMessage).threadId === 'string' &&
            Boolean((item as StoredMessage).payload),
        ),
    )
  } catch {
    return []
  }
}

export function saveMessages(messages: StoredMessage[]): void {
  localStorage.setItem(MESSAGES_KEY, JSON.stringify(messages))
}

export function appendMessage(message: StoredMessage): void {
  const messages = loadMessages()
  if (messages.some((item) => item.id === message.id)) return
  saveMessages([...messages, message])
}

export function updateMessageText(id: string, text: string): void {
  const messages = loadMessages()
  const next = messages.map((item) => (item.id === id ? { ...item, text } : item))
  if (next.some((item, index) => item.text !== messages[index].text)) {
    saveMessages(next)
  }
}

export function removeMessage(id: string): void {
  saveMessages(loadMessages().filter((item) => item.id !== id))
}

export function messagesFor(threadId: string): StoredMessage[] {
  return loadMessages()
    .filter((item) => item.threadId === threadId)
    .sort((a, b) => a.timestamp - b.timestamp)
}

export function loadChatBackup(): ChatMessage[] {
  try {
    const saved = localStorage.getItem(CHAT_BACKUP_KEY)
    if (!saved) return []
    const parsed: unknown = JSON.parse(saved)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is ChatMessage =>
        Boolean(
          item &&
            typeof item === 'object' &&
            typeof (item as ChatMessage).id === 'string' &&
            typeof (item as ChatMessage).threadId === 'string' &&
            typeof (item as ChatMessage).text === 'string' &&
            typeof (item as ChatMessage).timestamp === 'number',
        ),
    )
  } catch {
    return []
  }
}

export function saveChatBackup(messages: ChatMessage[]): void {
  localStorage.setItem(CHAT_BACKUP_KEY, JSON.stringify(messages))
}

export function loadOutbox(): OutboxMessage[] {
  try {
    const saved = localStorage.getItem(OUTBOX_KEY)
    if (!saved) return []
    const parsed: unknown = JSON.parse(saved)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is OutboxMessage =>
        Boolean(
          item &&
            typeof item === 'object' &&
            typeof (item as OutboxMessage).id === 'string' &&
            typeof (item as OutboxMessage).threadId === 'string' &&
            typeof (item as OutboxMessage).sender === 'string' &&
            typeof (item as OutboxMessage).text === 'string' &&
            typeof (item as OutboxMessage).plain === 'string' &&
            typeof (item as OutboxMessage).time === 'string',
        ),
    )
  } catch {
    return []
  }
}

export function saveOutbox(items: OutboxMessage[]): void {
  localStorage.setItem(OUTBOX_KEY, JSON.stringify(items))
}

export function upsertOutbox(item: OutboxMessage): void {
  console.info('[outbox] queued', { id: item.id, threadId: item.threadId })
  const items = loadOutbox()
  const index = items.findIndex((entry) => entry.id === item.id)
  if (index >= 0) items[index] = item
  else items.push(item)
  saveOutbox(items)
}

export function updateOutboxStatus(id: string, status: OutboxMessage['status']): void {
  const items = loadOutbox().map((item) => (item.id === id ? { ...item, status } : item))
  saveOutbox(items)
}

export function removeOutbox(id: string): void {
  saveOutbox(loadOutbox().filter((item) => item.id !== id))
}

export function mergeChatMessages(
  current: ChatMessage[],
  incoming: ChatMessage[],
): ChatMessage[] {
  return mergeById(current, incoming)
}

export function subscribeStore(listener: () => void): () => void {
  const handler = (event: StorageEvent) => {
    if (
      event.key === THREADS_KEY ||
      event.key === MESSAGES_KEY ||
      event.key === CHAT_BACKUP_KEY
    ) {
      listener()
    }
  }
  window.addEventListener('storage', handler)
  return () => window.removeEventListener('storage', handler)
}
