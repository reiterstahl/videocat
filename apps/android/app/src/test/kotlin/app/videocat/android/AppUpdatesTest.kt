package app.videocat.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AppUpdatesTest {
    private val prefix = "https://github.com/reiterstahl/videocat/releases/download/android-v"

    private fun release(tag: String, version: String, draft: Boolean = false, size: Long = 6_600_000, host: String = prefix) = """
        {"tag_name":"$tag","draft":$draft,"prerelease":true,"html_url":"https://github.com/reiterstahl/videocat/releases/tag/$tag",
         "assets":[
           {"name":"VideoCAT-Android-$version.apk","size":$size,"browser_download_url":"$host$version/VideoCAT-Android-$version.apk"},
           {"name":"VideoCAT-Android-$version.apk.sha256","size":93,"browser_download_url":"$host$version/VideoCAT-Android-$version.apk.sha256"},
           {"name":"VideoCAT-Android-$version.aab","size":9000000,"browser_download_url":"$host$version/VideoCAT-Android-$version.aab"}
         ]}
    """

    @Test
    fun comparesVersionsNumberByNumber() {
        assertTrue(AppUpdates.isNewer("0.5.0", "0.4.0"))
        assertTrue(AppUpdates.isNewer("0.10.0", "0.9.9"))
        assertTrue(AppUpdates.isNewer("1.0.0", "0.99.99"))
        assertFalse(AppUpdates.isNewer("0.4.0", "0.4.0"))
        assertFalse(AppUpdates.isNewer("0.3.9", "0.4.0"))
        assertFalse(AppUpdates.isNewer("0.5.0-beta", "0.4.0"))
    }

    @Test
    fun picksTheNewestAndroidReleaseAmongCompanionOnes() {
        val json = """[
            {"tag_name":"v0.2.26-beta.1","draft":false,"assets":[]},
            ${release("android-v0.4.0", "0.4.0")},
            ${release("android-v0.10.0", "0.10.0")},
            ${release("android-v0.9.0", "0.9.0")}
        ]"""
        val newest = AppUpdates.newestRelease(json, prefix)!!
        assertEquals("0.10.0", newest.versionName)
        assertEquals("${prefix}0.10.0/VideoCAT-Android-0.10.0.apk", newest.apkUrl)
        assertEquals("${prefix}0.10.0/VideoCAT-Android-0.10.0.apk.sha256", newest.sha256Url)
        assertEquals(6_600_000L, newest.sizeBytes)
    }

    @Test
    fun skipsDraftsReleasesWithoutTheirFilesAndFilesElsewhere() {
        assertNull(AppUpdates.newestRelease("[${release("android-v0.5.0", "0.5.0", draft = true)}]", prefix))
        assertNull(AppUpdates.newestRelease("[${release("android-v0.5.0", "0.5.0", host = "https://evil.example/")}]", prefix))
        assertNull(AppUpdates.newestRelease("[${release("android-v0.5.0", "0.5.0", size = 0)}]", prefix))
        // The APK without its checksum.
        val noSum = """[{"tag_name":"android-v0.5.0","draft":false,"assets":[
            {"name":"VideoCAT-Android-0.5.0.apk","size":10,"browser_download_url":"${prefix}0.5.0/VideoCAT-Android-0.5.0.apk"}]}]"""
        assertNull(AppUpdates.newestRelease(noSum, prefix))
    }

    @Test
    fun readsTheChecksumFile() {
        val hash = "a".repeat(64)
        assertEquals(hash, AppUpdates.parseSha256("$hash  VideoCAT-Android-0.5.0.apk\n"))
        assertEquals(hash, AppUpdates.parseSha256(hash.uppercase()))
        assertNull(AppUpdates.parseSha256("not a hash"))
        assertNull(AppUpdates.parseSha256(""))
    }
}
