#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "android")]
    android_logger::init_once(
        android_logger::Config::default()
            .with_tag("HonDen")
            .with_max_level(log::LevelFilter::Info),
    );
    #[cfg(target_os = "android")]
    log::set_max_level(log::LevelFilter::Trace);

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_honden_fcm::init())
        .plugin(tauri_plugin_deep_link::init())
        .invoke_handler(tauri::generate_handler![honden_log])
        .run(tauri::generate_context!())
        .expect("error while running HonDen");
}

/// Receives WebView diagnostics that console.log cannot reach on Android.
/// Callers must never pass tokens, passwords, or message content.
#[tauri::command]
fn honden_log(message: String) {
    log::info!("{message}");
    eprintln!("{message}");
}
