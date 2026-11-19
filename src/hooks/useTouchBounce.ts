import { useRef, useState, type CSSProperties, type TouchEvent } from 'react'

const MAX_STRETCH = 40

export function useTouchBounce() {
  const ref = useRef<HTMLDivElement>(null)
  const startY = useRef(0)
  const offsetValue = useRef(0)
  const springTimer = useRef<number | undefined>(undefined)
  const [offset, setOffset] = useState(0)
  const [springing, setSpringing] = useState(false)

  function settle() {
    if (springTimer.current !== undefined) window.clearTimeout(springTimer.current)
    offsetValue.current = 0
    setOffset(0)
    setSpringing(true)
    springTimer.current = window.setTimeout(() => setSpringing(false), 200)
  }

  function onTouchStart(event: TouchEvent<HTMLDivElement>) {
    if (event.touches.length !== 1) return
    startY.current = event.touches[0].clientY
  }

  function onTouchMove(event: TouchEvent<HTMLDivElement>) {
    const node = ref.current
    if (!node || event.touches.length !== 1) return
    const delta = event.touches[0].clientY - startY.current
    const atTop = node.scrollTop <= 0 && delta > 0
    const atBottom =
      node.scrollTop + node.clientHeight >= node.scrollHeight - 1 && delta < 0

    if (!atTop && !atBottom) {
      startY.current = event.touches[0].clientY
      if (offsetValue.current !== 0) settle()
      return
    }

    const next = Math.max(-MAX_STRETCH, Math.min(MAX_STRETCH, delta / 3))
    if (next !== offsetValue.current) {
      offsetValue.current = next
      setOffset(next)
    }
  }

  function onTouchEnd() {
    if (offsetValue.current !== 0) settle()
  }

  const style: CSSProperties = {
    transform: `translateY(${offset}px)`,
    transition: springing
      ? 'transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1)'
      : 'none',
  }

  return {
    ref,
    style,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onTouchCancel: onTouchEnd,
  }
}
