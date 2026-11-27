package com.honden.fcm

import android.app.Activity
import android.util.Log
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.google.firebase.messaging.FirebaseMessaging

@TauriPlugin
class HondenFcmPlugin(private val activity: Activity) : Plugin(activity) {
    /** JS: plugin:honden-fcm|get_fcm_token -> { token: string | null }. */
    @Command
    fun getFcmToken(invoke: Invoke) {
        try {
            FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
                if (!task.isSuccessful) {
                    Log.w(TAG, "FCM token task failed", task.exception)
                    invoke.reject("Unable to retrieve FCM token")
                    return@addOnCompleteListener
                }
                val token = task.result
                CallStore(activity).saveToken(token)
                val result = JSObject()
                result.put("token", token)
                invoke.resolve(result)
            }
        } catch (error: Exception) {
            Log.w(TAG, "FCM unavailable; continuing without push", error)
            val result = JSObject()
            result.put("token", null)
            invoke.resolve(result)
        }
    }

    private companion object {
        const val TAG = "HondenFcm"
    }
}
