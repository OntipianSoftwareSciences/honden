use tauri::{
    Runtime,
    plugin::{Builder, TauriPlugin},
};

mod commands;
mod error;
mod models;

#[cfg(desktop)]
mod desktop;
#[cfg(mobile)]
mod mobile;

pub use error::{Error, Result};
pub use models::{HondenFcm, TokenResponse};

/// Initializes the `honden-fcm` plugin.
///
/// JavaScript invokes `plugin:honden-fcm|get_fcm_token`; the Rust command
/// forwards to the Kotlin `getFcmToken` method on Android.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("honden-fcm")
        .invoke_handler(tauri::generate_handler![commands::get_fcm_token])
        .setup(|app, api| {
            #[cfg(mobile)]
            if let Err(error) = mobile::init(app, api) {
                eprintln!("[honden-fcm] setup failed: {error}");
            }
            #[cfg(desktop)]
            if let Err(error) = desktop::init(app, api) {
                eprintln!("[honden-fcm] setup failed: {error}");
            }
            Ok(())
        })
        .build()
}
