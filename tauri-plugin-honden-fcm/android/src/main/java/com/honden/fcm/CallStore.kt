package com.honden.fcm

import android.content.Context

/** SharedPreferences store for the FCM token and the current incoming call. */
internal class CallStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun saveToken(token: String) {
        prefs.edit().putString(KEY_TOKEN, token).apply()
    }

    fun getToken(): String? = prefs.getString(KEY_TOKEN, null)

    fun saveCall(callId: String, sender: String, kind: String) {
        prefs.edit()
            .putString(KEY_CALL_ID, callId)
            .putString(KEY_SENDER, sender)
            .putString(KEY_KIND, Fcm.kind(kind))
            .apply()
    }

    fun currentCall(): Call? {
        val id = prefs.getString(KEY_CALL_ID, null) ?: return null
        val sender = prefs.getString(KEY_SENDER, null) ?: return null
        return Call(id, sender, Fcm.kind(prefs.getString(KEY_KIND, null)))
    }

    /** Clears the current call only when [callId] matches; passes when null. */
    fun clearCall(callId: String? = null) {
        if (callId != null && prefs.getString(KEY_CALL_ID, null) != callId) return
        prefs.edit()
            .remove(KEY_CALL_ID)
            .remove(KEY_SENDER)
            .remove(KEY_KIND)
            .apply()
    }

    data class Call(val callId: String, val sender: String, val kind: String)

    private companion object {
        const val PREFS = "honden_fcm"
        const val KEY_TOKEN = "token"
        const val KEY_CALL_ID = "call_id"
        const val KEY_SENDER = "call_sender"
        const val KEY_KIND = "call_kind"
    }
}
