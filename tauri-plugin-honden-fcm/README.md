# tauri-plugin-honden-fcm

Android-only Tauri v2 plugin for HonDen. JS API:

```ts
const { token } = await invoke<{ token: string | null }>("plugin:honden-fcm|get_fcm_token");
```

Permission set: `honden-fcm:default` (command permission `allow-get-fcm-token`).

## Integration still required by the app (not done here)

- Add this crate as a path dependency and register it with
  `tauri::Builder::plugin(tauri_plugin_honden_fcm::init())`.
- Register the Kotlin plugin from Rust:
  `api.register_android_plugin("com.honden.fcm", "HondenFcmPlugin")`.
- Copy/merge `src-tauri/android/AndroidManifest.xml` into the generated app manifest at
  `src-tauri/gen/android/app/src/main/AndroidManifest.xml`.
- Apply the google-services Gradle plugin **4.6.0** in the generated Android project:
  `classpath("com.google.gms:google-services:4.6.0")` in the root build file and
  `id("com.google.gms.google-services")` in `app/build.gradle.kts`.
- Place `google-services.json` only in the generated app module from CI/secret storage.
  Never commit it. No key material is stored in this plugin.

## Versions

- Firebase Android BoM `35.2.0`
- Firebase dependency `com.google.firebase:firebase-messaging` (main module, no KTX)
- google-services Gradle plugin `4.6.0`

Only data-only FCM messages with `type`, `callId`, `sender`, and `kind` are handled.
No ads, tracking, analytics, telecom/phone APIs, voicemail, or call history are used.
