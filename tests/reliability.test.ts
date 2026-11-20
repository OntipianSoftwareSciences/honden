import assert from 'node:assert/strict'
import test from 'node:test'
import {
  advanceCursor,
  isAfterCursor,
  mergeById,
  reconnectDelay,
} from '../src/transport/reliability'

test('reconnectDelay backs off and caps at 30s', () => {
  assert.equal(reconnectDelay(0, () => 0.5), 1000)
  assert.equal(reconnectDelay(1, () => 0.5), 2000)
  assert.equal(reconnectDelay(20, () => 0.5), 30000)
  assert.ok(reconnectDelay(0, () => 0) >= 250)
  assert.ok(reconnectDelay(20, () => 1) <= 30000)
})

test('cursor compares time then id', () => {
  assert.equal(isAfterCursor('2026-01-01T00:00:01.000Z', 'b', null), true)
  assert.equal(
    isAfterCursor('2026-01-01T00:00:01.000Z', 'b', {
      time: '2026-01-01T00:00:01.000Z',
      id: 'a',
    }),
    true,
  )
  assert.equal(
    isAfterCursor('2026-01-01T00:00:01.000Z', 'a', {
      time: '2026-01-01T00:00:01.000Z',
      id: 'b',
    }),
    false,
  )
  assert.equal(
    isAfterCursor('2026-01-01T00:00:00.000Z', 'z', {
      time: '2026-01-01T00:00:01.000Z',
      id: 'a',
    }),
    false,
  )
})

test('advanceCursor only moves forward', () => {
  const start = { time: '2026-01-01T00:00:01.000Z', id: 'b' }
  assert.deepEqual(advanceCursor(null, start), start)
  assert.deepEqual(advanceCursor(start, { time: '2026-01-01T00:00:00.000Z', id: 'z' }), start)
  assert.deepEqual(advanceCursor(start, { time: '2026-01-01T00:00:02.000Z', id: 'a' }), {
    time: '2026-01-01T00:00:02.000Z',
    id: 'a',
  })
})

test('mergeById dedupes and sorts by timestamp', () => {
  const merged = mergeById(
    [
      { id: 'b', timestamp: 2, text: 'second' },
      { id: 'a', timestamp: 1, text: 'first' },
    ],
    [
      { id: 'b', timestamp: 2, text: 'duplicate' },
      { id: 'c', timestamp: 3, text: 'third' },
    ],
  )
  assert.deepEqual(
    merged.map((item) => item.id),
    ['a', 'b', 'c'],
  )
  assert.equal(merged[1]?.text, 'second')
})
