import { useEffect, useState } from 'react'

export type LayoutInfo = {
  width: number
  height: number
  zoomPercent: number
  mode: 'Mobile' | 'Tablet' | 'Desktop'
  columns: 1 | 2 | 3
  label: string
}

const initialDpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1

export function zoomPercentFromDpr(dpr: number, baseline = initialDpr): number {
  if (!Number.isFinite(dpr) || dpr <= 0) return 100
  const relative = Math.round((dpr / (baseline || 1)) * 100)
  if (dpr < 0.9) return Math.min(relative, Math.round(dpr * 100))
  return relative
}

export function computeLayout(width: number, height: number, zoomPercent: number): LayoutInfo {
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 1280
  const safeHeight = Number.isFinite(height) && height > 0 ? height : 720
  const zoomedOut = zoomPercent > 0 && zoomPercent <= 80

  let mode: LayoutInfo['mode'] = 'Mobile'
  let columns: LayoutInfo['columns'] = 1
  if (safeWidth >= 640) {
    if (zoomedOut || safeWidth > 1200) {
      mode = 'Desktop'
      columns = 3
    } else {
      mode = 'Tablet'
      columns = 2
    }
  }

  return {
    width: safeWidth,
    height: safeHeight,
    zoomPercent,
    mode,
    columns,
    label: `Window: ${Math.round(safeWidth)} x ${Math.round(safeHeight)} - ${mode}, Zoom: ${zoomPercent}% - showing ${columns} columns`,
  }
}

function readLayout(): LayoutInfo {
  if (typeof window === 'undefined') return computeLayout(1280, 720, 100)
  return computeLayout(
    window.innerWidth,
    window.innerHeight,
    zoomPercentFromDpr(window.devicePixelRatio || 1),
  )
}

export function useLayoutInfo(): LayoutInfo {
  const [layout, setLayout] = useState<LayoutInfo>(readLayout)

  useEffect(() => {
    const update = () => setLayout(readLayout())
    window.addEventListener('resize', update)
    window.visualViewport?.addEventListener('resize', update)
    return () => {
      window.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('resize', update)
    }
  }, [])

  return layout
}
