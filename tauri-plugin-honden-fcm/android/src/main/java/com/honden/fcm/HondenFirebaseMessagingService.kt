package com.honden.fcm

import android.app.Notification
import android.app.PendingIntent
import android.content.Intent
import android.media.RingtoneManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class HondenFirebaseMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        CallStore(this).saveToken(token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        // Only the four agreed data fields are read; payload contents are never logged.
        val data = message.data
        val type = data["type"] ?: return
        if (type != Fcm.TYPE_INCOMING && type != Fcm.TYPE_CANCEL) return
        val callId = data[Fcm.EXTRA_CALL_ID] ?: return
        val sender = data[Fcm.EXTRA_SENDER] ?: return
        val kind = Fcm.kind(data[Fcm.EXTRA_KIND])

        when (type) {
            Fcm.TYPE_INCOMING -> incoming(callId, sender, kind)
            Fcm.TYPE_CANCEL -> cancel(callId)
        }
    }

    private fun incoming(callId: String, sender: String, kind: String) {
        CallStore(this).saveCall(callId, sender, kind)
        Fcm.createChannels(this)

        val activityIntent = Intent(this, IncomingCallActivity::class.java).apply {
            putExtra(Fcm.EXTRA_CALL_ID, callId)
            putExtra(Fcm.EXTRA_SENDER, sender)
            putExtra(Fcm.EXTRA_KIND, kind)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        }
        val immutable = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        val fullScreen = PendingIntent.getActivity(this, 11, activityIntent, immutable)
        val openApp = PendingIntent.getActivity(
            this,
            12,
            Fcm.deepLink(callId, sender, kind, "open"),
            immutable
        )

        val notification = NotificationCompat.Builder(this, Fcm.CHANNEL_CALLS)
            .setSmallIcon(android.R.drawable.ic_menu_call)
            .setContentTitle("Incoming $kind call")
            .setContentText("@$sender")
            .setContentIntent(openApp)
            .setFullScreenIntent(fullScreen, true)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(Notification.CATEGORY_CALL)
            .setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE))
            .setVibrate(Fcm.VIBRATION)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .addAction(
                android.R.drawable.ic_menu_call,
                "Answer as Voice",
                actionPendingIntent(Fcm.ACTION_ANSWER, callId, sender, "voice", 13)
            )
            .addAction(
                android.R.drawable.ic_menu_call,
                "Decline",
                actionPendingIntent(Fcm.ACTION_DECLINE, callId, sender, kind, 14)
            )
            .build()
        NotificationManagerCompat.from(this).notify(Fcm.NOTIFICATION_CALL, notification)

        // Best effort: Android may hold the activity back while in the background;
        // the full-screen intent above is the reliable lock-screen path.
        try {
            startActivity(activityIntent)
        } catch (_: Exception) {
            // Ignore; the notification remains available.
        }

        startForegroundService(
            Intent(this, CallRingtoneService::class.java).apply {
                action = Fcm.ACTION_START
                putExtra(Fcm.EXTRA_CALL_ID, callId)
                putExtra(Fcm.EXTRA_SENDER, sender)
                putExtra(Fcm.EXTRA_KIND, kind)
            }
        )
    }

    private fun actionPendingIntent(
        action: String,
        callId: String,
        sender: String,
        kind: String,
        requestCode: Int
    ): PendingIntent {
        val intent = Intent(this, CallActionReceiver::class.java).apply {
            this.action = action
            putExtra(Fcm.EXTRA_CALL_ID, callId)
            putExtra(Fcm.EXTRA_SENDER, sender)
            putExtra(Fcm.EXTRA_KIND, kind)
        }
        return PendingIntent.getBroadcast(
            this,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun cancel(callId: String) {
        stopService(
            Intent(this, CallRingtoneService::class.java).apply { action = Fcm.ACTION_STOP }
        )
        NotificationManagerCompat.from(this).cancel(Fcm.NOTIFICATION_CALL)
        CallStore(this).clearCall(callId)
        sendBroadcast(
            Intent(Fcm.ACTION_FINISH)
                .setPackage(packageName)
                .putExtra(Fcm.EXTRA_CALL_ID, callId)
        )
    }
}
