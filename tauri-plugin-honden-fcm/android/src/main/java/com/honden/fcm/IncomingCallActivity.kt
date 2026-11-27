package com.honden.fcm

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast

/** Full-screen incoming call UI shown over the lock screen. */
class IncomingCallActivity : Activity() {
    private var finishReceiver: BroadcastReceiver? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                    WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
            )
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        val callId = intent.getStringExtra(Fcm.EXTRA_CALL_ID).orEmpty()
        val sender = intent.getStringExtra(Fcm.EXTRA_SENDER).orEmpty()
        val kind = Fcm.kind(intent.getStringExtra(Fcm.EXTRA_KIND))
        val pink = Color.parseColor("#FF6B9D")
        val cream = Color.parseColor("#FFF7F2")

        val avatar = TextView(this).apply {
            text = sender.take(1).uppercase()
            textSize = 42f
            setTextColor(cream)
            gravity = Gravity.CENTER
            typeface = Typeface.DEFAULT_BOLD
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(pink)
            }
            layoutParams = LinearLayout.LayoutParams(dp(DP_AVATAR), dp(DP_AVATAR)).apply {
                bottomMargin = dp(DP_SPACING)
            }
        }
        val caller = TextView(this).apply {
            text = "@$sender"
            textSize = 28f
            setTextColor(pink)
            gravity = Gravity.CENTER
            typeface = Typeface.DEFAULT_BOLD
        }
        val subtitle = TextView(this).apply {
            text = "Incoming $kind call"
            textSize = 16f
            setTextColor(pink)
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = dp(DP_SPACING * 2) }
        }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(cream)
            setPadding(dp(DP_SPACING * 2), dp(DP_SPACING * 3), dp(DP_SPACING * 2), dp(DP_SPACING * 3))
            addView(avatar)
            addView(caller)
            addView(subtitle)
            addView(actionButton("Answer as Voice", pink, cream) { answer(callId, sender, "voice") })
            addView(actionButton("Answer as Video", pink, cream) { answer(callId, sender, "video") })
            addView(actionButton("Decline", pink, cream) { decline(callId, sender) })
        }
        setContentView(root)

        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, received: Intent) {
                val id = received.getStringExtra(Fcm.EXTRA_CALL_ID)
                if (id == null || id == callId) finish()
            }
        }
        finishReceiver = receiver
        val filter = IntentFilter(Fcm.ACTION_FINISH)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("DEPRECATION")
            registerReceiver(receiver, filter)
        }
    }

    private fun actionButton(
        label: String,
        pink: Int,
        cream: Int,
        onClick: () -> Unit
    ): Button = Button(this).apply {
        text = label
        setTextColor(cream)
        background = GradientDrawable().apply {
            setColor(pink)
            cornerRadius = 28f
        }
        layoutParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { topMargin = dp(DP_SPACING) }
        setOnClickListener { onClick() }
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private fun answer(callId: String, sender: String, requested: String) {
        val actual = if (
            requested == "video" &&
            !packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)
        ) {
            Toast.makeText(this, "No camera found, use Voice call instead", Toast.LENGTH_LONG).show()
            "voice"
        } else {
            requested
        }
        stopRinging(callId)
        open(Fcm.deepLink(callId, sender, actual, "accept"))
        finish()
    }

    private fun decline(callId: String, sender: String) {
        Fcm.postDecline(callId, sender)
        stopRinging(callId)
        finish()
    }

    private fun stopRinging(callId: String) {
        stopService(Intent(this, CallRingtoneService::class.java).apply { action = Fcm.ACTION_STOP })
        CallStore(this).clearCall(callId)
    }

    private fun open(uri: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (_: Exception) {
            // The app will still handle the deep link when opened manually.
        }
    }

    override fun onDestroy() {
        finishReceiver?.let { unregisterReceiver(it) }
        finishReceiver = null
        super.onDestroy()
    }

    private companion object {
        const val DP_AVATAR = 220
        const val DP_SPACING = 32
    }
}
