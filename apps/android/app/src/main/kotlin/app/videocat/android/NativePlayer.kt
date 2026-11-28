package app.videocat.android

import android.annotation.SuppressLint
import android.app.PictureInPictureParams
import android.content.Intent
import android.content.pm.ActivityInfo
import android.graphics.Rect
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Rational
import android.view.GestureDetector
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.annotation.OptIn
import androidx.annotation.StringRes
import androidx.core.view.isVisible
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.VideoSize
import androidx.media3.common.util.UnstableApi
import androidx.media3.ui.PlayerView
import kotlin.math.abs

/**
 * The native player over the page: plays the stream session the page opened, with ±10 s (also
 * by double-tapping either side), the time bar, audio and subtitle tracks, next or random, picture
 * in picture and background playback. The page decides what plays next; this tells it what
 * happened (PlayerEvent) and waits for the next play() or stop().
 */
@OptIn(UnstableApi::class)
class NativePlayer(
    private val activity: ComponentActivity,
    root: View,
    private val sendEvent: (String) -> Unit,
    private val onOpenChanged: (Boolean) -> Unit
) {
    private val holder: View = root.findViewById(R.id.player_holder)
    private val playerView: PlayerView = root.findViewById(R.id.player_view)
    private val topBar: View = root.findViewById(R.id.player_top)
    private val title: TextView = root.findViewById(R.id.player_title)
    private val subtitle: TextView = root.findViewById(R.id.player_subtitle)
    private val notice: TextView = root.findViewById(R.id.player_notice)
    private val seekFeedback: TextView = root.findViewById(R.id.player_seek)
    private val handler = Handler(Looper.getMainLooper())
    private var player: AdvancingPlayer? = null
    private var videoAspect: Rational? = null
    private var inPictureInPicture = false
    // Each video tells the page once that it ended or failed, and the page answers with play()
    // or stop(); a second report would make it skip a video.
    private var reported = false
    private var listening: AdvancingPlayer? = null
    // A horizontal swipe over the lower half going through the video: where it started, from
    // which finger position, and where it lands on release. NO_SWIPE when there is none.
    private var swipeStartMs = NO_SWIPE
    private var swipeOriginX = 0f
    private var swipeTargetMs = 0L

    val isOpen: Boolean get() = holder.isVisible
    val isPlaying: Boolean get() = player?.isPlaying == true

    // After Next or an error the page opens a new session; if nothing comes, say so.
    private val giveUp = Runnable { showNotice(R.string.player_gave_up) }
    private val hideSeekFeedback = Runnable { seekFeedback.visibility = View.GONE }

    private val listener = object : Player.Listener {
        override fun onPlaybackStateChanged(playbackState: Int) {
            when (playbackState) {
                Player.STATE_READY -> {
                    handler.removeCallbacks(giveUp)
                    notice.visibility = View.GONE
                }
                Player.STATE_ENDED -> if (isOpen && !reported) {
                    reported = true
                    sendEvent(PlayerEvent.ended())
                }
                Player.STATE_BUFFERING, Player.STATE_IDLE -> Unit
            }
        }

        override fun onPlayerError(error: PlaybackException) {
            if (!isOpen || reported) return
            reported = true
            val position = player?.currentPosition ?: 0L
            showNotice(R.string.player_reconnecting)
            waitForPage()
            sendEvent(PlayerEvent.error(position, isFormatProblem(error)))
        }

        override fun onVideoSizeChanged(videoSize: VideoSize) {
            if (videoSize.width == 0 || videoSize.height == 0) return
            val width = videoSize.width * videoSize.pixelWidthHeightRatio
            val landscape = width >= videoSize.height
            if (!inPictureInPicture) {
                activity.requestedOrientation = if (landscape) {
                    ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                } else {
                    ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
                }
            }
            videoAspect = clampAspect(width.toInt(), videoSize.height)
            updatePictureInPicture()
        }

        override fun onIsPlayingChanged(isPlaying: Boolean) {
            updatePictureInPicture()
        }
    }

    init {
        playerView.setShowBuffering(PlayerView.SHOW_BUFFERING_ALWAYS)
        playerView.setShowPreviousButton(false)
        playerView.setShowNextButton(true)
        playerView.setShowShuffleButton(true)
        playerView.setShowSubtitleButton(true)
        playerView.setControllerVisibilityListener(PlayerView.ControllerVisibilityListener { visibility ->
            if (!inPictureInPicture) topBar.visibility = visibility
        })
        root.findViewById<ImageButton>(R.id.player_close).setOnClickListener { close(notifyPage = true) }
        root.findViewById<ImageButton>(R.id.player_pip).setOnClickListener { enterPictureInPicture() }
        attachGestures()
    }

    fun play(request: PlaybackRequest, origin: String) {
        val current = PlayerHolder.get(activity)
        player = current
        PlayerHolder.serverOrigin = origin
        PlayerHolder.canNext = request.canNext
        PlayerHolder.canRandom = request.canRandom
        PlayerHolder.onAdvance = { advance() }
        // The page's own shuffle setting: applied without telling the page back.
        PlayerHolder.onShuffleChanged = null
        current.shuffleModeEnabled = request.shuffle
        PlayerHolder.onShuffleChanged = { enabled -> sendEvent(PlayerEvent.shuffle(enabled)) }

        handler.removeCallbacks(giveUp)
        notice.visibility = View.GONE
        title.text = request.title
        subtitle.text = request.subtitle
        subtitle.isVisible = request.subtitle.isNotEmpty()
        if (!isOpen) open(current)

        reported = false
        if (listening !== current) {
            current.addListener(listener)
            listening = current
        }
        val item = MediaItem.Builder()
            .setUri(request.url)
            .setMediaMetadata(MediaMetadata.Builder().setTitle(request.title).setArtist(request.subtitle).build())
            .build()
        current.setMediaItem(item, request.positionMs)
        current.prepare()
        current.play()
        // Keeps playing with the screen off; the service shows the media notification.
        activity.startService(Intent(activity, PlaybackService::class.java))
    }

    /** Closes the player. [notifyPage] is false when the page itself asked (stop()). */
    fun close(notifyPage: Boolean) {
        if (!isOpen) return
        val position = player?.currentPosition ?: 0L
        handler.removeCallbacks(giveUp)
        player?.run {
            stop()
            clearMediaItems()
        }
        PlayerHolder.onAdvance = null
        PlayerHolder.onShuffleChanged = null
        playerView.player = null
        holder.visibility = View.GONE
        notice.visibility = View.GONE
        videoAspect = null
        activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        activity.stopService(Intent(activity, PlaybackService::class.java))
        updatePictureInPicture()
        onOpenChanged(false)
        // The video ended or stopped in the small window: the window goes too, instead of
        // showing the page in miniature.
        if (inPictureInPicture) activity.moveTaskToBack(false)
        if (notifyPage) sendEvent(PlayerEvent.closed(position))
    }

    fun onPictureInPictureChanged(inPip: Boolean) {
        inPictureInPicture = inPip
        playerView.useController = !inPip
        if (inPip) {
            topBar.visibility = View.GONE
            seekFeedback.visibility = View.GONE
        } else {
            playerView.showController()
        }
    }

    fun enterPictureInPicture() {
        if (!isOpen) return
        activity.enterPictureInPictureMode(pictureInPictureParams())
    }

    /** What the system needs to open picture in picture on its own when leaving the app. */
    fun updatePictureInPicture() {
        activity.setPictureInPictureParams(pictureInPictureParams())
    }

    private fun pictureInPictureParams(): PictureInPictureParams {
        val builder = PictureInPictureParams.Builder()
        videoAspect?.let { builder.setAspectRatio(it) }
        // Where the video is on screen, so the system animates from it into the small window.
        val bounds = Rect()
        if (isOpen && playerView.getGlobalVisibleRect(bounds)) builder.setSourceRectHint(bounds)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            builder.setAutoEnterEnabled(isOpen && isPlaying)
            builder.setSeamlessResizeEnabled(true)
        }
        return builder.build()
    }

    private fun open(current: AdvancingPlayer) {
        playerView.player = current
        holder.visibility = View.VISIBLE
        topBar.visibility = View.VISIBLE
        onOpenChanged(true)
    }

    private fun advance() {
        if (reported) return
        reported = true
        player?.stop()
        showNotice(R.string.player_loading_next)
        waitForPage()
        sendEvent(PlayerEvent.next())
    }

    private fun waitForPage() {
        handler.removeCallbacks(giveUp)
        handler.postDelayed(giveUp, PAGE_TIMEOUT_MS)
    }

    private fun showNotice(@StringRes text: Int) {
        notice.setText(text)
        notice.visibility = View.VISIBLE
    }

    // One tap shows or hides the controls; two taps on a side go back or forward 10 seconds; a
    // horizontal swipe over the lower half goes through the video (right forward, left back) and
    // jumps there on release.
    @SuppressLint("ClickableViewAccessibility")
    private fun attachGestures() {
        val swipeSlop = ViewConfiguration.get(activity).scaledTouchSlop * 2
        val detector = GestureDetector(activity, object : GestureDetector.SimpleOnGestureListener() {
            override fun onDown(e: MotionEvent): Boolean = true

            override fun onScroll(e1: MotionEvent?, e2: MotionEvent, distanceX: Float, distanceY: Float): Boolean {
                val down = e1 ?: return false
                val current = player ?: return false
                if (swipeStartMs == NO_SWIPE) {
                    val dx = e2.x - down.x
                    val dy = e2.y - down.y
                    // The upper half stays free (the system's own swipes come from the edges).
                    if (down.y < playerView.height / 2f) return false
                    if (abs(dx) < swipeSlop || abs(dx) < abs(dy) * 1.5f) return false
                    if (current.duration == C.TIME_UNSET || !current.isCurrentMediaItemSeekable) return false
                    swipeStartMs = current.currentPosition
                    swipeOriginX = e2.x
                    playerView.hideController()
                    handler.removeCallbacks(hideSeekFeedback)
                    seekFeedback.layoutParams = (seekFeedback.layoutParams as FrameLayout.LayoutParams).apply {
                        gravity = Gravity.CENTER
                    }
                    seekFeedback.visibility = View.VISIBLE
                }
                swipeTargetMs = SwipeSeek.target(swipeStartMs, e2.x - swipeOriginX, playerView.width, current.duration)
                seekFeedback.text = SwipeSeek.label(swipeTargetMs - swipeStartMs, swipeTargetMs, current.duration)
                return true
            }

            override fun onSingleTapConfirmed(e: MotionEvent): Boolean {
                if (playerView.isControllerFullyVisible) playerView.hideController() else playerView.showController()
                return true
            }

            override fun onDoubleTap(e: MotionEvent): Boolean {
                val current = player ?: return false
                val back = e.x < playerView.width / 2f
                if (back) current.seekBack() else current.seekForward()
                seekFeedback.setText(if (back) R.string.player_seek_back else R.string.player_seek_forward)
                seekFeedback.layoutParams = (seekFeedback.layoutParams as FrameLayout.LayoutParams).apply {
                    gravity = Gravity.CENTER_VERTICAL or if (back) Gravity.START else Gravity.END
                }
                seekFeedback.visibility = View.VISIBLE
                handler.removeCallbacks(hideSeekFeedback)
                handler.postDelayed(hideSeekFeedback, 650)
                return true
            }
        })
        // No performClick() here: PlayerView's toggles the controls, which the single tap already
        // does, and TalkBack still uses PlayerView's own click.
        val onTouch = View.OnTouchListener { _, event ->
            if (inPictureInPicture) return@OnTouchListener false
            val handled = detector.onTouchEvent(event)
            if (swipeStartMs != NO_SWIPE && (event.actionMasked == MotionEvent.ACTION_UP || event.actionMasked == MotionEvent.ACTION_CANCEL)) {
                if (event.actionMasked == MotionEvent.ACTION_UP) player?.seekTo(swipeTargetMs)
                swipeStartMs = NO_SWIPE
                handler.removeCallbacks(hideSeekFeedback)
                handler.postDelayed(hideSeekFeedback, 500)
                return@OnTouchListener true
            }
            handled
        }
        playerView.setOnTouchListener(onTouch)
        // With the controls showing, their layer gets the touches outside its buttons: the same
        // gestures there, so a double tap works whether or not the controls are visible.
        playerView.findViewById<View>(androidx.media3.ui.R.id.exo_controller)?.setOnTouchListener(onTouch)
    }

    companion object {
        private const val PAGE_TIMEOUT_MS = 25_000L
        private const val NO_SWIPE = -1L

        /** The phone could not read the file or decode its video or audio: the MP4 copy may help. */
        fun isFormatProblem(error: PlaybackException): Boolean =
            error.errorCode in PlaybackException.ERROR_CODE_PARSING_CONTAINER_MALFORMED..PlaybackException.ERROR_CODE_PARSING_MANIFEST_UNSUPPORTED ||
                error.errorCode in PlaybackException.ERROR_CODE_DECODER_INIT_FAILED..PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED ||
                error.errorCode in PlaybackException.ERROR_CODE_AUDIO_TRACK_INIT_FAILED..PlaybackException.ERROR_CODE_AUDIO_TRACK_OFFLOAD_INIT_FAILED

        /** Picture in picture accepts aspect ratios between 1:2.39 and 2.39:1. */
        fun clampAspect(width: Int, height: Int): Rational {
            val ratio = width.toDouble() / height
            return when {
                ratio > 2.39 -> Rational(239, 100)
                ratio < 1 / 2.39 -> Rational(100, 239)
                else -> Rational(width, height)
            }
        }
    }
}
