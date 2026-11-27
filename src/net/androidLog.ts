import { invoke } from '@tauri-apps/api/core'
import { isTauriRuntime } from '../api/client'

/**
 * Send a line to the Rust logger. On Android the Rust side installs
 * `android_logger`, so this reaches logcat under the `HonDen` tag; WebView
 * console.log does not. Never pass tokens or message content here.
 */
export function logToAndroid(message: string): void {
  if (!isTauriRuntime()) return
  void invoke('honden_log', { message }).catch(() => undefined)
}
