package com.honden.fcm

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import androidx.core.app.NotificationManagerCompat

/** Handles notification actions and the cancel/finish broadcasts. */
class CallActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Fcm.ACTION_FINISH) {
            // The activity's dynamic receiver finishes itself for a matching callId.
            return
        }
        val callId = intent.getStringExtra(Fcm.EXTRA_CALL_ID) ?: return
        val sender = intent.getStringExtra(Fcm.EXTRA_SENDER)
            ?: CallStore(context).currentCall()?.sender
            ?: return

        when (intent.action) {
            Fcm.ACTION_ANSWER -> {
                val requested = Fcm.kind(intent.getStringExtra(Fcm.EXTRA_KIND))
                val actual = if (
                    requested == "video" &&
                    !context.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)
                ) {
                    "voice"
                } else {
                    requested
                }
                stopRinging(context, callId)
                open(context, Fcm.deepLink(callId, sender, actual, "accept"))
            }

            Fcm.ACTION_DECLINE -> {
                Fcm.postDecline(callId, sender)
                stopRinging(context, callId)
            }

            Fcm.ACTION_CALLBACK -> {
                val kind = Fcm.kind(intent.getStringExtra(Fcm.EXTRA_KIND))
                stopRinging(context, callId)
                open(context, Fcm.deepLink(callId, sender, kind, "callback"))
            }
        }
    }

    private fun stopRinging(context: Context, callId: String) {
        context.stopService(
            Intent(context, CallRingtoneService::class.java).apply { action = Fcm.ACTION_STOP }
        )
        NotificationManagerCompat.from(context).cancel(Fcm.NOTIFICATION_CALL)
        CallStore(context).clearCall(callId)
        context.sendBroadcast(
            Intent(Fcm.ACTION_FINISH)
                .setPackage(context.packageName)
                .putExtra(Fcm.EXTRA_CALL_ID, callId)
        )
    }

    private fun open(context: Context, uri: Uri) {
        try {
            context.startActivity(
                Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
        } catch (_: Exception) {
            // Nothing to log; the deep link is best effort from a broadcast.
        }
    }

    companion object {
        /** PendingIntents created for this receiver must be immutable. */
        const val FLAGS = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    }
}
