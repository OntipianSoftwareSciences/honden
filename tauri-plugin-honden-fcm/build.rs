const COMMANDS: &[&str] = &["get_fcm_token"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
