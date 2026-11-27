type Props = {
  size?: number
  waving?: boolean
  className?: string
}

// Small original green alien-dog friend. No external art or tracking.
export default function Bork({ size = 28, waving = false, className = '' }: Props) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M24 12V6" stroke="#3F8B4F" strokeWidth="2" strokeLinecap="round" />
      <circle cx="24" cy="5" r="2.3" fill="#FF6B9D" />
      <path d="M12 19 7 9l10 5Z" fill="#7BC86C" stroke="#3F8B4F" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M36 19 41 9 31 14Z" fill="#7BC86C" stroke="#3F8B4F" strokeWidth="1.4" strokeLinejoin="round" />
      <ellipse cx="24" cy="26" rx="15" ry="13" fill="#8BD47A" stroke="#3F8B4F" strokeWidth="1.5" />
      <ellipse cx="24" cy="31" rx="8" ry="6" fill="#B7E9A8" />
      <circle cx="19" cy="24" r="2.7" fill="#2B2330" />
      <circle cx="29" cy="24" r="2.7" fill="#2B2330" />
      <circle cx="19.8" cy="23.2" r="0.8" fill="white" />
      <circle cx="29.8" cy="23.2" r="0.8" fill="white" />
      <ellipse cx="24" cy="29" rx="1.7" ry="1.2" fill="#2B2330" />
      <path d="M20 33q4 4 8 0" stroke="#2B2330" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="14" cy="30" r="2.2" fill="#FF6B9D" opacity="0.55" />
      <circle cx="34" cy="30" r="2.2" fill="#FF6B9D" opacity="0.55" />
      {waving && (
        <path
          d="M39 34c3-1 5-4 5-7m0 0c0-2-2-3-3-2m3 2c1-2 3-2 3 0m-3 0c1 1 0 3-2 3"
          stroke="#8BD47A"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  )
}
