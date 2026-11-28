import { invoke } from '@tauri-apps/api/core'
import { isTauriRuntime } from '../api/client'
import { logToAndroid } from './androidLog'

export type MomentPickerResult = {
  ok?: boolean
  cancelled?: boolean
  type?: string | null
  size?: number | null
  scheme?: string | null
  name?: string | null
  dataUrl?: string | null
  errorName?: string | null
  errorMessage?: string | null
}

export type MomentDetails = {
  type: string
  size: number
  scheme: string
}

export type PickedMomentFile = {
  file: File
  scheme: string
  type: string
  size: number
}

export class MomentPickerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MomentPickerError'
  }
}

/** Diagnostic string only: type, size, URI scheme, and error. Never file bytes. */
export function momentDetail(info: MomentDetails, error?: unknown): string {
  const parts = [
    `type=${info.type || 'unknown'}`,
    `size=${info.size}`,
    `scheme=${info.scheme || 'unknown'}`,
  ]
  if (error !== undefined) {
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : `Unknown: ${String(error)}`
    parts.push(`error=${reason}`)
  }
  return parts.join(' ')
}

export function momentDetailsFrom(file: File, scheme?: string | null): MomentDetails {
  return { type: file.type || '', size: file.size, scheme: scheme || 'unknown' }
}

/**
 * On Android, use the native picker so the gallery's content:// URI is read by
 * ContentResolver instead of being handed to WebView as a fragile JS File.
 * Web/desktop callers keep the ordinary HTML file input.
 */
export async function pickMomentFile(): Promise<PickedMomentFile | null> {
  if (!isTauriRuntime()) throw new MomentPickerError('Native picker is only available in the Android app')

  const result = await invoke<MomentPickerResult>('plugin:honden-fcm|pick_moment_media')
  if (result.cancelled) return null

  const info: MomentDetails = {
    type: result.type || '',
    size: result.size ?? 0,
    scheme: result.scheme || 'unknown',
  }
  const name = result.name || defaultName(info.type)

  if (!result.ok || !result.dataUrl) {
    const reason = `${result.errorName || 'MomentPickerError'}: ${result.errorMessage || 'no error message'}`
    const detail = momentDetail(info, reason)
    logToAndroid(`HonDen moment picker failed: ${detail}`)
    throw new MomentPickerError(detail)
  }

  try {
    const { type, base64 } = splitDataUrl(result.dataUrl)
    const bytes = decodeBase64(base64)
    const fileType = type || info.type
    const file = new File([bytes.buffer as ArrayBuffer], name, { type: fileType })
    const picked: PickedMomentFile = {
      file,
      scheme: info.scheme,
      type: file.type || fileType || 'unknown',
      size: file.size,
    }
    logToAndroid(`HonDen moment picked: ${momentDetail({ type: picked.type, size: picked.size, scheme: picked.scheme })}`)
    return picked
  } catch (error) {
    const detail = momentDetail(info, error)
    logToAndroid(`HonDen moment picker failed: ${detail}`)
    throw new MomentPickerError(detail)
  }
}

function splitDataUrl(dataUrl: string): { type: string; base64: string } {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) throw new TypeError('data URL is missing base64 data')
  const header = dataUrl.slice(0, comma)
  const type = header.startsWith('data:') ? header.slice(5).split(';')[0] : ''
  return { type, base64: dataUrl.slice(comma + 1) }
}

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function defaultName(type: string): string {
  if (type.startsWith('image/')) return `moment.${type.slice('image/'.length)}`
  if (type.startsWith('video/')) return `moment.${type.slice('video/'.length)}`
  return 'moment'
}
