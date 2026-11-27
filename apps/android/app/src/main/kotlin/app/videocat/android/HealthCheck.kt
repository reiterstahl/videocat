package app.videocat.android

import org.json.JSONObject
import java.io.IOException
import java.net.ConnectException
import java.net.HttpURLConnection
import java.net.NoRouteToHostException
import java.net.SocketTimeoutException
import java.net.URL
import java.net.UnknownHostException
import java.security.cert.CertPathValidatorException
import java.security.cert.CertificateException
import javax.net.ssl.SSLPeerUnverifiedException

/** Checks that an address is a VideoCAT server before the app keeps it. */
object HealthCheck {
    enum class Problem { UNREACHABLE, TIMEOUT, CERTIFICATE, NOT_VIDEOCAT }

    sealed interface Result {
        /** [origin] is where the server really is, after any redirect (http → https, for example). */
        data class Found(val origin: String) : Result
        data class Failed(val origin: String, val problem: Problem) : Result
    }

    private const val MAX_REDIRECTS = 3
    private const val TIMEOUT_MS = 8_000

    /** VideoCAT answers /api/health with {"ok":true}. */
    fun isVideoCatHealth(body: String): Boolean = try {
        JSONObject(body).optBoolean("ok", false)
    } catch (_: Exception) {
        false
    }

    /**
     * Tries each candidate in order and returns the first server found. When none answers, the
     * most telling failure: a server that is not VideoCAT, then a certificate problem, then the
     * first candidate's failure.
     */
    fun check(candidates: List<String>, fetch: (String) -> Response = ::get): Result {
        val failures = mutableListOf<Result.Failed>()
        for (candidate in candidates) {
            when (val result = checkOne(candidate, fetch)) {
                is Result.Found -> return result
                is Result.Failed -> failures += result
            }
        }
        return failures.firstOrNull { it.problem == Problem.NOT_VIDEOCAT }
            ?: failures.firstOrNull { it.problem == Problem.CERTIFICATE }
            ?: failures.first()
    }

    private fun checkOne(start: String, fetch: (String) -> Response): Result {
        var origin = start
        repeat(MAX_REDIRECTS + 1) {
            val response = try {
                fetch("$origin/api/health")
            } catch (error: IOException) {
                return Result.Failed(origin, problemOf(error))
            }
            if (response.status in 300..399) {
                val target = response.location?.let { ServerAddress.origin(URL(URL("$origin/api/health"), it).toString()) }
                    ?: return Result.Failed(origin, Problem.NOT_VIDEOCAT)
                if (target == origin) return Result.Failed(origin, Problem.NOT_VIDEOCAT)
                // To another site: a sign-in in front of the server (Cloudflare Access, for
                // example). The app can open it, sign in there and reach VideoCAT behind it.
                if (ServerAddress.host(target) != ServerAddress.host(origin)) return Result.Found(origin)
                origin = target
                return@repeat
            }
            return if (response.status == 200 && isVideoCatHealth(response.body)) {
                Result.Found(origin)
            } else {
                Result.Failed(origin, Problem.NOT_VIDEOCAT)
            }
        }
        return Result.Failed(origin, Problem.NOT_VIDEOCAT)
    }

    fun problemOf(error: IOException): Problem {
        var cause: Throwable? = error
        while (cause != null) {
            when (cause) {
                // Not trusted, expired, or issued for another name.
                is CertificateException, is CertPathValidatorException, is SSLPeerUnverifiedException -> return Problem.CERTIFICATE
                is SocketTimeoutException -> return Problem.TIMEOUT
                is UnknownHostException, is ConnectException, is NoRouteToHostException -> return Problem.UNREACHABLE
            }
            cause = cause.cause
        }
        // Anything else, such as https:// tried first on a port that only speaks http.
        return Problem.UNREACHABLE
    }

    data class Response(val status: Int, val location: String?, val body: String)

    private fun get(url: String): Response {
        val connection = URL(url).openConnection() as HttpURLConnection
        try {
            connection.instanceFollowRedirects = false
            connection.connectTimeout = TIMEOUT_MS
            connection.readTimeout = TIMEOUT_MS
            connection.setRequestProperty("Accept", "application/json")
            val status = connection.responseCode
            val stream = if (status >= 400) connection.errorStream else connection.inputStream
            // A health answer is a few bytes; anything bigger is not VideoCAT.
            val body = stream?.use { input ->
                val buffer = ByteArray(4096)
                var length = 0
                while (length < buffer.size) {
                    val read = input.read(buffer, length, buffer.size - length)
                    if (read < 0) break
                    length += read
                }
                String(buffer, 0, length, Charsets.UTF_8)
            }.orEmpty()
            return Response(status, connection.getHeaderField("Location"), body)
        } finally {
            connection.disconnect()
        }
    }
}
