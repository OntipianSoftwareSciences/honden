package com.honden.fcm

import android.app.Activity
import android.content.Intent
import android.database.Cursor
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import android.util.Log
import android.webkit.MimeTypeMap
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.google.firebase.messaging.FirebaseMessaging
import java.io.ByteArrayOutputStream
import java.io.IOException

@InvokeArg
internal class PickMomentArgs {
    var kind: String? = null
}

@TauriPlugin
class HondenFcmPlugin(private val activity: Activity) : Plugin(activity) {
    private var pendingMomentInvoke: Invoke? = null

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

    /**
     * Opens the Android file picker natively and copies the selected bytes into
     * a data URL. Android gallery/file pickers return content:// URIs to WebView
     * file inputs, whose JS File can lose access or report size 0. Reading the
     * URI here with ContentResolver avoids that WebView-specific mismatch.
     */
    @Command
    fun pickMomentMedia(invoke: Invoke) {
        if (pendingMomentInvoke != null) {
            invoke.reject("Another media picker is already open")
            return
        }
        pendingMomentInvoke = invoke
        try {
            val audioOnly = try {
                invoke.parseArgs(PickMomentArgs::class.java).kind == "audio"
            } catch (_: Exception) {
                false
            }
            val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
                type = if (audioOnly) "audio/*" else "*/*"
                putExtra(
                    Intent.EXTRA_MIME_TYPES,
                    if (audioOnly) arrayOf("audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/wave")
                    else arrayOf("image/*", "video/*"),
                )
                putExtra(Intent.EXTRA_ALLOW_MULTIPLE, false)
                addCategory(Intent.CATEGORY_OPENABLE)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            startActivityForResult(invoke, intent, "onMomentPicked")
        } catch (error: Throwable) {
            pendingMomentInvoke = null
            resolveMomentError(invoke, "", 0L, "unknown", "", error)
        }
    }

    @ActivityCallback
    fun onMomentPicked(invoke: Invoke, result: ActivityResult) {
        pendingMomentInvoke = null
        val audioOnly = try {
            invoke.parseArgs(PickMomentArgs::class.java).kind == "audio"
        } catch (_: Exception) {
            false
        }
        val uri = if (result.resultCode == Activity.RESULT_OK) result.data?.data else null
        if (uri == null) {
            val cancelled = JSObject()
            cancelled.put("ok", false)
            cancelled.put("cancelled", true)
            cancelled.put("type", "")
            cancelled.put("size", 0)
            cancelled.put("scheme", "unknown")
            cancelled.put("name", "")
            cancelled.put("dataUrl", "")
            cancelled.put("errorName", "")
            cancelled.put("errorMessage", "")
            invoke.resolve(cancelled)
            return
        }

        val scheme = uriScheme(uri)
        var type = ""
        var size = 0L
        var name = ""
        try {
            val metadata = queryMetadata(uri)
            name = metadata.first.orEmpty()
            size = metadata.second ?: 0L
            type = mimeType(uri, name)
            if (!isAllowed(type, name, audioOnly)) {
                throw IOException(
                    if (audioOnly) "unsupported file type; choose an .mp3 or .wav"
                    else "unsupported file type; choose an image or a video",
                )
            }
            if (size > MAX_MOMENT_BYTES) {
                throw IOException("file is larger than 50 MB")
            }
            val bytes = readBytes(uri)
            size = bytes.size.toLong()
            val encoded = Base64.encodeToString(bytes, Base64.NO_WRAP)
            Log.i(TAG, "moment picker read: type=$type size=$size scheme=$scheme")

            val picked = JSObject()
            picked.put("ok", true)
            picked.put("cancelled", false)
            picked.put("type", type)
            picked.put("size", size.toInt())
            picked.put("scheme", scheme)
            picked.put("name", if (name.isBlank()) defaultName(type, audioOnly) else name)
            picked.put("dataUrl", "data:$type;base64,$encoded")
            picked.put("errorName", "")
            picked.put("errorMessage", "")
            invoke.resolve(picked)
        } catch (error: Throwable) {
            resolveMomentError(invoke, type, size, scheme, name, error)
        }
    }

    private fun resolveMomentError(
        invoke: Invoke,
        type: String,
        size: Long,
        scheme: String,
        name: String,
        error: Throwable,
    ) {
        val errorName = error.javaClass.simpleName
        val errorMessage = error.message ?: "unknown error"
        Log.w(TAG, "moment picker failed: type=$type size=$size scheme=$scheme error=$errorName: $errorMessage")

        val result = JSObject()
        result.put("ok", false)
        result.put("cancelled", false)
        result.put("type", type)
        result.put("size", size.toInt())
        result.put("scheme", scheme)
        result.put("name", name)
        result.put("dataUrl", "")
        result.put("errorName", errorName)
        result.put("errorMessage", errorMessage)
        invoke.resolve(result)
    }

    private fun queryMetadata(uri: Uri): Pair<String?, Long?> {
        val projection = arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE)
        activity.contentResolver.query(uri, projection, null, null, null)?.use { cursor: Cursor ->
            if (cursor.moveToFirst()) {
                val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
                val name = if (nameIndex >= 0) cursor.getString(nameIndex) else null
                val size = if (sizeIndex >= 0) cursor.getLong(sizeIndex) else -1L
                return Pair(name, if (size >= 0) size else null)
            }
        }
        return Pair(null, null)
    }

    private fun mimeType(uri: Uri, name: String): String {
        val resolverType = activity.contentResolver.getType(uri)
        if (!resolverType.isNullOrBlank() && resolverType != "application/octet-stream") {
            return resolverType
        }
        val extension = name.substringAfterLast('.', "").lowercase()
        val mapped = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension)
        if (!mapped.isNullOrBlank()) return mapped
        return when (extension) {
            "heic", "heif" -> "image/heic"
            "m4v" -> "video/x-m4v"
            "3gp" -> "video/3gpp"
            else -> "application/octet-stream"
        }
    }

    private fun readBytes(uri: Uri): ByteArray {
        val stream = activity.contentResolver.openInputStream(uri)
            ?: throw IOException("ContentResolver returned no input stream")
        stream.use { input ->
            val output = ByteArrayOutputStream()
            val buffer = ByteArray(64 * 1024)
            var total = 0
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                total += count
                if (total > MAX_MOMENT_BYTES) {
                    throw IOException("file is larger than 50 MB")
                }
                output.write(buffer, 0, count)
            }
            return output.toByteArray()
        }
    }

    private fun isAllowed(type: String, name: String, audioOnly: Boolean): Boolean {
        if (!audioOnly) return type.startsWith("image/") || type.startsWith("video/")
        val extension = name.substringAfterLast('.', "").lowercase()
        if (extension != "mp3" && extension != "wav") return false
        val normalized = type.lowercase()
        return normalized.isEmpty() || normalized.startsWith("audio/") || normalized == "application/octet-stream"
    }

    private fun uriScheme(uri: Uri): String = when (uri.scheme) {
        null -> "unknown"
        "content" -> "content://"
        "file" -> "file://"
        else -> "${uri.scheme}://"
    }

    private fun defaultName(type: String, audioOnly: Boolean): String = when {
        audioOnly -> if (type.contains("wav")) "moment.wav" else "moment.mp3"
        type.startsWith("image/") -> "moment.${type.removePrefix("image/")}"
        type.startsWith("video/") -> "moment.${type.removePrefix("video/")}"
        else -> "moment"
    }

    private companion object {
        const val TAG = "HondenFcm"
        const val MAX_MOMENT_BYTES = 50 * 1024 * 1024
    }
}
