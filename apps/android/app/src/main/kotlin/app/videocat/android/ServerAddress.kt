package app.videocat.android

import java.net.URI

/** What the person types as their server, turned into origins (scheme://host[:port]). */
object ServerAddress {
    private val scheme = Regex("^[a-zA-Z][a-zA-Z0-9+.-]*://")

    /**
     * The origins to try, in order. Without a scheme, https first and then http: a domain usually
     * has a certificate and an address on the LAN usually does not. Null when it is not an address.
     */
    fun candidates(input: String): List<String>? {
        val text = input.trim()
        if (text.isEmpty() || text.any { it.isWhitespace() }) return null
        val urls = if (scheme.containsMatchIn(text)) listOf(text) else listOf("https://$text", "http://$text")
        val origins = urls.map { origin(it) ?: return null }
        return origins.distinct()
    }

    /** scheme://host[:port] of an http(s) address, lowercase and without the default port. */
    fun origin(url: String): String? {
        val uri = try {
            URI(url)
        } catch (_: Exception) {
            return null
        }
        val protocol = uri.scheme?.lowercase() ?: return null
        if (protocol != "http" && protocol != "https") return null
        // URI leaves the host empty for names it cannot parse (an underscore, a space).
        val host = uri.host?.lowercase()?.takeIf { it.isNotEmpty() } ?: return null
        if (uri.rawUserInfo != null) return null
        val defaultPort = if (protocol == "https") 443 else 80
        val port = if (uri.port == -1 || uri.port == defaultPort) "" else ":${uri.port}"
        return "$protocol://$host$port"
    }

    /** The host of an origin, without the brackets of an IPv6 address. */
    fun host(origin: String): String = URI(origin).host.removePrefix("[").removeSuffix("]")

    /**
     * Plain http to a server outside the person's network: the password and the session would
     * travel in the clear over the internet. Addresses that only exist at home or on a VPN
     * (private ranges, Tailscale's 100.64/10, .local and names without a dot) count as inside.
     */
    fun isUnencryptedOverInternet(origin: String): Boolean {
        if (!origin.startsWith("http://")) return false
        return !isLocalHost(host(origin))
    }

    fun isLocalHost(host: String): Boolean {
        val name = host.lowercase()
        if (name == "localhost" || !name.contains('.') && !name.contains(':')) return true
        if (listOf(".local", ".lan", ".home", ".internal", ".home.arpa", ".ts.net").any { name.endsWith(it) }) return true
        val ipv4 = name.split('.').map { it.toIntOrNull() }
        if (ipv4.size == 4 && ipv4.all { it != null && it in 0..255 }) {
            val (a, b) = ipv4.map { it!! }
            return a == 10 || a == 127 || (a == 172 && b in 16..31) || (a == 192 && b == 168) ||
                (a == 169 && b == 254) || (a == 100 && b in 64..127)
        }
        if (name.contains(':')) {
            return name == "::1" || name.startsWith("fc") || name.startsWith("fd") || name.startsWith("fe80:")
        }
        return false
    }
}
