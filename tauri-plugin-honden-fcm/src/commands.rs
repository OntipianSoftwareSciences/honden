use serde_json::{Value, json};
use tauri::{AppHandle, Runtime, State, command};

use crate::{HondenFcm, Result, TokenResponse};

/// Returns the current FCM registration token, or `null` when FCM is unavailable.
#[command]
pub fn get_fcm_token<R: Runtime>(
    _app: AppHandle<R>,
    state: State<'_, HondenFcm<R>>,
) -> Result<TokenResponse> {
    #[cfg(mobile)]
    if let Some(handle) = &state.0 {
        // The Android bridge looks up the Kotlin method by its camelCase name.
        return handle
            .run_mobile_plugin("getFcmToken", ())
            .map_err(Into::into);
    }

    #[cfg(not(mobile))]
    let _ = state;

    Ok(TokenResponse { token: None })
}

/// Opens the native Android picker and copies the chosen media into a data URL
/// before WebView can lose access to the gallery's `content://` URI.
#[command]
pub fn pick_moment_media<R: Runtime>(
    _app: AppHandle<R>,
    state: State<'_, HondenFcm<R>>,
) -> Result<Value> {
    #[cfg(mobile)]
    if let Some(handle) = &state.0 {
        return handle
            .run_mobile_plugin("pickMomentMedia", ())
            .map_err(Into::into);
    }

    #[cfg(not(mobile))]
    let _ = state;

    Ok(json!({
        "ok": false,
        "cancelled": true,
        "type": "",
        "size": 0,
        "scheme": "unknown",
        "name": "",
        "dataUrl": "",
        "errorName": "DesktopUnsupported",
        "errorMessage": "Native media picker is only available on Android"
    }))
}
