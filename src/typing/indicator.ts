export const TYPING_START_MS = 300
export const TYPING_STOP_MS = 3_000
export const TYPING_VISIBLE_MS = 5_000

export type TypingEntry = { username: string; expiresAt: number }
export type TypingMap = Record<string, TypingEntry[]>

export function formatTypingName(username: string): string {
  const name = username.trim().replace(/^@/, '').toLowerCase()
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : ''
}

/** A DM is named by the recipient on the sender's side and by the sender on ours. */
export function typingThreadId(
  chatId: string,
  sender: string,
  ownUsername: string,
  globalThreadId: string,
): string {
  if (chatId === globalThreadId) return globalThreadId
  return chatId === ownUsername ? sender : chatId
}

/** One line per chat, whoever is typing. No message content is involved. */
export function typingLabel(entries: TypingEntry[]): string {
  const names = entries.map((entry) => formatTypingName(entry.username)).filter(Boolean)
  if (names.length === 0) return ''
  if (names.length === 1) return `${names[0]} is typing...`
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing...`
  return `${names[0]}, ${names[1]} and ${names.length - 2} others are typing...`
}

export function pruneTyping(map: TypingMap, now = Date.now()): TypingMap {
  let changed = false
  const next: TypingMap = {}
  for (const [threadId, entries] of Object.entries(map)) {
    const live = entries.filter((entry) => entry.expiresAt > now)
    if (live.length !== entries.length) changed = true
    if (live.length > 0) next[threadId] = live
  }
  return changed ? next : map
}

export function updateTyping(
  map: TypingMap,
  threadId: string,
  username: string,
  isTyping: boolean,
  now = Date.now(),
): TypingMap {
  if (!threadId || !username) return map
  const current = pruneTyping(map, now)
  const next: TypingMap = { ...current }
  const remaining = (current[threadId] ?? []).filter((entry) => entry.username !== username)
  if (isTyping) remaining.push({ username, expiresAt: now + TYPING_VISIBLE_MS })
  if (remaining.length > 0) next[threadId] = remaining
  else delete next[threadId]
  return next
}
