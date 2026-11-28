package app.videocat.android

import android.app.PendingIntent
import android.content.Intent
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService

/**
 * Keeps a video playing with the screen off or the app in the background, with its controls in
 * the notification and on the lock screen.
 */
@OptIn(UnstableApi::class)
class PlaybackService : MediaSessionService() {
    private var session: MediaSession? = null

    override fun onCreate() {
        super.onCreate()
        val openApp = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val created = MediaSession.Builder(this, PlayerHolder.get(this))
            .setSessionActivity(openApp)
            .setCallback(object : MediaSession.Callback {
                // The notification, the system's media controls and this app; not any other app
                // that would like to read what is playing or drive it.
                override fun onConnect(session: MediaSession, controller: MediaSession.ControllerInfo): MediaSession.ConnectionResult =
                    if (session.isMediaNotificationController(controller) || controller.isTrusted || controller.packageName == packageName) {
                        super.onConnect(session, controller)
                    } else {
                        MediaSession.ConnectionResult.reject()
                    }
            })
            .build()
        session = created
        addSession(created)
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

    // Swiping the app away stops the video, and closes the app: the fingerprint asks again.
    override fun onTaskRemoved(rootIntent: Intent?) {
        AppLock.relock()
        session?.player?.run {
            pause()
            stop()
        }
        stopSelf()
    }

    override fun onDestroy() {
        session?.release()
        session = null
        super.onDestroy()
    }
}
