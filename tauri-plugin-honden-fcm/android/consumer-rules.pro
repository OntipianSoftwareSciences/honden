# Keep the Tauri plugin entry point and its Android components.
-keep class com.honden.fcm.** { *; }

# Firebase messaging is reflection-free; silence warnings from optional transitive modules.
-dontwarn com.google.firebase.**
