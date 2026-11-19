import { useEffect, useState } from 'react'
import type { GifResult } from '../types'

type Props = {
  onEmoji: (emoji: string) => void
  onGif: (gif: GifResult) => void
  onClose: () => void
}

const emojiGroups = [
  {
    name: 'Smileys',
    items: ['😀', '😃', '😄', '😁', '😂', '🙂', '😉', '😍', '🥰', '😎', '🤔', '😴'],
  },
  {
    name: 'Hearts & vibes',
    items: ['❤️', '💜', '💙', '💚', '✨', '🔥', '🌟', '💫', '🎉', '🌈', '🫶', '💖'],
  },
  {
    name: 'Gestures',
    items: ['👍', '👎', '👏', '🙌', '🤝', '✌️', '🤞', '👀', '🫡', '💪', '🙏', '👋'],
  },
  {
    name: 'Symbols',
    items: ['✅', '❌', '⚡', '🔒', '🔑', '💬', '📎', '🎧', '🎮', '🛡️', '⏳', '🚀'],
  },
]

const fallbackGifs: GifResult[] = [
  {
    id: 'wave',
    title: 'Wave',
    url: 'https://media.giphy.com/media/xT9IgG50Fb7Mi0prBC/giphy.gif',
    preview: 'https://media.giphy.com/media/xT9IgG50Fb7Mi0prBC/200.gif',
  },
  {
    id: 'yes',
    title: 'Yes',
    url: 'https://media.giphy.com/media/l0HlE5QZdo4q53MtW/giphy.gif',
    preview: 'https://media.giphy.com/media/l0HlE5QZdo4q53MtW/200.gif',
  },
  {
    id: 'celebrate',
    title: 'Celebrate',
    url: 'https://media.giphy.com/media/26BRv0ThflsHCqDrG/giphy.gif',
    preview: 'https://media.giphy.com/media/26BRv0ThflsHCqDrG/200.gif',
  },
  {
    id: 'thumbs',
    title: 'Thumbs up',
    url: 'https://media.giphy.com/media/5yLgoc7NuyHk4/giphy.gif',
    preview: 'https://media.giphy.com/media/5yLgoc7NuyHk4/200.gif',
  },
  {
    id: 'hello',
    title: 'Hello',
    url: 'https://media.giphy.com/media/3o6ZsYHnkgNWWa2K2U/giphy.gif',
    preview: 'https://media.giphy.com/media/3o6ZsYHnkgNWWa2K2U/200.gif',
  },
  {
    id: 'love',
    title: 'Love',
    url: 'https://media.giphy.com/media/3o7TKsQ8UyQZ2J7b2U/giphy.gif',
    preview: 'https://media.giphy.com/media/3o7TKsQ8UyQZ2J7b2U/200.gif',
  },
]

function validUrl(value: string) {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export default function MediaPicker({ onEmoji, onGif, onClose }: Props) {
  const [tab, setTab] = useState<'emoji' | 'gif'>('emoji')
  const [query, setQuery] = useState('')
  const [customUrl, setCustomUrl] = useState('')
  const [results, setResults] = useState<GifResult[]>(fallbackGifs)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const apiKey = import.meta.env.VITE_GIPHY_API_KEY

  useEffect(() => {
    if (tab !== 'gif') return

    const term = query.trim().toLowerCase()
    const filteredPresets = fallbackGifs.filter(
      (gif) => !term || gif.title.toLowerCase().includes(term),
    )

    if (!apiKey) {
      setResults(filteredPresets)
      setError('')
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setLoading(true)
      setError('')
      try {
        const base = term
          ? 'https://api.giphy.com/v1/gifs/search'
          : 'https://api.giphy.com/v1/gifs/trending'
        const params = new URLSearchParams({
          api_key: apiKey,
          limit: '12',
        })
        if (term) params.set('q', term)
        const response = await fetch(`${base}?${params.toString()}`, {
          signal: controller.signal,
        })
        if (!response.ok) throw new Error('Giphy request failed')
        const payload = (await response.json()) as {
          data?: Array<{
            id: string
            title: string
            images?: { fixed_height?: { url?: string } }
          }>
        }
        const gifs = (payload.data ?? [])
          .map((item) => ({
            id: item.id,
            title: item.title,
            url: item.images?.fixed_height?.url ?? '',
            preview: item.images?.fixed_height?.url ?? '',
          }))
          .filter((item) => validUrl(item.url))
        setResults(gifs)
      } catch (cause) {
        if ((cause as Error).name !== 'AbortError') {
          setError('GIF search unavailable — showing local presets.')
          setResults(filteredPresets)
        }
      } finally {
        setLoading(false)
      }
    }, term ? 300 : 0)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [tab, query, apiKey])

  return (
    <div className="absolute bottom-16 left-4 z-40 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-cyan-300/20 bg-[#080d1b]/95 shadow-[0_0_45px_rgba(34,211,238,0.18)] backdrop-blur-xl">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setTab('emoji')}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              tab === 'emoji'
                ? 'bg-cyan-400/15 text-cyan-100'
                : 'text-slate-400 hover:text-slate-100'
            }`}
          >
            Emoji
          </button>
          <button
            type="button"
            onClick={() => setTab('gif')}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              tab === 'gif'
                ? 'bg-fuchsia-400/15 text-fuchsia-100'
                : 'text-slate-400 hover:text-slate-100'
            }`}
          >
            GIF
          </button>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close picker"
          className="rounded-lg px-2 py-1 text-slate-400 transition hover:bg-white/5 hover:text-white"
        >
          ✕
        </button>
      </div>

      {tab === 'emoji' ? (
        <div className="max-h-72 overflow-y-auto p-3">
          {emojiGroups.map((group) => (
            <div key={group.name} className="mb-3 last:mb-0">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                {group.name}
              </p>
              <div className="grid grid-cols-8 gap-1">
                {group.items.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => onEmoji(emoji)}
                    className="rounded-lg p-1 text-xl transition hover:bg-white/10 hover:scale-110"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="p-3">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={apiKey ? 'Search GIPHY…' : 'Filter presets…'}
            className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-cyan-300/40"
          />
          {!apiKey && (
            <p className="mt-2 text-[11px] text-slate-500">
              Add VITE_GIPHY_API_KEY to .env to search GIPHY. Presets work offline.
            </p>
          )}
          {error && <p className="mt-2 text-[11px] text-amber-300">{error}</p>}
          {loading && <p className="mt-2 text-[11px] text-cyan-300">Searching…</p>}

          <div className="mt-3 grid max-h-52 grid-cols-3 gap-2 overflow-y-auto">
            {results.map((gif) => (
              <button
                key={gif.id}
                type="button"
                title={gif.title}
                onClick={() => onGif(gif)}
                className="overflow-hidden rounded-lg border border-white/10 bg-black/40 transition hover:border-cyan-300/40"
              >
                <img src={gif.preview || gif.url} alt={gif.title} className="h-20 w-full object-cover" />
              </button>
            ))}
          </div>

          <div className="mt-3 flex gap-2">
            <input
              value={customUrl}
              onChange={(event) => setCustomUrl(event.target.value)}
              placeholder="Paste GIF URL"
              className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-100 outline-none placeholder:text-slate-500 focus:border-fuchsia-300/40"
            />
            <button
              type="button"
              disabled={!validUrl(customUrl)}
              onClick={() => {
                onGif({
                  id: 'custom',
                  title: 'Custom GIF',
                  url: customUrl,
                  preview: customUrl,
                })
                setCustomUrl('')
              }}
              className="rounded-xl bg-fuchsia-400/20 px-3 py-2 text-xs font-semibold text-fuchsia-100 transition hover:bg-fuchsia-400/30 disabled:opacity-40"
            >
              Use
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
