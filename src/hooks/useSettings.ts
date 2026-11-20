import { useEffect, useState } from 'react'

export type Settings = {
  readReceipts: boolean
  gentleNotifications: boolean
  largeText: boolean
  simulateReplies: boolean
  relayUrl: string
  showGlobalChat: boolean
}

export type SettingKey = keyof Settings

export type UpdateSetting = <K extends SettingKey>(
  key: K,
  value: Settings[K],
) => void

const STORAGE_KEY = 'honden.settings'

const defaults: Settings = {
  readReceipts: false,
  gentleNotifications: true,
  largeText: false,
  simulateReplies: true,
  relayUrl: '',
  showGlobalChat: true,
}

function load(): Settings {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return defaults
    return { ...defaults, ...JSON.parse(saved) }
  } catch {
    return defaults
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(load)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  }, [settings])

  useEffect(() => {
    const root = document.documentElement
    if (settings.largeText) {
      root.setAttribute('data-large-text', 'true')
    } else {
      root.removeAttribute('data-large-text')
    }
  }, [settings.largeText])

  const update: UpdateSetting = (key, value) => {
    setSettings((current) => ({ ...current, [key]: value }))
  }

  return { settings, update }
}
