package com.honden.fcm

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets

/** Shared constants and small helpers. Nothing here reads keys or credentials. */
internal object Fcm {
    const val TYPE_INCOMING = "incoming-call"
    const val TYPE_CANCEL = "call:cancel"

    const val EXTRA_CALL_ID = "callId"
    const val EXTRA_SENDER = "sender"
    const val EXTRA_KIND = "kind"

    const val ACTION_START = "com.honden.fcm.START"
    const val ACTION_STOP = "com.honden.fcm.STOP"
    const val ACTION_ANSWER = "com.honden.fcm.ANSWER"
    const val ACTION_DECLINE = "com.honden.fcm.DECLINE"
    const val ACTION_CALLBACK = "com.honden.fcm.CALLBACK"
    const val ACTION_FINISH = "com.honden.fcm.FINISH"

    const val CHANNEL_CALLS = "honden_incoming_calls"
    const val CHANNEL_MISSED = "honden_missed_calls"
    const val NOTIFICATION_CALL = 4101
    const val NOTIFICATION_MISSED = 4102

    const val RING_MS = 30_000L
    const val DECLINE_URL = "https://honden.onrender.com/api/call-decline"

    val VIBRATION = longArrayOf(0, 700, 250, 700, 250)

    fun kind(raw: String?): String = if (raw == "video") "video" else "voice"

    fun deepLink(callId: String, sender: String, kind: String, action: String): Uri =
        Uri.parse(
            "honden://call?callFrom=" + Uri.encode(sender) +
                "&callId=" + Uri.encode(callId) +
                "&callKind=" + Uri.encode(kind) +
                "&callAction=" + Uri.encode(action)
        )

    fun createChannels(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        val sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
        val attributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()

        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_CALLS,
                "Incoming calls",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Incoming HonDen calls"
                setSound(sound, attributes)
                enableVibration(true)
                vibrationPattern = VIBRATION
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            }
        )
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_MISSED,
                "Missed calls",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Missed HonDen calls"
            }
        )
    }

    /** Fire-and-forget decline POST. No auth, no response contents logged. */
    fun postDecline(callId: String, sender: String) {
        Thread {
            try {
                val body = JSONObject()
                    .put("callId", callId)
                    .put("to", sender)
                    .toString()
                val connection = URL(DECLINE_URL).openConnection() as HttpURLConnection
                connection.requestMethod = "POST"
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                connection.outputStream.use { it.write(body.toByteArray(StandardCharsets.UTF_8)) }
                @Suppress("UNUSED_VARIABLE")
                val status = connection.responseCode
                connection.disconnect()
            } catch (_: Exception) {
                // Intentionally silent: no message contents, tokens, or keys are logged.
            }
        }.start()
    }
}
