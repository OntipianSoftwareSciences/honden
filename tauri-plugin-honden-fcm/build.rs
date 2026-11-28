const COMMANDS: &[&str] = &["get_fcm_token", "pick_moment_media"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
