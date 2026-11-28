package app.videocat.android

import android.app.Activity
import android.app.Application
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Bundle
import android.os.SystemClock
import androidx.core.content.ContextCompat

/**
 * Tells the fingerprint lock when the app as a whole goes to the background and comes back (one
 * screen handing over to another is neither), and when the phone is locked.
 */
class VideoCatApp : Application() {
    override fun onCreate() {
        super.onCreate()
        // New versions from GitHub Releases, every few hours (not in a build for Google Play).
        UpdateCheckJob.schedule(this)
        registerActivityLifecycleCallbacks(object : ActivityLifecycleCallbacks {
            override fun onActivityStarted(activity: Activity) {
                if (started++ == 0) AppLock.onAppForeground(activity, SystemClock.elapsedRealtime())
            }

            override fun onActivityStopped(activity: Activity) {
                started = (started - 1).coerceAtLeast(0)
                // A rotation is not leaving the app.
                if (started == 0 && !activity.isChangingConfigurations) AppLock.onAppBackground(SystemClock.elapsedRealtime())
            }

            override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
            override fun onActivityResumed(activity: Activity) = Unit
            override fun onActivityPaused(activity: Activity) = Unit
            override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
            override fun onActivityDestroyed(activity: Activity) = Unit
        })

        // The phone locked (its screen turned off): the fingerprint again on the way back, as with
        // the phone's own lock. Only the system sends this broadcast.
        val screenOff = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                if (intent.action == Intent.ACTION_SCREEN_OFF) AppLock.relock()
            }
        }
        ContextCompat.registerReceiver(this, screenOff, IntentFilter(Intent.ACTION_SCREEN_OFF), ContextCompat.RECEIVER_NOT_EXPORTED)
    }

    companion object {
        @Volatile
        private var started = 0

        /** Whether a screen of the app is showing. */
        val inForeground: Boolean get() = started > 0
    }
}
