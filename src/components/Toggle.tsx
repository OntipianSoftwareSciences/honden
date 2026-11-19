type Props = {
  label: string
  checked: boolean
  onChange: (next: boolean) => void
}

export default function Toggle({ label, checked, onChange }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`inline-flex h-8 w-14 shrink-0 items-center rounded-xl p-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-heart-pink ${
        checked ? 'bg-heart-pink' : 'bg-border'
      }`}
    >
      <span
        className={`block h-6 w-6 rounded-lg bg-white shadow-soft transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-0'
        }`}
      />
    </button>
  )
}
