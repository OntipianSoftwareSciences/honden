use serde::{Deserialize, Serialize};
use tauri::{Runtime, plugin::PluginHandle};

/// Response shape returned to JavaScript: `{ token: string | null }`.
#[derive(Debug, Deserialize, Serialize)]
pub struct TokenResponse {
    pub token: Option<String>,
}

/// Managed plugin state. The mobile handle is absent on desktop.
pub struct HondenFcm<R: Runtime>(pub Option<PluginHandle<R>>);
