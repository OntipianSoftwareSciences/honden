use tauri::{AppHandle, Runtime, plugin::PluginApi};

use crate::HondenFcm;

pub fn init<R: Runtime>(app: &AppHandle<R>, _api: PluginApi<R, ()>) -> crate::Result<()> {
    app.manage(HondenFcm(None));
    Ok(())
}
