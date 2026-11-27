import { invoke } from '@tauri-apps/api/core'
import { apiUrl, authHeaders } from '../api/client'
import { isAndroidPushRuntime } from './androidNotifications'

export type FcmRegistrationResult = 'ok' | 'unsupported' | 'error'

/** Register the native FCM token with the live server for incoming calls. */
export async function registerFcmToken(): Promise<FcmRegistrationResult> {
  if (!isAndroidPushRuntime()) return 'unsupported'
  try {
    const result = await invoke<{ token?: string | null }>('plugin:honden-fcm|get_fcm_token')
    const token = typeof result?.token === 'string' ? result.token.trim() : ''
    if (!token) return 'error'
    const response = await fetch(apiUrl('/api/fcm-token'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        token,
        deviceId: localStorage.getItem('honden.signalId') ?? '',
        callNotifications: true,
      }),
    })
    return response.ok ? 'ok' : 'error'
  } catch {
    return 'error'
  }
}
