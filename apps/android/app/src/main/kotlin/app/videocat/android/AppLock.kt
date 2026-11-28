package app.videocat.android

import android.content.Context
import android.widget.Toast
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.core.content.edit
import androidx.fragment.app.FragmentActivity

/**
 * "Ask for the fingerprint when opening VideoCAT": the fingerprint works as the app's password,
 * with the phone's fingerprint or face, or its PIN, pattern or password. It asks again after:
 * - a fresh start: the app was closed (Back, swiped away from the recent apps, forced to stop);
 * - the phone was locked (its screen turned off);
 * - a stay in the background of at least the chosen delay.
 *
 * The unlocked state lives in this process only: a new process always starts locked.
 */
object AppLock {
    private const val FILE = "settings"
    private const val KEY_ENABLED = "lock_enabled"
    private const val KEY_AFTER = "lock_after_seconds"

    /** Fingerprint or face, or else the phone's PIN, pattern or password. */
    const val AUTHENTICATORS = BIOMETRIC_WEAK or DEVICE_CREDENTIAL

    /** How long the app may stay in the background before it locks again: right away, 1, 5 or 15 minutes. */
    val delays = listOf(0, 60, 300, 900)
    private const val DEFAULT_DELAY = 60

    @Volatile
    private var unlocked = false
    private var backgroundSinceMs: Long? = null

    fun isEnabled(context: Context): Boolean = prefs(context).getBoolean(KEY_ENABLED, false)

    fun setEnabled(context: Context, enabled: Boolean) = prefs(context).edit { putBoolean(KEY_ENABLED, enabled) }

    fun delaySeconds(context: Context): Int = prefs(context).getInt(KEY_AFTER, DEFAULT_DELAY).takeIf { it in delays } ?: DEFAULT_DELAY

    fun setDelaySeconds(context: Context, seconds: Int) = prefs(context).edit { putInt(KEY_AFTER, seconds) }

    /** Whether the phone can confirm who is using it: a screen lock, with or without biometrics. */
    fun canAuthenticate(context: Context): Boolean =
        BiometricManager.from(context).canAuthenticate(AUTHENTICATORS) == BiometricManager.BIOMETRIC_SUCCESS

    /** Whether a screen of the app must ask before showing anything. */
    fun needsUnlock(context: Context): Boolean = isEnabled(context) && !unlocked

    /** The person just confirmed it is them (turning the lock on, for example). */
    fun markUnlocked() {
        unlocked = true
    }

    /** The app was closed or the phone locked: the next screen asks again. */
    fun relock() {
        unlocked = false
        backgroundSinceMs = null
    }

    /** Every screen of the app went to the background (VideoCatApp counts them). */
    fun onAppBackground(nowMs: Long) {
        backgroundSinceMs = nowMs
    }

    /** A screen of the app came back after all of them were in the background. */
    fun onAppForeground(context: Context, nowMs: Long) {
        if (expired(backgroundSinceMs, nowMs, delaySeconds(context))) unlocked = false
        backgroundSinceMs = null
    }

    /** Whether a stay in the background that began at [backgroundSinceMs] used up the delay. */
    fun expired(backgroundSinceMs: Long?, nowMs: Long, delaySeconds: Int): Boolean {
        val since = backgroundSinceMs ?: return false
        return nowMs - since >= delaySeconds * 1000L
    }

    /**
     * Asks for the fingerprint to unlock the app; [onResult] gets true once it is open, or false
     * and whether the person dismissed the prompt (rather than the system, which cancels it while
     * the phone's own lock screen is up). When the phone's screen lock was removed there is
     * nothing left to confirm with: the lock turns off.
     */
    fun unlock(activity: FragmentActivity, onResult: (open: Boolean, dismissed: Boolean) -> Unit) {
        if (!canAuthenticate(activity)) {
            setEnabled(activity, false)
            Toast.makeText(activity, R.string.lock_no_screen_lock, Toast.LENGTH_LONG).show()
            unlocked = true
            onResult(true, false)
            return
        }
        authenticate(activity, activity.getString(R.string.lock_prompt_title), null) { confirmed, error ->
            if (confirmed) unlocked = true
            onResult(confirmed, error == BiometricPrompt.ERROR_USER_CANCELED || error == BiometricPrompt.ERROR_NEGATIVE_BUTTON)
        }
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
