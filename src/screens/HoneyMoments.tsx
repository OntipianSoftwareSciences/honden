type Props = {
  onBack: () => void
}

export default function HoneyMoments({ onBack }: Props) {
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
          <p className="text-[12px] text-soft-grey">Little gifts from your people.</p>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="min-h-11 shrink-0 rounded-xl border border-border px-3 text-sm font-bold text-pink-ink transition hover:bg-soft-blush"
        >
          Back
        </button>
      </header>
      <section className="touch-scroll flex min-h-0 flex-1 items-center justify-center p-6">
        <div className="max-w-xs rounded-3xl bg-white px-6 py-8 text-center shadow-soft">
          <p className="text-4xl" aria-hidden="true">🍯</p>
          <p className="mt-3 font-semibold text-warm-charcoal">
            No moments yet — leave some honey!
          </p>
        </div>
      </section>
    </main>
  )
}
