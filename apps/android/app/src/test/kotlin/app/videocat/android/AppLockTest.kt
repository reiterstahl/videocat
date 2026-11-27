package app.videocat.android

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AppLockTest {
    @Test
    fun locksOnAFreshStartAndAfterTheChosenTimeAway() {
        // Off: never.
        assertFalse(AppLock.shouldLock(enabled = false, freshStart = true, backgroundSinceMs = 0, nowMs = 999_999, delaySeconds = 0))
        // A new process always asks.
        assertTrue(AppLock.shouldLock(enabled = true, freshStart = true, backgroundSinceMs = null, nowMs = 0, delaySeconds = 300))
        // Not in the background since the last unlock (a rotation, a dialog): no.
        assertFalse(AppLock.shouldLock(enabled = true, freshStart = false, backgroundSinceMs = null, nowMs = 10_000, delaySeconds = 0))
        // One minute grace.
        assertFalse(AppLock.shouldLock(enabled = true, freshStart = false, backgroundSinceMs = 100_000, nowMs = 159_999, delaySeconds = 60))
        assertTrue(AppLock.shouldLock(enabled = true, freshStart = false, backgroundSinceMs = 100_000, nowMs = 160_000, delaySeconds = 60))
        // Right away.
        assertTrue(AppLock.shouldLock(enabled = true, freshStart = false, backgroundSinceMs = 100_000, nowMs = 100_000, delaySeconds = 0))
    }
}
