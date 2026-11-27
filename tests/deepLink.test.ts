import assert from 'node:assert/strict'
import test from 'node:test'
import { parseDeepLink } from '../src/deepLink'

test('native call deep links route answer, decline and callback', () => {
  const accept = parseDeepLink(
    '?callFrom=@Sukar3tto&callId=call-1&callKind=voice&callAction=accept',
  )
  assert.equal(accept.callFrom, 'sukar3tto')
  assert.equal(accept.callId, 'call-1')
  assert.equal(accept.callKind, 'voice')
  assert.equal(accept.callAction, 'accept')

  const decline = parseDeepLink('?callFrom=sukar3tto&callId=call-1&callAction=decline')
  assert.equal(decline.callAction, 'decline')

  const callback = parseDeepLink('?callFrom=sukar3tto&callAction=callback&callKind=voice')
  assert.equal(callback.callAction, 'callback')

  const open = parseDeepLink(
    '?callFrom=@Heather&callId=call-2&callKind=video&callAction=open',
  )
  assert.equal(open.callAction, 'open')
})

test('legacy web push call links still auto-accept', () => {
  const link = parseDeepLink('?callFrom=sukar3tto&callId=call-1&callKind=video')
  assert.equal(link.callAction, null)
  assert.equal(link.callBack, false)
})
