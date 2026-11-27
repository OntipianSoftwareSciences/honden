use tauri::{AppHandle, Runtime, Manager, plugin::PluginApi};

use crate::HondenFcm;

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "com.honden.fcm";

pub fn init<R: Runtime>(app: &AppHandle<R>, api: PluginApi<R, ()>) -> crate::Result<()> {
    #[cfg(target_os = "android")]
    let handle = match api.register_android_plugin(PLUGIN_IDENTIFIER, "HondenFcmPlugin") {
        Ok(handle) => Some(handle),
        Err(error) => {
            eprintln!("[honden-fcm] Android plugin registration failed: {error}");
            None
        }
    };

    #[cfg(not(target_os = "android"))]
    let handle = {
        let _ = &api;
        None
    };

    app.manage(HondenFcm(handle));
    Ok(())
}
