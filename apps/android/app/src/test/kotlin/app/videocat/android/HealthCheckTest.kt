package app.videocat.android

import app.videocat.android.HealthCheck.Problem
import app.videocat.android.HealthCheck.Response
import app.videocat.android.HealthCheck.Result
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.security.cert.CertificateException
import javax.net.ssl.SSLHandshakeException

class HealthCheckTest {
    private fun server(vararg answers: Pair<String, Any>): (String) -> Response {
        val map = answers.toMap()
        return { url ->
            when (val answer = map[url]) {
                is Response -> answer
                is IOException -> throw answer
                else -> throw ConnectException("refused")
            }
        }
    }

    private val ok = Response(200, null, """{"ok":true}""")

    @Test
    fun recognizesVideoCatsHealthAnswer() {
        assertTrue(HealthCheck.isVideoCatHealth("""{"ok":true}"""))
        assertFalse(HealthCheck.isVideoCatHealth("""{"ok":false}"""))
        assertFalse(HealthCheck.isVideoCatHealth("""{"status":"up"}"""))
        assertFalse(HealthCheck.isVideoCatHealth("<html>Welcome to nginx</html>"))
        assertFalse(HealthCheck.isVideoCatHealth(""))
    }

    @Test
    fun aLanAddressWithoutSchemeEndsUpOnHttp() {
        val fetch = server(
            "https://192.168.1.27:8080/api/health" to SSLHandshakeException("not TLS"),
            "http://192.168.1.27:8080/api/health" to ok
        )
        assertEquals(Result.Found("http://192.168.1.27:8080"), HealthCheck.check(ServerAddress.candidates("192.168.1.27:8080")!!, fetch))
    }

    @Test
    fun followsARedirectToHttpsAndKeepsWhereItLanded() {
        val fetch = server(
            "http://videocat.example.com/api/health" to Response(301, "https://videocat.example.com/api/health", ""),
            "https://videocat.example.com/api/health" to ok
        )
        assertEquals(Result.Found("https://videocat.example.com"), HealthCheck.check(listOf("http://videocat.example.com"), fetch))
    }

    @Test
    fun aSignInInFrontIsKeptForTheAppToOpen() {
        // Cloudflare Access sends to its own site; the WebView signs in there and comes back.
        val access = server("https://videocat.example.com/api/health" to Response(302, "https://team.cloudflareaccess.com/login", ""))
        assertEquals(Result.Found("https://videocat.example.com"), HealthCheck.check(listOf("https://videocat.example.com"), access))
    }

    @Test
    fun anotherServerIsNotVideoCat() {
        val nginx = server("http://nas/api/health" to Response(404, null, "Not found"))
        assertEquals(Problem.NOT_VIDEOCAT, (HealthCheck.check(listOf("http://nas"), nginx) as Result.Failed).problem)
        val loop = server("http://a.example/api/health" to Response(302, "/api/health", ""))
        assertEquals(Problem.NOT_VIDEOCAT, (HealthCheck.check(listOf("http://a.example"), loop) as Result.Failed).problem)
    }

    @Test
    fun reportsTheMostTellingFailure() {
        val badCertificate = SSLHandshakeException("handshake").apply { initCause(CertificateException("Trust anchor not found")) }
        val fetch = server("https://videocat.example.com/api/health" to badCertificate)
        val failed = HealthCheck.check(ServerAddress.candidates("videocat.example.com")!!, fetch) as Result.Failed
        assertEquals(Result.Failed("https://videocat.example.com", Problem.CERTIFICATE), failed)

        val slow = server("https://nas/api/health" to SocketTimeoutException("slow"))
        // The first candidate's failure is reported (https timed out), not http's refusal.
        assertEquals(Problem.TIMEOUT, (HealthCheck.check(listOf("https://nas", "http://nas"), slow) as Result.Failed).problem)
        assertEquals(Problem.UNREACHABLE, (HealthCheck.check(listOf("http://nas"), server()) as Result.Failed).problem)
    }
}
