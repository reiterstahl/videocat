package app.videocat.android

import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.FileProvider
import androidx.core.content.edit
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * Updates from GitHub Releases, for the APK installed by hand (Google Play updates its own copy).
 * The app looks for the newest android-vX.Y.Z release, tells the person when there is one, and
 * on their word downloads it and hands it to Android's installer, which asks to confirm. Nothing
 * installs without that confirmation.
 *
 * Before the installer sees it, the download must match: the size and SHA-256 that the release
 * publishes, this app's package, a higher versionCode and the same signing certificate as the app
 * installed (Android refuses an update signed with another key anyway).
 */
object AppUpdates {
    data class Release(
        val versionName: String,
        val apkUrl: String,
        val sha256Url: String,
        val sizeBytes: Long,
        val pageUrl: String
    )

    private const val FILE = "updates"
    private const val KEY_LATEST = "latest"
    private const val KEY_CHECKED_AT = "checked_at"
    private const val KEY_NOTIFIED = "notified_version"
    private const val KEY_OFFERED = "offered_version"
    private const val KEY_ASKED_NOTIFICATIONS = "asked_notifications"
    private const val MAX_APK_BYTES = 200L * 1024 * 1024
    private const val CHANNEL = "updates"
    private const val NOTIFICATION_ID = 7
    private val TAG = Regex("""^android-v(\d+)\.(\d+)\.(\d+)$""")

    /** False in a build for Google Play, which must not update itself. */
    val enabled: Boolean get() = BuildConfig.SELF_UPDATE

    /** "0.4.0" from "0.4.0-debug". */
    val installedVersion: String get() = BuildConfig.VERSION_NAME.substringBefore('-')

    /** Whether [candidate] ("0.5.0") is a later version than [installed]. */
    fun isNewer(candidate: String, installed: String): Boolean {
        val a = parts(candidate) ?: return false
        val b = parts(installed) ?: return true
        for (i in 0 until 3) if (a[i] != b[i]) return a[i] > b[i]
        return false
    }

    private fun parts(version: String): List<Int>? =
        Regex("""^(\d+)\.(\d+)\.(\d+)$""").matchEntire(version)?.groupValues?.drop(1)?.map { it.toInt() }

    /**
     * The newest Android release in GitHub's release list that ships its APK and checksum, with
     * the download addresses under [assetPrefix] only. Drafts and other releases are skipped.
     */
    fun newestRelease(json: String, assetPrefix: String): Release? {
        val list = JSONArray(json)
        var best: Release? = null
        for (i in 0 until list.length()) {
            val item = list.optJSONObject(i) ?: continue
            if (item.optBoolean("draft")) continue
            val match = TAG.matchEntire(item.optString("tag_name")) ?: continue
            val version = match.groupValues.drop(1).joinToString(".")
            val assets = item.optJSONArray("assets") ?: continue
            val apk = asset(assets, "VideoCAT-Android-$version.apk") ?: continue
            val sha = asset(assets, "VideoCAT-Android-$version.apk.sha256") ?: continue
            val apkUrl = apk.optString("browser_download_url")
            val shaUrl = sha.optString("browser_download_url")
            if (!apkUrl.startsWith(assetPrefix) || !shaUrl.startsWith(assetPrefix)) continue
            val size = apk.optLong("size")
            if (size <= 0 || size > MAX_APK_BYTES) continue
            val release = Release(version, apkUrl, shaUrl, size, item.optString("html_url"))
            if (best == null || isNewer(version, best.versionName)) best = release
        }
        return best
    }

    private fun asset(assets: JSONArray, name: String): JSONObject? {
        for (i in 0 until assets.length()) {
            val asset = assets.optJSONObject(i) ?: continue
            if (asset.optString("name") == name) return asset
        }
        return null
    }

    /** The checksum file's hash: the first word, 64 hex characters. */
    fun parseSha256(text: String): String? =
        text.trim().split(Regex("""\s+""")).firstOrNull()?.lowercase()?.takeIf { Regex("^[0-9a-f]{64}$").matches(it) }

    /** The release found last time, if it is still newer than the app installed. */
    fun available(context: Context): Release? {
        val saved = prefs(context).getString(KEY_LATEST, null) ?: return null
        val release = try {
            fromJson(JSONObject(saved))
        } catch (_: Exception) {
            null
        } ?: return null
        return release.takeIf { isNewer(it.versionName, installedVersion) }
    }

    /** When the last check was, or 0. */
    fun checkedAt(context: Context): Long = prefs(context).getLong(KEY_CHECKED_AT, 0)

    /**
     * Asks GitHub for the newest release (network: call it off the main thread). Returns the
     * release when it is newer than the app installed, or null when the app is up to date.
     */
    @Throws(IOException::class)
    fun check(context: Context): Release? {
        val body = get(BuildConfig.UPDATES_URL, 2_000_000).toString(Charsets.UTF_8)
        val newest = try {
            newestRelease(body, BuildConfig.UPDATES_ASSET_PREFIX)
        } catch (error: Exception) {
            throw IOException("GitHub's answer could not be read", error)
        }
        prefs(context).edit {
            putLong(KEY_CHECKED_AT, System.currentTimeMillis())
            if (newest != null) putString(KEY_LATEST, toJson(newest).toString())
        }
        cleanUp(context)
        return newest?.takeIf { isNewer(it.versionName, installedVersion) }
    }

    /** Checks unless the last check is more recent than [minIntervalMs]; then what it found. */
    fun checkIfDue(context: Context, minIntervalMs: Long): Release? {
        if (System.currentTimeMillis() - checkedAt(context) < minIntervalMs) return available(context)
        return try {
            check(context)
        } catch (_: IOException) {
            available(context)
        }
    }

    /**
     * Downloads [release] and checks it (network and disk: off the main thread). [progress] gets
     * 0 to 100. Returns the verified file, ready for [installIntent].
     */
    @Throws(IOException::class, SecurityException::class)
    fun download(context: Context, release: Release, progress: (Int) -> Unit): File {
        val expected = parseSha256(get(release.sha256Url, 10_000).toString(Charsets.UTF_8))
            ?: throw IOException("The release has no valid checksum")
        val dir = File(context.filesDir, "updates").apply { mkdirs() }
        val target = File(dir, "VideoCAT-Android-${release.versionName}.apk")
        if (target.isFile && sha256(target) == expected) {
            verifyArchive(context, target)
            progress(100)
            return target
        }
        val partial = File(dir, "download.part")
        val digest = MessageDigest.getInstance("SHA-256")
        var size = 0L
        open(release.apkUrl).let { connection ->
            try {
                if (connection.responseCode != 200) throw IOException("The download answered ${connection.responseCode}")
                connection.inputStream.use { input ->
                    partial.outputStream().use { output ->
                        val buffer = ByteArray(64 * 1024)
                        while (true) {
                            val read = input.read(buffer)
                            if (read < 0) break
                            size += read
                            if (size > release.sizeBytes) throw SecurityException("The download is larger than published")
                            output.write(buffer, 0, read)
                            digest.update(buffer, 0, read)
                            progress((size * 100 / release.sizeBytes).toInt().coerceAtMost(99))
                        }
                        output.fd.sync()
                    }
                }
            } finally {
                connection.disconnect()
            }
        }
        if (size != release.sizeBytes || hex(digest.digest()) != expected) {
            partial.delete()
            throw SecurityException("The download does not match the release")
        }
        verifyArchive(context, partial)
        target.delete()
        if (!partial.renameTo(target)) throw IOException("The download could not be kept")
        progress(100)
        return target
    }

    /** This app, a later version, signed with the same certificate. */
    @Throws(SecurityException::class)
    fun verifyArchive(context: Context, file: File) {
        val pm = context.packageManager
        val archive = pm.getPackageArchiveInfo(file.absolutePath, signatureFlags())
            ?: throw SecurityException("The download is not an app")
        val code = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) archive.longVersionCode else @Suppress("DEPRECATION") archive.versionCode.toLong()
        if (archive.packageName != context.packageName) throw SecurityException("The download is another app")
        if (code <= BuildConfig.VERSION_CODE) throw SecurityException("The download is not a newer version")
        val installed = pm.getPackageInfo(context.packageName, signatureFlags())
        if (certificate(archive) != certificate(installed)) throw SecurityException("The download is signed with another key")
    }

    /** Opens Android's installer on [file]; it asks the person to confirm. */
    fun installIntent(context: Context, file: File): Intent {
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.updates", file)
        return Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
    }

    /** Android asks once, per app, to allow installing apps from it. */
    fun canInstall(context: Context): Boolean = context.packageManager.canRequestPackageInstalls()

    // What the person has already been told, so each version is announced once.
    fun wasOffered(context: Context, version: String): Boolean = prefs(context).getString(KEY_OFFERED, null) == version
    fun markOffered(context: Context, version: String) = prefs(context).edit { putString(KEY_OFFERED, version) }
    fun askedForNotifications(context: Context): Boolean = prefs(context).getBoolean(KEY_ASKED_NOTIFICATIONS, false)
    fun markAskedForNotifications(context: Context) = prefs(context).edit { putBoolean(KEY_ASKED_NOTIFICATIONS, true) }

    /** The system notification for [release], once per version. Tapping it opens the update. */
    @SuppressLint("MissingPermission") // Checked: areNotificationsEnabled() is false without it.
    fun notify(context: Context, release: Release) {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        if (!manager.areNotificationsEnabled()) return
        if (prefs(context).getString(KEY_NOTIFIED, null) == release.versionName) return
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL, context.getString(R.string.update_channel), NotificationManager.IMPORTANCE_DEFAULT)
        )
        val open = PendingIntent.getActivities(
            context, 0,
            arrayOf(
                Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                SettingsActivity.intent(context).putExtra(SettingsActivity.EXTRA_UPDATE, true)
            ),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val notification = android.app.Notification.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_update)
            .setContentTitle(context.getString(R.string.update_notification_title, release.versionName))
            .setContentText(context.getString(R.string.update_notification_text))
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        manager.notify(NOTIFICATION_ID, notification)
        prefs(context).edit { putString(KEY_NOTIFIED, release.versionName) }
    }

    fun cancelNotification(context: Context) {
        context.getSystemService(NotificationManager::class.java)?.cancel(NOTIFICATION_ID)
    }

    // Downloads of versions already installed (or older) are deleted.
    private fun cleanUp(context: Context) {
        File(context.filesDir, "updates").listFiles()?.forEach { file ->
            val version = file.name.removePrefix("VideoCAT-Android-").removeSuffix(".apk")
            if (file.name == "download.part" || !isNewer(version, installedVersion)) file.delete()
        }
    }

    private fun get(url: String, maxBytes: Int): ByteArray {
        val connection = open(url)
        try {
            if (connection.responseCode != 200) throw IOException("$url answered ${connection.responseCode}")
            connection.inputStream.use { input ->
                val out = java.io.ByteArrayOutputStream()
                val buffer = ByteArray(16 * 1024)
                while (true) {
                    val read = input.read(buffer)
                    if (read < 0) break
                    if (out.size() + read > maxBytes) throw IOException("$url answered too much")
                    out.write(buffer, 0, read)
                }
                return out.toByteArray()
            }
        } finally {
            connection.disconnect()
        }
    }

    // GitHub sends the files from another of its hosts: up to a few redirects, HTTPS only (the
    // test address of a debug build may be plain HTTP).
    private fun open(start: String): HttpURLConnection {
        var url = start
        repeat(5) {
            val parsed = URL(url)
            if (parsed.protocol != "https" && !url.startsWith(BuildConfig.UPDATES_ASSET_PREFIX)) throw IOException("Not HTTPS: $url")
            val connection = parsed.openConnection() as HttpURLConnection
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 15_000
            connection.readTimeout = 30_000
            connection.setRequestProperty("User-Agent", "VideoCATAndroid/${BuildConfig.VERSION_NAME}")
            connection.setRequestProperty("Accept", "application/vnd.github+json, application/octet-stream")
            val code = connection.responseCode
            if (code in 300..399) {
                val location = connection.getHeaderField("Location") ?: throw IOException("Redirect without an address")
                connection.disconnect()
                url = URL(parsed, location).toString()
                return@repeat
            }
            return connection
        }
        throw IOException("Too many redirects")
    }

    private fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                digest.update(buffer, 0, read)
            }
        }
        return hex(digest.digest())
    }

    private fun hex(bytes: ByteArray): String = bytes.joinToString("") { "%02x".format(it) }

    @Suppress("DEPRECATION")
    private fun signatureFlags(): Int =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES

    @Suppress("DEPRECATION")
    private fun certificate(info: PackageInfo): String {
        val signatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.signingInfo?.apkContentsSigners else info.signatures
        val only = signatures?.singleOrNull() ?: throw SecurityException("The app's signature is not a single certificate")
        return hex(MessageDigest.getInstance("SHA-256").digest(only.toByteArray()))
    }

    private fun toJson(release: Release) = JSONObject()
        .put("versionName", release.versionName)
        .put("apkUrl", release.apkUrl)
        .put("sha256Url", release.sha256Url)
        .put("sizeBytes", release.sizeBytes)
        .put("pageUrl", release.pageUrl)

    private fun fromJson(json: JSONObject) = Release(
        json.getString("versionName"),
        json.getString("apkUrl"),
        json.getString("sha256Url"),
        json.getLong("sizeBytes"),
        json.optString("pageUrl")
    )

    private fun prefs(context: Context) = context.getSharedPreferences(FILE, Context.MODE_PRIVATE)
}
