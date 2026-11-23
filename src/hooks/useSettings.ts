import { useEffect, useState } from 'react'
import { setSoundSettings } from '../sounds'

export type ThemeName = 'light' | 'dark' | 'ultra-dark'

export type Settings = {
  theme: ThemeName
  readReceipts: boolean
  gentleNotifications: boolean
  callNotifications: boolean
  largeText: boolean
  simulateReplies: boolean
  relayUrl: string
  showGlobalChat: boolean
  sounds: boolean
  soundVolume: number
}

export type SettingKey = keyof Settings

export type UpdateSetting = <K extends SettingKey>(
  key: K,
  value: Settings[K],
) => void

const STORAGE_KEY = 'honden.settings'

const defaults: Settings = {
  theme: 'light',
  readReceipts: false,
  gentleNotifications: true,
  callNotifications: false,
  largeText: false,
  simulateReplies: true,
  relayUrl: '',
  showGlobalChat: true,
  sounds: true,
  soundVolume: 0.35,
}

function isTheme(value: unknown): value is ThemeName {
  return value === 'light' || value === 'dark' || value === 'ultra-dark'
}

export function applyTheme(theme: ThemeName): void {
  document.documentElement.setAttribute('data-theme', theme)
}

export function readStoredTheme(): ThemeName {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return defaults.theme
    const theme = (JSON.parse(saved) as Partial<Settings>).theme
    return isTheme(theme) ? theme : defaults.theme
  } catch {
    return defaults.theme
  }
}

function load(): Settings {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return defaults
    const parsed = JSON.parse(saved) as Partial<Settings>
    return { ...defaults, ...parsed, theme: isTheme(parsed.theme) ? parsed.theme : defaults.theme }
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
    setSoundSettings(settings.sounds, settings.soundVolume)
  }, [settings.sounds, settings.soundVolume])

  useEffect(() => {
    applyTheme(settings.theme)
  }, [settings.theme])

  useEffect(() => {
    const root = document.documentElement
    if (settings.largeText) {
      root.setAttribute('data-large-text', 'true')
    } else {
      root.removeAttribute('data-large-text')
    }
  }, [settings.largeText])

  const update: UpdateSetting = (key, value) => {
    if (key === 'theme') applyTheme(value as ThemeName)
    setSettings((current) => ({ ...current, [key]: value }))
  }

  const setTheme = (theme: ThemeName) => update('theme', theme)

  return { settings, update, setTheme }
}
