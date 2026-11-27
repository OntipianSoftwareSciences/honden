package com.honden.fcm

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.Vibrator
import android.os.VibrationEffect
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat

/** Rings for at most 30 seconds, then posts a missed-call notification. */
class CallRingtoneService : Service() {
    private val handler = Handler(Looper.getMainLooper())
    private var player: MediaPlayer? = null
    private var call: CallStore.Call? = null
    private val timeout = Runnable {
        call?.let { showMissedCall(it) }
        stopSelf()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            Fcm.ACTION_STOP -> stopSelf()
            Fcm.ACTION_START -> {
                val callId = intent.getStringExtra(Fcm.EXTRA_CALL_ID) ?: return START_NOT_STICKY
                val sender = intent.getStringExtra(Fcm.EXTRA_SENDER) ?: return START_NOT_STICKY
                val current = CallStore.Call(callId, sender, Fcm.kind(intent.getStringExtra(Fcm.EXTRA_KIND)))
                call = current

                handler.removeCallbacks(timeout)
                Fcm.createChannels(this)
                ServiceCompat.startForeground(
                    this,
                    Fcm.NOTIFICATION_CALL,
                    foregroundNotification(current),
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
                )
                startRinging()
                handler.postDelayed(timeout, Fcm.RING_MS)
            }
        }
        return START_NOT_STICKY
    }

    private fun foregroundNotification(call: CallStore.Call): Notification {
        val open = PendingIntent.getActivity(
            this,
            21,
            Intent(this, IncomingCallActivity::class.java).apply {
                putExtra(Fcm.EXTRA_CALL_ID, call.callId)
                putExtra(Fcm.EXTRA_SENDER, call.sender)
                putExtra(Fcm.EXTRA_KIND, call.kind)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Builder(this, Fcm.CHANNEL_CALLS)
            .setSmallIcon(android.R.drawable.ic_menu_call)
            .setContentTitle("Incoming ${call.kind} call")
            .setContentText("@${call.sender}")
            .setContentIntent(open)
            .setFullScreenIntent(open, true)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(Notification.CATEGORY_CALL)
            .setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE))
            .setVibrate(Fcm.VIBRATION)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .build()
    }

    private fun startRinging() {
        player = MediaPlayer.create(this, RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE))
            ?.apply {
                isLooping = true
                start()
            }
        val vibrator = getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(VibrationEffect.createWaveform(Fcm.VIBRATION, 1))
        } else {
            @Suppress("DEPRECATION")
            vibrator.vibrate(Fcm.VIBRATION, 1)
        }
    }

    private fun showMissedCall(call: CallStore.Call) {
        Fcm.createChannels(this)
        val callback = PendingIntent.getActivity(
            this,
            22,
            Intent(Intent.ACTION_VIEW, Fcm.deepLink(call.callId, call.sender, call.kind, "callback")),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val displayName = call.sender.replaceFirstChar { it.uppercaseChar() }
        val notification = NotificationCompat.Builder(this, Fcm.CHANNEL_MISSED)
            .setSmallIcon(android.R.drawable.ic_menu_call)
            .setContentTitle("Missed ${call.kind} call from $displayName")
            .setContentText("Call Back")
            .setContentIntent(callback)
            .addAction(android.R.drawable.ic_menu_call, "Call Back", callback)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(Notification.CATEGORY_CALL)
            .setAutoCancel(true)
            .build()
        NotificationManagerCompat.from(this).notify(Fcm.NOTIFICATION_MISSED, notification)
        CallStore(this).clearCall(call.callId)
    }

    override fun onDestroy() {
        handler.removeCallbacks(timeout)
        player?.runCatching {
            stop()
            release()
        }
        player = null
        (getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator)?.cancel()
        NotificationManagerCompat.from(this).cancel(Fcm.NOTIFICATION_CALL)
        super.onDestroy()
    }
}
