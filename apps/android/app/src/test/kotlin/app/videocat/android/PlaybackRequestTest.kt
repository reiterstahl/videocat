package app.videocat.android

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PlaybackRequestTest {
    private val origin = "https://videocat.example.com"
    private val session = "0b7a3f52-1c2d-4e5f-8a9b-0c1d2e3f4a5b"

    private fun body(url: String, extra: String = "") =
        """{"url":"$url","title":"Cumpleaños.mkv","subtitle":"WD Elements","position":12.5,"shuffle":true,"canNext":false,"canRandom":true$extra}"""

    @Test
    fun readsAStreamOfTheServer() {
        val request = PlaybackRequest.parse(body("$origin/api/streams/$session/content"), origin)
        assertNotNull(request)
        request!!
        assertEquals("$origin/api/streams/$session/content", request.url)
        assertEquals("Cumpleaños.mkv", request.title)
        assertEquals("WD Elements", request.subtitle)
        assertEquals(12_500L, request.positionMs)
        assertTrue(request.shuffle)
        assertTrue(request.canAdvance(shuffleOn = true))
        assertFalse(request.canAdvance(shuffleOn = false))
    }

    @Test
    fun refusesAnythingButThatServersStreams() {
        // Another site, or the same host on another scheme or port: the cookie never goes there.
        assertNull(PlaybackRequest.parse(body("https://evil.example/api/streams/$session/content"), origin))
        assertNull(PlaybackRequest.parse(body("http://videocat.example.com/api/streams/$session/content"), origin))
        assertNull(PlaybackRequest.parse(body("https://videocat.example.com:8443/api/streams/$session/content"), origin))
        // The server, but not a stream.
        assertNull(PlaybackRequest.parse(body("$origin/api/auth/logout"), origin))
        assertNull(PlaybackRequest.parse(body("$origin/api/streams/$session/content/../../auth/logout"), origin))
        assertNull(PlaybackRequest.parse(body("$origin/api/streams/$session/content?castToken=x"), origin))
        assertNull(PlaybackRequest.parse(body("$origin/api/streams/a%2Fb/content"), origin))
        assertNull(PlaybackRequest.parse("not json", origin))
        assertNull(PlaybackRequest.parse("""{"title":"x"}""", origin))
    }

    @Test
    fun aBadPositionStartsFromTheBeginning() {
        val negative = PlaybackRequest.parse(body("$origin/api/streams/$session/content").replace("12.5", "-4"), origin)
        assertEquals(0L, negative!!.positionMs)
        val missing = PlaybackRequest.parse("""{"url":"$origin/api/streams/$session/content"}""", origin)
        assertEquals(0L, missing!!.positionMs)
        assertFalse(missing.shuffle)
        assertFalse(missing.canAdvance(true))
    }

    @Test
    fun eventsCarryThePositionInSeconds() {
        assertEquals("next", JSONObject(PlayerEvent.next()).getString("type"))
        assertEquals("ended", JSONObject(PlayerEvent.ended()).getString("type"))
        val closed = JSONObject(PlayerEvent.closed(83_250))
        assertEquals("closed", closed.getString("type"))
        assertEquals(83.25, closed.getDouble("position"), 0.0001)
        val error = JSONObject(PlayerEvent.error(-5, format = true))
        assertEquals(0.0, error.getDouble("position"), 0.0)
        assertTrue(error.getBoolean("format"))
        assertFalse(JSONObject(PlayerEvent.shuffle(false)).getBoolean("enabled"))
        assertEquals("window.videocatAndroidPlayer && window.videocatAndroidPlayer({\"type\":\"next\"})", PlayerEvent.script(PlayerEvent.next()))
    }
}
