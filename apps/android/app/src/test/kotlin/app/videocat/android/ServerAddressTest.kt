package app.videocat.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ServerAddressTest {
    @Test
    fun withoutSchemeTriesHttpsThenHttp() {
        assertEquals(listOf("https://192.168.1.27:8080", "http://192.168.1.27:8080"), ServerAddress.candidates(" 192.168.1.27:8080/ "))
        assertEquals(listOf("https://videocat.example.com", "http://videocat.example.com"), ServerAddress.candidates("VideoCAT.example.com/catalogo"))
    }

    @Test
    fun withSchemeKeepsOnlyThatOrigin() {
        assertEquals(listOf("http://nas:8080"), ServerAddress.candidates("http://nas:8080/catalogo?x=1"))
        assertEquals(listOf("https://videocat.example.com"), ServerAddress.candidates("HTTPS://videocat.example.com:443/"))
        assertEquals(listOf("http://[fd00::5]:8080"), ServerAddress.candidates("http://[fd00::5]:8080"))
    }

    @Test
    fun refusesWhatIsNotAnHttpAddress() {
        assertNull(ServerAddress.candidates(""))
        assertNull(ServerAddress.candidates("   "))
        assertNull(ServerAddress.candidates("ftp://nas"))
        assertNull(ServerAddress.candidates("javascript:alert(1)"))
        assertNull(ServerAddress.candidates("my server"))
        assertNull(ServerAddress.candidates("http://user:pass@nas"))
        assertNull(ServerAddress.candidates("http://bad_name"))
    }

    @Test
    fun originComparesSchemeHostAndPort() {
        assertEquals("http://192.168.1.27:8080", ServerAddress.origin("http://192.168.1.27:8080/api/files?id=1#x"))
        assertEquals("https://a.example", ServerAddress.origin("https://A.example:443/x"))
        assertTrue(ServerAddress.origin("https://a.example:8443") != ServerAddress.origin("https://a.example"))
        assertTrue(ServerAddress.origin("http://a.example") != ServerAddress.origin("https://a.example"))
        assertNull(ServerAddress.origin("intent://scan#Intent;end"))
    }

    @Test
    fun warnsOnlyForPlainHttpOutsideTheNetwork() {
        assertTrue(ServerAddress.isUnencryptedOverInternet("http://videocat.example.com"))
        assertTrue(ServerAddress.isUnencryptedOverInternet("http://203.0.113.7:8080"))
        assertFalse(ServerAddress.isUnencryptedOverInternet("https://videocat.example.com"))
        for (local in listOf("http://192.168.1.27:8080", "http://10.0.0.2", "http://172.20.0.1", "http://100.101.102.103",
            "http://nas:8080", "http://nas.local", "http://localhost", "http://[fd00::5]:8080", "http://box.tail1234.ts.net")) {
            assertFalse(local, ServerAddress.isUnencryptedOverInternet(local))
        }
        assertTrue(ServerAddress.isUnencryptedOverInternet("http://172.32.0.1"))
    }
}
