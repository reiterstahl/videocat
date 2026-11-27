package app.videocat.android

import android.content.Context
import androidx.core.content.edit

/** The server the app opens: its origin, checked against /api/health when it was saved. */
object ServerStore {
    private const val FILE = "server"
    private const val KEY_ORIGIN = "origin"

    fun get(context: Context): String? =
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE).getString(KEY_ORIGIN, null)

    fun set(context: Context, origin: String) {
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit { putString(KEY_ORIGIN, origin) }
    }
}
