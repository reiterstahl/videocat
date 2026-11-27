package app.videocat.android

import android.content.Context
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.core.content.edit
import androidx.fragment.app.FragmentActivity

/**
 * "Ask for the fingerprint when opening VideoCAT": a privacy lock in front of the app, with the
 * phone's fingerprint or face, or its PIN, pattern or password. The session stays on the phone
 * as before; the lock keeps whoever picks up the unlocked phone out of the catalog.
 */
object AppLock {
    private const val FILE = "settings"
    private const val KEY_ENABLED = "lock_enabled"
    private const val KEY_AFTER = "lock_after_seconds"

    /** Fingerprint or face, or else the phone's PIN, pattern or password. */
    const val AUTHENTICATORS = BIOMETRIC_WEAK or DEVICE_CREDENTIAL

    /** How long the app may stay in the background before it locks again: right away, 1 or 5 minutes. */
    val delays = listOf(0, 60, 300)

    fun isEnabled(context: Context): Boolean = prefs(context).getBoolean(KEY_ENABLED, false)

    fun setEnabled(context: Context, enabled: Boolean) = prefs(context).edit { putBoolean(KEY_ENABLED, enabled) }

    fun delaySeconds(context: Context): Int = prefs(context).getInt(KEY_AFTER, 60).takeIf { it in delays } ?: 60

    fun setDelaySeconds(context: Context, seconds: Int) = prefs(context).edit { putInt(KEY_AFTER, seconds) }

    /** Whether the phone can confirm who is using it: a screen lock, with or without biometrics. */
    fun canAuthenticate(context: Context): Boolean =
        BiometricManager.from(context).canAuthenticate(AUTHENTICATORS) == BiometricManager.BIOMETRIC_SUCCESS

    /**
     * Whether to lock when the app comes back: always on a fresh start, and after a stay in the
     * background of at least the chosen delay. [backgroundSinceMs] is null when the app has not
     * been in the background since it was last unlocked.
     */
    fun shouldLock(enabled: Boolean, freshStart: Boolean, backgroundSinceMs: Long?, nowMs: Long, delaySeconds: Int): Boolean {
        if (!enabled) return false
        if (freshStart) return true
        val since = backgroundSinceMs ?: return false
        return nowMs - since >= delaySeconds * 1000L
    }

    /** Shows the system's prompt; [onResult] gets true once the person is confirmed. */
    fun authenticate(activity: FragmentActivity, title: String, subtitle: String?, onResult: (Boolean, Int?) -> Unit) {
        val prompt = BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) = onResult(true, null)
            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) = onResult(false, errorCode)
        })
        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle(title)
            .apply { if (subtitle != null) setSubtitle(subtitle) }
            .setAllowedAuthenticators(AUTHENTICATORS)
            .build()
        prompt.authenticate(info)
    }

    private fun prefs(context: Context) = context.getSharedPreferences(FILE, Context.MODE_PRIVATE)
}
