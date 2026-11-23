type Props = {
  size?: 'sm' | 'md' | 'lg'
  label?: string
}

const sizes: Record<NonNullable<Props['size']>, string> = {
  sm: 'h-5 w-5 text-[9px]',
  md: 'h-7 w-7 text-[11px]',
  lg: 'h-14 w-14 text-xl',
}

/** One calm, on-brand loading circle for the whole app. */
export default function CuteLoader({ size = 'md', label = 'Loading' }: Props) {
  return (
    <span
      role="status"
      aria-label={label}
      className={`cute-loader relative inline-flex shrink-0 items-center justify-center rounded-full bg-warm-cream ${sizes[size]}`}
    >
      <span
        className="cute-loader__arc absolute inset-0 rounded-full border-2 border-transparent border-t-heart-pink"
        aria-hidden="true"
      />
      <span
        className="cute-loader__face relative flex h-[74%] w-[74%] items-center justify-center rounded-full bg-heart-pink font-bold leading-none text-warm-cream"
        aria-hidden="true"
      >
        :3
      </span>
    </span>
  )
}
