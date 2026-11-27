import assert from 'node:assert/strict'
import test from 'node:test'
import { buildFcmCallRequest } from '../server/fcm'

test('FCM call push carries only call routing fields', () => {
  const request = buildFcmCallRequest('device-token', {
    type: 'incoming-call',
    callId: 'call-123',
    sender: 'sukar3tto',
    kind: 'voice',
  }) as {
    message: {
      token: string
      data: Record<string, unknown>
      android: { priority: string; ttl: string }
    }
  }

  assert.deepEqual(request, {
    message: {
      token: 'device-token',
      data: {
        type: 'incoming-call',
        callId: 'call-123',
        sender: 'sukar3tto',
        kind: 'voice',
      },
      android: { priority: 'high', ttl: '30s' },
    },
  })
  assert.deepEqual(Object.keys(request.message.data).sort(), [
    'callId',
    'kind',
    'sender',
    'type',
  ])
})

test('FCM call cancel uses the same minimal payload', () => {
  const request = buildFcmCallRequest('device-token', {
    type: 'call:cancel',
    callId: 'call-123',
    sender: 'sukar3tto',
    kind: 'video',
  }) as { message: { data: Record<string, unknown> } }

  assert.equal(request.message.data.type, 'call:cancel')
  assert.equal(request.message.data.kind, 'video')
  assert.deepEqual(Object.keys(request.message.data).sort(), [
    'callId',
    'kind',
    'sender',
    'type',
  ])
})
