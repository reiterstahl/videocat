package app.videocat.android

import org.json.JSONObject
import java.net.URI

/**
 * What the page asks the native player to play (window.VideoCatAndroid.play(json)): a stream
 * session the web already opened on the person's server, with what the controls need to know.
 */
data class PlaybackRequest(
    val url: String,
    val title: String,
    val subtitle: String,
    val positionMs: Long,
    /** Next plays a random video instead of the following one (the web's shuffle switch). */
    val shuffle: Boolean,
    /** Whether there is a following video, and whether a random one can be chosen. */
    val canNext: Boolean,
    val canRandom: Boolean
) {
    fun canAdvance(shuffleOn: Boolean): Boolean = if (shuffleOn) canRandom else canNext

    companion object {
        private val streamPath = Regex("^/api/streams/[A-Za-z0-9-]{1,64}/content$")

        /**
         * Only a stream of the server the app opens: any page in the WebView can call the
         * bridge, and the player sends that server's session cookie with every request.
         */
        fun parse(json: String, origin: String): PlaybackRequest? = try {
            val body = JSONObject(json)
            val url = body.getString("url")
            val uri = URI(url)
            if (ServerAddress.origin(url) != origin) null
            else if (!streamPath.matches(uri.rawPath.orEmpty()) || uri.rawQuery != null || uri.rawFragment != null) null
            else {
                val seconds = body.optDouble("position", 0.0).takeIf { it.isFinite() && it >= 0 } ?: 0.0
                PlaybackRequest(
                    url = url,
                    title = body.optString("title").take(300),
                    subtitle = body.optString("subtitle").take(200),
                    positionMs = (seconds * 1000).toLong(),
                    shuffle = body.optBoolean("shuffle", false),
                    canNext = body.optBoolean("canNext", false),
                    canRandom = body.optBoolean("canRandom", false)
                )
            }
        } catch (_: Exception) {
            null
        }
    }
}

/**
 * What the native player tells the page, through window.videocatAndroidPlayer(event):
 *   {"type":"next"}             Next was pressed: open the following or a random video and play it
 *   {"type":"ended"}            the video finished
 *   {"type":"shuffle","enabled":true}
 *   {"type":"closed","position":12.3}
 *   {"type":"error","position":12.3,"format":true}  format: the phone could not read or decode it
 */
object PlayerEvent {
    fun next(): String = JSONObject().put("type", "next").toString()
    fun ended(): String = JSONObject().put("type", "ended").toString()
    fun shuffle(enabled: Boolean): String = JSONObject().put("type", "shuffle").put("enabled", enabled).toString()
    fun closed(positionMs: Long): String = JSONObject().put("type", "closed").put("position", seconds(positionMs)).toString()
    fun error(positionMs: Long, format: Boolean): String =
        JSONObject().put("type", "error").put("position", seconds(positionMs)).put("format", format).toString()

    /** The call that delivers [event] to the page; nothing happens on a page that does not listen. */
    fun script(event: String): String =
        "window.videocatAndroidPlayer && window.videocatAndroidPlayer($event)"

    private fun seconds(positionMs: Long): Double = maxOf(0L, positionMs) / 1000.0
}
