import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { decryptText, deriveSharedKey, encryptText, createIdentity } from '../src/crypto/e2ee'
import {
  OWN_KO_FI_URL,
  decodeMomentPayload,
  encodeMomentPayload,
  normalizeKoFiUrl,
} from '../src/net/artistShare'
import HoneyMoments from '../src/screens/HoneyMoments'
import type { ArtistShare, HoneyMoment } from '../src/types'

const songShare: ArtistShare = {
  artistName: '@sukar3tto',
  title: 'Honey Drums',
  songUrl: 'https://music.example/honey',
}

function moment(overrides: Partial<HoneyMoment> = {}): HoneyMoment {
  return {
    id: 'moment-1',
    threadId: '#honey-den',
    sender: 'sukar3tto',
    createdAt: '2026-01-01T00:00:00.000Z',
    description: 'A little honey beat',
    artist: songShare,
    koFiUrl: OWN_KO_FI_URL,
    heartedByMe: false,
    ...overrides,
  }
}

function render(moments: HoneyMoment[], ownUsername = 'sukar3tto'): string {
  return renderToStaticMarkup(
    createElement(HoneyMoments, {
      threadName: '#honey-den',
      moments,
      ownUsername,
      onBack: () => undefined,
      onCreate: async () => null,
      onDelete: async () => undefined,
      onHeart: () => undefined,
    }),
  )
}

test('post Artist share as @sukar3tto with a song', () => {
  const payload = encodeMomentPayload({
    description: 'A little honey beat',
    artist: songShare,
  })
  assert.ok(payload)
  assert.deepEqual(decodeMomentPayload(payload), {
    description: 'A little honey beat',
    artist: songShare,
  })

  const markup = render([moment()])
  assert.match(markup, /@sukar3tto/)
  assert.match(markup, /Honey Drums/)
  assert.match(markup, /https:\/\/music\.example\/honey/)
})

test('Artist share payload encrypts and decrypts like a DM', async () => {
  const sender = await createIdentity()
  const recipient = await createIdentity()
  const senderKey = await deriveSharedKey(sender.privateKey, recipient.publicKey)
  const recipientKey = await deriveSharedKey(recipient.privateKey, sender.publicKey)
  const payload = encodeMomentPayload({ description: 'private share', artist: songShare })
  assert.ok(payload)

  const wire = await encryptText(payload, senderKey)
  const decoded = decodeMomentPayload(await decryptText(wire, recipientKey))
  assert.equal(decoded?.artist?.title, 'Honey Drums')
  assert.equal(decoded?.description, 'private share')
})

test('Tip opens Ko-fi externally from a honey-gold 44px link', () => {
  const markup = render([moment()])
  assert.match(markup, /href="https:\/\/ko-fi\.com\/L7O32B7IIH"/)
  assert.match(markup, /target="_blank"/)
  assert.match(markup, /rel="noopener noreferrer"/)
  assert.match(markup, /Tip \$1/)
  assert.match(markup, /min-h-11 min-w-11[^"]*bg-warm-amber/)
})

test('an artist with no Ko-fi link shows no Tip button', () => {
  const markup = render([
    moment({ sender: 'otherartist', koFiUrl: null, artist: { ...songShare, artistName: 'Other Artist' } }),
  ])
  assert.doesNotMatch(markup, /Tip \$1/)
  assert.doesNotMatch(markup, /ko-fi\.com/)
})

test('Artist shares keep Delete and exactly one heart', () => {
  const markup = render([moment()])
  assert.match(markup, />Delete</)
  assert.match(markup, /aria-label="Heart this moment"/)
  assert.equal((markup.match(/♡/g) ?? []).length, 1)
})

test('Ko-fi links are strict and never become javascript or tracking links', () => {
  assert.equal(normalizeKoFiUrl('https://ko-fi.com/L7O32B7IIH'), OWN_KO_FI_URL)
  assert.equal(normalizeKoFiUrl('https://ko-fi.com/artist?ref=spam'), null)
  assert.equal(normalizeKoFiUrl('javascript:alert(1)'), null)
  assert.equal(normalizeKoFiUrl('https://evil.example/ko-fi.com/artist'), null)
})
