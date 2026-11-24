import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, test } from 'node:test'
import Settings from '../src/screens/Settings'
import { applyTheme, readStoredTheme, type Settings as AppSettings } from '../src/hooks/useSettings'

const originals = new Map<string, unknown>()

function fakeGlobal(name: string, value: unknown) {
  if (!originals.has(name)) originals.set(name, (globalThis as Record<string, unknown>)[name])
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
}

afterEach(() => {
  for (const [name, value] of originals) {
    if (value === undefined) {
      Reflect.deleteProperty(globalThis, name)
    } else {
      Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
    }
  }
  originals.clear()
})

test('Queen Bee theme applies to the active theme root', () => {
  const attributes: Record<string, string> = {}
  fakeGlobal('document', {
    documentElement: {
      setAttribute(name: string, value: string) {
        attributes[name] = value
      },
    },
  })

  applyTheme('queen-bee')

  assert.equal(attributes['data-theme'], 'queen-bee')
})

test('Queen Bee theme choice is remembered from stored settings', () => {
  const store = new Map<string, string>()
  fakeGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
  })

  store.set('honden.settings', JSON.stringify({ theme: 'queen-bee' }))
  assert.equal(readStoredTheme(), 'queen-bee')

  store.set('honden.settings', JSON.stringify({ theme: 'not-a-theme' }))
  assert.equal(readStoredTheme(), 'light')
})

test('Queen Bee gold honey palette and surface overrides are defined', () => {
  const themeCss = readFileSync(new URL('../src/styles/theme.css', import.meta.url), 'utf8')
  const indexCss = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
  const queenBeeBlock = themeCss.split("html[data-theme='queen-bee']")[1] ?? ''

  assert.match(themeCss, /html\[data-theme='queen-bee'\]/)
  assert.match(queenBeeBlock, /--heart-pink:\s*#FF6B9D;/)
  assert.match(queenBeeBlock, /--warm-charcoal:\s*#FFF7F2;/)
  assert.match(queenBeeBlock, /--warm-cream:\s*#2A1E0D;/)
  assert.match(queenBeeBlock, /--surface:\s*#3B2A12;/)
  assert.match(queenBeeBlock, /--soft-blush:\s*#4E3716;/)
  assert.match(queenBeeBlock, /--soft-grey:\s*#F3D79B;/)
  assert.match(queenBeeBlock, /--warm-amber:\s*#F7B733;/)
  assert.match(queenBeeBlock, /--border:\s*#9A6B20;/)

  assert.doesNotMatch(queenBeeBlock, /#24122B/)
  assert.doesNotMatch(queenBeeBlock, /#3A2140/)
  assert.doesNotMatch(queenBeeBlock, /#4E2C49/)
  assert.doesNotMatch(queenBeeBlock, /#7A4A63/)

  assert.match(indexCss, /html\[data-theme='queen-bee'\] \[class\*='bg-white'\]/)
  assert.match(indexCss, /html\[data-theme='queen-bee'\] \[class\*='bg-warm-cream'\]/)
  assert.match(indexCss, /html\[data-theme='queen-bee'\] button\.bg-heart-pink/)
  assert.match(indexCss, /html\[data-theme='queen-bee'\] \.call-connected-pill[\s\S]*--warm-amber/)
  assert.match(indexCss, /html\[data-theme='queen-bee'\] \.call-avatar[\s\S]*--warm-amber/)
})

test('support section does not break Settings and Queen Bee is selectable', () => {
  const settings: AppSettings = {
    theme: 'queen-bee',
    readReceipts: false,
    gentleNotifications: true,
    callNotifications: false,
    largeText: false,
    simulateReplies: true,
    relayUrl: '',
    showGlobalChat: true,
    sounds: true,
    soundVolume: 0.35,
  }

  const markup = renderToStaticMarkup(
    createElement(Settings, {
      settings,
      update: () => undefined,
      layout: { label: 'Phone', columns: 1, compact: true } as never,
      onBack: () => undefined,
      relayState: 'off',
      peerCount: 0,
      inviteLink: 'https://example.invalid/invite',
      onNewInvite: () => undefined,
      installPrompt: null,
      onLogout: () => undefined,
    }),
  )

  assert.match(markup, />Settings</)
  assert.match(markup, />Back</)
  assert.match(markup, /aria-pressed="true"[^>]*>Queen Bee</)
  assert.match(markup, /Support us for more themes/)
  assert.match(markup, /no ads, no tracking, no selling your data/)
  assert.match(markup, /more themes, stickers, and sounds/)
  assert.match(
    markup,
    /href="https:\/\/ko-fi\.com\/L7O32B7IIH"/,
  )
  assert.match(markup, /Privacy/)
  assert.match(markup, /Messages are encrypted end-to-end/)
})
