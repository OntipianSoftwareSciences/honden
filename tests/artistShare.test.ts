import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { clampSeekTime, formatAudioTime, toggleAudio } from '../src/net/audioPlayer'
import { decryptText, deriveSharedKey, encryptText, createIdentity } from '../src/crypto/e2ee'
import {
  AUDIO_BAD_TYPE_MESSAGE,
  AUDIO_TOO_BIG_MESSAGE,
  MAX_AUDIO_BYTES,
  OWN_KO_FI_URL,
  decodeMomentPayload,
  encodeMomentPayload,
  isArtistAudioFile,
  normalizeArtistShare,
  normalizeKoFiUrl,
  validateArtistAudio,
} from '../src/net/artistShare'
import HoneyMoments from '../src/screens/HoneyMoments'
import type { ArtistShare, HoneyMoment } from '../src/types'

const songShare: ArtistShare = {
  artistName: '@sukar3tto',
  title: 'Honey Drums',
  songUrl: 'https://music.example/honey',
}

const audioShare: ArtistShare = {
  artistName: '@sukar3tto',
  title: 'Honey Drums',
  audio: {
    name: 'honey.mp3',
    size: 4 * 1024 * 1024,
    dataUrl: 'data:audio/mpeg;base64,SGVsbG8=',
  },
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

test('S21 .mp3: native audio picker posts a 24px music note and in-app player', () => {
  const nativePicker = readFileSync(
    new URL('../tauri-plugin-honden-fcm/android/src/main/java/com/honden/fcm/HondenFcmPlugin.kt', import.meta.url),
    'utf8',
  )
  assert.match(nativePicker, /kind == "audio"/)
  assert.match(nativePicker, /audio\/mpeg/)
  assert.match(nativePicker, /choose an \.mp3 or \.wav/)

  const payload = encodeMomentPayload({ description: 'from my S21', artist: audioShare })
  assert.ok(payload)
  assert.deepEqual(decodeMomentPayload(payload)?.artist, audioShare)

  const markup = render([moment({ artist: audioShare })])
  assert.match(markup, /🎵/)
  assert.match(markup, /font-size:24px/)
  assert.match(markup, /aria-label="Play"/)
  assert.match(markup, /aria-label="Seek audio"/)
  assert.match(markup, /honey\.mp3/)
  assert.doesNotMatch(markup, /autoplay/i)
})

test('pc .wav: desktop file type is accepted and renders the player', () => {
  assert.equal(isArtistAudioFile({ name: 'beat.WAV', type: 'audio/wav' }), true)
  const wavShare: ArtistShare = {
    ...audioShare,
    title: 'Piano sketch',
    audio: { name: 'beat.wav', size: 1024 * 1024, dataUrl: 'data:audio/wav;base64,SGVsbG8=' },
  }
  const payload = encodeMomentPayload({ description: 'from my pc', artist: wavShare })
  assert.ok(payload)
  assert.deepEqual(decodeMomentPayload(payload)?.artist, wavShare)
  const markup = render([moment({ artist: wavShare })])
  assert.match(markup, /🎵/)
  assert.match(markup, /aria-label="Seek audio"/)
  assert.match(markup, /beat\.wav/)
})

test('uploaded audio encrypts and decrypts through the same Moment path', async () => {
  const sender = await createIdentity()
  const recipient = await createIdentity()
  const senderKey = await deriveSharedKey(sender.privateKey, recipient.publicKey)
  const recipientKey = await deriveSharedKey(recipient.privateKey, sender.publicKey)
  const payload = encodeMomentPayload({ description: 'encrypted audio', artist: audioShare })
  assert.ok(payload)

  const decoded = decodeMomentPayload(await decryptText(await encryptText(payload, senderKey), recipientKey))
  assert.equal(decoded?.artist?.audio?.name, 'honey.mp3')
  assert.equal(decoded?.artist?.audio?.dataUrl, audioShare.audio?.dataUrl)
})

test('Play, Pause, and tap-to-seek work without autoplay', async () => {
  let paused = true
  let plays = 0
  let pauses = 0
  const fakeAudio = {
    get paused() { return paused },
    play: async () => { paused = false; plays += 1 },
    pause: () => { paused = true; pauses += 1 },
  }

  assert.equal(await toggleAudio(fakeAudio), true)
  assert.equal(paused, false)
  assert.equal(await toggleAudio(fakeAudio), false)
  assert.equal(paused, true)
  assert.equal(plays, 1)
  assert.equal(pauses, 1)

  assert.equal(clampSeekTime(60, 120), 60)
  assert.equal(clampSeekTime(-5, 120), 0)
  assert.equal(clampSeekTime(999, 120), 120)
  assert.equal(formatAudioTime(75), '1:15')
})

test('a regular photo Moment has no music note and no player', () => {
  const markup = render([moment({
    artist: undefined,
    mediaKind: 'image',
    mediaDataUrl: 'data:image/png;base64,AAAA',
  })])
  assert.doesNotMatch(markup, /🎵/)
  assert.doesNotMatch(markup, /Seek audio/)
  assert.match(markup, /<img/)
})

test('.txt and files over 50 MB are refused with clear messages', () => {
  assert.equal(
    validateArtistAudio({ name: 'notes.txt', type: 'text/plain', size: 1024 }),
    AUDIO_BAD_TYPE_MESSAGE,
  )
  assert.equal(
    validateArtistAudio({ name: 'huge.mp3', type: 'audio/mpeg', size: MAX_AUDIO_BYTES + 1 }),
    AUDIO_TOO_BIG_MESSAGE,
  )
  assert.equal(
    validateArtistAudio({ name: 'honey.mp3', type: 'audio/mpeg', size: 4 * 1024 * 1024 }),
    null,
  )
  assert.equal(
    normalizeArtistShare({ artistName: 'a', title: 't', songUrl: 'https://music.example/a', audio: audioShare.audio }),
    null,
  )
})
