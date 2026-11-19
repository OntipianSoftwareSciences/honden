type Props = {
  size?: number
  className?: string
}

export default function HeartMark({ size = 20, className = '' }: Props) {
  return (
    <svg
      className={`-rotate-[8deg] ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M12 20.6c-.35 0-.7-.12-.98-.37C7.05 17.3 4 14.7 4 11.35 4 8.5 6.15 6.35 8.9 6.35c1.45 0 2.75.68 3.1 1.72.35-1.04 1.65-1.72 3.1-1.72C17.85 6.35 20 8.5 20 11.35c0 3.35-3.05 5.95-7.02 9.08-.28.25-.63.37-.98.37Z"
        fill="currentColor"
      />
      <path d="M12.4 19.4 8.9 22.1l.3-3.4Z" fill="currentColor" />
    </svg>
  )
}
