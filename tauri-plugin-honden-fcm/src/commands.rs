use tauri::{Runtime, State, command};

use crate::{HondenFcm, Result, TokenResponse};

/// Returns the current FCM registration token, or `null` when FCM is unavailable.
#[command]
pub fn get_fcm_token<R: Runtime>(state: State<'_, HondenFcm<R>>) -> Result<TokenResponse> {
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
