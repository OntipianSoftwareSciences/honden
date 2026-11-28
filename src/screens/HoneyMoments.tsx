import { useEffect, useMemo, useRef, useState } from 'react'
import type { HoneyMoment } from '../types'

type Props = {
  threadName: string
  moments: HoneyMoment[]
  ownUsername: string
  onBack: () => void
  onCreate: (input: { description: string; file: File }) => Promise<string | null>
  onDelete: (id: string) => Promise<void>
  onHeart: (id: string) => void
}

const MAX_DESC = 200
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_VIDEO_BYTES = 50 * 1024 * 1024
const MAX_VIDEO_SECONDS = 30

function formatDate(value: string): string {
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return ''
  return new Date(time).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

async function videoDuration(file: File): Promise<number> {
  const url = URL.createObjectURL(file)
  try {
    const duration = await new Promise<number>((resolve, reject) => {
      const video = document.createElement('video')
      video.preload = 'metadata'
      video.onloadedmetadata = () => resolve(video.duration)
      video.onerror = () => reject(new Error('Could not read video'))
      video.src = url
    })
    return duration
  } finally {
    URL.revokeObjectURL(url)
  }
}

export default function HoneyMoments({
  threadName,
  moments,
  ownUsername,
  onBack,
  onCreate,
  onDelete,
  onHeart,
}: Props) {
  const [creating, setCreating] = useState(false)
  const [description, setDescription] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!file) {
      setPreviewUrl('')
      return
    }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const ordered = useMemo(
    () => [...moments].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)),
    [moments],
  )

  async function pickFile(next: File | null) {
    setError('')
    if (!next) {
      setFile(null)
      return
    }
    const type = next.type || ''
    const isImage = type.startsWith('image/') || /\.(png|jpe?g|gif|webp|heic|heif|bmp)$/i.test(next.name)
    const isVideo = type.startsWith('video/') || /\.(mp4|mov|webm|m4v|3gp)$/i.test(next.name)
    console.info('[moment] picked file', { type: type || 'unknown', size: next.size, kind: isImage ? 'image' : isVideo ? 'video' : 'unknown' })
    if (!isImage && !isVideo) {
      setError('Choose an image or a video.')
      return
    }
    if (next.size <= 0) {
      setError('Could not read that file. Try a different one.')
      return
    }
    if (isImage && next.size > MAX_IMAGE_BYTES) {
      setError('That image is too big. Images can be up to 10 MB.')
      return
    }
    if (isVideo) {
      if (next.size > MAX_VIDEO_BYTES) {
        setError('That video is too big. Videos can be up to 50 MB.')
        return
      }
      try {
        const duration = await videoDuration(next)
        if (duration > MAX_VIDEO_SECONDS + 0.25) {
          setError('That video is too long. Videos can be up to 30 seconds.')
          return
        }
      } catch {
        setError('Could not read that video. Try a different one.')
        return
      }
    }
    setFile(next)
  }

  async function submit() {
    const text = description.trim()
    if (!file && !text) {
      setError('Add a photo, a video, or a description first.')
      return
    }
    if (text.length > MAX_DESC) {
      setError('Description can be up to 200 characters.')
      return
    }
    if (!file) {
      setError('Add one image or one video to post a moment.')
      return
    }
    setBusy(true)
    setError('')
    const postError = await onCreate({ description: text, file })
    setBusy(false)
    if (postError) {
      setError(postError)
      return
    }
    setDescription('')
    setFile(null)
    setCreating(false)
  }

  return (
    <main className="screen-fade flex h-[100dvh] w-full flex-col bg-warm-cream">
      <header className="flex shrink-0 items-center gap-3 border-b border-border bg-white px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Close Honey Moments"
          className="honey-activation shrink-0 text-2xl"
        >
          🍯
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="readable-text font-bold text-warm-charcoal">Honey Moments</h1>
          <p className="truncate text-[12px] text-soft-grey">{threadName}</p>
        </div>
        <button
          type="button"
          onClick={() => { setCreating((v) => !v); setError('') }}
          className="min-h-11 shrink-0 rounded-xl bg-heart-pink px-4 text-sm font-bold text-white transition hover:bg-deep-rose"
        >
          {creating ? 'Close' : 'New Moment'}
        </button>
      </header>

      <section className="touch-scroll min-h-0 flex-1 overflow-y-auto p-4">
        {creating && (
          <div className="mb-4 rounded-3xl border border-border bg-white p-4 shadow-soft">
            <p className="mb-3 text-sm font-bold text-pink-ink">New Moment</p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              className="hidden"
              onChange={(e) => void pickFile(e.target.files?.[0] ?? null)}
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="min-h-11 rounded-xl border border-border px-4 text-sm font-bold text-warm-charcoal hover:bg-soft-blush"
              >
                {file ? 'Change photo/video' : 'Add photo/video'}
              </button>
              {file && (
                <button
                  type="button"
                  onClick={() => { setFile(null); if (fileInputRef.current) fileInputRef.current.value = '' }}
                  className="min-h-11 rounded-xl border border-border px-4 text-sm font-bold text-soft-grey hover:bg-soft-blush"
                >
                  Remove
                </button>
              )}
            </div>
            {previewUrl && file && (file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|heic|heif|bmp)$/i.test(file.name)) && (
              <img src={previewUrl} alt="Moment preview" className="mt-3 max-h-72 w-full rounded-2xl object-cover" />
            )}
            {previewUrl && file && (file.type.startsWith('video/') || /\.(mp4|mov|webm|m4v|3gp)$/i.test(file.name)) && (
              <video src={previewUrl} controls className="mt-3 max-h-72 w-full rounded-2xl bg-black" />
            )}
            <label className="mt-3 block">
              <span className="mb-1 block text-sm font-semibold text-warm-charcoal">Description</span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value.slice(0, MAX_DESC + 1))}
                rows={3}
                maxLength={MAX_DESC}
                placeholder="Add a little description..."
                className="w-full rounded-xl border border-border bg-warm-cream px-3 py-2 text-base text-warm-charcoal outline-none focus:border-heart-pink"
              />
              <span className="mt-1 block text-right text-[12px] text-soft-grey">{description.length}/{MAX_DESC}</span>
            </label>
            {error && <p className="mb-3 rounded-xl bg-soft-blush px-3 py-2 text-sm text-warm-charcoal">{error}</p>}
            <button
              type="button"
              disabled={busy}
              onClick={() => void submit()}
              className="min-h-11 w-full rounded-xl bg-heart-pink px-4 text-sm font-bold text-white transition hover:bg-deep-rose disabled:opacity-60"
            >
              {busy ? 'Posting...' : 'Post'}
            </button>
          </div>
        )}

        {ordered.length === 0 ? (
          <div className="flex min-h-[50vh] items-center justify-center">
            <div className="max-w-xs rounded-3xl bg-white px-6 py-8 text-center shadow-soft">
              <p className="text-5xl" aria-hidden="true">🐝</p>
              <p className="mt-3 font-semibold text-warm-charcoal">BORK</p>
              <p className="mt-1 text-sm text-soft-grey">No moments yet — add the first honey!</p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {ordered.map((moment) => (
              <article key={moment.id} className="rounded-3xl border border-border bg-white p-4 shadow-soft">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-pink-ink">@{moment.sender}</p>
                    <p className="text-[12px] text-soft-grey">{formatDate(moment.createdAt)}</p>
                  </div>
                  {moment.sender === ownUsername && (
                    <button
                      type="button"
                      onClick={() => void onDelete(moment.id)}
                      className="min-h-11 shrink-0 rounded-xl border border-border px-3 text-sm font-semibold text-soft-grey hover:bg-soft-blush"
                    >
                      Delete
                    </button>
                  )}
                </div>
                {moment.mediaKind === 'image' ? (
                  <img src={moment.mediaDataUrl} alt={moment.description || 'Honey moment'} className="max-h-[60vh] w-full rounded-2xl object-cover" />
                ) : (
                  <video src={moment.mediaDataUrl} controls className="max-h-[60vh] w-full rounded-2xl bg-black" />
                )}
                {moment.description && <p className="mt-3 whitespace-pre-wrap text-sm text-warm-charcoal">{moment.description}</p>}
                <button
                  type="button"
                  aria-label={moment.heartedByMe ? 'Remove heart' : 'Heart this moment'}
                  onClick={() => onHeart(moment.id)}
                  className={`mt-3 min-h-11 min-w-11 rounded-full border px-4 text-sm font-bold transition ${moment.heartedByMe ? 'border-heart-pink bg-soft-blush text-heart-pink' : 'border-border text-soft-grey hover:bg-soft-blush'}`}
                >
                  ♡
                </button>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}
