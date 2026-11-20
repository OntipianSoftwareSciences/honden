import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canAccessConversation,
  createSecret,
  isAfterCursor,
  isOriginAllowed,
  isValidChatId,
  isValidMessageId,
  isValidMessageText,
  issueToken,
  verifyToken,
} from '../server/protocol'

const secret = createSecret('x'.repeat(40))
const now = 1_700_000_000_000

test('tokens verify, expire, and reject tampering', () => {
  const token = issueToken('mom', secret, now)
  assert.equal(verifyToken(token, secret, now + 1000), 'mom')
  assert.equal(verifyToken(token, secret, now + 7 * 24 * 60 * 60 * 1000 + 1), null)
  assert.equal(verifyToken(`${token}tampered`, secret, now), null)
  assert.equal(verifyToken(token, createSecret('y'.repeat(40)), now), null)
  assert.equal(verifyToken(undefined, secret, now), null)
})

test('origin allowlist permits same-origin clients', () => {
  const allowed = ['https://honden.onrender.com', 'tauri://localhost']
  assert.equal(isOriginAllowed(undefined, allowed), true)
  assert.equal(isOriginAllowed('https://honden.onrender.com', allowed), true)
  assert.equal(isOriginAllowed('https://evil.example', allowed), false)
})

test('conversation access is sender or recipient scoped', () => {
  assert.equal(canAccessConversation('mom', 'tau', 'tau'), true)
  assert.equal(canAccessConversation('mom', 'tau', 'sukar3tto'), false)
  assert.equal(canAccessConversation('mom', null, 'sukar3tto'), false)
})

test('server cursor advances forward only', () => {
  const cursor = { time: '2026-01-01T00:00:01.000Z', id: 'a' }
  assert.equal(isAfterCursor('2026-01-01T00:00:01.000Z', 'b', cursor), true)
  assert.equal(isAfterCursor('2026-01-01T00:00:01.000Z', 'a', cursor), false)
  assert.equal(isAfterCursor('2026-01-01T00:00:00.000Z', 'z', cursor), false)
})

test('message input validation rejects bad ids, chats, and payloads', () => {
  assert.equal(isValidMessageId('abc-123_DEF'), true)
  assert.equal(isValidMessageId('short'), false)
  assert.equal(isValidChatId('tau', '#honey-den'), true)
  assert.equal(isValidChatId('#honey-den', '#honey-den'), true)
  assert.equal(isValidChatId('*', '#honey-den'), false)
  assert.equal(isValidMessageText('hello'), true)
  assert.equal(isValidMessageText('   '), false)
  assert.equal(isValidMessageText('x'.repeat(17 * 1024)), false)
})
