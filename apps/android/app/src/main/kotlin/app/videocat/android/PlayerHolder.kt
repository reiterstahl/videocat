package app.videocat.android

import android.content.Context
import android.os.Handler
import android.webkit.CookieManager
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.ForwardingPlayer
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.ResolvingDataSource
import androidx.media3.decoder.ffmpeg.FfmpegAudioRenderer
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.Renderer
import androidx.media3.exoplayer.audio.AudioRendererEventListener
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.mediacodec.MediaCodecSelector
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.util.EventLogger
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory

/**
 * The one player of the app, shared by the screen (MainActivity) and the media session that
 * keeps it playing in the background (PlaybackService). Both live in the same process.
 */
@OptIn(UnstableApi::class)
object PlayerHolder {
    private var player: AdvancingPlayer? = null

    /** The server whose cookie goes with the stream requests; nothing else gets it. */
    @Volatile
    var serverOrigin: String? = null

    var canNext = false
    var canRandom = false
    var onAdvance: (() -> Unit)? = null
    var onShuffleChanged: ((Boolean) -> Unit)? = null

    fun get(context: Context): AdvancingPlayer {
        player?.let { return it }
        val http = DefaultHttpDataSource.Factory()
            .setUserAgent("VideoCATAndroid/${BuildConfig.VERSION_NAME}")
            .setConnectTimeoutMs(15_000)
            .setReadTimeoutMs(30_000)
        // The stream belongs to the WebView's session: its cookie, read at every request so a new
        // sign-in is picked up, and only for the server's own address.
        val withSession = ResolvingDataSource.Factory(http) { spec ->
            val url = spec.uri.toString()
            val cookie = if (ServerAddress.origin(url) == serverOrigin) CookieManager.getInstance().getCookie(url) else null
            if (cookie.isNullOrEmpty()) spec else spec.withAdditionalHeaders(mapOf("Cookie" to cookie))
        }
        val renderers = WithFfmpegAudio(context.applicationContext)
        val exo = ExoPlayer.Builder(context.applicationContext, renderers)
            .setMediaSourceFactory(DefaultMediaSourceFactory(withSession))
            .setSeekBackIncrementMs(10_000)
            .setSeekForwardIncrementMs(10_000)
            .setAudioAttributes(
                AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(),
                /* handleAudioFocus= */ true
            )
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .build()
        // Tracks, decoders and errors in logcat (tag EventLogger), for debugging only.
        if (BuildConfig.DEBUG) exo.addAnalyticsListener(EventLogger())
        return AdvancingPlayer(exo).also { player = it }
    }

    fun release() {
        player?.release()
        player = null
    }
}

/**
 * Next and shuffle as the web understands them: Next asks the page for the following (or a
 * random) video, which opens a new stream session and plays it here. The shuffle flag is the
 * player's own, so the controls show it, and its changes go back to the page.
 */
@OptIn(UnstableApi::class)
class AdvancingPlayer(player: ExoPlayer) : ForwardingPlayer(player) {
    private fun canAdvance(): Boolean = if (shuffleModeEnabled) PlayerHolder.canRandom else PlayerHolder.canNext

    override fun getAvailableCommands(): Player.Commands {
        val commands = super.getAvailableCommands().buildUpon()
        if (canAdvance()) {
            commands.addAll(Player.COMMAND_SEEK_TO_NEXT, Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)
        } else {
            commands.removeAll(Player.COMMAND_SEEK_TO_NEXT, Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)
        }
        return commands.build()
    }

    override fun isCommandAvailable(command: Int): Boolean = when (command) {
        Player.COMMAND_SEEK_TO_NEXT, Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM -> canAdvance()
        else -> super.isCommandAvailable(command)
    }

    override fun hasNextMediaItem(): Boolean = canAdvance()

    override fun seekToNext() {
        if (canAdvance()) PlayerHolder.onAdvance?.invoke()
    }

    override fun seekToNextMediaItem() {
        if (canAdvance()) PlayerHolder.onAdvance?.invoke()
    }

    override fun setShuffleModeEnabled(shuffleModeEnabled: Boolean) {
        super.setShuffleModeEnabled(shuffleModeEnabled)
        PlayerHolder.onShuffleChanged?.invoke(shuffleModeEnabled)
    }
}

/**
 * The phone's own decoders first, then FFmpeg for the audio it lacks: usually the AC3, E-AC3 and
 * DTS of MKV files, which would otherwise play without sound. Added here by name rather than
 * through Media3's reflection, which R8 cannot see and strips from the release build.
 */
@OptIn(UnstableApi::class)
private class WithFfmpegAudio(context: Context) : DefaultRenderersFactory(context) {
    override fun buildAudioRenderers(
        context: Context,
        extensionRendererMode: Int,
        mediaCodecSelector: MediaCodecSelector,
        enableDecoderFallback: Boolean,
        audioSink: AudioSink,
        eventHandler: Handler,
        eventListener: AudioRendererEventListener,
        out: ArrayList<Renderer>
    ) {
        super.buildAudioRenderers(context, EXTENSION_RENDERER_MODE_OFF, mediaCodecSelector, enableDecoderFallback, audioSink, eventHandler, eventListener, out)
        out.add(FfmpegAudioRenderer(eventHandler, eventListener, audioSink))
    }
}

